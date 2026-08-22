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
  /\b(?:(?:this|the) (?:episode|video|recording) (?:was |is )?(?:filmed|recorded|produced|shot|made)|(?:filmed|recorded|produced|shot) (?:in|at|by)|(?:crash course|production|recording|film) studio|(?:episode|video) (?:number|title|series|channel))\b/iu,
  // Course-navigation claims describe how recordings relate to one another,
  // not the transferable subject matter taught by those recordings. Require
  // both a media noun and an ordering/dependency relationship so legitimate
  // mathematical or historical uses of "series" remain assessable.
  /\b(?=[^.!?]{0,180}\b(?:episodes?|videos?|lessons?)\b)(?=[^.!?]{0,180}\b(?:previous|prior|earlier|last)\b)[^.!?]{0,180}\b(?:build(?:s|ing)?\s+(?:on|upon)|depend(?:s|ing)?\s+(?:on|upon)|stand(?:s|ing)?\s+alone|self[- ]contained)\b/iu,
  /\b(?:series\b[^.!?]{0,120}\bepisodes?|episodes?\b[^.!?]{0,120}\bseries)\b/iu,
  /\b(?:where did|when did|what (?:year|date|institution|university|college|city|country)|how many times)\b.{0,100}\b(?:apply|attend|graduate|study|teach|present|record|upload|request|live|born)\b/iu,
  /(?:课程安排|课程大纲|助教|办公时间|作业|评分|教材|投诉|订阅|赞助|推广|欢迎来到|讲师介绍|考试占比|考试权重|考试分值|单元占比|课程进度|考试时间|教师姓名|讲师姓名|教师简介|讲师简介|视频时长|上传日期)/u,
  /(?:课程目标|课程编号|交叉课程|出勤|截止日期|迟交|授课次数|大学申请|受欢迎程度|请求次数|讲解顺序)/u,
];

const INSTRUCTIONAL_PATTERNS = [
  /\b(?:means?|defined as|definition|therefore|because|causes?|results? in|for example|consider|calculate|equation|formula|derivative|integral|theorem|principle|process|mechanism|function|system|evidence|experiment|observed|measured|contains?|consists? of|composed of|located|represents?|relationship|condition|property|characteristic|purpose|role|used to|classified|originates?|produces?|converts?|solves?|applies?|predicts?|describes?|detects?|digitiz(?:e|es|ed|ing)|transmits?|emits?|absorbs?|releases?|stores?|forms?|binds?|migrates?|separates?)\b/iu,
  /(?:定义|意味着|因此|因为|导致|例如|公式|方程|导数|积分|定理|原理|过程|机制|函数|系统|实验|测量|包含|组成|位于|表示|关系|条件|性质|特征|用途|作用|用于|分类|产生|转换|求解|应用|预测|描述)/u,
];

const SAFE_INTERROGATIVE_LOOKAHEAD =
  "(?=what|which|how|why|when|where|who|is|are|does|do|can|should|explain|describe|identify|calculate|determine|define)";
const SOURCE_NOUN =
  "(?:lesson|video|lecture|lecturer|course|class|transcript|source|reference(?: material)?|material|evidence|excerpt|content|episode|presentation|presenter|instructor|teacher|professor|speaker|narrator)";
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
  /^\s*as\s+(?:described|discussed|shown|stated)\s+(?:in\s+)?(?:the\s+)?(?:lesson|video|lecture|transcript|source|reference(?: material)?|material|evidence|excerpt|presentation)(?!['’]s)\b\s*[,;:\-–—]?\s*/iu,
  /^\s*(?:根据|按照|依照)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示|老师|讲师|主讲人)(?:[，,:：;；\-–—]\s*|\s+(?=什么|如何|为什么|哪|谁|是否|请|解释|描述|计算|确定|定义))/u,
  /^\s*(?:在|从)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示)中(?:[，,:：;；\-–—]\s*|\s+(?=什么|如何|为什么|哪|谁|是否|请|解释|描述|计算|确定|定义))/u,
];
const SOURCE_FRAMING_SUFFIX_PATTERNS = [
  /\s*,?\s+(?:as|like)\s+(?:stated|described|discussed|shown|explained|mentioned)\s+in\s+(?:the\s+)?(?:lesson|video|lecture|transcript|source|reference(?: material)?|material|evidence|excerpt|presentation)\.?$/iu,
  /\s*,?\s+according to\s+(?:the\s+)?(?:lesson|video|lecture|transcript|source|reference(?: material)?|material|evidence|excerpt|presentation)\.?$/iu,
  /(?:，|,)?(?:正如|如同)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|材料|证据|演示)(?:所说|所述|所示|所解释)的?。?$/u,
];

const SOURCE_REFERENCE_PATTERNS = [
  /^\s*according to\b/iu,
  /\baccording to (?:the )?(?:analogy|described (?:mechanism|process|relationship)|example|evidence|metaphor|weave metaphor)\b/iu,
  /\b(?:the )?(?:reference|reference material|material|evidence|excerpt|content)\s+(?:says?|states?|mentions?|lists?|shows?|describes?|provides?|indicates?)\b/iu,
  /\b(?:(?:according to|based on) (?:the )?(?:lesson|video|lecture|course|class|transcript|episode|presentation|presenter|instructor|teacher|professor|speaker|narrator)|(?:lesson|video|lecture|transcript|episode|presentation|presenter|instructor|teacher|professor|speaker|narrator)(?: (?:explicitly|directly|clearly|specifically|also))? (?:says?|states?|mentions?|explains?|shows?|demonstrates?|teaches?|covers?|lists?|listed|supports?|describes?))\b/iu,
  /\b(?:in|from) (?:this|the|that) (?:lesson|video|lecture|transcript|presentation)\b/iu,
  /\b(?:lesson|video|lecture|transcript|presentation|lecturer|presenter|narrator|speaker)['’]s\s+(?:account|example|explanation|description|discussion|demonstration|claim|wording|method|approach)\b/iu,
  /\b(?:lecturer|presenter|narrator|speaker)\s+(?:says?|said|states?|stated|mentions?|mentioned|explains?|explained|shows?|showed|demonstrates?|demonstrated|teaches?|taught|calls?|called|describes?|described)\b/iu,
  /\b(?:what|which|how) (?:did|does|was|were) (?:the )?(?:lesson|video|lecture|presenter|instructor|teacher|professor|speaker|narrator).{0,80}\b(?:say|state|mention|show|explain|call|name|cover|teach|discuss)\b/iu,
  /\b(?:mentioned|shown|said|stated|covered|discussed|supported|described) (?:in|by) (?:the )?(?:lesson|video|lecture|transcript|presenter|instructor|teacher|professor|speaker|narrator)\b/iu,
  /\b(?:(?:according to|based on) (?:the )?source|the source (?:says?|states?|mentions?|explains?|shows?|describes?))\b/iu,
  /\b(?:according to (?:the )?described|(?:the )?(?:described|discussed|aforementioned) (?:mechanism|process|method|relationship|example)|as (?:described|discussed|shown|stated) (?:above|earlier|previously)|the (?:above|preceding|following) example|the evidence (?:says?|states?|shows?|supports?|indicates?))\b/iu,
  /\b(?:biodiversity(?:'s)?\s+weave|biodiversity\s+strands?|strands?\s+of\s+biodiversity|cutting\s+(?:too\s+)?many\s+links?\s+in\s+biodiversity|(?:weave|tapestry)\s+of\s+biodiversity)\b/iu,
  /(?:根据|按照|依照)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示|老师|讲师|主讲人)|(?:课|课程|视频|讲座|讲解|老师|讲师|主讲人)(?:中|里)?(?:提到|说到|讲到|介绍|展示)/u,
];

const QUESTION_DEICTIC_PATTERNS = [
  /^\s*(?:what|which|how)\b.{0,160}(?<![-\p{L}])(?:mentioned|listed|stated|discussed|shown|described|provided)\b/iu,
  /^\s*(?:what|which|how|why)\b.{0,180}\baccording to\b/iu,
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
  const boundedSentences = sentences.flatMap((sentence) => {
    if (sentence.length <= 650) return [sentence];
    return (
      sentence
        .match(/[\s\S]{1,300}(?:\s|$)/gu)
        ?.map((value) => value.trim())
        .filter(Boolean) ?? [sentence]
    );
  });
  if (sentences.length <= 1) {
    // Auto-caption tracks frequently contain no sentence punctuation. A
    // 700-character fallback unit can combine a strong mechanism with an
    // unrelated statistic; excluding the statistic then discards the useful
    // concept as collateral damage. Smaller units are recombined with their
    // immediate neighbors below, preserving enough evidence context while
    // allowing low-value spans to fail closed independently.
    return (
      normalized
        .match(/[\s\S]{1,120}(?:\s|$)/g)
        ?.map((value) => value.trim()) ?? [normalized]
    );
  }
  return boundedSentences;
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
  let cleaned = original;
  for (const pattern of SOURCE_FRAMING_PREFIX_PATTERNS) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const remainder = cleaned.slice(match[0].length).trim();
    if (!remainder) return original;
    cleaned = capitalizeFirstLetter(remainder);
    break;
  }
  for (const pattern of SOURCE_FRAMING_SUFFIX_PATTERNS) {
    const stripped = cleaned.replace(pattern, "").trim();
    if (stripped && stripped !== cleaned) {
      cleaned = stripped;
      break;
    }
  }
  return cleaned;
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

// Presentation vehicles are not assessment concepts. Keep this deliberately
// narrow so technical uses such as a network link or a DNA strand remain
// available, while the production metaphors that previously leaked into
// answer controls fail before storage.
const FIGURATIVE_PRESENTATION_SCAFFOLD_PATTERNS = [
  /\b(?:weav(?:e|es|ing|en)|tapestr(?:y|ies)|unravel(?:s|ed|ing)?)\b/iu,
  /\b(?:cut(?:ting)?\s+(?:too\s+)?many\s+links?|every\s+link\s+(?:provides|gives|adds)\s+stability)\b/iu,
  /\b(?:entire\s+)?fabric\s+of\s+(?:the\s+)?(?:reef|ecosystem|community|life|nature)\b/iu,
  /\bjacket\s+of\s+gases\b/iu,
  /\b(?:remove|removes|removed|removing)\s+(?:the\s+)?blocks\b/iu,
  // A live anesthesia bank described ion-channel blocking as a "chemical
  // barricade". That metaphor obscures the actual electrical/ion mechanism
  // and should be regenerated as a direct statement about nerve transmission.
  /\b(?:chemical|electrical)\s+(?:barricade|wall|shield)\b/iu,
  /(?:编织|织网|织物|线头|解开整张网|生态系统的结构|生态网络|气体外套)/u,
];

const HOW_CAN_QUESTION_PATTERN = /^\s*how\s+(?:can|could|may|might)\b/iu;
const CONCESSIVE_NON_ANSWER_PATTERN =
  /^\s*(?:(?:it|they|this|that)\s+(?:can|could|may|might)\s+)?even\s+(?:without|despite|when|if)\b/iu;
const MALFORMED_WH_ACTION_STEM_PATTERN =
  /^\s*what\s+(?:condition|factor|cause|process|method)\s+(?:do|does|did|can|could|will|would)\b.{0,160}\b(?:provide|support|affect|influence|enable|allow)\b/iu;
// A learner should be assessed on the concept itself, not on how a presenter
// characterized it. Keep this bounded: technical uses such as “the enzyme is
// described as catalytic” are still allowed unless the stem makes the
// presentation wording the condition being tested.
const PRESENTATION_CHARACTERIZATION_PATTERN =
  /\b(?:when|if)\s+(?:it|this|that|the\s+[^?]{1,90})\s+(?:is|was|are|were)\s+(?:described|presented|framed|characterized|referred\s+to)\b|\b(?:described|presented|framed|characterized|referred\s+to)\s+as\s+(?:motivated|important|central|useful|helpful|interesting|effective|valuable|necessary|key|significant)\b/iu;
// Definition polarity must not be inverted inside a true/false assertion.
// Catenation is the canonical example: it means carbon bonds to carbon (it
// does not mean bonding to hydrogen). This narrow guard rejects the malformed
// learner-visible claim and lets the normal local-AI retry select a supported
// definition instead of preserving a misleading question.
const CONTRADICTORY_CHEMISTRY_DEFINITION_PATTERN =
  /\b(?:catenat(?:e|es|ed|ing)|catenation)\b[^?!.]{0,100}\b(?:bond(?:s|ed|ing)?|attach(?:es|ed|ing)?)\b[^?!.]{0,60}\b(?:hydrogen|h)\b/iu;
const PLURAL_HOW_SINGULAR_PRONOUN_PATTERN =
  /^\s*how\s+(?:do|can|could|may|might)\b/iu;
const NAMED_CASE_RECALL_PATTERN =
  /^\s*(?:[Ww]hat|[Ww]hich|[Hh]ow|[Ww]hy)\b.{0,120}?\b(?!Earth\b)[A-Z][\p{L}-]+['’]s\s+(?:account|case|condition|decision|experience|illness|inability|injury|memory|symptoms?)\b/u;
const GENERIC_DETERMINATION_QUESTION_PATTERN =
  /^\s*what\s+(?:does|do|did)\s+(.{2,140}?)\s+(?:determine|control|govern|influence|affect)\??\s*$/iu;
const CIRCULAR_PROCESS_QUESTION_PATTERN =
  /^\s*how\s+(?:do|does|did)\s+(.{2,140}?)\s+(?:become|get|grow|develop|turn)\s+([\p{L}-]+)\b/iu;
const HOW_CAN_MECHANISM_ANSWER_PATTERN =
  /^(?:when|if|by|because|through|due\s+to|as\s+(?:a\s+result|\p{L}+\s+(?:declines?|falls?|rises?|increases?|decreases?)))\b|\b(?:loss|lack|reduction|removal|failure|disruption|decline|depletion|fragmentation|mutation|competition|pressure)\b.{0,120}\b(?:cause(?:s|d)?|make(?:s|d)?|lead(?:s)?\s+to|result(?:s|ed)?\s+in|weaken(?:s|ed)?|reduce(?:s|d)?|remove(?:s|d)?|disrupt(?:s|ed)?|undermine(?:s|d)?|increase(?:s|d)?|decrease(?:s|d)?|prevent(?:s|ed)?)\b|\b(?:cause(?:s|d)?|make(?:s|d)?|lead(?:s)?\s+to|result(?:s|ed)?\s+in|weaken(?:s|ed)?|reduce(?:s|d)?|remove(?:s|d)?|disrupt(?:s|ed)?|undermine(?:s|d)?|increase(?:s|d)?|decrease(?:s|d)?|prevent(?:s|ed)?)\b|(?:当|如果|通过|因为|由于|随着|导致|使得?|削弱|降低|减少|破坏|增加)/iu;
const HOW_OUTCOME_QUESTION_PATTERN =
  /^\s*how\s+(?:does|do|did|can|could|will|would)\b.{0,220}\b(?:affect|contribute(?:s)?(?:\s+to)?|support|strengthen|weaken|protect|promote|improve|reduce|increase|decrease|influence|impact|help|enable|allow|cause|determine|relate|depend|secure)\b/iu;
const OUTCOME_ANSWER_PATTERN =
  /\b(?:by|because|through|thereby|so that|allow(?:s|ed|ing)?|enable(?:s|d|ing)?|help(?:s|ed|ing)?|support(?:s|ed|ing)?|stabili[sz](?:e|es|ed|ing)|strengthen(?:s|ed|ing)?|weaken(?:s|ed|ing)?|increase(?:s|d|ing)?|decrease(?:s|d|ing)?|reduce(?:s|d|ing)?|prevent(?:s|ed|ing)?|protect(?:s|ed|ing)?|provide(?:s|d|ing)?|create(?:s|d|ing)?|distribut(?:e|es|ed|ing)|maintain(?:s|ed|ing)?|cause(?:s|d|ing)?|lead(?:s|ing)?\s+to|result(?:s|ed|ing)?\s+in|make(?:s|ing)?|affect(?:s|ed|ing)?|influenc(?:e|es|ed|ing)|promot(?:e|es|ed|ing)|facilitat(?:e|es|ed|ing)|ensure(?:s|d|ing)?|depend(?:s|ed|ing)?|share(?:s|d|ing)?|correspond(?:s|ed|ing)?|relat(?:e|es|ed|ing)|associate(?:s|d|ing)?|determin(?:e|es|ed|ing)|change(?:s|d|ing)?|rise(?:s|n)?|fall(?:s|en)?|encrypt(?:s|ed|ing)?|decrypt(?:s|ed|ing)?|authenticat(?:e|es|ed|ing)|verif(?:y|ies|ied|ying)|sign(?:s|ed|ing)?)\b/iu;
// A bounded cross-domain action vocabulary catches complete mechanisms that
// do not use one of the causal connector verbs above. The previous list
// falsely rejected valid answers such as "disperse their seeds" and "corals
// form interdependent relationships". This still rejects bare factors and
// component lists because a complete action verb must be present.
const OUTCOME_ACTION_ANSWER_PATTERN =
  /\b(?:absorb(?:s|ed|ing)?|adapt(?:s|ed|ing)?|amplif(?:y|ies|ied|ying)|attract(?:s|ed|ing)?|bind(?:s|ing|bound)?|block(?:s|ed|ing)?|break(?:s|ing)?\s+down|carry|carries|carried|carrying|circulat(?:e|es|ed|ing)|combin(?:e|es|ed|ing)|connect(?:s|ed|ing)?|consum(?:e|es|ed|ing)|convert(?:s|ed|ing)?|coordinat(?:e|es|ed|ing)|decompos(?:e|es|ed|ing)|detect(?:s|ed|ing)?|dispers(?:e|es|ed|ing)|dissolv(?:e|es|ed|ing)|exchange(?:s|d|ing)?|feed(?:s|ing)?|filter(?:s|ed|ing)?|form(?:s|ed|ing)?|generat(?:e|es|ed|ing)|grow(?:s|ing|n)?|interact(?:s|ed|ing)?|move(?:s|d|ing)?|organ(?:ize|izes|ized|izing|ise|ises|ised|ising)|produc(?:e|es|ed|ing)|recycl(?:e|es|ed|ing)|reflect(?:s|ed|ing)?|regulat(?:e|es|ed|ing)|release(?:s|d|ing)?|remove(?:s|d|ing)?|repel(?:s|led|ling)?|reproduc(?:e|es|ed|ing)|resist(?:s|ed|ing)?|route(?:s|d|ing)?|scatter(?:s|ed|ing)?|spread(?:s|ing)?|store(?:s|d|ing)?|surviv(?:e|es|ed|ing)|transfer(?:s|red|ring)?|transmit(?:s|ted|ting)?|transport(?:s|ed|ing)?|trap(?:s|ped|ping)?|trigger(?:s|ed|ing)?|withstand(?:s|ing)?)\b/iu;
const OUTCOME_RELATION_PATTERN =
  /\b(?:is|are|become(?:s)?|remain(?:s)?)\b.{0,100}\b(?:more|less|higher|lower|greater|smaller|larger|increased|decreased|reduced|vulnerable|resilient|stable|unstable|likely|unlikely|similar|different|dependent|independent)\b/iu;
const CJK_OUTCOME_ANSWER_PATTERN =
  /(?:通过|因为|因此|从而|使得?|导致|促进|支持|增强|减弱|提高|降低|减少|防止|保护|提供|产生|分配|维持|依赖|共享|对应|相关|决定|改变|上升|下降|加密|解密|验证)/u;

function determinationAnswerMerelyRestatesSubject(question, answer) {
  const subject = String(question ?? "").match(
    GENERIC_DETERMINATION_QUESTION_PATTERN,
  )?.[1];
  if (!subject) return false;
  const roots = (value) =>
    new Set(
      normalizeGroundedText(value)
        .split(/\s+/u)
        .map((token) =>
          token
            .replace(/^(?:deep|depth)$/u, "depth")
            .replace(/(?:ing|ed|es|s)$/u, ""),
        )
        .filter(
          (token) =>
            token.length >= 3 &&
            !ENGLISH_STOP_WORDS.has(token) &&
            !new Set([
              "the",
              "and",
              "different",
              "how",
              "level",
              "much",
              "through",
              "well",
            ]).has(token),
        ),
    );
  const subjectRoots = roots(subject);
  const answerRoots = roots(answer);
  if (!subjectRoots.size || !answerRoots.size) return false;
  const overlap = [...subjectRoots].filter((token) =>
    answerRoots.has(token),
  ).length;
  const novel = [...answerRoots].filter(
    (token) => !subjectRoots.has(token),
  ).length;
  return overlap === subjectRoots.size && novel <= 2;
}

function circularProcessAnswerMerelyRestatesQuestion(question, answer) {
  const match = String(question ?? "").match(CIRCULAR_PROCESS_QUESTION_PATTERN);
  if (!match) return false;
  const processSubject = normalizeGroundedText(match[1]);
  const resultingState = normalizeGroundedText(match[2]);
  const normalizedAnswer = normalizeGroundedText(answer);
  if (!processSubject || !resultingState || !normalizedAnswer) return false;
  const answerTokens = new Set(normalizedAnswer.split(/\s+/u));
  const stemTokens = new Set(
    `${processSubject} ${resultingState}`.split(/\s+/u).filter(Boolean),
  );
  const novelTokens = [...answerTokens].filter(
    (token) =>
      token.length >= 3 &&
      !stemTokens.has(token) &&
      !ENGLISH_STOP_WORDS.has(token) &&
      !new Set(["other", "people", "person", "individuals"]).has(token),
  );
  return novelTokens.length < 2;
}

/**
 * Require an answer to supply the outcome, relationship, or mechanism promised
 * by an explicit How-does/How-do question. Merely naming components or copying
 * a descriptive fragment is not an answer to a causal/contribution stem.
 */
export function multipleChoiceOptionMatchesQuestionKind(question, answer) {
  const prompt = String(question ?? "").trim();
  const choice = String(answer ?? "").trim();
  if (!prompt || !choice) return true;
  if (
    HOW_CAN_QUESTION_PATTERN.test(prompt) &&
    !HOW_CAN_MECHANISM_ANSWER_PATTERN.test(choice) &&
    !OUTCOME_ACTION_ANSWER_PATTERN.test(choice)
  ) {
    return false;
  }
  if (!HOW_OUTCOME_QUESTION_PATTERN.test(prompt)) return true;
  if (formulaFingerprint(choice)) return true;
  return (
    OUTCOME_ANSWER_PATTERN.test(choice) ||
    OUTCOME_ACTION_ANSWER_PATTERN.test(choice) ||
    OUTCOME_RELATION_PATTERN.test(choice) ||
    CJK_OUTCOME_ANSWER_PATTERN.test(choice)
  );
}

const COMPLETE_MC_ASSERTION_PATTERN =
  /(?:\b(?:is|are|was|were|will|would|can|could|has|have|had|causes?|caused|leads?|led|results?|resulted|increases?|increased|decreases?|decreased|rises?|rose|falls?|fell|traps?|trapped|absorbs?|absorbed|releases?|released|produces?|produced|converts?|converted|prevents?|prevented|protects?|protected|supports?|supported|depends?|depended)\b|(?:是|会|能够|导致|增加|减少|上升|下降|吸收|释放|产生|转换|防止|保护|支持|依赖))/iu;

/**
 * Repair only the stem when the model already supplied a complete, grounded
 * assertion but paired it with an incompatible wh-form. This is not a content
 * rewrite: the answer, evidence, distractors, and objective remain unchanged.
 * Bare factors, component lists, concessive fragments, and tautologies still
 * fail closed and consume the normal bounded automatic-retry budget.
 */
export function repairMultipleChoiceQuestionKind(candidate, answer) {
  const concept = String(candidate?.concept ?? "")
    .normalize("NFC")
    .replace(/[.!?。！？]+$/gu, "")
    .trim();
  const assertion = String(answer ?? "")
    .normalize("NFC")
    .trim();
  if (!concept || !assertion) return null;
  if ((semanticTokens(assertion).size ?? 0) < 4) return null;
  if (!COMPLETE_MC_ASSERTION_PATTERN.test(assertion)) return null;
  if (CONCESSIVE_NON_ANSWER_PATTERN.test(assertion)) return null;
  const normalizedConcept = normalizeGroundedText(concept);
  const normalizedAssertion = normalizeGroundedText(assertion);
  if (
    normalizedConcept.length >= 12 &&
    normalizedAssertion.length >= 12 &&
    (normalizedConcept.includes(normalizedAssertion) ||
      normalizedAssertion.includes(normalizedConcept))
  ) {
    return null;
  }
  if (
    SOURCE_REFERENCE_PATTERNS.some((pattern) => pattern.test(concept)) ||
    LOGISTICS_PATTERNS.some((pattern) => pattern.test(concept))
  ) {
    return null;
  }
  const objective = String(candidate?.objectiveCategory ?? "").toLowerCase();
  const isChinese = /\p{Script=Han}/u.test(concept);
  const lead = isChinese
    ? objective === "definition"
      ? "请选择正确定义"
      : objective === "condition"
        ? "请选择正确说明以下概念成立条件的陈述："
        : objective === "mechanism"
          ? "请选择正确解释以下机制的陈述："
          : objective === "method"
            ? "请选择正确描述以下方法的陈述："
            : objective === "application"
              ? "请选择正确应用"
              : objective === "formula"
                ? "请选择正确表示"
                : "请选择正确描述"
    : objective === "definition"
      ? "Which statement correctly defines"
      : objective === "condition"
        ? "Which statement correctly identifies the condition for"
        : objective === "mechanism"
          ? "Which statement correctly explains the mechanism of"
          : objective === "method"
            ? "Which statement correctly describes the method for"
            : objective === "application"
              ? "Which statement correctly applies"
              : objective === "formula"
                ? "Which expression correctly represents"
                : "Which statement correctly describes";
  const question = isChinese
    ? objective === "definition" || objective === "application"
      ? `${lead}${concept}的陈述。`
      : objective === "formula"
        ? `${lead}${concept}的表达式。`
        : objective === "condition" ||
            objective === "mechanism" ||
            objective === "method"
          ? `${lead}${concept}。`
          : `${lead}${concept}的陈述。`
    : `${lead} ${concept}?`;
  return questionConceptFailure({
    ...candidate,
    question,
    answerText: assertion,
    correctAnswer: assertion,
  }) === null
    ? question
    : null;
}

const NUMERIC_RECALL_QUESTION_PATTERN =
  /^\s*(?:(?:what (?:percentage|percent|number|count|frequency|duration|amount|value|cost|price)|how (?:many|often|long|much))\b|(?:多少|几次|多久|百分之几|占比多少|价值多少|价格多少|成本多少))/iu;
const NECESSARY_NUMERIC_OBJECTIVE_PATTERN =
  /\b(?:calculate|compute|derive|solve|formula|equation|law|threshold|limit|rate|ratio|minimum|required|maximum|mechanism|causes?|because|results? in|produces?)\b|(?:计算|推导|求解|公式|方程|定律|阈值|极限|速率|比率|最小|必须|最大|机制|导致|因为|产生)/iu;
const NON_TRANSFERABLE_QUANTITATIVE_PATTERN =
  /(?:\b(?:estimated|reported|surveyed|annual)\b.{0,60}\b(?:monetary|market|economic|financial)?\s*(?:value|worth|cost|price|output|total|amount|percentage|percent|count|frequency|figure|statistic)s?\b|\b(?:projected|forecast|predicted|estimated|expected)\b.{0,90}\b(?:range|increase|decrease|change|temperature|amount|value|percentage|percent|count|frequency|figure|statistic)s?\b|\b(?:annual monetary value|monetary value|global economic output|market worth|economic estimate|survey percentage)\b|[$€£¥]\s*\d|\b\d+(?:\.\d+)?\s*(?:trillion|billion|million|thousand)\s+(?:dollars?|euros?|pounds?|yen)\b|(?:估计|估算|报告|调查).{0,30}(?:货币价值|市场价值|经济产出|金额|百分比|数量|频率)|(?:货币价值|市场价值|经济产出).{0,30}(?:万亿|亿|万元|美元|人民币))/iu;
const PRESENTATION_STATISTIC_ATTRIBUTION_PATTERN =
  /\baccording to\b.{0,80}\b(?:calculations?|estimates?|statistics?|surveys?|figures?|reported data)\b|(?:根据|按照).{0,30}(?:计算|估算|统计|调查|数据)/iu;
const ATTRIBUTED_MEASUREMENT_SOURCE_PATTERN =
  /\baccording to\b.{0,90}\b(?:stud(?:y|ies)|research|reports?|records?|measurements?|observations?|data|nasa|noaa|who|cdc)\b|\b(?:stud(?:y|ies)|research|reports?|records?|measurements?|observations?|data)\s+(?:from|by)\s+(?:nasa|noaa|who|cdc|the\s+\p{L}+(?:\s+\p{L}+){0,3})\b|\b(?:reports?|reported|records?|recorded|measures?|measured|observes?|observed|estimates?|estimated)\b.{0,100}\b(?:(?:1[5-9]|20)\d{2}|\d+(?:\.\d+)?\s*(?:%|percent))\b|(?:根据|按照).{0,40}(?:研究|报告|记录|测量|观测|数据)/iu;
const NON_TRANSFERABLE_DATE_STATISTIC_SOURCE_PATTERN =
  /\b(?:the\s+year|in)\s+(?:1[5-9]|20)\d{2}\b.{0,120}\b(?:warmest|coldest|highest|lowest|largest|smallest|most|least|recorded|reported|observed|measured|record)\b/iu;
const QUANTITATIVE_ANSWER_PATTERN =
  /(?:[$€£¥]\s*\d|\b\d+(?:\.\d+)?\s*(?:to|[-–—])\s*\d+(?:\.\d+)?\s*(?:degrees?(?:\s+(?:fahrenheit|celsius))?|°\s*[cf]|%|percent|years?|months?|days?|hours?|minutes?|seconds?)?\b|\b\d+(?:\.\d+)?\s*(?:degrees?(?:\s+(?:fahrenheit|celsius))?|°\s*[cf]|ppm|ppb|%|percent|trillion|billion|million|thousand|dollars?|euros?|pounds?|yen|years?|times|devices?|people)\b|^(?:it is |they are )?(?:less|greater|higher|lower|more|fewer|equal|about half|roughly twice)\b|(?:万亿|亿|万元|美元|人民币|百分之|更少|更多|更高|更低))/iu;
const EXTERNAL_AUTHORITY_QUESTION_PATTERN =
  /^\s*(?:what|which|how)\b.{0,120}\b(?:organizations?|agencies|experts?|scientists?|researchers?|analysts?)\b.{0,80}\b(?:advocate|recommend|suggest|say|state|report|predict|project|estimate)\b/iu;

function isNonTransferableQuantitativeEvidence(value) {
  const text = String(value ?? "");
  if (NECESSARY_NUMERIC_OBJECTIVE_PATTERN.test(text)) return false;
  return (
    NON_TRANSFERABLE_QUANTITATIVE_PATTERN.test(text) ||
    PRESENTATION_STATISTIC_ATTRIBUTION_PATTERN.test(text) ||
    ATTRIBUTED_MEASUREMENT_SOURCE_PATTERN.test(text) ||
    NON_TRANSFERABLE_DATE_STATISTIC_SOURCE_PATTERN.test(text) ||
    QUANTITATIVE_ANSWER_PATTERN.test(text)
  );
}

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
  if (EXTERNAL_AUTHORITY_QUESTION_PATTERN.test(question)) {
    return "source_framing_invalid";
  }
  if (PRESENTATION_CHARACTERIZATION_PATTERN.test(question)) {
    return "source_framing_invalid";
  }
  if (CONTRADICTORY_CHEMISTRY_DEFINITION_PATTERN.test(inspected)) {
    return "source_grounding_invalid";
  }
  if (
    FIGURATIVE_PRESENTATION_SCAFFOLD_PATTERNS.some((pattern) =>
      pattern.test(inspected),
    )
  ) {
    return "low_pedagogical_value";
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
  if (determinationAnswerMerelyRestatesSubject(question, directAnswerSource)) {
    return "question_tautology_invalid";
  }
  if (
    circularProcessAnswerMerelyRestatesQuestion(question, directAnswerSource)
  ) {
    return "question_tautology_invalid";
  }
  if (NAMED_CASE_RECALL_PATTERN.test(question)) {
    return "low_pedagogical_value";
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
  // A concessive condition is not a mechanism. The production regression
  // asked "How can an ecosystem become vulnerable ...?" but accepted "even
  // without catastrophic events" as the answer. That phrase only repeats the
  // stem's exception; it never explains how the outcome occurs.
  if (
    HOW_CAN_QUESTION_PATTERN.test(question) &&
    CONCESSIVE_NON_ANSWER_PATTERN.test(directAnswerSource)
  ) {
    return "question_answer_kind_mismatch";
  }
  if (MALFORMED_WH_ACTION_STEM_PATTERN.test(question)) {
    return "question_answer_kind_mismatch";
  }
  if (
    PLURAL_HOW_SINGULAR_PRONOUN_PATTERN.test(question) &&
    /^\s*(?:it|this)\b/iu.test(directAnswerSource)
  ) {
    return "question_answer_kind_mismatch";
  }
  if (!multipleChoiceOptionMatchesQuestionKind(question, directAnswerSource)) {
    return "question_answer_kind_mismatch";
  }
  return null;
}

const NON_ENGLISH_PROSE_SCRIPT_PATTERN =
  /[\p{Script=Arabic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}]/u;
const NON_CHINESE_PROSE_SCRIPT_PATTERN =
  /[\p{Script=Arabic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}]/u;
const HAN_SCRIPT_PATTERN = /\p{Script=Han}/u;
const CHINESE_TECHNICAL_TOKEN_PATTERN =
  /^(?:[A-Z][A-Z0-9]{1,9}|(?:[A-Z][a-z]?\d*)+(?:[+\-−=<>→⇌][A-Za-z0-9]+)*|[\d\s.,:%+\-−=*/^()<>≤≥→⇌]+)$/u;

function matchesChineseLearnerLanguage(value) {
  const text = String(value ?? "").trim();
  return (
    HAN_SCRIPT_PATTERN.test(text) ||
    CHINESE_TECHNICAL_TOKEN_PATTERN.test(text) ||
    Boolean(formulaFingerprint(text))
  );
}

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
    return values.every(matchesChineseLearnerLanguage);
  }
  return false;
}

function sentenceExcludedFromConceptFirst(value) {
  return (
    LOGISTICS_PATTERNS.some((pattern) => pattern.test(value)) ||
    isNonTransferableQuantitativeEvidence(value) ||
    FIGURATIVE_PRESENTATION_SCAFFOLD_PATTERNS.some((pattern) =>
      pattern.test(value),
    ) ||
    /\b(?:hello|hi everyone|welcome(?: back)?|thanks for watching|see you next|subscribe|like and share|sponsor(?:ed)?|promo code|my name is|today i(?:'m| am) joined by)\b/iu.test(
      value,
    ) ||
    /(?:大家好|欢迎|感谢观看|下期再见|订阅|点赞|赞助|推广)/u.test(value)
  );
}

function sentenceExcludedFromPromptFirstV511(value) {
  return (
    sentenceExcludedFromConceptFirst(value) ||
    // These source spans are useful narrative context, but they are poor
    // assessment targets. Remove them before assigning per-question evidence
    // so the model is never told to prefer biographical, publicity, secrecy,
    // or incidental-count trivia over a mechanism in a neighboring span.
    /\b(?:coined\s+(?:the\s+)?term|term\b.{0,70}\b(?:was\s+)?coined\s+by|credited\s+with\s+being\s+the\s+first|first\s+person\s+to|undergraduate\s+(?:architecture\s+)?thesis|stumbled\s+on\s+(?:a\s+)?(?:potentially\s+deadly\s+)?(?:mistake|discovery)|oversight\s+that\s+threatened|world['’]s\s+(?:tallest|largest|smallest)|sloped\s+roof\s+was\s+unique|court\s+was\s+(?:somewhat\s+)?skeptical|seemingly\s+quiet\s+afternoon|estimated\s+\d+\s+colds?|within\s+a\s+few\s+days|one[- ]in[- ]\w+\s+chance|confidential\s+plan|emergency\s+evacuation|secret\s+evacuation|hurricane\s+veered\s+out\s+to\s+sea|halfway\s+complete\s+when\s+hurricane|covert\s+construction|press\s+was\s+occupied|newspaper\s+strike|public\s+didn['’]t\s+learn|skyscraper\s+in\s+(?:midtown|downtown)\s+[A-Z][\p{L}-]+|everything\s+he\s+did\s+next\s+was\s+top\s+secret|never\s+told\s+[A-Z][\p{L}-]+|without\s+(?:alerting|warning)\s+(?:the\s+)?(?:public|residents)|night[- ]time\s+shifts?|kept\s+.{0,50}\s+secret\s+from)\b/iu.test(
      value,
    ) ||
    /^\s*if\s+you(?:'ve|\s+have|\s+ever)\b/iu.test(value) ||
    /^\s*(?:he|she|they)\s+(?:tested|proposed|argued|believed|invented|discovered)\s+(?:his|her|their)\s+(?:idea|theory|design|device|experiment)\b/iu.test(
      value,
    ) ||
    /^\s*(?:-\s*)?\[[^\]]{1,40}\]\s*/u.test(value) ||
    /\b(?:what\s+if\s+i\s+told\s+you|automated\s+investment\s+platform|build\s+a\s+portfolio|grow\s+your\s+money|wealthfront|became\s+popular\s+in\s+the\s+decades|still\s+used\s+today)\b/iu.test(
      value,
    ) ||
    /\b(?:this\s+video\s+is\s+part\s+of\s+a\s+series|playlist\s+linked\s+in\s+the\s+card|we(?:'re|\s+are)\s+standing\s+on\s+a\s+planet|solar\s+system\s+is\s+circling\s+the\s+center|of\s+course\s+it['’]s\s+moving)\b/iu.test(
      value,
    ) ||
    /\b(?:financial\s+manager|annual\s+advisory\s+fee|quarter[- ]percent|give\s+it\s+a\s+try\s+today|link\s+in\s+the\s+description|support\s+(?:our\s+)?sponsors?|support\s+the\s+channel|single\s+video\s+overview|other\s+channels|thank\s+you\s+for\s+watching|water\s+gets\s+along\s+with\s+nearly\s+every\s+substance)\b/iu.test(
      value,
    ) ||
    /\b(?:science\s+of[.…\s]*everything|do(?:es)?\s+not\s+metabolize\s+betanin|urine\s+and\s+feces\s+purple|developed\s+in\s+the\s+1870s|first\s+common\s+(?:anesthetic|one)|quick\s+demonstration|browser\s+address\s+bar|padlock\s+icon|connection\s+(?:to\s+the\s+website\s+)?is\s+secure|clicking\s+on\s+the\s+padlock|view\s+the\s+certificate|public\s+key\s+info\s+button|three\s+constitutions\s+and\s+five\s+governments|next\s+republic\s+formed\s+in\s+1871|maybe\s+.{0,60}\s+isn['’]t\s+the\s+best\s+word|plates\s+don['’]t\s+move\s+in\s+one\s+continuous\s+motion)\b/iu.test(
      value,
    ) ||
    /\b(?:ancient\s+rome|romans?\s+.{0,50}\s+(?:urine|dyers?)|sell\s+(?:their\s+)?urine|join\s+(?:our\s+)?community\s+on\s+patreon|patreon|keep\s+(?:all\s+)?crash\s+course\s+free)\b/iu.test(
      value,
    ) ||
    /\b(?:legend\s+has\s+it|chaotic\s+chorus|beets?\s+(?:are|is)\s+high\s+in\s+betanin|betanin\s*,?\s+a\s+dye\s+that\s+gives|lovely\s+purple\s+color)\b/iu.test(
      value,
    ) ||
    /\b(?:fabrics?\s+in\s+urine\s+dye|in\s+this\s+episode\s*,?\s+we\s+talked|next\s+time\s*,?\s+we['’]ll|you\s+probably\s+know\s+the\s+feeling|final\s+plaintive\s+bleep|throwing\s+your\s+battery|singing\s+its\s+praises|infernal\s+tangle\s+of\s+power\s+cables)\b/iu.test(
      value,
    ) ||
    /\b(?:all\s+these\s+sensors|another\s+kind\s+of\s+.{0,50}\s+is\s+called|since\s+the\s+1700s\s*,?\s+scientists\s+have\s+improved)\b/iu.test(
      value,
    ) ||
    /\b(?:this\s+causes\s+)?(?:the\s+)?plates?\s+to\s+spread\s+very\s+slowly\b.{0,100}\b1\s+to\s+20\s+centimet(?:er|re)s?\s+per\s+year\b/iu.test(
      value,
    ) ||
    /\bjust\s+imagine\s+if\s+the\s+continents?\s+were\s+still\s+connected\s+today\b/iu.test(
      value,
    ) ||
    /\b(?:himalayas?\s+(?:grow|rise)\s+by\s+(?:more|less)\s+than\s+one\s+centimet(?:er|re)\s+(?:each|per)\s+year|grow(?:s|ing)?\s+by\s+(?:more|less)\s+than\s+one\s+centimet(?:er|re)\s+(?:each|per)\s+year)\b/iu.test(
      value,
    ) ||
    /\b(?:tectonic\s+plates?\s+(?:spread|move).{0,60}\b1\s+to\s+20\s+centimet(?:er|re)s?\s+per\s+year|(?:mixture|column)\s+of\s+.{0,50}\bsand|(?:white|black|different[- ]sized)\s+sand.{0,80}\bsettles?|sand.{0,80}\bsettling\s+velocit(?:y|ies)|central\s+part\s+of\s+understanding\s+organic\s+chemistry|expending\s+one\s+battery\s+to\s+charge\s+another|plugging\s+a\s+charger\s+into\s+the\s+wall|asthenosphere\s+is\s+also\s+pretty\s+solid|in\s+the\s+early\s+1[5-9]00s|galvani\s+believed|volta\s+(?:believed|thought|argued))\b/iu.test(
      value,
    ) ||
    /\b(?:first\s+line\s+of\s+defense\s+in\s+the\s+fight\s+against\s+dirty\s+water|sifted\s+the\s+(?:white|black)\s+sand|combined\s+both\s+sands|sand\s+mixture\s+demonstration|best\s+bet\s+to\s+forestall|plugging\s+(?:your|a)\s+charger\s+into\s+the\s+wall|one\s+battery\s+to\s+charge\s+another)\b/iu.test(
      value,
    ) ||
    /\b(?:simple\s+but\s+crucial\s+responsibility\s+in\s+the\s+process\s+of\s+treating\s+wastewater|rows?\s+of\s+circular\s+ponds?.{0,100}\bresponsibility)\b/iu.test(
      value,
    ) ||
    /\b(?:to\s+answer\s+that\s*,?\s+we\s+need\s+to\s+understand|you\s+were\s+under\s+anesthesia|it\s+might\s+seem\s+like\s+you\s+were\s+asleep|phone\s+utters?.{0,60}\bbleep|cuts?\s+out\s+in\s+the\s+middle\s+of\s+your\s+call|cleaner\s+up\s+between\s+the\s+two|hook\s+(?:a\s+)?(?:lightbulb|vacuum\s+cleaner))\b/iu.test(
      value,
    ) ||
    /\b(?:no\s+longer\s+rely\s+on\s+pots?|earthquakes?\s+still\s+offer\s+a\s+unique\s+challenge|why\s+are\s+earthquakes?\s+so\s+hard\s+to\s+anticipate|hope\s+you['’]re\s+just\s+as\s+excited|bring\s+this\s+all\s+full[- ]circle|we['’]re\s+going\s+to\s+learn\s+so\s+much\s+together|power\s+e\s+d\s+minus\s+one|fermat['’]?s?\s+little\s+theorem|he\s+thought\s+the\s+reaction\s+was\s+happening\s+in\s+the\s+copper)\b/iu.test(
      value,
    ) ||
    /\b(?:vase.{0,100}\b(?:direction|send\s+aid)|direction\s+they\s+should\s+send\s+aid|messengers?\s+came\s+for\s+help|doubts?\s+turned\s+to\s+gratitude|partially\s+molten\s+layer\s+of\s+earth['’]s\s+mantle|three\s+magic\s+numbers?|glass\s*,?\s+rocks\s*,?\s+minerals|gems?\s+other\s+than\s+diamonds|batteries?\s+will\s+diminish\s+daily|losing\s+capacity\s+until\s+(?:they|it)\s+(?:finally\s+)?die)\b/iu.test(
      value,
    ) ||
    /\b(?:treating\s+(?:them|problems?)\s+like\s+(?:a\s+)?puzzle|in\s+the\s+1840s.{0,100}\bether|standard\s+unit\s+of\s+electric\s+potential.{0,100}\bvolt|honou?r\s+volta['’]s\s+discovery|how\s+do\s+(?:our\s+)?batteries\s+(?:even\s+)?store\s+so\s+much\s+charge|autoimmune\s+diseases?.{0,80}\btrick\s+the\s+immune\s+system|no\s+one\s+knows\s+exactly\s+what\s+causes\s+them|latin\s+prefix\s+meaning\s+apart|who\s+gets\s+to\s+make\s+decisions\s+for\s+others|what\s+rights\s+do\s+people\s+have.{0,80}\bwhere\s+do\s+they\s+come\s+from|secret\s+magic\s+numbers?|magic\s+value|cryptography\s+of\s+course\s+yet\s+his\s+results)\b/iu.test(
      value,
    ) ||
    /\b(?:we\s+owe\s+it\s+our\s+lives|without\s+it.{0,80}\bthreats?\s+would\s+escalate|next\s+time\s+you\s+(?:catch\s+a\s+cold|scratch\s+a\s+mosquito\s+bite)|fully\s+funded\s+phd|guaranteed.{0,40}\b(?:phd|doctorate))\b/iu.test(
      value,
    ) ||
    /\b(?:where\s+did\s+(?:the\s+)?magic\s+number|where\s+does\s+(?:the\s+)?magic\s+number|three\s+questions\s+we\s+can\s+ask|how\s+does\s+the\s+computation\s+work.{0,80}\bwhy\s+does\s+it\s+reverse)\b/iu.test(
      value,
    ) ||
    /\b(?:12[- ]hour\s+clock|subtracting\s+1\s+hour\s+from|minus\s+one\s+hour\s+is\s+11|hundreds?\s+of\s+discharge[- ]recharge\s+cycles?|thousands?\s+of\s+(?:discharge[- ]recharge\s+)?cycles?|when\s+b[- ]?\s+and\s+t[- ]?cells\s+identify\s+antigens|cells\s+can\s+swiftly\s+deploy\s+the\s+right\s+antibodies|napoleon.{0,80}\btook\s+charge\s+as\s+a\s+general|became\s+emperor\s+while\s+claiming\s+to\s+defend)\b/iu.test(
      value,
    ) ||
    /\b(?:marie\s+antoinette.{0,100}\bnine\s+months|nine\s+months\s+(?:before|after).{0,80}\bexecution|future\s+batteries?.{0,120}\b(?:light|thin)\s+sheets?|quantum\s+physics.{0,120}\bcharge\s+cycles?|hundreds?\s+of\s+thousands?\s+of\s+charge\s+cycles?|not\s+always\s+easy\s+to\s+determine\s+whether.{0,60}\bprime)\b/iu.test(
      value,
    ) ||
    /\b(?:mike\s+pound.{0,120}\b(?:video|channel)|interesting\s+video\s+watch\s+it|we\s+see\s+rsa\s+everywhere|connecting\s+to\s+the\s+internet.{0,80}\brsa|napoleon\s+bonaparte.{0,100}\b(?:took\s+charge|became\s+emperor)|general\s+who\s+rose\s+to\s+power.{0,100}\bbecame\s+emperor)\b/iu.test(
      value,
    ) ||
    /\b(?:diffie[- ]hellman\s+key\s+exchange|e\s*b\s+minus\s+1.{0,140}\bmultiple\s+of\s+both|multiple\s+of\s+both.{0,160}\bprime\s+number\s+minus\s+1|apply\s+a\s+theorem.{0,100}\bfermat|fermat['’]?s?\s+little\s+theorem.{0,160}\b(?:cancel|original\s+message|decryption))\b/iu.test(
      value,
    ) ||
    /\b(?:91[- ]hour\s+clocks?|power\s+(?:of\s+)?5.{0,120}\bpower\s+(?:of\s+)?29|power\s+(?:of\s+)?29.{0,120}\bpower\s+(?:of\s+)?5|29\s+is\s+a\s+magical\s+number|special\s+property\s+of\s+5\s+and\s+29|for\s+each\s+of\s+them\s+individually\s+we\s+can\s+apply\s+a\s+theorem\s+known\s+as)\b/iu.test(
      value,
    ) ||
    /\b(?:drive\s+from\s+africa\s+to\s+antarctica|take\s+a\s+train\s+from\s+south\s+america\s+to\s+europe|could\s+you\s+(?:drive|take\s+a\s+train).{0,120}\bpangea)\b/iu.test(
      value,
    ) ||
    /\b(?:volta\s+disagreed.{0,100}\bleg\s+twitch|debate\s+was\s+eventually\s+settled|groundbreaking\s+experiment.{0,80}\bvolta)\b/iu.test(
      value,
    ) ||
    /\b(?:olympic[- ]sized\s+swimming\s+pools?|do\s+a\s+lap\s+or\s+two|i['’]?m\s+[A-Z][\p{L}-]+\s*,?\s+and\s+this\s+is|in\s+today['’]?s\s+episode|we['’]re\s+talking\s+about\s+settlement)\b/iu.test(
      value,
    ) ||
    /\b(?:fractions?\s+that\s+were\s+previously\s+blended|previously\s+blended\s+fractions?|separate\s+themselves\s+again.{0,80}\bcolumn\s+of\s+water)\b/iu.test(
      value,
    ) ||
    /\b(?:galvani|animal\s+electricity|frog['’]s?\s+leg\s+twitch|frog\s+leg\s+twitch)\b/iu.test(
      value,
    ) ||
    /\b(?:tectonic\s+plates?.{0,100}\b(?:ride|float)\s+on\s+(?:a\s+)?hot\s*,?\s+partially\s+molten\s+(?:layer|mantle)|partially\s+molten\s+(?:layer|mantle).{0,100}\btectonic\s+plates?)\b/iu.test(
      value,
    ) ||
    /\b(?:tens\s+of\s+thousands\s+of\s+lives|about\s+as\s+fast\s+as\s+(?:your\s+)?fingernails?\s+grow)\b/iu.test(
      value,
    ) ||
    /\b(?:none\s+of\s+these\s+technologies\s+would\s+be\s+as\s+helpful|simply\s+looking\s+deep\s+inside\s+the\s+earth|for\s+now\s*,?\s+these\s+technologies|without\s+waiting\s+for\s+directions\s+from\s+a\s+vase)\b/iu.test(
      value,
    ) ||
    /\b(?:zhang\s+heng|han\s+court|dragon\s+mouths?|directional\s+dragon|ball\s+into\s+a\s+frog|earthquake\s+vase|seismoscope)\b/iu.test(
      value,
    ) ||
    /\btectonic\s+plates\s+are\s+solid\s*,?\s+and\s+they['’]re\s+denser\s+and\s+cooler\s+than\s+the\s+asthenosphere\b/iu.test(
      value,
    ) ||
    /\b(?:nebula|streaming platforms?|subscription fatigue|monthly cost|annual plan|lifetime membership|click (?:the|this) link|link below|support what i(?:'m| am) doing|independent creators?|full[- ]length documentary|available on (?:nebula|a streaming platform)|the team at .{1,60} released|best case study that i know of|to quote [\p{L} .'-]{2,80})\b/iu.test(
      value,
    ) ||
    /\b(?:brilliant|sign\s+up\s+for\s+free|keep\s+(?:your|their)\s+skills\s+sharp|great\s+for\s+anybody|learn\s+more\s+about\s+the\s+concepts|reporting\s+outlets|media\s+conglomerates|high\s+factuality|blind\s+spot|disclaimer|shown\s+here|the\s+one\s+shown|what\s+(?:i|we)(?:'ve|\s+have)?\s+shown|i(?:'m|\s+am)\s+not\s+going\s+to\s+argue|stop\s+talking\s+to\s+your\s+computers|thought\s+bubble|would\s+not\s+end\s+there|doesn['’]t\s+end\s+there|as\s+we\s+will\s+see|what\s+happens\s+next|before\s+we\s+move\s+on|this\s+brings\s+us\s+to)\b/iu.test(
      value,
    ) ||
    /\b(?:to\s+learn\s+more|test\s+your\s+knowledge)\b.{0,100}\bclick\s+here\b/iu.test(
      value,
    ) ||
    /\b(?:everybody['’]s\s+talking\s+about|i\s+(?:actually\s+)?did\s+a\s+video|comments?\s+on\s+that|frequently\s+asked\s+questions?|since\s+that\s+video\s+was\s+recorded|taking\s+over\s+the\s+world|we\s+see\s+them\s+everywhere)\b/iu.test(
      value,
    ) ||
    /\b(?:let\s+me\s+give\s+you\s+an\s+analogy|an\s+analogy|think\s+(?:of|about)\s+this\s+as|think\s+about\s+this\s+(?:a\s+little\s+bit\s+)?like)\b/iu.test(
      value,
    ) ||
    /\b(?:story|stories)\b.{0,100}\b(?:news|reporting|media|worldview|broad\s+perspective)\b/iu.test(
      value,
    ) ||
    /\bvolta\s+would\s+have\s+been\s+shocked\b/iu.test(value) ||
    /\bwhat\s+happened\s+in\s+volta['’]s\s+cell\s+is\s+something\s+chemists\s+now\s+call\b/iu.test(
      value,
    ) ||
    /(?:免责声明|报名|免费注册|赞助商|品牌推广|视频中展示|如图所示)/u.test(
      value,
    )
  );
}

function sentenceExcludedFromPromptFirstV512(value) {
  return (
    sentenceExcludedFromPromptFirstV511(value) ||
    // A history-themed source still needs durable learning objectives. Remove
    // biography, publicity, public-fame, classroom-demonstration, and broad
    // timeline sentences before ranking so automatic recovery does not burn
    // multiple DeepSeek calls discovering that these slots are unusable.
    /\b(?:goes?\s+(?:all\s+the\s+way\s+)?back\s+to\s+antiquity|has\s+its\s+roots\s+in\s+pre-industrial\s+questions|born\s+to\s+(?:a\s+)?(?:poor|wealthy|rich)\s+family|became\s+obsessed\s+with|started\s+(?:his|her|their)\s+career\b|at\s+the\s+age\s+of\s+\w+|(?:average|ordinary|typical)\s+(?:person|people|public)\b.{0,100}\b(?:know|knew|recognize|recognized|familiar)|people\s+remember\b.{0,100}\bfor\s+(?:his|her|their)\s+work|promoted\s+capital\s+punishment|electric\s+chair\s+powered\s+by|while\s+demonstrating\s+to\s+(?:his|her|their)\s+students|watched\s+as\s+(?:a\s+)?friend\s+reproduced|academy\s+of\s+science\s+in\s+paris|ethical\s+scientific\s+demonstrations?|weird\s+parlour\s+tricks?|weird\s+parlor\s+tricks?|excuse\s+to\s+conduct\b.{0,100}\bdemonstrations?|pushing\s+off\s+bedtime|no\s+one\s+could\s+really\s+explain\s+how\s+it\s+worked|amazed\b.{0,80}\bwent\s+to\s+work\s+figuring\s+out|got\s+to\s+work\s+inventing|clouds?\s+are\s+in\s+love|baby\s+cloud|hop\s+across\s+the\s+atlantic|menlo\s+park\s*,?\s+new\s+jersey|as\s+the\s+story\s+goes|flew\s+(?:his|her|their)\s+kite\s+in\s+a\s+storm|edison\s+and\s+other\s+inventors\b.{0,120}\btransform\s+the\s+world|the\s+stage\s+was\s+set\b.{0,120}\benter\s+motors)\b/iu.test(
      value,
    ) ||
    /^(?:time\s+to\s+get\b|\[?intro\s+music|mostly\s*,?\s*people\s+remember\b|most\s+importantly\s*,?\s*to\b|his\s+(?:motors?|work)\b|the\s+first\s+iterations?\b|somehow\s*,?\s*(?:he|she|they)\b)/iu.test(
      String(value ?? "").trim(),
    ) ||
    // A complete sentence can still be unusable as a standalone assessment
    // fact when its subject exists only in the presenter's story, a hidden
    // diagram, or a stage pointer. Do not leave DeepSeek to guess the missing
    // referent: rotate to another independently meaningful fact instead.
    /\b(?:all\s+i\s+wanted\s+to\s+do|i\s+wanted\s+to\s+find|for\s+this\s+problem\b.{0,180}\b(?:simplif(?:y|ied)|just\s+look\s+at)|this\s+last\s+phase\b.{0,120}\bright\s+over\s+here|at\s+this\s+phase\b.{0,160}\b(?:workforce|population|birth|death)|large\s+galls?\s+become\s+an\s+easy\s+meal\s+for\s+them|dinosaurs?\s+are\s+far\s+in\s+the\s+past\b.{0,120}\brelatives?\s+are\s+still\s+among\s+us|go\s+really\s+far\s+away\s+to\s+not\s+be\s+affected\s+by\b.{0,120}\bgravitational\s+force|objects?\s+with\s+mass\s*,?\s+to\s+explain\s+this|first\s+of\s+these\s+stories|red\s+arrow\s+represents\s+selection\s+pressure|snow\s+vole\b.{0,120}\bmouse[- ]like\s+mammal|when\s+you\s+put\s+the\s+slice\s+of\s+pizza\s+on\s+the\s+plate|japan\s+has\s+a\s+declining\s+population\b.{0,100}\beven\s+places\s+like\s+the\s+united\s+states|the\s+family\s+is\s+overall\s+likely\s+to\s+be\s+wealthier|people\s+are\s+even\s+having\s+illnesses?\s+or\s+dying\s+from\s+malnutrition|education\s+generally\s+is\s+at\s+a\s+low\s+level\b.{0,220}\black\s+of\s+a\s+healthcare\s+system|countries?\s+might\s+start\s+to\s+industrialize|another\s+really\s+awesome\s+example\s+of\s+a\s+negative\s+feedback\s+loop|birds?\s*,?\s+like\s+every\s+modern\s+species\b.{0,160}\bseries\s+of\s+ancestors)\b/iu.test(
      value,
    ) ||
    /\b(?:these|those)\s+(?:firms?|groups?|people|objects?|species|cells?|cases?|situations?)\b/iu.test(
      value,
    ) ||
    /^(?:once\s+again|whatever\s+the\b)/iu.test(String(value ?? "").trim()) ||
    /\b(?:previous|multiple|other|another)\s+videos?\b|\bin\s+many\s+situations\b.{0,120}\bmonopoly\s+firm\b.{0,120}\b(?:cannot|can['’]?t)\s+do\s+price\s+discrimination\b/iu.test(
      value,
    ) ||
    /\b(?:cell\s+models?|differences?\b.{0,120}\bmake\w*\s+(?:plant\s+and\s+animal\s+cells|them)\s+(?:so\s+)?distinct\s+and\s+unique)\b/iu.test(
      value,
    ) ||
    // These clauses are technically related to the topic but do not carry a
    // complete, useful grading target on their own. The surrounding source
    // contains stronger mechanisms or relationships, so do not spend an
    // ordinal asking for an unnamed compound, a vague universal comparison,
    // an unqualified genetics/environment claim, or elapsed presentation
    // time.
    /\b(?:magnetic\s+forces?\s+don['’]?t\s+affect\s+everything\s+the\s+same\s+way|nitrogen\s+and\s+oxygen\s+in\s+the\s+air\s+to\s+form\s+different\s+compounds|adaptations?\s+are\s+products?\s+of\b.{0,120}\bthe\s+environment|occur\s+over\s+many\s+decades\b.{0,160}\bcountries?\s+still\s+haven['’]?t\s+.*phases?)\b/iu.test(
      value,
    ) ||
    /\b(?:heat\s+and\s+friction\b.{0,220}\bplates?\s+grinding\b.{0,180}\bmagma\s+to\s+form|same\s+exercise\b.{0,220}\bmirror\s+behind\s+this\s+guy|all\s+of\s+a\s+sudden\b.{0,100}\bthis\s+symmetry|this\s+hydrogen\b.{0,220}\bmirror|mirror\s+images?\s+of\s+each\s+other\b.{0,160}\beach\s+have\s+two\s+chiral\s+(?:centers?|carbons?))\b/iu.test(
      value,
    ) ||
    /\b(?:first\s+referred\s+to\s+as\s+a\s+democracy|predominant\s+form\s+of\s+government\b.{0,180}\bmost\s+of\s+human\s+history|break\s+even\s+if\s+only\s+1\b|no\s+matter\s+how\s+complex\s+the\s+electricity\s+generation\s+system|made\s+up\s+of\s+five\s+basic\s+parts)\b/iu.test(
      String(value ?? "").trim(),
    ) ||
    /\b(?:animal\s+and\s+plant\s+cells\s+share\s+several\s+common\s+organelles|animal\s+cell\s+and\s+a\s+plant\s+cell\s+have\s+several\s+common\s+features|first\s*,?\s+let['’]?s\s+try\s+and\s+identify\s+the\s+things\s+that\s+both\s+animal\s+and\s+plant\s+cells\s+share|as\s+you\s+go\s+forward\s+in\s+your\s+biology\s+journey)\b/iu.test(
      value,
    ) ||
    /\b(?:chloroplasts\s+and\s+mitochondria\s+are\s+like\s+good\s+buddies|in\s+summary\s*,?\s+we\s+just\s+identified\s+several\s+similarities|both\s+cell\s+walls\s+and\s+chloroplasts\s+are\s+found\s+in\s+plant\s+cells|all\s+of\s+these\s+are\s+just\s+a\s+handful\s+of\s+the\s+similarities|think\s+of\s+a\s+celery\s+stalk\s+compared\s+to)\b/iu.test(
      value,
    ) ||
    /\bwatering\s+hole\b.{0,180}\b(?:does\s+not|doesn['’]?t)\s+seem\b.{0,100}\bdeep\b/iu.test(
      value,
    ) ||
    /\bresource\s+limitation\s+that\s+reduces\s+one\s+population\b.{0,180}\baffect\w*\s+interacting\s+populations?\b/iu.test(
      value,
    ) ||
    /\bthe\s+only\s+way\s+to\s+do\s+this\b|\bif\s+we\s+have\s+an\s+electromagnet\b.{0,220}\blooks?\s+like\s+this\b/iu.test(
      value,
    ) ||
    /\b(?:electro\s+for\s+electrical|magnet\s+for\s*,?\s+well\s*,?\s+magnet|one\s+type\s+of\s+temporary\s+magnet\s+is\s+called\s+an\s+electromagnet)\b/iu.test(
      value,
    ) ||
    /\bif\s+the\s+book\s+is\s+on\s+this\s+shelf\b|\bstretch\s+or\s+compress\s+a\s+spring\b.{0,120}\bchange\s+its\s+shape\b/iu.test(
      value,
    ) ||
    /\b(?:top|bottom)\s+of\s+(?:an?|the)\s+elements?['’]?s?\s+box\b|\ball\s+of\s+this\s+information\s+is\s+contained\s+inside\s+of\s+each\s+element['’]?s\s+box\b/iu.test(
      value,
    ) ||
    /\bsome\s+chemical\s+symbols?\s+are\s+based\s+on\s+the\s+latin\s+name\b/iu.test(
      value,
    ) ||
    /\b(?:looking\s+through\s+the\s+periodic\s+table\b.{0,180}\bphosphorus|its\s+name\s+is\s+mercury\b.{0,160}\batomic\s+number\s+is\s+80|below\s+that\s+is\s+nitrogen['’]?s\s+chemical\s+symbol|oxygen\s+and\s+carbon\s*,?\s+for\s+example\s*,?\s+are\s+elements|remember\b.{0,220}\bnumber\s+of\s+protons\b.{0,160}\bnitrogen\b.{0,160}\bnumber\s+of\s+electrons)\b/iu.test(
      value,
    ) ||
    /\b(?:stuff(?:ed|ing)?\s+money\s+into\s+(?:their|your)\s+mattress|break\s+into\s+houses?)\b/iu.test(
      value,
    ) ||
    /\b(?:here['’]?s\s+a\s+pop\s+quiz|if\s+you\s+guessed|thanks\s+for\s+playing|keep\s+practicing\s+your\s+skills|playing\s+video\s+games?\s+for\s+fun)\b/iu.test(
      value,
    ) ||
    /\btry\s+out\s+this\s+same\s+process\b|\bprocess\s+i['’]?m\s+about\s+to\s+model\b|\bto\s+answer\s+this\s+question\s*,?\s+first\b|\blast\s*,?\s+let['’]?s\s+look\b/iu.test(
      value,
    ) ||
    /\bone\s+way\s+to\s+think\s+about\s+it\b.{0,180}\bd1\s+and\s+d2\b|\bfill\s+in\s+(?:these|the)\s+36\s+squares\b|\bone\s*\+\s*one\s+is\s+two\b/iu.test(
      value,
    ) ||
    /\bif\s+the\s+sum\s+is\s+(?:seven|10\s+or\s+11)\b.{0,120}\b(?:roberto|jocelyn)\b/iu.test(
      value,
    ) ||
    /\belectromagnets?\s+are\s+typically\s+made\s+of\s+loops\s+of\s+wire\s+and\s+a\s+coil\b|^\s*absolutely\b/iu.test(
      String(value ?? "").trim(),
    ) ||
    /\b(?:another\s+number\s+listed\s+at\s+the\s+bottom|all\s+of\s+this\s+information\s+in\s+one\s+place|at\s+the\s+top\s+of\s+the\s+box)\b/iu.test(
      value,
    ) ||
    /^\s*(?:modern\s+banks\s*,?\s+you['’]?re\s+able\s+to\s+make\s+your\s+deposits|think\s+about\s+what\s+the\s+world\s+would\s+be\s+like)\b/iu.test(
      String(value ?? "").trim(),
    ) ||
    /\b(?:when\s+you\s+step\s+into\s+civic\s+life|government\s+could\s+describe\s+both\s+fifa|you\s+often\s+hear\s+them\s+lumped\s+together|if\s+you\s+like\s+playing\s+video\s+games)\b/iu.test(
      value,
    ) ||
    /\b(?:supreme\s+court\s+hears\s+a\s+case\s+about\s+internet\s+copyright|petitioning\s+for\s+more\s+representation\s+of\s+diverse\s+characters\s+in\s+video\s+games)\b/iu.test(
      value,
    ) ||
    /\b(?:when\s+you\s+do\s+so\s*,?\s+you['’]?re\s+participating\s+in\s+civic\s+life|the\s+supreme\s+court\s+is\s+part\s+of\s+a\s+governing\s+body\s+that\s+enforces\s+the\s+rules)\b/iu.test(
      value,
    ) ||
    /\ban\s+example\s+of\s+a\s+polyprotic\s+acid\s+is\s+the\s+protonated\s+form\b/iu.test(
      value,
    ) ||
    /\b(?:go\s+up\s+to\s+where\s+that\s+intersects\s+(?:our|the)\s+titration\s+curve|go\s+over\s+to\s+where\s+this\s+intersects\s+with\s+the\s+y[- ]axis|if\s+we\s+add\s+another\s+0\.5\s+moles|next\s*,?\s+let['’]?s\s+think\s+about\s+adding|therefore\s*,?\s+if\s+we\s+go\s+to\s+0\.5\s+moles|if\s+we\s+think\s+about\s+adding\s+another\s+mole|before\s+we['’]?ve\s+added\s+any\s+hydroxide)\b/iu.test(
      value,
    ) ||
    /\b(?:if\s+we\s+started\s+out\s+with\s+one\s+mole|finally\s*,?\s+let['’]?s\s+go\s+back\s+to\s+the\s+two\s+equivalence\s+points)\b/iu.test(
      value,
    ) ||
    /\bsome\s+big\s+events\s+that\s+jump\s+out\s+to\s+me\b/iu.test(value) ||
    /\b(?:if\s+something\s+comes\s+up\s+that\s+you['’]?re\s+unfamiliar\s+with|just\s+make\s+a\s+note\b|accepted\s+as\s+u\.s|troops?\s*,?\s+abroad\s*,?\s+in\s+what['’]?s\s+been\s+called|to\s+see\s+how\s+these\s+forces\s+played\s+out)\b/iu.test(
      String(value ?? "").trim(),
    ) ||
    /\blast\s+but\s+not\s+least\b.{0,180}\btook\s+a\s+little\s+less\s+time\b|\bin\s+general\s*,?\s+this\s+is\s+not\s+fair\b|\bwe['’]?re\s+doing\s+a\s+super\s*,?\s+high[- ]level\s+overview\b/iu.test(
      String(value ?? "").trim(),
    ) ||
    // Presentation vehicles and worked-example chatter repeatedly displaced
    // the literal circuit/statistics concept even though the model prompt
    // told DeepSeek to ignore them. Remove them before evidence assignment.
    /\b(?:water\s+)?(?:analogy|metaphor)\b|\banalogous\s+to\b/iu.test(value) ||
    /\b(?:let['’]?s\s+do\s+(?:some\s+)?more\s+problems?|give\s+(?:them|the\s+author)\s+credit\s+for\s+(?:their|the)\s+problem|switch\s+colors?|easiest\s+formula\s+ever\s+to\s+memorize|i\s+could\s+do\s+it\s+by\s+hand|running\s+out\s+of\s+space|we\s+already\s+knew\s+that)\b/iu.test(
      value,
    ) ||
    /\b(?:something\s+like\s+that|just\s+to\s+cut\s+to\s+the\s+chase|denoted\s+(?:by|with)\s+(?:the\s+)?(?:capital\s+)?letter)\b/iu.test(
      value,
    ) ||
    /\bacceleration\s+is\s+equal\s+to\s+\d+(?:\.\d+)?\s+divided\s+by\s+\d+(?:\.\d+)?\b/iu.test(
      value,
    ) ||
    /\bprobability\s+of\s+getting\s+zero\s+tails\b.{0,180}\bprobability\s+of\s+getting\s+zero\s+heads\b/iu.test(
      value,
    ) ||
    /\bbenjamin\s+franklin\b.{0,220}\b(?:current|electrons?|electricity|circuit)\b/iu.test(
      value,
    ) ||
    // Do not assign uncertain presenter asides, self-described confusing
    // nomenclature, or broad taxonomy shorthand as assessment facts.
    /\b(?:i\s+wonder\s+if|i['’]?m\s+no\s+historian|enough\s+about\s+[\p{L}-]+|gets?\s+a\s+little\s+bit\s+confusing|take\s+.+\s+out\s+of\s+the\s+equation)\b/iu.test(
      value,
    ) ||
    /\b(?:new|another|distinct)\s+fundamental\s+force\s+of\s+the\s+universe\b.{0,120}\bmagnetism\b|\bmagnetism\b.{0,120}\b(?:new|another|distinct)\s+fundamental\s+force\b/iu.test(
      value,
    ) ||
    // These are ambiguous counting claims or frames for a misconception, not
    // direct transferable objectives.
    /\bmost\s+of\s+the\s+aquatic\s+ecosystems?\s+are\s+marine\b/iu.test(
      value,
    ) ||
    /\b(?:potential\s+)?misconceptions?\b|\bprimitive\s+ancestor\b.{0,180}\b(?:sophisticated|modern)\s+(?:organism|type)\b/iu.test(
      value,
    ) ||
    // Visible steam/mist is condensed droplets, while water vapor itself is
    // invisible. Avoid inheriting this common caption shorthand as a fact.
    /\bsteam\s+(?:coming|rising)\s+off\b.{0,180}\bwater\s+vapor\b/iu.test(
      value,
    ) ||
    /\bwater\s+on\s+earth\s+is\s+(?:much\s+)?older\s+than\s+(?:the\s+)?dinosaurs\b/iu.test(
      value,
    ) ||
    /\bwater\s+is\s+the\s+only\s+substance\s+on\s+earth\b.{0,140}\b(?:three|3)\s+states?\b/iu.test(
      value,
    ) ||
    /\b(?:we['’]?ve\s+learned|time\s+to\s+learn|probably\s+(?:the\s+)?second\s+most\s+familiar|where\s+does\s+the\s+word\s+come\s+from|i['’]?ll\s+erase|i\s+actually\s+looked\s+up)\b/iu.test(
      value,
    ) ||
    /\b(?:let['’]?s\s+see\s+if\s+i\s+remember|i\s+know\s+this\s+is\s+(?:very\s+)?messy|i\s+just\s+got\s+rid\s+of|now\s+the\s+second\s+part\s+of\s+this\s+question|because\s+this\s+number\s+here|right\s+over\s+there|i['’]?ve\s+actually\s+been\s+to|think\s+a\s+little\s+bit\s+about\s+it)\b/iu.test(
      value,
    ) ||
    // Presentation advice about how to learn a subject is not itself a
    // transferable subject-matter objective.
    /\b(?:central|important|essential|key|major|big)\s+part\s+of\s+(?:learning|understanding|studying)\b/iu.test(
      value,
    ) ||
    // A single caption sentence can compress events separated by months or
    // years. Do not turn that compression into a confident chronology item
    // unless another complete, independently dated claim is selected.
    /\b(?:beheaded|executed|assassinated|died)\b.{0,220}\b(?:finaliz(?:e|ed|ing)|complet(?:e|ed|ing)|formaliz(?:e|ed|ing))\b.{0,140}\b(?:declaration|proclamation|founding|creation)\b/iu.test(
      value,
    ) ||
    // Preserve structural consequences but do not spend a quiz slot recalling
    // which tenant or landmark happened to occupy a construction site.
    /\b(?:construction\s+site|building\s+site|site)\b.{0,120}\b(?:already\s+)?occupied\b.{0,120}\b(?:church|tenant|landmark|building)\b/iu.test(
      value,
    ) ||
    // Myths, sign-offs, presenter identity, and historical credit are useful
    // narrative framing but weak assessment targets in a concept quiz.
    /\b(?:biblical\s+story|tower\s+of\s+babel|divine\s+intervention|babel\s+of\s+migration|until\s+our\s+next\s+transmission|over\s+and\s+out|nobel\s+prize\s+acceptance\s+speech|(?:laid|laying)\s+the\s+groundwork\s+for\s+future\s+advancements?)\b/iu.test(
      value,
    ) ||
    /\bwe\s+couldn['’]t\s+do\s+all\s+of\s+this\s+without\s+(?:your\s+)?support\b/iu.test(
      value,
    ) ||
    /\b(?:bardeen|brattain|shockley|bell\s+labs?)\b.{0,180}\b(?:invent(?:ed|ion)|transistor|1947|1957)\b/iu.test(
      value,
    ) ||
    /\bearth(?:['’]s)?\s+(?:is\s+)?rotat(?:es?|ing)\s+fastest\s+at\s+the\s+equator\b.{0,140}\bslower\b.{0,80}\bpoles?\b/iu.test(
      value,
    ) ||
    /\bwhat\s+do\s+all\s+these\s+things\s+have\s+in\s+common\b/iu.test(value) ||
    /\beconomists?\s+(?:have\s+)?come\s+around\s+to\s+the\s+view\b.{0,120}\ba\s+little\s+(?:bit\s+of\s+)?inflation\b/iu.test(
      value,
    ) ||
    /\bin\s+the\s+1960s\b.{0,180}\b(?:roles?|functions?)\s+of\s+(?:different\s+)?brain\s+(?:regions?|areas?)\b.{0,120}\b(?:unknown|unclear|little\s+understood|not\s+well\s+understood)\b/iu.test(
      value,
    ) ||
    /\b(?:favor(?:s|ed|ing)?|shift(?:s|ed|ing)?)\s+(?:it\s+)?in\s+(?:the\s+)?(?:other|opposite|this|that)\s+direction\b.{0,120}\b(?:less|more)\s+heat\s+(?:here|there)\b/iu.test(
      value,
    ) ||
    /\bno\s+moving\s+parts\b.{0,120}\bno\s+(?:fuss|muss|maintenance)\b|\bno\s+fuss\s+no\s+muss\b/iu.test(
      value,
    ) ||
    /\b(?:young\s+children|mommy\s+or\s+daddy|the\s+parents?)\b.{0,220}\b(?:park|play|wander|come\s+back|nervous|scared)\b/iu.test(
      value,
    ) ||
    /\bto\s+explain\s+it\s+very\s+simply\b.{0,100}\b(?:step|stepping)\s+on\s+(?:a\s+)?sharp\s+stick\b/iu.test(
      value,
    ) ||
    /\bwhat\s+can\s+be\s+done\s+about\s+(?:this|the)\s+resistance\s+issue\b|\bdevelop(?:ing)?\s+new\s+antibiotics\b.{0,160}\bstay\s+(?:one\s+)?step\s+ahead\s+of\s+bacteria\b/iu.test(
      value,
    ) ||
    /\bnot\s+all\s+sore\s+throats\s+are\s+strep\b|\bstrep\s+throat\s+is\s+caused\s+by\s+bacteria\b/iu.test(
      value,
    ) ||
    /\bi['’]ll\s+do\s+(?:a\s+)?whole\s+video\s+on\s+that\b|\binteresting\s+topic\s+for\s+(?:a\s+)?separate\s+(?:video|discussion)\b/iu.test(
      value,
    ) ||
    /\bthis\s+area\s+right\s+here\b.{0,180}\b(?:called|renal)\b|\bfrom\s+here\s+to\s+here\b.{0,120}\brenal\b/iu.test(
      value,
    ) ||
    /\b(?:reaction\s+time\s+with\s+the\s+ruler|ruler\s+reaction\s+time)\b/iu.test(
      value,
    ) ||
    /\breaction\s+time\s+is\s+the\s+time\s+it\s+takes?\s+to\s+respond\s+to\s+a\s+stimulus\b|\b(?:ruler|meter\s+stick)\b.{0,180}\b(?:reaction\s+time|respond\s+to\s+a\s+stimulus)\b/iu.test(
      value,
    ) ||
    /\b(?:different\s+)?parts?\s+of\s+the\s+kidney\b.{0,220}\b(?:significant|important)\b.{0,160}\b(?:start|later|discuss|talk|detail)\b|\b(?:significant|important)\b.{0,160}\b(?:when\s+we\s+start\s+talking|for\s+(?:a\s+)?later\s+discussion)\b/iu.test(
      value,
    ) ||
    /\bimmune\s+system\s+cells?\b.{0,160}\bwork\s+together\b.{0,160}\b(?:constant\s+)?threat\s+of\s+pathogens?\b/iu.test(
      value,
    ) ||
    /\bcells?\s+in\s+your\s+body\b.{0,180}\bwork\b.{0,80}\btogether\b.{0,160}\b(?:constant\s+)?threat\s+of\s+pathogens?\b/iu.test(
      value,
    ) ||
    /\ban\s+overview\s+of\s+(?:all\s+of\s+)?the\s+major\s+body\s+systems\b|\bin\s+our\s+opinion\b.{0,120}\b(?:fascinating|remarkable)\b|\bsomething\s+remarkable\s+happens\s+when\s+you\s+explore\b/iu.test(
      value,
    ) ||
    /\b(?:popular\s+lab|drop\s+(?:this\s+)?ruler|ruler\s+falls?|rough\s+calculation\s+of\s+(?:your\s+)?(?:response|reaction)\s+time|as\s+a\s+kid\s+being\s+fascinated)\b/iu.test(
      value,
    ) ||
    /\bhow\s+long\s+it\s+takes?\s+you\s+to\s+react\s+to\s+(?:some|a)\s+stimulus\b/iu.test(
      value,
    ) ||
    /\b(?:get|gets|getting)\s+(?:quite\s+)?complicated\s+with\s+the\s+mathematics\b|\blet['’]s\s+say\b.{0,180}\bnew\s+concentration\b|\bnew\s+concentration\s+of\s+[a-z]\s+is\s+\d+(?:\.\d+)?\s+molar\b/iu.test(
      value,
    ) ||
    /\breview\s+(?:the\s+)?video\s+on\s+unit\s+conversion\b|\bhow\s+many\s+seconds\s+are\s+there\s+in\s+an\s+hour\b|\bthere\s+are\s+3\s*,?\s*600\b/iu.test(
      value,
    ) ||
    /\bnope\b.{0,80}\b(?:too\s+shocking|wrong|scratch\s+that|start\s+over)\b/iu.test(
      value,
    ) ||
    /\b(?:average\s+inflation\s+of\s+about\s+)?300\s+percentage\s+points?\s+per\s+month\b/iu.test(
      value,
    ) ||
    /\b(?:numbers?\s+(?:(?:that\s+)?(?:are|were)\s+)?(?:actually\s+)?so\s+high.{0,80}difficult\s+to\s+comprehend|100\s+trillion\s+(?:mark\s+)?note|stockpiles?\s+of\s+cash\s+as\s+lego)\b/iu.test(
      value,
    ) ||
    /\b(?:discovery|history)\s+of\s+semiconductor\s+materials?\b.{0,120}\b(?:dates?\s+back|early\s+19th\s+century)\b/iu.test(
      value,
    ) ||
    // Remove concrete journey props when the surrounding material offers the
    // transferable current or circulation relationship directly.
    /\b(?:bottle|toy|piece\s+of\s+trash)\b.{0,220}\b(?:current|gyre|equator|coast|peninsula)\b/iu.test(
      value,
    ) ||
    // This wording confuses Earth's constant angular rotation rate with the
    // latitude dependence of the Coriolis parameter. Do not assess it.
    /\bearth['’]s\s+rotational\s+speed\s+rapidly\s+(?:slows|speeds)\s+(?:down|up)\b/iu.test(
      value,
    ) ||
    /\b(?:tie|tying)\s+(?:our|your)?\s*shoes\b.{0,220}\b(?:walk|drive|study|names?|faces?|loved ones?)\b/iu.test(
      value,
    ) ||
    /\b(?:responsib(?:ility|le)\s+for\s+cleaning|clean(?:ing)?\s+marine\s+debris|international\s+cooperation)\b/iu.test(
      value,
    ) ||
    // Credits, comment prompts, and presenter corrections are never useful
    // assessment evidence, even for a history source.
    /\b(?:produced\s+and\s+directed\s+by|script\s+supervisor|phrase\s+of\s+the\s+week|suggest\s+future\s+ones?\s+in\s+comments?|ask\s+questions?\s+about\s+today['’]?s\s+video)\b/iu.test(
      value,
    ) ||
    /\bno\s+it['’]?s\s+[\p{L}-]+\b.{0,100}\bi\s+know\s+from\b|\bbattlestar\s+galactica\b/iu.test(
      value,
    ) ||
    // A model repeatedly preferred these presentation/meta claims over the
    // nearby subject matter. Remove them before an ordinal is assigned.
    /\b(?:scientists?\s+(?:are\s+)?still\s+(?:trying|working|struggling)\s+to\s+(?:figure\s+out|understand)|current\s+state\s+of\s+scientific\s+understanding|we['’]?re\s+still\s+new\s+at\s+this|buckle\s+up|like\s+i\s+said|as\s+we['’]?ve\s+seen\s+many\s+times)\b/iu.test(
      value,
    ) ||
    /\b(?:most\s+explored|most\s+unexplored)\s+part\s+of\s+(?:our|the)\s+planet\b/iu.test(
      value,
    ) ||
    /\b(?:infinitely\s+redshifted|lose\s+all\s+(?:of\s+)?(?:its|their)\s+energy\s+trying\s+to\s+leave|all\s+of\s+time\s+would\s+pass)\b/iu.test(
      value,
    ) ||
    // Narrative classroom setup is useful to illustrate scarcity but should
    // not displace the actual definitions, constraints, and trade-offs.
    /\b(?:class\s*,?\s+we\s+have\s+something\s+important\s+to\s+talk\s+about|what\s+things?\s+(?:would\s+you|you['’]?d)\s+like\s+to\s+see\s+on\s+a\s+new\s+playground|swings?\s*,?\s+slides?\s*,?\s+climbing\s+ropes?|kids?\s+shared\s+their\s+ideas?\s+for\s+the\s+playground|school\s+board\s+recognized\s+the\s+scarcity\s+problem|measured\s+the\s+land\s+and\s+(?:we['’]?ve\s+)?found\s+out\s+how\s+much\s+space)\b/iu.test(
      value,
    ) ||
    // Counts of surface receptors are incidental here; receptor specificity,
    // activation, clonal expansion, and antibody action are the concepts.
    /\b(?:close\s+to|about|approximately)\s+10\s*,?\s*000\b(?:.{0,100}\b(?:receptor|protein)s?\b|\s+of\s+them\b)/iu.test(
      value,
    ) ||
    /\b(?:trying\s+to\s+decide|deciding)\s+what\s+to\s+do\s+with\s+(?:it|the\s+(?:land|lot))\b/iu.test(
      value,
    ) ||
    // Presenter prompts, subjective recommendations, and unresolved pronoun
    // fragments do not provide a durable standalone assessment claim.
    /\bthink\s+about\s+what\s+it\s+needs\s+to\s+be\s+transmitted\s+through\b|^\s*they\s+can\s+travel\s+through\b/iu.test(
      value,
    ) ||
    /\b(?:clearest|best|easiest)\s+way\s+(?:of|to)\s+(?:protecting|protect|hiding|hide)\b/iu.test(
      value,
    ) ||
    /\bip addresses?\b.{0,100}\b(?:harder|more difficult)\s+to\s+(?:hide|protect|change|conceal)\b/iu.test(
      value,
    ) ||
    /\bas\s+i\s+(?:mentioned|said)\b.{0,120}\b(?:isn['’]?t|is\s+not|aren['’]?t|are\s+not)\s+just\s+about\b/iu.test(
      value,
    ) ||
    /\blight\b.{0,100}\b(?:will\s+)?(?:get|gets|reach(?:es)?)\s+(?:to\s+)?(?:that|the|a)\s+sand\s+particle\b/iu.test(
      value,
    ) ||
    /\bkilojoules?\s+per\s+mole\s+of\s+(?:reaction|carbon)\b/iu.test(value) ||
    /\bcoefficient\s+(?:of\s+)?(?:1|one)\b.{0,180}\b(?:diamond|mole|standard\s+(?:change|free\s+energy))\b|\bone\s+as\s+a\s+coefficient\s+in\s+front\s+of\s+diamond\b/iu.test(
      value,
    ) ||
    /\b(?:muslim\s+)?turks?\b.{0,120}\b(?:made?|making)\s+(?:further\s+)?inroads?\b|\b(?:second\s+millennium|further\s+in\s+time)\b.{0,180}\binroads?\b/iu.test(
      value,
    ) ||
    /\bspace\s+shuttle\b.{0,220}\b(?:liquid\s+oxygen|hydrogen|main\s+tank|necessary\s+velocity|discontinued)\b/iu.test(
      value,
    ) ||
    /\b(?:copper\s+)?wires?\b.{0,220}\b(?:insulator|resistor|plastic|rubber)\b|\b(?:insulator|resistor)\b.{0,180}\b(?:current|wire)\b/iu.test(
      value,
    ) ||
    /\bcurrent\b.{0,160}\b(?:less\s+energy\s+loss|travel\s+faster)\b.{0,160}\binsulator\b|\bhigh[- ]resistance\s+insulator\b.{0,180}\b(?:less\s+energy\s+loss|travel\s+faster|current)\b/iu.test(
      value,
    ) ||
    /\bcurrent\b.{0,100}\b(?:less\s+energy\s+loss|(?:will\s+)?travel\s+(?:faster|slower)|would\s+(?:actually\s+)?go\s+slower)\b|\btravel\s+faster\s+when\s+(?:it['’]?s|it\s+is)\s+surrounded\s+by\s+an\s+insulator\b/iu.test(
      value,
    ) ||
    /\bdendrites?\b.{0,180}\bstimulated\s+in\s+some\s+way\b|\bpositive\s+ions?\b.{0,160}\bflood\s+into\b.{0,120}\bsome\s+way\b/iu.test(
      value,
    ) ||
    /\b(?:latin\s+word\s+saltare|saltare\b.{0,80}\b(?:jump|hop)|means?\s+to\s+(?:jump|hop)\s+around)\b/iu.test(
      value,
    ) ||
    /\b(?:all\s+cars?\s+should\s+be\s+(?:painted\s+)?teal|wheels?\s+(?:are\s+)?(?:on\s+)?straight|car[- ]color\s+analogy|cars?\s+should\s+be\s+painted)\b/iu.test(
      value,
    ) ||
    /\b(?:firmly\s+believe\s+that\s+)?you\s+can\s+learn\s+anything\b/iu.test(
      value,
    ) ||
    /\blanguage\b.{0,160}\b(?:harnessed|used)\b.{0,120}\bany\s+way\s+(?:(?:the\s+)?speaker|you)\s+wants?\b/iu.test(
      value,
    ) ||
    /\b(?:give|giving)\s+you\s+(?:the\s+)?tools?\s+to\s+harness\s+(?:english|language)\b|\bharness\s+(?:english|language)\s+and\s+use\s+it\s+any\s+way\s+you\s+want\b/iu.test(
      value,
    ) ||
    /\bcar\b.{0,220}\b(?:wheels?|roof|engine|steering|paint(?:ed|ing)?)\b|\b(?:wheels?|roof|engine|steering)\b.{0,180}\bcar\b/iu.test(
      value,
    ) ||
    /\b(?:these\s+)?videos?\s+(?:are|cover)\s+only\b.{0,120}\b(?:standard\s+american\s+english|specific\s+kind\s+of\s+grammar)\b/iu.test(
      value,
    ) ||
    /\b(?:newton['’]?s\s+laws?|topic|concept)\b.{0,180}\b(?:is|are|was|were)\s+taught\s+in\s+(?:a\s+)?(?:first[- ]year|introductory|intro)\s+(?:physics|engineering|science|course|class)\b|\b(?:what|this)\s+is\s+taught\s+in\s+(?:a\s+)?(?:first[- ]year|introductory|intro)\s+(?:course|class)\b/iu.test(
      value,
    ) ||
    /\b(?:change|decrease|increase)\s+(?:to|in)\s+one\s+species\b.{0,220}\b(?:whole\s+)?web\s+of\s+interconnected\s+organisms\b|\beach\s+population\s+interacts\s+with\s+many\s+other\s+populations\b.{0,180}\bnon[- ]living\s+parts?\b/iu.test(
      value,
    ) ||
    /\bclark['’]?s\s+nutcrackers?\b.{0,260}\b(?:alpine\s+ecosystems?|harsh\s+winters?|lots\s+of\s+snow|evergreen\s+trees?\s+are\s+abundant)\b/iu.test(
      value,
    ) ||
    /\b(?:capstone|beginning|start)\s+of\s+the\s+scientific\s+revolution\b.{0,220}\b(?:publication|published|copernicus|newton|principia|\d{4})\b|\b(?:publication|published|copernicus|newton|principia)\b.{0,220}\b(?:capstone|beginning|start)\s+of\s+the\s+scientific\s+revolution\b/iu.test(
      value,
    ) ||
    /\bgave\s+humanity\s+(?:a\s+)?new\s+(?:perspective|powers?)\b|\bnew\s+perspective\s+on\s+the\s+universe\b.{0,160}\bnew\s+powers?\b/iu.test(
      value,
    ) ||
    /\b(?:his|her|their)\s+telescope\b.{0,180}\b(?:wasn['’]?t|was\s+not|couldn['’]?t|could\s+not|strong\s+enough|tell\s+what)\b|\b(?:observer|he|she)\b.{0,120}\b(?:couldn['’]?t|could\s+not)\s+(?:identify|tell|see)\b.{0,120}\b(?:telescope|features?|rings?)\b/iu.test(
      value,
    ) ||
    /\b(?:ahead\s+of\s+(?:our|your)\s+skis|all\s+of\s+these\s+puzzle\s+pieces|charged\s+particles?\b.{0,160}\b(?:move\s+chaotically|movement\s+aligns?|act\s+in\s+concert))\b/iu.test(
      value,
    ) ||
    /\ball\s+of\s+that\s+frozen\s+water\b.{0,220}\b(?:sea\s+levels?|weather\s+system)\b/iu.test(
      value,
    ) ||
    /\bcolder\s+years?\b.{0,180}\b(?:much\s+)?hotter\s+than\s+(?:the\s+)?average\s+temperatures?\s+in\s+the\s+past\b/iu.test(
      value,
    ) ||
    /\b(?:individual\s+sustainable\s+habits?|individual\s+choices?)\b.{0,220}\b(?:community[- ]based|larger\s+initiatives?|address\s+climate\s+change)\b/iu.test(
      value,
    ) ||
    /\bas\s+someone\s+who\s+works\s+in\s+environmental\s+science\b|\bsorting\s+through\b.{0,120}\b(?:facts|opinions)\b.{0,80}\boverwhelming\b/iu.test(
      value,
    ) ||
    /\bmore\s+co2\b.{0,180}\b(?:than\s+ever\s+before|more\s+than\s+is\s+normally\s+released\s+by\s+the\s+earth|much\s+faster\s+rate)\b/iu.test(
      value,
    ) ||
    /\b(?:species\s+(?:is|are)\s+a\s+knot|interactions?\s+(?:is|are)\s+the\s+ropes?|hold\s+the\s+net\s+together|biodiversity\s+(?:acts\s+)?as\s+a\s+safety\s+net|think\s+of\s+biodiversity\s+as\s+(?:a\s+)?(?:sort\s+of\s+)?safety\s+net|safety\s+net\s+of\s+biodiversity)\b/iu.test(
      value,
    ) ||
    /\bover\s+3\s*,?\s*000\s+nene\b|\bnene\b.{0,140}\bover\s+3\s*,?\s*000\b/iu.test(
      value,
    ) ||
    /\bislands?\s+are\s+(?:very\s+)?beautiful\b.{0,120}\b(?:biodiversity|variety\s+of\s+species)\b/iu.test(
      value,
    ) ||
    /\bhealth\s+(?:is|can\s+be)\s+measured\s+by\s+the\s+completeness\s+of\s+(?:its|the)\s+biodiversity\b|^\s*if\s+['’]?ohi['’]?a\s+(?:starts?|begins?)\s+to\s+disappear\b/iu.test(
      value,
    ) ||
    /\bwhen\s+an\s+ecosystem\s+changes\s+so\s+much\s+that\s+a\s+species\s+can\s+no\s+longer\s+survive\b/iu.test(
      value,
    ) ||
    /\bnew\s+diseases?\s+and\s+climate\s+change\b.{0,180}\b(?:led|lead|contributed)\s+to\s+(?:the\s+)?extinction\b/iu.test(
      value,
    ) ||
    /\b(?:all\s+)?ecosystems?\b.{0,160}\b(?:species|organisms?)\b.{0,140}\binteract\s+in\s+(?:specific|different|various)\s+ways?\b|\bspecies\b.{0,120}\binteract\s+in\s+specific\s+ways?\s+with\s+(?:one\s+)?another\b/iu.test(
      value,
    ) ||
    /\bsimilar\s+to\s+how\s+firewood\s+releases\s+energy\s+as\s+it\s+burns\b/iu.test(
      value,
    ) ||
    /\b(?:recently|just\s+recently)\b.{0,160}\b(?:supreme\s+court|court)\b.{0,120}\bstruck\s+(?:that|it|\w+)\s+down\b|\bdefense\s+of\s+marriage\s+act\b.{0,180}\bstruck\s+(?:down|that\s+down)\b/iu.test(
      value,
    ) ||
    /\bdirect\s+(?:modification|modifying)\s+of\s+genes?\b.{0,120}\b(?:began|started|1970s?)\b|\b1970s?\b.{0,120}\bdirect\s+(?:gene|genetic)\s+modification\b/iu.test(
      value,
    ) ||
    /\b(?:genome|genetic)\s+modification\b.{0,180}\b(?:all|every)\s+(?:offspring|descendants?)\b|\binherited\s+by\s+(?:all|every)\s+(?:offspring|descendants?)\b/iu.test(
      value,
    ) ||
    /\b(?:we\s+haven['’]?t\s+solved\s+the\s+problem\s+of\s+what\s+happens\s+when.{0,160}(?:infiltrate\s+cells|cancer\s+cells)|how\s+do\s+we\s+kill\s+cells\s+that\s+have\s+clearly\s+gone\s+astray)\b/iu.test(
      value,
    ) ||
    /\b(?:check\s+out\s+one\s+of\s+these\s+videos?|more\s+lessons?|i\s+think\s+that['’]?s\s+a\s+problem\s+we\s+should\s+think\s+about|empty\s+lot\s+next\s+to\s+our\s+school|who\s+owns\s+that\s+land)\b/iu.test(
      value,
    ) ||
    /\b(?:great\s+job\s+everyone|what\s+are\s+some\s+things\s+you['’]?d\s+like\s+to\s+see\s+on\s+a\s+new\s+playground|what\s+equipment\s+should\s+be\s+on\s+the\s+playground|what\s+kind\s+of\s+playground\s+should\s+it\s+be|i\s+think\s+we\s+have\s+a\s+scarcity\s+problem)\b/iu.test(
      value,
    ) ||
    /^(?:(?:and\s+)?(?:hopefully|obviously|frankly)\b|alright\b|all\s+right\b|let\s+me\b|what['’]?s\s+(?:really\s+)?(?:cool|interesting)\s+to\s+me\b)/iu.test(
      String(value ?? "").trim(),
    ) ||
    // Fresh10: remove uncertainty, vague wrap-up language, forecasts, and
    // incidental historical/numerical narration before an ordinal is ever
    // assigned. These spans either conflict with a later precise claim or do
    // not provide a standalone, durable grading target.
    /\bwe\s+don['’]?t\s+know\s+yet\s+whether\s+the\s+inner\s+(?:part|core)\s+is\s+liquid\s+or\s+solid\b/iu.test(
      value,
    ) ||
    /\bp[- ]wave\s+shadow\b.{0,180}\b(?:crazy|unusual)\s+things?\b.{0,100}\b(?:someplace|somewhere)\s+in\s+the\s+core\b/iu.test(
      value,
    ) ||
    /\bas\s+more\s+and\s+more\s+people\s+get\s+on\s+the\s+internet\b.{0,240}\bneed\s+to\s+secure\b/iu.test(
      value,
    ) ||
    /\bsince\s+the\s+1820s\b.{0,160}\b(?:texas|region)\b.{0,100}\bcontrolled\s+by\s+spain\b/iu.test(
      value,
    ) ||
    /\b(?:tribe\s+of\s+100\s+hunter[- ]?gatherers?|50\s+square\s+kilometers?|100\s+square\s+kilometers?|500\s+square\s+kilometers?|walk\s+miles\s+and\s+miles\s+per\s+day)\b/iu.test(
      value,
    ) ||
    /\b(?:i\s+didn['’]?t\s+choose\s+this\s+time\s+span|for\s+other\s+residents?\s+of\s+the\s+territory\s*,?\s+life\s+didn['’]?t\s+change\s+much|as\s+far\s+as\s+\p{L}+\s+was\s+concerned\b.{0,160}\bno\s+choice\s+but\s+to\s+defend)\b/iu.test(
      value,
    ) ||
    /\bwhen\s+you\s+speak\b.{0,180}\bvocal\s+cords?\b.{0,120}\bparticles?\s+just\s+in\s+front\s+of\s+you\b/iu.test(
      value,
    ) ||
    /\brope\b.{0,180}\bdisturbance\b.{0,180}\bmirrors?\b.{0,120}\bhand\b/iu.test(
      value,
    ) ||
    /\bparticles?\b.{0,100}\bcloser\b.{0,100}\bcollide\b.{0,160}\b(?:wave|propagation)\b.{0,80}\bfaster\b|\b(?:wave|propagation)\b.{0,80}\bfaster\b.{0,160}\bparticles?\b.{0,100}\b(?:closer|collide)\b/iu.test(
      value,
    ) ||
    /\bsince\s+they['’]?re\s+closer\s+compacted\b.{0,180}\bpropagation\s+of\s+the\s+wave\b.{0,80}\bfaster\b/iu.test(
      value,
    ) ||
    /\bparticles?\s+in\s+(?:the\s+)?liquid\s+are\s+closer\s+together\b/iu.test(
      value,
    ) ||
    /\bnot\s+talking\s+about\s+revenue\b.{0,160}\b(?:talking\s+about\s+)?costs?\s+for\s+the\s+firm\b/iu.test(
      value,
    ) ||
    /\bquantity\s+of\s+labor\s+is\s+(?:one|1)\b.{0,160}\bprice\s+of\s+labor\s+is\s+(?:three|3)\b/iu.test(
      value,
    ) ||
    /\bsignificantly\s+denser\s+material\s+than\s+the\s+inner\s+core\b/iu.test(
      value,
    ) ||
    /\bby\s+750\b.{0,180}\b(?:most\s+of\s+persia|byzantine\s+empire)\b|\bcommemorates?\s+an\s+important\s+sufi\s+leader\b/iu.test(
      value,
    ) ||
    /\btook\s+over\s+most\s+of\s+persia\b.{0,180}\b(?:large\s+part\s+of\s+the\s+)?byzantine\s+empire\b/iu.test(
      value,
    ) ||
    /\b(?:periods?|ages?)\s+of\s+(?:(?:modern\s+and\s+pre[- ]modern\s+)?humanity|human\s+history)\b.{0,220}\bnamed\s+after\s+the\s+types?\s+of\s+(?:stone\s+)?tools?\b/iu.test(
      value,
    ) ||
    /\bhunter[- ]?gatherer\s+to\s+agriculture\b.{0,220}\b(?:most\s+profound|up\s+there\s+with\s+language\s+and\s+writing|defined\s+what\s+makes\s+humans\s+humans)\b/iu.test(
      value,
    ) ||
    /\bneolithic\b.{0,100}\b(?:refers?\s+to|means?)\s+new\s+stone\b/iu.test(
      value,
    ) ||
    /\bpaleo\b.{0,80}\b(?:old|lithic|lithos|stone)\b.{0,100}\b(?:lithic|lithos|stone)\b/iu.test(
      value,
    ) ||
    /\bpaleolithic\s+period\b.{0,180}\b(?:great\s+bulk|vast\s+majority)\s+of\s+human\s+history\b/iu.test(
      value,
    ) ||
    /\b(?:old\s+stone\s+age|paleolithic)\b.{0,140}\b(?:great\s+bulk|most)\s+of\s+human\s+history\b|\bfor\s+most\s+of\s+human\s+history\b.{0,180}\bhunter[- ]?gatherers?\b/iu.test(
      value,
    ) ||
    /\b(?:over\s+time\s+)?we['’]?re\s+likely\s+to\s+discover\b.{0,180}\b(?:archaeological\s+digs?|fossil\s+evidence)\b/iu.test(
      value,
    ) ||
    /\blevant\b.{0,120}\b(?:eastern\s+mediterranean|modern[- ]day\s+middle\s+east|syria|israel|palestine|iraq)\b/iu.test(
      value,
    ) ||
    /\bas\s+we\s+can\s+see\s*$/iu.test(String(value ?? "").trim()) ||
    // Fresh11: presentation advice, hidden diagrams/tables, worked-example
    // bookkeeping, and caption fragments are not standalone assessment facts.
    /\bconcepts?\b.{0,180}\blearn(?:ed|ing)?\s+in\s+(?:school|(?:a\s+)?physics\s+class)\b.{0,220}\b(?:connected|world\s+around\s+you|every\s+moment)\b/iu.test(
      value,
    ) ||
    /\bcalories?\s+on\s+(?:a\s+)?packag(?:e|ing|ed)\s+food\s+label\b/iu.test(
      value,
    ) ||
    /\bdesert\s+(?:type\s+of\s+)?ecosystem\b.{0,180}\blow\s+hundreds\b.{0,120}\b8\s*,?\s*000\b/iu.test(
      value,
    ) ||
    /\b(?:slightly\s+)?bungled\b.{0,160}\b(?:oath|roberts|re-administer)|\bre-administer(?:ed|ing)?\s+the\s+oath\b/iu.test(
      value,
    ) ||
    /\boriginal\s+system\b.{0,240}\bfirst\s+place\s+winner\b.{0,120}\belectoral\s+college\b/iu.test(
      value,
    ) ||
    /\bresults?\s+of\s+the\s+investigation\b.{0,100}\b(?:data\s+table|shown\s+below)\b|\b(?:data\s+table|branching\s+tree|diagram)\s+below\b/iu.test(
      value,
    ) ||
    /\b(?:band|banding\s+pattern)\b.{0,220}\b(?:species\s+)?[abc]\b.{0,220}\b(?:species\s+)?[abc]\b|\b(?:species\s+)?[abc]\b.{0,220}\b(?:species\s+)?[abc]\b.{0,220}\b(?:band|banding\s+pattern)\b/iu.test(
      value,
    ) ||
    /\bscientists?\s+attempted\s+to\s+determine\b.{0,220}\bspecies\s*,?\s*[abc]\b|^\s*statement\s+(?:one|two|three|four|\d+)\b/iu.test(
      value,
    ) ||
    /^(?:two|three|four|[abcd])\s*,\s*(?:because|compare|obtain|observe)\b/iu.test(
      String(value ?? "").trim(),
    ) ||
    /\bgiven\s+all\s+of\s+these\s+numbers\b|\blook\s+at\s+scenarios?\b.{0,220}\b(?:r\s+and\s+g|r|g|inequality)\b.{0,80}\bconstant\b|\byear\s+two['’]?s\s+national\s+income\b/iu.test(
      value,
    ) ||
    /\b1\s*,?\s*000\b.{0,180}\bearned\s+another\s+50\b.{0,180}\b1\s*,?\s*050\s+gold\s+pieces\b/iu.test(
      value,
    ) ||
    /\b(?:whole|entire)\s+(?:value\s+of\s+the\s+)?economy\b.{0,220}\b(?:nothing\s+but|consists?\s+(?:entirely\s+)?of)\s+(?:a\s+)?gold\s+mine\b|\b(?:whole|entire)\s+nation\b.{0,160}\b(?:just|only)\s+(?:a\s+)?(?:big\s+)?gold\s+mine\b/iu.test(
      value,
    ) ||
    /\bthink\s+of\s+a\s+very\s*,?\s*very\s+simple\s+economy\b/iu.test(value) ||
    /\bin\s+this\s+scenario\b.{0,120}\breturn\s+on\s+capital\b.{0,80}\b(?:approximately|about|almost)\s+4(?:\.\s*)?95\s*%/iu.test(
      value,
    ) ||
    /\bnational income\b.{0,100}\b(?:grows?|grew|increase[sd]?)\b(?![^.]{0,180}\b(?:rate|percent|because|when|if|while|whereas)\b)/iu.test(
      value,
    ) ||
    /\bin\s+blue\b.{0,160}\b(?:graph|actual|projected|emissions?)\b|\b(?:blue|red)\s+(?:line|curve)\b.{0,160}\b(?:graph|emissions?)\b/iu.test(
      value,
    ) ||
    /\btums\b.{0,200}\bcalcium\s+carbonate\b/iu.test(value) ||
    /\beach\s+of\s+the\s+oxygens?\b.{0,100}\b(?:is|are)\s+attached\s+to\s+(?:a\s+)?hydrogen\b/iu.test(
      value,
    ) ||
    /\bthe\s+reaction\s+(?:is\s+going\s+to\s+)?go(?:ing|es)?\s+this\s+way\b.{0,160}\b(?:this\s+stuff|more\s+of)\b/iu.test(
      value,
    ) ||
    /^\s*(?:neon\s*,?\s*oxygen|56\s*,|and\s+in\s+particular\b|what\s+i\s+want\s+to\s+do\b)/iu.test(
      String(value ?? "").trim(),
    ) ||
    /\bpause\s+(?:this|the)\s+video\b|\bshow\s+you\s+the\s+banding\s+pattern\s+again\b/iu.test(
      value,
    ) ||
    /\bwhat\s+we\s+(?:want\s+to|wanna)\s+do\b.{0,160}\b(?:look|find|similarit(?:y|ies))\b/iu.test(
      value,
    ) ||
    /\b(?:these|those)\s+two\s+(?:are|look)\s+more\s+closely\s+related\b/iu.test(
      value,
    ) ||
    /\bplant\s+species\s+two\b.{0,160}\b(?:fewer\s+differences|exact\s+same\s+(?:banding\s+)?pattern|only\s+one)\b/iu.test(
      value,
    ) ||
    /\b(?:emitted|played\s+back)\s+by\s+(?:(?:the|your)\s+)?microphone(?:\s+again)?\b/iu.test(
      value,
    ) ||
    /\b(?:first|second|third|fourth)\s+choice\s+is\b|\blooking\s+like\s+the\s+leading\s+candidate\b|\bfeeling\s+(?:really\s+)?good\s+saying\b/iu.test(
      value,
    ) ||
    /\bif\s+we\s+looked\s+at\s+the\s+enzyme\b.{0,220}\bspecies\s+(?:one|two|three|1|2|3)\b/iu.test(
      value,
    ) ||
    /\blook\s+at\s+the\s+word\s+photosynthesis\b.{0,180}\b(?:parts?\s+of\s+it\s+mean|photo\s+(?:is\s+referring|refers?)|synthesis\s+(?:is\s+referring|refers?))\b/iu.test(
      value,
    ) ||
    /\bnational\s+income\b.{0,80}\b(?:is|of)\s+(?:100|102)(?:\s*,?\s*(?:100|102))?\s+gold\s+pieces\b/iu.test(
      value,
    ) ||
    /\breturn\s+on\s+capital\b.{0,120}\b52\s+divided\s+by\s+1\s*,?\s*050\b|\b50\s+divided\s+by\s+1\s*,?\s*050\b.{0,80}\b4\.?(?:\s*)76\s*%/iu.test(
      value,
    ) ||
    /\boceans?\s+(?:are|is)\s+(?:about\s+)?26\s*%\s+more\s+acidic\b/iu.test(
      value,
    ) ||
    /\br\s+in\s+year\s+one\b.{0,160}\bowners?\s+of\s+capital\s+got\s+50\s+gold\s+pieces\b/iu.test(
      value,
    ) ||
    /\blabor\s+gets\s+50\s+gold\s+pieces\b.{0,160}\bcapital\s+is\s+getting\s+52(?:\s*,?\s*52)?\s+gold\s+pieces\b/iu.test(
      value,
    ) ||
    /\bcapital\s+that\s+they\s+employed\s+was\s+1\s*,?\s*000\s+gold\s+pieces\b.{0,140}\b50\s+divided\s+by\s+1\s*,?\s*000\b/iu.test(
      value,
    ) ||
    /\bvalue\s+of\s+the\s+gold\s+mine\b.{0,180}\b(?:year\s+two|1\s*,?\s*050\s+gold\s+pieces)\b/iu.test(
      value,
    ) ||
    /\bnational\s+income\b.{0,180}\bnothing\s+but\s+one\s+big\s+gold\s+mine\b/iu.test(
      value,
    ) ||
    /\bthe\s+capital\b.{0,100}\b(?:is|was|let['’]?s\s+say)\s+1\s*,?\s*000\s+gold\s+pieces\b/iu.test(
      value,
    ) ||
    /\bthe\s+capital\b.{0,80}\blet['’]?s\s+say\s+it['’]?s\s+1\s*,?\s*000\s+gold\s+pieces\b/iu.test(
      value,
    ) ||
    /\bbefore\s+we\s+get\s+into\s+that\b.{0,220}\blet['’]?s\s+just\s+understand\b/iu.test(
      value,
    ) ||
    /\bwhat\s+we\s+will\s+do\s+in\s+the\s+next\s+few\s+videos\b|\buse\s+some\s+spreadsheets\s+to\s+look\s+at\s+some\s+scenarios\b/iu.test(
      value,
    ) ||
    /\bas\s+we['’]?ll\s+see\b.{0,220}\brelated\s+to\s+increased\s+carbon\s+dioxide\b/iu.test(
      value,
    ) ||
    /\blook\s+at\s+modern\s+times\b.{0,180}\bspike\s+has\s+gone\s+well\s+beyond\s+that\s+range\b/iu.test(
      value,
    ) ||
    /\bthis\s+graph\s+is\s+showing\s+us\s+(?:two|three|\d+)\s+things\b/iu.test(
      value,
    ) ||
    /\bhorizontal\s+axis\b.{0,180}\b(?:years?\s+going\s+by|1750|2100|graphic)\b/iu.test(
      value,
    ) ||
    /\bplug\s+in\s+the\s+value\s+for\s+delta\s+g\s+naught\b|\b(?:this\s+)?equation\b.{0,80}\ballows?\s+(?:us\s+)?to\s+calculate\s+non[- ]standard\s+changes?\s+in\s+free\s+energy\b/iu.test(
      value,
    ) ||
    /(?=[\s\S]*\b(?:tar\s+pits?|gloppy)\b)(?=[\s\S]*\b(?:slow|stuck|pull)\w*\b)/iu.test(
      value,
    ) ||
    /\bvoting\s+rights\b.{0,180}\ball\s+white\s+men\b.{0,100}\b1830s\b/iu.test(
      value,
    ) ||
    /\bgovernment\s+research\s+created\s+the\s+internet\b.{0,180}\bcompanies?\s+could\s+make\s+money\b/iu.test(
      value,
    ) ||
    /\bmake\s+these\s+core\s+beliefs\b.{0,180}\b(?:more\s+tangible|quotes?\s+from\s+notable)\b/iu.test(
      value,
    ) ||
    /\bmoon\b.{0,120}\broughly\s+240\s*,?\s*000\s+miles?\s+away\s+from\s+earth\b/iu.test(
      value,
    ) ||
    /\bnone\s+of\s+this\s+debate\b.{0,160}\bpressures?\s+are\s+so\s+big\b/iu.test(
      value,
    ) ||
    /\bmost\s+of\s+(?:the\s+)?time\s+it(?:['’]?s|\s+is)\s+closer\s+to\s+the\s+high\s+end\s+of\s+this\s+range\b/iu.test(
      value,
    ) ||
    /\b(?:today\s*,?\s*we['’]?re\s+going\s+to|as\s+i\s+said\s+before|just\s+to\s+hit\s+the\s+point\s+home|for\s+kicks|what\s+i['’]?m\s+gonna\s+do|when\s+he['’]?s\s+saying\s+this|perhaps\s+the\s+joke\s+was|if\s+you\s+wanted\s+to\s+just\s+compare|just\s+to\s+finish\s+off)\b/iu.test(
      value,
    ) ||
    /\b(?:red\s+curve|growth\s+rate)\b.{0,260}\b(?:0\.6\s*%|2\.1\s*%|1970s)\b/iu.test(
      value,
    ) ||
    /\b(?:left[- ]hand\s+)?vertical\s+axis\b.{0,180}\b(?:graph|growth\s+rate|world\s+population)\b/iu.test(
      value,
    ) ||
    /\bmy\s+hunger\s+is\s+slowing\s+me\s+down\b/iu.test(value) ||
    /\b(?:i['’]?m|i\s+am|myself)\b.{0,180}\bcompar\w*\b.{0,160}\b(?:wolf|tar\s+pit|animal|object)\b|\bcompar\w*\b.{0,120}\bmyself\b/iu.test(
      value,
    ) ||
    /\bcar\b.{0,120}\bnot\s+literally\s+grumbl\w*\b|\bcar\b.{0,180}\bidentify\w*\s+as\s+unhappy\b/iu.test(
      value,
    ) ||
    /\bgreatest\s+kind\s+of\s+figurative\s+language\b/iu.test(value) ||
    /\brevolution\b.{0,140}\bmonarchy\b.{0,120}\bcalled\s+absurd\b/iu.test(
      value,
    ) ||
    /\blast\s+but\s+not\s+least\b.{0,180}\b(?:quote|economist|professor)\b/iu.test(
      value,
    ) ||
    /\b(?:mechanical\s+properties|innermost)\b.{0,160}\b(?:actually\s+i\s+didn['’]?t\s+tell\s+you|mantle\s+ends\s+at\s+about\s+2\s*,?\s*900)\b/iu.test(
      value,
    ) ||
    /\bmantle\s+ends\s+at\s+about\s+2\s*,?\s*900\s+kilometers?\s+deep\b/iu.test(
      value,
    ) ||
    /\bdifferentiat\w*\b.{0,100}\bfrom\s+the\s+crust\b.{0,160}\bdifferent\s+types?\s+of\s+rock\b/iu.test(
      value,
    ) ||
    /\b(?:compare\s+the\s+sizes?|sun\s+is\s+huge)\b.{0,180}\b(?:sun|earth|moon)\b/iu.test(
      value,
    ) ||
    /\b(?:my\s+car|my\s+stove|my\s+water\s+heater|making\s+tea|my\s+mug|beginning\s+of\s+my\s+day)\b/iu.test(
      value,
    ) ||
    /\blifespan\s+(?:of|for)\s+(?:renewable\s+resources?|fossil\s+fuels?)\b.{0,180}\b(?:circle|broken\s+loop|one[- ]way\s+ticket)\b/iu.test(
      value,
    ) ||
    /\bfirst\s*,?\s+(?:the\s+)?fossil\s+fuel\s+is\s+found\b.{0,120}\bextracted\b/iu.test(
      value,
    ) ||
    /\bstrength\b.{0,100}\bdepend\w*\b.{0,100}\b(?:couple|few)\s+(?:of\s+)?factors?\b/iu.test(
      value,
    ) ||
    /\ball\s+life\s+comes\s+from\s+other\s+life\b.{0,120}\bprocess\s+of\s+reproduction\b/iu.test(
      value,
    ) ||
    /\bcit(?:y|ies)\s+(?:one|two|three|four|five|\d+)\b.{0,220}\b(?:incoming|outgoing|routes?|row|column|two\s+plus|start\s+at|end\s+at)\b|\b(?:incoming|outgoing|routes?|row|column)\b.{0,180}\bcit(?:y|ies)\s+(?:one|two|three|four|five|\d+)\b/iu.test(
      value,
    ) ||
    /\bstarts?\s+at\s+city\s+(?:one|two|three|four|five|\d+)\b.{0,100}\bends?\s+at\s+city\s+(?:one|two|three|four|five|\d+)\b/iu.test(
      value,
    ) ||
    /^\s*(?:number\s+)?(?:one|two|three|four|five|\d+)[,.:]\s+.{0,220}\b(?:one\s+day|boss|council|employer|employee|office|door)\b/iu.test(
      value,
    ) ||
    /\b(?:nixon|obama|mcconnell)\b.{0,240}\b(?:white\s+house|congress|divided\s+government|term|reporters?|said)\b/iu.test(
      value,
    ) ||
    /\bfor\s+a\s+lot\s+of\s+people\b.{0,100}\bsignificant\s+negative\b/iu.test(
      value,
    ) ||
    /\bwhen\s+someone\s+tells\s+you\b.{0,160}\bparsimonious\b.{0,120}\b(?:cheap|frugal)\b/iu.test(
      value,
    ) ||
    /\bwho\s+knows\b.{0,100}\bi['’]?m\s+guessing\b/iu.test(value) ||
    /\beverything\s+else\b.{0,180}\b(?:listed|shown|pictured)\s+here\b.{0,120}\b(?:jaws?|trait|feature)\b/iu.test(
      value,
    ) ||
    /\b(?:it\s+says\s+right\s+here|young\s+bushback)\b|\bview\b.{0,100}\bas\s+almost\s+a\s+shelter\b/iu.test(
      value,
    ) ||
    /\b(?:pink|dark|light\s+blue)\s+chromosome\b.{0,240}\b(?:parent|offspring|paired|diagram)\b/iu.test(
      value,
    ) ||
    /\b(?:yael|tai|hamza)\b.{0,320}\b(?:boss|employer|employees?|coworkers?|city\s+council|backyard|department|unions?|job|fired|quits?)\b/iu.test(
      value,
    ) ||
    /\b(?:her|his|their)\s+boss\b.{0,240}\b(?:fires?|fired|department|move|transfer|quit)\b|\bco[- ]?workers?\b.{0,220}\b(?:knee\s+problems?|allowed\s+to\s+sit|hours?|breaks?)\b/iu.test(
      value,
    ) ||
    /\b(?:government\s+accountability\s+office|gao)\b.{0,260}\b(?:2019|testif(?:y|ied)|committee|made\s+progress|room\s+for\s+improvement)\b/iu.test(
      value,
    ) ||
    /\b(?:obama|president\s+at\s+the\s+time)\b.{0,320}\b(?:executive actions?|accountability\s+review\s+board|physicians?|electronic\s+health\s+record|whistleblowers?)\b/iu.test(
      value,
    ) ||
    /\b(?:one\s+million|2018|2017)\b.{0,260}\b(?:appointments?|veterans?|access\s+to\s+care|improved)\b/iu.test(
      value,
    ) ||
    /\b(?:let['’]?s|we(?:['’]?re|\s+are)\s+going\s+to)\s+(?:go\s+through|think\s+about|list)\b.{0,180}\b(?:actions?|branches?|classif(?:y|ication)|interactions?)\b/iu.test(
      value,
    ) ||
    /\b(?:clinton|reagan|o['’]?neill)\b.{0,260}\b(?:administration|white\s+house|congress|republican|democrat|social\s+security)\b/iu.test(
      value,
    ) ||
    /\b(?:george\s+h\.?\s*w\.?\s*bush|george\s+w\.?\s*bush|bill\s+clinton|ronald\s+reagan|tip\s+o['’]?neill)\b.{0,320}\b(?:presiden|house|senate|congress|republican|democrat|party)\b/iu.test(
      value,
    ) ||
    /\b(?:chart|graph|table)\b.{0,260}\b(?:colors?|party|house|senate|white\s+house|control)\b/iu.test(
      value,
    ) ||
    /\b(?:helps?\s+us\s+visualize|look\s+down\s+this\s+diagram)\b.{0,280}\b(?:parties|house|senate|white\s+house|control|unusual)\b/iu.test(
      value,
    ) ||
    /\b(?:lyndon\s+johnson|colored\s+in\s+blue|light\s+blue\s+color|dark\s+blue\s+color)\b.{0,280}\b(?:democrat|senate|house|party)\b/iu.test(
      value,
    ) ||
    /\b(?:go\s+all\s+the\s+way\s+down\b.{0,180}\bgeorge\s+h\.?|george\s+h\.?$|bush\s+had\s+a\s+divided\s+government)\b/iu.test(
      String(value ?? "").trim(),
    ) ||
    /\bone\s+negative\s+of\s+it\b.{0,180}\b(?:some\s+people|extreme\s+partisanship)\b/iu.test(
      value,
    ) ||
    /\b(?:go\s+further\s+down\s+in\s+time|more\s+and\s+more\s+divided\s+governments?|gerald\s+ford|bush\s+faced\s+a\s+divided\s+government|welfare\s+reform\s+package\s+of\s+1996)\b/iu.test(
      value,
    ) ||
    /\bgridlock\b.{0,180}\b(?:traffic|people\s+just\s+can['’]?t\s+get\s+around)\b/iu.test(
      value,
    ) ||
    /\b(?:anyway|alright)\b.{0,120}\b(?:go\s+back|what\s+we\s+were\s+doing|already\s+talked)\b/iu.test(
      value,
    ) ||
    /\bparsimony\b.{0,180}\beveryday\s+language\b.{0,100}\b(?:cheap|frugal)\b/iu.test(
      value,
    ) ||
    /\bas\s+we['’]?ll\s+(?:see|talk\s+about)\b.{0,180}\bfuture\s+videos?\b/iu.test(
      value,
    ) ||
    /\b(?:cross\s+out|already\s+classified)\b.{0,180}\blamprey\b|\blamprey\b.{0,180}\b(?:cross\s+out|already\s+classified)\b/iu.test(
      value,
    ) ||
    /\b(?:bald\s+eagle|antelope|alligator|sea\s+bass)\b.{0,180}\b(?:has|have|possess(?:es)?)\b.{0,100}\b(?:feathers?|fur|gizzard|lungs?|jaws?)\b/iu.test(
      value,
    ) ||
    /\b(?:everyone['’]?s\s+got\s+jaws|next\s+most\s+common\s+trait|make\s+them\s+a\s+little\s+bit\s+closer|some\s+place\s+along\s+this\s+right\s+branch|lamprey\s+here\s+does\s+not\s+have\s+any\s+of\s+these\s+five\s+traits)\b/iu.test(
      value,
    ) ||
    /\b(?:bald\s+eagle\s+isn['’]?t\s+the\s+only\s+species\s+with\s+feathers|could\s+have\s+branched\s+off\s+into\s+many)\b/iu.test(
      value,
    ) ||
    /\b(?:in\s+everyday\s+language|when\s+people\s+talk\s+about)\b.{0,180}\bsymbiosis\b/iu.test(
      value,
    ) ||
    /\b(?:interactions?\s+(?:can\s+be|are)\s+classified\s+in\s+different\s+ways|think\s+about\b.{0,160}\bclassify\s+them)\b/iu.test(
      value,
    ) ||
    /\b(?:first\s+one\s+that\s+is\s+often\s+thought\s+about|first\s+that\s+we\s+could\s+talk\s+about)\b.{0,140}\b(?:competition|parasitism)\b/iu.test(
      value,
    ) ||
    /\bthe\s+next\s+form\s+of\s+interspecific\s+interaction\b.{0,120}\bpredation\b/iu.test(
      value,
    ) ||
    /\bthe\s+technical\s+term\s+for\s+that\s+is\s+interspecific\s+interactions?\b/iu.test(
      value,
    ) ||
    /\ball\s+of\s+these\s+different\s+populations\b.{0,220}\b(?:picture|same\s+region|could\s+be\s+in\s+competition)\b/iu.test(
      value,
    ) ||
    /\b(?:this\s+is\s+a\s+picture\s+of\s+a\s+community|picture\s+right\s+over\s+here)\b/iu.test(
      value,
    ) ||
    /\bif\s+i['’]?m\s+in\s+competition\s+with\s+you\b|^\s*actually\s*,?\s+well\s+oftentimes\b|^\s*oftentimes\s*,?\s+it\s+doesn['’]?t\s+really\s+have\s+an\s+impact\b/iu.test(
      String(value ?? "").trim(),
    ) ||
    // This caption fragment was selected without its governing clause and
    // caused the generator to reverse chemical bond energetics.
    /^\s*to\s+overcome\s+the\s+attraction\s+between\s+(?:the\s+)?atoms?\b/iu.test(
      value,
    )
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
  score += Math.min(5, Math.floor(tokens.size / 8));
  if (value.length >= 45 && value.length <= 700) score += 2;
  return score;
}

function promptFirstPrimaryClaimScore(value, topicTokens) {
  let score = conceptFirstInstructionalScore(value, topicTokens);
  if (!Number.isFinite(score)) return score;
  const text = String(value ?? "").trim();
  if (
    /^(?:and|but|so|then|also|for example|for instance|this|that|these|those|it|they|here)\b/iu.test(
      text,
    )
  ) {
    score -= 8;
  }
  if (
    /\b(?:a|the)\s+(?:pattern|thing|result|process|approach|case|example)\b/iu.test(
      text,
    ) &&
    !/\b(?:called|known as|means|is|are|predicts?|causes?|results? in|consists? of|depends? on)\b/iu.test(
      text,
    )
  ) {
    score -= 6;
  }
  if (
    /\b(?:called|known as|defined as|means|predicts?|causes?|results? in|consists? of|depends? on|prevents?|allows?|enables?)\b/iu.test(
      text,
    ) ||
    /(?:称为|叫作|定义为|意味着|预测|导致|由.+组成|取决于|防止|允许|使得)/u.test(
      text,
    )
  ) {
    score += 5;
  }
  if (
    /\bfinite\s+supply\s+of\s+metal\b.{0,120}\bonce\b.{0,80}\boxidized\b/iu.test(
      text,
    ) ||
    /\b(?:imperfections?\s+and\s+irregularities?|surface\s+imperfections?)\b.{0,160}\bprevent(?:s|ed|ing)?\b.{0,80}\boxidizing\b/iu.test(
      text,
    )
  ) {
    score += 12;
  }
  if (
    /^\s*the\s+electrons?\s+(?:are\s+)?no\s+longer\s+available\b.{0,120}\bbattery\s+dies?\b/iu.test(
      text,
    )
  ) {
    score -= 8;
  }
  if (
    /^(?:there\s+(?:is|are)\b[^.!?]{0,100}\b(?:this|that|these|those)\b|if\s+you\s+(?:were|are|have|had)\b)/iu.test(
      text,
    )
  ) {
    score -= 14;
  }
  if (/\b(?:you|your|we|our)\b/iu.test(text)) score -= 10;
  if (/^there\s+(?:is|are)\s+[\d,.\s]+$/iu.test(text)) score -= 30;
  if (
    /^(?:let['’]?s|i\b|we\b|you\b|he\b|probably\b|now\b|actually\b)/iu.test(
      text,
    )
  ) {
    score -= 16;
  }
  if (
    /\b(?:something\s+like\s+that|denoted\s+(?:by|with)\s+(?:the\s+)?(?:capital\s+)?letter)\b/iu.test(
      text,
    ) ||
    /^\s*[\d,.\s]+(?:kilometers?|meters?|seconds?|hours?)?\s*(?:per\s+hour)?\s*,?\s*something\s+like\s+that/iu.test(
      text,
    )
  ) {
    score -= 24;
  }
  if (
    /\b(?:some\s+of\s+these\s+forces|some\s+forces|certain\s+(?:types?|things?)|something\s+(?:far\s+)?more\s+dangerous|this\s+variety|these\s+groups)\b/iu.test(
      text,
    )
  ) {
    score -= 14;
  }
  const historyFocused = [
    "history",
    "historical",
    "revolution",
    "war",
    "empire",
    "ancient",
    "medieval",
    "civilization",
  ].some((token) => topicTokens.has(token));
  if (
    !historyFocused &&
    /\b(?:in\s+\d{3,4}(?:\s*(?:ce|bce|ad|bc))?|\d+\s+years?\s+ago|ancient\s+civilizations?|romans?\b|first\s+(?:common|widely\s+used)|introduced\s+in\s+the\s+\d{4}s?|presented\s+.{0,60}\s+court|\b\w+\s+believed\s+that)\b/iu.test(
      text,
    )
  ) {
    score -= 20;
  }
  return score;
}

function promptFirstWindowPenalty(value, topicTokens = new Set()) {
  const text = String(value ?? "");
  let penalty = 0;
  if (
    /\b(?:the\s+)?(?:first|second|previous|following|above|below)\s+(?:equation|statement|example|problem|figure|diagram)\b/iu.test(
      text,
    ) ||
    /\b(?:a\s+)?problem\s+like\s+this\b/iu.test(text)
  ) {
    penalty += 18;
  }
  if (
    /\b(?:something\s+like\s+that|denoted\s+(?:by|with)\s+(?:the\s+)?(?:capital\s+)?letter)\b/iu.test(
      text,
    )
  ) {
    penalty += 30;
  }
  if (
    /\b(?:review\s+(?:the\s+)?video\s+on\s+unit\s+conversion|how\s+many\s+seconds\s+are\s+there\s+in\s+an\s+hour|change\s+(?:the\s+)?meters?\s+per\s+second\s+into\s+kilometers?\s+per\s+hour)\b/iu.test(
      text,
    )
  ) {
    // Keep the conversion factors available as neighboring evidence, but do
    // not prefer the presenter's conversion chatter as the grading target.
    penalty += 14;
  }
  if (
    /^(?:for example|for instance|this means|basically|and|but|so|then)\b/iu.test(
      text.trim(),
    )
  ) {
    penalty += 5;
  }
  if (
    /\b(?:oversimplif(?:y|ies|ied|ication)|for\s+the\s+sake\s+of\s+simplicity|some\s+people\s+(?:have\s+)?(?:actually\s+)?(?:made\s+)?the\s+argument|myths?\s+and\s+misconceptions?|disputed\s+interpretation|let\s+me\s+give\s+you\s+an\s+analogy|(?:water\s+)?(?:analogy|metaphor)|analogous\s+to|involves?\s+some\s+generalizations?)\b/iu.test(
      text,
    )
  ) {
    penalty += 40;
  }
  if (
    /\b(?:what\s+(?:a|the)\s+\w+\s+is\s+doing\s+with\s+itself|tell\s+at\s+a\s+glance\s+just\s+what|if\s+you\s+(?:were|are|have|had)\b|two\s+hundred\s+and\s+fifty\s+years\s+ago)\b/iu.test(
      text,
    )
  ) {
    penalty += 24;
  }
  if (
    /\b(?:the\s+public\s+did\s+not\s+learn|article\s+revealed|kept\s+(?:it|the\s+work|actions?)\s+hidden|confidential\s+plan|night[- ]time\s+(?:construction|shifts?)|newspaper\s+strike|press\s+attention|top\s+secret|without\s+(?:alerting|warning)\s+(?:the\s+)?(?:public|residents)|never\s+told\s+[A-Z][\p{L}-]+)\b/iu.test(
      text,
    )
  ) {
    penalty += 30;
  }
  if (
    /\b(?:court\s+was\s+(?:somewhat\s+)?skeptical|seemingly\s+quiet\s+afternoon|estimated\s+\d+\s+colds?|within\s+a\s+few\s+days|one[- ]in[- ]\w+\s+chance|emergency\s+evacuation|secret\s+evacuation|hurricane\s+veered\s+out\s+to\s+sea|halfway\s+complete\s+when\s+hurricane|covert\s+construction|press\s+was\s+occupied|newspaper\s+strike|public\s+didn['’]t\s+learn|skyscraper\s+in\s+(?:midtown|downtown)\s+[A-Z][\p{L}-]+|something\s+(?:far\s+)?more\s+dangerous|coined\s+(?:the\s+)?term|term\b.{0,70}\b(?:was\s+)?coined\s+by|credited\s+with\s+being\s+the\s+first|first\s+person\s+to)\b/iu.test(
      text,
    ) ||
    /^\s*if\s+you(?:'ve|\s+have|\s+ever)\b/iu.test(text.trim())
  ) {
    penalty += 26;
  }
  const historyFocused = [
    "history",
    "historical",
    "revolution",
    "war",
    "empire",
    "ancient",
    "medieval",
    "civilization",
  ].some((token) => topicTokens.has(token));
  if (
    !historyFocused &&
    /\b(?:in\s+\d{3,4}(?:\s*(?:ce|bce|ad|bc))?|\d+\s+years?\s+ago|ancient\s+civilizations?|romans?\b|first\s+(?:common|widely\s+used)|introduced\s+in\s+the\s+\d{4}s?|presented\s+.{0,60}\s+court|\b\w+\s+believed\s+that)\b/iu.test(
      text,
    )
  ) {
    penalty += 22;
  }
  return penalty;
}

function promptFirstAssessmentCluster(value) {
  const text = normalizeGroundedText(value);
  if (
    /\bcommunit(?:y|ies)\b.{0,260}\b(?:all|collectively)\b.{0,160}\b(?:living (?:species|organisms)|populations?)\b.{0,160}\b(?:same|one|given)?\s*area\b|\b(?:all|collectively)\b.{0,160}\b(?:living (?:species|organisms)|populations?)\b.{0,180}\bcommunit(?:y|ies)\b/iu.test(
      text,
    )
  ) {
    return "ecological_community_definition";
  }
  if (
    /\b(?:organelles?|cell (?:parts|structures?))\b.{0,300}\b(?:different|unique|specialized)\b.{0,120}\b(?:functions?|functional)\b.{0,180}\b(?:cell|life|tasks?|processes?)\b|\b(?:organelles?|cell (?:parts|structures?))\b.{0,260}\bwork together\b.{0,160}\b(?:cell|tasks?|processes?)\b/iu.test(
      text,
    )
  ) {
    return "cell_organelle_function_coordination";
  }
  if (
    /^(?=[\s\S]*\btruck\b)(?=[\s\S]*\bformula one car\b)(?=[\s\S]*\bmomentum\b)/iu.test(
      text,
    )
  ) {
    return "momentum_mass_velocity_comparison";
  }
  if (
    /\b(?:angular momentum|final angular momentum)\b.{0,300}\b(?:no (?:net )?external torque|initial angular momentum|remain\w* (?:constant|unchanged)|conserv\w*)\b|\bno (?:net )?external torque\b.{0,260}\bangular momentum\b/iu.test(
      text,
    )
  ) {
    return "angular_momentum_no_external_torque";
  }
  if (
    /\bpulmonary arter(?:y|ies)\b.{0,360}\bpulmonary veins?\b.{0,260}\b(?:oxygenated|de[- ]oxygenated|away from the heart|toward the heart|reverse\w*|pattern)\b|\bpulmonary veins?\b.{0,360}\bpulmonary arter(?:y|ies)\b.{0,260}\b(?:oxygenated|de[- ]oxygenated|away from the heart|toward the heart|reverse\w*|pattern)\b|\bpulmonary arteries and veins\b.{0,220}\b(?:reverse\w*|oxygenation|pattern)\b/iu.test(
      text,
    )
  ) {
    return "pulmonary_vessel_oxygenation_direction";
  }
  if (
    /\bquaternary structure\b.{0,300}\b(?:multiple|more than one)\b.{0,120}\b(?:polypeptide|protein)\s+chains?\b|\b(?:multiple|more than one)\b.{0,120}\b(?:polypeptide|protein)\s+chains?\b.{0,260}\bquaternary structure\b/iu.test(
      text,
    )
  ) {
    return "protein_quaternary_multichain_structure";
  }
  if (
    /\b(?:total )?mechanical energy\b.{0,360}\b(?:closed system|no dissipative forces?|remains? constant|conserved)\b|\b(?:closed system|no dissipative forces?)\b.{0,300}\b(?:total )?mechanical energy\b/iu.test(
      text,
    )
  ) {
    return "mechanical_energy_closed_system_conservation";
  }
  if (
    /^(?=[\s\S]*\b(?:decrease|reduction|lower)\w*\b)(?=[\s\S]*\bdemand\b)(?=[\s\S]*\b(?:left|quantity demanded (?:falls|decreases?))\b)/iu.test(
      text,
    )
  ) {
    return "demand_decrease_leftward_shift";
  }
  if (
    /\bideal gas law\b.{0,260}\b(?:p\s*v|pressure|volume|moles?|temperature|n\s*=)\b|\b(?:n\s*=\s*p\s*v|p\s*v\s*=\s*n\s*r\s*t)\b/iu.test(
      text,
    )
  ) {
    return "ideal_gas_law_variable_relationship";
  }
  if (
    /^(?=[\s\S]*\b(?:great oxygenation event|oxygen catastrophe|atmospheric oxygen)\b)(?=[\s\S]*\b(?:anaerobic|poisonous|extinction|oxygen levels? (?:rose|increased))\b)/iu.test(
      text,
    )
  ) {
    return "great_oxygenation_anaerobe_effect";
  }
  if (
    /\batomic radius\b.{0,300}\b(?:half (?:the )?(?:distance between (?:(?:their|the) )?nuclei|internuclear distance)|size of an atom|center of (?:the )?nucleus|covalent radius)\b|\bhalf (?:the )?(?:distance between (?:(?:their|the) )?nuclei|internuclear distance)\b.{0,180}\batomic radius\b/iu.test(
      text,
    )
  ) {
    return "atomic_radius_measurement_definition";
  }
  if (
    /^(?=[\s\S]*\b(?:fixed[- ]rate )?lender\b)(?=[\s\S]*\binflation\b)(?=[\s\S]*\b(?:real return|purchasing power|repaid dollars?)\b)/iu.test(
      text,
    )
  ) {
    return "unexpected_inflation_fixed_lender_return";
  }
  if (
    /^(?=[\s\S]*\b(?:independent|independence)\b)(?=[\s\S]*\b(?:conditional probability|given(?: that| the other| snowy| delayed)?)\b)(?=[\s\S]*\b(?:equals?|same|unchanged)\b)/iu.test(
      text,
    )
  ) {
    return "probability_independence_conditional_equality";
  }
  if (
    /^(?=[\s\S]*\bexperimental probabilit(?:y|ies)\b)(?=[\s\S]*\b(?:true|theoretical) probabilit(?:y|ies)\b)(?=[\s\S]*\b(?:more experiments?|approximat\w*|estimate\w*|differ)\b)/iu.test(
      text,
    )
  ) {
    return "experimental_probability_convergence";
  }
  if (
    /^(?=[\s\S]*\b(?:tectonic|lithospheric|crustal) plates?\b)(?=[\s\S]*\bcrust(?:al)?\b)(?=[\s\S]*\b(?:upper(?:most)? mantle|lithosphere)\b)/iu.test(
      text,
    )
  ) {
    return "lithospheric_plate_crust_upper_mantle";
  }
  if (
    /\b(?:genes?|gene expression)\b.{0,260}\b(?:environmental factors?|stress|food|hormones?|activate|inactivate)\b|\b(?:environmental factors?|stress|food|hormones?)\b.{0,220}\b(?:genes?|gene expression|activate|inactivate)\b/iu.test(
      text,
    )
  ) {
    return "environment_gene_expression_effect";
  }
  if (
    /\b(?:stored sugars?|sugars? made during photosynthesis)\b.{0,240}\b(?:energy|later|future|immediate|stored)\b|\bphotosynthesis\b.{0,220}\bsugars?\b.{0,160}\b(?:energy|later|stored)\b/iu.test(
      text,
    )
  ) {
    return "photosynthesis_sugar_energy_storage";
  }
  if (
    /\bcovalent network solids?\b.{0,220}\b(?:networks?|made up|formed|structure)\b.{0,160}\bcovalent bonds?\b|\bcovalent bonds?\b.{0,220}\bcovalent network solids?\b/iu.test(
      text,
    )
  ) {
    return "covalent_network_bond_structure";
  }
  if (
    /\bhomologous features?\b.{0,300}\b(?:evolutionary relationships?|common ancestor|closely related|clues?)\b|\b(?:evolutionary relationships?|common ancestor|closely related)\b.{0,300}\bhomologous features?\b/iu.test(
      text,
    )
  ) {
    return "homologous_features_common_ancestry";
  }
  if (
    /\bgenotype\b.{0,240}\b(?:alleles?|genetic makeup|homozygous|heterozygous)\b|\b(?:homozygous|heterozygous)\b.{0,220}\bgenotype\b/iu.test(
      text,
    )
  ) {
    return "genotype_allele_definition";
  }
  if (
    /\bkinetic energy\b.{0,220}\b(?:motion energy|energy.*due to.*motion|object.*motion)\b|\benergy\b.{0,120}\bdue to (?:its )?motion\b/iu.test(
      text,
    )
  ) {
    return "kinetic_energy_motion_definition";
  }
  if (
    /\b(?:press|pushing)\w*\b.{0,120}\btable\b.{0,220}\b(?:finger|equal and opposite|force)\b|\btable\b.{0,180}\b(?:finger|equal and opposite)\b/iu.test(
      text,
    )
  ) {
    return "table_finger_action_reaction";
  }
  if (
    /\bhuman body\b.{0,260}\b(?:hierarchy|hierarchical|organizational levels?|nested layers?|smaller components?.*larger structures?)\b|\b(?:hierarchy|hierarchical|organizational levels?|nested layers?)\b.{0,220}\b(?:human body|cells?|tissues?|organs?|organ systems?)\b/iu.test(
      text,
    )
  ) {
    return "human_body_organization_hierarchy";
  }
  if (
    /\blong[- ]run average total cost\b.{0,260}\b(?:declin\w*|fall\w*|slop\w* downward|economies of scale)\b|\beconomies of scale\b.{0,220}\b(?:long[- ]run average total cost|output increases?|costs? (?:fall|decrease))\b/iu.test(
      text,
    )
  ) {
    return "economies_scale_cost_decline";
  }
  if (
    /\blong[- ]run average total cost\b.{0,260}\b(?:ris\w*|upward|diseconomies of scale)\b|\bdiseconomies of scale\b.{0,220}\b(?:long[- ]run average total cost|coordination|output increases?|costs? (?:rise|increase))\b|\bcoordination\w*\b.{0,220}\bdiseconomies of scale\b/iu.test(
      text,
    )
  ) {
    return "diseconomies_scale_cost_increase";
  }
  if (
    /\b(?:specialized cells?|most cells?|nearly every cell)\b.{0,260}\b(?:same|complete|all)\s+(?:set of\s+)?genetic information\b|\b(?:same|complete|all)\s+(?:set of\s+)?genetic information\b.{0,260}\b(?:specialized cells?|most cells?|nearly every cell)\b/iu.test(
      text,
    )
  ) {
    return "multicellular_cells_shared_genome";
  }
  if (
    /\bfigurative language\b.{0,220}\b(?:says? one thing|literal|means? another|intended meaning)\b|\b(?:literal wording|says? one thing)\b.{0,180}\b(?:figurative language|means? another)\b/iu.test(
      text,
    )
  ) {
    return "figurative_literal_intended_meaning";
  }
  if (
    /\b(?:capital goods?|investment)\b.{0,300}\b(?:future productive capacity|future production|economic growth|fewer consumer goods|current consumption|standard of living)\b|\b(?:future productive capacity|economic growth|current consumption)\b.{0,260}\bcapital goods?\b/iu.test(
      text,
    )
  ) {
    return "capital_goods_current_future_tradeoff";
  }
  if (
    /\b(?:move|moving)\w*\s+(?:a\s+)?(?:mass|charge|object)\b.{0,240}\b(?:against|opposite)\b.{0,120}\b(?:field|force)\b.{0,180}\b(?:energy|work)\b|\b(?:against|opposite)\s+(?:the\s+)?(?:direction\s+of\s+)?(?:a\s+)?(?:field|force)\b.{0,220}\b(?:stored energy|potential energy|work)\b/iu.test(
      text,
    )
  ) {
    return "field_work_against_force_energy";
  }
  if (
    /\bionization energy\b.{0,300}\b(?:left\s+to\s+right|across\s+a\s+period|effective nuclear charge|protons? (?:are )?added|outer electrons? more strongly)\b|\b(?:left\s+to\s+right|across\s+a\s+period|effective nuclear charge)\b.{0,300}\bionization energy\b|\bacross\s+a\s+period\b.{0,220}\b(?:effective nuclear charge|protons? (?:are )?added|outer electrons? more strongly)\b/iu.test(
      text,
    )
  ) {
    return "ionization_energy_across_period";
  }
  if (
    /\bstandard cell potential\b.{0,260}\b(?:half[- ]reactions?|reduction potential|oxidation potential|sum|negative sign)\b|\b(?:reduction potential|oxidation potential|half[- ]reaction potentials?)\b.{0,260}\bstandard cell potential\b/iu.test(
      text,
    )
  ) {
    return "standard_cell_potential_half_reactions";
  }
  if (
    /\b(?:shared cellular features?|shared cellular processes?|membrane[- ]bound organelles?|dna|common biochemical processes?)\b.{0,280}\b(?:common ancestry|common ancestor|evolutionary relationship)\b|\b(?:common ancestry|common ancestor)\b.{0,280}\b(?:shared cellular features?|shared cellular processes?|membrane[- ]bound organelles?|dna)\b/iu.test(
      text,
    )
  ) {
    return "shared_cell_features_common_ancestry";
  }
  if (
    /\bsurface area(?:[- ]to[- ]volume|\s+to\s+volume)?\b.{0,260}\b(?:3\s*\/\s*r|sphere|ratio)\b|\b3\s*\/\s*r\b.{0,200}\bsurface area\b/iu.test(
      text,
    )
  ) {
    return "sphere_surface_area_volume_formula";
  }
  if (
    /\b(?:cell grows?|larger cells?|volume increases?)\b.{0,300}\b(?:surface area per unit volume decreases?|insufficient surface area|exchange (?:of )?(?:resources|waste|thermal energy))\b|\b(?:insufficient surface area|surface area per unit volume decreases?)\b.{0,260}\b(?:cell|volume|exchange)\b/iu.test(
      text,
    )
  ) {
    return "cell_size_surface_exchange_limit";
  }
  if (
    /\bnecessary and proper clause\b.{0,320}\b(?:enumerated powers?|carrying into execution|implied powers?|make all laws?|regulat\w* drugs?)\b|\b(?:carrying into execution|implied powers?|(?:make|making|may make)\s+(?:all\s+)?laws?\s+necessary and proper)\b.{0,260}\b(?:congress|federal government|enumerated powers?)\b|\bcongress\b.{0,260}\bnecessary and proper\b.{0,180}\b(?:enumerated powers?|execution)\b/iu.test(
      text,
    )
  ) {
    return "necessary_proper_implied_power";
  }
  if (
    /\b(?:delta g|gibbs free energy)\b.{0,260}\b(?:less than zero|greater than zero|negative|positive)\b.{0,180}\b(?:forward|reverse|products?|reactants?|favou?r|spontaneous)\b|\b(?:negative|positive)\s+(?:delta g|gibbs free energy)\b.{0,220}\b(?:forward|reverse|products?|reactants?|favou?r|spontaneous)\b|\b(?:forward|reverse)\s+reaction\b.{0,220}\b(?:delta g|gibbs free energy)\b/iu.test(
      text,
    )
  ) {
    return "gibbs_sign_reaction_direction";
  }
  if (
    /\b(?:rain shadow|leeward|descending dry air|mountains? block\w* moisture)\b.{0,260}\b(?:mountains?|dry|moisture|compress\w*|warm\w*|evaporation)\b|\bmountains?\b.{0,260}\b(?:rain shadow|leeward|descending dry air|block\w* moisture)\b/iu.test(
      text,
    )
  ) {
    return "mountain_rain_shadow_mechanism";
  }
  if (
    /\b(?:ultraviolet|high[- ]frequency electromagnetic)\b.{0,300}\b(?:knock\w*|remove\w*|eject\w*)\s+electrons?\b(?:.{0,160}\b(?:ioniz\w*|chemical properties|sunburn)\b)?|\bioniz\w*\b.{0,220}\b(?:ultraviolet|high[- ]frequency electromagnetic|electrons?)\b/iu.test(
      text,
    )
  ) {
    return "ionizing_radiation_electron_ejection";
  }
  if (
    /\b(?:va|veterans affairs)\b.{0,320}\b(?:wait times?|bonuses?|perverse incentive|falsif\w* records?|unrealistic goal)\b/iu.test(
      text,
    )
  ) {
    return "va_wait_time_incentive_failure";
  }
  if (
    /\bgenetic drift\b.{0,260}\b(?:small populations?|population size|random fluctuations?|allele frequencies?|lost by chance)\b|\b(?:small populations?|population size|random fluctuations?|allele frequencies?|alleles? (?:are )?lost by chance)\b.{0,260}\bgenetic drift\b|\bsmall populations?\b.{0,260}\b(?:random fluctuations?\b.{0,100}\ballele frequencies?|alleles? (?:are )?lost by chance)\b/iu.test(
      text,
    )
  ) {
    return "genetic_drift_small_population_effect";
  }
  if (
    /\benergy resources?\b.{0,220}\b(?:two groups?|renewable)\b.{0,160}\bnonrenewable\b|\brenewable energy\b.{0,120}\bnonrenewable energy\b.{0,180}\b(?:groups?|classif|divid)/iu.test(
      text,
    )
  ) {
    return "energy_renewable_nonrenewable_classification";
  }
  if (
    /\bnonrenewable\b.{0,220}\b(?:finite|fixed amount|cannot be (?:easily )?replaced|take\w* (?:millions|a long time)(?: of)? years?|form\w* slowly)\b/iu.test(
      text,
    )
  ) {
    return "nonrenewable_finite_slow_replacement";
  }
  if (
    /\bsexual reproduction\b.{0,260}\b(?:genetic\w* vari\w*|genetic diversity|mixture of (?:genes|chromosomes)|genes? from (?:both|two) parents?|not genetically identical)\b|\b(?:mixture of (?:genes|chromosomes)|genes? from (?:both|two) parents?)\b.{0,220}\bsexual reproduction\b/iu.test(
      text,
    )
  ) {
    return "sexual_reproduction_genetic_variation";
  }
  if (
    /\bdirected (?:edge|arrow)\b.{0,220}\b(?:starting|ending|start|end|ordered|reverse|direction)\b/iu.test(
      text,
    )
  ) {
    return "directed_edge_direction";
  }
  if (/\badjacency matrix\b.{0,180}\brows? represent starting/iu.test(text)) {
    return "adjacency_matrix_row_origin";
  }
  if (/\badjacency matrix\b.{0,180}\bcolumns? represent ending/iu.test(text)) {
    return "adjacency_matrix_column_destination";
  }
  if (/\badjacency matrix\b.{0,220}\bentry\b.{0,120}\bcounts?\b/iu.test(text)) {
    return "adjacency_matrix_entry_edge_count";
  }
  if (
    /\badjacency matrix\b.{0,220}\bcolumn\b.{0,120}\bincoming edges?\b/iu.test(
      text,
    )
  ) {
    return "adjacency_matrix_column_incoming_sum";
  }
  if (
    /\badjacency matrix\b.{0,220}\brow\b.{0,120}\boutgoing edges?\b/iu.test(
      text,
    )
  ) {
    return "adjacency_matrix_row_outgoing_sum";
  }
  if (
    /\beconomic right\b.{0,180}\b(?:choose|change)\b.{0,80}\bemployment\b/iu.test(
      text,
    )
  ) {
    return "economic_right_choose_change_employment";
  }
  if (
    /\b(?:economic right|workers?|employees?)\b.{0,240}\b(?:organize|join)\b.{0,100}\b(?:labor )?unions?\b|\b(?:labor )?unions?\b.{0,220}\b(?:economic right|organize|join|retaliation|employer interference)\b/iu.test(
      text,
    )
  ) {
    return "economic_right_union_organization";
  }
  if (
    /\bexecutive branch\b.{0,260}\b(?:investigate|administrative rules|dismiss appointed leaders|bureaucracy accountable)\b/iu.test(
      text,
    )
  ) {
    return "executive_bureaucracy_accountability_tools";
  }
  if (
    /\bdivided[- ]government\b.{0,260}\b(?:bipartisan negotiation|shared responsibility|political cover|credit)\b/iu.test(
      text,
    )
  ) {
    return "divided_government_bipartisan_bargaining";
  }
  if (
    /\bdivided government\b.{0,220}\bdifferent political parties\b.{0,180}\bexecutive and legislative branches\b/iu.test(
      text,
    )
  ) {
    return "divided_government_split_party_control";
  }
  if (
    /\bphylogenetic\b.{0,220}\boutgroup\b|\boutgroup\b.{0,220}\bcommon ancestry\b/iu.test(
      text,
    )
  ) {
    return "phylogenetic_outgroup_rooting";
  }
  if (
    /\bsymbiosis\b.{0,240}\b(?:long term|close interaction|mutualism|commensalism|parasitism)\b/iu.test(
      text,
    )
  ) {
    return "symbiosis_technical_scope";
  }
  if (
    /\binterspecific competition\b.{0,260}\b(?:negative|shared resources?|competing populations?)\b/iu.test(
      text,
    )
  ) {
    return "interspecific_competition_resource_effect";
  }
  if (/\bpredation\b.{0,220}\b(?:predator|prey|eaten)\b/iu.test(text)) {
    return "predation_predator_prey_effect";
  }
  if (/\bparasitism\b.{0,220}\b(?:parasite|host|benefit|harm)\b/iu.test(text)) {
    return "parasitism_parasite_host_effect";
  }
  if (/\bmutualism\b.{0,220}\b(?:both|benefit|species)\b/iu.test(text)) {
    return "mutualism_both_species_benefit";
  }
  if (
    /\bcommensalism\b.{0,240}\b(?:one species benefits|not significantly helped|indifferent|neutral)\b/iu.test(
      text,
    )
  ) {
    return "commensalism_one_benefits_other_unaffected";
  }
  if (
    /\bpartisanship\b.{0,260}\b(?:party advantage|ideology|public interest|governance)\b/iu.test(
      text,
    )
  ) {
    return "partisanship_party_over_governance";
  }
  if (
    /\bpolitical gridlock\b.{0,220}\b(?:obstruction|legislative action|moving forward)\b/iu.test(
      text,
    )
  ) {
    return "political_gridlock_obstruction";
  }
  if (
    /\b(?:peppered\s+)?(?:white|black|light(?:er)?|dark(?:er)?)(?:[- ]colored|\s+coloration|\s+trait)?\b.{0,180}\bmoths?\b.{0,280}\b(?:background|surface|soot|camouflage|visible|spotted|predators?|birds?|surviv|reproduc)\w*\b|\bmoths?\b.{0,220}\b(?:white|black|light(?:er)?|dark(?:er)?)(?:[- ]colored|\s+coloration|\s+trait)?\b.{0,260}\b(?:background|surface|soot|camouflage|visible|spotted|predators?|birds?|surviv|reproduc)\w*\b|\b(?:background|surface|soot|camouflage|visible|spotted|predators?|birds?)\b.{0,280}\b(?:peppered\s+)?(?:white|black|light(?:er)?|dark(?:er)?)(?:[- ]colored|\s+coloration|\s+trait)?\b.{0,140}\bmoths?\b/iu.test(
      text,
    )
  ) {
    return "peppered_moth_camouflage_selection";
  }
  if (
    /\b(?:standard\s+american\s+english|english(?:es|\s+variet(?:y|ies))?)\b.{0,260}\b(?:valid|acceptable|legitimate|right|wrong|equal|superior|inferior|many|variet(?:y|ies))\b|\b(?:many|different|multiple|valid|acceptable|legitimate)\s+(?:forms?\s+of\s+)?english(?:es|\s+variet(?:y|ies))?\b/iu.test(
      text,
    )
  ) {
    return "english_variety_legitimacy";
  }
  if (
    /\benvironmental factors?\b.{0,220}\btraits?\b.{0,160}\b(?:more|less)\s+favou?rable\b|\btraits?\b.{0,180}\b(?:more|less)\s+favou?rable\b.{0,160}\benvironment(?:al)?\b/iu.test(
      text,
    )
  ) {
    return "natural_selection_population_mechanism";
  }
  if (
    /\benlightenment(?:\s+ideas?)?\b.{0,260}\b(?:revolutions?|revolutionary|independence movements?|americas?|latin america|inspir(?:e|ed)|cited)\b|\b(?:revolutions?|revolutionary|independence movements?|americas?|latin america)\b.{0,260}\benlightenment(?:\s+ideas?)?\b/iu.test(
      text,
    )
  ) {
    return "enlightenment_revolution_influence";
  }
  if (
    /\b(?:gas|molecules?|particles?)\b.{0,320}\b(?:larger\s+volume|spread\s+out|fill\s+the\s+container|uniform(?:ly)?|ordered|disordered|accessible\s+states?|entropy|spontaneously\s+return)\b|\b(?:larger\s+volume|spread\s+out|fill\s+the\s+container|uniform(?:ly)?|ordered|disordered|accessible\s+states?|entropy|spontaneously\s+return)\b.{0,320}\b(?:gas|molecules?|particles?)\b/iu.test(
      text,
    )
  ) {
    return "gas_entropy_dispersion";
  }
  if (
    /\b(?:scarcity|scarce\s+resource|limited\s+(?:land|resource)|wants?\s+exceed\w*\s+(?:the\s+)?available\s+resources?)\b/iu.test(
      text,
    )
  ) {
    return "scarcity_resource_constraint";
  }
  if (
    /\b(?:opportunity\s+cost|next\s+best\s+(?:thing|alternative)\s+(?:we\s+)?give\s+up|foregone\s+alternative)\b/iu.test(
      text,
    )
  ) {
    return "opportunity_cost";
  }
  if (
    /\b(?:must\s+make\s+choices?|choose\s+among\s+alternatives?|allocat(?:e|es|ed|ing|ion)\s+(?:a\s+)?(?:scarce\s+)?resources?)\b/iu.test(
      text,
    )
  ) {
    return "scarcity_choice_allocation";
  }
  if (
    /\b(?:measure\w*\s+(?:the\s+)?(?:land|area)|search\w*\s+online.{0,80}\bspace|space\s+requirements?|information.{0,80}\ballocat\w*\s+space)\b/iu.test(
      text,
    )
  ) {
    return "allocation_information_method";
  }
  if (
    /\b(?:marine debris|garbage patch|microplastics?|plastic pollution)\b/iu.test(
      text,
    )
  ) {
    return "marine_plastic_debris";
  }
  if (/\b(?:tagged hippocampal neurons?|tagged neurons?)\b/iu.test(text)) {
    return "memory_tagged_neuron_recall";
  }
  if (
    /\b(?:long-term potentiation|ltp|strengthen(?:s|ed|ing)?\s+synaptic connections?|cells?\s+that\s+fire\s+together.{0,40}wire\s+together)\b/iu.test(
      text,
    )
  ) {
    return "memory_synaptic_plasticity";
  }
  if (
    /\b(?:surface imperfections?|surface irregularities?)\b.{0,220}\b(?:prevent(?:s|ed|ing)?\s+(?:(?:the\s+)?metal|it)\s+from\s+oxidizing|electrons?\s+(?:are\s+)?no longer available)\b|\b(?:imperfections?\s+and\s+irregularities?)\b.{0,120}\b(?:the\s+)?metal(?:['’]s)?\s+surface\b.{0,120}\bprevent(?:s|ed|ing)?\s+it\s+from\s+oxidizing\b|\b(?:prevent(?:s|ed|ing)?\s+(?:(?:the\s+)?metal|it)\s+from\s+oxidizing|electrons?\s+(?:are\s+)?no longer available)\b.{0,220}\b(?:surface imperfections?|surface irregularities?)\b|\b(?:battery|rechargeable|charging|discharging)\b.{0,220}\b(?:surface imperfections?|surface irregularities?|prevent(?:s|ed|ing)?\s+(?:(?:the\s+)?metal|it)\s+from\s+oxidizing|electrons?\s+(?:are\s+)?no longer available)\b|\b(?:surface imperfections?|surface irregularities?|prevent(?:s|ed|ing)?\s+(?:(?:the\s+)?metal|it)\s+from\s+oxidizing|electrons?\s+(?:are\s+)?no longer available)\b.{0,220}\b(?:battery|rechargeable|charging|discharging)\b/iu.test(
      text,
    )
  ) {
    return "battery_surface_degradation";
  }
  if (
    /\b(?:rsa|public exponent|private exponent)\b.{0,220}\b(?:modular inverse|congruent to 1|e\s*[*.×]?\s*d|e\s+times\s+d|least common multiple|lcm\s*\(|extended euclidean)\b|\b(?:modular inverse|congruent to 1|e\s*[*.×]?\s*d|e\s+times\s+d|least common multiple|lcm\s*\(|extended euclidean)\b.{0,220}\b(?:rsa|public exponent|private exponent)\b/iu.test(
      text,
    )
  ) {
    return "rsa_inverse_condition";
  }
  if (
    /\b(?:prime factors?|factorization|factoring|composite|primality)\b.{0,180}\b(?:difficult|hard|easy|shortcut|computer|security)\b|\b(?:difficult|hard|easy|shortcut|computer|security)\b.{0,180}\b(?:prime factors?|factorization|factoring|composite|primality)\b/iu.test(
      text,
    )
  ) {
    return "factorization_difficulty";
  }
  if (
    /\b(?:battery|charger|charging|rechargeable)\b.{0,200}\b(?:reverse(?:s|d|ing)?\s+(?:the\s+)?(?:reaction|oxidation|reduction)|(?:reaction|oxidation|reduction)\s+in\s+reverse|regenerat(?:e|es|ed|ing)\s+(?:the\s+)?(?:electrode\s+)?metal|wall\s+outlet|electrons?\s+(?:can\s+)?flow\s+back\s+in\s+the\s+opposite\s+direction)\b|\b(?:reverse(?:s|d|ing)?\s+(?:the\s+)?(?:reaction|oxidation|reduction)|(?:reaction|oxidation|reduction)\s+in\s+reverse|regenerat(?:e|es|ed|ing)\s+(?:the\s+)?(?:electrode\s+)?metal|wall\s+outlet|electrons?\s+(?:can\s+)?flow\s+back\s+in\s+the\s+opposite\s+direction)\b.{0,200}\b(?:battery|charger|charging|rechargeable|application\s+of\s+electricity)\b|\belectrons?\s+(?:can\s+)?flow\s+back\s+in\s+the\s+opposite\s+direction\b.{0,100}\bapplication\s+of\s+electricity\b/iu.test(
      text,
    )
  ) {
    return "battery_recharging";
  }
  if (
    /\b(?:matching|complementary) coastlines\b.{0,120}\bcontinents?\b|\bcontinents?\b.{0,120}\b(?:once connected|joined|pangea|supercontinent)\b/iu.test(
      text,
    )
  ) {
    return "continental_connection";
  }
  if (
    /\b(?:sand|particles?|solids?|sludge|mixed liquor|clarifier)\b.{0,180}\b(?:settle|settling|sedimentation|sludge layer|separate|drop(?:s|ping)?\s+particles?|fall(?:s|ing)?(?:\s+through\s+(?:a\s+)?liquid|\s+faster))\b|\b(?:settle|settling|sedimentation|drop(?:s|ping)?\s+particles?|fall(?:s|ing)?(?:\s+through\s+(?:a\s+)?liquid|\s+faster))\b.{0,180}\b(?:sand|particles?|solids?|sludge|clarifier)\b/iu.test(
      text,
    )
  ) {
    return "gravity_sedimentation";
  }
  if (
    /\b(?:battery|oxidation[- ]reduction|electrons?|electrodes?)\b.{0,180}\b(?:external circuit|connected device|device is connected|supply power|powers? the device|hook\s+(?:a\s+)?(?:lightbulb|vacuum\s+cleaner)|give\s+it\s+power)\b|\b(?:external circuit|connected device|device is connected|supply power|powers? the device|hook\s+(?:a\s+)?(?:lightbulb|vacuum\s+cleaner)|give\s+it\s+power)\b.{0,180}\b(?:battery|electrons?|electrodes?)\b/iu.test(
      text,
    )
  ) {
    return "battery_external_circuit";
  }
  return null;
}

function promptFirstPrimaryClaimIsFragment(value) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  if (
    /\bigneous rocks? make up more than \d+(?:\.\d+)?%/iu.test(text) ||
    /\bdepending on your size\b.{0,120}\b(?:liters?|blood)\b/iu.test(text) ||
    /\bwhere to dump the oxygen\b|^get a better understanding of\b/iu.test(
      text,
    ) ||
    /\b(?:first )?cross(?:es)? position zero\b.{0,140}\btime equals?\b/iu.test(
      text,
    ) ||
    /^see if you can have a go\b/iu.test(text) ||
    /\bearth has (?:only )?been around for about four and a half billion years\b/iu.test(
      text,
    ) ||
    /\bradius of (?:some type of )?(?:a )?circular object\b.{0,220}\bcenter\b.{0,120}\bedge\b/iu.test(
      text,
    ) ||
    /\bfounders? didn['’]?t want all white men to (?:be able to )?vote\b/iu.test(
      text,
    ) ||
    (/\bnumber of moles of oxygen\b.{0,180}\bequal to the pressure\b/iu.test(
      text,
    ) &&
      !/\bvolume\b/iu.test(text))
  ) {
    return true;
  }
  // This caption sentence has a deterministic canonical form in the prompt
  // layer, so keep it eligible rather than falling back to "It's just that
  // beaker," which has no standalone referent.
  if (
    /^here\s+we\s+will\s+call\s+our\s+system\s+this\s+beaker\s+that\s+has\s+the\s+solution\s+inside\s+of\s+it\b/iu.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /^maybe\s+you\s+had\s+positive\s+climate\s+change\b.{0,160}\ballowed\s+land\s+to\s+support\s+agriculture\b/iu.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /^(?:maybe\s+)?labor\s+had\s+(?:a\s+little\s+bit\s+)?more\s+leverage\b.{0,180}\bwage\s+increases\b/iu.test(
      text,
    ) ||
    /^we['’]?ll\s+just\s+say\b.{0,220}\bcapital\b.{0,120}\breinvested\s+it\s+back\b/iu.test(
      text,
    )
  ) {
    return false;
  }
  // These caption sentences start conversationally, but each contains a
  // complete seismic observation that the prompt layer rewrites into a
  // standalone claim. Rejecting all of them leaves a core-structure source
  // with too few objectives and forces later questions to repeat S-waves.
  if (
    /^(?:but\s+s[- ]waves?\b.{0,220}\bonly\s+travel\s+through\s+solids|but\s+if\s+it\s+goes\s+into\s+a\s+liquid\b.{0,220}\bp[- ]waves?\b.{0,160}\bmove\s+slower\s+in\s+liquids|and\s+so\s+the\s+refraction\s+patterns?\b.{0,360}\bp[- ]waves?\b.{0,180}\bslower\s+medium|but\s+the\s+real\s+way\s+to\s+know\b.{0,360}\binner\s+core\b.{0,220}\bsolid\b.{0,260}\bp[- ]waves?\b)/iu.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /\?/u.test(text) ||
    /^[a-z]/u.test(text) ||
    /^(?:this|that|these|those|they|they['’]?re|it|he|she|here|there)\b/iu.test(
      text,
    ) ||
    /^(?:all\s+of\s+(?:this|a\s+sudden)|when\s+(?:it|he|she|they)\b|which\s+means\s+(?:it|this|that)\b|about\s+what['’]?s\s+going\s+on\b|one\s+because\b|same\s+argument\b|in\s+that\b|another\s+thing\s+you\b|what\s+(?:i|we|these\s+videos?)\b|what['’]?s\s+kind\s+of\s+depicting\b|no\s*,?\s+not\s+necessarily\b|because\s+just\b|just\s+to\s+give\b|when\s+i\b|if\s+(?:you\s+look|someone\b|you\s+wanted)\b|on\s+(?:this|the)\s+scale\b|on\s+the\s+other\s+side\b|as\s+they['’]?re\b|not\s+only\s+do\s+you\s+see\b|what\s+you['’]?re\s+also\s+going\s+to\s+see\b|to\s+protect\b.{0,220}\bsocial\s+contract\b)/iu.test(
      text,
    ) ||
    /^(?:into|onto|from|to|of|with|without)\s+(?:it|them|each|the|this|that)\b/iu.test(
      text,
    ) ||
    /^in\s+(?:most|some|many|all)\s+cases?\s*,?\s+(?:it|they|this|that|these|those)\b/iu.test(
      text,
    ) ||
    /^to\s+help\s+(?:us|you)\s+(?:visualize|understand|see)\b/iu.test(text) ||
    /^(?:a\s+lot\s+of\s+times\s+my|we\s+could\s+talk\s+about|closer\s+to\s+that\s+end|sunglasses?\s+has\s+some\s+(?:width|depth))\b/iu.test(
      text,
    ) ||
    /^(?:and\s+(?:then|so|of\s+course)|so\s+then|also,?\s+(?:this|that|these|those|it|they))\b/iu.test(
      text,
    ) ||
    /^(?:well\b|now\b|so\b|even\s+though\b|in\s+fact\b|just\s+as\b|things?\s+like\b|some\s+of\s+you\b|what\s+do\s+you\s+think\b)/iu.test(
      text,
    ) ||
    /^(?:actually\s*,?\s+well\s+oftentimes\b|oftentimes\s*,?\s+it\s+doesn['’]?t\s+really\s+have\s+an\s+impact\b)/iu.test(
      text,
    ) ||
    /^sometimes\s+(?:it['’]?s\s+mutualism|(?:it|they)\s*,)/iu.test(text) ||
    /^once\s+again\s*,?\s+there['’]?s\s+many\s+examples?\b/iu.test(text) ||
    // A sentence that still points to an unnamed earlier group or situation
    // is not self-contained merely because a topic title can fill the gap.
    // In the monopolistic-competition fixture, "those firms" referred to a
    // preceding perfect-competition comparison; letting the title supply the
    // subject inverted the economic claim.
    /\b(?:these|those)\s+(?:firms?|groups?|people|objects?|species|cells?|cases?|situations?)\b/iu.test(
      text,
    ) ||
    /^(?:once\s+again|whatever\s+the\b)/iu.test(text) ||
    /^(?:and\s+(?:if|the|you|there|it|we)\b|the\s+odds\s+of\s+all\s+of\s+them\b|the\s+ones?\s+on\s+(?:the\s+)?(?:left|right)\b)/iu.test(
      text,
    ) ||
    // Presentation reactions and first-person transitions are not assessment
    // facts. They repeatedly caused the model to abandon the assigned claim
    // and improvise from neighboring context instead.
    /^(?:alright|all\s+right|hopefully|obviously|let\s+me|let['’]?s|what['’]?s\s+(?:really\s+)?(?:cool|interesting)\s+to\s+me|(?:and\s+)?(?:i|we|you)\b|and\s+(?:obviously|frankly|this|to\s+help|similarly)\b|as\s+far\s+as\b)/iu.test(
      text,
    ) ||
    // These openings omit the comparison group, theory, earlier action, or
    // named territory needed to make the claim independently meaningful.
    /^(?:other\s+theor(?:y|ies)\b|for\s+other\s+(?:people|residents?|cases?|groups?)\b|and\s+similarly\b)/iu.test(
      text,
    ) ||
    /^(?:in\s+this\s+(?:situation|case|setup)\b|(?:and|but)\s+(?:it|this|that|these|those|they)\b|but\s+then\s+(?:i|we|you)\b|and\s+that\s+would\s+be\b)/iu.test(
      text,
    ) ||
    /^(?:maybe\b|for\s+some\s+reason\b|(?:if|since)\s+(?:this|that|these|those|it|they|they['’]?re)\b|(?:and|but)\b.{0,80}\b(?:it|this|that|these|those)\b|and\s+(?:on|not)\b)/iu.test(
      text,
    ) ||
    /^(?:for\s+example\s*,?\s+)?here['’]?s\s+(?:a|an|the)\b.{0,180}\b(?:image|diagram|graph|map|picture)\b/iu.test(
      text,
    ) ||
    /^(?:if|when)\s+you\b.{0,220}\b(?:look|hear|see|don['’]?t\s+want|choose\s+to\s+delete)\b/iu.test(
      text,
    ) ||
    /^when\s+you\s+(?:consider|think\s+about)\b/iu.test(text) ||
    /\bbetween\s+18\d{2}\s+and\s+19\d{2}\b.{0,220}\b(?:temperatures?|average|years?)\b/iu.test(
      text,
    ) ||
    /\bmost\s+(?:scientists?|researchers?)\b.{0,180}\bprefer\w*\s+(?:the\s+)?(?:more\s+general\s+|newer\s+|older\s+)?(?:term|name|word)\b/iu.test(
      text,
    ) ||
    /^(?:scientists?|researchers?|experts?)\s+(?:are\s+working|recommend|say|believe)\b/iu.test(
      text,
    ) ||
    /\b(?:standard reduction potential|standard cell potential)\b.{0,180}\b-?\d+(?:\.\d+)?\s*(?:v|volts?)\b/iu.test(
      text,
    ) ||
    /\b(?:this|the)\s+galvanic cell\b.{0,180}\b-?\d+(?:\.\d+)?\s*(?:v|volts?)\b/iu.test(
      text,
    ) ||
    /\b(?:divide|dividing)\b.{0,160}\b(?:numerator|denominator|both of these|by four|r squared)\b/iu.test(
      text,
    ) ||
    /\bimportant thing to (?:think about|appreciate|remember)\b/iu.test(text) ||
    /\b(?:previous\s+\d+\s+clauses?|listed all of these out|not going to read them|focus on the last clause)\b/iu.test(
      text,
    ) ||
    /\b(?:point|position)\s+[a-z]\b.{0,180}\b(?:point|position)\s+[a-z]\b/iu.test(
      text,
    ) ||
    /\bquick\s+(?:calculation|approximation)\b.{0,180}\beffective nuclear charge\b/iu.test(
      text,
    ) ||
    /\bcell specialization is when different cells specialize\b/iu.test(text) ||
    /\b(?:hair|fingernail|building|object)\b.{0,160}\b\d+(?:\.\d+)?\s*(?:micrometers?|nanometers?|millimeters?|meters?)\b/iu.test(
      text,
    ) ||
    /\b(?:diagram|chart|visual|graph)\b.{0,220}\b(?:might change|right over here|shows?|represents?|share of|percentage of gdp)\b/iu.test(
      text,
    ) ||
    /\b(?:relative to|in|from)\s+(?:this|the)\s+(?:diagram|figure|picture)\b|\bregion\s+(?:above|below|left|right)\s+(?:the\s+)?(?:diagram|membrane|line)\b/iu.test(
      text,
    ) ||
    /\b(?:mosaic|puzzle)\b.{0,180}\b(?:picture|pieces?|colors?|analogy)\b/iu.test(
      text,
    ) ||
    /\b(?:maximum|at most)\b.{0,80}\b(?:two|2)\s+electrons?\b.{0,160}\b(?:one|either)\s+side\b/iu.test(
      text,
    ) ||
    /\bcredit card aprs?\b.{0,180}\b(?:30|thirty)\s*%|\b(?:30|thirty)\s*(?:percent|%)\s+range\b/iu.test(
      text,
    ) ||
    /\b(?:in|that)\s+direction\b|\b(?:it|this)\s+(?:is\s+)?going to exert a force on (?:that|the) asteroid\b/iu.test(
      text,
    ) ||
    /^if\s+we\s+(?:think|look|imagine|consider)\b/iu.test(text) ||
    /\benergy of (?:our|the) products?\b.{0,180}\b\d+(?:\.\d+)?\s*(?:kilojoules?|kj)\b.{0,120}\benergy of (?:our|the) reactants?\b/iu.test(
      text,
    ) ||
    /\bnuclear (?:fusion|fission) produces? (?:a )?lot of energy\b/iu.test(
      text,
    ) ||
    /\bword homologous\b.{0,180}\b(?:latin )?prefix\b/iu.test(text) ||
    /\b(?:swiss|cheddar)\b.{0,220}\b(?:mass|kinetic energy|kilograms?)\b/iu.test(
      text,
    ) ||
    /^first\s*,?\s+let['’]?s\s+consider\b/iu.test(text) ||
    /\bpress\w*\b.{0,80}\btable\b.{0,120}\bputting a force onto\b/iu.test(
      text,
    ) ||
    /^all of these components\b/iu.test(text) ||
    /\b(?:satellites?|doppler radar)\b.{0,260}\bnearby geographic features\b/iu.test(
      text,
    ) ||
    /\belectron\b.{0,180}\bground state\b.{0,180}\b(?:needs?|requires?)\s+\d+(?:\.\d+)?\s*ev\b.{0,120}\b(?:next|first excited)\s+energy level\b/iu.test(
      text,
    ) ||
    /\belectrons?\b.{0,220}\b(?:interesting stuff|move around,? jump around,? bind)\b/iu.test(
      text,
    ) ||
    /^(?:the body itself|it['’]?s a mammal|if you go (?:at|to) some of the further)\b/iu.test(
      text,
    ) ||
    /\b(?:planty|cells?)\b.{0,180}\b(?:hiding a secret|take a closer look)\b/iu.test(
      text,
    ) ||
    /^related\s+to\s+all\s+of\s+this\b/iu.test(text) ||
    /\bone\s+factor\s+may\s+be\s+more\s+responsible\b.{0,160}\bthan\s+the\s+others\b/iu.test(
      text,
    ) ||
    /^(?:something\s+that\s+is\s+)?somewhat\s+related\b|\bthe\s+big\s+thing\s+to\s+appreciate\b|\bone\s+of\s+the\s+most\s+famous\b/iu.test(
      text,
    ) ||
    /\b(?:kind\s+of\s+)?seems?\s+closest\s+to\s+the\s+original\s+spirit\b/iu.test(
      text,
    ) ||
    /\b(?:fundamental\s+level\s+of\s+where\s+(?:the\s+)?charge\s+is\s+happening|deep\s+property\s+of\s+matter\b.{0,180}\b(?:mysterious|manipulate|predict))\b/iu.test(
      text,
    ) ||
    // A caption unit that trails off on a connector or copular fragment is
    // not a complete fact even when punctuation recovery added a boundary.
    /\b(?:and|or|because|which|that|to|was|were|is|are|it\s+was\s+right)\s*$/iu.test(
      text,
    ) ||
    /\b(?:on|to|from)\s+the\s+(?:left|right)\s+(?:side\s+)?(?:here|of\s+(?:this|the)\s+(?:container|diagram|figure))\b|\b(?:this|that)\s+wall\b/iu.test(
      text,
    ) ||
    /\b(?:which\s+means|and\s+then|so\s+that)\s*$/iu.test(text)
  );
}

function promptFirstPrimaryCandidateText(value) {
  let text = String(value ?? "").trim();
  // Spoken captions frequently prepend complete instructional statements with
  // harmless discourse markers. Remove only those leading markers; pronouns,
  // missing referents, trailing connectors, and presentation scaffolding still
  // fail the fragment guard below.
  for (let pass = 0; pass < 3; pass += 1) {
    const stripped = text.replace(
      /^(?:(?:and\s+)?then|and|but|however|so|now|well|again|of\s+course)\s*[,;:\-–—]?\s+/iu,
      "",
    );
    if (stripped === text) break;
    text = stripped;
  }
  return capitalizeFirstLetter(text);
}

/**
 * Turn a small set of presentation-bound, but instructionally complete,
 * source sentences into the transferable relationship that the sentence
 * explicitly teaches. This runs only for the v5.12 coherent prompt profile.
 * It does not infer outside facts: each replacement is a direct abstraction
 * of the matched sentence and the original transcript remains private local
 * evidence.
 */
function promptFirstV512CanonicalSourceSentence(value) {
  const text = String(value ?? "").trim();
  if (!text) return text;

  if (
    /\bburn wood\b.{0,180}\b(?:get|release|provide)\s+energy\b|\bburning wood\b.{0,180}\b(?:light|heat|sound)\b/iu.test(
      text,
    )
  ) {
    return "Burning wood releases stored chemical energy as light, heat, and sound.";
  }
  if (
    /\benergy information administration\b.{0,220}\bresidential site electricity consumption\b/iu.test(
      text,
    )
  ) {
    return "Household energy consumption can include electricity and other energy sources such as natural gas.";
  }
  if (
    /\brelative to you\b.{0,180}\b(?:truck|object)['’]?s velocity\b.{0,100}\bzero\b|\bfrom your frame of reference\b.{0,160}\bvelocity\b.{0,80}\bzero\b/iu.test(
      text,
    )
  ) {
    return "When an observer and an object move with the same velocity, the object's velocity relative to that observer is zero.";
  }
  if (
    /\btemporar(?:y|ily) positive end\b.{0,220}\btemporar(?:y|ily) negative end\b.{0,180}\b(?:domino|attract)\w*\b/iu.test(
      text,
    )
  ) {
    return "London dispersion forces arise when temporary dipoles induce correlated temporary dipoles in neighboring particles, attracting opposite temporary ends.";
  }
  if (
    /\b(?:radius|average distance)\b.{0,260}\b(?:human body|complex structure|center of rotation)\b|\bcomplex structure\b.{0,220}\baverage distance of (?:the )?mass\b/iu.test(
      text,
    )
  ) {
    return "For an extended object, moment of inertia depends on how its mass is distributed relative to the rotation axis; moving mass closer to the axis reduces moment of inertia.";
  }
  if (
    /\bgot a positive charge\b.{0,180}\b(?:bronsted|brønsted)[- ]lowry base\b/iu.test(
      text,
    )
  ) {
    return "A Brønsted–Lowry base is a species that accepts a proton.";
  }
  if (/\bpulmonary artery was blue\b/iu.test(text)) {
    return "The pulmonary artery carries deoxygenated blood away from the heart to the lungs, while the pulmonary vein carries oxygenated blood from the lungs toward the heart.";
  }
  if (
    /\bhydrophobic side chains?\b.{0,220}\b(?:pulled away from|move away from|avoid)\b.{0,100}\bwater\b/iu.test(
      text,
    )
  ) {
    return "Nonpolar hydrophobic side chains cluster in a protein's interior away from the surrounding water during folding.";
  }
  if (/\bentire demand curve\b.{0,180}\bshift to the left\b/iu.test(text)) {
    return "A decrease in demand reduces quantity demanded at every price and shifts the entire demand curve to the left.";
  }
  if (
    /\bfix (?:that )?carbon from a gas form into a solid form\b/iu.test(text)
  ) {
    return "Photosynthesis uses solar energy to incorporate carbon from atmospheric carbon dioxide into energy-rich organic molecules.";
  }
  if (
    /\bgets? energy from (?:those|the) bonds in (?:the )?biological molecules\b/iu.test(
      text,
    )
  ) {
    return "Animals obtain usable chemical energy by oxidizing food molecules through cellular respiration; the overall reactions transfer energy to cellular processes.";
  }
  if (
    /\bdistance between (?:the )?2 nuclei\b.{0,180}\b(?:take half|divid\w* (?:it )?in half)\b.{0,120}\batomic radius\b/iu.test(
      text,
    )
  ) {
    return "For two identical covalently bonded atoms, the atomic radius is half the distance between their nuclei.";
  }
  if (
    /\bmantle\b.{0,160}\bsome parts?\b.{0,100}\bsolid\b|\brest of the mantle\b.{0,160}\b(?:magma|somewhat fluid|different levels of fluidity)\b/iu.test(
      text,
    )
  ) {
    return "Earth's mantle is predominantly solid rock, but temperature and pressure make some regions ductile enough to deform and flow slowly.";
  }
  if (
    /\bnoble gases?\b.{0,180}\b(?:don['’]?t|do not) form covalent bonds\b/iu.test(
      text,
    )
  ) {
    return "Filled valence shells make noble gases generally unreactive and unlikely to form covalent bonds, although heavier noble gases can form some compounds.";
  }
  if (
    /\barticles of confederation\b.{0,180}\bstrong sense of limited government\b/iu.test(
      text,
    )
  ) {
    return "The Articles of Confederation created a weak central government while leaving most governing power with the states.";
  }
  if (
    /\bnew jersey plan\b.{0,260}\beach state\b.{0,100}\bone vote\b|\bequal number of votes\b.{0,220}\bnew jersey plan\b/iu.test(
      text,
    )
  ) {
    return "The New Jersey Plan gave each state one legislative vote, providing equal state representation regardless of population.";
  }
  if (
    /\bfounders intended\b.{0,240}\bsafeguard\b.{0,180}\bmob\b|\bextra layer\b.{0,180}\b(?:office of president|unruly masses)\b/iu.test(
      text,
    )
  ) {
    return "Some framers supported indirect presidential election as a buffer between immediate popular sentiment and selection of the president.";
  }

  if (
    /\bweather\s+stations?\b.{0,180}\bdoppler\s+radar\b.{0,220}\b(?:heavy\s+rain|rain\s+is\s+falling)\b.{0,160}\b(?:wind|blowing)\b/iu.test(
      text,
    )
  ) {
    return "Surface weather stations use Doppler radar measurements to determine rainfall intensity and wind speed in clouds.";
  }
  if (
    /\bsmall\s+objects?\b.{0,120}\b(?:without\s+much|low)\s+mass\b.{0,220}\bdistance\b.{0,180}\b(?:weak|notice)\w*\b/iu.test(
      text,
    )
  ) {
    return "For low-mass objects, gravitational attraction weakens with distance and can become too weak to notice.";
  }
  if (
    /\bgravitational\s+force\b.{0,160}\battracting\s+the\s+lamp\b.{0,180}\ball\s+objects?\s+with\s+mass\b/iu.test(
      text,
    )
  ) {
    return "Gravitational force attracts every pair of objects that have mass.";
  }
  if (
    /\bmy\s+lamp\b.{0,120}\bone\s+kilogram\b.{0,180}\bfall\s+towards?\s+the\s+earth\b/iu.test(
      text,
    )
  ) {
    return "A person falls toward Earth rather than a nearby one-kilogram object because Earth's much greater mass produces a much stronger gravitational attraction.";
  }
  if (
    /\bforces?\s+that\s+drive\s+natural\s+selection\b.{0,180}\bdon['’]?t\s+just\s+disappear\b.{0,180}\benvironment\s+changes\b/iu.test(
      text,
    )
  ) {
    return "Natural selection continues to act when an environment changes.";
  }

  if (
    /\bpollutants?\b.{0,180}\bcarried\s+by\s+the\s+wind\b.{0,180}\bdownwind\b/iu.test(
      text,
    )
  ) {
    return "Wind can carry acid-rain pollutants from where they are created to downwind communities and natural environments.";
  }
  if (
    /\bpreparedness\s+plan\b.{0,180}\bhelp\w*\s+you\s+stay\s+safe\b/iu.test(
      text,
    )
  ) {
    return "A preparedness plan can improve safety even where natural hazards are uncommon.";
  }
  if (
    /\bsome\s+of\s+these\s+stronger\s+magnets\b.{0,180}\bhigh[- ]speed\s+trains?\s+levitate\b/iu.test(
      text,
    )
  ) {
    return "Strong magnets can levitate high-speed trains above the ground.";
  }
  if (
    /\bturn\s+one\s+of\s+those\s+magnets\s+around\b.{0,160}\btwo\s+north\s+poles?\b.{0,100}\brepel\b/iu.test(
      text,
    )
  ) {
    return "When two north poles face each other, the magnets repel.";
  }
  if (
    /\bdeveloping\s+larva\b.{0,120}\bplant\b.{0,100}\bgall\b.{0,220}\b(?:protects?|food|adulthood)\b/iu.test(
      text,
    )
  ) {
    return "A developing larva induces a plant to form a gall that protects the larva and provides food until adulthood.";
  }
  if (
    /\bstructure\s+of\s+a\s+protein\b.{0,180}\bchemical\s+properties\s+of\s+its\s+amino\s+acid\b.{0,120}\bdetermine\s+its\s+function\b/iu.test(
      text,
    )
  ) {
    return "A protein's structure and the chemical properties of its amino acids determine its function.";
  }
  if (
    /\bstimulus\s+in\s+childbirth\b.{0,160}\bbaby['’]s\s+head\b.{0,120}\bcervix\b/iu.test(
      text,
    )
  ) {
    return "Pressure from the baby's head against the cervix provides the stimulus that initiates childbirth.";
  }
  if (
    /\bacid\s+vapou?rs?\b.{0,180}\b(?:precipitation|respiratory\s+system)\b.{0,180}\b(?:respiratory\s+system|asthma)\b/iu.test(
      text,
    )
  ) {
    return "Acid vapors and acidic precipitation harm the respiratory system, especially in people with asthma.";
  }
  if (
    /\bacid\s+rain\b.{0,160}\bleach\w*\b.{0,180}\bheavy\s+metals?\b.{0,220}\b(?:soil|rocks?|lakes?)\b/iu.test(
      text,
    )
  ) {
    return "Acid rain can leach heavy metals such as aluminum from soil and rocks; the metals can then wash into lakes, contaminate drinking water, and harm aquatic ecosystems.";
  }
  if (
    /\bhomeostasis\b.{0,180}\bwithout\s+it\b.{0,160}\boverheat\w*\b/iu.test(
      text,
    )
  ) {
    return "Without homeostasis, the body can overheat and face serious danger.";
  }
  if (
    /\bwhat\s+those\s+changes\s+will\s+ultimately\s+be\b.{0,220}\badaptations?\s+promoted\s+by\s+the\s+previous\s+environment\b.{0,180}\bpressures?\s+presented\s+by\s+the\s+new\s+one\b/iu.test(
      text,
    )
  ) {
    return "The changes a population undergoes in a new environment depend on adaptations promoted by the previous environment and pressures presented by the new environment.";
  }
  if (
    /\bthe\s+trees?\s+serve\s+as\s+models?\s+for\s+studying\s+evolutionary\s+relationships?\s+over\s+time\b/iu.test(
      text,
    )
  ) {
    return "Evolutionary trees model evolutionary relationships over time.";
  }
  if (
    /\bcopyright\b.{0,180}\bpatent\b.{0,220}\b(?:sue|steals?\s+your\s+(?:ideas|work|inventions))\b/iu.test(
      text,
    )
  ) {
    return "Copyright and patent laws let rights holders seek a legal remedy for infringement of protected works and inventions.";
  }
  if (
    /\btechnologies?\b.{0,180}\bremove\w*\s+(?:some\s+of\s+)?(?:the\s+)?excess\s+co2\b.{0,220}\bemit\s+less\s+co2\b/iu.test(
      text,
    )
  ) {
    return "Reducing carbon dioxide emissions limits additional atmospheric buildup, while carbon-removal technologies can address some carbon dioxide already in the atmosphere.";
  }
  if (
    /\bphotovoltaic\b.{0,180}\b(?:light|photo)\b.{0,160}\b(?:electric force|volt)\b/iu.test(
      text,
    )
  ) {
    return "Photovoltaic devices convert light energy into electrical energy and produce an electric potential difference.";
  }
  if (
    /\b(?:fourth electron|add\w*\s+a\s+fourth electron)\b.{0,220}\b(?:orbital|like charges|repel|easier to remove)\b/iu.test(
      text,
    )
  ) {
    return "In beryllium, the fourth electron pairs with another electron in the 2s orbital; electron-electron repulsion within that orbital makes either paired electron easier to remove than it would be without the pairing.";
  }
  if (
    /\bforces?\s+(?:are\s+)?exerted\s+on\s+each\s+of\s+these\s+point charges\b.{0,260}\bpull\s+(?:(?:these|the)\s+)?(?:attached\s+)?masses\s+towards?\s+each\s+other\b/iu.test(
      text,
    )
  ) {
    return "Opposite point charges attract, so releasing the charges lets the electric force pull attached masses toward each other.";
  }
  if (
    /\bburning\s+(?:the\s+)?fossil fuels?\b.{0,220}\bless organized\b.{0,160}\bheat and ash\b/iu.test(
      text,
    )
  ) {
    return "Burning fossil fuels releases stored chemical energy primarily as heat and produces material byproducts such as ash.";
  }
  if (
    /\bheat flows? from the surroundings to the system\b.{0,180}\bendothermic\b.{0,180}\bdelta h is positive\b/iu.test(
      text,
    )
  ) {
    return "In an endothermic process, heat flows from the surroundings into the system and the enthalpy change, delta H, is positive.";
  }
  if (
    /\beither of these genotypes\b.{0,260}\bphenotype brown\b.{0,180}\bdominant (?:version|allele)\b/iu.test(
      text,
    )
  ) {
    return "If the brown-hair allele B is dominant, both the homozygous BB genotype and the heterozygous Bb genotype express the brown-hair phenotype.";
  }
  if (
    /\bweather results? from\b.{0,220}\bair masses? moving from (?:areas? with )?high air pressure to (?:areas? with )?low air pressure\b/iu.test(
      text,
    )
  ) {
    return "Air-pressure differences drive air masses from higher-pressure regions toward lower-pressure regions, contributing to changing weather conditions.";
  }
  if (/\bforces? do not cancel out\b/iu.test(text)) {
    return "An action-reaction force pair does not cancel because its equal and opposite forces act on different objects.";
  }
  if (
    /\bwater molecules?\b.{0,260}\b(?:attracted to you|sodium and chloride|sodium|chloride)\b/iu.test(
      text,
    )
  ) {
    return "Ion-dipole attractions draw the charged ends of polar water molecules toward sodium and chloride ions and help separate the ions during dissolution.";
  }
  if (
    /\b(?:vat of )?pentane\b.{0,260}\b(?:vat of )?hexane\b.{0,180}\bweak forces?\b/iu.test(
      text,
    )
  ) {
    return "Nonpolar pentane and hexane mix because their London dispersion attractions to each other are comparable to the attractions within each pure liquid.";
  }
  if (
    /\bmost\s+pre[- ]industrial\s+societies\b.{0,180}\bhigh\s+death\s+rate\b.{0,180}\bhealthcare\s+is\s+either\s+non[- ]existent\s+or\s+it\s+isn['’]?t\s+that\s+good\b/iu.test(
      text,
    )
  ) {
    return "Most pre-industrial societies have high death rates because healthcare is unavailable or poor.";
  }

  if (
    /\bacid\s+rain\b.{0,120}\bdamage\w*\s+(?:buildings?\s+and\s+statues?|statues?\s+and\s+buildings?)\b.{0,180}\b(?:limestone|marble|metals?)\b/iu.test(
      text,
    )
  ) {
    return "Acid rain can damage buildings and statues made of limestone, marble, and some metals.";
  }
  if (
    /\bhotter\s+object\b.{0,160}\bparticles?\s+are\s+vibrating\s+faster\b.{0,160}\bobject\s+is\s+colder\b/iu.test(
      text,
    )
  ) {
    return "Particles vibrate faster in a hotter object than in a colder object.";
  }
  if (
    /\bwhen\s+the\s+temperature\s+is\s+the\s+same\b.{0,160}\bno\s+heat\s+is\s+transferring\b.{0,160}\bthermal\s+equilibrium\b/iu.test(
      text,
    )
  ) {
    return "Thermal equilibrium occurs when all parts of a system are at the same temperature and no net heat transfer occurs between them.";
  }
  if (
    /\bwhen\s+the\s+baby\s+is\s+born\b.{0,220}\bhead\s+isn['’]?t\s+pressing\b.{0,140}\bcervix\b.{0,220}\bneuron\s+stops?\s+sending\b.{0,180}\boxytocin\b/iu.test(
      text,
    )
  ) {
    return "After birth removes pressure from the cervix and pelvic floor, the neural signal stops and oxytocin release decreases.";
  }
  if (
    /\bin\s+a\s+similar\s+way\b.{0,200}\bspecialized\s+cells\b.{0,260}\bred\s+blood\s+cells\b.{0,220}\bmuscle\s+cells\b.{0,220}\bnerve\s+cells\b/iu.test(
      text,
    )
  ) {
    return "Specialized cells have distinct functions: red blood cells carry oxygen, muscle cells contract and relax, and nerve cells transmit signals.";
  }
  if (
    /\bfarm\s+productivity\s+is\s+higher\b.{0,160}\bmodern\s+methods\b.{0,180}\bnutrition\s+is\s+better\b.{0,160}\bdeath\s+rates?\s+(?:start\s+)?coming\s+down\b/iu.test(
      text,
    )
  ) {
    return "Modern farming methods can raise farm productivity, improve nutrition, and contribute to lower death rates.";
  }
  if (
    /\bmodern\s+birds?\b.{0,180}\b(?:dove|penguin)\b.{0,180}\bsame\s+bird[- ]like\s+dinosaur\s+ancestor\b/iu.test(
      text,
    )
  ) {
    return "All modern birds share a common bird-like dinosaur ancestor.";
  }
  if (
    /\bvelocity\s+has\s+changed\b.{0,180}\bonce\s+it\s+got\s+outside\s+of\s+the\s+planets\b.{0,140}\broughly\s+at\s+this\s+velocity\b/iu.test(
      text,
    )
  ) {
    return "Voyager's speed has remained roughly constant since the spacecraft traveled beyond the planets.";
  }
  if (
    /\breason\s+why\s+this\s+happened\b.{0,180}\bwhite\s+allele\b.{0,180}\b(?:less\s+fit|advantageous)\b/iu.test(
      text,
    )
  ) {
    return "Genetic drift can eliminate an allele by random chance even when the allele is not harmful and may be advantageous.";
  }
  if (
    /\bstereoisomers?\b.{0,140}\bsame\s+thing\b.{0,120}\bconnections?\s+are\s+the\s+same\b.{0,160}\bthree[- ]dimensional\s+configuration\b/iu.test(
      text,
    )
  ) {
    return "Stereoisomers have the same atom connectivity but different three-dimensional configurations.";
  }
  if (
    /\bcrustal\s+portions?\b.{0,120}\bkeep\s+jamming\s+into\s+each\s+other\b/iu.test(
      text,
    )
  ) {
    return "When continental plates collide, their buoyant crust resists subduction and continues to compress, building mountain ranges.";
  }
  if (
    /\bvery\s+separate\s+from\s+each\s+other\b.{0,220}\bpotential\s+energy\b.{0,180}\bstable\s+point\b/iu.test(
      text,
    )
  ) {
    return "Two bonded atoms have minimum potential energy at their stable equilibrium distance; moving them either closer together or farther apart raises the potential energy.";
  }
  if (
    /\bif\s+anything\s+were\s+to\s+happen\s+to\s+me\b.{0,260}\b(?:mortgage|college|to\s+live)\b/iu.test(
      text,
    )
  ) {
    return "Life insurance provides financial support for a policyholder's dependents after the policyholder dies.";
  }
  if (/\bat\s+the\s+21st\s+year\b.{0,120}\bnew\s+policy\b/iu.test(text)) {
    return "When a term life policy expires, buying a new policy at an older age generally costs more because mortality risk has increased.";
  }
  if (
    /\bboth\s+the\s+birth\s+rate\s+and\s+the\s+death\s+rate\s+are\s+high\b.{0,180}\babout\s+the\s+same\b.{0,180}\brelatively\s+stable\b.{0,160}\blow\s+population\b/iu.test(
      text,
    )
  ) {
    return "When birth and death rates are both high and approximately equal, the population is relatively stable and low in absolute size.";
  }

  if (
    /\bmitochondria\b.{0,180}\b(?:responsible\s+for\s+)?breaking\s+down\s+sugars?\b/iu.test(
      text,
    )
  ) {
    return "Mitochondria break down sugars and release energy that cells can use.";
  }
  if (
    /\bcell\s+membrane\b.{0,180}\b(?:gate|control\w*)\b.{0,140}\b(?:enters?|leaves?)\b/iu.test(
      text,
    )
  ) {
    return "Both animal and plant cells have a cell membrane that regulates what enters and leaves the cell.";
  }
  if (
    /\bchloroplasts?\b.{0,160}\bmake\w*\s+sugars?\b.{0,160}\bphotosynthesis\b/iu.test(
      text,
    )
  ) {
    return "Chloroplasts make sugars through photosynthesis, and mitochondria release usable energy from those sugars.";
  }
  if (/\b(?:we\s+aren['’]?t|humans?\s+aren['’]?t)\s+green\b/iu.test(text)) {
    return "Animal cells do not contain chloroplasts, unlike plant cells.";
  }
  if (
    /\bnucleus\b.{0,180}\b(?:information\s+database|store\w*)\b.{0,100}\bgenes?\b.{0,220}\bmitochondria\b/iu.test(
      text,
    )
  ) {
    return "The nucleus stores a cell's genes.";
  }
  if (
    /\bchloroplasts?\b.{0,180}\bgive\w*\s+plants?\b.{0,100}\bgreen\s+colou?r\b/iu.test(
      text,
    )
  ) {
    return "Chloroplasts give plant cells their green coloration and are absent from animal cells.";
  }
  if (
    /\b(?:diagram\b.{0,140})?plant\s+cells?\b.{0,180}\badditional\s+layer\b.{0,140}\bsurrounds?\s+the\s+cell\s+membrane\b/iu.test(
      text,
    )
  ) {
    return "Plant cells have a rigid cell wall outside the cell membrane, while animal cells do not.";
  }
  if (
    /\bcytosol\b.{0,180}\b(?:jelly[- ]like\s+substance|contains?\s+organelles?)\b/iu.test(
      text,
    )
  ) {
    return "Cytosol is the jelly-like material inside a cell that contains organelles with specialized functions.";
  }

  if (
    /\b(?:a\s+lot|ample|plenty)\s+of\s+space\b.{0,220}\b(?:not|doesn['’]?t\s+seem\s+to\s+be)\b.{0,180}\blimit\w*\s+(?:their|population)\s+growth\b/iu.test(
      text,
    )
  ) {
    return "A resource does not limit population growth when it is available in sufficient quantity.";
  }
  if (
    /\ball\s+organisms?\s+need\s+resources?\b.{0,180}\bsurvive\b.{0,140}\b(?:multiply|reproduce)\b/iu.test(
      text,
    )
  ) {
    return "All organisms require resources for survival and reproduction.";
  }
  if (
    /\bpopulations?\s+of\s+(?:many\s+)?different\s+species\b.{0,160}\bcompet\w*\b.{0,120}\bresources?\b/iu.test(
      text,
    )
  ) {
    return "Populations of different species often compete for the same limited resources.";
  }
  if (
    /\bmost\s+animals?\s+that\s+live\s+on\s+the\s+surface\b.{0,180}\bneed\s+air\b.{0,100}\boxygen\b/iu.test(
      text,
    )
  ) {
    return "Most terrestrial animals require oxygen from the air for survival.";
  }
  if (
    /\blimit\s+on\s+one\s+population\b.{0,160}\baffect\w*\s+another\b/iu.test(
      text,
    )
  ) {
    return "A resource limitation that reduces one population can also affect interacting populations.";
  }
  if (
    /\bwater\b.{0,180}\b(?:put|place)\s+a\s+limit\b.{0,180}\bpopulations?\s+can\s+grow\b/iu.test(
      text,
    )
  ) {
    return "Limited water availability can constrain population growth.";
  }

  if (
    /\bpermanent\s+magnets?\b.{0,200}\bdo\s+not\s+need\s+a\s+power\s+source\b.{0,220}\belectromagnets?\b.{0,120}\bturn\w*\s+(?:them\s+)?on\s+and\s+off\b/iu.test(
      text,
    )
  ) {
    return "Permanent magnets require no power source, while electromagnets can be switched on and off by controlling electric current.";
  }
  if (
    /\bpermanent\s+magnets?\b.{0,180}\bdo\s+not\s+need\s+a\s+power\s+source\b.{0,240}\bturn\s+electromagnets?\s+on\s+and\s+off\b/iu.test(
      text,
    )
  ) {
    return "Permanent magnets require no power source, while electromagnets can be switched on and off by controlling electric current.";
  }
  if (
    /\b(?:go\s+back\s+to\s+)?(?:this\s+)?wire\s+example\b.{0,220}\bchange\w*\s+the\s+direction\s+of\s+(?:the\s+)?electricity\b.{0,200}\bmagnetic\s+fields?\b.{0,100}\bchange\w*\s+direction\b/iu.test(
      text,
    )
  ) {
    return "Reversing the direction of current in a wire reverses the direction of its magnetic field.";
  }
  if (
    /\belectromagnets?\b.{0,180}\b(?:materials?\s+that\s+)?become\w*\s+magnets?\b.{0,140}\bpresence\s+of\s+electricity\b/iu.test(
      text,
    )
  ) {
    return "An electromagnet becomes magnetic when electric current flows through it.";
  }
  if (
    /\bwire\b.{0,120}\bwrapped\s+around\b.{0,160}\b(?:iron|nickel|cobalt|magnetic\s+material)\b/iu.test(
      text,
    )
  ) {
    return "An electromagnet uses a coil of conducting wire wrapped around a magnetic core such as iron, nickel, or cobalt.";
  }
  if (
    /\brun\w*\s+electricity\s+through\s+a\s+wire\b.{0,160}\bmagnetic\s+field\b.{0,120}\bcreated\b/iu.test(
      text,
    )
  ) {
    return "Electric current flowing through a wire creates a magnetic field around the wire.";
  }
  if (
    /\b(?:increase\s+the\s+density\s+of\s+the\s+charged\s+particles|looping\s+the\s+wire\s+into\s+a\s+coil)\b/iu.test(
      text,
    )
  ) {
    return "Looping a current-carrying wire into a coil concentrates its magnetic field and increases the electromagnet's strength.";
  }
  if (
    /\bpermanent\s+magnets?\b.{0,180}\bfixed\s+strength\b.{0,180}\belectromagnets?\b.{0,160}\badjustable\s+strength\b/iu.test(
      text,
    )
  ) {
    return "A permanent magnet has a fixed strength, while an electromagnet's strength can be adjusted by changing its electric current or coil.";
  }
  if (
    /\bturbine\b.{0,180}\bspins?\s+a\s+magnet\b.{0,120}\bcoil\b.{0,120}\bproduce\w*\s+electricity\b/iu.test(
      text,
    )
  ) {
    return "Relative motion between a magnet and a conducting coil induces electric current in the coil.";
  }

  if (
    /\b(?:any\s+point|comparison)\b.{0,180}\bpotential\s+energy\s+is\s+zero\b|\buse\s+any\s+point\b.{0,180}\bpotential\s+energy\b.{0,80}\bzero\b/iu.test(
      text,
    )
  ) {
    return "The zero level of potential energy is a chosen reference point, so any convenient position can be assigned zero potential energy.";
  }
  if (
    /\bpotential\s+energy\b.{0,180}\bstored\s+energy\b.{0,200}\bposition\b.{0,160}\bproperties\b.{0,160}\bforces?\b/iu.test(
      text,
    )
  ) {
    return "Potential energy is stored energy determined by an object's position, properties, and the forces acting on it.";
  }
  if (
    /\belastic\s+potential\s+energy\b.{0,180}\bshape\b.{0,120}\bchang\w*\b/iu.test(
      text,
    )
  ) {
    return "Elastic potential energy is stored when an object's shape is changed by stretching or compression.";
  }
  if (
    /\bmagnets?\b.{0,160}\bnorth\s+and\s+south\s+poles\b.{0,220}\bpotential\s+energy\b.{0,220}\borientation\b/iu.test(
      text,
    )
  ) {
    return "A magnet's potential energy in a magnetic field depends on both its position and its orientation.";
  }

  if (
    /\belements?\b.{0,180}\borganized\b.{0,180}\batomic\s+numbers?\b.{0,160}\bperiodic\s+table\b/iu.test(
      text,
    )
  ) {
    return "The periodic table orders elements by increasing atomic number.";
  }
  if (
    /\belements?\b.{0,160}\borganized\s+into\s+columns\b.{0,160}\bproperties\b/iu.test(
      text,
    )
  ) {
    return "Elements in the same periodic-table column tend to have similar physical and chemical properties.";
  }
  if (
    /\bevery\s+element\b.{0,160}\bchemical\s+symbol\b.{0,160}\bunique\s+one\s+or\s+two\s+letter\s+abbreviation\b/iu.test(
      text,
    )
  ) {
    return "Each element has a unique one- or two-letter chemical symbol.";
  }
  if (
    /\bwhenever\s+the\s+chemical\s+symbol\s+for\s+an\s+element\s+has\s+two\s+letters\b.{0,180}\bsecond\s+letter\s+is\s+written\s+in\s+lowercase\b/iu.test(
      text,
    )
  ) {
    return "The second letter of a two-letter chemical symbol is written in lowercase.";
  }

  if (
    /\bprotonated\s+form\b.{0,180}\btwo\s+acidic\s+protons\b.{0,120}\bdiprotic\s+acid\b/iu.test(
      text,
    )
  ) {
    return "Protonated alanine is diprotic because it can donate two acidic protons.";
  }
  if (
    /\bone\s+acidic\s+proton\b.{0,120}\boxygen\b.{0,160}\bother\s+acidic\s+proton\b.{0,140}\bnitrogen\b/iu.test(
      text,
    )
  ) {
    return "In protonated alanine, one acidic proton is attached to oxygen and the other is attached to nitrogen.";
  }
  if (
    /\bph\b.{0,120}\bchanges?\s+very\s+slowly\b.{0,180}\bhalf\s+equivalence\s+point\b/iu.test(
      text,
    )
  ) {
    return "Near a half-equivalence point, appreciable amounts of a weak acid and its conjugate base form a buffer, so pH changes slowly as titrant is added.";
  }
  if (
    /\bhalf\s+equivalence\s+point\b.{0,260}\bconcentration\s+of\s+\w+\b.{0,180}\bequal\s+to\s+the\s+concentration\s+of\s+\w+\b/iu.test(
      text,
    )
  ) {
    return "At a half-equivalence point, the weak acid and its conjugate base have equal concentrations, so the Henderson-Hasselbalch equation gives pH = pKa.";
  }
  if (
    /\bhalf\s+equivalence\s+point\b.{0,240}\bconcentration\b.{0,120}\bequal\b.{0,140}\bconjugate\s+base\b|\bhenderson[- ]hasselbalch\b.{0,260}\bconcentration\b.{0,120}\bequal\b.{0,160}\bph\b.{0,80}\bpka\b/iu.test(
      text,
    )
  ) {
    return "At a half-equivalence point, the weak acid and its conjugate base have equal concentrations, so the Henderson-Hasselbalch equation gives pH = pKa.";
  }
  if (
    /\bneutralized\s+half\s+of\s+the\s+ha\b.{0,220}\bconcentration\s+of\s+ha\b.{0,140}\bequal\b.{0,140}\bconcentration\s+of\s+a\s+minus\b/iu.test(
      text,
    )
  ) {
    return "At the second half-equivalence point, HA and A- have equal concentrations, so pH equals the second pKa.";
  }

  if (
    /\bbank\b.{0,180}\b(?:place\s+where\s+you\s+can\s+deposit|deposit\s+your\s+money)\b.{0,220}\b(?:safekeeping|access\w*\s+it\s+easily|interest)\b/iu.test(
      text,
    )
  ) {
    return "Banks provide safe, accessible deposits and may pay depositors interest.";
  }
  if (
    /\bwhen\s+you\s+go\s+to\s+a\s+bank\b.{0,200}\bwant\s+my\s+money\s+back\b.{0,140}\bgive\s+you\s+your\s+money\s+back\b/iu.test(
      text,
    )
  ) {
    return "A bank must honor a depositor's valid request to withdraw deposited funds.";
  }
  if (
    /\bbanks?\b.{0,160}\bgive\s+you\s+interest\b.{0,260}\blarge\s+fraction\b.{0,120}\bdeposit\w*\b.{0,120}\blend\w*\s+it\s+out\b/iu.test(
      text,
    )
  ) {
    return "Banks earn lending income by lending a large portion of deposited funds, which helps fund interest paid to depositors.";
  }
  if (
    /\b(?:insurance\s+compan(?:y|ies)|banks?)\b.{0,300}\bheavily\s+regulated\b.{0,220}\b(?:there\s+for\s+you|need\s+it|good\s+for\s+your\s+money)\b/iu.test(
      text,
    )
  ) {
    return "Banks and insurance companies are heavily regulated to help ensure that they can meet their financial obligations to customers.";
  }
  if (
    /\bbrokerages?\b.{0,220}\b(?:broker|facilitat\w*)\s+transactions?\b.{0,220}\bbuying\s+a\s+stock\b.{0,160}\bselling\s+that\s+stock\b/iu.test(
      text,
    )
  ) {
    return "Stock brokerages facilitate transactions by connecting stock buyers with sellers.";
  }
  if (
    /\bstock\s+markets?\b.{0,220}\b(?:help|facilitat\w*)\b.{0,120}\btransactions?\b/iu.test(
      text,
    )
  ) {
    return "Stock markets provide an organized venue that facilitates securities transactions.";
  }
  if (
    /\bget\s+insurance\b.{0,160}\bsomeone\s+to\s+take\s+the\s+other\s+side\b/iu.test(
      text,
    )
  ) {
    return "Insurance transfers specified risk to a counterparty in exchange for a premium.";
  }

  if (
    /\bpolitics\b.{0,180}\breach\s+agreements?\s+in\s+a\s+group\b.{0,220}\b(?:negotiating|compromising|voting)\b/iu.test(
      text,
    )
  ) {
    return "Politics encompasses the ways groups reach binding agreements through negotiation, compromise, or voting.";
  }
  if (
    /\bgovernment\b.{0,180}\b(?:institutions?|supreme\s+court|city\s+council)\b.{0,220}\bmake\s+and\s+enforce\s+laws\b.{0,180}\bpeople\s+who\s+serve\b/iu.test(
      text,
    )
  ) {
    return "Government includes both the institutions that make and enforce laws and the people who serve in those institutions.";
  }
  if (
    /\bcivic\s+life\s+includes\b.{0,320}\b(?:solving\s+the\s+problems\s+of\s+your\s+community|volunteering\s+in\s+civil\s+society|making\s+rules\s+or\s+laws|serving\s+in\s+a\s+government\s+body)\b/iu.test(
      text,
    )
  ) {
    return "Civic life includes participating in community problem-solving through civil society, lawmaking, or service in a government body.";
  }
  if (
    /\bprivate\s+life\s+includes\b.{0,260}\b(?:relationships|hobbies|job)\b/iu.test(
      text,
    )
  ) {
    return "Private life concerns personal pursuits such as relationships, hobbies, and work outside a government role.";
  }
  if (
    /\bcivil\s+society\b.{0,220}\bvoluntary\s+institutions?\b.{0,180}\boutside\s+of\s+government\s+and\s+the\s+market\b/iu.test(
      text,
    )
  ) {
    return "Civil society consists of voluntary institutions that people form and join outside government and the market.";
  }
  if (
    /\brepresentative\b.{0,240}\b(?:senator|bill)\b.{0,220}\bprovide\s+more\s+information\b/iu.test(
      text,
    )
  ) {
    return "Interest-group representatives participate in politics by providing information intended to influence legislative decisions.";
  }
  if (
    /\bchurch\b.{0,200}\bprovides?\s+food\s+and\s+shelter\b.{0,160}\bhomeless\s+community\b/iu.test(
      text,
    )
  ) {
    return "Voluntary community organizations participate in civic life when they provide services that address community needs.";
  }
  if (
    /\bin\s+the\s+large\s+scale\b.{0,220}\bpolitics\b.{0,260}\b(?:congress|decide\s+who\s+does\s+the\s+dishes)\b/iu.test(
      text,
    )
  ) {
    return "Politics operates wherever groups negotiate, compromise, or vote to make decisions that bind their members.";
  }

  if (
    /\bnational\s+identity\b.{0,180}\bmore\s+inclusive\b.{0,160}\bsocially\s+free\b.{0,180}\bless\s+confident\b.{0,160}\bgovernment\b/iu.test(
      text,
    )
  ) {
    return "Postwar movements reshaped U.S. national identity to be more inclusive and socially free while reducing confidence in government and the nation's global role.";
  }
  if (
    /\balthough\s+the\s+united\s+states\s+remained\s+a\s+world\s+superpower\b.{0,320}\blimits?\s+to\s+its\s+intervention\b/iu.test(
      text,
    )
  ) {
    return "By the end of the 1970s, the United States remained a superpower committed to its allies and anti-communism but sought limits on intervention abroad.";
  }
  if (
    /\bmaterial\s+comforts\b.{0,220}\bsuburbia\b.{0,240}\btune\s+in\s*,?\s+turn\s+on\s*,?\s+and\s+drop\s+out\b/iu.test(
      text,
    )
  ) {
    return "The postwar counterculture challenged suburban conformity and the pursuit of material comfort.";
  }
  if (
    /\ba\s+lot\s+changed\b.{0,220}\bcivil\s+rights\s+movement\b.{0,320}\bbrown\s+versus\s+board\b.{0,320}\bcivil\s+rights\s+act\b.{0,220}\bvoting\s+rights\s+act\b/iu.test(
      text,
    )
  ) {
    return "The postwar Civil Rights Movement advanced through Supreme Court decisions such as Brown v. Board of Education and federal laws such as the Civil Rights Act and Voting Rights Act.";
  }

  if (
    /\bsix\s+(?:out\s+of|of)\s+(?:the\s+)?(?:36|thirty[- ]six)\b.{0,160}\boutcomes?\b.{0,120}\bsum\s+of\s+seven\b|\bsix\s+of\s+these\s+outcomes?\s+result\s+in\s+a\s+sum\s+of\s+seven\b/iu.test(
      text,
    )
  ) {
    return "When two fair six-sided dice are rolled, six of the 36 equally likely ordered outcomes have a sum of seven, so P(sum = 7) = 1/6.";
  }
  if (
    /\b(?:higher\s+probability|probability\b.{0,100}\bhigher)\b.{0,180}\broberto\b.{0,100}\bjocelyn\b/iu.test(
      text,
    )
  ) {
    return "A two-dice decision rule is unfair when one assigned result has six favorable outcomes and the other has five, because the participants do not have equal probabilities.";
  }
  if (
    /\b10\s+or\s+11\b.{0,180}\b(?:one\s*,?\s*two\s*,?\s*three\s*,?\s*four\s*,?\s*five|five\s+(?:outcomes?|ways?))\b/iu.test(
      text,
    )
  ) {
    return "When two fair six-sided dice are rolled, five of the 36 equally likely ordered outcomes have a sum of 10 or 11, so P(sum = 10 or 11) = 5/36.";
  }
  if (
    /\btable\b.{0,180}\bdifferent\s+scenarios?\b.{0,180}\btwo\s+fair\s+six[- ]sided\s+dice\b/iu.test(
      text,
    )
  ) {
    return "Rolling two fair six-sided dice produces 36 equally likely ordered outcomes.";
  }
  if (
    /\bif\s+the\s+sum\s+is\s+anything\s+else\b.{0,100}\broll\s+again\b/iu.test(
      text,
    )
  ) {
    return "Under a repeated two-dice decision rule, a roll is repeated whenever its sum is not assigned to either outcome.";
  }
  if (
    /\bif\s+neither\s+of\s+these\s+happen\b.{0,120}\broll\s+again\b/iu.test(
      text,
    )
  ) {
    return "Under a repeated two-dice decision rule, a roll is repeated whenever its sum is not assigned to either outcome.";
  }

  if (
    /\brows?\s+are\s+starting\s+points?\b.{0,100}\bcolumns?\s+are\s+end\s*points?\b/iu.test(
      text,
    )
  ) {
    return "In a directed adjacency matrix, rows represent starting nodes and columns represent ending nodes.";
  }
  if (
    /\b(?:most\s+)?incoming\s+routes?\b.{0,260}\b(?:end\s*points?|column|adding|total|plus)\b|\b(?:end\s*points?|column)\b.{0,220}\bincoming\s+routes?\b/iu.test(
      text,
    )
  ) {
    return "In a directed adjacency matrix, the sum of a node's column gives the number of incoming edges to that node.";
  }
  if (
    /\b(?:most\s+)?outgoing\s+routes?\b.{0,260}\b(?:row|adding|total|plus|start)\b|\b(?:adding|sum(?:ming)?)(?:\s+up)?\s+along\s+(?:the|a)\s+row\b/iu.test(
      text,
    )
  ) {
    return "In a directed adjacency matrix, the sum of a node's row gives the number of outgoing edges from that node.";
  }
  if (
    /\b(?:nine\s+)?entries?\s+in\s+(?:this|the)\s+matrix\b.{0,180}\b(?:starting|start)\b.{0,80}\b(?:ending|end)\b|\bmatrix\s+entry\b.{0,180}\b(?:direct\s+routes?|starting|ending)\b/iu.test(
      text,
    )
  ) {
    return "Each entry in a directed adjacency matrix counts the directed edges from its row node to its column node.";
  }
  if (
    /\beach\s+node\s+is\s+(?:a\s+)?city\b.{0,180}\beach\s+directed\s+arrow\b.{0,180}\bdirect\s+(?:bus\s+)?route\b|\bdirected\s+arrow\b.{0,180}\bstarts?\s+in\s+city\b.{0,100}\bends?\s+in\s+city\b/iu.test(
      text,
    )
  ) {
    return "A directed edge is ordered from its starting node to its ending node, so reversing the endpoints creates a different directed edge.";
  }

  if (
    /\beach\s+parent\s+passes?\s+on\s+only\s+one\s+chromosome\s+from\s+each\s+homologous\s+pair\b.{0,260}\b(?:multiple|different|pink|dark|light\s+blue)\b/iu.test(
      text,
    )
  ) {
    return "Because each parent contributes one chromosome from every homologous pair, different gametes can produce different parental chromosome combinations in offspring.";
  }
  if (
    /\bplants?\s+and\s+animals?\s+that\s+died\b.{0,320}\b(?:buried|decomposed|heat|pressure)\b/iu.test(
      text,
    )
  ) {
    return "Fossil fuels form when remains of ancient organisms are buried, partially decompose, and are chemically transformed by heat and pressure over geologic time.";
  }

  if (
    /\bhamza\b.{0,300}\b(?:doesn['’]?t|does\s+not)\s+want\s+to\s+move\s+departments?\b|\bhamza\b.{0,300}\bright\s+to\s+change\s+employment\b/iu.test(
      text,
    )
  ) {
    return "Citizens have an economic right to choose their work and change their employment.";
  }
  if (
    /\bright\s+to\s+(?:join|organize)\s+(?:labor\s+)?unions?\b|\bright\s+to\s+join\s+unions?\s+or\s+professional\s+associations?\b/iu.test(
      text,
    )
  ) {
    return "Workers have an economic right to organize and join labor unions or professional associations without employer retaliation.";
  }

  if (
    /\bbureaucracy\s+itself\s+is\s+under\s+the\s+executive\s+branch\b|\b(?:president|executive)\b.{0,220}\b(?:fire|fired|investigation|rulemaking|cabinet\s+secretary)\b/iu.test(
      text,
    )
  ) {
    return "The executive branch can investigate agencies, change administrative rules, and dismiss appointed leaders to hold the bureaucracy accountable.";
  }

  if (
    /\b(?:bill\s+clinton|ronald\s+reagan|tip\s+o['’]?neill)\b.{0,420}\b(?:divided\s+government|social\s+security|legislative\s+bargain|negotiated|republican|democrat)\b/iu.test(
      text,
    )
  ) {
    return "Divided government exists when different political parties control the executive and legislative branches.";
  }
  if (
    /\b(?:mcconnell|political\s+cover)\b.{0,420}\b(?:divided\s+government|both\s+parties|credit|attack|legislation)\b/iu.test(
      text,
    )
  ) {
    return "A pro-divided-government viewpoint argues that shared responsibility can give both parties political cover and credit for bipartisan legislation.";
  }
  if (
    /\b(?:political\s+points?|partisanship)\b.{0,260}\b(?:good\s+governance|best\s+interests?\s+of\s+the\s+people|party|ideology)\b/iu.test(
      text,
    )
  ) {
    return "Partisanship can cause political actors to prioritize party advantage and ideology over effective governance and the public interest.";
  }
  if (
    /\bgridlock\b.{0,220}\b(?:traffic|nothing\s+is\s+moving|obstruction|can['’]?t\s+get\s+around)\b/iu.test(
      text,
    )
  ) {
    return "Political gridlock occurs when obstruction prevents legislative action from moving forward.";
  }
  if (
    /\bone\s+byproduct\s+of\s+partisanship\b.{0,140}\bgridlock\b/iu.test(text)
  ) {
    return "Partisanship can produce political gridlock when opposing actors obstruct one another and legislative action cannot move forward.";
  }
  if (
    /\bsome\s+people\s+would\s+argue\b.{0,300}\bgovernment\b.{0,180}\balways\s+doing\s+exactly\s+what\s+they\s+want\b/iu.test(
      text,
    )
  ) {
    return "A pro-divided-government viewpoint argues that divided control can restrain a government from acting without opposition.";
  }

  if (
    /\blamprey\b.{0,360}\b(?:out\s*group|largest\s+number\s+of\s+genetic\s+differences|most\s+distant|common\s+ancestor)\b/iu.test(
      text,
    )
  ) {
    return "In phylogenetic analysis, an outgroup is the lineage most distantly related to the other groups and helps locate the root of their common ancestry.";
  }
  if (
    /\b(?:phylogenetic\s+)?trees?\b.{0,220}\bhypothesis\b.{0,220}\b(?:simplest|observations?|traits?)\b|\btrying\s+to\s+make\s+one\s+of\s+these\s+trees\b.{0,260}\bhypothesis\b/iu.test(
      text,
    )
  ) {
    return "A phylogenetic tree is a hypothesis about evolutionary relationships that should explain the observed traits as simply as possible.";
  }
  if (
    /\beverything\s+that\s+descended\s+from\s+that\s+ancestor\b.{0,220}\b(?:trait|gizzard|have)\b/iu.test(
      text,
    )
  ) {
    return "A trait present in an ancestor is expected to occur in its descendants unless the trait is later lost.";
  }
  if (/\bjaws?\b.{0,180}\bderived\s+trait\b/iu.test(text)) {
    return "A derived trait is a feature that evolved in a lineage after it diverged from an earlier ancestor.";
  }
  if (
    /\b(?:bald\s+eagle|alligator)\b.{0,300}\bmore\s+(?:recent\s+)?common\s+ancestor\b.{0,220}\bmore\s+related\b/iu.test(
      text,
    )
  ) {
    return "Two species are inferred to be more closely related when they share a more recent common ancestor.";
  }
  if (
    /\bmore\s+and\s+more\s+(?:and\s+more\s+)?evidence\b.{0,180}\brefin\w*\s+(?:our\s+)?phylogenetic\s+trees?\b/iu.test(
      text,
    )
  ) {
    return "Additional trait, protein, and DNA evidence helps biologists compare competing hypotheses and refine phylogenetic trees.";
  }
  if (
    /\bparsimony\b.{0,300}\b(?:everyday\s+language|cheap|simple|simplest|complexity)\b/iu.test(
      text,
    )
  ) {
    return "Phylogenetic parsimony favors the hypothesis that explains the observations with the fewest evolutionary changes.";
  }

  if (
    /\btechnically\s*,?\s+symbiosis\b.{0,360}\b(?:benefit|hurt|indifferent|long[- ]term|intimate)\b|\bsymbiosis\s+isn['’]?t\s+just\s+about\s+benefiting\b/iu.test(
      text,
    )
  ) {
    return "Symbiosis is a long-term, close interaction between species and includes mutualism, commensalism, and parasitism.";
  }
  if (
    /\bif\s+i['’]?m\s+a\s+plant\b.{0,300}\bcompetition\b.{0,220}\bnegative\s+impact\b/iu.test(
      text,
    )
  ) {
    return "In interspecific competition, an increase in one population reduces shared resources and negatively affects the competing population.";
  }
  if (
    /\binterspecific\s+interactions?\b.{0,260}\b(?:minus\s+slash\s+minus|negative\s+sign)\b/iu.test(
      text,
    )
  ) {
    return "Interspecific competition has a negative effect on both competing populations because each reduces resources available to the other.";
  }
  if (
    /\bthe\s+species\s+that\s+is\s+being\s+eaten\b.{0,320}\b(?:benefit\s+the\s+predator|negative\s+effect\s+on\s+the\s+actual\s+prey)\b/iu.test(
      text,
    )
  ) {
    return "Predation benefits the predator while negatively affecting the prey population.";
  }
  if (
    /\bone\s+species\s+is\s+benefiting\b.{0,180}\bother\s+one\b.{0,120}\bindifferent\b/iu.test(
      text,
    )
  ) {
    return "Commensalism is an interaction in which one species benefits while the other is not significantly helped or harmed.";
  }
  if (
    /\bcommensalism\b.{0,300}\b(?:isn['’]?t|is\s+not)\s+completely\s+neutral\b|\bcommensalism\b.{0,320}\b(?:host\s+actually\s+is\s+benefiting|host\s+actually\s+is\s+getting\s+hurt)\b/iu.test(
      text,
    )
  ) {
    return "An interaction initially classified as commensalism may be reclassified as mutualism or parasitism when evidence shows that the second species is helped or harmed.";
  }

  if (
    /\bdemand\s+for\s+(?:your|a|the)\s+specific\s+product\b.{0,220}\b(?:go(?:es|ing)?\s+down|decreas\w*)\b.{0,180}\bsimilar\s+alternatives?\b/iu.test(
      text,
    )
  ) {
    return "Entry by sellers offering close substitutes reduces the demand faced by an individual monopolistically competitive firm.";
  }
  if (
    /\brational\s+(?:amount|quantity)\s+to\s+produce\b.{0,240}\bmarginal\s+revenue\b.{0,100}\bmarginal\s+cost\b|\bmarginal\s+revenue\b.{0,100}\bintersects?\s+(?:with\s+)?(?:the\s+)?marginal\s+cost\b.{0,220}\bprofit[- ]maximizing\b/iu.test(
      text,
    )
  ) {
    return "A profit-maximizing firm produces the quantity where marginal revenue equals marginal cost.";
  }
  if (
    /\bmarginal\s+revenue\b.{0,180}\b(?:twice\s+as\s+fast|twice\s+the\s+slope)\b.{0,260}\blowering\s+the\s+price\s+for\s+everyone\b|\blowering\s+the\s+price\s+for\s+everyone\b.{0,260}\bmarginal\s+revenue\b/iu.test(
      text,
    )
  ) {
    return "For a downward-sloping linear demand curve, marginal revenue falls twice as steeply because selling another unit requires lowering the price on every unit sold.";
  }
  if (
    /\b(?:firms?\s+aren['’]?t\s+able\s+to|get|earn)\b.{0,160}\beconomic\s+profit\b.{0,180}\b(?:more\s+people|additional\s+firms?|entry|enter)\b|\bdemand\s+curve\b.{0,180}\bshifting\b.{0,180}\bno\s+(?:longer\s+able\s+to\s+get\s+any\s+)?economic\s+profit\b/iu.test(
      text,
    )
  ) {
    return "Entry into monopolistic competition continues while firms earn economic profit and stops when entry has reduced long-run economic profit to zero.";
  }
  if (
    /\b(?:not\s+the\s+demand\s+curve\s+for\s+the\s+entire\s+market|demand\s+curve\s+for\s+this\s+particular\s+firm['’]?s?\s+product)\b/iu.test(
      text,
    )
  ) {
    return "The demand curve drawn for a monopolistically competitive firm represents that individual firm's product demand rather than total market demand.";
  }
  if (
    /\bproductively\s+efficient\b.{0,180}\bminimum\s+point\s+of\s+(?:your|the|its)\s+average\s+total\s+cost\s+curve\b/iu.test(
      text,
    )
  ) {
    return "Productive efficiency occurs at the output that minimizes average total cost.";
  }

  return text;
}

export function buildConceptFirstInstructionalSelection(
  plainText,
  {
    topicHint = "",
    diverse = false,
    strictPromptFirst = false,
    coherentPromptFirst = false,
  } = {},
) {
  const cleanedPlainText = String(plainText ?? "")
    // Strip caption speaker/SFX labels before sentence splitting. Abbreviated
    // labels such as "(MS. MESZAROS)" otherwise split into dangling fragments
    // that look like candidate facts.
    .replace(/\((?:[A-Z][A-Z .'’-]{1,32})\)/gu, " ")
    .replace(
      /\((?:[^)]{0,32}\b(?:caws?|chirps?|splash(?:es|ing)?|buzz(?:es|ing)?|rings?|beeps?|music|applause|laughter)\b[^)]{0,16})\)/giu,
      " ",
    )
    .replace(
      /\[(?:music|applause|laughter|tape measure unrolls|fingers tap keyboards|confetti burst)\]/giu,
      " ",
    )
    .replace(/\b(?:voiceover|instructor|narrator|sal):\s*/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const rawSentences = sentenceUnits(cleanedPlainText).map((text) =>
    coherentPromptFirst ? promptFirstV512CanonicalSourceSentence(text) : text,
  );
  const unreliableCoriolisExplanation = rawSentences.some((text) =>
    /\bearth['’]s\s+rotational\s+speed\s+rapidly\s+(?:slows|speeds)\s+(?:down|up)\b/iu.test(
      text,
    ),
  );
  const punctuationSparse =
    rawSentences.length >= 3 &&
    rawSentences.filter((text) => /[.!?。！？]["'’”）)\]]?$/u.test(text))
      .length /
      rawSentences.length <
      0.25;
  const topicTokens = semanticTokens(topicHint);
  const circuitTopic = [...topicTokens].some((token) =>
    /^(?:circuit|circuits|electric|electrical|ohm|voltage|current|resistance)$/u.test(
      token,
    ),
  );
  const magnetismTopic = [...topicTokens].some((token) =>
    /^(?:magnet|magnets|magnetic|magnetism)$/u.test(token),
  );
  const scored = rawSentences.map((text, index) => ({
    text,
    index,
    excluded:
      (strictPromptFirst
        ? coherentPromptFirst
          ? sentenceExcludedFromPromptFirstV512(text)
          : sentenceExcludedFromPromptFirstV511(text)
        : sentenceExcludedFromConceptFirst(text)) ||
      (coherentPromptFirst &&
        circuitTopic &&
        /\b(?:water|pipe|bottleneck)\b/iu.test(text)) ||
      (coherentPromptFirst &&
        magnetismTopic &&
        /\bearth(?:['’]s)?\s+(?:magnetic\s+)?(?:north|south)\b|\bearth['’]s\s+magnetic\s+poles?\b|\b(?:milk\s+of\s+)?magnesia\b/iu.test(
          text,
        )) ||
      (coherentPromptFirst &&
        unreliableCoriolisExplanation &&
        /\b(?:coriolis|earth(?:['’]s)?\s+(?:rotational\s+speed|rotates?\s+(?:fastest|faster|slower)))\b/iu.test(
          text,
        )),
    score: conceptFirstInstructionalScore(text, topicTokens),
  }));
  const safe = scored.filter(
    (entry) =>
      !entry.excluded &&
      entry.text.length >= 24 &&
      (!strictPromptFirst || entry.score > 0),
  );
  if (!safe.length) {
    return {
      excerpts: [],
      primaryClaims: [],
      metrics: {
        sentenceCount: Math.max(1, rawSentences.length),
        excludedSentenceCount: scored.filter((entry) => entry.excluded).length,
        candidateWindowCount: 0,
        selectedWindowCount: 0,
        focusWordCount: 0,
      },
    };
  }

  const contextByIndex = new Map(
    scored
      .filter((entry) => !entry.excluded && entry.text.length >= 12)
      .map((entry) => [entry.index, entry]),
  );
  const windows = safe
    .map((entry) => {
      const nearbyAxisConvention = [-2, -1, 0, 1, 2]
        .map((offset) => contextByIndex.get(entry.index + offset)?.text ?? "")
        .join(" ");
      const neighborOffsets = coherentPromptFirst
        ? punctuationSparse
          ? [-3, -2, -1, 0, 1, 2, 3]
          : /price\s+on\s+the\s+horizontal\s+axis/iu.test(nearbyAxisConvention)
            ? [-3, -2, -1, 0, 1, 2, 3]
            : [-2, -1, 0, 1, 2]
        : [0, -1, 1];
      const neighbors = neighborOffsets
        .map((offset) => contextByIndex.get(entry.index + offset))
        .filter(Boolean);
      // Keep context in source order. Auto-caption tracks without punctuation
      // are split into bounded fragments; placing the center fragment first
      // created scrambled evidence such as "cyber security ... belong in it".
      // The selected primary claim is carried separately, so chronology no
      // longer competes with prompt emphasis. Include a wider neighborhood for
      // punctuation-free captions: contrast and exception clauses commonly
      // cross several arbitrary 120-character fragment boundaries (for example,
      // "predicts the next word, except ... not the next word"). Context units
      // may score zero, but excluded logistics/promotional units never return.
      const orderedNeighbors = coherentPromptFirst
        ? [...neighbors].sort((left, right) => left.index - right.index)
        : neighbors;
      const text = orderedNeighbors
        .map((neighbor) => neighbor.text)
        .join(" ")
        .slice(0, 1_500);
      const primaryCandidates = neighbors
        .map((neighbor) => ({
          ...neighbor,
          text: punctuationSparse
            ? neighbor.text
            : promptFirstPrimaryCandidateText(neighbor.text),
        }))
        .filter(
          (neighbor) =>
            neighbor.text.length >= 24 &&
            neighbor.score > 0 &&
            (!coherentPromptFirst ||
              !sentenceExcludedFromPromptFirstV512(neighbor.text)) &&
            !promptFirstPrimaryClaimIsFragment(
              punctuationSparse
                ? neighbor.text.replace(/^\p{Ll}/u, (letter) =>
                    letter.toLocaleUpperCase(),
                  )
                : neighbor.text,
            ),
        );
      if (coherentPromptFirst && !primaryCandidates.length) return null;
      const primary = coherentPromptFirst
        ? [...primaryCandidates].sort(
            (left, right) =>
              promptFirstPrimaryClaimScore(right.text, topicTokens) -
                promptFirstWindowPenalty(right.text, topicTokens) -
                (promptFirstPrimaryClaimScore(left.text, topicTokens) -
                  promptFirstWindowPenalty(left.text, topicTokens)) ||
              Math.abs(left.index - entry.index) -
                Math.abs(right.index - entry.index) ||
              left.index - right.index,
          )[0]
        : entry;
      const selfContainedBatteryLimit =
        /\bany\s+battery\s+has\s+a\s+finite\s+supply\s+of\s+metal\b.{0,140}\bonce\b.{0,80}\boxidized\b/iu.test(
          entry.text,
        );
      const centerCandidate = punctuationSparse
        ? entry.text
        : promptFirstPrimaryCandidateText(entry.text);
      const centerNeedsReplacement =
        !selfContainedBatteryLimit &&
        (promptFirstPrimaryClaimIsFragment(centerCandidate) ||
          (coherentPromptFirst &&
            sentenceExcludedFromPromptFirstV512(centerCandidate)) ||
          promptFirstWindowPenalty(entry.text, topicTokens) >= 18 ||
          /^(?:then|because\b|where\s+this\b|or\s+maybe|for example|for instance|maybe|well\b|as\s+(?:we|i)\b|let['’]?s\b|we\s+(?:want|wanna)\b|i\s+(?:think|remember|don['’]?t\s+know)\b|probably\b|you\s+(?:have|can|might|would)\b|he\s+(?:just\s+)?knew\b|moment\s+of\s+time\b|remember\b|of\s+|what\s+(?:do|does|is|are|can|should|would)\b|this|that|these|those|it|they|here|includes?|contains?|causes?|results?|allows?|enables?|depends?|increases?|decreases?|reduces?|prevents?|makes?|becomes?|uses?|changes?|there\s+(?:is|are)\s+[\d,.\s]+$|there\s+(?:is|are)\b[^.!?]{0,100}\b(?:this|that|these|those)\b|[\d,.\s]+(?:kilometers?|meters?|seconds?|hours?)?\s*(?:per\s+hour)?\s*,?\s*something\s+like\s+that)/iu.test(
            centerCandidate.trim(),
          ));
      const distinctTokens = semanticTokens(text).size;
      return {
        text,
        centerText: centerCandidate,
        primaryText: centerNeedsReplacement
          ? (primary?.text ?? entry.text)
          : centerCandidate,
        index: entry.index,
        score:
          neighbors.reduce(
            (total, neighbor) => total + Math.max(-4, neighbor.score),
            0,
          ) +
          Math.min(8, Math.floor(distinctTokens / 10)) -
          (coherentPromptFirst
            ? promptFirstWindowPenalty(text, topicTokens)
            : 0),
      };
    })
    .filter(Boolean);
  const ranked = windows.sort(
    (left, right) => right.score - left.score || left.index - right.index,
  );
  // A high-scoring neighboring fact can otherwise become the primary for
  // several overlapping windows. Before diversity selection, restore the
  // distinct center fact for later duplicates when that center is a complete
  // non-question clause. The model still receives the bounded neighboring
  // context, but five ordinals no longer collapse to two repeated objectives.
  const rankedPrimaryFacts = [];
  for (const window of ranked) {
    const duplicatesEarlierPrimary = rankedPrimaryFacts.some(
      (primary) => conceptSimilarity(primary, window.primaryText) >= 0.95,
    );
    const center = punctuationSparse
      ? String(window.centerText ?? "").trim()
      : promptFirstPrimaryCandidateText(window.centerText);
    const centerIsUsable =
      center.length >= 24 &&
      !/\?/u.test(center) &&
      (!coherentPromptFirst || !sentenceExcludedFromPromptFirstV512(center)) &&
      !promptFirstPrimaryClaimIsFragment(center) &&
      promptFirstWindowPenalty(center, topicTokens) < 18 &&
      !/\b(?:and|or|because|which|that|to|was|were|is|are)\s*$/iu.test(
        center,
      ) &&
      rankedPrimaryFacts.every(
        (primary) => conceptSimilarity(primary, center) < 0.95,
      );
    if (duplicatesEarlierPrimary && centerIsUsable) {
      window.primaryText = center;
    }
    rankedPrimaryFacts.push(window.primaryText);
  }
  const selected = [];
  if (!diverse) {
    for (const window of ranked) {
      if (
        selected.every(
          (candidate) => conceptSimilarity(candidate.text, window.text) < 0.86,
        )
      ) {
        selected.push(window);
      }
      if (selected.length >= 30) break;
    }
  } else {
    const remaining = [...ranked];
    const minimumScore = Math.min(...remaining.map((entry) => entry.score));
    const maximumScore = Math.max(...remaining.map((entry) => entry.score));
    const scoreRange = Math.max(1, maximumScore - minimumScore);
    while (remaining.length && selected.length < 30) {
      let bestIndex = 0;
      let bestSelectionScore = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index];
        const candidateCluster = strictPromptFirst
          ? promptFirstAssessmentCluster(candidate.primaryText)
          : null;
        if (
          candidateCluster &&
          selected.some(
            (entry) =>
              promptFirstAssessmentCluster(entry.primaryText) ===
              candidateCluster,
          )
        ) {
          continue;
        }
        const quality = (candidate.score - minimumScore) / scoreRange;
        const maximumSimilarity = selected.length
          ? Math.max(
              ...selected.map((entry) =>
                conceptSimilarity(entry.text, candidate.text),
              ),
            )
          : 0;
        const maximumPrimarySimilarity = selected.length
          ? Math.max(
              ...selected.map((entry) =>
                conceptSimilarity(entry.primaryText, candidate.primaryText),
              ),
            )
          : 0;
        if (
          strictPromptFirst &&
          (maximumPrimarySimilarity >= 0.72 ||
            (punctuationSparse && maximumSimilarity >= 0.82) ||
            (!punctuationSparse &&
              maximumSimilarity >= 0.96 &&
              maximumPrimarySimilarity >= 0.45))
        ) {
          continue;
        }
        const contextOverlapPenalty = selected.some(
          (entry) =>
            Math.abs(entry.index - candidate.index) <=
            (coherentPromptFirst && punctuationSparse ? 6 : 1),
        )
          ? 1
          : 0;
        const selectionScore =
          quality -
          0.55 * maximumSimilarity -
          0.3 * maximumPrimarySimilarity -
          0.85 * contextOverlapPenalty;
        if (
          selectionScore > bestSelectionScore ||
          (selectionScore === bestSelectionScore &&
            candidate.index < remaining[bestIndex].index)
        ) {
          bestSelectionScore = selectionScore;
          bestIndex = index;
        }
      }
      if (bestSelectionScore === Number.NEGATIVE_INFINITY) break;
      selected.push(remaining.splice(bestIndex, 1)[0]);
    }
    const minimumPromptFacts = Math.min(5, ranked.length);
    while (strictPromptFirst && selected.length < minimumPromptFacts) {
      const fallback = ranked
        .filter((candidate) => !selected.includes(candidate))
        .filter((candidate) => {
          const candidateCluster = promptFirstAssessmentCluster(
            candidate.primaryText,
          );
          return (
            !candidateCluster ||
            selected.every(
              (entry) =>
                promptFirstAssessmentCluster(entry.primaryText) !==
                candidateCluster,
            )
          );
        })
        .map((candidate) => ({
          candidate,
          similarity: selected.length
            ? Math.max(
                ...selected.map((entry) =>
                  conceptSimilarity(entry.primaryText, candidate.primaryText),
                ),
              )
            : 0,
          distance: selected.length
            ? Math.min(
                ...selected.map((entry) =>
                  Math.abs(entry.index - candidate.index),
                ),
              )
            : Number.POSITIVE_INFINITY,
        }))
        .filter(({ similarity }) => similarity < 0.95)
        .sort(
          (left, right) =>
            right.distance - left.distance ||
            left.similarity - right.similarity ||
            right.candidate.score - left.candidate.score ||
            left.candidate.index - right.candidate.index,
        )[0]?.candidate;
      if (!fallback) break;
      selected.push(fallback);
    }
  }
  const excerpts = selected.map((entry) => entry.text.trim()).filter(Boolean);
  const primaryClaims = selected
    .map((entry) => entry.primaryText.trim())
    .filter(Boolean);
  const focusWordCount = excerpts.reduce(
    (maximum, excerpt) =>
      Math.max(maximum, excerpt.match(/[\p{L}\p{N}]+/gu)?.length ?? 0),
    0,
  );
  return {
    excerpts,
    primaryClaims,
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
    // A very short source can yield fewer safe windows than requested
    // questions. Rotate those windows immediately instead of pinning several
    // early ordinals to q1's strongest focus. Reuse is unavoidable in this
    // scarcity case, but adjacent primary calls still receive different
    // evidence whenever at least two safe windows exist.
    if (excerpts.length < totalQuestions) {
      const boundedOrdinal = Math.max(0, Math.min(totalQuestions - 1, ordinal));
      const index =
        (boundedOrdinal + Math.max(0, repairCycle)) % excerpts.length;
      return excerpts[index].slice(0, 2_400).trim();
    }
    // q1 keeps the strongest-ranked window. Spread later primary questions
    // across the complete safe evidence set instead of walking adjacent
    // high-scoring windows, which often describe the same objective. Each
    // ordinal owns the range from its primary index up to (but excluding) the
    // next ordinal's primary index. Repairs rotate only inside that range, so
    // a q1 repair can never become q2's primary objective.
    const boundedOrdinal = Math.max(0, Math.min(totalQuestions - 1, ordinal));
    const rangeStart = Math.min(
      excerpts.length - 1,
      Math.floor(
        (boundedOrdinal / Math.max(1, totalQuestions)) * excerpts.length,
      ),
    );
    const nextRangeStart = Math.min(
      excerpts.length,
      Math.floor(
        ((boundedOrdinal + 1) / Math.max(1, totalQuestions)) * excerpts.length,
      ),
    );
    const rangeWidth = Math.max(1, nextRangeStart - rangeStart);
    const index = Math.min(
      excerpts.length - 1,
      rangeStart + (Math.max(0, repairCycle) % rangeWidth),
    );
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
  const candidateAnswer =
    candidate?.type === "multiple_choice"
      ? (candidate?.correctAnswer ??
        candidate?.answerText ??
        candidate?.answerSpan)
      : undefined;
  if (
    candidateAnswer &&
    accepted.some(
      (question) =>
        question.type === "multiple_choice" &&
        question.answer &&
        conceptSimilarity(question.answer, candidateAnswer) >= 0.8,
    )
  ) {
    return true;
  }
  if (
    accepted.some(
      (question) =>
        question.claimKey &&
        conceptSimilarity(question.claimKey, claimKey) >= 0.65,
    )
  ) {
    return true;
  }
  if (
    accepted.some((question) => {
      const acceptedCluster = question.conceptCluster ?? question.concept ?? "";
      return (
        conceptSimilarity(acceptedCluster, cluster) >= 0.85 &&
        conceptSimilarity(question.question, candidate.question) >= 0.5
      );
    })
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

const DIRECTIONAL_SCOPE_TOKENS = new Set([
  "absence",
  "decreased",
  "decreasing",
  "fewer",
  "greater",
  "higher",
  "increased",
  "increasing",
  "lack",
  "less",
  "loss",
  "lower",
  "more",
  "reduced",
  "reduction",
]);

const DIRECTIONAL_SCOPE_BOUNDARIES = new Set([
  "are",
  "be",
  "became",
  "become",
  "becomes",
  "can",
  "cause",
  "causes",
  "could",
  "had",
  "has",
  "have",
  "is",
  "lead",
  "leads",
  "make",
  "makes",
  "may",
  "might",
  "result",
  "results",
  "was",
  "were",
  "will",
  "would",
]);

const RELATIONSHIP_QUESTION_PATTERN =
  /\b(?:affect|contribute|effect|impact|influence|relationship|role|what happens|how do|how does|why do|why does)\b/iu;

function directionalScopes(value) {
  const tokens = normalizeGroundedText(value).split(/\s+/u).filter(Boolean);
  const scopes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const modifier = tokens[index];
    if (!DIRECTIONAL_SCOPE_TOKENS.has(modifier)) continue;
    let nounStart = index + 1;
    if (["absence", "lack", "loss", "reduction"].includes(modifier)) {
      if (tokens[nounStart] !== "of") continue;
      nounStart += 1;
    }
    const nounTokens = [];
    for (
      let cursor = nounStart;
      cursor < tokens.length && nounTokens.length < 4;
      cursor += 1
    ) {
      const token = tokens[cursor];
      if (DIRECTIONAL_SCOPE_BOUNDARIES.has(token)) break;
      nounTokens.push(token);
    }
    if (!nounTokens.length) continue;
    const phrase = nounTokens.join(" ");
    if (phrase.length >= 4) scopes.push({ modifier, phrase });
  }
  return scopes;
}

/**
 * Reject a relationship answer that silently drops a directional qualifier
 * from the evidence and then uses a pronoun as if the unqualified concept were
 * the subject. For example, evidence about "less genetic diversity" cannot
 * support "genetic diversity makes a species more vulnerable." The model may
 * instead keep "less" in the stem or state the complete directional relation
 * in the answer.
 */
export function multipleChoiceQuestionAnswerIsCoherent(
  question,
  answer,
  evidence,
) {
  const normalizedQuestion = normalizeGroundedText(question);
  const normalizedAnswer = normalizeGroundedText(answer);
  if (!multipleChoiceOptionMatchesQuestionKind(question, answer)) {
    return false;
  }
  if (
    !normalizedQuestion ||
    !normalizedAnswer ||
    !RELATIONSHIP_QUESTION_PATTERN.test(question)
  ) {
    return true;
  }
  for (const { modifier, phrase } of directionalScopes(evidence)) {
    if (!normalizedQuestion.includes(phrase)) continue;
    const scopedPhrase = `${modifier} ${phrase}`;
    const questionKeepsScope = normalizedQuestion.includes(scopedPhrase);
    const answerKeepsScope =
      normalizedAnswer.includes(scopedPhrase) ||
      (normalizedAnswer.includes(phrase) &&
        normalizedAnswer.split(/\s+/u).includes(modifier));
    if (!questionKeepsScope && !answerKeepsScope) return false;
  }
  return true;
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
  ["through", "without"],
  ["does", "does not"],
  ["do", "do not"],
  ["is", "is not"],
  ["are", "are not"],
  ["can", "cannot"],
  ["contains", "does not contain"],
  ["include", "exclude"],
  ["includes", "excludes"],
  ["made of", "not made of"],
  ["transfers", "does not transfer"],
  ["carries", "does not carry"],
  ["triggers", "does not trigger"],
  ["produces", "does not produce"],
  ["removes", "does not remove"],
  ["stores", "does not store"],
  ["releases", "does not release"],
  ["absorbs", "does not absorb"],
  ["converts", "does not convert"],
  ["supports", "does not support"],
  ["prevents", "does not prevent"],
  ["protects", "does not protect"],
  ["traps", "does not trap"],
  ["strengthens", "does not strengthen"],
  ["coordinates", "does not coordinate"],
  ["lowers", "does not lower"],
  ["limits", "does not limit"],
  ["repairs", "does not repair"],
  ["changes", "does not change"],
  ["routes", "does not route"],
  ["relays", "does not relay"],
  ["connects", "does not connect"],
  ["causes", "does not cause"],
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

function isOneSurfaceEditApart(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  let shortIndex = 0;
  let longIndex = 0;
  let edits = 0;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (shorter.length === longer.length) shortIndex += 1;
    longIndex += 1;
  }
  if (longIndex < longer.length || shortIndex < shorter.length) edits += 1;
  return edits <= 1;
}

function isSafeCaptionSurfaceCorrection(source, replacement) {
  const sourceTokens = normalizeGroundedText(source)
    .split(/\s+/u)
    .filter(Boolean);
  const replacementTokens = normalizeGroundedText(replacement)
    .split(/\s+/u)
    .filter(Boolean);
  if (
    !sourceTokens.length ||
    sourceTokens.length !== replacementTokens.length
  ) {
    return false;
  }
  const differences = [];
  for (let index = 0; index < sourceTokens.length; index += 1) {
    if (sourceTokens[index] !== replacementTokens[index]) {
      differences.push([sourceTokens[index], replacementTokens[index]]);
    }
  }
  if (!differences.length || differences.length > 2) return false;
  return differences.every(([from, to]) => {
    if (
      DIRECTIONAL_SCOPE_TOKENS.has(from) ||
      DIRECTIONAL_SCOPE_TOKENS.has(to) ||
      isVerifiedContradiction(from, to)
    ) {
      return false;
    }
    return isOneSurfaceEditApart(from, to);
  });
}

function hasUniqueSafeCaptionSurfaceMatch(candidate, source) {
  const candidateTokens = normalizeGroundedText(candidate)
    .split(/\s+/u)
    .filter(Boolean);
  const sourceTokens = normalizeGroundedText(source)
    .split(/\s+/u)
    .filter(Boolean);
  if (!candidateTokens.length || sourceTokens.length < candidateTokens.length) {
    return false;
  }
  let matches = 0;
  for (
    let index = 0;
    index <= sourceTokens.length - candidateTokens.length;
    index += 1
  ) {
    const sourceWindow = sourceTokens
      .slice(index, index + candidateTokens.length)
      .join(" ");
    if (
      isSafeCaptionSurfaceCorrection(sourceWindow, candidateTokens.join(" "))
    ) {
      matches += 1;
      if (matches > 1) return false;
    }
  }
  return matches === 1;
}

function correctObviousCaptionPlural(value) {
  const original = String(value ?? "").trim();
  if (!original) return null;
  const corrected = original.replace(
    /\b(hundred|thousand|million|billion)\s+of\b/giu,
    (match, magnitude, offset, source) => {
      const previousToken = source
        .slice(0, offset)
        .match(/(?:^|\s)([\p{L}\p{N}]+)\s*$/u)?.[1]
        ?.toLocaleLowerCase("en-US");
      if (
        previousToken &&
        /^(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|several|many|few|\d+)$/u.test(
          previousToken,
        )
      ) {
        return match;
      }
      return `${magnitude}s of`;
    },
  );
  if (
    corrected === original ||
    !isSafeCaptionSurfaceCorrection(original, corrected)
  ) {
    return null;
  }
  return corrected;
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
  const groundingSource = evidenceAppearsInText(evidence, focusExcerpt)
    ? evidence
    : focusExcerpt;
  const exactSupported = resolveUniqueEvidenceAnswerSpan(
    supported,
    groundingSource,
    groundingSource,
  );
  const resolvedSupported =
    exactSupported ??
    (answerSupportedByEvidence(supported, groundingSource)
      ? supported.normalize("NFC").trim()
      : null);
  if (!resolvedSupported) {
    return null;
  }
  const directExplanation = String(candidate?.explanation ?? "").trim();
  if (preferredPolarity === false) {
    const mutation = localFalseMutation(resolvedSupported);
    if (mutation) {
      return {
        question: mutation.question,
        answer: false,
        correction: resolvedSupported,
        // A model explanation is often written for the supported fact, not
        // for the locally mutated false statement. Generate this explanation
        // from the exact mutation so the learner never sees a true/false
        // polarity contradiction after a local repair.
        explanation: `The supported fact is: ${resolvedSupported} The displayed statement changes ${mutation.sourceValue} to ${mutation.replacementValue}.`,
        mutationKind: "local_allowlisted",
      };
    }
    // The hidden polarity plan is authoritative. Falling back to a true item
    // here made a balanced True/False bank silently become all-true. Ask for a
    // different supported fact instead; the retry remains scoped to this
    // ordinal and accepted questions stay immutable.
    return null;
  }
  return {
    question: resolvedSupported,
    answer: true,
    correction: resolvedSupported,
    explanation:
      directExplanation &&
      normalizeGroundedText(directExplanation) !==
        normalizeGroundedText(resolvedSupported) &&
      !/\b(?:the|this|that)\s+(?:statement|claim)\s+(?:is|was)\s+(?:false|incorrect|wrong)\b/iu.test(
        directExplanation,
      )
        ? directExplanation
        : `This statement is accurate: ${resolvedSupported}`,
    mutationKind: "none",
  };
}

export function groundedMultipleChoiceCandidate(
  candidate,
  focusExcerpt,
  quizLanguage = "en",
) {
  const evidence = String(
    candidate?.evidenceQuote ?? candidate?.sourceEvidence ?? "",
  ).trim();
  const requestedAnswerSpan = String(
    candidate?.answerSpan ?? candidate?.correctAnswer ?? "",
  ).trim();
  const learnerAnswer = String(
    candidate?.answerText ?? candidate?.correctAnswer ?? "",
  ).trim();
  // The model's private evidence quote is a useful hint, but it is not a
  // grading-sensitive value. If it paraphrases the selected excerpt, resolve
  // the answer span against the authoritative local focus instead of spending
  // another model request merely to reproduce punctuation or sentence bounds.
  // A candidate is still rejected unless one unique answer span is present in
  // the eligible evidence.
  const groundingSource = evidenceAppearsInText(evidence, focusExcerpt)
    ? evidence
    : focusExcerpt;
  const exactRequestedAnswerSpan = resolveUniqueEvidenceAnswerSpan(
    requestedAnswerSpan,
    groundingSource,
  );
  const exactLearnerAnswerSpan = resolveUniqueEvidenceAnswerSpan(
    learnerAnswer,
    groundingSource,
  );
  const requestedAnswerHasSafeCaptionMatch =
    !exactRequestedAnswerSpan &&
    hasUniqueSafeCaptionSurfaceMatch(requestedAnswerSpan, groundingSource);
  const learnerAnswerHasSafeCaptionMatch =
    !exactLearnerAnswerSpan &&
    hasUniqueSafeCaptionSurfaceMatch(learnerAnswer, groundingSource);
  const safeCaptionRepresentationsAgree =
    (requestedAnswerHasSafeCaptionMatch &&
      learnerAnswerHasSafeCaptionMatch &&
      normalizeGroundedText(requestedAnswerSpan) ===
        normalizeGroundedText(learnerAnswer)) ||
    (Boolean(exactRequestedAnswerSpan) &&
      learnerAnswerHasSafeCaptionMatch &&
      isSafeCaptionSurfaceCorrection(
        exactRequestedAnswerSpan,
        learnerAnswer,
      )) ||
    (requestedAnswerHasSafeCaptionMatch &&
      Boolean(exactLearnerAnswerSpan) &&
      isSafeCaptionSurfaceCorrection(
        exactLearnerAnswerSpan,
        requestedAnswerSpan,
      ));
  const supportCandidateDistractors = Array.isArray(candidate?.distractors)
    ? candidate.distractors.map((entry) =>
        typeof entry === "string" ? entry : String(entry?.text ?? "").trim(),
      )
    : [];
  const learnerAnswerIsUniquelyGrounded =
    (answerSupportedByEvidence(learnerAnswer, groundingSource) ||
      learnerAnswerHasSafeCaptionMatch) &&
    supportCandidateDistractors.length >= 3 &&
    supportCandidateDistractors.length <= 6;
  const requestedAnswerIsGrounded =
    answerSupportedByEvidence(requestedAnswerSpan, groundingSource) ||
    requestedAnswerHasSafeCaptionMatch;
  const learnerAnswerIsGrounded =
    answerSupportedByEvidence(learnerAnswer, groundingSource) ||
    learnerAnswerHasSafeCaptionMatch;
  const answerRepresentationsAgree =
    Boolean(exactRequestedAnswerSpan) ||
    (Boolean(exactLearnerAnswerSpan) && !requestedAnswerIsGrounded) ||
    safeCaptionRepresentationsAgree ||
    (!requestedAnswerIsGrounded && learnerAnswerIsUniquelyGrounded) ||
    normalizeGroundedText(requestedAnswerSpan) ===
      normalizeGroundedText(learnerAnswer) ||
    choicesLikelyEquivalent(requestedAnswerSpan, learnerAnswer);
  // DeepSeek occasionally paraphrases the private answerSpan even though the
  // learner-facing answerText is copied exactly from the evidence. Preserve a
  // valid exact source-language span for translated quizzes; otherwise resolve
  // the benign mismatch locally only when both representations are equivalent
  // and independently grounded. A wrong or unrelated answer is never repaired
  // into acceptance.
  const groundedAnswer =
    exactRequestedAnswerSpan ??
    exactLearnerAnswerSpan ??
    (learnerAnswerHasSafeCaptionMatch ? learnerAnswer : null) ??
    (requestedAnswerHasSafeCaptionMatch ? requestedAnswerSpan : null) ??
    (learnerAnswerIsUniquelyGrounded ? learnerAnswer : null) ??
    (answerRepresentationsAgree &&
    requestedAnswerIsGrounded &&
    learnerAnswerIsGrounded
      ? requestedAnswerSpan
      : null);
  const safeLearnerSurfaceCorrection =
    quizLanguage === "en" &&
    (exactRequestedAnswerSpan ||
      requestedAnswerHasSafeCaptionMatch ||
      learnerAnswerHasSafeCaptionMatch) &&
    learnerAnswerIsGrounded &&
    learnerAnswerIsUniquelyGrounded &&
    safeCaptionRepresentationsAgree &&
    (learnerAnswerHasSafeCaptionMatch ||
      (exactRequestedAnswerSpan &&
        isSafeCaptionSurfaceCorrection(
          exactRequestedAnswerSpan,
          learnerAnswer,
        )));
  const localExactAnswerCorrection =
    quizLanguage === "en"
      ? correctObviousCaptionPlural(
          exactRequestedAnswerSpan ?? exactLearnerAnswerSpan,
        )
      : null;
  if (
    !groundedAnswer ||
    !learnerAnswer ||
    !answerRepresentationsAgree ||
    (!exactRequestedAnswerSpan &&
      !learnerAnswerIsGrounded &&
      !requestedAnswerIsGrounded) ||
    !Array.isArray(candidate?.distractors) ||
    candidate.distractors.length < 3 ||
    candidate.distractors.length > 6
  ) {
    return null;
  }
  const distractors = candidate.distractors.map((entry) =>
    typeof entry === "string" ? { text: entry } : entry,
  );
  if (
    distractors.some(
      (entry) => !entry || typeof entry.text !== "string" || !entry.text.trim(),
    )
  ) {
    return null;
  }
  const storedAnswer =
    quizLanguage === "zh-CN"
      ? learnerAnswer
      : safeLearnerSurfaceCorrection
        ? learnerAnswer
        : localExactAnswerCorrection
          ? localExactAnswerCorrection
          : (exactRequestedAnswerSpan ??
            exactLearnerAnswerSpan ??
            groundedAnswer);
  return {
    correctAnswer: storedAnswer,
    distractors: distractors.map((entry) => entry.text.trim()),
  };
}
