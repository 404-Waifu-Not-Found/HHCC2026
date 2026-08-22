// Dependency-free ZIP writer used when the `zip` CLI is unavailable (Windows
// developer machines, minimal CI images). Produces a deterministic archive:
// entries are written in the given order with a fixed DOS timestamp, no extra
// fields, and raw DEFLATE (or STORE when compression does not help).
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32 as zlibCrc32, deflateRawSync } from "node:zlib";

// Node >= 22.2 ships a native CRC-32; re-exported so the archive tests can
// assert the checksum ZIP readers will verify.
export function crc32(buffer) {
  return zlibCrc32(buffer) >>> 0;
}

export function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  const dosDate =
    ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const dosTime =
    (date.getUTCHours() << 11) |
    (date.getUTCMinutes() << 5) |
    Math.floor(date.getUTCSeconds() / 2);
  return { dosDate, dosTime };
}

/**
 * Build a ZIP archive in memory.
 *
 * @param {Array<{ name: string; data: Buffer }>} entries Files in archive order;
 *   names use forward slashes and are relative to the archive root.
 * @param {{ mtime?: Date }} [options]
 * @returns {Buffer}
 */
export function createZipArchive(entries, options = {}) {
  const { dosDate, dosTime } = dosDateTime(
    options.mtime ?? new Date("2020-01-01T00:00:00.000Z"),
  );
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // general purpose: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    localParts.push(local, payload);
    centralParts.push(central);
    offset += local.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

/**
 * Write `relativeFiles` (paths relative to `baseDirectory`, any separator)
 * into a ZIP archive at `archivePath`.
 */
export function writeZipArchive(
  archivePath,
  baseDirectory,
  relativeFiles,
  options = {},
) {
  const entries = relativeFiles.map((relativePath) => {
    // Accept either separator on every platform: Linux treats a backslash as
    // an ordinary filename character, so resolve through the split segments.
    const segments = relativePath.split(/[\\/]+/).filter(Boolean);
    return {
      name: segments.join("/"),
      data: readFileSync(resolve(baseDirectory, ...segments)),
    };
  });
  const archive = createZipArchive(entries, options);
  writeFileSync(archivePath, archive);
  return archive;
}
