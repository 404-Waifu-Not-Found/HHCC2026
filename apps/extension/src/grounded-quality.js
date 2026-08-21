import { formulaFingerprint } from "./math-expression.js";

const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "by",
  "can",
  "does",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "lesson",
  "of",
  "on",
  "or",
  "question",
  "result",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "which",
  "with",
]);

const LOGISTICS_PATTERNS = [
  /\b(?:office hours?|teaching assistants?|t\.?a\.?s?|complaints?|syllabus|grading|grade policy|course roadmap|course website|class website|homework|assignments?|essays?|prerequisites?|required readings?|textbooks?|share (?:the )?book|email me|contact me|subscribe|sponsor(?:ed)?|promo code|welcome back|my name is|i(?:'m| am) your (?:teacher|instructor|professor))\b/iu,
  /(?:课程安排|课程大纲|助教|办公时间|作业|评分|教材|投诉|订阅|赞助|推广|欢迎来到|讲师介绍)/u,
];

const INSTRUCTIONAL_PATTERNS = [
  /\b(?:means?|defined as|definition|therefore|because|causes?|results? in|for example|consider|calculate|equation|formula|derivative|integral|theorem|principle|process|mechanism|function|system|evidence|experiment|observed|measured)\b/iu,
  /(?:定义|意味着|因此|因为|导致|例如|公式|方程|导数|积分|定理|原理|过程|机制|函数|系统|实验|测量)/u,
];

const SEMANTIC_ALIASES = [
  [/\b(?:the )?slope of (?:the )?secant line\b/giu, "average rate of change"],
  [
    /\b(?:the )?difference in (?:the )?y[- ]?values? divided by (?:the )?difference in (?:the )?x[- ]?values?\b/giu,
    "average rate of change",
  ],
  [
    /\bchange in (?:output|dependent variable) divided by change in (?:input|independent variable)\b/giu,
    "average rate of change",
  ],
  [/\bdifference quotient\b/giu, "average rate of change"],
  [/\bdeoxyribonucleic acid\b/giu, "dna"],
  [/\bribonucleic acid\b/giu, "rna"],
];

export function normalizeGroundedText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[′’‵]/gu, "'")
    .replace(/[−–—﹣－]/gu, "-")
    .replace(/[×·∙⋅＊]/gu, "*")
    .replace(/[÷／]/gu, "/")
    .replace(/[^\p{L}\p{N}'+*/^=<>-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function evidenceAppearsInText(evidence, source) {
  const normalizedEvidence = normalizeGroundedText(evidence);
  const normalizedSource = normalizeGroundedText(source);
  return (
    normalizedEvidence.length >= 12 &&
    normalizedEvidence.length <= 700 &&
    normalizedSource.includes(normalizedEvidence)
  );
}

function sentenceUnits(plainText) {
  const normalized = String(plainText ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+(?=[\p{L}\p{N}])/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (sentences.length <= 1) {
    return (
      normalized
        .match(/[\s\S]{1,700}(?:\s|$)/g)
        ?.map((value) => value.trim()) ?? [normalized]
    );
  }
  return sentences;
}

function instructionalScore(value) {
  const text = String(value ?? "");
  let score = 0;
  for (const pattern of INSTRUCTIONAL_PATTERNS) {
    if (pattern.test(text)) score += 4;
  }
  for (const pattern of LOGISTICS_PATTERNS) {
    if (pattern.test(text)) score -= 12;
  }
  if (/[=+*/^≤≥≈]|\b\d+(?:\.\d+)?\b/u.test(text)) score += 2;
  if (text.length >= 80 && text.length <= 650) score += 2;
  if (
    /\b(?:hello|hi everyone|thanks for watching|see you next)\b/iu.test(text)
  ) {
    score -= 5;
  }
  return score;
}

/**
 * Build bounded lesson excerpts while filtering administrative and promotional
 * transcript material. The original transcript remains the authoritative
 * prompt prefix; these excerpts are the only spans v5.4 questions may cite.
 */
export function buildInstructionalExcerpts(plainText) {
  const rawSentences = sentenceUnits(plainText);
  const scoredSentences = rawSentences.map((text) => ({
    text,
    score: instructionalScore(text),
  }));
  const hasInstructionalMaterial = scoredSentences.some(
    (entry) => entry.score > 0,
  );
  const sentences = hasInstructionalMaterial
    ? scoredSentences
        .filter((entry) => entry.score >= 0)
        .map((entry) => entry.text)
    : rawSentences;
  const groups = [];
  let current = [];
  let currentLength = 0;
  for (const sentence of sentences) {
    if (current.length && currentLength + sentence.length > 900) {
      groups.push(current.join(" "));
      current = [];
      currentLength = 0;
    }
    current.push(sentence);
    currentLength += sentence.length + 1;
    if (currentLength >= 360) {
      groups.push(current.join(" "));
      current = [];
      currentLength = 0;
    }
  }
  if (current.length) groups.push(current.join(" "));
  if (!groups.length && String(plainText ?? "").trim()) {
    groups.push(String(plainText).trim().slice(0, 900));
  }
  const ranked = groups
    .map((text, index) => ({ text, index, score: instructionalScore(text) }))
    .filter((entry) => entry.score > -8);
  const candidates = ranked.length
    ? ranked
    : groups.map((text, index) => ({
        text,
        index,
        score: 0,
      }));
  return candidates
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.text.slice(0, 1_200));
}

export function focusExcerptForOrdinal(
  plainText,
  ordinal,
  totalQuestions,
  repairCycle = 0,
) {
  const excerpts = buildInstructionalExcerpts(plainText);
  if (!excerpts.length) return String(plainText ?? "").slice(0, 1_200);
  const base = Math.min(
    excerpts.length - 1,
    Math.floor(
      ((ordinal + 0.5) / Math.max(1, totalQuestions)) * excerpts.length,
    ),
  );
  const direction = repairCycle % 2 === 0 ? 1 : -1;
  const distance = Math.ceil(repairCycle / 2);
  const index =
    (base + direction * distance + excerpts.length) % excerpts.length;
  const neighbors = [excerpts[index]];
  if (excerpts[index + 1]) neighbors.push(excerpts[index + 1]);
  return neighbors.join(" ").slice(0, 2_400).trim();
}

function semanticTokens(value) {
  const normalized = normalizeGroundedText(value);
  const words = normalized
    .split(/\s+/u)
    .filter(
      (token) =>
        token &&
        !ENGLISH_STOP_WORDS.has(token) &&
        (!/^\p{L}$/u.test(token) || /[\u3400-\u9fff]/u.test(token)),
    );
  const cjk = [...normalized.replace(/[^\u3400-\u9fff]/gu, "")];
  const cjkBigrams = cjk
    .slice(0, -1)
    .map((character, index) => `${character}${cjk[index + 1]}`);
  return new Set([...words, ...cjkBigrams]);
}

function jaccard(left, right) {
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / union.size;
}

export function conceptSimilarity(left, right) {
  return jaccard(semanticTokens(left), semanticTokens(right));
}

export function claimKeyForCandidate(candidate) {
  const claim = candidate?.claim;
  const parts = claim
    ? [claim.subject, claim.relation, claim.value]
    : [candidate?.concept, candidate?.question];
  return normalizeGroundedText(parts.filter(Boolean).join(" | ")).slice(0, 300);
}

export function conceptClusterForCandidate(candidate) {
  const raw = candidate?.claim?.cluster ?? candidate?.concept ?? "";
  return [...semanticTokens(raw)].sort().slice(0, 12).join(" ").slice(0, 200);
}

export function candidateDuplicatesAccepted(
  candidate,
  accepted,
  totalQuestions,
) {
  const claimKey = claimKeyForCandidate(candidate);
  const cluster = conceptClusterForCandidate(candidate);
  if (!claimKey || !cluster) return true;
  if (accepted.some((question) => question.claimKey === claimKey)) return true;
  if (
    accepted.some(
      (question) =>
        question.claimKey &&
        conceptSimilarity(question.claimKey, claimKey) >= 0.65,
    )
  ) {
    return true;
  }
  const clusterMatches = accepted.filter((question) => {
    const existing = question.conceptCluster ?? question.concept;
    return conceptSimilarity(existing, cluster) >= 0.58;
  }).length;
  const maximumPerCluster = totalQuestions === 15 ? 2 : 1;
  if (clusterMatches >= maximumPerCluster) return true;
  return accepted.some(
    (question) =>
      conceptSimilarity(
        `${question.concept} ${question.question}`,
        `${candidate.concept} ${candidate.question}`,
      ) >= 0.72,
  );
}

function replaceSemanticAliases(value) {
  let normalized = normalizeGroundedText(value);
  for (const [pattern, replacement] of SEMANTIC_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/g, " ").trim();
}

export function choicesLikelyEquivalent(left, right) {
  const leftValue = replaceSemanticAliases(left);
  const rightValue = replaceSemanticAliases(right);
  if (!leftValue || !rightValue) return false;
  if (leftValue === rightValue) return true;
  return conceptSimilarity(leftValue, rightValue) >= 0.82;
}

export function answerSupportedByEvidence(answer, evidence) {
  const normalizedAnswer = normalizeGroundedText(answer);
  const normalizedEvidence = normalizeGroundedText(evidence);
  if (!normalizedAnswer || !normalizedEvidence) return false;
  if (normalizedEvidence.includes(normalizedAnswer)) return true;

  const answerFormula = formulaFingerprint(answer);
  if (answerFormula) {
    const evidenceFormula = formulaFingerprint(evidence);
    return Boolean(evidenceFormula && evidenceFormula === answerFormula);
  }

  const answerTokens = semanticTokens(answer);
  if (answerTokens.size < 2) return false;
  const evidenceTokens = semanticTokens(evidence);
  let supportedTokens = 0;
  for (const token of answerTokens) {
    if (evidenceTokens.has(token)) supportedTokens += 1;
  }
  return supportedTokens / answerTokens.size >= 0.75;
}

const CONTRADICTORY_REPLACEMENTS = new Map([
  ["true", "false"],
  ["false", "true"],
  ["increase", "decrease"],
  ["decrease", "increase"],
  ["increases", "decreases"],
  ["decreases", "increases"],
  ["increased", "decreased"],
  ["decreased", "increased"],
  ["higher", "lower"],
  ["lower", "higher"],
  ["greater", "less"],
  ["less", "greater"],
  ["before", "after"],
  ["after", "before"],
  ["positive", "negative"],
  ["negative", "positive"],
  ["more", "fewer"],
  ["fewer", "more"],
  ["maximum", "minimum"],
  ["minimum", "maximum"],
  ["always", "never"],
  ["never", "always"],
]);

function isVerifiedContradiction(source, replacement) {
  const normalizedSource = normalizeGroundedText(source);
  const normalizedReplacement = normalizeGroundedText(replacement);
  if (
    CONTRADICTORY_REPLACEMENTS.get(normalizedSource) === normalizedReplacement
  ) {
    return true;
  }

  const sourceNumbers = normalizedSource.match(/-?\d+(?:\.\d+)?/gu) ?? [];
  const replacementNumbers =
    normalizedReplacement.match(/-?\d+(?:\.\d+)?/gu) ?? [];
  if (sourceNumbers.length !== 1 || replacementNumbers.length !== 1) {
    return false;
  }
  const sourceNumber = Number(sourceNumbers[0]);
  const replacementNumber = Number(replacementNumbers[0]);
  if (
    !Number.isFinite(sourceNumber) ||
    !Number.isFinite(replacementNumber) ||
    sourceNumber === replacementNumber
  ) {
    return false;
  }
  const withoutNumber = (value) =>
    value.replace(/-?\d+(?:\.\d+)?/u, "#").trim();
  return (
    withoutNumber(normalizedSource) === withoutNumber(normalizedReplacement)
  );
}

export function applyVerifiedMutation(supportedStatement, mutation) {
  if (
    !mutation ||
    typeof mutation !== "object" ||
    typeof mutation.sourceValue !== "string" ||
    typeof mutation.replacementValue !== "string"
  ) {
    return null;
  }
  const source = mutation.sourceValue.trim();
  const replacement = mutation.replacementValue.trim();
  if (
    source.length < 1 ||
    replacement.length < 1 ||
    normalizeGroundedText(source) === normalizeGroundedText(replacement) ||
    !isVerifiedContradiction(source, replacement)
  ) {
    return null;
  }
  const first = supportedStatement.indexOf(source);
  if (
    first < 0 ||
    supportedStatement.indexOf(source, first + source.length) >= 0
  ) {
    return null;
  }
  return `${supportedStatement.slice(0, first)}${replacement}${supportedStatement.slice(first + source.length)}`;
}

export function groundedTrueFalseQuestion(candidate, focusExcerpt) {
  const evidence = String(candidate?.sourceEvidence ?? "").trim();
  const supported = String(candidate?.supportedStatement ?? "").trim();
  if (
    !evidenceAppearsInText(evidence, focusExcerpt) ||
    normalizeGroundedText(evidence) !== normalizeGroundedText(supported)
  ) {
    return null;
  }
  if (candidate.mode === "supported") {
    if (
      normalizeGroundedText(candidate.question) !==
      normalizeGroundedText(supported)
    ) {
      return null;
    }
    return {
      question: supported,
      answer: true,
      correction: "The statement is accurate as written.",
      explanation: `The lesson supports this statement: ${supported}`,
    };
  }
  if (candidate.mode !== "mutated") return null;
  const mutated = applyVerifiedMutation(supported, candidate.mutation);
  if (
    !mutated ||
    normalizeGroundedText(mutated) !== normalizeGroundedText(candidate.question)
  ) {
    return null;
  }
  return {
    question: mutated,
    answer: false,
    correction: supported,
    explanation: `The lesson supports ${supported} The displayed statement changes ${candidate.mutation.sourceValue} to ${candidate.mutation.replacementValue}.`,
  };
}

export function groundedMultipleChoiceCandidate(candidate, focusExcerpt) {
  const evidence = String(candidate?.sourceEvidence ?? "").trim();
  const correctAnswer = String(candidate?.correctAnswer ?? "").trim();
  if (
    !evidenceAppearsInText(evidence, focusExcerpt) ||
    !correctAnswer ||
    !normalizeGroundedText(evidence).includes(
      normalizeGroundedText(correctAnswer),
    ) ||
    !Array.isArray(candidate?.distractors) ||
    candidate.distractors.length !== 3
  ) {
    return null;
  }
  const distractors = candidate.distractors.map((entry) =>
    typeof entry === "string" ? { text: entry } : entry,
  );
  if (
    distractors.some(
      (entry) =>
        !entry ||
        typeof entry.text !== "string" ||
        !entry.text.trim() ||
        typeof entry.whyWrong !== "string" ||
        entry.whyWrong.trim().length < 8,
    )
  ) {
    return null;
  }
  return {
    correctAnswer,
    distractors: distractors.map((entry) => entry.text.trim()),
  };
}
