const SAFE_INTERROGATIVE_LOOKAHEAD =
  "(?=what|which|how|why|when|where|who|is|are|does|do|can|should|explain|describe|identify|calculate|determine|define)";
const SOURCE_NOUN =
  "(?:lesson|video|lecture|lecturer|course|class|transcript|episode|presentation|presenter|instructor|teacher|professor|speaker|narrator)";
const SAFE_DELIMITER = "(?:\\s*[,;:\\-–—]\\s*|\\s+)";
const SOURCE_FRAMING_PREFIXES = [
  new RegExp(
    `^\\s*(?:(?:according to|based on)\\s+(?:the\\s+)?${SOURCE_NOUN}|(?:in|from)\\s+(?:(?:the|this|that)\\s+)?${SOURCE_NOUN})(?!['’]s)\\b${SAFE_DELIMITER}${SAFE_INTERROGATIVE_LOOKAHEAD}`,
    "iu",
  ),
  new RegExp(
    `^\\s*(?:the\\s+)?${SOURCE_NOUN}(?!['’]s)\\b\\s+(?:says?|states?|mentions?|explains?|shows?|demonstrates?|teaches?|supports?|describes?)\\s+(?:that\\s+)?`,
    "iu",
  ),
  /^\s*(?:the\s+)?(?:evidence|reference material)(?:\s+directly|\s+clearly|\s+specifically)?\s+(?:says?|states?|shows?|supports?|describes?)\s+(?:that\s+)?/iu,
  /^\s*(?:根据|按照|依照)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示|老师|讲师|主讲人)(?:[，,:：;；\-–—]\s*|\s+(?=什么|如何|为什么|哪|谁|是否|请|解释|描述|计算|确定|定义))/u,
  /^\s*(?:在|从)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示)中(?:[，,:：;；\-–—]\s*|\s+(?=什么|如何|为什么|哪|谁|是否|请|解释|描述|计算|确定|定义))/u,
];

/**
 * Remove empty recording attribution from a learner-facing prompt while
 * preserving the complete tested claim. Generation validation owns content
 * quality; this presentation guard also cleans older stored attempts.
 */
export function presentQuizText(value: string): string {
  const original = value.normalize("NFC").replace(/\s+/g, " ").trim();
  for (const prefix of SOURCE_FRAMING_PREFIXES) {
    const match = original.match(prefix);
    if (!match) continue;
    const remainder = original.slice(match[0].length).trim();
    if (!remainder) return original;
    return remainder.replace(
      /^([^\p{L}]*)(\p{Ll})/u,
      (_match, leading: string, letter: string) =>
        `${leading}${letter.toLocaleUpperCase("en-US")}`,
    );
  }
  return original;
}

export const presentQuizPrompt = presentQuizText;
