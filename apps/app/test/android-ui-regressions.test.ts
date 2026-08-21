import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");

function source(path: string) {
  return readFileSync(resolve(appRoot, path), "utf8");
}

describe("Android UI regressions", () => {
  it("keeps state-resolved control surfaces on the native Pressable", () => {
    const motion = source("src/motion/Motion.tsx");
    const button = source("src/components/PrimaryButton.tsx");

    expect(motion).not.toContain("createAnimatedComponent(Pressable)");
    expect(motion).toContain(
      'typeof style === "function" ? style(state) : style',
    );
    expect(button).toContain("backgroundColor: colors.background");
    expect(button).toContain("borderBottomColor: colors.depth");
  });

  it("renders reduced-motion route content without an entrance animation", () => {
    const motion = source("src/motion/Motion.tsx");
    const rootLayout = source("app/_layout.tsx");
    const tabLayout = source("app/(tabs)/_layout.tsx");

    expect(motion).toContain("if (reduceMotion)");
    expect(motion).toContain(
      "<View {...viewProps} testID={testID} style={style}>",
    );
    for (const layout of [rootLayout, tabLayout]) {
      expect(layout).toContain(
        'Platform.OS === "web" && !reduceMotion ? "fade" : "none"',
      );
    }
  });

  it("presents verification actions as a visible composed surface", () => {
    const verification = source("app/(auth)/verify-email.tsx");

    expect(verification).toContain(
      "<Surface elevated style={styles.actionCard}>",
    );
    expect(verification).toContain(
      'onPress={() => router.replace("/(auth)/sign-in")}',
    );
    expect(verification).toContain('variant="ghost"');
  });

  it("does not claim native captions are ready while prework is pending", () => {
    const creation = source("app/create/[videoId].tsx");
    const generation = source("app/generation/[videoId].tsx");
    const localClient = source(
      "src/generation/local-generation-client.android.ts",
    );

    expect(creation).toContain('nativeCaptionState === "running"');
    expect(creation).toContain('t("sourceCaptionsPreparing")');
    expect(creation).toContain("loading={captionsPending}");
    expect(creation).toContain(
      "The local-client probe is diagnostic. It may wait on native",
    );
    expect(generation).toContain('"privateTranscriptionAndroid"');
    expect(generation).toContain('label: t("checkingCaptions")');
    expect(localClient).toContain("disableStreaming: true");
  });

  it("never calls browser focus listeners from a native quiz", () => {
    const quiz = source("app/quiz/[attemptId].tsx");

    expect(quiz).toContain('if (Platform.OS === "web")');
    expect(quiz).not.toContain('typeof window !== "undefined"');
  });

  it("stacks the three live completion stats on compact phones", () => {
    const quiz = source("app/quiz/[attemptId].tsx");

    expect(quiz).toContain("showCompactCompletionStats");
    expect(quiz).toContain("styles.statsCompact");
    expect(quiz).toContain("styles.statItemCompact");
  });

  it("keeps the compact tab bar quiet and defaults new installs to reduced motion", () => {
    const tabs = source("app/(tabs)/_layout.tsx");
    const settings = source("src/providers/SettingsProvider.tsx");

    expect(tabs).toContain("borderTopWidth: 0");
    expect(tabs).toContain("borderRadius: radii.medium");
    expect(settings).toContain("useState(true)");
    expect(settings).toContain('typeof parsed.reduceMotion === "boolean"');
  });
});
