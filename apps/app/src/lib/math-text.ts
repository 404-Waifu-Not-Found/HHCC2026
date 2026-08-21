const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
};

const STANDALONE_MATH_IDENTIFIERS = new Set([
  "abs",
  "acos",
  "alpha",
  "asin",
  "atan",
  "beta",
  "cos",
  "cosh",
  "cot",
  "csc",
  "delta",
  "det",
  "exp",
  "gamma",
  "gcd",
  "inf",
  "lambda",
  "lim",
  "ln",
  "log",
  "max",
  "min",
  "mod",
  "omega",
  "phi",
  "pi",
  "psi",
  "sec",
  "sigma",
  "sin",
  "sinh",
  "sqrt",
  "sup",
  "tan",
  "tanh",
  "theta",
]);

export function isMathExpressionText(value: string): boolean {
  const compact = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!compact || compact.length > 700) return false;
  const hasExplicitMath =
    /\$[^$\n]+\$|\\\([^\n]+?\\\)/u.test(compact) ||
    /\b[\p{L}][\p{L}\p{M}\p{N}_']*\s+(?:approaches|tends\s+to)\s+(?:[+\-]?\d+(?:\.\d+)?|infinity|∞)\b/iu.test(
      compact,
    );
  const hasOperator = /(?:[=+*/^×÷≤≥≈]|\s-\s|->|<=|>=)/u.test(compact);
  const hasOperand = /[\p{L}\p{N}][\p{L}\p{N}_']*\s*(?:\([^)]*\))?/u.test(
    compact,
  );
  const hasDerivativeShape =
    /(?:^|[^\p{L}\p{M}\p{N}_])(?:d\p{L}\s*\/\s*d\p{L}|\p{L}'(?:\s*\(\s*\p{L}\s*\))?)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(
      compact,
    );
  const hasFormulaShape =
    /\([^()]+\)\s*\/\s*\([^()]+\)/u.test(compact) ||
    /(?:\p{L}|\d)\s*\^\s*[+\-]?\d+/u.test(compact) ||
    hasDerivativeShape;
  // A slash is common prose punctuation ("yes/no", "true/false",
  // "input/output"). Do not send those labels through KaTeX merely because
  // they contain two word operands and `/`.
  const ordinaryWordSlash =
    /\b[\p{L}\p{M}]{3,}\s*\/\s*[\p{L}\p{M}]{3,}\b/u.test(compact);
  if (
    ordinaryWordSlash &&
    !hasExplicitMath &&
    !hasFormulaShape &&
    !/\d/u.test(compact)
  ) {
    return false;
  }
  return hasExplicitMath || (hasOperand && (hasOperator || hasFormulaShape));
}

/**
 * Returns true only when the complete value reads as a mathematical
 * expression. A sentence can contain valid math without surrendering its
 * display/body typeface to monospace.
 */
export function isStandaloneMathExpressionText(value: string): boolean {
  const compact = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!isMathExpressionText(compact) || /[!?。！？]/u.test(compact)) {
    return false;
  }

  const identifiers = compact.match(/\p{L}[\p{L}\p{M}]*/gu) ?? [];
  return identifiers.every((identifier) => {
    const normalized = identifier.toLocaleLowerCase("en-US");
    return (
      [...normalized].length <= 2 || STANDALONE_MATH_IDENTIFIERS.has(normalized)
    );
  });
}

export function formatMathText(value: string): string {
  if (!isMathExpressionText(value)) return value;
  return value
    .normalize("NFC")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/->/g, "→")
    .replace(/(?<=[\p{L}\p{N})\]])\s*\*\s*(?=[\p{L}\p{N}(\[])/gu, " · ")
    .replace(/\^([+\-]?\d+)/g, (_match, exponent: string) =>
      [...exponent]
        .map((character) => SUPERSCRIPTS[character] ?? character)
        .join(""),
    );
}

export type MathTextSegment = {
  text: string;
  mathematical: boolean;
};

const MATH_FUNCTIONS = [
  "arccos",
  "arcsin",
  "arctan",
  "cosh",
  "sinh",
  "tanh",
  "acos",
  "asin",
  "atan",
  "sqrt",
  "cos",
  "cot",
  "csc",
  "det",
  "exp",
  "gcd",
  "lim",
  "ln",
  "log",
  "max",
  "min",
  "sec",
  "sin",
  "sup",
  "tan",
] as const;

const GREEK_IDENTIFIERS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "lambda",
  "omega",
  "phi",
  "pi",
  "psi",
  "sigma",
  "theta",
] as const;

const PARENTHESIZED_EXPRESSION = String.raw`\((?:[^()]|\([^()]*\))+\)`;
const SIMPLE_MATH_ATOM = String.raw`[+\-]?(?:\d+(?:\.\d+)?|[\p{L}][\p{L}\p{M}\p{N}_']*(?:\([^)]*\))?)`;
const APPROACH_SUFFIX = String.raw`(?:\s+(?:approaches|tends\s+to)\s+(?:[+\-]?\d+(?:\.\d+)?|infinity|∞))?`;

const INLINE_EXPRESSION_PATTERNS = [
  new RegExp(String.raw`\$[^$\n]+\$|\\\([^\n]+?\\\)`, "gu"),
  new RegExp(
    String.raw`${PARENTHESIZED_EXPRESSION}\s*\/\s*(?:${PARENTHESIZED_EXPRESSION}|${SIMPLE_MATH_ATOM})${APPROACH_SUFFIX}`,
    "giu",
  ),
  /\b[\p{L}][\p{L}\p{M}\p{N}_']*\s+(?:approaches|tends\s+to)\s+(?:[+\-]?\d+(?:\.\d+)?|infinity|∞)\b/giu,
  new RegExp(
    String.raw`(?:d\p{L}\s*\/\s*d\p{L}|\p{L}[\p{L}\p{M}\p{N}_]*'?(?:\([^)]*\))?|\d+(?:\.\d+)?)\s*(?:=|\+|-|\*|\/|\^|×|÷|≤|≥|≈|->|<=|>=)\s*(?:(?:d\p{L}\s*\/\s*d\p{L}|\p{L}[\p{L}\p{M}\p{N}_]*'?(?:\([^)]*\))?|\d+(?:\.\d+)?)(?:\s*(?:=|\+|-|\*|\/|\^|×|÷|≤|≥|≈|->|<=|>=)\s*(?:d\p{L}\s*\/\s*d\p{L}|\p{L}[\p{L}\p{M}\p{N}_]*'?(?:\([^)]*\))?|\d+(?:\.\d+)?))*)`,
    "giu",
  ),
] as const;

type MathRange = {
  start: number;
  end: number;
};

function mathRanges(value: string): MathRange[] {
  const candidates: MathRange[] = [];
  for (const pattern of INLINE_EXPRESSION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const start = match.index ?? 0;
      const text = match[0];
      if (!text) continue;
      const alphabeticHyphen =
        /^[\p{L}\p{M}]+-[\p{L}\p{M}]+$/u.test(text) &&
        !/^\p{L}-\p{L}$/u.test(text);
      if (alphabeticHyphen) continue;
      candidates.push({ start, end: start + text.length });
    }
  }

  candidates.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return right.end - right.start - (left.end - left.start);
  });

  const selected: MathRange[] = [];
  for (const candidate of candidates) {
    const overlaps = selected.some(
      (range) => candidate.start < range.end && candidate.end > range.start,
    );
    if (!overlaps) selected.push(candidate);
  }
  return selected.sort((left, right) => left.start - right.start);
}

function stripOneOuterPair(value: string): string {
  const compact = value.trim();
  if (!compact.startsWith("(") || !compact.endsWith(")")) return compact;
  let depth = 0;
  for (let index = 0; index < compact.length; index += 1) {
    const character = compact[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && index < compact.length - 1) return compact;
  }
  return compact.slice(1, -1).trim();
}

function topLevelDivisionIndex(value: string): number {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "/" && depth === 0) return index;
  }
  return -1;
}

/** Convert the deliberately small plaintext math dialect used by generated
 * questions into safe KaTeX input. This is presentation-only: it never
 * changes stored questions, submitted answers, or grading expressions. */
export function mathTextToLatex(value: string): string {
  let compact = value.normalize("NFC").trim();
  if (compact.startsWith("$") && compact.endsWith("$")) {
    return compact.slice(1, -1).trim();
  }
  if (compact.startsWith("\\(") && compact.endsWith("\\)")) {
    return compact.slice(2, -2).trim();
  }

  const approach = compact.match(
    /^(.*?)\s+(?:approaches|tends\s+to)\s+([+\-]?\d+(?:\.\d+)?|infinity|∞)$/iu,
  );
  if (approach?.[1] && approach[2]) {
    const target = /^(?:infinity|∞)$/iu.test(approach[2])
      ? "\\infty"
      : approach[2];
    return `${mathTextToLatex(approach[1])} \\to ${target}`;
  }

  const divisionIndex = topLevelDivisionIndex(compact);
  if (divisionIndex > 0 && divisionIndex < compact.length - 1) {
    const numerator = stripOneOuterPair(compact.slice(0, divisionIndex));
    const denominator = stripOneOuterPair(compact.slice(divisionIndex + 1));
    return `\\frac{${mathTextToLatex(numerator)}}{${mathTextToLatex(denominator)}}`;
  }

  let latex = compact
    .replace(/<=/g, "\\le ")
    .replace(/>=/g, "\\ge ")
    .replace(/->/g, "\\to ")
    .replace(/≤/g, "\\le ")
    .replace(/≥/g, "\\ge ")
    .replace(/≈/g, "\\approx ")
    .replace(/×/g, "\\times ")
    .replace(/÷/g, "\\div ")
    .replace(/\*/g, "\\cdot ")
    .replace(/∞/g, "\\infty ")
    .replace(/%/g, "\\%")
    .replace(/√\s*\(([^()]*)\)/gu, "\\sqrt{$1}")
    .replace(/\bsqrt\s*\(([^()]*)\)/giu, "\\sqrt{$1}");

  for (const identifier of MATH_FUNCTIONS) {
    if (identifier === "sqrt") continue;
    latex = latex.replace(
      new RegExp(String.raw`\b${identifier}\b`, "giu"),
      `\\${identifier}`,
    );
  }
  for (const identifier of GREEK_IDENTIFIERS) {
    latex = latex.replace(
      new RegExp(String.raw`\b${identifier}\b`, "giu"),
      `\\${identifier}`,
    );
  }
  return latex.replace(/\s+/g, " ").trim();
}

/**
 * Split prose from inline formulas so a formula can use a technical face
 * without turning the learner's entire question into monospaced text.
 */
export function segmentMathText(value: string): MathTextSegment[] {
  if (!isMathExpressionText(value)) {
    return [{ text: value, mathematical: false }];
  }
  if (isStandaloneMathExpressionText(value)) {
    return [{ text: formatMathText(value), mathematical: true }];
  }

  const segments: MathTextSegment[] = [];
  let cursor = 0;
  for (const range of mathRanges(value)) {
    const expression = value.slice(range.start, range.end);
    if (range.start > cursor) {
      segments.push({
        text: value.slice(cursor, range.start),
        mathematical: false,
      });
    }
    segments.push({ text: expression, mathematical: true });
    cursor = range.end;
  }
  if (cursor < value.length) {
    segments.push({ text: value.slice(cursor), mathematical: false });
  }
  return segments.length
    ? segments
    : [{ text: formatMathText(value), mathematical: false }];
}
