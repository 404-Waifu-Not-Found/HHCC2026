import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import {
  crc32,
  createZipArchive,
  dosDateTime,
  writeZipArchive,
} from "../scripts/zip-archive.mjs";

function parseArchive(buffer) {
  const endOffset = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(endOffset), 0x06054b50);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  assert.equal(centralOffset + centralSize, endOffset);

  const entries = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    const method = buffer.readUInt16LE(cursor + 10);
    const time = buffer.readUInt16LE(cursor + 12);
    const date = buffer.readUInt16LE(cursor + 14);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength;

    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? inflateRawSync(payload) : payload;
    assert.equal(data.length, size);
    assert.equal(crc32(data), crc);
    entries.push({ name: name.toString("utf8"), data, method, time, date });
  }
  return entries;
}

test("crc32 matches the well-known check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("dosDateTime encodes the normalised build timestamp", () => {
  const { dosDate, dosTime } = dosDateTime(
    new Date("2020-01-01T00:00:00.000Z"),
  );
  assert.equal(dosDate, ((2020 - 1980) << 9) | (1 << 5) | 1);
  assert.equal(dosTime, 0);
});

test("createZipArchive round-trips deflated and stored entries deterministically", () => {
  const entries = [
    { name: "manifest.json", data: Buffer.from('{"name":"ClipQuest"}') },
    {
      name: "src/background.js",
      data: Buffer.from("export const bridge = 1;\n".repeat(64)),
    },
    { name: "icons/tiny.bin", data: Buffer.from([0x00, 0xff, 0x10]) },
  ];
  const first = createZipArchive(entries);
  const second = createZipArchive(entries);
  assert.deepEqual(first, second);

  const parsed = parseArchive(first);
  assert.deepEqual(
    parsed.map((entry) => entry.name),
    ["manifest.json", "src/background.js", "icons/tiny.bin"],
  );
  for (const [index, entry] of parsed.entries()) {
    assert.deepEqual(entry.data, entries[index].data);
    assert.equal(entry.date, ((2020 - 1980) << 9) | (1 << 5) | 1);
    assert.equal(entry.time, 0);
  }
  assert.equal(parsed[1].method, 8, "repetitive text is deflated");
  assert.equal(parsed[2].method, 0, "incompressible bytes are stored");
});

test("writeZipArchive reads files relative to the base directory and normalises separators", () => {
  const base = mkdtempSync(join(tmpdir(), "clipquest-zip-"));
  mkdirSync(join(base, "pkg", "icons"), { recursive: true });
  writeFileSync(join(base, "pkg", "manifest.json"), "{}");
  writeFileSync(join(base, "pkg", "icons", "icon-16.png"), "png");
  const archivePath = join(base, "out.zip");
  const archive = writeZipArchive(archivePath, base, [
    "pkg\\manifest.json",
    "pkg/icons/icon-16.png",
  ]);
  assert.deepEqual(readFileSync(archivePath), archive);
  assert.deepEqual(
    parseArchive(archive).map((entry) => entry.name),
    ["pkg/manifest.json", "pkg/icons/icon-16.png"],
  );
});
