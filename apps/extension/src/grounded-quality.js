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

// Presentation vehicles are not assessment concepts. Keep this deliberately
// narrow so technical uses such as a network link or a DNA strand remain
// available, while the production metaphors that previously leaked into
// answer controls fail before storage.
const FIGURATIVE_PRESENTATION_SCAFFOLD_PATTERNS = [
  /\b(?:weav(?:e|es|ing|en)|tapestr(?:y|ies)|unravel(?:s|ed|ing)?)\b/iu,
  /\b(?:cut(?:ting)?\s+(?:too\s+)?many\s+links?|every\s+link\s+(?:provides|gives|adds)\s+stability)\b/iu,
  /\b(?:entire\s+)?fabric\s+of\s+(?:the\s+)?(?:reef|ecosystem|community|life|nature)\b/iu,
  /\bjacket\s+of\s+gases\b/iu,
  /(?:编织|织网|织物|线头|解开整张网|生态系统的结构|生态网络|气体外套)/u,
];

const HOW_CAN_QUESTION_PATTERN = /^\s*how\s+(?:can|could|may|might)\b/iu;
const CONCESSIVE_NON_ANSWER_PATTERN =
  /^\s*(?:(?:it|they|this|that)\s+(?:can|could|may|might)\s+)?even\s+(?:without|despite|when|if)\b/iu;
const MALFORMED_WH_ACTION_STEM_PATTERN =
  /^\s*what\s+(?:condition|factor|cause|process|method)\s+(?:do|does|did|can|could|will|would)\b.{0,160}\b(?:provide|support|affect|influence|enable|allow)\b/iu;
const PLURAL_HOW_SINGULAR_PRONOUN_PATTERN =
  /^\s*how\s+(?:do|can|could|may|might)\b/iu;
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
 * fail closed and consume the normal targeted repair budget.
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
  const explanation =
    directExplanation &&
    normalizeGroundedText(directExplanation) !==
      normalizeGroundedText(resolvedSupported)
      ? directExplanation
      : `This statement is accurate: ${resolvedSupported}`;
  if (preferredPolarity === false) {
    const mutation = localFalseMutation(resolvedSupported);
    if (mutation) {
      return {
        question: mutation.question,
        answer: false,
        correction: resolvedSupported,
        explanation,
        mutationKind: "local_allowlisted",
      };
    }
  }
  return {
    question: resolvedSupported,
    answer: true,
    correction: resolvedSupported,
    explanation,
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
