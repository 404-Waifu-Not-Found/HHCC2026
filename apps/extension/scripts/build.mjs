import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(root, "dist");
const stableExtensionOutput = resolve(
  outputRoot,
  "clipquest-captions-extension",
);
const appIcon = resolve(root, "../app/assets/brand/learning-prism.png");
const appBrandRoot = resolve(root, "../app/assets/brand");
const generatedIconRoot = resolve(root, "../app/assets/platform/extension");

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
  "caption-core.js",
  "caption-text.js",
  "clipquest-bridge.js",
  "local-generator.js",
  "origin-policy.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "youtube-content.js",
  "youtube-page.js",
  "youtube-quick-open.css",
  "youtube-quick-open.js",
]) {
  cpSync(resolve(root, "src", file), resolve(extensionOutput, file));
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
mkdirSync(stableExtensionOutput, { recursive: true });
cpSync(extensionOutput, stableExtensionOutput, {
  recursive: true,
  force: true,
});
const zipped = spawnSync(
  "zip",
  ["-q", "-r", archive, "clipquest-captions-extension"],
  { cwd: stagingRoot, stdio: "inherit" },
);
rmSync(stagingRoot, { recursive: true, force: true });
if (zipped.status !== 0) {
  throw new Error(
    "Could not package the ClipQuest caption extension. Install the zip command and retry.",
  );
}
console.log(`Built ${archive}`);
