import { describe, expect, it, vi } from "vitest";
import type {
  LocalConceptQuizQuestion,
  QuizQuestionType,
  WorkplacePracticeSet,
} from "@clipquest/contracts";
import {
  classifyPracticeError,
  computePracticeScore,
  gradeLocalPracticeAnswer,
  isDiagnosticEligible,
  practiceSaveMode,
  PracticeSubmissionError,
  submitWorkplacePracticeAttempt,
  toAttemptAnswerValue,
  type PracticeApiRequest,
  type PracticeLocalAnswer,
} from "../src/workplace/practice-session";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const VIDEO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIDEO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function question(
  type: QuizQuestionType,
  index: number,
): LocalConceptQuizQuestion {
  const common = {
    id: `q${index + 1}`,
    concept: `Concept ${index + 1}`,
    question: `How does concept ${index + 1} work?`,
    explanation: `Concept ${index + 1} is explained here.`,
  };
  if (type === "multiple_choice") {
    return {
      ...common,
      type,
      choices: [
        `Correct ${index + 1}`,
        `Distractor A ${index + 1}`,
        `Distractor B ${index + 1}`,
        `Distractor C ${index + 1}`,
      ],
      answerIndex: 0,
      answer: `Correct ${index + 1}`,
    };
  }
  if (type === "true_false") {
    return {
      ...common,
      type,
      answer: index % 2 === 0,
      correction: "The statement is corrected here for clarity.",
    };
  }
  return {
    ...common,
    type,
    answer: `Canonical answer ${index + 1}`,
    rubricIdeas: [`Required idea ${index + 1}`],
    acceptableAnswers: [`Alias ${index + 1}`],
  };
}

function citation(videoId = VIDEO_A) {
  return {
    videoId,
    title: "Grounding clip",
    startMs: 1_000,
    endMs: 4_000,
    quote: "A grounded quote taken from the owned video transcript.",
  };
}

function practiceSet(
  overrides: Partial<WorkplacePracticeSet> = {},
): WorkplacePracticeSet {
  const types: QuizQuestionType[] = [
    "multiple_choice",
    "true_false",
    "short_answer",
    "multiple_choice",
    "true_false",
  ];
  return {
    questions: types.map((type, index) => question(type, index)),
    requestedPolicy: "practice",
    effectivePolicy: "practice",
    rationale: "Five questions grounded in your most recent uploads.",
    videoIds: [VIDEO_A],
    transcriptComplete: true,
    citations: [citation()],
    ...overrides,
  };
}

describe("policy detection and eligibility", () => {
  it("marks a single-video diagnostic as eligible and labelled diagnostic", () => {
    const set = practiceSet({
      requestedPolicy: "diagnostic",
      effectivePolicy: "diagnostic",
      videoIds: [VIDEO_A],
    });
    expect(isDiagnosticEligible(set)).toBe(true);
    expect(practiceSaveMode(set)).toBe("diagnostic");
  });

  it("downgrades a multi-video diagnostic to practice-only", () => {
    const set = practiceSet({
      requestedPolicy: "diagnostic",
      effectivePolicy: "diagnostic",
      videoIds: [VIDEO_A, VIDEO_B],
      citations: [citation(VIDEO_A), citation(VIDEO_B)],
    });
    expect(isDiagnosticEligible(set)).toBe(false);
    expect(practiceSaveMode(set)).toBe("practice");
  });

  it("keeps a practice-policy set as practice even on a single video", () => {
    const set = practiceSet({
      effectivePolicy: "practice",
      videoIds: [VIDEO_A],
    });
    expect(isDiagnosticEligible(set)).toBe(false);
    expect(practiceSaveMode(set)).toBe("practice");
  });
});

describe("local grading and score (inline rendering feedback)", () => {
  it("grades a multiple-choice answer against the stored index", () => {
    const mc = question("multiple_choice", 0);
    expect(gradeLocalPracticeAnswer(mc, 0, 0)).toMatchObject({
      correct: true,
      correctAnswer: 0,
      explanation: mc.explanation,
    });
    expect(gradeLocalPracticeAnswer(mc, 0, 2).correct).toBe(false);
  });

  it("grades a true/false answer by boolean equality", () => {
    const tf = question("true_false", 0); // answer === true
    expect(gradeLocalPracticeAnswer(tf, 1, true).correct).toBe(true);
    expect(gradeLocalPracticeAnswer(tf, 1, false).correct).toBe(false);
  });

  it("grades short answers with canonical/alias matching, ignoring case and spacing", () => {
    const sa = question("short_answer", 2);
    expect(
      gradeLocalPracticeAnswer(sa, 2, "  canonical   ANSWER 3 ").correct,
    ).toBe(true);
    expect(gradeLocalPracticeAnswer(sa, 2, "alias 3").correct).toBe(true);
    expect(gradeLocalPracticeAnswer(sa, 2, "totally wrong").correct).toBe(
      false,
    );
    expect(gradeLocalPracticeAnswer(sa, 2, "").correct).toBe(false);
  });

  it("computes a rounded percentage score", () => {
    const set = practiceSet();
    const grades = set.questions.map((q, index) =>
      gradeLocalPracticeAnswer(
        q,
        index,
        index < 3 ? correctAnswerFor(q) : "nope",
      ),
    );
    // 3 of 5 correct -> 60
    expect(computePracticeScore(grades)).toBe(60);
    expect(computePracticeScore([])).toBe(0);
  });
});

function correctAnswerFor(q: LocalConceptQuizQuestion): PracticeLocalAnswer {
  if (q.type === "multiple_choice") return q.answerIndex;
  if (q.type === "true_false") return q.answer;
  return q.answer;
}

describe("answer marshalling", () => {
  it("maps each question type to its AnswerValue and rejects mismatches", () => {
    const mc = question("multiple_choice", 0);
    const tf = question("true_false", 1);
    const sa = question("short_answer", 2);
    expect(toAttemptAnswerValue(mc, 1)).toBe(1);
    expect(toAttemptAnswerValue(tf, false)).toBe(false);
    expect(toAttemptAnswerValue(sa, "  My answer ")).toBe("My answer");
    expect(() => toAttemptAnswerValue(mc, "x")).toThrow(
      PracticeSubmissionError,
    );
    expect(() => toAttemptAnswerValue(tf, 3)).toThrow(PracticeSubmissionError);
    expect(() => toAttemptAnswerValue(sa, "   ")).toThrow(
      PracticeSubmissionError,
    );
  });
});

describe("error classification (abort and offline)", () => {
  it("classifies abort errors so the UI stays silent", () => {
    const abort = Object.assign(new Error("Aborted"), { name: "AbortError" });
    expect(classifyPracticeError(abort)).toBe("aborted");
  });

  it("classifies network/timeout failures as offline", () => {
    expect(
      classifyPracticeError(
        Object.assign(new Error("Network request failed"), {
          name: "TypeError",
        }),
      ),
    ).toBe("offline");
    expect(
      classifyPracticeError({ code: "request_timeout", status: 504 }),
    ).toBe("offline");
  });

  it("falls back to a generic error otherwise", () => {
    expect(classifyPracticeError(new Error("boom"))).toBe("error");
  });
});

type RecordedCall = { path: string; init: RequestInit };

function scriptedRequest(
  responses: Record<string, unknown[]>,
  calls: RecordedCall[],
): PracticeApiRequest {
  const counters: Record<string, number> = {};
  return (async (path: string, init: RequestInit) => {
    calls.push({ path, init });
    let key = "answer";
    if (path.includes("/practice-imports")) key = "import";
    else if (path.endsWith("/start")) key = "start";
    const bucket = responses[key]!;
    const index = counters[key] ?? 0;
    counters[key] = index + 1;
    return bucket[Math.min(index, bucket.length - 1)];
  }) as PracticeApiRequest;
}

describe("server submission via /api/quizzes", () => {
  it("imports with the Workplace thread link, starts an attempt, replays answers in order, and reports the server mastery decision", async () => {
    const set = practiceSet({
      requestedPolicy: "diagnostic",
      effectivePolicy: "diagnostic",
      videoIds: [VIDEO_A],
    });
    const answers: PracticeLocalAnswer[] = [
      0,
      true,
      "Canonical answer 3",
      0,
      true,
    ];
    const calls: RecordedCall[] = [];

    const publicQuestion = (position: number, isRetry: boolean) => ({
      id: `srv-question-${position}`,
      type: set.questions[position - 1]!.type,
      prompt: set.questions[position - 1]!.question,
      difficulty: 1,
      position,
      total: 5,
      isRetry,
    });

    // Question 2 serves one adaptive retry before advancing.
    const answerResponses = [
      {
        completed: false,
        nextQuestion: publicQuestion(2, false),
        score: null,
        mastery: null,
      },
      {
        completed: false,
        nextQuestion: publicQuestion(2, true),
        score: null,
        mastery: null,
      },
      {
        completed: false,
        nextQuestion: publicQuestion(3, false),
        score: null,
        mastery: null,
      },
      {
        completed: false,
        nextQuestion: publicQuestion(4, false),
        score: null,
        mastery: null,
      },
      {
        completed: false,
        nextQuestion: publicQuestion(5, false),
        score: null,
        mastery: null,
      },
      { completed: true, nextQuestion: null, score: 80, mastery: "proficient" },
    ];

    const request = scriptedRequest(
      {
        import: [
          { quizId: "quiz-1", messageId: "msg-1", affectsMastery: true },
        ],
        start: [
          {
            attemptId: "attempt-1",
            primer: null,
            question: publicQuestion(1, false),
            generation: { state: "ready" },
          },
        ],
        answer: answerResponses,
      },
      calls,
    );

    const outcome = await submitWorkplacePracticeAttempt({
      threadId: THREAD_ID,
      practiceSet: set,
      answers,
      deps: { request, createId: () => "00000000-0000-4000-8000-000000000000" },
    });

    expect(outcome).toMatchObject({
      quizId: "quiz-1",
      attemptId: "attempt-1",
      score: 80,
      affectsMastery: true,
      saveMode: "diagnostic",
    });

    const importCall = calls.find((call) =>
      call.path.includes("/practice-imports"),
    );
    expect(importCall).toBeDefined();
    expect(JSON.parse(importCall!.init.body as string)).toMatchObject({
      threadId: THREAD_ID,
    });
    expect(new Headers(importCall!.init.headers).get("Idempotency-Key")).toBe(
      "00000000-0000-4000-8000-000000000000",
    );

    const startCall = calls.find((call) => call.path.endsWith("/quiz-1/start"));
    expect(startCall).toBeDefined();
    expect(JSON.parse(startCall!.init.body as string)).toMatchObject({
      mode: "learn",
      sessionLength: "short",
    });

    const answerCalls = calls.filter((call) => call.path.endsWith("/answer"));
    // 5 questions + 1 retry on question 2 = 6 answer submissions.
    expect(answerCalls.length).toBe(6);
    // The retry (2nd answer call) resubmits the same position-2 answer.
    expect(JSON.parse(answerCalls[1]!.init.body as string).answer).toBe(
      answers[1],
    );
    // The last question submits the position-5 answer.
    expect(JSON.parse(answerCalls[5]!.init.body as string).answer).toBe(
      answers[4],
    );
  });

  it("never derives mastery locally: a practice-only import reports affectsMastery=false from the server", async () => {
    const set = practiceSet(); // practice policy, single video
    const answers: PracticeLocalAnswer[] = [
      0,
      true,
      "Canonical answer 3",
      0,
      true,
    ];
    const calls: RecordedCall[] = [];
    const request = scriptedRequest(
      {
        import: [
          { quizId: "quiz-2", messageId: "msg-2", affectsMastery: false },
        ],
        start: [
          {
            attemptId: "attempt-2",
            primer: null,
            question: {
              id: "srv-q1",
              type: "multiple_choice",
              prompt: "p",
              difficulty: 1,
              position: 1,
              total: 5,
              isRetry: false,
            },
            generation: { state: "ready" },
          },
        ],
        answer: [
          {
            completed: false,
            nextQuestion: {
              id: "srv-q2",
              type: "true_false",
              prompt: "p",
              difficulty: 1,
              position: 2,
              total: 5,
              isRetry: false,
            },
            score: null,
            mastery: null,
          },
          {
            completed: false,
            nextQuestion: {
              id: "srv-q3",
              type: "short_answer",
              prompt: "p",
              difficulty: 1,
              position: 3,
              total: 5,
              isRetry: false,
            },
            score: null,
            mastery: null,
          },
          {
            completed: false,
            nextQuestion: {
              id: "srv-q4",
              type: "multiple_choice",
              prompt: "p",
              difficulty: 1,
              position: 4,
              total: 5,
              isRetry: false,
            },
            score: null,
            mastery: null,
          },
          {
            completed: false,
            nextQuestion: {
              id: "srv-q5",
              type: "true_false",
              prompt: "p",
              difficulty: 1,
              position: 5,
              total: 5,
              isRetry: false,
            },
            score: null,
            mastery: null,
          },
          { completed: true, nextQuestion: null, score: 100, mastery: null },
        ],
      },
      calls,
    );

    const outcome = await submitWorkplacePracticeAttempt({
      threadId: THREAD_ID,
      practiceSet: set,
      answers,
      deps: { request, createId: () => "00000000-0000-4000-8000-000000000001" },
    });

    expect(outcome.affectsMastery).toBe(false);
    expect(outcome.saveMode).toBe("practice");
    expect(outcome.score).toBe(100);
  });

  it("aborts cleanly before any request when the signal is already aborted", async () => {
    const request = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      submitWorkplacePracticeAttempt({
        threadId: THREAD_ID,
        practiceSet: practiceSet(),
        answers: [0, true, "Canonical answer 3", 0, true],
        deps: {
          request: request as unknown as PracticeApiRequest,
          createId: () => "x",
        },
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(PracticeSubmissionError);
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects an incomplete answer set", async () => {
    await expect(
      submitWorkplacePracticeAttempt({
        threadId: THREAD_ID,
        practiceSet: practiceSet(),
        answers: [0, true],
        deps: {
          request: (() => Promise.resolve({})) as unknown as PracticeApiRequest,
          createId: () => "x",
        },
      }),
    ).rejects.toBeInstanceOf(PracticeSubmissionError);
  });
});
