import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("completion share action", () => {
  it("offers a share button that copies a quest link from the resumed quiz id", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../app/quiz/[attemptId].tsx"),
      "utf8",
    );
    expect(source).toContain('testID="share-quest"');
    expect(source).toContain("createQuizShareLink(shareQuizId)");
    expect(source).toContain(
      "if (resumed.quizId) setShareQuizId(resumed.quizId);",
    );
    expect(source).toContain('testID="share-quest-fallback"');
  });

  it("ships every share message in both locales", () => {
    const messages = readFileSync(
      resolve(import.meta.dirname, "../src/i18n/messages.ts"),
      "utf8",
    );
    for (const key of [
      "shareQuest",
      "shareLinkCopied",
      "shareLinkShared",
      "shareFailed",
      "shareCopyManually",
      "sharePreviewEyebrow",
      "sharedBy",
      "shareConceptsTitle",
      "watchLesson",
      "startSharedQuest",
      "signInToStart",
      "shareNotFoundTitle",
      "shareNotFoundBody",
      "shareLoadFailed",
      "shareLoadFailedBody",
      "shareClaimFailed",
      "languageChinese",
    ]) {
      expect(messages.match(new RegExp(`^\\s+${key}:`, "gm"))).toHaveLength(2);
    }
  });
});
