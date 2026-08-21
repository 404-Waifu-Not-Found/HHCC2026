import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(root, "dist");
const extensionOutput = resolve(outputRoot, "clipquest-captions-extension");
const appIcon = resolve(
  root,
  "../app/assets/illustrations/clip-explorer-ready.png",
);

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(resolve(extensionOutput, "icons"), { recursive: true });

for (const file of ["manifest.json", "LICENSE", "NOTICE.md"]) {
  cpSync(resolve(root, file), resolve(extensionOutput, file));
}
for (const file of [
  "background.js",
  "caption-core.js",
  "caption-text.js",
  "clipquest-bridge.js",
  "local-generator.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "youtube-content.js",
  "youtube-page.js",
]) {
  cpSync(resolve(root, "src", file), resolve(extensionOutput, file));
}
for (const size of [16, 48, 128]) {
  await sharp(appIcon)
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(resolve(extensionOutput, `icons/icon-${size}.png`));
}

JSON.parse(readFileSync(resolve(extensionOutput, "manifest.json"), "utf8"));

const archive = resolve(outputRoot, "clipquest-captions-extension.zip");
const zipped = spawnSync(
  "zip",
  ["-q", "-r", archive, "clipquest-captions-extension"],
  { cwd: outputRoot, stdio: "inherit" },
);
if (zipped.status !== 0) {
  throw new Error(
    "Could not package the ClipQuest caption extension. Install the zip command and retry.",
  );
}
console.log(`Built ${archive}`);
