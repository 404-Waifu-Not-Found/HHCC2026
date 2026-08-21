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

  it("does not claim Android captions are ready while prework is pending", () => {
    const creation = source("app/create/[videoId].tsx");
    const generation = source("app/generation/[videoId].tsx");

    expect(creation).toContain('androidCaptionState === "running"');
    expect(creation).toContain('t("sourceCaptionsPreparing")');
    expect(creation).toContain("loading={captionsPending}");
    expect(generation).toContain('"privateTranscriptionAndroid"');
    expect(generation).toContain('label: t("checkingCaptions")');
  });
});
