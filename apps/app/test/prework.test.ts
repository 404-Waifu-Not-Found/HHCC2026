import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireTextTranscript: vi.fn(),
  clearImportedVideo: vi.fn(),
  loadGenerationRecord: vi.fn(),
  saveImportedVideo: vi.fn(),
  updateGenerationRecord: vi.fn(),
}));

vi.mock("../src/state/creation", () => ({
  clearImportedVideo: mocks.clearImportedVideo,
  loadGenerationRecord: mocks.loadGenerationRecord,
  saveImportedVideo: mocks.saveImportedVideo,
  updateGenerationRecord: mocks.updateGenerationRecord,
}));

vi.mock("../src/transcription/acquire-text-transcript", () => ({
  acquireTextTranscript: mocks.acquireTextTranscript,
}));

import {
  cancelPreGenerationForAccount,
  preGenerateImportedQuiz,
} from "../src/generation/prework";

const imported = {
  video: {
    id: "11111111-1111-4111-8111-111111111111",
    durationSeconds: 120,
  },
  captions: { available: true },
  capture: { expectedDurationSeconds: 120 },
  requiresLocalTranscription: false,
};

const input = {
  ownerUserId: "owner-one",
  generationId: "22222222-2222-4222-8222-222222222222",
  quizLanguage: "en" as const,
  questionTypes: ["multiple_choice" as const],
};

const transcript = {
  verifiedDurationSeconds: 120,
  language: "en",
  segments: [{ startMs: 0, endMs: 1_000, text: "A concept." }],
  completeness: {
    sourceSegmentCount: 1,
    characterCount: 10,
  },
};

describe("native caption prework lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadGenerationRecord.mockResolvedValue({
      ownerUserId: input.ownerUserId,
    });
    mocks.updateGenerationRecord.mockResolvedValue({
      ownerUserId: input.ownerUserId,
    });
  });

  it("cancels an active account task before it can cache captions", async () => {
    mocks.acquireTextTranscript.mockImplementation(
      (_imported, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );

    const pending = preGenerateImportedQuiz(imported as never, input);
    await vi.waitFor(() =>
      expect(mocks.acquireTextTranscript).toHaveBeenCalledOnce(),
    );
    cancelPreGenerationForAccount(input.ownerUserId);
    await pending;

    expect(mocks.saveImportedVideo).not.toHaveBeenCalled();
    expect(mocks.updateGenerationRecord).not.toHaveBeenCalled();
  });

  it("removes a cache write that finishes after account cancellation", async () => {
    let finishSave: (() => void) | undefined;
    mocks.acquireTextTranscript.mockResolvedValue(transcript);
    mocks.saveImportedVideo.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    const pending = preGenerateImportedQuiz(imported as never, input);
    await vi.waitFor(() => expect(mocks.saveImportedVideo).toHaveBeenCalled());
    cancelPreGenerationForAccount(input.ownerUserId);
    finishSave?.();
    await pending;

    expect(mocks.clearImportedVideo).toHaveBeenCalledWith(
      input.ownerUserId,
      imported.video.id,
    );
    expect(mocks.updateGenerationRecord).not.toHaveBeenCalled();
  });
});
