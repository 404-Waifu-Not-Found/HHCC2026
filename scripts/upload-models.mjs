import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = resolve(root, ".model-cache");
const manifestPath = resolve(cache, "manifest.json");
if (!existsSync(manifestPath)) throw new Error("Run npm run models:prepare first.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const objects = manifest.web.files.map((file) => ({
  source: resolve(cache, "web", file.path),
  key: `models/whisper-tiny/${manifest.web.repository}/resolve/${manifest.revision}/${file.path}`,
  contentType: file.path.endsWith(".json") ? "application/json" : file.path.endsWith(".txt") ? "text/plain" : "application/octet-stream",
}));
objects.push({
  source: resolve(cache, manifest.native.file.path),
  key: `models/whisper-tiny/${manifest.native.file.path}`,
  contentType: "application/octet-stream",
});
objects.push({ source: manifestPath, key: "models/whisper-tiny/manifest.json", contentType: "application/json" });

for (const object of objects) {
  if (!existsSync(object.source)) throw new Error(`Missing prepared model file: ${object.source}`);
  console.log(`Uploading ${object.key}`);
  const result = spawnSync(
    "npx",
    ["wrangler", "r2", "object", "put", `clipquest-private/${object.key}`, "--file", object.source, "--content-type", object.contentType, "--remote"],
    { cwd: root, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
