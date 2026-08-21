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
  /\b(?:office hours?|teaching assistants?|t\.?a\.?s?|complaints?|syllabus|grading|grade policy|course roadmap|course website|class website|homework|assignments?|essays?|prerequisites?|required readings?|textbooks?|share (?:the )?book|email me|contact me|subscribe|sponsor(?:ed)?|promo code|welcome back|my name is|i(?:'m| am) your (?:teacher|instructor|professor)|course logistics|class schedule|exam schedule|test date|upload date|video duration|channel name)\b/iu,
  /\b(?:ap\s+(?:calculus\s+)?(?:ab\/?bc|ab|bc)?\s*exam|exam|test|assessment|course|class|unit\s*\d+|module\s*\d+)\b.{0,90}\b(?:weight(?:ing)?|weighs?|worth|percentage|percent|points?|score|grade|duration|weeks?|hours?)\b/iu,
  /\b(?:weight(?:ing)?|weighs?|worth|percentage|percent|points?|score|grade)\b.{0,90}\b(?:ap\s+(?:calculus\s+)?(?:ab\/?bc|ab|bc)?\s*exam|exam|test|assessment|course|class|unit\s*\d+|module\s*\d+)\b/iu,
  /\b(?:who (?:is|was) (?:the )?(?:teacher|instructor|professor|presenter|speaker|teaching assistant|t\.?a\.?)|(?:teacher|instructor|professor|presenter|speaker|teaching assistant|t\.?a\.?).{0,50}(?:name|biography|background|degree|university|college|has taught|started teaching)|how long .{0,50}(?:taught|been teaching)|what (?:will|does) (?:the )?(?:(?:next|following) )?(?:course|class|unit|module) cover|what (?:is|was) covered (?:next|later)|how many (?:lessons?|videos?|weeks?|hours?) (?:are|were) in)\b/iu,
  /\b(?:course (?:aims?|goals?|objectives?|numbers?|codes?)|class (?:aims?|goals?|objectives?)|cross[- ]listed|attendance policy|due dates?|deadlines?|late (?:work|homework|assignments?|problem sets?)|problem set policy|submission policy|office location|contact information|how many (?:times|years?) .{0,60}(?:taught|teach|requested)|university admission|applied to (?:a |the )?(?:university|college)|popularity|request count|presentation order|first topic|last topic)\b/iu,
  /\b(?:(?:presenter|speaker|lecturer|narrator|instructor).{0,40}(?:jokes?|introduction|outro)|(?:jokes?|introduction|outro).{0,40}(?:presenter|speaker|lecturer|narrator|instructor)|recording metadata)\b/iu,
  /\b(?:where did|when did|what (?:year|date|institution|university|college|city|country)|how many times)\b.{0,100}\b(?:apply|attend|graduate|study|teach|present|record|upload|request|live|born)\b/iu,
  /(?:课程安排|课程大纲|助教|办公时间|作业|评分|教材|投诉|订阅|赞助|推广|欢迎来到|讲师介绍|考试占比|考试权重|考试分值|单元占比|课程进度|考试时间|教师姓名|讲师姓名|教师简介|讲师简介|视频时长|上传日期)/u,
  /(?:课程目标|课程编号|交叉课程|出勤|截止日期|迟交|授课次数|大学申请|受欢迎程度|请求次数|讲解顺序)/u,
];

const INSTRUCTIONAL_PATTERNS = [
  /\b(?:means?|defined as|definition|therefore|because|causes?|results? in|for example|consider|calculate|equation|formula|derivative|integral|theorem|principle|process|mechanism|function|system|evidence|experiment|observed|measured|contains?|consists? of|composed of|located|represents?|relationship|condition|property|characteristic|purpose|role|used to|classified|originates?|produces?|converts?|solves?|applies?|predicts?|describes?)\b/iu,
  /(?:定义|意味着|因此|因为|导致|例如|公式|方程|导数|积分|定理|原理|过程|机制|函数|系统|实验|测量|包含|组成|位于|表示|关系|条件|性质|特征|用途|作用|用于|分类|产生|转换|求解|应用|预测|描述)/u,
];

const SAFE_INTERROGATIVE_LOOKAHEAD =
  "(?=what|which|how|why|when|where|who|is|are|does|do|can|should|explain|describe|identify|calculate|determine|define)";
const SOURCE_NOUN =
  "(?:lesson|video|lecture|lecturer|course|class|transcript|source|episode|presentation|presenter|instructor|teacher|professor|speaker|narrator)";
const SAFE_DELIMITER = "(?:\\s*[,;:\\-–—]\\s*|\\s+)";
const SOURCE_FRAMING_PREFIX_PATTERNS = [
  new RegExp(
    `^\\s*(?:(?:according to|based on)\\s+(?:the\\s+)?${SOURCE_NOUN}|(?:in|from)\\s+(?:(?:the|this|that)\\s+)?${SOURCE_NOUN})(?!['’]s)\\b${SAFE_DELIMITER}${SAFE_INTERROGATIVE_LOOKAHEAD}`,
    "iu",
  ),
  new RegExp(
    `^\\s*(?:the\\s+)?${SOURCE_NOUN}(?!['’]s)\\b\\s+(?:says?|states?|mentions?|explains?|shows?|demonstrates?|teaches?|supports?|describes?)\\s+(?:that\\s+)?`,
    "iu",
  ),
  /^\s*(?:根据|按照|依照)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示|老师|讲师|主讲人)(?:[，,:：;；\-–—]\s*|\s+(?=什么|如何|为什么|哪|谁|是否|请|解释|描述|计算|确定|定义))/u,
  /^\s*(?:在|从)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示)中(?:[，,:：;；\-–—]\s*|\s+(?=什么|如何|为什么|哪|谁|是否|请|解释|描述|计算|确定|定义))/u,
];

const SOURCE_REFERENCE_PATTERNS = [
  /^\s*according to\b/iu,
  /\b(?:(?:according to|based on) (?:the )?(?:lesson|video|lecture|course|class|transcript|episode|presentation|presenter|instructor|teacher|professor|speaker|narrator)|(?:lesson|video|lecture|transcript|episode|presentation|presenter|instructor|teacher|professor|speaker|narrator)(?: (?:explicitly|directly|clearly|specifically|also))? (?:says?|states?|mentions?|explains?|shows?|demonstrates?|teaches?|covers?|lists?|listed|supports?|describes?))\b/iu,
  /\b(?:in|from) (?:this|the|that) (?:lesson|video|lecture|transcript|presentation)\b/iu,
  /\b(?:lesson|video|lecture|transcript|presentation|lecturer|presenter|narrator|speaker)['’]s\s+(?:account|example|explanation|description|discussion|demonstration|claim|wording|method|approach)\b/iu,
  /\b(?:lecturer|presenter|narrator|speaker)\s+(?:says?|said|states?|stated|mentions?|mentioned|explains?|explained|shows?|showed|demonstrates?|demonstrated|teaches?|taught|calls?|called|describes?|described)\b/iu,
  /\b(?:what|which|how) (?:did|does|was|were) (?:the )?(?:lesson|video|lecture|presenter|instructor|teacher|professor|speaker|narrator).{0,80}\b(?:say|state|mention|show|explain|call|name|cover|teach|discuss)\b/iu,
  /\b(?:mentioned|shown|said|stated|covered|discussed|supported|described) (?:in|by) (?:the )?(?:lesson|video|lecture|transcript|presenter|instructor|teacher|professor|speaker|narrator)\b/iu,
  /\b(?:(?:according to|based on) (?:the )?source|the source (?:says?|states?|mentions?|explains?|shows?|describes?))\b/iu,
  /(?:根据|按照|依照)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示|老师|讲师|主讲人)|(?:课|课程|视频|讲座|讲解|老师|讲师|主讲人)(?:中|里)?(?:提到|说到|讲到|介绍|展示)/u,
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
  let hasInstructionalSignal = false;
  for (const pattern of INSTRUCTIONAL_PATTERNS) {
    if (pattern.test(text)) {
      score += 4;
      hasInstructionalSignal = true;
    }
  }
  for (const pattern of LOGISTICS_PATTERNS) {
    if (pattern.test(text)) score -= 12;
  }
  const hasConceptualNotation = /[=+*/^≤≥≈]/u.test(text);
  if (hasConceptualNotation) {
    score += 2;
    hasInstructionalSignal = true;
  }
  if (hasInstructionalSignal && /\b\d+(?:\.\d+)?\b/u.test(text)) {
    score += 1;
  }
  if (hasInstructionalSignal && text.length >= 80 && text.length <= 650) {
    score += 2;
  }
  if (
    /\b(?:hello|hi everyone|thanks for watching|see you next)\b/iu.test(text)
  ) {
    score -= 5;
  }
  return score;
}

function capitalizeFirstLetter(value) {
  return value.replace(
    /^([^\p{L}]*)(\p{Ll})/u,
    (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("en-US")}`,
  );
}

/**
 * Remove empty source attribution from a generated learner-facing sentence.
 * This is a bounded presentation normalization: it never rewrites the actual
 * claim, answer, polarity, formula, or question type.
 */
export function stripQuestionSourceFraming(value) {
  if (typeof value !== "string") return value;
  const original = value.normalize("NFC").replace(/\s+/g, " ").trim();
  for (const pattern of SOURCE_FRAMING_PREFIX_PATTERNS) {
    const match = original.match(pattern);
    if (!match) continue;
    const remainder = original.slice(match[0].length).trim();
    if (!remainder) return original;
    return capitalizeFirstLetter(remainder);
  }
  return original;
}

/**
 * Fail closed when a candidate tests the recording, presenter, course
 * logistics, or assessment metadata instead of a transferable taught concept.
 * Evidence grounding is validated separately by the generation validator.
 */
export function questionTestsTaughtConcept(candidate) {
  const question = String(candidate?.question ?? "").trim();
  if (!question) return false;
  const claim = candidate?.claim;
  const inspected = [
    question,
    candidate?.concept,
    candidate?.explanation,
    claim?.subject,
    claim?.relation,
    claim?.value,
    claim?.cluster,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");
  if (SOURCE_REFERENCE_PATTERNS.some((pattern) => pattern.test(inspected))) {
    return false;
  }
  return !LOGISTICS_PATTERNS.some((pattern) => pattern.test(inspected));
}

function learnerVisibleCandidateText(candidate) {
  const claim = candidate?.claim;
  const distractors = Array.isArray(candidate?.distractors)
    ? candidate.distractors.flatMap((value) =>
        value && typeof value === "object"
          ? [value.text, value.whyWrong]
          : [value],
      )
    : [];
  return [
    candidate?.question,
    candidate?.concept,
    candidate?.explanation,
    candidate?.answer,
    candidate?.correctAnswer,
    candidate?.correction,
    candidate?.supportedStatement,
    ...(Array.isArray(candidate?.choices) ? candidate.choices : []),
    ...distractors,
    ...(Array.isArray(candidate?.rubricIdeas) ? candidate.rubricIdeas : []),
    ...(Array.isArray(candidate?.acceptableAnswers)
      ? candidate.acceptableAnswers
      : []),
    claim?.subject,
    claim?.relation,
    claim?.value,
    claim?.cluster,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");
}

const LOW_VALUE_RECALL_PATTERNS = [
  /^\s*(?:who|when|how many times|what (?:year|date|institution|university|college|city|country|name))\b/iu,
  /^\s*where did\b/iu,
  /\b(?:biography|alma mater|university admission|course number|course code|cross[- ]listed|request count|popularity)\b/iu,
  /^(?:谁|何时|哪一年|哪个日期|哪所大学|哪个学院|哪个城市|哪个国家|多少次|在哪里申请)/u,
];

const CONCEPTUAL_QUESTION_PATTERNS = [
  /\b(?:define|definition|condition|relationship|relate|cause|effect|why|how does|how do|mechanism|process|method|formula|calculate|derive|apply|compare|role|function|property|principle|theorem|evidence for|results? in)\b/iu,
  /(?:定义|条件|关系|原因|结果|为什么|如何|机制|过程|方法|公式|计算|推导|应用|比较|作用|功能|性质|原理|定理|导致)/u,
];

export function questionConceptFailure(candidate) {
  const question = String(candidate?.question ?? "").trim();
  if (!question) return "low_pedagogical_value";
  const inspected = learnerVisibleCandidateText(candidate);
  if (SOURCE_REFERENCE_PATTERNS.some((pattern) => pattern.test(inspected))) {
    return "source_framing_invalid";
  }
  if (LOGISTICS_PATTERNS.some((pattern) => pattern.test(inspected))) {
    return "course_logistics_invalid";
  }
  if (
    LOW_VALUE_RECALL_PATTERNS.some((pattern) => pattern.test(question)) &&
    !CONCEPTUAL_QUESTION_PATTERNS.some((pattern) => pattern.test(question))
  ) {
    return "low_pedagogical_value";
  }
  return null;
}

/**
 * Build bounded lesson excerpts while filtering administrative and promotional
 * transcript material. The original transcript remains the authoritative
 * prompt prefix; these excerpts are the only spans grounded questions may cite.
 */
export function buildInstructionalExcerpts(
  plainText,
  { strict = false, topicHint = "" } = {},
) {
  const rawSentences = sentenceUnits(plainText);
  const topicTokens = semanticTokens(topicHint);
  const scoredSentences = rawSentences.map((text, index) => {
    const baseScore = instructionalScore(text);
    const sentenceTokens = semanticTokens(text);
    let topicMatches = 0;
    if (baseScore > 0) {
      for (const token of topicTokens) {
        if (sentenceTokens.has(token)) topicMatches += 1;
      }
    }
    return {
      text,
      index,
      score: baseScore + Math.min(4, topicMatches),
    };
  });
  const hasInstructionalMaterial = scoredSentences.some(
    (entry) => entry.score > 0,
  );
  const sentences = strict
    ? scoredSentences.filter((entry) => entry.score > 0)
    : hasInstructionalMaterial
      ? scoredSentences.filter((entry) => entry.score >= 0)
      : scoredSentences;
  if (!sentences.length) return [];
  const groups = [];
  let current = [];
  let currentLength = 0;
  for (const sentence of sentences) {
    if (current.length && currentLength + sentence.text.length > 900) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(sentence);
    currentLength += sentence.text.length + 1;
    if (currentLength >= 360) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
  }
  if (current.length) groups.push(current);
  const ranked = groups
    .map((entries) => {
      const text = entries.map((entry) => entry.text).join(" ");
      return {
        text,
        index: entries[0]?.index ?? 0,
        score:
          entries.reduce((total, entry) => total + entry.score, 0) +
          instructionalScore(text),
      };
    })
    .filter((entry) => (strict ? entry.score > 0 : entry.score > -8));
  if (!strict) {
    return ranked
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.text.slice(0, 1_200));
  }
  const diverse = [];
  for (const entry of ranked.sort(
    (left, right) => right.score - left.score || left.index - right.index,
  )) {
    if (
      diverse.every(
        (selected) => conceptSimilarity(selected.text, entry.text) < 0.9,
      )
    ) {
      diverse.push(entry);
    }
  }
  return diverse.map((entry) => entry.text.slice(0, 1_200));
}

export function focusExcerptForOrdinal(
  plainText,
  ordinal,
  totalQuestions,
  repairCycle = 0,
  options = {},
) {
  const excerpts = buildInstructionalExcerpts(plainText, options);
  if (!excerpts.length) return "";
  if (options.strict) {
    const index = (ordinal + repairCycle) % excerpts.length;
    return excerpts[index].slice(0, 2_400).trim();
  }
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
      explanation: `This statement matches the supporting evidence: ${supported}`,
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
    explanation: `The supported statement is: ${supported} The displayed statement changes ${candidate.mutation.sourceValue} to ${candidate.mutation.replacementValue}.`,
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
