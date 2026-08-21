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
