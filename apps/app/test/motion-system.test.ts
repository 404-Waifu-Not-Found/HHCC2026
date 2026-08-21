import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type MotionDefinition = {
  id: string;
  area: string;
  trigger: string;
  component: string;
  purpose: string;
  durationMs: number;
  easing: string;
  reducedMotion: string;
  location: string;
  status: "implemented";
};

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");

async function catalog(): Promise<MotionDefinition[]> {
  return JSON.parse(
    await readFile(resolve(appRoot, "src/motion/catalog.json"), "utf8"),
  );
}

describe("ClipQuest motion system", () => {
  it("documents at least 100 unique, implemented, meaningful motions", async () => {
    const definitions = await catalog();
    expect(definitions.length).toBeGreaterThanOrEqual(100);
    expect(new Set(definitions.map(({ id }) => id)).size).toBe(
      definitions.length,
    );

    for (const definition of definitions) {
      expect(definition.id).toMatch(/^[a-z0-9-]+$/);
      expect(definition.area.length).toBeGreaterThan(2);
      expect(definition.trigger.length).toBeGreaterThan(12);
      expect(definition.component.length).toBeGreaterThan(2);
      expect(definition.purpose.length).toBeGreaterThan(20);
      expect(definition.durationMs).toBeGreaterThan(0);
      expect(definition.easing.length).toBeGreaterThan(2);
      expect(definition.reducedMotion.length).toBeGreaterThan(12);
      expect(definition.location).toContain("apps/");
      expect(definition.status).toBe("implemented");
    }
  });

  it("covers every product motion area", async () => {
    const areas = new Set((await catalog()).map(({ area }) => area));
    expect([...areas]).toEqual(
      expect.arrayContaining([
        "Routes and continuity",
        "Navigation",
        "Buttons and controls",
        "Forms and validation",
        "Quiz interaction",
        "Quiz completion and progress",
        "Generation and asynchronous states",
        "Loading, empty, success, and error",
        "Lists, cards, and content reveals",
        "Dialogs, notifications, and overlays",
        "Brand and responsive behavior",
        "Extension popup",
        "Accessibility and motion governance",
      ]),
    );
  });

  it("uses transform-driven progress and explicit reduced-motion gates", async () => {
    const [motionSource, progressSource, settingsSource, extensionCss] =
      await Promise.all([
        readFile(resolve(appRoot, "src/motion/Motion.tsx"), "utf8"),
        readFile(resolve(appRoot, "src/components/ProgressBar.tsx"), "utf8"),
        readFile(
          resolve(appRoot, "src/providers/SettingsProvider.tsx"),
          "utf8",
        ),
        readFile(resolve(repoRoot, "apps/extension/src/popup.css"), "utf8"),
      ]);

    expect(motionSource).toContain("scaleX: value.value");
    expect(motionSource).toContain("<View {...viewProps}");
    expect(motionSource).toContain("state.pressed ? pressScale : 1");
    expect(motionSource).not.toContain(
      "Animated.createAnimatedComponent(Pressable)",
    );
    expect(motionSource).toContain("<Pressable");
    expect(progressSource).toContain("MotionProgressFill");
    expect(progressSource).not.toContain('transitionProperty: "width"');
    expect(settingsSource).toContain("isReduceMotionEnabled");
    expect(extensionCss).toContain("prefers-reduced-motion: reduce");
    expect(extensionCss).toContain("animation-duration: 0.01ms");
  });
});
