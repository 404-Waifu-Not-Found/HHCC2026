import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("shared quest route", () => {
  it("claims, starts through the ordinary quiz start endpoint, and sends signed-out learners to sign-in with next", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../app/s/[token].tsx"),
      "utf8",
    );
    expect(source).toContain("/api/shares/${encodeURIComponent(shareToken)}");
    expect(source).toContain(
      "/api/shares/${encodeURIComponent(shareToken)}/claim",
    );
    expect(source).toContain("/api/quizzes/${claim.quizId}/start");
    expect(source).toContain("...claim.startSettings");
    expect(source).toContain('testID="start-shared-quest"');
    expect(source).toContain('testID="sign-in-to-start"');
    expect(source).toContain("params: { next: `/s/${shareToken}` }");
    expect(source).not.toContain("cheat-sheet");
  });
});
