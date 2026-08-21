import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { writeZipArchive } from "./zip-archive.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(root, "dist");
const stableExtensionOutput = resolve(
  outputRoot,
  "clipquest-captions-extension",
);
const appIcon = resolve(root, "../app/assets/brand/learning-prism.png");
const appBrandRoot = resolve(root, "../app/assets/brand");
const generatedIconRoot = resolve(root, "../app/assets/platform/extension");
const sharedEngineRoot = resolve(root, "../../packages/local-quiz-engine/src");
const sharedEngineFiles = new Set([
  "caption-text.js",
  "grounded-quality.js",
  "local-generator.js",
  "math-expression.js",
]);

mkdirSync(outputRoot, { recursive: true });
const stagingRoot = mkdtempSync(resolve(outputRoot, ".clipquest-build-"));
const extensionOutput = resolve(stagingRoot, "clipquest-captions-extension");
mkdirSync(resolve(extensionOutput, "icons"), { recursive: true });
mkdirSync(resolve(extensionOutput, "brand"), { recursive: true });

for (const file of ["manifest.json", "LICENSE", "NOTICE.md"]) {
  cpSync(resolve(root, file), resolve(extensionOutput, file));
}
for (const file of [
  "background.js",
  "bounded-response.js",
  "caption-core.js",
  "caption-text.js",
  "clipquest-bridge.js",
  "generation-outbox.js",
  "grounded-quality.js",
  "local-generator.js",
  "math-expression.js",
  "origin-policy.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "youtube-content.js",
  "youtube-page.js",
  "youtube-quick-open.css",
  "youtube-quick-open.js",
]) {
  cpSync(
    resolve(
      sharedEngineFiles.has(file) ? sharedEngineRoot : resolve(root, "src"),
      file,
    ),
    resolve(extensionOutput, file),
  );
}
for (const size of [16, 48, 128]) {
  const generated = resolve(generatedIconRoot, `icon-${size}.png`);
  cpSync(generated, resolve(extensionOutput, `icons/icon-${size}.png`));
}
for (const name of [
  "clipquest-lockup-on-light.png",
  "clipquest-lockup-on-dark.png",
]) {
  cpSync(resolve(appBrandRoot, name), resolve(extensionOutput, "brand", name));
}

const iconStats = await sharp(appIcon).stats();
const iconMetadata = await sharp(appIcon).metadata();
const { data: iconPixels, info: iconInfo } = await sharp(appIcon)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const iconCornerAlphaOffsets = [
  3,
  (iconInfo.width - 1) * iconInfo.channels + 3,
  (iconInfo.height - 1) * iconInfo.width * iconInfo.channels + 3,
  (iconInfo.width * iconInfo.height - 1) * iconInfo.channels + 3,
];
if (
  iconStats.entropy < 1 ||
  iconMetadata.hasAlpha !== true ||
  iconCornerAlphaOffsets.some((offset) => iconPixels[offset] !== 0)
) {
  throw new Error(
    "Canonical learning prism is blank or does not have a transparent background.",
  );
}

JSON.parse(readFileSync(resolve(extensionOutput, "manifest.json"), "utf8"));

const archive = resolve(outputRoot, "clipquest-captions-extension.zip");
rmSync(archive, { force: true });
rmSync(stableExtensionOutput, { recursive: true, force: true });
cpSync(extensionOutput, stableExtensionOutput, {
  recursive: true,
  force: true,
});
const archiveFiles = normalizeAndListFiles(stagingRoot, extensionOutput);
// Prefer the system `zip` CLI (identical bytes to the tracked release asset);
// fall back to the dependency-free writer where `zip` is not installed, such
// as Windows developer machines, so dev:web, build, and e2e stay runnable.
const zipped = spawnSync("zip", ["-X", "-q", archive, ...archiveFiles], {
  cwd: stagingRoot,
  stdio: "inherit",
});
let packager = "zip";
if (zipped.error && zipped.error.code === "ENOENT") {
  writeZipArchive(archive, stagingRoot, archiveFiles);
  packager = "node";
}
rmSync(stagingRoot, { recursive: true, force: true });
if (packager === "zip" && zipped.status !== 0) {
  throw new Error(
    "Could not package the ClipQuest caption extension. Install the zip command and retry.",
  );
}
const archiveSha256 = createHash("sha256")
  .update(readFileSync(archive))
  .digest("hex");
console.log(
  `Built ${archive} (sha256 ${archiveSha256}, packaged with ${packager})`,
);

function normalizeAndListFiles(stagingDirectory, directory) {
  const normalizedTime = new Date("2020-01-01T00:00:00.000Z");
  const files = [];
  const visit = (current) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const target = resolve(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) {
        utimesSync(target, normalizedTime, normalizedTime);
        files.push(target.slice(stagingDirectory.length + 1));
      }
    }
    utimesSync(current, normalizedTime, normalizedTime);
  };
  visit(directory);
  return files.sort();
}
