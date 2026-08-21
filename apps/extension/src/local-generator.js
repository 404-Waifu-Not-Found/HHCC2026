import { captionsToPlainText } from "./caption-text.js";

const MODEL = "deepseek-v4-flash";
const TOOL_NAME = "submit_quiz";
const PROTOCOL_VERSION = 3;
const PIPELINE_VERSION = 7;
const PROMPT_VERSION = "quiz-local-tool-v2.0";
const VALIDATOR_VERSION = "validator-local-tool-v2.0";
const REQUEST_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_TRANSCRIPT_CHARACTERS = 320_000;
const GENERATION_OUTPUT_TOKENS = 48_000;
const MAX_GENERATION_ATTEMPTS = 3;
const SUPPORTED_QUESTION_TYPES = [
  "multiple_choice",
  "true_false",
  "short_answer",
];

class TerminalGenerationError extends Error {}

function strictJson(text, operation) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${operation} returned malformed JSON. No quiz was created.`,
    );
  }
}

function nonEmptyString(value, maximumLength = Number.POSITIVE_INFINITY) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength
  );
}

function normalize(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function quizTool(questionCount) {
  const commonProperties = {
    id: {
      type: "string",
      description: "Sequential id: q1, q2, q3, and so on.",
    },
    concept: {
      type: "string",
      description: "The exact lesson concept being tested.",
    },
    question: {
      type: "string",
      description: "A complete, self-contained question or statement.",
    },
    explanation: {
      type: "string",
      description:
        "A concise explanation grounded only in the supplied lesson text.",
    },
  };
  return {
    type: "function",
    function: {
      name: TOOL_NAME,
      description:
        "Return the complete concept quiz in one JSON function call. Do not omit any question.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["title", "questions"],
        properties: {
          title: {
            type: "string",
            description: "A concise title for this specific quiz.",
          },
          questions: {
            type: "array",
            minItems: questionCount,
            maxItems: questionCount,
            description: `Exactly ${questionCount} questions returned together.`,
            items: {
              oneOf: [
                {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id",
                    "type",
                    "concept",
                    "question",
                    "choices",
                    "answerIndex",
                    "answer",
                    "explanation",
                  ],
                  properties: {
                    ...commonProperties,
                    type: { type: "string", enum: ["multiple_choice"] },
                    choices: {
                      type: "array",
                      minItems: 4,
                      maxItems: 4,
                      items: { type: "string" },
                      description:
                        "Exactly four plausible and meaningfully different choices.",
                    },
                    answerIndex: {
                      type: "integer",
                      minimum: 0,
                      maximum: 3,
                    },
                    answer: {
                      type: "string",
                      description:
                        "The exact text of choices[answerIndex], copied without changes.",
                    },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id",
                    "type",
                    "concept",
                    "question",
                    "answer",
                    "correction",
                    "explanation",
                  ],
                  properties: {
                    ...commonProperties,
                    type: { type: "string", enum: ["true_false"] },
                    answer: { type: "boolean" },
                    correction: {
                      type: "string",
                      description:
                        "For a false statement, give the corrected statement. For a true statement, explain that it is accurate as written.",
                    },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id",
                    "type",
                    "concept",
                    "question",
                    "answer",
                    "rubricIdeas",
                    "acceptableAnswers",
                    "explanation",
                  ],
                  properties: {
                    ...commonProperties,
                    type: { type: "string", enum: ["short_answer"] },
                    answer: {
                      type: "string",
                      description: "A complete reference answer.",
                    },
                    rubricIdeas: {
                      type: "array",
                      minItems: 1,
                      maxItems: 6,
                      items: { type: "string" },
                      description:
                        "Every evidence-supported idea required for a correct answer.",
                    },
                    acceptableAnswers: {
                      type: "array",
                      maxItems: 8,
                      items: { type: "string" },
                      description:
                        "Equivalent complete answers or phrasings that must be accepted.",
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
  };
}

function generationMessages(input, previousFailure) {
  const example = {
    title: "Motion Concept Quiz",
    questions: [
      {
        id: "q1",
        type: "multiple_choice",
        concept: "Average speed",
        question: "Which calculation gives average speed?",
        choices: [
          "Total distance divided by total time",
          "Total time divided by total distance",
          "Final speed minus initial speed",
          "Distance multiplied by time",
        ],
        answerIndex: 0,
        answer: "Total distance divided by total time",
        explanation: "Average speed compares total distance with total time.",
      },
      {
        id: "q2",
        type: "true_false",
        concept: "Constant speed",
        question:
          "An object moving at constant speed covers equal distances in equal time intervals.",
        answer: true,
        correction: "The statement is accurate as written.",
        explanation:
          "That equal-distance relationship defines constant speed in the lesson.",
      },
      {
        id: "q3",
        type: "short_answer",
        concept: "Acceleration",
        question: "Explain what it means for an object to accelerate.",
        answer: "Its velocity changes over time.",
        rubricIdeas: ["Velocity changes", "The change occurs over time"],
        acceptableAnswers: ["Its speed or direction changes over time."],
        explanation: "Acceleration is the rate at which velocity changes.",
      },
    ],
  };
  const typePlan = input.questionTypePlan
    .map((type, index) => `q${index + 1}: ${type}`)
    .join("\n");
  const truthPlan = input.trueFalseAnswerPlan
    .flatMap((answer, index) =>
      typeof answer === "boolean" ? [`q${index + 1}: ${answer}`] : [],
    )
    .join("\n");
  const retryInstruction = previousFailure
    ? `\nThe previous complete response was rejected for this exact reason: ${previousFailure}\nGenerate the entire bank again from scratch and do not repeat that defect.`
    : "";
  return [
    {
      role: "system",
      content: `You are an expert teacher who creates rigorous mixed-format quizzes from lesson transcripts.

Use only concepts explicitly taught in the supplied plain text. Do not add outside facts, infer missing visual information, or invent claims. Ignore greetings, promotions, sponsor messages, jokes, repeated filler, and transcription noise.

Create exactly ${input.questionCount} questions about the most important concepts taught across the complete lesson. Generate every question in this single response. Each question must be self-contained, specific, and useful for learning. Favor conceptual understanding, application, and analysis over simple word-for-word recall. Avoid generic stems such as "What does the video explain?" and never mention timestamps or caption segments.

The type of every slot is server-assigned and mandatory:
${typePlan}
${truthPlan ? `\nThe answer polarity of every true/false slot is also mandatory:\n${truthPlan}\n` : ""}
For multiple choice, provide exactly four unique choices, exactly one supported answer, and three plausible but lesson-contradicted distractors. For true/false, write a complete declarative statement and include a correction or confirmation. For short answer, provide a complete reference answer, all required rubric ideas, and equivalent acceptable answers. Do not include fields belonging to another question type.${retryInstruction}

You must call the ${TOOL_NAME} tool exactly once. Put the complete quiz in that tool call. The answer field must exactly equal choices[answerIndex]. Do not return prose, Markdown, or a partial quiz. Example tool arguments: ${JSON.stringify(example)}`,
    },
    {
      role: "user",
      content: `Lesson title: ${input.title}\nQuiz language: ${input.quizLanguage}\n\nComplete plain-text lesson transcript:\n${input.plainText}`,
    },
  ];
}

function validateQuiz(quiz, input) {
  if (!quiz || typeof quiz !== "object" || Array.isArray(quiz)) {
    throw new Error("DeepSeek returned an invalid quiz object.");
  }
  if (!nonEmptyString(quiz.title, 300)) {
    throw new Error("DeepSeek returned an invalid quiz title.");
  }
  if (
    !Array.isArray(quiz.questions) ||
    quiz.questions.length !== input.questionCount
  ) {
    throw new Error(
      `DeepSeek returned ${Array.isArray(quiz.questions) ? quiz.questions.length : 0} questions instead of ${input.questionCount}.`,
    );
  }
  const ids = new Set();
  const prompts = new Set();
  for (let index = 0; index < quiz.questions.length; index += 1) {
    const question = quiz.questions[index];
    if (!question || typeof question !== "object" || Array.isArray(question)) {
      throw new Error(`Question ${index + 1} is not a JSON object.`);
    }
    const expectedType = input.questionTypePlan[index];
    if (question.type !== expectedType) {
      throw new Error(
        `Question ${index + 1} must be ${expectedType}, not ${String(question.type)}.`,
      );
    }
    const typeSpecificKeys =
      question.type === "multiple_choice"
        ? ["choices", "answerIndex", "answer"]
        : question.type === "true_false"
          ? ["answer", "correction"]
          : ["answer", "rubricIdeas", "acceptableAnswers"];
    const allowedKeys = new Set([
      "id",
      "type",
      "concept",
      "question",
      "explanation",
      ...typeSpecificKeys,
    ]);
    if (Object.keys(question).some((key) => !allowedKeys.has(key))) {
      throw new Error(`Question ${index + 1} contains an unexpected field.`);
    }
    if (
      !nonEmptyString(question.id, 40) ||
      !nonEmptyString(question.concept, 200) ||
      !nonEmptyString(question.question, 700) ||
      !nonEmptyString(question.explanation, 1_000)
    ) {
      throw new Error(
        `Question ${index + 1} contains an empty or invalid field.`,
      );
    }
    if (question.id !== `q${index + 1}` || ids.has(question.id)) {
      throw new Error(`Question ${index + 1} has an invalid or duplicate id.`);
    }
    ids.add(question.id);
    const prompt = normalize(question.question);
    if (!prompt || prompts.has(prompt)) {
      throw new Error(`Question ${index + 1} duplicates another question.`);
    }
    prompts.add(prompt);
    if (question.type === "multiple_choice") {
      if (
        !Array.isArray(question.choices) ||
        question.choices.length !== 4 ||
        question.choices.some((choice) => !nonEmptyString(choice, 500)) ||
        new Set(question.choices.map(normalize)).size !== 4
      ) {
        throw new Error(`Question ${index + 1} must have four unique choices.`);
      }
      if (
        !nonEmptyString(question.answer, 500) ||
        !Number.isInteger(question.answerIndex) ||
        question.answerIndex < 0 ||
        question.answerIndex > 3 ||
        question.answer !== question.choices[question.answerIndex]
      ) {
        throw new Error(`Question ${index + 1} has an invalid answer.`);
      }
    } else if (question.type === "true_false") {
      if (
        typeof question.answer !== "boolean" ||
        question.answer !== input.trueFalseAnswerPlan[index] ||
        !nonEmptyString(question.correction, 700)
      ) {
        throw new Error(
          `Question ${index + 1} has an invalid true/false answer or correction.`,
        );
      }
    } else if (
      !nonEmptyString(question.answer, 1_000) ||
      !Array.isArray(question.rubricIdeas) ||
      question.rubricIdeas.length < 1 ||
      question.rubricIdeas.length > 6 ||
      question.rubricIdeas.some((idea) => !nonEmptyString(idea, 500)) ||
      !Array.isArray(question.acceptableAnswers) ||
      question.acceptableAnswers.length > 8 ||
      question.acceptableAnswers.some(
        (answer) => !nonEmptyString(answer, 1_000),
      )
    ) {
      throw new Error(
        `Question ${index + 1} has an invalid short-answer rubric.`,
      );
    }
  }
  return quiz;
}

function buildQuestionTypePlan(questionTypes, questionCount) {
  if (
    !Array.isArray(questionTypes) ||
    questionTypes.length < 1 ||
    questionTypes.length > SUPPORTED_QUESTION_TYPES.length ||
    new Set(questionTypes).size !== questionTypes.length ||
    questionTypes.some((type) => !SUPPORTED_QUESTION_TYPES.includes(type))
  ) {
    throw new Error("Choose at least one supported question type.");
  }
  return Array.from(
    { length: questionCount },
    (_, index) => questionTypes[index % questionTypes.length],
  );
}

function buildTrueFalseAnswerPlan(questionTypePlan) {
  let trueFalseIndex = 0;
  return questionTypePlan.map((type) => {
    if (type !== "true_false") return null;
    const answer = trueFalseIndex % 2 === 0;
    trueFalseIndex += 1;
    return answer;
  });
}

function secureRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}

function randomIndex(maxExclusive, randomUint32) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
    throw new Error("The random choice range is invalid.");
  }
  const uint32Range = 0x1_0000_0000;
  const unbiasedLimit = Math.floor(uint32Range / maxExclusive) * maxExclusive;
  let value;
  do {
    value = randomUint32() >>> 0;
  } while (value >= unbiasedLimit);
  return value % maxExclusive;
}

function shuffled(values, randomUint32) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, randomUint32);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function balancedAnswerPositions(count, randomUint32) {
  const positions = [];
  while (positions.length < count) {
    const cycle = shuffled([0, 1, 2, 3], randomUint32);
    positions.push(...cycle.slice(0, count - positions.length));
  }
  return positions;
}

export function randomizeMultipleChoiceOptions(
  quiz,
  randomUint32 = secureRandomUint32,
) {
  const multipleChoiceCount = quiz.questions.filter(
    (question) => question.type === "multiple_choice",
  ).length;
  const answerPositions = balancedAnswerPositions(
    multipleChoiceCount,
    randomUint32,
  );
  let multipleChoiceIndex = 0;
  return {
    ...quiz,
    questions: quiz.questions.map((question) => {
      if (question.type !== "multiple_choice") return question;
      const targetIndex = answerPositions[multipleChoiceIndex];
      const choices = shuffled(question.choices, randomUint32);
      const shuffledAnswerIndex = choices.indexOf(question.answer);
      [choices[targetIndex], choices[shuffledAnswerIndex]] = [
        choices[shuffledAnswerIndex],
        choices[targetIndex],
      ];
      multipleChoiceIndex += 1;
      return { ...question, choices, answerIndex: targetIndex };
    }),
  };
}

async function callDeepSeekTool(
  input,
  apiKey,
  externalSignal,
  previousFailure,
) {
  const controller = new AbortController();
  const abortFromCaller = () =>
    controller.abort(
      externalSignal?.reason ?? new Error("Local generation was cancelled."),
    );
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: generationMessages(input, previousFailure),
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        tools: [quizTool(input.questionCount)],
        max_tokens: GENERATION_OUTPUT_TOKENS,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      if (externalSignal?.aborted) {
        throw new TerminalGenerationError("Local generation was cancelled.");
      }
      throw new TerminalGenerationError(
        "DeepSeek took longer than 15 minutes. Retry the local generation.",
      );
    }
    throw new Error(
      error instanceof Error ? error.message : "DeepSeek could not be reached.",
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
  if (!response.ok) {
    let message = `DeepSeek rejected the request (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body?.error?.message === "string")
        message = body.error.message;
    } catch {
      // The HTTP status remains the authoritative error.
    }
    if (
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      throw new Error(message);
    }
    throw new TerminalGenerationError(message);
  }
  const outer = strictJson(await response.text(), "DeepSeek");
  const choice = outer?.choices?.[0];
  if (!choice) throw new Error("DeepSeek returned no completion choice.");
  if (choice.finish_reason === "length") {
    throw new Error("DeepSeek truncated the tool call. No quiz was created.");
  }
  const toolCalls = choice.message?.tool_calls;
  if (
    choice.finish_reason !== "tool_calls" ||
    !Array.isArray(toolCalls) ||
    toolCalls.length !== 1 ||
    toolCalls[0]?.type !== "function" ||
    toolCalls[0]?.function?.name !== TOOL_NAME ||
    typeof toolCalls[0]?.function?.arguments !== "string"
  ) {
    throw new Error(
      `DeepSeek did not call the required ${TOOL_NAME} tool exactly once.`,
    );
  }
  const usage = outer.usage ?? {};
  return {
    quiz: strictJson(toolCalls[0].function.arguments, TOOL_NAME),
    usage: {
      inputTokens: Number.isInteger(usage.prompt_tokens)
        ? usage.prompt_tokens
        : 0,
      outputTokens: Number.isInteger(usage.completion_tokens)
        ? usage.completion_tokens
        : 0,
      reasoningTokens: Number.isInteger(usage.reasoning_tokens)
        ? usage.reasoning_tokens
        : Number.isInteger(usage.completion_tokens_details?.reasoning_tokens)
          ? usage.completion_tokens_details.reasoning_tokens
          : 0,
      elapsedMs: Math.max(1, Date.now() - startedAt),
    },
  };
}

export async function generateQuizFromPlainText(
  rawInput,
  apiKey,
  onProgress = () => {},
  signal,
) {
  const input = {
    title: String(rawInput?.title ?? "Untitled lesson").trim(),
    quizLanguage: String(rawInput?.quizLanguage ?? "en").trim(),
    questionCount: Number(rawInput?.questionCount ?? 15),
    questionTypes: rawInput?.questionTypes ?? SUPPORTED_QUESTION_TYPES,
    jobId: String(rawInput?.jobId ?? "standalone"),
    transcriptFingerprint: String(
      rawInput?.transcriptFingerprint ?? "standalone",
    ),
    plainText: String(rawInput?.plainText ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  };
  if (!input.title) throw new Error("The lesson title is missing.");
  if (![5, 10, 15].includes(input.questionCount)) {
    throw new Error("The quiz must contain exactly 5, 10, or 15 questions.");
  }
  if (input.plainText.length < 100) {
    throw new Error("The plain-text transcript is too short for a quiz.");
  }
  if (input.plainText.length > MAX_TRANSCRIPT_CHARACTERS) {
    throw new Error(
      "The complete transcript is too large for the local DeepSeek request. It was not sampled or truncated.",
    );
  }
  input.questionTypePlan = buildQuestionTypePlan(
    input.questionTypes,
    input.questionCount,
  );
  input.trueFalseAnswerPlan = buildTrueFalseAnswerPlan(input.questionTypePlan);
  const startedAt = Date.now();
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  let previousFailure;
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    onProgress("creating_questions", 0.2 + attempt * 0.18, {
      attempt,
      maxAttempts: MAX_GENERATION_ATTEMPTS,
      status: attempt === 1 ? "generating" : "retrying",
    });
    try {
      const result = await callDeepSeekTool(
        input,
        apiKey,
        signal,
        previousFailure,
      );
      totals.inputTokens += result.usage.inputTokens;
      totals.outputTokens += result.usage.outputTokens;
      totals.reasoningTokens += result.usage.reasoningTokens;
      const validated = validateQuiz(result.quiz, input);
      const randomized = randomizeMultipleChoiceOptions(validated);
      onProgress("finalizing_questions", 1, {
        attempt,
        maxAttempts: MAX_GENERATION_ATTEMPTS,
        status: "complete",
      });
      return {
        protocolVersion: PROTOCOL_VERSION,
        pipelineVersion: PIPELINE_VERSION,
        model: MODEL,
        reasoningEffort: "high",
        promptVersion: PROMPT_VERSION,
        validatorVersion: VALIDATOR_VERSION,
        quiz: randomized,
        metrics: {
          aiCalls: attempt,
          retryCount: attempt - 1,
          ...totals,
          elapsedMs: Math.max(1, Date.now() - startedAt),
        },
      };
    } catch (error) {
      if (
        error instanceof TerminalGenerationError ||
        attempt === MAX_GENERATION_ATTEMPTS
      ) {
        throw error;
      }
      previousFailure =
        error instanceof Error ? error.message : "The quiz output was invalid.";
      onProgress("creating_questions", 0.2 + attempt * 0.18, {
        attempt,
        maxAttempts: MAX_GENERATION_ATTEMPTS,
        status: "retrying",
      });
      await waitForRetry(750 * 2 ** (attempt - 1), signal);
    }
  }
  throw new Error("Local quiz generation exhausted every attempt.");
}

async function waitForRetry(milliseconds, signal) {
  if (signal?.aborted) {
    throw new TerminalGenerationError("Local generation was cancelled.");
  }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(new TerminalGenerationError("Local generation was cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    setTimeout(() => signal?.removeEventListener("abort", abort), milliseconds);
  });
}

export async function generateLocalQuiz(
  context,
  apiKey,
  onProgress = () => {},
  signal,
) {
  const plainText = captionsToPlainText(context?.segments);
  return generateQuizFromPlainText(
    {
      title: context?.title,
      quizLanguage: context?.quizLanguage,
      questionCount: context?.questionCount,
      questionTypes: context?.questionTypes,
      jobId: context?.jobId,
      transcriptFingerprint: context?.transcriptFingerprint,
      plainText,
    },
    apiKey,
    onProgress,
    signal,
  );
}

export async function testDeepSeekKey(apiKey) {
  const response = await fetch("https://api.deepseek.com/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`DeepSeek rejected this key (${response.status}).`);
  }
  return true;
}
