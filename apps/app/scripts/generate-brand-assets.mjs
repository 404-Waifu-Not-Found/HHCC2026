import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(appRoot, "assets/brand/learning-prism.png");
const canvas = "#F7F9F4";

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

const trimmed = await sharp(source)
  .trim({ background: "#F4F4F4", threshold: 5 })
  .png()
  .toBuffer();

async function renderSquare(path, size, inset = 0.12, format = "png") {
  await ensureParent(path);
  const subject = await sharp(trimmed)
    .resize({
      width: Math.round(size * (1 - inset * 2)),
      height: Math.round(size * (1 - inset * 2)),
      fit: "contain",
    })
    .png()
    .toBuffer();
  const pipeline = sharp({
    create: { width: size, height: size, channels: 3, background: canvas },
  }).composite([{ input: subject, gravity: "center" }]);
  if (format === "webp") {
    await pipeline.webp({ quality: 96, lossless: true }).toFile(path);
  } else {
    await pipeline.png({ compressionLevel: 9 }).toFile(path);
  }
}

const pngTargets = [
  ["public/favicon.png", 64, 0.08],
  ["public/apple-touch-icon.png", 180, 0.12],
  ["public/icon-192.png", 192, 0.12],
  ["public/icon-512.png", 512, 0.12],
  ["assets/platform/app-icon-1024.png", 1024, 0.11],
  ["assets/platform/adaptive-icon.png", 1024, 0.2],
  ["assets/platform/splash-icon.png", 1024, 0.22],
  ["ios/ClipQuest/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png", 1024, 0.11],
  ["assets/platform/extension/icon-16.png", 16, 0.04],
  ["assets/platform/extension/icon-48.png", 48, 0.08],
  ["assets/platform/extension/icon-128.png", 128, 0.1],
];

for (const [path, size, inset] of pngTargets) {
  await renderSquare(resolve(appRoot, path), size, inset);
}

const androidScales = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};
for (const [density, size] of Object.entries(androidScales)) {
  for (const name of ["ic_launcher.webp", "ic_launcher_round.webp"]) {
    await renderSquare(
      resolve(appRoot, `android/app/src/main/res/mipmap-${density}/${name}`),
      size,
      name.includes("round") ? 0.18 : 0.12,
      "webp",
    );
  }
}

const splashSizes = {
  mdpi: 288,
  hdpi: 432,
  xhdpi: 576,
  xxhdpi: 864,
  xxxhdpi: 1152,
};
for (const [density, size] of Object.entries(splashSizes)) {
  await renderSquare(
    resolve(
      appRoot,
      `android/app/src/main/res/drawable-${density}/splashscreen_logo.png`,
    ),
    size,
    0.24,
  );
}

await writeFile(
  resolve(appRoot, "assets/platform/README.md"),
  "# Generated ClipQuest platform assets\n\nRun `npm run brand:assets -w @clipquest/app` after changing the canonical learning prism. Do not edit these derivatives by hand.\n",
);

console.log("Generated ClipQuest platform, PWA, native, and extension artwork.");
