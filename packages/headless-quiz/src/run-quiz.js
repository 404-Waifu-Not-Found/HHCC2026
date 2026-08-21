import {
  LOCAL_QUIZ_PROTOCOL_VERSION,
  LocalAnswerGradeSchema,
  LocalConceptQuizGenerationResultSchema,
  LocalConceptQuizQuestionChunkSchema,
  LocalGenerationCallEventSchema,
  LocalQuizContextSchema,
} from "@clipquest/contracts";
import {
  generateLocalQuiz,
  gradeLocalAnswerWithDeepSeek,
} from "@clipquest/local-quiz-engine";
import {
  acquireYouTubeSource,
  parseYouTubeVideoId,
} from "@clipquest/youtube-source";
import { createHash, randomUUID } from "node:crypto";
import { createHeadlessReporter } from "./reporter.js";

const SUPPORTED_QUESTION_TYPES = new Set([
  "multiple_choice",
  "true_false",
  "short_answer",
]);

function normalizedQuestionText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function questionFingerprint(question) {
  return createHash("sha256").update(JSON.stringify(question)).digest("hex");
}

function acceptedQuestionSummary(question) {
  return {
    id: question.id,
    type: question.type,
    concept: question.concept,
    question: question.question,
    ...(question.claimKey ? { claimKey: question.claimKey } : {}),
    ...(question.conceptCluster
      ? { conceptCluster: question.conceptCluster }
      : {}),
  };
}

function describeQuestion(reporter, question, index, provenance, audits) {
  reporter.line("");
  reporter.line(`QUESTION ${index + 1} — ${question.type.toUpperCase()}`);
  reporter.line(`Concept: ${question.concept}`);
  reporter.line(`Prompt: ${question.question}`);
  if (question.retryQuestion) {
    reporter.line(`Retry prompt: ${question.retryQuestion}`);
  }
  if (question.type === "multiple_choice") {
    for (
      let choiceIndex = 0;
      choiceIndex < question.choices.length;
      choiceIndex += 1
    ) {
      reporter.line(
        `${String.fromCharCode(65 + choiceIndex)}. ${question.choices[choiceIndex]}`,
      );
    }
    reporter.line(
      `Correct answer: ${String.fromCharCode(65 + question.answerIndex)}. ${question.answer}`,
    );
  } else if (question.type === "true_false") {
    reporter.line(`Correct answer: ${question.answer ? "True" : "False"}`);
    reporter.line(`Correction: ${question.correction}`);
  } else {
    reporter.line(`Reference answer: ${question.answer}`);
    reporter.line(`Rubric ideas: ${question.rubricIdeas.join(" | ")}`);
    if (question.shortAnswerMode) {
      reporter.line(`Short-answer mode: ${question.shortAnswerMode}`);
    }
  }
  reporter.line(`Explanation: ${question.explanation}`);
  reporter.line(
    `AI provenance: call=${provenance.callIndex} attempt=${provenance.ordinalAttempt} classification=${provenance.classification} fingerprint=${provenance.questionFingerprint}`,
  );
  reporter.line(
    `Quality audit: ${audits.map((audit) => `${audit.name}=${audit.status}`).join(" | ")}`,
  );
}

function auditQuestions(questions) {
  const promptCounts = new Map();
  for (const question of questions) {
    const normalized = normalizedQuestionText(question.question);
    promptCounts.set(normalized, (promptCounts.get(normalized) ?? 0) + 1);
  }
  return questions.map((question) => {
    const normalized = normalizedQuestionText(question.question);
    const unsupportedAbsolute =
      /\b(?:always|never|completely|entirely|all|none|only|must)\b/iu.test(
        question.question,
      );
    const fragmentary =
      question.question.split(/\s+/u).filter(Boolean).length < 4 ||
      (!question.question.endsWith("?") && question.type !== "true_false");
    return [
      { name: "production_validator", status: "PASS" },
      {
        name: "exact_duplicate",
        status: (promptCounts.get(normalized) ?? 0) === 1 ? "PASS" : "FAIL",
      },
      {
        name: "fragmentary_prompt",
        status: fragmentary ? "NOTICE" : "PASS",
      },
      {
        name: "absolute_wording",
        status: unsupportedAbsolute ? "NOTICE" : "PASS",
      },
      {
        name: "answer_prompt_consistency",
        status: "PASS_ENGINE",
      },
      ...(question.type === "true_false"
        ? [{ name: "true_false_polarity", status: "PASS_ENGINE" }]
        : []),
    ];
  });
}

function responseForQuestion(question) {
  if (question.type === "multiple_choice") return question.answer;
  if (question.type === "true_false") return question.answer ? "True" : "False";
  return question.answer;
}

function parseQuestionTypes(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "all")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
  const questionTypes = raw.includes("all")
    ? ["multiple_choice", "true_false", "short_answer"]
    : raw;
  if (
    questionTypes.length < 1 ||
    questionTypes.length > 3 ||
    new Set(questionTypes).size !== questionTypes.length ||
    questionTypes.some((type) => !SUPPORTED_QUESTION_TYPES.has(type))
  ) {
    throw new Error(
      "Question types must be a unique comma-separated selection of multiple_choice, true_false, and short_answer.",
    );
  }
  return questionTypes;
}

function createGenerationFetch({
  fetchImpl,
  interruptAfter,
  getAcceptedCount,
  reporter,
}) {
  let injected = false;
  return async (url, init) => {
    const isGenerationRequest =
      String(url) === "https://api.deepseek.com/chat/completions";
    if (
      isGenerationRequest &&
      !injected &&
      Number.isInteger(interruptAfter) &&
      interruptAfter >= 0 &&
      getAcceptedCount() >= interruptAfter
    ) {
      injected = true;
      reporter.event("FAULT_INJECTED", {
        afterAccepted: getAcceptedCount(),
        kind: "network_interrupted",
      });
      throw new TypeError("Injected headless DeepSeek network interruption.");
    }
    return fetchImpl(url, init);
  };
}

function proveAiProvenance(questions, callEvents) {
  return questions.map((question, index) => {
    const completed = callEvents.find(
      (event) =>
        event.lifecycleState === "completed" &&
        event.startIndex === index &&
        event.acceptedCount === 1 &&
        event.outcome === "complete",
    );
    if (!completed) {
      throw new Error(
        `Question ${index + 1} has no successful DeepSeek call provenance. Synthetic or fallback questions are forbidden.`,
      );
    }
    const started = callEvents.find(
      (event) =>
        event.lifecycleState === "started" &&
        event.generationSessionId === completed.generationSessionId &&
        event.callIndex === completed.callIndex,
    );
    if (!started) {
      throw new Error(
        `Question ${index + 1} has no matching DeepSeek call-start event.`,
      );
    }
    return {
      callIndex: completed.callIndex,
      ordinalAttempt: completed.ordinalAttempt,
      classification: completed.classification,
      questionFingerprint: questionFingerprint(question),
    };
  });
}

export async function runHeadlessQuiz(rawOptions) {
  const options = rawOptions ?? {};
  const reporter = options.reporter ?? createHeadlessReporter();
  const apiKey = String(options.apiKey ?? "").trim();
  if (!apiKey) {
    throw new Error(
      "Set CLIPQUEST_DEEPSEEK_API_KEY before running headless QA.",
    );
  }
  const questionCount = Number(options.questionCount ?? 10);
  if (![5, 10, 15].includes(questionCount)) {
    throw new Error("Question count must be exactly 5, 10, or 15.");
  }
  const questionTypes = parseQuestionTypes(options.questionTypes);
  const transport = options.transport ?? "native-json";
  if (!new Set(["native-json", "stream"]).has(transport)) {
    throw new Error("Transport must be native-json or stream.");
  }
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  reporter.line("CLIPQUEST HEADLESS QUIZ QA");
  reporter.event("SOURCE_STARTED", {
    videoId: options.source?.videoId ?? parseYouTubeVideoId(options.url),
  });
  const source =
    options.source ??
    (await acquireYouTubeSource(options.url, {
      preferredLanguage: options.preferredLanguage,
      // The injected fetch is also used for DeepSeek transport, but caption
      // acquisition must still prefer real local YouTube subtitle files.
      preferLocalTranscript: true,
      adapters: { fetch: fetchImpl },
    }));
  reporter.event("CAPTIONS_COMPLETE", {
    videoId: source.videoId,
    title: source.title,
    language: source.language,
    durationSeconds: source.durationSeconds,
    segmentCount: source.segments.length,
    sourceSegmentCount: source.sourceSegmentCount,
    characterCount: source.characterCount,
    transcriptFingerprint: source.transcriptFingerprint,
    acquisition: source.acquisition,
  });

  const context = LocalQuizContextSchema.parse({
    protocolVersion: LOCAL_QUIZ_PROTOCOL_VERSION,
    jobId: randomUUID(),
    generationId: randomUUID(),
    generationSessionId: randomUUID(),
    recoverySessionId: randomUUID(),
    generationProfile: "prompt_first_auto_v5_12",
    videoId: randomUUID(),
    title: source.title,
    quizLanguage: options.quizLanguage ?? "en",
    questionTypes,
    questionCount,
    transcriptFingerprint: source.transcriptFingerprint,
    transcriptLanguage: source.language,
    segments: source.segments,
  });
  reporter.event("PLAN_REQUESTED", {
    questionCount,
    questionTypes,
    transport,
    noFallback: true,
  });

  const chunks = [];
  const callEvents = [];
  const generationFetch = createGenerationFetch({
    fetchImpl,
    interruptAfter: options.interruptAfter,
    getAcceptedCount: () => chunks.length,
    reporter,
  });
  const generationResult = await generateLocalQuiz(
    context,
    apiKey,
    (stage, progress, detail) => {
      reporter.event("GENERATION_PROGRESS", {
        stage,
        progress: Number(progress.toFixed(3)),
        ...detail,
      });
    },
    options.signal,
    async (rawChunk) => {
      const chunk = LocalConceptQuizQuestionChunkSchema.parse(rawChunk);
      chunks.push(chunk);
      reporter.event("QUESTION_ACCEPTED", {
        ordinal: chunk.startIndex + 1,
        type: chunk.question.type,
        concept: chunk.question.concept,
        prompt: chunk.question.question,
      });
    },
    async (rawEvent) => {
      const event = LocalGenerationCallEventSchema.parse(rawEvent);
      callEvents.push(event);
      reporter.event(
        event.lifecycleState === "started"
          ? "AI_CALL_STARTED"
          : "AI_CALL_COMPLETED",
        {
          callIndex: event.callIndex,
          ordinal: event.startIndex + 1,
          ordinalAttempt: event.ordinalAttempt,
          classification: event.classification,
          retryKind: event.retryKind,
          outcome: event.outcome,
          acceptedCount: event.acceptedCount,
          retryDelayMs: event.retryDelayMs,
          callElapsedMs: event.elapsedMs,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          reasoningTokens: event.reasoningTokens,
        },
      );
    },
    {
      fetch: generationFetch,
      disableStreaming: transport === "native-json",
    },
  );
  const parsedResult =
    LocalConceptQuizGenerationResultSchema.parse(generationResult);
  const questions =
    "quiz" in parsedResult
      ? parsedResult.quiz.questions
      : chunks.map((chunk) => chunk.question);
  if (questions.length !== questionCount || chunks.length !== questionCount) {
    throw new Error(
      `Generation stopped at ${questions.length}/${questionCount}. Shortened quizzes are forbidden.`,
    );
  }
  const provenance = proveAiProvenance(questions, callEvents);
  const audits = auditQuestions(questions);
  if (
    audits.some((entries) => entries.some((entry) => entry.status === "FAIL"))
  ) {
    throw new Error("The completed quiz failed the headless quality audit.");
  }
  reporter.event("BANK_COMPLETE", {
    accepted: questions.length,
    requested: questionCount,
    aiCalls: parsedResult.metrics.aiCalls,
    retryCount: parsedResult.metrics.retryCount,
    generationElapsedMs: parsedResult.metrics.elapsedMs,
    promptVersion: parsedResult.promptVersion,
    validatorVersion: parsedResult.validatorVersion,
    userActionsRequired: 0,
  });
  questions.forEach((question, index) =>
    describeQuestion(
      reporter,
      question,
      index,
      provenance[index],
      audits[index],
    ),
  );

  const grades = [];
  if (options.answerAndGrade) {
    reporter.line("");
    reporter.line("ANSWER GRADING");
    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index];
      const response = responseForQuestion(question);
      reporter.event("GRADE_STARTED", {
        ordinal: index + 1,
        questionType: question.type,
        response,
      });
      const grade = LocalAnswerGradeSchema.parse(
        await gradeLocalAnswerWithDeepSeek(
          {
            question: question.question,
            response,
            questionType: question.type,
            referenceAnswer: response,
            ...(question.type === "multiple_choice"
              ? { options: question.choices }
              : {}),
            ...(question.type === "short_answer"
              ? {
                  requiredIdeas: question.rubricIdeas,
                  acceptableAlternatives: [
                    question.answer,
                    ...question.rubricIdeas,
                  ],
                }
              : {}),
            ...(question.type === "true_false" && question.correction
              ? { correction: question.correction }
              : {}),
          },
          apiKey,
          options.signal,
          { fetch: fetchImpl },
        ),
      );
      grades.push({ ordinal: index + 1, response, grade });
      reporter.event("GRADE_COMPLETED", {
        ordinal: index + 1,
        correct: grade.correct,
        confidence: grade.confidence,
        reason: grade.reason,
        matchedIdeas: grade.matchedIdeas,
        source: grade.source,
      });
      if (!grade.correct) {
        throw new Error(
          `The production grader rejected the stored correct answer for question ${index + 1}.`,
        );
      }
    }
  }

  return {
    runId: context.jobId,
    source,
    configuration: {
      questionCount,
      questionTypes,
      transport,
      answerAndGrade: options.answerAndGrade === true,
      interruptAfter: options.interruptAfter ?? null,
      noFallback: true,
    },
    generation: parsedResult,
    questions,
    provenance,
    audits,
    grades,
    events: reporter.events,
    reporter,
  };
}

export function summariesForContinuation(questions) {
  return questions.map(acceptedQuestionSummary);
}
