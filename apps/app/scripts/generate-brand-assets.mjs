import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(appRoot, "assets/brand/learning-prism.png");
const wordmarkFont = resolve(
  appRoot,
  "../../node_modules/@expo-google-fonts/fredoka/700Bold/Fredoka_700Bold.ttf",
);
const launcherBackground = "#19683A";

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

const trimmed = await sharp(source)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
  .png()
  .toBuffer();

const embeddedWordmarkFont = (await readFile(wordmarkFont)).toString("base64");

async function renderLockup(path, textColor, questColor) {
  await ensureParent(path);
  const width = 1600;
  const height = 420;
  const markSize = 360;
  const mark = await sharp(trimmed)
    .resize({
      width: markSize,
      height: markSize,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const wordmark = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        @font-face {
          font-family: "ClipQuest Fredoka";
          src: url("data:font/ttf;base64,${embeddedWordmarkFont}") format("truetype");
          font-weight: 700;
        }
        text {
          font-family: "ClipQuest Fredoka";
          font-size: 214px;
          font-weight: 700;
          letter-spacing: -5px;
        }
      </style>
      <text x="420" y="278">
        <tspan fill="${textColor}">Clip</tspan><tspan fill="${questColor}">Quest</tspan>
      </text>
    </svg>
  `);
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: mark, left: 28, top: 30 },
      { input: wordmark, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path);
}

const lockupVariants = [
  ["clipquest-lockup-on-light.png", "#203329", "#247D49"],
  ["clipquest-lockup-on-dark.png", "#F0F6F1", "#84D6A0"],
];

for (const [name, textColor, questColor] of lockupVariants) {
  await renderLockup(
    resolve(appRoot, `assets/brand/${name}`),
    textColor,
    questColor,
  );
  await renderLockup(
    resolve(appRoot, `public/brand/${name}`),
    textColor,
    questColor,
  );
}

async function renderSquare(
  path,
  size,
  inset = 0.12,
  format = "png",
  background = null,
) {
  await ensureParent(path);
  const subject = await sharp(trimmed)
    .resize({
      width: Math.round(size * (1 - inset * 2)),
      height: Math.round(size * (1 - inset * 2)),
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const pipeline = sharp({
    create: {
      width: size,
      height: size,
      channels: background ? 3 : 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: subject, gravity: "center" }]);
  if (format === "webp") {
    await pipeline.webp({ quality: 96, lossless: true }).toFile(path);
  } else {
    await pipeline.png({ compressionLevel: 9 }).toFile(path);
  }
}

const transparentPngTargets = [
  ["public/favicon.png", 64, 0.08],
  ["public/icon-192.png", 192, 0.12],
  ["public/icon-512.png", 512, 0.12],
  ["assets/platform/adaptive-icon.png", 1024, 0.2],
  ["assets/platform/splash-icon.png", 1024, 0.22],
  ["assets/platform/extension/icon-16.png", 16, 0.04],
  ["assets/platform/extension/icon-48.png", 48, 0.08],
  ["assets/platform/extension/icon-128.png", 128, 0.1],
];

for (const [path, size, inset] of transparentPngTargets) {
  await renderSquare(resolve(appRoot, path), size, inset);
}

const opaquePngTargets = [
  ["public/apple-touch-icon.png", 180, 0.12],
  ["assets/platform/app-icon-1024.png", 1024, 0.11],
  [
    "ios/ClipQuest/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png",
    1024,
    0.11,
  ],
];

for (const [path, size, inset] of opaquePngTargets) {
  await renderSquare(
    resolve(appRoot, path),
    size,
    inset,
    "png",
    launcherBackground,
  );
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
      launcherBackground,
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
  "# Generated ClipQuest brand assets\n\nRun `npm run brand:assets -w @clipquest/app` after changing the canonical learning prism. The light and dark primary wordmarks are generated from that prism and the existing Fredoka font. Canonical artwork, wordmarks, and foreground derivatives remain transparent; required Apple and legacy launcher backplates use structural green. Do not edit these derivatives by hand.\n",
);

console.log(
  "Generated ClipQuest platform, PWA, native, and extension artwork.",
);
