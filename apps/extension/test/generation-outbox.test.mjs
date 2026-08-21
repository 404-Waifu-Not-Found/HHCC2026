import assert from "node:assert/strict";
import test from "node:test";
import { replayGenerationOutboxEntries } from "../src/generation-outbox.js";

const OLD_RECOVERY = "11111111-1111-4111-8111-111111111111";
const NEW_RECOVERY = "22222222-2222-4222-8222-222222222222";

function context(overrides = {}) {
  return {
    generationProfile: "stable_auto_recovery_v5_3",
    generationId: "33333333-3333-4333-8333-333333333333",
    generationSessionId: "44444444-4444-4444-8444-444444444444",
    recoverySessionId: NEW_RECOVERY,
    questionCount: 5,
    continuation: {
      startIndex: 1,
      nextCallIndex: 1,
      nextOrdinalAttempt: 1,
      automaticRetryCount: 0,
      acceptedQuestions: [
        {
          id: "q1",
          type: "multiple_choice",
          concept: "first",
          question: "First prompt?",
        },
      ],
      ...overrides,
    },
  };
}

function questionEntry(sequence, startIndex) {
  return {
    sequence,
    message: {
      type: "question",
      requestId: "old-request",
      result: {
        recoverySessionId: OLD_RECOVERY,
        startIndex,
        question: {
          id: `q${startIndex + 1}`,
          type: "multiple_choice",
          concept: `concept ${startIndex + 1}`,
          question: `Distinct prompt ${startIndex + 1}?`,
        },
      },
    },
  };
}

function callEntry(sequence, callIndex, startIndex, outcome = "complete") {
  return {
    sequence,
    message: {
      type: "call",
      requestId: "old-request",
      event: {
        protocolVersion: 7,
        generationSessionId: "44444444-4444-4444-8444-444444444444",
        recoverySessionId: OLD_RECOVERY,
        callIndex,
        startIndex,
        ordinalAttempt: 1,
        requestedCount: 1,
        acceptedCount: outcome === "complete" ? 1 : 0,
        classification: "primary",
        outcome,
        retryDelayMs: 0,
        elapsedMs: 20,
        usageComplete: false,
      },
    },
  };
}

function lifecycleEntry(
  sequence,
  lifecycleState,
  callIndex,
  startIndex,
  overrides = {},
) {
  const terminal = lifecycleState !== "started";
  return {
    sequence,
    message: {
      type: "call",
      requestId: "old-request",
      event: {
        protocolVersion: 9,
        purpose: "generation",
        lifecycleState,
        generationSessionId: "44444444-4444-4444-8444-444444444444",
        recoverySessionId: OLD_RECOVERY,
        callIndex,
        startIndex,
        ordinalAttempt: 2,
        requestedCount: 1,
        acceptedCount: terminal ? 1 : 0,
        classification: "automatic_retry",
        retryKind: "duplicate_repair",
        retryDelayMs: 0,
        usageComplete: false,
        ...(terminal ? { outcome: "complete", elapsedMs: 20 } : {}),
        ...overrides,
      },
    },
  };
}

test("outbox replay drops stored prefixes and resumes the exact missing frontier", () => {
  const posted = [];
  const replay = replayGenerationOutboxEntries(
    context(),
    [
      questionEntry(0, 0),
      callEntry(1, 0, 0),
      questionEntry(2, 1),
      callEntry(3, 1, 1),
      questionEntry(4, 2),
      callEntry(5, 2, 2),
    ],
    "new-request",
    (message) => posted.push(message),
  );

  assert.deepEqual(
    posted.map((message) =>
      message.type === "question"
        ? `q${message.result.startIndex + 1}`
        : `call${message.event.callIndex}`,
    ),
    ["q2", "call1", "q3", "call2"],
  );
  assert.ok(
    posted.every(
      (message) =>
        (message.result ?? message.event).recoverySessionId === NEW_RECOVERY,
    ),
  );
  assert.equal(replay.context.continuation.startIndex, 3);
  assert.equal(replay.context.continuation.nextCallIndex, 3);
  assert.equal(replay.context.continuation.acceptedQuestions.length, 3);
  assert.equal(replay.completed, false);
});

test("a disconnected failed call becomes one truthful automatic-resume retry", () => {
  const posted = [];
  const replay = replayGenerationOutboxEntries(
    context(),
    [callEntry(0, 1, 1, "local_state_conflict")],
    "new-request",
    (message) => posted.push(message),
  );

  assert.equal(posted.length, 1);
  assert.equal(replay.context.continuation.nextCallIndex, 2);
  assert.equal(replay.context.continuation.nextOrdinalAttempt, 2);
  assert.equal(replay.context.continuation.retryKind, "automatic_resume");
  assert.equal(replay.context.continuation.automaticRetryCount, 0);
});

test("protocol-9 replay rebases a buffered lifecycle on the authoritative failed call", () => {
  const posted = [];
  const replay = replayGenerationOutboxEntries(
    context({
      nextCallIndex: 2,
      nextOrdinalAttempt: 2,
      retryKind: "transport",
      previousOutcome: "network_interrupted",
      retryOrdinals: [2],
    }),
    [
      lifecycleEntry(0, "started", 2, 1),
      questionEntry(1, 1),
      lifecycleEntry(2, "completed", 2, 1),
    ],
    "new-request",
    (message) => posted.push(message),
  );

  assert.deepEqual(
    posted.map((message) =>
      message.type === "question"
        ? "question"
        : `${message.event.lifecycleState}:${message.event.retryKind}`,
    ),
    ["started:transport", "question", "completed:transport"],
  );
  assert.equal(replay.context.continuation.startIndex, 2);
  assert.equal(replay.context.continuation.nextCallIndex, 3);
  assert.equal(replay.context.continuation.nextOrdinalAttempt, 1);
  assert.equal(replay.context.continuation.retryKind, undefined);
  assert.equal(replay.context.continuation.automaticRetryCount, 1);
  assert.ok(
    posted.every(
      (message) =>
        (message.result ?? message.event).recoverySessionId === NEW_RECOVERY,
    ),
  );
});

test("protocol-9 replay abandons a started-only call before continuing", () => {
  const posted = [];
  const replay = replayGenerationOutboxEntries(
    context({
      nextCallIndex: 2,
      nextOrdinalAttempt: 2,
      retryKind: "transport",
      previousOutcome: "network_interrupted",
      retryOrdinals: [2],
    }),
    [lifecycleEntry(0, "started", 2, 1)],
    "new-request",
    (message) => posted.push(message),
  );

  assert.deepEqual(
    posted.map((message) => ({
      lifecycleState: message.event.lifecycleState,
      outcome: message.event.outcome,
      retryKind: message.event.retryKind,
      acceptedCount: message.event.acceptedCount,
    })),
    [
      {
        lifecycleState: "started",
        outcome: undefined,
        retryKind: "transport",
        acceptedCount: 0,
      },
      {
        lifecycleState: "abandoned",
        outcome: "network_interrupted",
        retryKind: "transport",
        acceptedCount: 0,
      },
    ],
  );
  assert.equal(replay.context.continuation.nextCallIndex, 3);
  assert.equal(replay.context.continuation.nextOrdinalAttempt, 3);
  assert.equal(replay.context.continuation.retryKind, "automatic_resume");
  assert.equal(replay.context.continuation.automaticRetryCount, 1);
});

test("a complete buffered suffix replays its result only after every question and call", () => {
  const posted = [];
  const entries = [];
  let sequence = 0;
  for (let startIndex = 1; startIndex < 5; startIndex += 1) {
    entries.push(questionEntry(sequence++, startIndex));
    entries.push(callEntry(sequence++, startIndex, startIndex));
  }
  entries.push({
    sequence,
    message: {
      type: "result",
      requestId: "old-request",
      response: { ok: true, result: { totalQuestions: 5 } },
    },
  });

  const replay = replayGenerationOutboxEntries(
    context(),
    entries,
    "new-request",
    (message) => posted.push(message),
  );
  assert.equal(replay.completed, true);
  assert.equal(posted.at(-1).type, "result");
  assert.equal(posted.at(-1).requestId, "new-request");
  assert.equal(posted.length, 9);
});
