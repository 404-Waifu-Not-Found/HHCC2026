import { ApiError } from "./errors";
import { safeErrorName } from "./safe-error";

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new ApiError(
      500,
      "encryption_key_invalid",
      "The YouTube encryption key is not valid base64.",
    );
  }
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importKey(encodedKey: string): Promise<CryptoKey> {
  const bytes = decodeBase64(encodedKey);
  if (bytes.byteLength !== 32) {
    throw new ApiError(
      500,
      "encryption_key_invalid",
      "The YouTube encryption key must decode to 32 bytes.",
    );
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptJson(
  secret: string,
  value: unknown,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importKey(secret);
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  return {
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    iv: encodeBase64(iv),
  };
}

export async function decryptJson(
  secret: string,
  ciphertext: string,
  encodedIv: string,
): Promise<unknown> {
  try {
    const key = await importKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64(encodedIv) },
      key,
      decodeBase64(ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "youtube_credentials",
        event: "decryption_failed",
        errorName: safeErrorName(error),
      }),
    );
    throw new ApiError(
      500,
      "credentials_unreadable",
      "The saved YouTube connection could not be decrypted.",
    );
  }
}
