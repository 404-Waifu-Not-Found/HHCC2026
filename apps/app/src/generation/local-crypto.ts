import { sha256 } from "@noble/hashes/sha2.js";

function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function byteView(data: BufferSource): Uint8Array {
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Builds the WebCrypto subset used by the local quiz engine without relying
 * on React Native's incomplete global crypto shim. SHA-256 is provided by the
 * audited noble implementation. Random-looking bytes are a deterministic
 * hash stream keyed by server-issued generation/session identifiers; they are
 * used only for answer ordering, polarity balance, and retry jitter—not for
 * keys, authentication, or encrypted data.
 */
export function createLocalCrypto(seedParts: readonly string[]) {
  const seed = sha256(
    utf8Bytes(["ClipQuest.local-crypto.v1", ...seedParts].join("\u0000")),
  );
  let counter = 0;

  const nextBlock = () => {
    counter += 1;
    const input = new Uint8Array(seed.byteLength + 8);
    input.set(seed);
    const view = new DataView(input.buffer);
    view.setUint32(seed.byteLength, Math.floor(counter / 0x1_0000_0000));
    view.setUint32(seed.byteLength + 4, counter >>> 0);
    return sha256(input);
  };

  const getRandomValues = <T extends ArrayBufferView>(values: T): T => {
    const target = new Uint8Array(
      values.buffer,
      values.byteOffset,
      values.byteLength,
    );
    let offset = 0;
    while (offset < target.byteLength) {
      const block = nextBlock();
      const remaining = target.byteLength - offset;
      target.set(
        block.subarray(0, Math.min(block.byteLength, remaining)),
        offset,
      );
      offset += Math.min(block.byteLength, remaining);
    }
    return values;
  };

  const randomUUID = () => {
    const bytes = getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  return {
    subtle: {
      digest(algorithm: "SHA-256", data: BufferSource) {
        if (algorithm !== "SHA-256") {
          throw new Error("The requested digest is not supported.");
        }
        return Promise.resolve(copyArrayBuffer(sha256(byteView(data))));
      },
    },
    getRandomValues,
    randomUUID,
  };
}
