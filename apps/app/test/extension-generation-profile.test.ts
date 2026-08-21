import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MINIMUM_LEGACY_LOCAL_AI_EXTENSION_VERSION,
  MINIMUM_LOCAL_AI_EXTENSION_VERSION,
  isCompatibleClipQuestExtensionVersion,
  supportsQuestionStream,
} from "../src/transcription/extension-compat";

describe("extension generation profile compatibility", () => {
  it("keeps the disabled rollout compatible with v0.8.0 and stream v1", () => {
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.0",
        MINIMUM_LEGACY_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(true);
    expect(
      supportsQuestionStream(["question-stream-v1"], "legacy_reasoning_v5_1"),
    ).toBe(true);
  });

  it("keeps v0.8.2 and stream v2 available only for the v5.2 compatibility profile", () => {
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.1",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      supportsQuestionStream(
        ["question-stream-v1"],
        "stable_non_thinking_v5_2",
      ),
    ).toBe(false);
    expect(
      supportsQuestionStream(
        ["question-stream-v1", "question-stream-v2"],
        "stable_non_thinking_v5_2",
      ),
    ).toBe(true);
  });

  it("requires v0.8.3 and stream v3 for automatic recovery", () => {
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.2",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      supportsQuestionStream(
        ["question-stream-v2"],
        "stable_auto_recovery_v5_3",
      ),
    ).toBe(false);
    expect(
      supportsQuestionStream(
        ["question-stream-v2", "question-stream-v3"],
        "stable_auto_recovery_v5_3",
      ),
    ).toBe(true);
  });

  it("requires v0.8.17 and stream v7 for current prompt-first generation", () => {
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.3",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.5",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.6",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.7",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.13",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.14",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.15",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.16",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(false);
    expect(
      isCompatibleClipQuestExtensionVersion(
        "0.8.17",
        MINIMUM_LOCAL_AI_EXTENSION_VERSION,
      ),
    ).toBe(true);
    expect(supportsQuestionStream(["question-stream-v6"])).toBe(false);
    expect(
      supportsQuestionStream(["question-stream-v6", "question-stream-v7"]),
    ).toBe(true);
    expect(
      supportsQuestionStream(["question-stream-v7"], "prompt_first_auto_v5_10"),
    ).toBe(true);
    expect(
      supportsQuestionStream(["question-stream-v7"], "prompt_first_auto_v5_11"),
    ).toBe(true);
    expect(
      supportsQuestionStream(["question-stream-v7"], "prompt_first_auto_v5_12"),
    ).toBe(true);
    expect(
      supportsQuestionStream(["question-stream-v6"], "concept_first_auto_v5_8"),
    ).toBe(true);
    expect(
      supportsQuestionStream(
        ["question-stream-v5"],
        "evidence_grounded_auto_v5_4",
      ),
    ).toBe(true);
  });

  it("contains no learner-facing manual generation continuation control", () => {
    const files = [
      "../src/components/QuestionStreamIndicator.tsx",
      "../app/quiz/[attemptId].tsx",
      "../app/generation/[videoId].tsx",
    ].map((relativePath) =>
      readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), relativePath),
        "utf8",
      ),
    );
    for (const source of files) {
      expect(source).not.toMatch(/Continue generating/i);
      expect(source).not.toMatch(/Automatic(?:ally)? repair/i);
      expect(source).not.toMatch(/onContinue/);
      expect(source).not.toMatch(/continuingGeneration/);
    }
  });

  it("lets a newly configured native client resume an action-required quiz", () => {
    const recovery = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../src/generation/progressive-continuation.ts",
      ),
      "utf8",
    );
    const quiz = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../app/quiz/[attemptId].tsx",
      ),
      "utf8",
    );
    const indicator = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../src/components/QuestionStreamIndicator.tsx",
      ),
      "utf8",
    );
    expect(recovery).toContain(
      'status.generation.state === "action_required" &&\n      !options.allowActionRequired',
    );
    expect(quiz).toContain("allowActionRequired: true");
    expect(indicator).toContain('"Open Local AI settings"');
    expect(indicator).toContain('"打开本地 AI 设置"');
  });

  it("latches terminal automatic recovery instead of reclaiming forever", () => {
    const recovery = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../src/generation/progressive-continuation.ts",
      ),
      "utf8",
    );
    const quiz = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../app/quiz/[attemptId].tsx",
      ),
      "utf8",
    );
    expect(recovery).toContain("terminalAutomaticRecoveryAttempts");
    expect(recovery).toContain("persistedRecoveryExhausted");
    expect(recovery).toContain("reportedRecoveryExhausted");
    expect(recovery).toContain(
      "(persistedRecoveryExhausted && !options.force)",
    );
    expect(recovery).toContain("isLeaseConflict(error) && !options.force");
    expect(recovery).toContain("options.force");
    expect(quiz).toContain(
      "ensureProgressiveAttemptRecovery(attemptId, { force: true })",
    );
    expect(quiz).toContain("current.retryAvailable === next.retryAvailable");
  });

  it("keeps first-question admission independent from call telemetry", () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../app/generation/[videoId].tsx",
      ),
      "utf8",
    );
    expect(source).toContain("let questionIngestion = Promise.resolve()");
    expect(source).toContain("let callIngestion = Promise.resolve()");
    expect(source).toContain(
      "const pendingCallEvents: LocalGenerationCallEvent[] = []",
    );
    expect(source).not.toContain("pendingStartedCall");
    expect(source).toContain(
      "The Worker event is authoritative. Losing the best-effort browser",
    );
    expect(source).toContain(
      "A conflicting progress snapshot must never poison the",
    );
    expect(source).toContain(").catch(() => undefined);");
    expect(source).toContain(
      "if (!attemptId) await startAttempt(response.quizId)",
    );
    const admissionBlock = source.slice(
      source.indexOf("lastProgressKey = undefined"),
      source.indexOf("void questionIngestion.catch"),
    );
    expect(
      admissionBlock.indexOf("startAttempt(response.quizId)"),
    ).toBeLessThan(admissionBlock.indexOf("schedulePendingCallFlush()"));
    expect(source).toContain("The local engine must not wait for diagnostics");
    expect(source).toContain("await questionIngestion;");
    expect(source).toContain('scope: "generation_call_telemetry"');
  });

  it("keeps recovery question ingestion independent from call telemetry", () => {
    const recovery = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../src/generation/progressive-continuation.ts",
      ),
      "utf8",
    );
    expect(recovery).toContain("let callIngestion = Promise.resolve()");
    expect(recovery).toContain("return Promise.resolve();");
    expect(recovery).toContain('scope: "generation_call_telemetry"');
    expect(recovery).toContain("await ingestion;");
    expect(recovery).toContain(
      "await Promise.allSettled([ingestion, callIngestion])",
    );
  });

  it("treats an accepted extension progress heartbeat as dispatch proof", () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../src/transcription/clipquest-extension.ts",
      ),
      "utf8",
    );
    expect(source).toContain("if (dispatchTimeout)");
    expect(source).toContain("authoritative proof that the handoff succeeded");
  });

  it("shows retry ETA only while question one is still missing", () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../app/generation/[videoId].tsx",
      ),
      "utf8",
    );
    expect(source).toContain("if (!attemptId && detail.retryOrdinal === 1)");
  });

  it("reacquires safe video metadata when the local import cache is gone", () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../src/generation/progressive-continuation.ts",
      ),
      "utf8",
    );
    expect(source).toContain(
      "/api/videos/${encodeURIComponent(continuation.videoId)}/recovery",
    );
    expect(source).toContain("saveImportedVideo(session.user.id, imported)");
  });
});
