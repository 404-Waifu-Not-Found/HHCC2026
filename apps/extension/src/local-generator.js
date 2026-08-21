import { captionsToPlainText } from "./caption-text.js";

const MODEL = "deepseek-v4-flash";
const PROTOCOL_VERSION = 5;
const PIPELINE_VERSION = 9;
const PROMPT_VERSION = "quiz-local-json-stream-v5.0";
const VALIDATOR_VERSION = "validator-local-progressive-v4.0";
const REQUEST_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_TRANSCRIPT_CHARACTERS = 320_000;
const GENERATION_OUTPUT_TOKENS = 48_000;
const MAX_NO_PROGRESS_RETRIES = 3;
const MAX_GENERATION_ATTEMPTS = MAX_NO_PROGRESS_RETRIES + 1;
const QUESTION_CHUNK_SIZE = 5;
const SUPPORTED_QUESTION_TYPES = [
  "multiple_choice",
  "true_false",
  "short_answer",
];

class TerminalGenerationError extends Error {
  constructor(message, reasonCode = "action_required") {
    super(message);
    this.reasonCode = reasonCode;
  }
}
class RetryableGenerationError extends Error {
  constructor(message, retryAfterMs = 0) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

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

function quizResponseSchema(questionCount, questionOffset = 0) {
  const commonProperties = {
    id: {
      type: "string",
      description: `Sequential global id from q${questionOffset + 1} through q${questionOffset + questionCount}.`,
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
  };
}

function generationMessages(input, previousFailure) {
  const responseSchema = quizResponseSchema(
    input.questionCount,
    input.questionOffset,
  );
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
    .map((type, index) => `q${input.questionOffset + index + 1}: ${type}`)
    .join("\n");
  const truthPlan = input.trueFalseAnswerPlan
    .flatMap((answer, index) =>
      typeof answer === "boolean"
        ? [`q${input.questionOffset + index + 1}: ${answer}`]
        : [],
    )
    .join("\n");
  const acceptedQuestions = input.acceptedQuestions?.length
    ? `\nThese earlier questions are already accepted. Do not repeat their concepts or prompts:\n${input.acceptedQuestions
        .map(
          (question) =>
            `${question.id}: ${question.concept} — ${question.question}`,
        )
        .join("\n")}\n`
    : "";
  const retryInstruction = previousFailure
    ? `\nThe previous stream stopped at the first unresolved position for this exact reason: ${previousFailure}\nGenerate this entire remaining requested group from scratch and do not repeat that defect.`
    : "";
  return [
    {
      role: "system",
      content: `You are an expert teacher who creates rigorous mixed-format quizzes from lesson transcripts.

Use only concepts explicitly taught in the supplied plain text. Do not add outside facts, infer missing visual information, or invent claims. Ignore greetings, promotions, sponsor messages, jokes, repeated filler, and transcription noise.

Create exactly ${input.questionCount} questions for positions q${input.questionOffset + 1} through q${input.questionOffset + input.questionCount} of a ${input.totalQuestionCount}-question quiz. Generate this entire chunk in one response. Serialize the title before the questions array, and finish each question object before beginning the next one so validated questions can be delivered while the JSON response content is still streaming. Each question must be self-contained, specific, and useful for learning. Favor conceptual understanding, application, and analysis over simple word-for-word recall. Avoid generic stems such as "What does the video explain?" and never mention timestamps or caption segments.${acceptedQuestions}

The type of every slot is server-assigned and mandatory:
${typePlan}
${truthPlan ? `\nThe answer polarity of every true/false slot is also mandatory:\n${truthPlan}\n` : ""}
For multiple choice, provide exactly four unique choices, exactly one supported answer, and three plausible but lesson-contradicted distractors. For true/false, write a complete declarative statement and include a correction or confirmation. For short answer, provide a complete reference answer, all required rubric ideas, and equivalent acceptable answers. Do not include fields belonging to another question type.${retryInstruction}

Return exactly one JSON object as the complete assistant response content. Begin immediately with the object, serialize each question in order, and do not wrap it in Markdown or prose. Use the exact global IDs q${input.questionOffset + 1} through q${input.questionOffset + input.questionCount}. The answer field must exactly equal choices[answerIndex]. Do not omit any requested question. The required response schema is: ${JSON.stringify(responseSchema)}. Example field structure: ${JSON.stringify(example)}`,
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
  if (Object.keys(quiz).some((key) => key !== "title" && key !== "questions")) {
    throw new Error("DeepSeek returned an unexpected quiz field.");
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
  const ids = new Set(input.acceptedQuestions?.map((question) => question.id));
  const prompts = new Set(
    input.acceptedQuestions?.map((question) => normalize(question.question)),
  );
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
    if (
      question.id !== `q${input.questionOffset + index + 1}` ||
      ids.has(question.id)
    ) {
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

function randomizeQuestionAtPosition(
  question,
  targetAnswerIndex,
  randomUint32 = secureRandomUint32,
) {
  if (question.type !== "multiple_choice") return question;
  const choices = shuffled(question.choices, randomUint32);
  const shuffledAnswerIndex = choices.indexOf(question.answer);
  [choices[targetAnswerIndex], choices[shuffledAnswerIndex]] = [
    choices[shuffledAnswerIndex],
    choices[targetAnswerIndex],
  ];
  return { ...question, choices, answerIndex: targetAnswerIndex };
}

function usageMetrics(usage) {
  return {
    inputTokens: Number.isInteger(usage?.prompt_tokens)
      ? usage.prompt_tokens
      : 0,
    outputTokens: Number.isInteger(usage?.completion_tokens)
      ? usage.completion_tokens
      : 0,
    reasoningTokens: Number.isInteger(usage?.reasoning_tokens)
      ? usage.reasoning_tokens
      : Number.isInteger(usage?.completion_tokens_details?.reasoning_tokens)
        ? usage.completion_tokens_details.reasoning_tokens
        : 0,
  };
}

function parseCompletedQuizObjects(responseText) {
  const title = completedRootStringProperty(responseText, "title");
  const questionsStart = rootArrayPropertyStart(responseText, "questions");
  if (questionsStart < 0) return { title, questions: [] };
  const questions = [];
  let objectStart = -1;
  let objectDepth = 0;
  let insideString = false;
  let escaped = false;
  for (let index = questionsStart; index < responseText.length; index += 1) {
    const character = responseText[index];
    if (insideString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') insideString = false;
      continue;
    }
    if (character === '"') {
      insideString = true;
      continue;
    }
    if (character === "{") {
      if (objectDepth === 0) objectStart = index;
      objectDepth += 1;
      continue;
    }
    if (character !== "}" || objectDepth === 0) continue;
    objectDepth -= 1;
    if (objectDepth !== 0 || objectStart < 0) continue;
    questions.push(
      strictJson(
        responseText.slice(objectStart, index + 1),
        "DeepSeek streamed question",
      ),
    );
    objectStart = -1;
  }
  return { title, questions };
}

function completedRootStringProperty(responseText, propertyName) {
  const valueStart = rootPropertyValueStart(responseText, propertyName);
  if (valueStart < 0 || responseText[valueStart] !== '"') return undefined;
  let escaped = false;
  for (let index = valueStart + 1; index < responseText.length; index += 1) {
    const character = responseText[index];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') {
      try {
        return JSON.parse(responseText.slice(valueStart, index + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function rootArrayPropertyStart(responseText, propertyName) {
  const valueStart = rootPropertyValueStart(responseText, propertyName);
  return valueStart >= 0 && responseText[valueStart] === "["
    ? valueStart + 1
    : -1;
}

function rootPropertyValueStart(responseText, propertyName) {
  let objectDepth = 0;
  let arrayDepth = 0;
  let insideString = false;
  let escaped = false;
  let stringStart = -1;
  for (let index = 0; index < responseText.length; index += 1) {
    const character = responseText[index];
    if (insideString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') {
        insideString = false;
        if (objectDepth === 1 && arrayDepth === 0 && stringStart >= 0) {
          let property;
          try {
            property = JSON.parse(responseText.slice(stringStart, index + 1));
          } catch {
            property = undefined;
          }
          let cursor = index + 1;
          while (/\s/.test(responseText[cursor] ?? "")) cursor += 1;
          if (property === propertyName && responseText[cursor] === ":") {
            cursor += 1;
            while (/\s/.test(responseText[cursor] ?? "")) cursor += 1;
            return cursor < responseText.length ? cursor : -1;
          }
        }
      }
      continue;
    }
    if (character === '"') {
      insideString = true;
      stringStart = index;
    } else if (character === "{") objectDepth += 1;
    else if (character === "}") objectDepth = Math.max(0, objectDepth - 1);
    else if (character === "[") arrayDepth += 1;
    else if (character === "]") arrayDepth = Math.max(0, arrayDepth - 1);
  }
  return -1;
}

function parseCompletedJsonResponse(outer) {
  const choice = outer?.choices?.[0];
  if (!choice) throw new Error("DeepSeek returned no completion choice.");
  if (choice.finish_reason === "length") {
    throw new Error(
      "DeepSeek truncated the JSON response. No quiz was created.",
    );
  }
  if (
    choice.finish_reason !== "stop" ||
    typeof choice.message?.content !== "string"
  ) {
    throw new Error("DeepSeek did not return the required JSON response.");
  }
  return {
    quiz: strictJson(choice.message.content, "DeepSeek JSON response"),
    usage: usageMetrics(outer.usage),
  };
}

async function parseDeepSeekEventStream(response, onQuestion, fallbackTitle) {
  if (!response.body) {
    throw new Error("DeepSeek returned an empty streaming response.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let eventBuffer = "";
  let responseContent = "";
  let emittedQuestions = 0;
  let finishReason = null;
  let usage = {};

  const emitCompletedQuestions = async () => {
    const parsed = parseCompletedQuizObjects(responseContent);
    const availableTitle = nonEmptyString(parsed.title, 300)
      ? parsed.title
      : fallbackTitle;
    if (!nonEmptyString(availableTitle, 300)) return;
    while (emittedQuestions < parsed.questions.length) {
      await onQuestion(
        parsed.questions[emittedQuestions],
        emittedQuestions,
        availableTitle,
      );
      emittedQuestions += 1;
    }
  };

  const processEvent = async (frame) => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data || data === "[DONE]") return;
    const event = strictJson(data, "DeepSeek stream");
    if (event.usage) usage = event.usage;
    const choice = event?.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    if (typeof choice.delta?.content === "string") {
      responseContent += choice.delta.content;
    }
    await emitCompletedQuestions();
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      eventBuffer += decoder.decode(value, { stream: !done });
      eventBuffer = eventBuffer.replace(/\r\n/g, "\n");
      let boundary = eventBuffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = eventBuffer.slice(0, boundary);
        eventBuffer = eventBuffer.slice(boundary + 2);
        await processEvent(frame);
        boundary = eventBuffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }
  if (eventBuffer.trim()) await processEvent(eventBuffer);
  await emitCompletedQuestions();
  if (finishReason === "length") {
    throw new Error(
      "DeepSeek truncated the JSON response. No quiz was created.",
    );
  }
  if (finishReason !== "stop") {
    throw new Error("DeepSeek did not finish the required JSON response.");
  }
  return {
    quiz: strictJson(responseContent, "DeepSeek JSON response"),
    usage: usageMetrics(usage),
  };
}

async function callDeepSeekJson(
  input,
  apiKey,
  externalSignal,
  previousFailure,
  onQuestion,
) {
  const controller = new AbortController();
  const abortFromCaller = () =>
    controller.abort(
      externalSignal?.reason ?? new Error("Local generation was cancelled."),
    );
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
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
        response_format: { type: "json_object" },
        max_tokens: GENERATION_OUTPUT_TOKENS,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `DeepSeek rejected the request (${response.status}).`;
      try {
        const body = await response.json();
        if (typeof body?.error?.message === "string") {
          message = body.error.message;
        }
      } catch {
        // The HTTP status remains the authoritative error.
      }
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        throw new RetryableGenerationError(
          message,
          retryAfterMilliseconds(response.headers.get("retry-after")),
        );
      }
      const reasonCode =
        response.status === 401
          ? "credential_invalid"
          : response.status === 402
            ? "billing_required"
            : response.status === 403
              ? "permission_denied"
              : "request_rejected";
      throw new TerminalGenerationError(message, reasonCode);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const result = contentType.includes("text/event-stream")
      ? await parseDeepSeekEventStream(response, onQuestion, input.title)
      : parseCompletedJsonResponse(
          strictJson(await response.text(), "DeepSeek"),
        );
    if (!contentType.includes("text/event-stream")) {
      for (let index = 0; index < result.quiz.questions.length; index += 1) {
        await onQuestion(
          result.quiz.questions[index],
          index,
          result.quiz.title,
        );
      }
    }
    return {
      ...result,
      usage: {
        ...result.usage,
        elapsedMs: Math.max(1, Date.now() - startedAt),
      },
    };
  } catch (error) {
    if (controller.signal.aborted) {
      if (externalSignal?.aborted) {
        throw new TerminalGenerationError(
          "Local generation was cancelled.",
          "generation_cancelled",
        );
      }
      throw new RetryableGenerationError(
        "DeepSeek took longer than 15 minutes. Retry the local generation.",
      );
    }
    throw error instanceof Error
      ? error
      : new Error("DeepSeek could not be reached.");
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function generateQuizFromPlainText(
  rawInput,
  apiKey,
  onProgress = () => {},
  signal,
  onChunk = () => {},
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
    continuation: rawInput?.continuation,
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
  const continuationStartIndex = Number(input.continuation?.startIndex ?? 0);
  const continuationQuestions = Array.isArray(
    input.continuation?.acceptedQuestions,
  )
    ? input.continuation.acceptedQuestions.map((question) => ({ ...question }))
    : [];
  if (
    continuationStartIndex < 0 ||
    continuationStartIndex >= input.questionCount ||
    continuationQuestions.length !== continuationStartIndex ||
    continuationQuestions.some(
      (question, index) =>
        question?.id !== `q${index + 1}` ||
        question?.type !== input.questionTypePlan[index] ||
        !nonEmptyString(question?.concept, 200) ||
        !nonEmptyString(question?.question, 700),
    )
  ) {
    throw new Error("The progressive continuation state is invalid.");
  }
  const startedAt = Date.now();
  const totals = {
    aiCalls: 0,
    retryCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  const acceptedQuestions = continuationQuestions;
  let quizTitle = continuationStartIndex ? input.title : undefined;
  const multipleChoicePositions = balancedAnswerPositions(
    input.questionTypePlan.filter((type) => type === "multiple_choice").length,
    secureRandomUint32,
  );
  const answerPositionByQuestion = new Map();
  let multipleChoiceIndex = 0;
  input.questionTypePlan.forEach((type, index) => {
    if (type !== "multiple_choice") return;
    answerPositionByQuestion.set(
      index,
      multipleChoicePositions[multipleChoiceIndex],
    );
    multipleChoiceIndex += 1;
  });
  let previousFailure;
  let consecutiveFailures = 0;
  let unreportedAiCalls = 0;
  let unreportedRetries = 0;
  let lastChunkAt = Date.now();

  while (acceptedQuestions.length < input.questionCount) {
    const questionOffset = acceptedQuestions.length;
    const acceptedBeforeCall = acceptedQuestions.length;
    const chunkQuestionCount = Math.min(
      QUESTION_CHUNK_SIZE,
      input.questionCount - questionOffset,
    );
    const chunkInput = {
      ...input,
      questionCount: chunkQuestionCount,
      totalQuestionCount: input.questionCount,
      questionOffset,
      questionTypePlan: input.questionTypePlan.slice(
        questionOffset,
        questionOffset + chunkQuestionCount,
      ),
      trueFalseAnswerPlan: input.trueFalseAnswerPlan.slice(
        questionOffset,
        questionOffset + chunkQuestionCount,
      ),
      acceptedQuestions: [...acceptedQuestions],
    };
    const callAttempt = consecutiveFailures + 1;
    const chunkProgress = questionOffset / input.questionCount;
    onProgress("creating_questions", 0.2 + chunkProgress * 0.72, {
      attempt: callAttempt,
      maxAttempts: MAX_GENERATION_ATTEMPTS,
      status: previousFailure ? "retrying" : "generating",
    });
    totals.aiCalls += 1;
    unreportedAiCalls += 1;
    let pendingFinalQuestion;

    const publishQuestion = (rawQuestion, relativeIndex, title, usage = {}) => {
      const globalIndex = questionOffset + relativeIndex;
      if (globalIndex !== acceptedQuestions.length) {
        throw new Error("DeepSeek streamed questions out of order.");
      }
      const singleInput = {
        ...input,
        questionCount: 1,
        totalQuestionCount: input.questionCount,
        questionOffset: globalIndex,
        questionTypePlan: input.questionTypePlan.slice(
          globalIndex,
          globalIndex + 1,
        ),
        trueFalseAnswerPlan: input.trueFalseAnswerPlan.slice(
          globalIndex,
          globalIndex + 1,
        ),
        acceptedQuestions: [...acceptedQuestions],
      };
      const validated = validateQuiz(
        { title, questions: [rawQuestion] },
        singleInput,
      );
      const question = randomizeQuestionAtPosition(
        validated.questions[0],
        answerPositionByQuestion.get(globalIndex),
      );
      quizTitle ??= validated.title;
      acceptedQuestions.push(question);
      const now = Date.now();
      onChunk({
        protocolVersion: PROTOCOL_VERSION,
        pipelineVersion: PIPELINE_VERSION,
        model: MODEL,
        reasoningEffort: "high",
        promptVersion: PROMPT_VERSION,
        validatorVersion: VALIDATOR_VERSION,
        title: quizTitle,
        startIndex: globalIndex,
        totalQuestions: input.questionCount,
        question,
        metrics: {
          aiCalls: unreportedAiCalls,
          retryCount: unreportedRetries,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          reasoningTokens: usage.reasoningTokens ?? 0,
          elapsedMs: Math.max(1, now - lastChunkAt),
        },
      });
      unreportedAiCalls = 0;
      unreportedRetries = 0;
      lastChunkAt = now;
      const complete = acceptedQuestions.length === input.questionCount;
      onProgress(
        complete ? "finalizing_questions" : "creating_questions",
        complete
          ? 1
          : 0.2 + (acceptedQuestions.length / input.questionCount) * 0.72,
        {
          attempt: callAttempt,
          maxAttempts: MAX_GENERATION_ATTEMPTS,
          status: complete ? "complete" : "generating",
        },
      );
    };

    try {
      const result = await callDeepSeekJson(
        chunkInput,
        apiKey,
        signal,
        previousFailure,
        (question, relativeIndex, title) => {
          if (relativeIndex >= chunkQuestionCount) {
            throw new Error("DeepSeek streamed too many questions.");
          }
          if (relativeIndex === chunkQuestionCount - 1) {
            pendingFinalQuestion = { question, relativeIndex, title };
            return;
          }
          publishQuestion(question, relativeIndex, title);
        },
      );
      validateQuiz(result.quiz, chunkInput);
      if (!pendingFinalQuestion) {
        throw new Error(
          "DeepSeek did not stream the final requested question.",
        );
      }
      totals.inputTokens += result.usage.inputTokens;
      totals.outputTokens += result.usage.outputTokens;
      totals.reasoningTokens += result.usage.reasoningTokens;
      publishQuestion(
        pendingFinalQuestion.question,
        pendingFinalQuestion.relativeIndex,
        pendingFinalQuestion.title,
        result.usage,
      );
      previousFailure = undefined;
      consecutiveFailures = 0;
    } catch (error) {
      if (error instanceof TerminalGenerationError) throw error;
      totals.retryCount += 1;
      unreportedRetries += 1;
      previousFailure =
        error instanceof Error
          ? error.message
          : "The streamed quiz output was invalid.";
      consecutiveFailures =
        acceptedQuestions.length > acceptedBeforeCall
          ? 0
          : consecutiveFailures + 1;
      if (consecutiveFailures > MAX_NO_PROGRESS_RETRIES) throw error;
      onProgress(
        "creating_questions",
        0.2 + (acceptedQuestions.length / input.questionCount) * 0.72,
        {
          attempt: consecutiveFailures + 1,
          maxAttempts: MAX_GENERATION_ATTEMPTS,
          status: "retrying",
        },
      );
      const exponentialDelay = 750 * 2 ** Math.max(0, consecutiveFailures - 1);
      const retryAfterDelay =
        error instanceof RetryableGenerationError ? error.retryAfterMs : 0;
      await waitForRetry(Math.max(exponentialDelay, retryAfterDelay), signal);
    }
  }

  const metrics = {
    ...totals,
    elapsedMs: Math.max(1, Date.now() - startedAt),
  };
  if (continuationStartIndex > 0) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      pipelineVersion: PIPELINE_VERSION,
      model: MODEL,
      reasoningEffort: "high",
      promptVersion: PROMPT_VERSION,
      validatorVersion: VALIDATOR_VERSION,
      title: quizTitle,
      generatedStartIndex: continuationStartIndex,
      totalQuestions: input.questionCount,
      metrics,
    };
  }
  const completeQuiz = validateQuiz(
    { title: quizTitle, questions: acceptedQuestions },
    {
      ...input,
      questionOffset: 0,
      acceptedQuestions: [],
    },
  );
  return {
    protocolVersion: PROTOCOL_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    model: MODEL,
    reasoningEffort: "high",
    promptVersion: PROMPT_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    quiz: completeQuiz,
    metrics,
  };
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
  onChunk = () => {},
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
      continuation: context?.continuation,
    },
    apiKey,
    onProgress,
    signal,
    onChunk,
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
