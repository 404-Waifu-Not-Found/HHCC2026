function cleanCaptionText(value) {
  return String(value ?? "")
    .replaceAll("\n", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedWord(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function repeatedPrefixLength(existingWords, incomingWords) {
  const maximum = Math.min(existingWords.length, incomingWords.length, 80);
  for (let length = maximum; length >= 3; length -= 1) {
    const existingStart = existingWords.length - length;
    let matches = true;
    for (let index = 0; index < length; index += 1) {
      const existing = normalizedWord(existingWords[existingStart + index]);
      const incoming = normalizedWord(incomingWords[index]);
      if (!existing || existing !== incoming) {
        matches = false;
        break;
      }
    }
    if (matches) return length;
  }
  return 0;
}

export function captionsToPlainText(segments) {
  const ordered = (Array.isArray(segments) ? segments : [])
    .map((segment, index) => ({
      index,
      startMs: Number(segment?.startMs),
      text: cleanCaptionText(segment?.text),
    }))
    .filter((segment) => segment.text)
    .sort((left, right) => {
      const leftStart = Number.isFinite(left.startMs)
        ? left.startMs
        : Number.MAX_SAFE_INTEGER;
      const rightStart = Number.isFinite(right.startMs)
        ? right.startMs
        : Number.MAX_SAFE_INTEGER;
      return leftStart - rightStart || left.index - right.index;
    });

  const words = [];
  let previousText = "";
  for (const segment of ordered) {
    if (segment.text === previousText) continue;
    previousText = segment.text;
    const incoming = segment.text.split(" ");
    const overlap = repeatedPrefixLength(words, incoming);
    words.push(...incoming.slice(overlap));
  }
  return cleanCaptionText(words.join(" "));
}
