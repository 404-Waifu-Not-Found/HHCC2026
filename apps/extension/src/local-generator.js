import { captionsToPlainText } from "./caption-text.js";

const MODEL = "deepseek-v4-flash";
const PROTOCOL_VERSION = 6;
const PIPELINE_VERSION = 9;
const PROMPT_VERSION = "quiz-local-json-stream-v5.2";
const VALIDATOR_VERSION = "validator-local-progressive-v4.1";
const IMPORT_VERSION = "extension-progressive-import-v4";
const GENERATION_PROFILE = "stable_non_thinking_v5_2";
const REQUEST_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_TRANSCRIPT_CHARACTERS = 320_000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;
const MAX_GENERATION_ATTEMPTS = 2;
const SUPPORTED_QUESTION_TYPES = [
  "multiple_choice",
  "true_false",
  "short_answer",
];

class GenerationFailure extends Error {
  constructor(
    message,
    reasonCode,
    { transient = false, retryAfterMs = 0 } = {},
  ) {
    super(message);
    this.reasonCode = reasonCode;
    this.transient = transient;
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

export function boundedRetryDelayMilliseconds(
  _consecutiveFailures,
  retryAfterMs = 0,
) {
  const exponentialDelay = 750;
  return Math.min(
    MAX_RETRY_DELAY_MS,
    Math.max(exponentialDelay, Math.max(0, retryAfterMs)),
  );
}

function strictJson(
  text,
  operation,
  reasonCode = "truncated_json",
  transient = false,
) {
  try {
    return JSON.parse(text);
  } catch {
    throw new GenerationFailure(
      `${operation} returned malformed JSON. No quiz was created.`,
      reasonCode,
      { transient },
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

function questionSchemaForType(type, id) {
  const properties = {
    id: { const: id },
    type: { const: type },
    concept: { type: "string" },
    question: { type: "string" },
    explanation: { type: "string" },
  };
  const required = ["id", "type", "concept", "question", "explanation"];
  if (type === "multiple_choice") {
    Object.assign(properties, {
      choices: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: { type: "string" },
      },
      answerIndex: { type: "integer", minimum: 0, maximum: 3 },
      answer: { type: "string" },
    });
    required.push("choices", "answerIndex", "answer");
  } else if (type === "true_false") {
    Object.assign(properties, {
      answer: { type: "boolean" },
      correction: { type: "string" },
    });
    required.push("answer", "correction");
  } else {
    Object.assign(properties, {
      answer: { type: "string" },
      rubricIdeas: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: { type: "string" },
      },
      acceptableAnswers: {
        type: "array",
        maxItems: 8,
        items: { type: "string" },
      },
    });
    required.push("answer", "rubricIdeas", "acceptableAnswers");
  }
  return { type: "object", additionalProperties: false, required, properties };
}

function quizResponseSchema(input) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        minItems: input.questionCount,
        maxItems: input.questionCount,
        prefixItems: input.questionTypePlan.map((type, index) =>
          questionSchemaForType(type, `q${input.questionOffset + index + 1}`),
        ),
        items: false,
      },
    },
  };
}

function exampleQuestion(type, id, polarity) {
  const common = {
    id,
    type,
    concept: "lesson concept",
    question: "A self-contained question grounded in the lesson?",
    explanation: "A concise lesson-grounded explanation.",
  };
  if (type === "multiple_choice") {
    return {
      ...common,
      choices: [
        "supported answer",
        "distractor A",
        "distractor B",
        "distractor C",
      ],
      answerIndex: 0,
      answer: "supported answer",
    };
  }
  if (type === "true_false") {
    return {
      ...common,
      answer: polarity,
      correction: polarity
        ? "The statement is accurate as written."
        : "The corrected lesson-grounded statement.",
    };
  }
  return {
    ...common,
    answer: "A concise complete reference answer.",
    rubricIdeas: ["required idea"],
    acceptableAnswers: [],
  };
}

function generationMessages(input, isTransientRetry) {
  const slotPlan = input.questionTypePlan
    .map((type, index) => {
      const id = `q${input.questionOffset + index + 1}`;
      const polarity = input.trueFalseAnswerPlan[index];
      return `${id}: ${type}${typeof polarity === "boolean" ? `, answer=${polarity}` : ""}`;
    })
    .join("\n");
  const accepted = input.acceptedQuestions.length
    ? input.acceptedQuestions
        .map(
          (question) =>
            `${question.id}: ${question.type}; ${question.concept}; ${question.question}`,
        )
        .join("\n")
    : "none";
  const example = {
    questions: input.questionTypePlan.map((type, index) =>
      exampleQuestion(
        type,
        `q${input.questionOffset + index + 1}`,
        input.trueFalseAnswerPlan[index],
      ),
    ),
  };
  return [
    {
      role: "system",
      content: `You create rigorous quizzes from a supplied lesson transcript. Use only claims explicitly supported by that transcript. Ignore greetings, promotions, jokes, repeated filler, and transcription noise. Never infer unseen visuals or add outside facts. Questions must be self-contained, specific, pedagogically useful, and must not mention captions, timestamps, or the video.

Return JSON only: one JSON object containing a questions array. Finish each question object before starting the next. Multiple-choice questions need four unique plausible choices, exactly one supported answer, and answer must equal choices[answerIndex]. True/false questions need the assigned polarity and a correction or confirmation. Short answers need a complete answer, every required rubric idea, and optional equivalent answers. A formula answer must be a standalone canonical formula with explicit operators and parenthesized numerators and denominators, for example (f(b)-f(a))/(b-a); put notation variants in acceptableAnswers. Never include fields for another question type.`,
    },
    {
      role: "user",
      content: `Lesson title: ${input.title}\nQuiz language: ${input.quizLanguage}\n\nComplete plain-text lesson transcript:\n${input.plainText}`,
    },
    {
      role: "user",
      content: `Create exactly ${input.questionCount} consecutive questions for this JSON task. This is ${isTransientRetry ? "the single transport retry for" : "the primary request for"} positions q${input.questionOffset + 1} through q${input.questionOffset + input.questionCount} of ${input.totalQuestionCount}.

Mandatory slot plan:\n${slotPlan}\n\nAlready accepted questions; do not repeat or closely paraphrase their prompts:\n${accepted}\n\nExact JSON schema:\n${JSON.stringify(quizResponseSchema(input))}\n\nValid shape example:\n${JSON.stringify(example)}\n\nBegin with {\"questions\":[ and return no Markdown or prose.`,
    },
  ];
}

function cleanString(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : value;
}

function cleanStringArray(value, optional = false) {
  if (value === undefined && optional) return [];
  return Array.isArray(value) ? value.map(cleanString) : value;
}

export function normalizeGeneratedQuestion(rawQuestion) {
  if (
    !rawQuestion ||
    typeof rawQuestion !== "object" ||
    Array.isArray(rawQuestion)
  ) {
    return rawQuestion;
  }
  const type = cleanString(rawQuestion.type);
  const common = {
    id: cleanString(rawQuestion.id),
    type,
    concept: cleanString(rawQuestion.concept),
    question: cleanString(rawQuestion.question),
    explanation: cleanString(rawQuestion.explanation),
  };
  if (type === "multiple_choice") {
    const choices = cleanStringArray(rawQuestion.choices);
    let answerIndex = rawQuestion.answerIndex;
    if (/^[0-3]$/.test(answerIndex)) answerIndex = Number(answerIndex);
    let answer = cleanString(rawQuestion.answer);
    if (Array.isArray(choices) && typeof answer === "string") {
      const matches = choices.filter(
        (choice) =>
          typeof choice === "string" && normalize(choice) === normalize(answer),
      );
      if (matches.length === 1) answer = matches[0];
    }
    return { ...common, choices, answerIndex, answer };
  }
  if (type === "true_false") {
    let answer = rawQuestion.answer;
    if (typeof answer === "string" && /^(true|false)$/i.test(answer)) {
      answer = answer.toLocaleLowerCase("en-US") === "true";
    }
    return {
      ...common,
      answer,
      correction: cleanString(rawQuestion.correction),
    };
  }
  if (type === "short_answer") {
    return {
      ...common,
      answer: cleanString(rawQuestion.answer),
      rubricIdeas: cleanStringArray(rawQuestion.rubricIdeas),
      acceptableAnswers: cleanStringArray(rawQuestion.acceptableAnswers, true),
    };
  }
  return common;
}

function validationFailure(message, reasonCode = "schema_invalid") {
  throw new GenerationFailure(message, reasonCode);
}

function promptSimilarity(left, right) {
  const canonical = (value) => normalize(value).replace(/\s+/g, " ").trim();
  const leftValue = canonical(left);
  const rightValue = canonical(right);
  if (!leftValue || !rightValue) return 0;
  if (leftValue === rightValue) return 1;
  const shingles = (value) => {
    if (value.length <= 3) return new Set([value]);
    return new Set(
      Array.from({ length: value.length - 2 }, (_, index) =>
        value.slice(index, index + 3),
      ),
    );
  };
  const leftShingles = shingles(leftValue);
  const rightShingles = shingles(rightValue);
  const union = new Set([...leftShingles, ...rightShingles]);
  let intersection = 0;
  for (const shingle of leftShingles) {
    if (rightShingles.has(shingle)) intersection += 1;
  }
  return union.size ? intersection / union.size : 0;
}

function hasBalancedDelimiters(value) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const character of value) {
    if (["(", "[", "{"].includes(character)) stack.push(character);
    else if (pairs[character] && stack.pop() !== pairs[character]) return false;
  }
  return stack.length === 0;
}

function isCanonicalFormulaQuestion(question) {
  const prompt = question.question.toLocaleLowerCase("en-US");
  if (
    !/formula|equation|expression|derivative|rate of change|公式|方程|导数/.test(
      prompt,
    )
  ) {
    return true;
  }
  const answer = question.answer.replace(/\s+/g, "");
  if (
    !/[=+\-*/^]|[×÷]/.test(answer) ||
    !hasBalancedDelimiters(answer) ||
    !/^[\p{L}\p{N}_'()[\]{}.,=+\-*/^×÷]+$/u.test(answer)
  ) {
    return false;
  }
  if (answer.includes("/") && !/^\(.+\)\/\(.+\)$/.test(answer)) return false;
  return true;
}

function validateQuiz(quiz, input) {
  if (!quiz || typeof quiz !== "object" || Array.isArray(quiz)) {
    validationFailure("DeepSeek returned an invalid quiz object.");
  }
  if (
    !Array.isArray(quiz.questions) ||
    quiz.questions.length !== input.questionCount
  ) {
    validationFailure(
      `DeepSeek returned ${Array.isArray(quiz.questions) ? quiz.questions.length : 0} questions instead of ${input.questionCount}.`,
      "truncated_json",
    );
  }
  const accepted = input.acceptedQuestions ?? [];
  const ids = new Set(accepted.map((question) => question.id));
  const prompts = accepted.map((question) => question.question);
  const questions = quiz.questions.map((rawQuestion, index) => {
    const question = normalizeGeneratedQuestion(rawQuestion);
    if (!question || typeof question !== "object" || Array.isArray(question)) {
      validationFailure(`Question ${index + 1} is not a JSON object.`);
    }
    const expectedType = input.questionTypePlan[index];
    if (
      question.type !== expectedType ||
      question.id !== `q${input.questionOffset + index + 1}` ||
      ids.has(question.id)
    ) {
      validationFailure(
        `Question ${index + 1} does not match its assigned id, type, or order.`,
        "type_or_order_mismatch",
      );
    }
    if (
      !nonEmptyString(question.concept, 200) ||
      !nonEmptyString(question.question, 700) ||
      !nonEmptyString(question.explanation, 1_500)
    ) {
      validationFailure(
        `Question ${index + 1} contains an invalid required field.`,
      );
    }
    if (
      prompts.some(
        (prompt) => promptSimilarity(prompt, question.question) >= 0.9,
      )
    ) {
      validationFailure(
        `Question ${index + 1} duplicates or closely paraphrases an accepted prompt.`,
        "duplicate_question",
      );
    }
    ids.add(question.id);
    prompts.push(question.question);
    if (question.type === "multiple_choice") {
      if (
        !Array.isArray(question.choices) ||
        question.choices.length !== 4 ||
        question.choices.some((choice) => !nonEmptyString(choice, 500)) ||
        new Set(question.choices.map(normalize)).size !== 4
      ) {
        validationFailure(
          `Question ${index + 1} must have four unique choices.`,
          "answer_mapping_invalid",
        );
      }
      if (
        !Number.isInteger(question.answerIndex) ||
        question.answerIndex < 0 ||
        question.answerIndex > 3 ||
        question.answer !== question.choices[question.answerIndex]
      ) {
        validationFailure(
          `Question ${index + 1} has an invalid answer mapping.`,
          "answer_mapping_invalid",
        );
      }
    } else if (question.type === "true_false") {
      if (
        typeof question.answer !== "boolean" ||
        question.answer !== input.trueFalseAnswerPlan[index] ||
        !nonEmptyString(question.correction, 700)
      ) {
        validationFailure(
          `Question ${index + 1} has an invalid true/false answer.`,
          "answer_mapping_invalid",
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
      ) ||
      !isCanonicalFormulaQuestion(question)
    ) {
      validationFailure(
        `Question ${index + 1} has an invalid short-answer rubric or formula.`,
      );
    }
    return question;
  });
  return { title: input.title, questions };
}

function validateQuestionTypes(questionTypes) {
  if (
    !Array.isArray(questionTypes) ||
    questionTypes.length < 1 ||
    questionTypes.length > SUPPORTED_QUESTION_TYPES.length ||
    new Set(questionTypes).size !== questionTypes.length ||
    questionTypes.some((type) => !SUPPORTED_QUESTION_TYPES.includes(type))
  ) {
    throw new Error("Choose at least one supported question type.");
  }
  return [...questionTypes];
}

function randomUint32FromSeed(seedHex) {
  let state = Number.parseInt(seedHex.slice(0, 8), 16) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function hexFromBytes(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return hexFromBytes(new Uint8Array(digest));
}

function balancedCounts(values, total, randomUint32) {
  const counts = new Map(
    values.map((value) => [value, Math.floor(total / values.length)]),
  );
  const extras = total % values.length;
  const extraOrder = shuffled(values, randomUint32);
  for (let index = 0; index < extras; index += 1) {
    const value = extraOrder[index];
    counts.set(value, counts.get(value) + 1);
  }
  return counts;
}

function sequenceFromCounts(first, counts, randomUint32) {
  const sequence = [first];
  counts.set(first, (counts.get(first) ?? 0) - 1);
  const fill = () => {
    const remaining = [...counts.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
    if (remaining === 0) return true;
    const recent = sequence.slice(-2);
    const candidates = [...counts.entries()]
      .filter(
        ([value, count]) =>
          count > 0 &&
          !(recent.length === 2 && recent.every((item) => item === value)),
      )
      .map(([value, count]) => ({ value, count, tie: randomUint32() }))
      .sort((left, right) => right.count - left.count || left.tie - right.tie);
    for (const candidate of candidates) {
      sequence.push(candidate.value);
      counts.set(candidate.value, candidate.count - 1);
      if (fill()) return true;
      counts.set(candidate.value, candidate.count);
      sequence.pop();
    }
    return false;
  };
  if (!fill()) throw new Error("Could not build a balanced question plan.");
  return sequence;
}

export function buildQuestionTypePlanFromSeed(
  questionTypes,
  questionCount,
  seedHex,
) {
  const selected = validateQuestionTypes(questionTypes);
  if (![5, 10, 15].includes(questionCount) || !/^[a-f0-9]{64}$/.test(seedHex)) {
    throw new Error("The seeded question plan input is invalid.");
  }
  if (selected.length === 1) {
    return Array.from({ length: questionCount }, () => selected[0]);
  }
  const randomUint32 = randomUint32FromSeed(seedHex);
  const counts = balancedCounts(selected, questionCount, randomUint32);
  return sequenceFromCounts(selected[0], counts, randomUint32);
}

export function buildTrueFalseAnswerPlanFromSeed(questionTypePlan, seedHex) {
  if (!/^[a-f0-9]{64}$/.test(seedHex)) {
    throw new Error("The true/false seed is invalid.");
  }
  const count = questionTypePlan.filter((type) => type === "true_false").length;
  if (count === 0) return questionTypePlan.map(() => null);
  const randomUint32 = randomUint32FromSeed(seedHex);
  const counts = balancedCounts([true, false], count, randomUint32);
  const preferredFirst = (randomUint32() & 1) === 0;
  const first =
    (counts.get(preferredFirst) ?? 0) > 0 ? preferredFirst : !preferredFirst;
  const answers = sequenceFromCounts(first, counts, randomUint32);
  let answerIndex = 0;
  return questionTypePlan.map((type) =>
    type === "true_false" ? answers[answerIndex++] : null,
  );
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
  const usageComplete =
    Number.isInteger(usage?.prompt_tokens) &&
    Number.isInteger(usage?.completion_tokens);
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
    usageComplete,
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
  if (!choice) {
    throw new GenerationFailure(
      "DeepSeek returned no completion choice.",
      "empty_content",
    );
  }
  if (choice.finish_reason === "length") {
    throw new GenerationFailure(
      "DeepSeek truncated the JSON response. No quiz was created.",
      "finish_length",
    );
  }
  if (choice.finish_reason !== "stop") {
    throw new GenerationFailure(
      "DeepSeek closed before completing the JSON response.",
      "network_interrupted",
      { transient: true },
    );
  }
  if (
    typeof choice.message?.content !== "string" ||
    !choice.message.content.trim()
  ) {
    throw new GenerationFailure(
      "DeepSeek returned empty JSON content.",
      "empty_content",
    );
  }
  return {
    quiz: strictJson(choice.message.content, "DeepSeek JSON response"),
    usage: usageMetrics(outer.usage),
  };
}

async function parseDeepSeekEventStream(response, onQuestion, fallbackTitle) {
  if (!response.body) {
    throw new GenerationFailure(
      "DeepSeek returned an empty streaming response.",
      "network_interrupted",
      { transient: true },
    );
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
    const availableTitle = fallbackTitle;
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
    const event = strictJson(
      data,
      "DeepSeek stream",
      "network_interrupted",
      true,
    );
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
    if (error instanceof GenerationFailure) throw error;
    throw new GenerationFailure(
      "The DeepSeek stream was interrupted before it finished.",
      "network_interrupted",
      { transient: true },
    );
  }
  if (eventBuffer.trim()) await processEvent(eventBuffer);
  await emitCompletedQuestions();
  if (!responseContent.trim()) {
    throw new GenerationFailure(
      "DeepSeek returned empty JSON content.",
      "empty_content",
    );
  }
  if (finishReason === "length") {
    throw new GenerationFailure(
      "DeepSeek truncated the JSON response. No quiz was created.",
      "finish_length",
    );
  }
  if (finishReason !== "stop") {
    throw new GenerationFailure(
      "DeepSeek closed before completing the JSON response.",
      "network_interrupted",
      { transient: true },
    );
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
  isTransientRetry,
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
        messages: generationMessages(input, isTransientRetry),
        thinking: { type: input.legacyMode ? "enabled" : "disabled" },
        ...(input.legacyMode ? { reasoning_effort: "high" } : {}),
        ...(input.legacyMode ? {} : { temperature: 0.2 }),
        response_format: { type: "json_object" },
        max_tokens: input.legacyMode
          ? 48_000
          : input.questionCount === 1
            ? 4_096
            : input.questionCount === 2
              ? 6_144
              : 8_192,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 408) {
        throw new GenerationFailure(
          "DeepSeek timed out before returning a question.",
          "timeout",
          {
            transient: true,
            retryAfterMs: retryAfterMilliseconds(
              response.headers.get("retry-after"),
            ),
          },
        );
      }
      if (response.status === 429 || response.status >= 500) {
        throw new GenerationFailure(
          `DeepSeek is temporarily unavailable (${response.status}).`,
          "transient_http",
          {
            transient: true,
            retryAfterMs: retryAfterMilliseconds(
              response.headers.get("retry-after"),
            ),
          },
        );
      }
      const reasonCode =
        response.status === 401 || response.status === 403
          ? "credential_required"
          : response.status === 402
            ? "billing_required"
            : "local_state_conflict";
      throw new GenerationFailure(
        reasonCode === "credential_required"
          ? "DeepSeek rejected the configured API key or its permissions."
          : reasonCode === "billing_required"
            ? "DeepSeek billing must be restored before generation can continue."
            : `DeepSeek rejected this generation request (${response.status}).`,
        reasonCode,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    const result = contentType.includes("text/event-stream")
      ? await parseDeepSeekEventStream(response, onQuestion, input.title)
      : parseCompletedJsonResponse(
          strictJson(
            await response.text(),
            "DeepSeek transport envelope",
            "network_interrupted",
            true,
          ),
        );
    if (!contentType.includes("text/event-stream")) {
      for (let index = 0; index < result.quiz.questions.length; index += 1) {
        await onQuestion(result.quiz.questions[index], index, input.title);
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
        throw new GenerationFailure(
          "Local generation was cancelled.",
          "local_state_conflict",
        );
      }
      throw new GenerationFailure(
        "DeepSeek took longer than 15 minutes.",
        "timeout",
        { transient: true },
      );
    }
    if (error instanceof GenerationFailure) throw error;
    if (error instanceof TypeError || error instanceof DOMException) {
      throw new GenerationFailure(
        "The DeepSeek connection was interrupted.",
        "network_interrupted",
        { transient: true },
      );
    }
    throw new GenerationFailure(
      error instanceof Error ? error.message : "DeepSeek could not be reached.",
      "schema_invalid",
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function validateQuestionPlan(plan, questionTypes, questionCount) {
  if (
    !plan ||
    typeof plan !== "object" ||
    !/^[a-f0-9]{64}$/.test(plan.seed) ||
    !Array.isArray(plan.types) ||
    plan.types.length !== questionCount
  ) {
    throw new GenerationFailure(
      "The saved question plan is invalid.",
      "local_state_conflict",
    );
  }
  const expected = buildQuestionTypePlanFromSeed(
    questionTypes,
    questionCount,
    plan.seed,
  );
  if (JSON.stringify(plan.types) !== JSON.stringify(expected)) {
    throw new GenerationFailure(
      "The saved question plan does not match this attempt.",
      "local_state_conflict",
    );
  }
  return { seed: plan.seed, types: [...plan.types] };
}

export function adaptiveChunkQuestionCount(
  questionTypePlan,
  startIndex,
  totalQuestions = questionTypePlan.length,
) {
  const remaining = totalQuestions - startIndex;
  if (remaining <= 0) return 0;
  if (startIndex === 0) return 1;
  const candidateCount = Math.min(3, remaining);
  const candidate = questionTypePlan.slice(
    startIndex,
    startIndex + candidateCount,
  );
  return candidate.includes("short_answer")
    ? Math.min(2, remaining)
    : candidateCount;
}

export async function generateQuizFromPlainText(
  rawInput,
  apiKey,
  onProgress = () => {},
  signal,
  onChunk = () => {},
  onCall = () => {},
) {
  const input = {
    title: String(rawInput?.title ?? "Untitled lesson").trim(),
    quizLanguage: String(rawInput?.quizLanguage ?? "en").trim(),
    questionCount: Number(rawInput?.questionCount ?? 15),
    questionTypes: rawInput?.questionTypes ?? SUPPORTED_QUESTION_TYPES,
    jobId: String(rawInput?.jobId ?? "standalone"),
    generationId:
      typeof rawInput?.generationId === "string"
        ? rawInput.generationId
        : globalThis.crypto.randomUUID(),
    generationSessionId:
      typeof rawInput?.generationSessionId === "string"
        ? rawInput.generationSessionId
        : globalThis.crypto.randomUUID(),
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
  const legacyMode =
    rawInput?.generationProfile === "legacy_reasoning_v5_1" ||
    input.continuation?.promptVersion === "quiz-local-json-stream-v5.0" ||
    input.continuation?.promptVersion === "quiz-local-json-stream-v5.1";
  const selectedTypes = validateQuestionTypes(input.questionTypes);
  let questionPlan;
  if (input.continuation?.questionPlan) {
    questionPlan = validateQuestionPlan(
      input.continuation.questionPlan,
      selectedTypes,
      input.questionCount,
    );
  } else if (legacyMode) {
    questionPlan = {
      seed: undefined,
      types: Array.from(
        { length: input.questionCount },
        (_, index) => selectedTypes[index % selectedTypes.length],
      ),
    };
  } else {
    const seed = await sha256Hex(
      `${input.generationId}:${input.jobId}:${input.transcriptFingerprint}:question-types`,
    );
    questionPlan = {
      seed,
      types: buildQuestionTypePlanFromSeed(
        selectedTypes,
        input.questionCount,
        seed,
      ),
    };
  }
  input.questionTypePlan = questionPlan.types;
  const polarityNonce = new Uint8Array(32);
  globalThis.crypto.getRandomValues(polarityNonce);
  const polaritySeed = await sha256Hex(
    `${input.generationSessionId}:${hexFromBytes(polarityNonce)}:true-false`,
  );
  input.trueFalseAnswerPlan = buildTrueFalseAnswerPlanFromSeed(
    input.questionTypePlan,
    polaritySeed,
  );
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
  const quizTitle = input.title;
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
  let automaticRetryUsed = false;
  let retryNextMissing = false;
  let callIndex = Number.isInteger(rawInput?.callIndexStart)
    ? rawInput.callIndexStart
    : 0;
  let lastChunkAt = Date.now();
  const metadata = legacyMode
    ? {
        protocolVersion: input.continuation?.resultProtocolVersion ?? 5,
        pipelineVersion: PIPELINE_VERSION,
        model: MODEL,
        reasoningEffort: "high",
        promptVersion:
          input.continuation?.promptVersion ?? "quiz-local-json-stream-v5.1",
        validatorVersion:
          input.continuation?.validatorVersion ??
          "validator-local-progressive-v4.0",
        importVersion: "extension-progressive-import-v3",
        generationProfile: "legacy_reasoning_v5_1",
      }
    : {
        protocolVersion: PROTOCOL_VERSION,
        pipelineVersion: PIPELINE_VERSION,
        model: MODEL,
        reasoningEffort: "none",
        promptVersion: PROMPT_VERSION,
        validatorVersion: VALIDATOR_VERSION,
        importVersion: IMPORT_VERSION,
        generationProfile: GENERATION_PROFILE,
        generationId: input.generationId,
        questionPlan,
      };

  while (acceptedQuestions.length < input.questionCount) {
    const questionOffset = acceptedQuestions.length;
    const acceptedBeforeCall = acceptedQuestions.length;
    const chunkQuestionCount = retryNextMissing
      ? 1
      : adaptiveChunkQuestionCount(
          input.questionTypePlan,
          questionOffset,
          input.questionCount,
        );
    const classification = retryNextMissing
      ? "automatic_retry"
      : continuationStartIndex > 0
        ? "manual_continuation"
        : "primary";
    if (classification === "automatic_retry") {
      totals.retryCount += 1;
      retryNextMissing = false;
    }
    const chunkInput = {
      ...input,
      legacyMode,
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
    const callAttempt = classification === "automatic_retry" ? 2 : 1;
    const chunkProgress = questionOffset / input.questionCount;
    onProgress("creating_questions", 0.2 + chunkProgress * 0.72, {
      attempt: callAttempt,
      maxAttempts: MAX_GENERATION_ATTEMPTS,
      status: classification === "automatic_retry" ? "retrying" : "generating",
    });
    totals.aiCalls += 1;
    const callStartedAt = Date.now();
    let outcome = "complete";
    let retryDelayMs = 0;
    let callUsage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      usageComplete: false,
    };
    let callFailure;
    let firstQuestionInCall = true;

    const publishQuestion = (rawQuestion, relativeIndex, title) => {
      const globalIndex = questionOffset + relativeIndex;
      if (globalIndex !== acceptedQuestions.length) {
        validationFailure(
          "DeepSeek streamed questions out of order.",
          "type_or_order_mismatch",
        );
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
      const validated = validateQuiz({ questions: [rawQuestion] }, singleInput);
      const question = randomizeQuestionAtPosition(
        validated.questions[0],
        answerPositionByQuestion.get(globalIndex),
      );
      acceptedQuestions.push(question);
      const chunkTime = Date.now();
      onChunk({
        ...metadata,
        title: quizTitle,
        startIndex: globalIndex,
        totalQuestions: input.questionCount,
        question,
        metrics: {
          aiCalls: legacyMode && firstQuestionInCall ? 1 : 0,
          retryCount:
            legacyMode &&
            firstQuestionInCall &&
            classification === "automatic_retry"
              ? 1
              : 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          elapsedMs: Math.max(1, chunkTime - lastChunkAt),
        },
      });
      firstQuestionInCall = false;
      lastChunkAt = chunkTime;
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
        classification === "automatic_retry",
        (question, relativeIndex, title) => {
          if (relativeIndex >= chunkQuestionCount) {
            validationFailure(
              "DeepSeek streamed too many questions.",
              "type_or_order_mismatch",
            );
          }
          publishQuestion(question, relativeIndex, title);
        },
      );
      validateQuiz(result.quiz, chunkInput);
      if (
        acceptedQuestions.length - acceptedBeforeCall !==
        chunkQuestionCount
      ) {
        validationFailure(
          "DeepSeek did not stream every requested question.",
          "truncated_json",
        );
      }
      callUsage = result.usage;
      totals.inputTokens += result.usage.inputTokens;
      totals.outputTokens += result.usage.outputTokens;
      totals.reasoningTokens += result.usage.reasoningTokens;
    } catch (error) {
      callFailure =
        error instanceof GenerationFailure
          ? error
          : new GenerationFailure(
              error instanceof Error
                ? error.message
                : "The generated quiz was invalid.",
              "schema_invalid",
            );
      outcome = callFailure.reasonCode;
      const acceptedInCall = acceptedQuestions.length - acceptedBeforeCall;
      if (acceptedInCall === chunkQuestionCount) {
        // Every requested object is already independently validated and
        // persisted by the caller. A broken closing envelope cannot create a
        // missing suffix, so continuing with the next primary chunk is safer
        // and cheaper than spending the transport retry budget.
        callFailure = undefined;
      } else if (callFailure.transient && !automaticRetryUsed) {
        automaticRetryUsed = true;
        retryDelayMs = boundedRetryDelayMilliseconds(
          1,
          callFailure.retryAfterMs,
        );
      }
    }

    await onCall({
      generationSessionId: input.generationSessionId,
      callIndex,
      startIndex: questionOffset,
      requestedCount: chunkQuestionCount,
      acceptedCount: acceptedQuestions.length - acceptedBeforeCall,
      classification,
      outcome,
      retryDelayMs,
      elapsedMs: Math.max(0, Date.now() - callStartedAt),
      ...(callUsage.usageComplete
        ? {
            inputTokens: callUsage.inputTokens,
            outputTokens: callUsage.outputTokens,
            reasoningTokens: callUsage.reasoningTokens,
          }
        : {}),
      usageComplete: callUsage.usageComplete,
    });
    callIndex += 1;

    if (!callFailure) continue;
    if (callFailure.transient && retryDelayMs > 0) {
      retryNextMissing = true;
      onProgress(
        "creating_questions",
        0.2 + (acceptedQuestions.length / input.questionCount) * 0.72,
        {
          attempt: 2,
          maxAttempts: MAX_GENERATION_ATTEMPTS,
          status: "retrying",
          retryDelayMs,
          reasonCode: callFailure.reasonCode,
        },
      );
      await waitForRetry(retryDelayMs, signal);
      continue;
    }
    throw callFailure;
  }

  const metrics = {
    ...totals,
    elapsedMs: Math.max(1, Date.now() - startedAt),
  };
  if (continuationStartIndex > 0) {
    return {
      ...metadata,
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
    ...metadata,
    quiz: completeQuiz,
    metrics,
  };
}

async function waitForRetry(milliseconds, signal) {
  if (signal?.aborted) {
    throw new GenerationFailure(
      "Local generation was cancelled.",
      "local_state_conflict",
    );
  }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(
        new GenerationFailure(
          "Local generation was cancelled.",
          "local_state_conflict",
        ),
      );
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
  onCall = () => {},
) {
  const plainText = captionsToPlainText(context?.segments);
  return generateQuizFromPlainText(
    {
      title: context?.title,
      quizLanguage: context?.quizLanguage,
      questionCount: context?.questionCount,
      questionTypes: context?.questionTypes,
      jobId: context?.jobId,
      generationId: context?.generationId,
      generationSessionId: context?.generationSessionId,
      generationProfile: context?.generationProfile,
      transcriptFingerprint: context?.transcriptFingerprint,
      plainText,
      continuation: context?.continuation,
    },
    apiKey,
    onProgress,
    signal,
    onChunk,
    onCall,
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
