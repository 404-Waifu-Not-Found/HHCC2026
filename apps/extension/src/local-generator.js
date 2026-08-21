import { captionsToPlainText } from "./caption-text.js";

const MODEL = "deepseek-v4-flash";
const TOOL_NAME = "submit_quiz";
const PROTOCOL_VERSION = 2;
const PIPELINE_VERSION = 6;
const PROMPT_VERSION = "quiz-local-tool-v1.0";
const VALIDATOR_VERSION = "validator-local-tool-v1.0";
const REQUEST_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_TRANSCRIPT_CHARACTERS = 320_000;
const GENERATION_OUTPUT_TOKENS = 48_000;

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
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "concept",
                "question",
                "choices",
                "answerIndex",
                "answer",
                "explanation",
              ],
              properties: {
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
                  description: "A complete, self-contained question.",
                },
                choices: {
                  type: "array",
                  minItems: 4,
                  maxItems: 4,
                  items: { type: "string" },
                  description: "Exactly four meaningfully different choices.",
                },
                answerIndex: {
                  type: "integer",
                  minimum: 0,
                  maximum: 3,
                  description: "Zero-based index of the correct choice.",
                },
                answer: {
                  type: "string",
                  description:
                    "The exact text of choices[answerIndex], copied without changes.",
                },
                explanation: {
                  type: "string",
                  description:
                    "A concise explanation grounded only in the supplied lesson text.",
                },
              },
            },
          },
        },
      },
    },
  };
}

function generationMessages(input) {
  const example = {
    title: "Limits and Continuity Concept Quiz",
    questions: [
      {
        id: "q1",
        concept: "Continuity at a point",
        question: "Which condition is required for continuity at x = a?",
        choices: [
          "The function value and limit both exist and are equal",
          "Only the left-hand limit exists",
          "The derivative is zero",
          "The function has a vertical asymptote",
        ],
        answerIndex: 0,
        answer: "The function value and limit both exist and are equal",
        explanation:
          "Continuity requires the limit to exist, the function value to exist, and the two values to agree.",
      },
    ],
  };
  return [
    {
      role: "system",
      content: `You are an expert teacher who creates rigorous multiple-choice quizzes from lesson transcripts.

Use only concepts explicitly taught in the supplied plain text. Do not add outside facts, infer missing visual information, or invent claims. Ignore greetings, promotions, sponsor messages, jokes, repeated filler, and transcription noise.

Create exactly ${input.questionCount} questions about the most important concepts taught across the complete lesson. Generate every question in this single response. Each question must be self-contained, specific, and useful for learning. Favor conceptual understanding, application, and analysis over simple word-for-word recall. Each question must have exactly four plausible and meaningfully different choices, exactly one correct answer, and a short explanation supported by the lesson text. Avoid generic stems such as "What does the video explain?" and never mention timestamps or caption segments.

You must call the ${TOOL_NAME} tool exactly once. Put the complete quiz in that tool call. The answer field must exactly equal choices[answerIndex]. Do not return prose, Markdown, or a partial quiz. Example tool arguments: ${JSON.stringify(example)}`,
    },
    {
      role: "user",
      content: `Lesson title: ${input.title}\nQuiz language: ${input.quizLanguage}\n\nComplete plain-text lesson transcript:\n${input.plainText}`,
    },
  ];
}

function validateQuiz(quiz, questionCount) {
  if (!quiz || typeof quiz !== "object" || Array.isArray(quiz)) {
    throw new Error("DeepSeek returned an invalid quiz object.");
  }
  if (!nonEmptyString(quiz.title, 300)) {
    throw new Error("DeepSeek returned an invalid quiz title.");
  }
  if (
    !Array.isArray(quiz.questions) ||
    quiz.questions.length !== questionCount
  ) {
    throw new Error(
      `DeepSeek returned ${Array.isArray(quiz.questions) ? quiz.questions.length : 0} questions instead of ${questionCount}.`,
    );
  }
  const ids = new Set();
  const prompts = new Set();
  for (let index = 0; index < quiz.questions.length; index += 1) {
    const question = quiz.questions[index];
    if (!question || typeof question !== "object" || Array.isArray(question)) {
      throw new Error(`Question ${index + 1} is not a JSON object.`);
    }
    const allowedKeys = new Set([
      "id",
      "concept",
      "question",
      "choices",
      "answerIndex",
      "answer",
      "explanation",
    ]);
    if (Object.keys(question).some((key) => !allowedKeys.has(key))) {
      throw new Error(`Question ${index + 1} contains an unexpected field.`);
    }
    if (
      !nonEmptyString(question.id, 40) ||
      !nonEmptyString(question.concept, 200) ||
      !nonEmptyString(question.question, 700) ||
      !nonEmptyString(question.answer, 500) ||
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
    if (
      !Array.isArray(question.choices) ||
      question.choices.length !== 4 ||
      question.choices.some((choice) => !nonEmptyString(choice, 500)) ||
      new Set(question.choices.map(normalize)).size !== 4
    ) {
      throw new Error(`Question ${index + 1} must have four unique choices.`);
    }
    if (
      !Number.isInteger(question.answerIndex) ||
      question.answerIndex < 0 ||
      question.answerIndex > 3 ||
      question.answer !== question.choices[question.answerIndex]
    ) {
      throw new Error(`Question ${index + 1} has an invalid answer.`);
    }
  }
  return quiz;
}

async function callDeepSeekTool(input, apiKey, externalSignal) {
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
        messages: generationMessages(input),
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
        throw new Error("Local generation was cancelled.");
      }
      throw new Error(
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
    throw new Error(message);
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
    quiz: validateQuiz(
      strictJson(toolCalls[0].function.arguments, TOOL_NAME),
      input.questionCount,
    ),
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
  onProgress("creating_questions", 0.25);
  const result = await callDeepSeekTool(input, apiKey, signal);
  onProgress("finalizing_questions", 1);
  return {
    protocolVersion: PROTOCOL_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    model: MODEL,
    reasoningEffort: "high",
    promptVersion: PROMPT_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    quiz: result.quiz,
    metrics: { aiCalls: 1, ...result.usage },
  };
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
