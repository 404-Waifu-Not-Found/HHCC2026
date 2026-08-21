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
  /\b(?:the )?(?:reference|reference material|material|evidence|excerpt|content)\s+(?:says?|states?|mentions?|lists?|shows?|describes?|provides?|indicates?)\b/iu,
  /\b(?:(?:according to|based on) (?:the )?(?:lesson|video|lecture|course|class|transcript|episode|presentation|presenter|instructor|teacher|professor|speaker|narrator)|(?:lesson|video|lecture|transcript|episode|presentation|presenter|instructor|teacher|professor|speaker|narrator)(?: (?:explicitly|directly|clearly|specifically|also))? (?:says?|states?|mentions?|explains?|shows?|demonstrates?|teaches?|covers?|lists?|listed|supports?|describes?))\b/iu,
  /\b(?:in|from) (?:this|the|that) (?:lesson|video|lecture|transcript|presentation)\b/iu,
  /\b(?:lesson|video|lecture|transcript|presentation|lecturer|presenter|narrator|speaker)['’]s\s+(?:account|example|explanation|description|discussion|demonstration|claim|wording|method|approach)\b/iu,
  /\b(?:lecturer|presenter|narrator|speaker)\s+(?:says?|said|states?|stated|mentions?|mentioned|explains?|explained|shows?|showed|demonstrates?|demonstrated|teaches?|taught|calls?|called|describes?|described)\b/iu,
  /\b(?:what|which|how) (?:did|does|was|were) (?:the )?(?:lesson|video|lecture|presenter|instructor|teacher|professor|speaker|narrator).{0,80}\b(?:say|state|mention|show|explain|call|name|cover|teach|discuss)\b/iu,
  /\b(?:mentioned|shown|said|stated|covered|discussed|supported|described) (?:in|by) (?:the )?(?:lesson|video|lecture|transcript|presenter|instructor|teacher|professor|speaker|narrator)\b/iu,
  /\b(?:(?:according to|based on) (?:the )?source|the source (?:says?|states?|mentions?|explains?|shows?|describes?))\b/iu,
  /\b(?:according to (?:the )?described|(?:the )?(?:described|discussed|aforementioned) (?:mechanism|process|method|relationship|example)|as (?:described|discussed|shown|stated) (?:above|earlier|previously)|the (?:above|preceding|following) example|the evidence (?:says?|states?|shows?|supports?|indicates?))\b/iu,
  /(?:根据|按照|依照)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示|老师|讲师|主讲人)|(?:课|课程|视频|讲座|讲解|老师|讲师|主讲人)(?:中|里)?(?:提到|说到|讲到|介绍|展示)/u,
];

const QUESTION_DEICTIC_PATTERNS = [
  /^\s*(?:what|which|how)\b.{0,160}(?<![-\p{L}])(?:mentioned|listed|stated|discussed|shown|described|provided)\b/iu,
  /^(?:什么|哪|如何|为什么).{0,80}(?:提到|列出|指出|讨论|展示|描述|提供)/u,
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
  // answerSpan and whyWrong are private validation aids. They are never
  // persisted in a learner-visible question, so source-language evidence in
  // those fields must not trigger a presentation-framing repair.
  const distractors = Array.isArray(candidate?.distractors)
    ? candidate.distractors.map((value) =>
        value && typeof value === "object" ? value.text : value,
      )
    : [];
  return [
    candidate?.question,
    candidate?.concept,
    candidate?.explanation,
    candidate?.answer,
    candidate?.correctAnswer,
    candidate?.answerText,
    candidate?.correction,
    candidate?.supportedStatement,
    candidate?.supportedFact,
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

const NUMERIC_RECALL_QUESTION_PATTERN =
  /^\s*(?:(?:what (?:percentage|percent|number|count|frequency|duration|amount|value|cost|price)|how (?:many|often|long|much))\b|(?:多少|几次|多久|百分之几|占比多少|价值多少|价格多少|成本多少))/iu;
const NECESSARY_NUMERIC_OBJECTIVE_PATTERN =
  /\b(?:calculate|compute|derive|solve|formula|equation|law|threshold|limit|rate|ratio|minimum|required|maximum|mechanism|causes?|because|results? in|produces?)\b|(?:计算|推导|求解|公式|方程|定律|阈值|极限|速率|比率|最小|必须|最大|机制|导致|因为|产生)/iu;
const NON_TRANSFERABLE_QUANTITATIVE_PATTERN =
  /(?:\b(?:estimated|reported|surveyed|annual)\b.{0,60}\b(?:monetary|market|economic|financial)?\s*(?:value|worth|cost|price|output|total|amount|percentage|percent|count|frequency|figure|statistic)s?\b|\b(?:annual monetary value|monetary value|global economic output|market worth|economic estimate|survey percentage)\b|[$€£¥]\s*\d|\b\d+(?:\.\d+)?\s*(?:trillion|billion|million|thousand)\s+(?:dollars?|euros?|pounds?|yen)\b|(?:估计|估算|报告|调查).{0,30}(?:货币价值|市场价值|经济产出|金额|百分比|数量|频率)|(?:货币价值|市场价值|经济产出).{0,30}(?:万亿|亿|万元|美元|人民币))/iu;
const PRESENTATION_STATISTIC_ATTRIBUTION_PATTERN =
  /\baccording to\b.{0,80}\b(?:calculations?|estimates?|statistics?|surveys?|figures?|reported data)\b|(?:根据|按照).{0,30}(?:计算|估算|统计|调查|数据)/iu;
const QUANTITATIVE_ANSWER_PATTERN =
  /(?:[$€£¥]\s*\d|\b\d+(?:\.\d+)?\s*(?:%|percent|trillion|billion|million|thousand|dollars?|euros?|pounds?|yen|years?|times|devices?|people)\b|^(?:it is |they are )?(?:less|greater|higher|lower|more|fewer|equal|about half|roughly twice)\b|(?:万亿|亿|万元|美元|人民币|百分之|更少|更多|更高|更低))/iu;

function hasSuppliedCalculationOperands(question) {
  return (String(question).match(/\b\d+(?:\.\d+)?\b/gu)?.length ?? 0) >= 2;
}

export function questionConceptFailure(candidate) {
  const question = String(candidate?.question ?? "").trim();
  if (!question) return "low_pedagogical_value";
  const inspected = learnerVisibleCandidateText(candidate);
  if (QUESTION_DEICTIC_PATTERNS.some((pattern) => pattern.test(question))) {
    return "source_framing_invalid";
  }
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
  if (
    NUMERIC_RECALL_QUESTION_PATTERN.test(question) &&
    !NECESSARY_NUMERIC_OBJECTIVE_PATTERN.test(question) &&
    !hasSuppliedCalculationOperands(question)
  ) {
    return "low_pedagogical_value";
  }
  const directAnswerSource = String(
    candidate?.answerText ??
      candidate?.answerSpan ??
      candidate?.correctAnswer ??
      candidate?.answer ??
      "",
  ).trim();
  if (
    (NON_TRANSFERABLE_QUANTITATIVE_PATTERN.test(question) ||
      PRESENTATION_STATISTIC_ATTRIBUTION_PATTERN.test(question) ||
      QUANTITATIVE_ANSWER_PATTERN.test(directAnswerSource)) &&
    !NECESSARY_NUMERIC_OBJECTIVE_PATTERN.test(question) &&
    !hasSuppliedCalculationOperands(question)
  ) {
    return "low_pedagogical_value";
  }
  const questionValue = normalizeGroundedText(question);
  const directAnswer = normalizeGroundedText(directAnswerSource);
  if (
    directAnswer.length >= 4 &&
    questionValue.includes(directAnswer) &&
    /^(?:what|which)\b/iu.test(question)
  ) {
    return "question_tautology_invalid";
  }
  if (
    /^(?:what|which)\s+(?:factor|cause|process|method|term|concept|quantity)\b/iu.test(
      question,
    ) &&
    /^(?:most|least|more|less|highly|slightly|very|degrees?|levels?|amounts?|variations?)\b/iu.test(
      String(
        candidate?.answerText ??
          candidate?.answerSpan ??
          candidate?.correctAnswer ??
          candidate?.answer ??
          "",
      ),
    )
  ) {
    return "question_answer_kind_mismatch";
  }
  return null;
}

const NON_ENGLISH_PROSE_SCRIPT_PATTERN =
  /[\p{Script=Arabic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}]/u;
const NON_CHINESE_PROSE_SCRIPT_PATTERN =
  /[\p{Script=Arabic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}]/u;
const HAN_SCRIPT_PATTERN = /\p{Script=Han}/u;

/**
 * Fail closed when learner-visible model output drifts away from the selected
 * quiz language. Private evidence text is intentionally excluded: a source
 * may be translated into the learner's language, but the rendered assessment
 * must never mix the source language into an answer control.
 */
export function questionMatchesQuizLanguage(candidate, quizLanguage) {
  // Distractor rationales remain extension-local and are not rendered.
  const distractors = Array.isArray(candidate?.distractors)
    ? candidate.distractors.map((entry) =>
        entry && typeof entry === "object" ? entry.text : entry,
      )
    : [];
  const values = [
    candidate?.question,
    candidate?.concept,
    candidate?.explanation,
    candidate?.answerText,
    candidate?.supportedFact,
    candidate?.answer,
    candidate?.correction,
    ...distractors,
    ...(Array.isArray(candidate?.aliases) ? candidate.aliases : []),
    ...(Array.isArray(candidate?.requiredIdeas) ? candidate.requiredIdeas : []),
    ...(Array.isArray(candidate?.requiredItems) ? candidate.requiredItems : []),
  ].filter((value) => typeof value === "string" && value.trim());
  const normalizedLanguage = String(quizLanguage ?? "en").toLowerCase();
  if (normalizedLanguage === "en") {
    return values.every(
      (value) => !NON_ENGLISH_PROSE_SCRIPT_PATTERN.test(value),
    );
  }
  if (normalizedLanguage === "zh-cn") {
    if (values.some((value) => NON_CHINESE_PROSE_SCRIPT_PATTERN.test(value))) {
      return false;
    }
    const requiredProse = [candidate?.question, candidate?.explanation].filter(
      (value) => typeof value === "string" && value.trim(),
    );
    return requiredProse.every((value) => HAN_SCRIPT_PATTERN.test(value));
  }
  return false;
}

function sentenceExcludedFromConceptFirst(value) {
  return (
    LOGISTICS_PATTERNS.some((pattern) => pattern.test(value)) ||
    /\b(?:hello|hi everyone|welcome(?: back)?|thanks for watching|see you next|subscribe|like and share|sponsor(?:ed)?|promo code|my name is|today i(?:'m| am) joined by)\b/iu.test(
      value,
    ) ||
    /(?:大家好|欢迎|感谢观看|下期再见|订阅|点赞|赞助|推广)/u.test(value)
  );
}

function conceptFirstInstructionalScore(value, topicTokens) {
  if (sentenceExcludedFromConceptFirst(value)) return Number.NEGATIVE_INFINITY;
  let score = instructionalScore(value);
  const tokens = semanticTokens(value);
  let titleOverlap = 0;
  for (const token of topicTokens) if (tokens.has(token)) titleOverlap += 1;
  score += Math.min(5, titleOverlap);
  if (
    /\b(?:because|therefore|so that|leads? to|results? in|depends? on|if|when|whereas|in contrast|by means of)\b/iu.test(
      value,
    )
  ) {
    score += 4;
  }
  if (
    /\b(?:step|method|procedure|calculate|solve|derive|apply|example|for instance)\b/iu.test(
      value,
    )
  ) {
    score += 3;
  }
  if (/[=+*/^≤≥≈]|\b\w+\([^)]*\)/u.test(value)) score += 3;
  if (
    NON_TRANSFERABLE_QUANTITATIVE_PATTERN.test(value) &&
    !NECESSARY_NUMERIC_OBJECTIVE_PATTERN.test(value)
  ) {
    score -= 8;
  }
  score += Math.min(5, Math.floor(tokens.size / 8));
  if (value.length >= 45 && value.length <= 700) score += 2;
  return score;
}

export function buildConceptFirstInstructionalSelection(
  plainText,
  { topicHint = "" } = {},
) {
  const rawSentences = sentenceUnits(plainText);
  const topicTokens = semanticTokens(topicHint);
  const scored = rawSentences.map((text, index) => ({
    text,
    index,
    excluded: sentenceExcludedFromConceptFirst(text),
    score: conceptFirstInstructionalScore(text, topicTokens),
  }));
  const safe = scored.filter(
    (entry) => !entry.excluded && entry.text.length >= 24,
  );
  if (!safe.length) {
    return {
      excerpts: [],
      metrics: {
        sentenceCount: Math.max(1, rawSentences.length),
        excludedSentenceCount: scored.filter((entry) => entry.excluded).length,
        candidateWindowCount: 0,
        selectedWindowCount: 0,
        focusWordCount: 0,
      },
    };
  }

  const safeByIndex = new Map(safe.map((entry) => [entry.index, entry]));
  const windows = safe.map((entry) => {
    // Lead with the scored center sentence so the model sees the selected
    // objective before its supporting context. Neighboring sentences remain
    // available for evidence, but cannot accidentally become the repeated
    // headline claim of adjacent windows.
    const neighbors = [0, -1, 1]
      .map((offset) => safeByIndex.get(entry.index + offset))
      .filter(Boolean);
    const text = neighbors
      .map((neighbor) => neighbor.text)
      .join(" ")
      .slice(0, 1_500);
    const distinctTokens = semanticTokens(text).size;
    return {
      text,
      index: entry.index,
      score:
        neighbors.reduce(
          (total, neighbor) => total + Math.max(-4, neighbor.score),
          0,
        ) + Math.min(8, Math.floor(distinctTokens / 10)),
    };
  });
  const selected = [];
  for (const window of windows.sort(
    (left, right) => right.score - left.score || left.index - right.index,
  )) {
    if (
      selected.every(
        (candidate) => conceptSimilarity(candidate.text, window.text) < 0.86,
      )
    ) {
      selected.push(window);
    }
    if (selected.length >= 30) break;
  }
  const excerpts = selected.map((entry) => entry.text.trim()).filter(Boolean);
  const focusWordCount = excerpts.reduce(
    (maximum, excerpt) =>
      Math.max(maximum, excerpt.match(/[\p{L}\p{N}]+/gu)?.length ?? 0),
    0,
  );
  return {
    excerpts,
    metrics: {
      sentenceCount: Math.max(1, rawSentences.length),
      excludedSentenceCount: scored.filter((entry) => entry.excluded).length,
      candidateWindowCount: windows.length,
      selectedWindowCount: excerpts.length,
      focusWordCount: Math.max(1, focusWordCount),
    },
  };
}

/**
 * Build bounded lesson excerpts while filtering administrative and promotional
 * transcript material. The original transcript remains the authoritative
 * prompt prefix; these excerpts are the only spans grounded questions may cite.
 */
export function buildInstructionalExcerpts(
  plainText,
  { strict = false, conceptFirstV58 = false, topicHint = "" } = {},
) {
  if (conceptFirstV58) {
    return buildConceptFirstInstructionalSelection(plainText, { topicHint })
      .excerpts;
  }
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
  if (options.conceptFirstV58) {
    // q1 keeps the strongest-ranked window. Spread later primary questions
    // across the complete safe evidence set instead of walking adjacent
    // high-scoring windows, which often describe the same objective. Repairs
    // move by one quiz-length so they cannot consume the next ordinal's
    // primary focus.
    const primaryIndex = Math.min(
      excerpts.length - 1,
      Math.floor(
        (Math.max(0, ordinal) / Math.max(1, totalQuestions)) * excerpts.length,
      ),
    );
    const index =
      (primaryIndex + repairCycle * Math.max(1, totalQuestions)) %
      excerpts.length;
    return excerpts[index].slice(0, 2_400).trim();
  }
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
  // Multiple-choice wording can move the same proposition between a
  // definition, condition, or relationship stem. Include the locally resolved
  // answer in its claim identity so those cosmetic shifts stay duplicates.
  // True/false facts are full source sentences and share substantial template
  // language, so their existing concept/claim identity remains more precise.
  const assessmentAnswer =
    candidate?.type === "multiple_choice"
      ? (candidate?.correctAnswer ??
        candidate?.answerText ??
        candidate?.answerSpan)
      : undefined;
  const parts = assessmentAnswer
    ? [
        candidate?.concept ?? claim?.subject,
        candidate?.objectiveCategory ?? claim?.relation,
        assessmentAnswer,
      ]
    : claim
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
  _totalQuestions,
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
  // A focused source can legitimately support several distinct objectives in
  // one broad domain (for example, plate composition, convection, and boundary
  // interactions). Broad cluster overlap is a quality flag at import time, not
  // proof that another model request is necessary. Keep the hard failure for a
  // repeated claim or for a closely overlapping cluster *and* assessment.
  return accepted.some(
    (question) =>
      conceptSimilarity(question.conceptCluster ?? question.concept, cluster) >=
        0.58 &&
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

export function resolveUniqueEvidenceAnswerSpan(answerSpan, evidence) {
  const candidate = String(answerSpan ?? "")
    .normalize("NFC")
    .trim();
  const source = String(evidence ?? "")
    .normalize("NFC")
    .trim();
  const normalizedCandidate = normalizeGroundedText(candidate);
  const normalizedSource = normalizeGroundedText(source);
  if (!candidate || !source || !normalizedCandidate) return null;
  const first = normalizedSource.indexOf(normalizedCandidate);
  if (
    first < 0 ||
    normalizedSource.indexOf(
      normalizedCandidate,
      first + normalizedCandidate.length,
    ) >= 0
  ) {
    return null;
  }
  return candidate;
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

function localFalseMutation(supportedStatement) {
  for (const [source, replacement] of CONTRADICTORY_REPLACEMENTS) {
    const pattern = new RegExp(`\\b${source}\\b`, "iu");
    const matches = supportedStatement.match(
      new RegExp(`\\b${source}\\b`, "giu"),
    );
    if (matches?.length !== 1) continue;
    return {
      question: supportedStatement.replace(pattern, replacement),
      sourceValue: matches[0],
      replacementValue: replacement,
    };
  }
  const numericMatches = [...supportedStatement.matchAll(/-?\d+(?:\.\d+)?/gu)];
  if (numericMatches.length === 1) {
    const match = numericMatches[0];
    const numeric = Number(match[0]);
    if (Number.isFinite(numeric)) {
      const replacement = Number.isInteger(numeric)
        ? String(numeric + (numeric === 0 ? 1 : Math.sign(numeric)))
        : String(Number((numeric + 0.1).toFixed(6)));
      return {
        question: `${supportedStatement.slice(0, match.index)}${replacement}${supportedStatement.slice((match.index ?? 0) + match[0].length)}`,
        sourceValue: match[0],
        replacementValue: replacement,
      };
    }
  }
  return null;
}

export function constructConceptFirstTrueFalseQuestion(
  candidate,
  focusExcerpt,
  preferredPolarity,
) {
  const evidence = String(
    candidate?.evidenceQuote ?? candidate?.sourceEvidence ?? "",
  ).trim();
  const supported = String(
    candidate?.supportedFact ?? candidate?.supportedStatement ?? "",
  ).trim();
  if (
    !evidenceAppearsInText(evidence, focusExcerpt) ||
    !supported ||
    !normalizeGroundedText(evidence).includes(normalizeGroundedText(supported))
  ) {
    return null;
  }
  const directExplanation = String(candidate?.explanation ?? "").trim();
  if (preferredPolarity === false) {
    const mutation = localFalseMutation(supported);
    if (mutation) {
      return {
        question: mutation.question,
        answer: false,
        correction: supported,
        explanation: directExplanation || supported,
        mutationKind: "local_allowlisted",
      };
    }
  }
  return {
    question: supported,
    answer: true,
    correction: supported,
    explanation: directExplanation || supported,
    mutationKind: "none",
  };
}

export function groundedMultipleChoiceCandidate(candidate, focusExcerpt) {
  const evidence = String(
    candidate?.evidenceQuote ?? candidate?.sourceEvidence ?? "",
  ).trim();
  const requestedAnswerSpan = String(
    candidate?.answerSpan ?? candidate?.correctAnswer ?? "",
  ).trim();
  const learnerAnswer = String(
    candidate?.answerText ?? candidate?.correctAnswer ?? "",
  ).trim();
  const exactRequestedAnswerSpan = resolveUniqueEvidenceAnswerSpan(
    requestedAnswerSpan,
    evidence,
  );
  const exactLearnerAnswerSpan = resolveUniqueEvidenceAnswerSpan(
    learnerAnswer,
    evidence,
  );
  const answerRepresentationsAgree =
    Boolean(exactRequestedAnswerSpan || exactLearnerAnswerSpan) ||
    normalizeGroundedText(requestedAnswerSpan) ===
      normalizeGroundedText(learnerAnswer) ||
    choicesLikelyEquivalent(requestedAnswerSpan, learnerAnswer);
  // DeepSeek occasionally paraphrases the private answerSpan even though the
  // learner-facing answerText is copied exactly from the evidence. Preserve a
  // valid exact source-language span for translated quizzes; otherwise resolve
  // the benign mismatch locally only when both representations are equivalent
  // and independently grounded. A wrong or unrelated answer is never repaired
  // into acceptance.
  const correctAnswer =
    exactRequestedAnswerSpan ??
    exactLearnerAnswerSpan ??
    (answerRepresentationsAgree &&
    answerSupportedByEvidence(requestedAnswerSpan, evidence) &&
    answerSupportedByEvidence(learnerAnswer, evidence)
      ? requestedAnswerSpan
      : null);
  if (
    !evidenceAppearsInText(evidence, focusExcerpt) ||
    !correctAnswer ||
    !learnerAnswer ||
    !answerRepresentationsAgree ||
    (!exactRequestedAnswerSpan &&
      !answerSupportedByEvidence(learnerAnswer, evidence)) ||
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
    correctAnswer: learnerAnswer,
    distractors: distractors.map((entry) => entry.text.trim()),
  };
}
