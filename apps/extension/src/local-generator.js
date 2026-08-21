import { captionsToPlainText } from "./caption-text.js";

const MODEL = "deepseek-v4-flash";
const PROTOCOL_VERSION = 7;
const PIPELINE_VERSION = 9;
const PROMPT_VERSION = "quiz-local-json-stream-v5.3";
const VALIDATOR_VERSION = "validator-local-progressive-v4.2";
const IMPORT_VERSION = "extension-progressive-import-v5";
const GENERATION_PROFILE = "stable_auto_recovery_v5_3";
const REQUEST_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_TRANSCRIPT_CHARACTERS = 320_000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;
const MAX_TRANSPORT_RETRIES_PER_ORDINAL = 4;
const MAX_CONTENT_RETRIES_PER_ORDINAL = 2;
const MAX_AUTOMATIC_RETRIES = 12;
const MAX_ACTIVE_RECOVERY_MS = 15 * 60 * 1_000;
const LEGACY_MAX_GENERATION_ATTEMPTS = 2;
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
  consecutiveFailures,
  retryAfterMs = 0,
  random = () => 0.5,
) {
  const exponent = Math.max(0, Math.min(6, consecutiveFailures - 1));
  const jitter = 0.75 + Math.max(0, Math.min(1, random())) * 0.5;
  const exponentialDelay = Math.ceil(750 * 2 ** exponent * jitter);
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

const FORMULA_TOKEN_KINDS = new Set([
  "identifier",
  "number",
  "operator",
  "left_paren",
  "right_paren",
  "comma",
  "prime",
]);
const FORMULA_OPERATORS = new Set(["+", "-", "*", "/", "^", "="]);

function formulaTokenSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", "value"],
    properties: {
      kind: { enum: [...FORMULA_TOKEN_KINDS] },
      value: { type: "string" },
    },
  };
}

function questionSchemaForType(type, id, automaticMode = false) {
  const properties = {
    id: { const: id },
    type: { const: type },
    concept: { type: "string" },
    question: { type: "string" },
    explanation: { type: "string" },
  };
  const required = ["id", "type", "concept", "question", "explanation"];
  if (type === "multiple_choice") {
    Object.assign(
      properties,
      automaticMode
        ? {
            correctAnswer: { type: "string" },
            distractors: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: { type: "string" },
            },
          }
        : {
            choices: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: { type: "string" },
            },
            answerIndex: { type: "integer", minimum: 0, maximum: 3 },
            answer: { type: "string" },
          },
    );
    if (automaticMode) {
      required.push("correctAnswer", "distractors");
    } else {
      required.push("choices", "answerIndex", "answer");
    }
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
      formulaTokens: {
        type: "array",
        minItems: 1,
        maxItems: 96,
        items: formulaTokenSchema(),
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
          questionSchemaForType(
            type,
            `q${input.questionOffset + index + 1}`,
            input.automaticMode,
          ),
        ),
        items: false,
      },
    },
  };
}

function exampleQuestion(type, id, polarity, automaticMode = false) {
  const common = {
    id,
    type,
    concept: "lesson concept",
    question: "A self-contained question grounded in the lesson?",
    explanation: "A concise lesson-grounded explanation.",
  };
  if (type === "multiple_choice") {
    if (automaticMode) {
      return {
        ...common,
        correctAnswer: "supported answer",
        distractors: ["distractor A", "distractor B", "distractor C"],
      };
    }
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
        input.automaticMode,
      ),
    ),
  };
  const requestPurpose = isTransientRetry
    ? "an automatic repair request for"
    : "the primary request for";
  return [
    {
      role: "system",
      content: `You create rigorous quizzes from a supplied lesson transcript. Use only claims explicitly supported by that transcript. Ignore greetings, promotions, jokes, repeated filler, and transcription noise. Never infer unseen visuals or add outside facts. Questions must be self-contained, specific, pedagogically useful, and must not mention captions, timestamps, or the video.

Return JSON only: one JSON object containing a questions array. Finish each question object before starting the next. ${input.automaticMode ? "For multiple choice, return one correctAnswer and exactly three unique distractors; ClipQuest assigns the stored choice order and answer index locally." : "Multiple-choice questions need four unique plausible choices, exactly one supported answer, and answer must equal choices[answerIndex]."} True/false questions need the assigned polarity and a correction or confirmation. Short answers need a complete answer, every required rubric idea, and optional equivalent answers. A formula answer must be a standalone canonical formula. For a formula question, also return formulaTokens: a bounded ordered token list using identifier, number, operator, left_paren, right_paren, comma, and prime; its locally serialized expression must exactly match answer after Unicode operator normalization. Use explicit * and ^ operators and parenthesize both sides of division, for example (f(b)-f(a))/(b-a). Put notation variants only in acceptableAnswers. Omit formulaTokens for prose answers. Never include fields for another question type.`,
    },
    {
      role: "user",
      content: `Lesson title: ${input.title}\nQuiz language: ${input.quizLanguage}\n\nComplete plain-text lesson transcript:\n${input.plainText}`,
    },
    {
      role: "user",
      content: `Create exactly ${input.questionCount} consecutive questions for this JSON task. This is ${requestPurpose} position q${input.questionOffset + 1} of ${input.totalQuestionCount}.${input.repairGuidance ? ` Repair requirement: ${input.repairGuidance}` : ""}

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

function normalizeFormulaTokens(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return value;
  return value.map((rawToken) => {
    if (!rawToken || typeof rawToken !== "object" || Array.isArray(rawToken)) {
      return rawToken;
    }
    return {
      kind: cleanString(rawToken.kind),
      value: cleanString(rawToken.value),
    };
  });
}

export function normalizeGeneratedQuestion(
  rawQuestion,
  { expectedId, automaticMode = false } = {},
) {
  if (
    !rawQuestion ||
    typeof rawQuestion !== "object" ||
    Array.isArray(rawQuestion)
  ) {
    return rawQuestion;
  }
  const type = cleanString(rawQuestion.type);
  const common = {
    id: automaticMode && expectedId ? expectedId : cleanString(rawQuestion.id),
    type,
    concept: cleanString(rawQuestion.concept),
    question: cleanString(rawQuestion.question),
    explanation: cleanString(rawQuestion.explanation),
  };
  if (type === "multiple_choice") {
    if (automaticMode) {
      const legacyChoices = cleanStringArray(rawQuestion.choices);
      const legacyAnswer = cleanString(rawQuestion.answer);
      const legacyMatches = Array.isArray(legacyChoices)
        ? legacyChoices.filter(
            (choice) =>
              typeof choice === "string" &&
              typeof legacyAnswer === "string" &&
              normalize(choice) === normalize(legacyAnswer),
          )
        : [];
      const correctAnswer =
        cleanString(rawQuestion.correctAnswer) ??
        (legacyMatches.length === 1 ? legacyMatches[0] : undefined);
      const distractors = Array.isArray(rawQuestion.distractors)
        ? cleanStringArray(rawQuestion.distractors)
        : Array.isArray(legacyChoices) && correctAnswer
          ? legacyChoices.filter(
              (choice) => normalize(choice) !== normalize(correctAnswer),
            )
          : rawQuestion.distractors;
      return {
        ...common,
        correctAnswer,
        distractors,
      };
    }
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
      formulaTokens: normalizeFormulaTokens(rawQuestion.formulaTokens),
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

function requiresCanonicalFormula(question) {
  const prompt = question.question.toLocaleLowerCase("en-US");
  return /formula|equation|expression|derivative|rate of change|公式|方程|导数/.test(
    prompt,
  );
}

function normalizedFormulaText(value) {
  return value
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (superscript) => {
      const mapped = {
        "⁰": "0",
        "¹": "1",
        "²": "2",
        "³": "3",
        "⁴": "4",
        "⁵": "5",
        "⁶": "6",
        "⁷": "7",
        "⁸": "8",
        "⁹": "9",
        "⁺": "+",
        "⁻": "-",
      };
      return `^${[...superscript].map((character) => mapped[character]).join("")}`;
    })
    .normalize("NFKC")
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[′’]/g, "'")
    .replace(/[\[\{［【]/g, "(")
    .replace(/[\]\}］】]/g, ")")
    .replace(/\s+/g, "");
}

export function serializeFormulaTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length < 1 || tokens.length > 96) {
    return null;
  }
  const values = [];
  let depth = 0;
  for (const token of tokens) {
    if (
      !token ||
      typeof token !== "object" ||
      Array.isArray(token) ||
      !FORMULA_TOKEN_KINDS.has(token.kind) ||
      typeof token.value !== "string"
    ) {
      return null;
    }
    const value = normalizedFormulaText(token.value);
    if (
      (token.kind === "identifier" &&
        !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(value)) ||
      (token.kind === "number" && !/^\d+(?:\.\d+)?$/.test(value)) ||
      (token.kind === "operator" && !FORMULA_OPERATORS.has(value)) ||
      (token.kind === "left_paren" && value !== "(") ||
      (token.kind === "right_paren" && value !== ")") ||
      (token.kind === "comma" && value !== ",") ||
      (token.kind === "prime" && value !== "'")
    ) {
      return null;
    }
    if (token.kind === "left_paren") depth += 1;
    if (token.kind === "right_paren" && --depth < 0) return null;
    values.push(value);
  }
  if (depth !== 0) return null;
  const expression = values.join("");
  if (
    !expression ||
    !hasBalancedDelimiters(expression) ||
    !/[=+\-*/^']/.test(expression) ||
    /^[+*/^=,)]/.test(expression) ||
    /[+\-*/^=,(]$/.test(expression) ||
    /(?:[+*/^=,]){2}|(?:[-]){2,}/.test(expression) ||
    /\(\)/.test(expression)
  ) {
    return null;
  }
  for (let index = 0; index < expression.length; index += 1) {
    if (
      expression[index] === "/" &&
      (expression[index - 1] !== ")" || expression[index + 1] !== "(")
    ) {
      return null;
    }
  }
  return expression;
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
    const expectedId = `q${input.questionOffset + index + 1}`;
    const question = normalizeGeneratedQuestion(rawQuestion, {
      expectedId,
      automaticMode: input.automaticMode,
    });
    if (!question || typeof question !== "object" || Array.isArray(question)) {
      validationFailure(`Question ${index + 1} is not a JSON object.`);
    }
    const expectedType = input.questionTypePlan[index];
    if (
      question.type !== expectedType ||
      question.id !== expectedId ||
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
      if (input.automaticMode) {
        const candidateChoices = [
          question.correctAnswer,
          ...(Array.isArray(question.distractors) ? question.distractors : []),
        ];
        if (
          !nonEmptyString(question.correctAnswer, 500) ||
          !Array.isArray(question.distractors) ||
          question.distractors.length !== 3 ||
          candidateChoices.some((choice) => !nonEmptyString(choice, 500)) ||
          new Set(candidateChoices.map(normalize)).size !== 4
        ) {
          validationFailure(
            `Question ${index + 1} must have one unambiguous correct answer and three unique distractors.`,
            "answer_mapping_invalid",
          );
        }
        const { correctAnswer, distractors, ...storedQuestion } = question;
        return {
          ...storedQuestion,
          choices: candidateChoices,
          answerIndex: 0,
          answer: correctAnswer,
        };
      }
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
      )
    ) {
      validationFailure(
        `Question ${index + 1} has an invalid short-answer rubric or formula.`,
      );
    }
    if (question.type === "short_answer") {
      const formulaRequired = requiresCanonicalFormula(question);
      const serializedFormula = serializeFormulaTokens(question.formulaTokens);
      if (
        (formulaRequired && !serializedFormula) ||
        (question.formulaTokens !== undefined && !serializedFormula) ||
        (serializedFormula &&
          normalizedFormulaText(question.answer) !== serializedFormula)
      ) {
        validationFailure(
          `Question ${index + 1} has an invalid or conflicting formula token structure.`,
        );
      }
      const { formulaTokens: _formulaTokens, ...storedQuestion } = question;
      return serializedFormula
        ? { ...storedQuestion, answer: serializedFormula }
        : storedQuestion;
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
    recoverySessionId:
      typeof rawInput?.recoverySessionId === "string"
        ? rawInput.recoverySessionId
        : globalThis.crypto.randomUUID(),
    generationProfile: rawInput?.generationProfile,
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
  const stableV52Mode =
    !legacyMode &&
    (rawInput?.generationProfile === "stable_non_thinking_v5_2" ||
      input.continuation?.promptVersion === "quiz-local-json-stream-v5.2");
  const automaticMode = !legacyMode && !stableV52Mode;
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
    : Number.isInteger(input.continuation?.nextCallIndex)
      ? input.continuation.nextCallIndex
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
    : stableV52Mode
      ? {
          protocolVersion: 6,
          pipelineVersion: PIPELINE_VERSION,
          model: MODEL,
          reasoningEffort: "none",
          promptVersion: "quiz-local-json-stream-v5.2",
          validatorVersion: "validator-local-progressive-v4.1",
          importVersion: "extension-progressive-import-v4",
          generationProfile: "stable_non_thinking_v5_2",
          generationId: input.generationId,
          questionPlan,
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
          generationSessionId: input.generationSessionId,
          recoverySessionId: input.recoverySessionId,
          questionPlan,
        };

  if (automaticMode) {
    return generateAutomaticQuiz({
      input,
      apiKey,
      onProgress,
      signal,
      onChunk,
      onCall,
      metadata,
      questionPlan,
      acceptedQuestions,
      trueFalseAnswerPlan: input.trueFalseAnswerPlan,
      answerPositionByQuestion,
      continuationStartIndex,
      startedAt,
      totals,
      initialCallIndex: Number.isInteger(rawInput?.callIndexStart)
        ? rawInput.callIndexStart
        : Number.isInteger(input.continuation?.nextCallIndex)
          ? input.continuation.nextCallIndex
          : 0,
      initialOrdinalAttempt: Number.isInteger(rawInput?.ordinalAttemptStart)
        ? rawInput.ordinalAttemptStart
        : Number.isInteger(input.continuation?.nextOrdinalAttempt)
          ? input.continuation.nextOrdinalAttempt
          : 1,
      initialRetryKind: rawInput?.retryKind ?? input.continuation?.retryKind,
      initialAutomaticRetryCount: Number.isInteger(
        rawInput?.automaticRetryCount,
      )
        ? rawInput.automaticRetryCount
        : Number.isInteger(input.continuation?.automaticRetryCount)
          ? input.continuation.automaticRetryCount
          : 0,
      lastChunkAt,
    });
  }

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
      maxAttempts: LEGACY_MAX_GENERATION_ATTEMPTS,
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

    const publishQuestion = async (rawQuestion, relativeIndex, title) => {
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
      await onChunk({
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
          maxAttempts: LEGACY_MAX_GENERATION_ATTEMPTS,
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
          maxAttempts: LEGACY_MAX_GENERATION_ATTEMPTS,
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

async function generateAutomaticQuiz({
  input,
  apiKey,
  onProgress,
  signal,
  onChunk,
  onCall,
  metadata,
  acceptedQuestions,
  trueFalseAnswerPlan,
  answerPositionByQuestion,
  continuationStartIndex,
  startedAt,
  totals,
  initialCallIndex,
  initialOrdinalAttempt,
  initialRetryKind,
  lastChunkAt: initialLastChunkAt,
  initialAutomaticRetryCount = 0,
}) {
  let callIndex = initialCallIndex;
  let ordinalAttempt = initialOrdinalAttempt;
  let retryKind = ordinalAttempt > 1 ? initialRetryKind : undefined;
  let automaticRetryCount = initialAutomaticRetryCount;
  let lastChunkAt = initialLastChunkAt;

  while (acceptedQuestions.length < input.questionCount) {
    if (Date.now() - startedAt > MAX_ACTIVE_RECOVERY_MS) {
      throw new GenerationFailure(
        "Automatic generation reached its active recovery time limit.",
        "recovery_budget_exhausted",
      );
    }
    const questionOffset = acceptedQuestions.length;
    const classification = ordinalAttempt > 1 ? "automatic_retry" : "primary";
    const callRetryKind = retryKind;
    if (classification === "automatic_retry") {
      if (!retryKind || automaticRetryCount >= MAX_AUTOMATIC_RETRIES) {
        throw new GenerationFailure(
          "Automatic generation reached its retry budget.",
          "recovery_budget_exhausted",
        );
      }
      automaticRetryCount += 1;
      totals.retryCount += 1;
    }
    const chunkInput = {
      ...input,
      automaticMode: true,
      legacyMode: false,
      questionCount: 1,
      totalQuestionCount: input.questionCount,
      questionOffset,
      questionTypePlan: input.questionTypePlan.slice(
        questionOffset,
        questionOffset + 1,
      ),
      trueFalseAnswerPlan: trueFalseAnswerPlan.slice(
        questionOffset,
        questionOffset + 1,
      ),
      acceptedQuestions: [...acceptedQuestions],
      repairGuidance: repairGuidanceFor(callRetryKind),
    };
    const maximumRetries = retryLimitForKind(retryKind);
    onProgress(
      "creating_questions",
      0.2 + (questionOffset / input.questionCount) * 0.72,
      {
        attempt: ordinalAttempt,
        maxAttempts: maximumRetries + 1,
        status:
          classification === "automatic_retry" ? "retrying" : "generating",
        ...(classification === "automatic_retry"
          ? {
              retryOrdinal: questionOffset + 1,
              ordinalAttempt,
              retryKind,
              recoverySessionId: input.recoverySessionId,
            }
          : {}),
      },
    );

    totals.aiCalls += 1;
    const callStartedAt = Date.now();
    let outcome = "complete";
    let retryDelayMs = 0;
    let callFailure;
    let nextRetryKind;
    let callUsage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      usageComplete: false,
    };
    const acceptedBeforeCall = acceptedQuestions.length;
    const publishQuestion = async (rawQuestion, relativeIndex) => {
      if (relativeIndex !== 0 || acceptedQuestions.length !== questionOffset) {
        validationFailure(
          "DeepSeek streamed a singleton question out of order.",
          "type_or_order_mismatch",
        );
      }
      const validated = validateQuiz({ questions: [rawQuestion] }, chunkInput);
      const question = randomizeQuestionAtPosition(
        validated.questions[0],
        answerPositionByQuestion.get(questionOffset),
      );
      acceptedQuestions.push(question);
      const chunkTime = Date.now();
      await onChunk({
        ...metadata,
        title: input.title,
        startIndex: questionOffset,
        totalQuestions: input.questionCount,
        question,
        metrics: {
          aiCalls: 0,
          retryCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          elapsedMs: Math.max(1, chunkTime - lastChunkAt),
        },
      });
      lastChunkAt = chunkTime;
    };

    try {
      const result = await callDeepSeekJson(
        chunkInput,
        apiKey,
        signal,
        classification === "automatic_retry",
        publishQuestion,
      );
      validateQuiz(result.quiz, chunkInput);
      if (acceptedQuestions.length !== acceptedBeforeCall + 1) {
        validationFailure(
          "DeepSeek did not stream the requested singleton question.",
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
                : "The generated question was invalid.",
              "schema_invalid",
            );
      outcome = callFailure.reasonCode;
      if (acceptedQuestions.length === acceptedBeforeCall + 1) {
        callFailure = undefined;
        outcome = "complete";
      } else {
        const nextKind = automaticRetryKindForFailure(callFailure.reasonCode);
        const retryNumber = ordinalAttempt;
        const limit =
          nextKind === "transport"
            ? MAX_TRANSPORT_RETRIES_PER_ORDINAL
            : MAX_CONTENT_RETRIES_PER_ORDINAL;
        const canRetry =
          nextKind &&
          retryNumber <= limit &&
          automaticRetryCount < MAX_AUTOMATIC_RETRIES &&
          Date.now() - startedAt < MAX_ACTIVE_RECOVERY_MS;
        if (canRetry) {
          nextRetryKind = nextKind;
          retryDelayMs =
            nextKind === "transport"
              ? boundedRetryDelayMilliseconds(
                  retryNumber,
                  callFailure.retryAfterMs,
                  () => secureRandomUint32() / 0x1_0000_0000,
                )
              : boundedRetryDelayMilliseconds(
                  retryNumber,
                  0,
                  () => secureRandomUint32() / 0x1_0000_0000,
                ) / 3;
          retryDelayMs = Math.max(150, Math.round(retryDelayMs));
        }
      }
    }

    await onCall({
      protocolVersion: PROTOCOL_VERSION,
      generationSessionId: input.generationSessionId,
      recoverySessionId: input.recoverySessionId,
      callIndex,
      startIndex: questionOffset,
      ordinalAttempt,
      requestedCount: 1,
      acceptedCount: acceptedQuestions.length - acceptedBeforeCall,
      classification,
      ...(classification === "automatic_retry"
        ? { retryKind: callRetryKind }
        : {}),
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

    if (!callFailure) {
      ordinalAttempt = 1;
      retryKind = undefined;
      const complete = acceptedQuestions.length === input.questionCount;
      onProgress(
        complete ? "finalizing_questions" : "creating_questions",
        complete
          ? 1
          : 0.2 + (acceptedQuestions.length / input.questionCount) * 0.72,
        {
          attempt: 1,
          maxAttempts: 1,
          status: complete ? "complete" : "generating",
          recoverySessionId: input.recoverySessionId,
        },
      );
      continue;
    }
    if (!nextRetryKind || retryDelayMs <= 0) throw callFailure;
    retryKind = nextRetryKind;
    ordinalAttempt += 1;
    onProgress(
      "creating_questions",
      0.2 + (acceptedQuestions.length / input.questionCount) * 0.72,
      {
        attempt: ordinalAttempt,
        maxAttempts: retryLimitForKind(nextRetryKind) + 1,
        status: "retrying",
        retryOrdinal: questionOffset + 1,
        ordinalAttempt,
        retryKind,
        retryDelayMs,
        reasonCode: callFailure.reasonCode,
        recoverySessionId: input.recoverySessionId,
      },
    );
    await waitForRetry(retryDelayMs, signal);
  }

  const metrics = {
    ...totals,
    elapsedMs: Math.max(1, Date.now() - startedAt),
  };
  if (continuationStartIndex > 0) {
    return {
      ...metadata,
      title: input.title,
      generatedStartIndex: continuationStartIndex,
      totalQuestions: input.questionCount,
      metrics,
    };
  }
  return {
    ...metadata,
    quiz: { title: input.title, questions: acceptedQuestions },
    metrics,
  };
}

function automaticRetryKindForFailure(reasonCode) {
  if (
    ["transient_http", "network_interrupted", "timeout"].includes(reasonCode)
  ) {
    return "transport";
  }
  if (reasonCode === "empty_content") return "empty_content";
  if (["truncated_json", "finish_length"].includes(reasonCode)) {
    return "truncated_output";
  }
  if (reasonCode === "duplicate_question") return "duplicate_repair";
  if (reasonCode === "answer_mapping_invalid") return "answer_repair";
  if (["schema_invalid", "type_or_order_mismatch"].includes(reasonCode)) {
    return "content_repair";
  }
  return null;
}

function retryLimitForKind(retryKind) {
  return retryKind === "transport" || retryKind === "automatic_resume"
    ? MAX_TRANSPORT_RETRIES_PER_ORDINAL
    : MAX_CONTENT_RETRIES_PER_ORDINAL;
}

function repairGuidanceFor(retryKind) {
  const guidance = {
    transport: "Repeat the same singleton JSON task exactly.",
    empty_content: "Return the required non-empty JSON object immediately.",
    truncated_output:
      "Keep every field concise and close the singleton JSON object.",
    content_repair:
      "Follow the exact singleton type schema and required fields.",
    duplicate_repair:
      "Use a different supported concept and do not paraphrase any accepted prompt.",
    answer_repair:
      "Make the correct answer and distractors distinct and unambiguous.",
    automatic_resume: "Resume only this first missing singleton question.",
  };
  return retryKind ? guidance[retryKind] : undefined;
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
      recoverySessionId: context?.recoverySessionId,
      generationProfile: context?.generationProfile,
      transcriptFingerprint: context?.transcriptFingerprint,
      plainText,
      continuation: context?.continuation,
      callIndexStart: context?.continuation?.nextCallIndex,
      ordinalAttemptStart: context?.continuation?.nextOrdinalAttempt,
      retryKind: context?.continuation?.retryKind,
      automaticRetryCount: context?.continuation?.automaticRetryCount,
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
