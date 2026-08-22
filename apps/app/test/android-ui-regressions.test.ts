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

  it("keeps caption gating without showing a warning card", () => {
    const creation = source("app/create/[videoId].tsx");
    const generation = source("app/generation/[videoId].tsx");
    const localClient = source(
      "src/generation/local-generation-client.android.ts",
    );

    expect(creation).toContain('nativeCaptionState === "running"');
    expect(creation).toContain("loading={captionsPending}");
    expect(creation).toContain("disabled={captionsBlocked}");
    expect(creation).not.toContain("captionStatus");
    expect(creation).not.toContain("sourceCaptionsUnavailable");
    expect(creation).toContain(
      "The local-client probe is diagnostic. It may wait on native",
    );
    expect(generation).toContain('"captionPrivacyNative"');
    expect(generation).toContain('label: t("checkingCaptions")');
    expect(localClient).toContain("globalThis.fetch.bind(globalThis)");
    expect(localClient).toContain("createLocalCrypto([");
    expect(localClient).not.toContain("requireNativeModule");
    expect(localClient).not.toContain("nativeExpoCrypto");
    expect(localClient).not.toContain("import * as ExpoCrypto");
    expect(localClient).toContain("disableStreaming: true");
  });

  it("assumes the learner watched the video on every shared client", () => {
    const creation = source("app/create/[videoId].tsx");
    const generation = source("app/generation/[videoId].tsx");

    expect(creation).not.toContain("watchedQuestion");
    expect(creation).not.toContain("setWatched");
    expect(creation).toContain("watched: true");
    expect(generation).not.toContain("params.watched");
    expect(generation).toContain("{ watched: true }");
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

  it("keeps a compact quiz feedback action visible beside long explanations", () => {
    const feedback = source("src/components/FeedbackPanel.tsx");

    expect(feedback).toContain(
      "const compactMaxHeight = Math.round(height * 0.46)",
    );
    expect(feedback).toContain("<ScrollView");
    expect(feedback).toContain("compact && { maxHeight: compactMaxHeight }");
    expect(feedback).toContain("compact && styles.actionCompact");
  });

  it("keeps the compact tab bar quiet and defaults new installs to reduced motion", () => {
    const tabs = source("app/(tabs)/_layout.tsx");
    const settings = source("src/providers/SettingsProvider.tsx");

    expect(tabs).toContain("borderTopWidth: 0");
    expect(tabs).toContain("borderRadius: radii.medium");
    expect(settings).toContain("useState(true)");
    expect(settings).toContain('typeof parsed.reduceMotion === "boolean"');
  });

  it("shows learner identity and progress at the bottom of the desktop sidebar", () => {
    const tabs = source("app/(tabs)/_layout.tsx");

    expect(tabs).toContain("<ProfileAvatar name={user.name}");
    expect(tabs).toContain("{user.email}");
    expect(tabs).toContain('t("completedLessons")');
    expect(tabs).toContain('t("totalDuration")');
    expect(tabs).toContain('"/api/profile/stats"');
    expect(tabs).toContain("{desktop ? (");
  });

  it("uses an ordered full-width card stack on compact Home layouts", () => {
    const home = source("app/(tabs)/index.tsx");

    expect(home).toContain("compact ? styles.cardStack : styles.cardRow");
    expect(home).toContain("styles.cardStackItem");
    expect(home).toContain("compact={compact}");
  });

  it("keeps card navigation and notes controls out of the card footer", () => {
    const videoCard = source("src/components/VideoCard.tsx");

    expect(videoCard).toContain('accessibilityRole="button"');
    expect(videoCard).toContain("styles.main");
    expect(videoCard).toContain("styles.actions");
    expect(videoCard).toContain("styles.actionsWithScore");
    expect(videoCard).toContain("styles.actionsWithStatus");
    expect(videoCard).toContain("fill && styles.mainFill");
    expect(videoCard).toContain("mainFill: {\n    flex: 1,");
    expect(videoCard).toContain("paddingRight: spacing[16] + spacing[5]");
    expect(videoCard).toContain("width: 32");
    expect(videoCard).toContain("height: 32");
    expect(videoCard).toContain('name="next" size={18}');
    expect(videoCard).toContain("accessibilityLabel={");
    expect(videoCard).toContain("card.cheatSheet.status");
    expect(videoCard).toContain("onGenerateNotes");
    expect(videoCard).toContain("theme.surfaceTint");
    expect(videoCard).toContain("backgroundColor: theme.surfaceRaised");
    expect(videoCard).toContain("color: theme.text");
    expect(videoCard).toContain(
      'transitionProperty: "transform, background-color, border-color"',
    );
    expect(videoCard).not.toContain("styles.actionRow");
    expect(videoCard).not.toContain("event.stopPropagation()");
    expect(videoCard).not.toContain("onPress={() => undefined}");
  });

  it("fills desktop library cards so horizontal metadata remains visible", () => {
    const library = source("app/(tabs)/library.tsx");

    expect(library).toContain(
      "<VideoCard\n              compact={compact}\n              fill",
    );
  });

  it("keeps an explicit PDF action on the quiz completion screen", () => {
    const quiz = readFileSync(
      resolve(appRoot, "app/quiz/[attemptId].tsx"),
      "utf8",
    );
    expect(quiz).toContain('testID="download-cheat-sheet-pdf"');
    expect(quiz).toContain('t("downloadPdf")');
    expect(quiz).toContain('t("preparingPdf")');
    expect(quiz).toContain('t("retryPdf")');
  });

  it("uses score-based, color-coded mastery ranks everywhere", () => {
    const contracts = source("../../packages/contracts/src/index.ts");
    const badge = source("src/components/MasteryBadge.tsx");
    const videoCard = source("src/components/VideoCard.tsx");
    const quiz = source("app/quiz/[attemptId].tsx");

    expect(contracts).toContain('"basic"');
    expect(contracts).toContain('"intermediate"');
    expect(contracts).toContain('"expert"');
    expect(contracts).toContain('if (score >= 100) return "mastered"');
    expect(badge).toContain("theme.errorSoft");
    expect(badge).toContain("theme.warningSoft");
    expect(badge).toContain("theme.secondarySoft");
    expect(badge).toContain("theme.successSoft");
    expect(videoCard).toContain(
      "<MasteryBadge state={card.mastery} compact />",
    );
    expect(videoCard).toContain("<ProgressBar");
    expect(videoCard).toContain("fillColor={masteryColor}");
    expect(videoCard).toContain("styles.scoreBar");
    expect(quiz).toContain("masteryStateForScore(score)");
    expect(quiz).not.toContain('t("learning")');
  });

  it("omits empty AI sections from exported cheat sheets", () => {
    const cheatSheet = source("src/lib/cheat-sheet.ts");

    expect(cheatSheet).toContain("if (section[1].length === 0) continue;");
  });
});
