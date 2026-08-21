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
});
