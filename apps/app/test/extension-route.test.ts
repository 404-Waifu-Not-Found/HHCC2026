import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { routeRequiresClipQuestExtension } from "../src/transcription/extension-route";

describe("ClipQuest extension route gate", () => {
  it("guards only extension-dependent learner routes", () => {
    expect(routeRequiresClipQuestExtension("/welcome")).toBe(true);
    expect(routeRequiresClipQuestExtension("/")).toBe(true);
    expect(routeRequiresClipQuestExtension("/create/video-id")).toBe(true);
    expect(routeRequiresClipQuestExtension("/generation/video-id")).toBe(true);

    expect(routeRequiresClipQuestExtension("/sign-in")).toBe(false);
    expect(routeRequiresClipQuestExtension("/sign-up")).toBe(false);
    expect(routeRequiresClipQuestExtension("/library")).toBe(false);
    expect(routeRequiresClipQuestExtension("/settings")).toBe(false);
    expect(routeRequiresClipQuestExtension("/quiz/attempt-id")).toBe(false);
  });

  it("does not open extension settings while web account cleanup runs", () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../src/generation/local-generation-client.web.ts",
      ),
      "utf8",
    );
    const removal = source.slice(
      source.indexOf("export async function removeLocalGenerationCredential"),
    );

    expect(removal).not.toContain("openClipQuestExtensionSettings()");
  });
});
