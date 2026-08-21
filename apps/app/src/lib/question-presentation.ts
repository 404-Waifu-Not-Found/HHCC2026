const SOURCE_FRAMING_PREFIXES = [
  /^\s*(?:(?:according to|based on)\s+(?:the|this|that)?\s*(?:lesson|video|lecture|course|class|transcript|episode|presentation)|(?:in|from)\s+(?:the|this|that)?\s*(?:lesson|video|lecture|course|class|transcript|episode|presentation))\s*[,;:\-]?\s*/iu,
  /^\s*(?:根据|按照|依照)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示)[，,:：;；\-]?\s*/u,
  /^\s*(?:在|从)(?:本|该|这个|这段)?(?:课|课程|视频|讲座|讲解|字幕|演示)中[，,:：;；\-]?\s*/u,
];

/**
 * Remove empty recording attribution from a learner-facing prompt while
 * preserving the complete tested claim. Generation validation owns content
 * quality; this presentation guard also cleans older stored attempts.
 */
export function presentQuizPrompt(value: string): string {
  let result = value.normalize("NFC").trim();
  for (const prefix of SOURCE_FRAMING_PREFIXES) {
    result = result.replace(prefix, "");
  }
  return result
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^([^\p{L}]*)(\p{Ll})/u,
      (_match, leading: string, letter: string) =>
        `${leading}${letter.toLocaleUpperCase("en-US")}`,
    );
}
