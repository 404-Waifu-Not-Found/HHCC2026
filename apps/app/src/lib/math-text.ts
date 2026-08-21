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
  const hasOperator = /(?:[=+*/^×÷≤≥≈]|\s-\s|->|<=|>=)/u.test(compact);
  const hasOperand = /[\p{L}\p{N}][\p{L}\p{N}_']*\s*(?:\([^)]*\))?/u.test(
    compact,
  );
  const hasFormulaShape =
    /\([^()]+\)\s*\/\s*\([^()]+\)/u.test(compact) ||
    /(?:\p{L}|\d)\s*\^\s*[+\-]?\d+/u.test(compact) ||
    /(?:d\p{L}\s*\/\s*d\p{L}|\p{L}'\s*\(?\p{L}?\)?)/u.test(compact);
  return hasOperand && (hasOperator || hasFormulaShape);
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
