import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { darkTheme, lightTheme } from "../src/theme/tokens";
import { voxelIconNames } from "../src/theme/voxel-icons";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (bright! + 0.05) / (dark! + 0.05);
}

async function sourceFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const next = resolve(path, entry.name);
      if (entry.isDirectory()) return sourceFiles(next);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [next] : [];
    }),
  );
  return nested.flat();
}

describe("ClipQuest rebrand assets", () => {
  it("resolves every typed voxel icon to a transparent canonical PNG", async () => {
    const iconRoot = resolve(appRoot, "assets/icons/voxel");
    const files = (await readdir(iconRoot)).sort();
    expect(files).toEqual(voxelIconNames.map((name) => `${name}.png`).sort());

    for (const name of voxelIconNames) {
      const image = sharp(resolve(iconRoot, `${name}.png`));
      const metadata = await image.metadata();
      const stats = await image.stats();
      expect(metadata).toMatchObject({ width: 512, height: 512, channels: 4 });
      expect(metadata.hasAlpha).toBe(true);
      expect(stats.entropy).toBeGreaterThan(1);

      const { data, info } = await image
        .raw()
        .toBuffer({ resolveWithObject: true });
      const cornerOffsets = [
        0,
        (info.width - 1) * info.channels,
        (info.height - 1) * info.width * info.channels,
        (info.width * info.height - 1) * info.channels,
      ];
      for (const offset of cornerOffsets) {
        expect(data[offset + 3]).toBe(0);
      }
    }
  }, 30_000);

  it("keeps platform identity nonblank and replaces placeholder artwork", async () => {
    const splashDensities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
    const transparentTargets = [
      "assets/brand/learning-prism.png",
      "assets/platform/adaptive-icon.png",
      "assets/platform/splash-icon.png",
      "public/favicon.png",
      "public/icon-192.png",
      "public/icon-512.png",
      "assets/platform/extension/icon-16.png",
      "assets/platform/extension/icon-48.png",
      "assets/platform/extension/icon-128.png",
      ...splashDensities.map(
        (density) =>
          `android/app/src/main/res/drawable-${density}/splashscreen_logo.png`,
      ),
    ];
    for (const target of transparentTargets) {
      const image = sharp(resolve(appRoot, target));
      const metadata = await image.metadata();
      const stats = await image.stats();
      expect(metadata.width).toBeGreaterThanOrEqual(16);
      expect(metadata.height).toBe(metadata.width);
      expect(metadata.hasAlpha).toBe(true);
      expect(stats.entropy).toBeGreaterThan(1);

      const { data, info } = await image
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const cornerOffsets = [
        3,
        (info.width - 1) * info.channels + 3,
        (info.height - 1) * info.width * info.channels + 3,
        (info.width * info.height - 1) * info.channels + 3,
      ];
      for (const offset of cornerOffsets) expect(data[offset]).toBe(0);
    }

    const androidDensities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
    const opaqueLauncherTargets = [
      "public/apple-touch-icon.png",
      "assets/platform/app-icon-1024.png",
      "ios/ClipQuest/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png",
      ...androidDensities.flatMap((density) => [
        `android/app/src/main/res/mipmap-${density}/ic_launcher.webp`,
        `android/app/src/main/res/mipmap-${density}/ic_launcher_round.webp`,
      ]),
    ];
    for (const target of opaqueLauncherTargets) {
      const image = sharp(resolve(appRoot, target));
      const metadata = await image.metadata();
      const stats = await image.stats();
      expect(metadata.width).toBeGreaterThanOrEqual(48);
      expect(metadata.height).toBe(metadata.width);
      expect(stats.entropy).toBeGreaterThan(1);
      expect(stats.isOpaque).toBe(true);

      const corner = await image
        .extract({ left: 0, top: 0, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
      expect([...corner]).toEqual([25, 104, 58]);
    }
  });

  it("contains no old icon package or mood mascot references", async () => {
    const files = [
      ...(await sourceFiles(resolve(appRoot, "app"))),
      ...(await sourceFiles(resolve(appRoot, "src"))),
    ];
    const source = (
      await Promise.all(files.map((file) => readFile(file, "utf8")))
    ).join("\n");
    expect(source).not.toContain("MaterialCommunityIcons");
    expect(source).not.toContain("@expo/vector-icons");
    expect(source).not.toContain("MascotMood");
    expect(source).not.toContain("components/Mascot");
  });

  it("meets AA contrast for semantic text, actions, feedback, and focus", () => {
    const pairs = [
      [lightTheme.text, lightTheme.background],
      [lightTheme.textMuted, lightTheme.background],
      [lightTheme.textOnAction, lightTheme.action],
      [lightTheme.primary, lightTheme.primarySoft],
      [lightTheme.error, lightTheme.errorSoft],
      [lightTheme.warningText, lightTheme.warningSoft],
      [lightTheme.focus, lightTheme.surface],
      [darkTheme.text, darkTheme.background],
      [darkTheme.textMuted, darkTheme.background],
      [darkTheme.textOnAction, darkTheme.action],
      [darkTheme.error, darkTheme.errorSoft],
      [darkTheme.warningText, darkTheme.warningSoft],
      [darkTheme.focus, darkTheme.background],
    ] as const;
    for (const [foreground, background] of pairs) {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps preflight, manifest, native, and extension colors in sync", async () => {
    const [manifest, preflight, html, appConfig, nativeColors, extensionCss] =
      await Promise.all([
        readFile(resolve(appRoot, "public/site.webmanifest"), "utf8"),
        readFile(resolve(appRoot, "public/theme-preflight.js"), "utf8"),
        readFile(resolve(appRoot, "app/+html.tsx"), "utf8"),
        readFile(resolve(appRoot, "app.config.ts"), "utf8"),
        readFile(
          resolve(appRoot, "android/app/src/main/res/values/colors.xml"),
          "utf8",
        ),
        readFile(resolve(repoRoot, "apps/extension/src/popup.css"), "utf8"),
      ]);
    expect(manifest).toContain('"background_color": "#F7F9F4"');
    expect(manifest).toContain('"theme_color": "#247D49"');
    for (const source of [preflight, html, appConfig, nativeColors]) {
      expect(source).toContain("#F7F9F4");
    }
    expect(preflight).toContain("#101B15");
    expect(extensionCss).toContain("#f7f9f4");
    expect(extensionCss).toContain("#101b15");
    expect(extensionCss).toContain("#54c878");
  });
});
