type MathToken = (
  | { type: "identifier"; value: string }
  | { type: "number"; value: string }
  | {
      type:
        | "plus"
        | "minus"
        | "multiply"
        | "divide"
        | "power"
        | "left"
        | "right"
        | "prime"
        | "boundary";
    }
) & { attached?: boolean };

type MathNode =
  | { kind: "atom"; value: string }
  | { kind: "negate"; value: MathNode }
  | { kind: "add"; terms: Array<{ sign: 1 | -1; value: MathNode }> }
  | { kind: "multiply"; factors: MathNode[] }
  | { kind: "divide"; numerator: MathNode; denominator: MathNode }
  | { kind: "power"; base: MathNode; exponent: MathNode };

type FormulaCandidate = {
  fingerprint: string;
  score: number;
  tokenCount: number;
};

export type FormulaComparison = "not_formula" | "match" | "mismatch";

const MAX_MATH_INPUT_LENGTH = 2_000;
const MAX_MATH_TOKENS = 256;
const MAX_CANDIDATE_TOKENS = 80;
const MIN_SIGNIFICANT_FORMULA_SCORE = 18;
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
};

/**
 * Compare a learner formula with the structurally significant formulas found
 * in the stored reference answers. This deliberately performs structural,
 * bounded comparison rather than symbolic algebra: signs, denominators, and
 * exponents remain grading-significant.
 */
export function compareFormulaAnswer(
  learnerAnswer: string,
  referenceAnswers: string[],
): FormulaComparison {
  const references = referenceAnswers
    .map((answer) => extractFormulaCandidate(answer))
    .filter((candidate): candidate is FormulaCandidate => Boolean(candidate));
  if (references.length === 0) return "not_formula";

  const learner = extractFormulaCandidate(learnerAnswer);
  if (!learner) return "mismatch";
  return references.some(
    (reference) => reference.fingerprint === learner.fingerprint,
  )
    ? "match"
    : "mismatch";
}

export function formulaFingerprint(value: string): string | null {
  return extractFormulaCandidate(value)?.fingerprint ?? null;
}

function extractFormulaCandidate(value: string): FormulaCandidate | null {
  const groups = tokenizeMath(value).reduce<MathToken[][]>(
    (output, token) => {
      if (token.type === "boundary") {
        if (output.at(-1)?.length) output.push([]);
        return output;
      }
      output.at(-1)?.push(token);
      return output;
    },
    [[]],
  );

  let best: FormulaCandidate | null = null;
  for (const group of groups) {
    const maximumEnd = group.length;
    for (let start = 0; start < maximumEnd; start += 1) {
      const limit = Math.min(maximumEnd, start + MAX_CANDIDATE_TOKENS);
      for (let end = start + 1; end <= limit; end += 1) {
        const tokens = group.slice(start, end);
        if (!hasStructuralToken(tokens)) continue;
        const parsed = new MathParser(tokens).parse();
        if (!parsed) continue;
        const score = formulaComplexity(parsed);
        if (score < MIN_SIGNIFICANT_FORMULA_SCORE) continue;
        const candidate = {
          fingerprint: canonicalExpression(parsed),
          score,
          tokenCount: tokens.length,
        };
        if (
          !best ||
          candidate.score > best.score ||
          (candidate.score === best.score &&
            candidate.tokenCount > best.tokenCount)
        ) {
          best = candidate;
        }
      }
    }
  }
  return best;
}

function normalizeMathInput(value: string): string {
  const bounded = value.slice(0, MAX_MATH_INPUT_LENGTH);
  const explicitSuperscripts = bounded.replace(
    /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/gu,
    (run) =>
      `^(${[...run].map((character) => SUPERSCRIPT_DIGITS[character]).join("")})`,
  );
  return explicitSuperscripts
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[′’‵]/gu, "'")
    .replace(/[−–—﹣－]/gu, "-")
    .replace(/[×·∙⋅＊]/gu, "*")
    .replace(/[÷／]/gu, "/")
    .replace(/[\[［【〔｛{]/gu, "(")
    .replace(/[\]］】〕｝}]/gu, ")")
    .replace(
      /\bd\s*([\p{L}][\p{L}\p{N}_]*)\s*\/\s*d\s*([\p{L}][\p{L}\p{N}_]*)\b/giu,
      (_match, dependent: string) => `${dependent}'`,
    );
}

function tokenizeMath(value: string): MathToken[] {
  const input = normalizeMathInput(value);
  const tokens: MathToken[] = [];
  let index = 0;
  let separatedFromPrevious = true;
  const push = (token: MathToken) => {
    if (tokens.length < MAX_MATH_TOKENS) {
      tokens.push({ ...token, attached: !separatedFromPrevious });
    }
    separatedFromPrevious = false;
  };
  const pushBoundary = () => {
    if (tokens.at(-1)?.type !== "boundary") {
      tokens.push({ type: "boundary" });
    }
    separatedFromPrevious = true;
  };

  while (index < input.length && tokens.length < MAX_MATH_TOKENS) {
    const character = input[index]!;
    if (/\s/u.test(character)) {
      separatedFromPrevious = true;
      index += 1;
      continue;
    }
    if (/[\p{L}_]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < input.length && /[\p{L}\p{N}_]/u.test(input[index]!)) {
        index += 1;
      }
      const identifier = input.slice(start, index);
      if (/^[uv]{2,4}$/u.test(identifier)) {
        for (const variable of identifier) {
          push({ type: "identifier", value: variable });
        }
      } else {
        push({ type: "identifier", value: identifier });
      }
      continue;
    }
    if (
      /\d/u.test(character) ||
      (character === "." && /\d/u.test(input[index + 1] ?? ""))
    ) {
      const start = index;
      index += 1;
      while (/\d/u.test(input[index] ?? "")) index += 1;
      if (input[index] === ".") {
        index += 1;
        while (/\d/u.test(input[index] ?? "")) index += 1;
      }
      push({ type: "number", value: input.slice(start, index) });
      continue;
    }
    const simpleToken: Record<string, MathToken["type"]> = {
      "+": "plus",
      "-": "minus",
      "*": "multiply",
      "/": "divide",
      "^": "power",
      "(": "left",
      ")": "right",
      "'": "prime",
    };
    const type = simpleToken[character];
    if (type) push({ type } as MathToken);
    else pushBoundary();
    index += 1;
  }
  return tokens;
}

function hasStructuralToken(tokens: MathToken[]): boolean {
  return tokens.some((token) =>
    ["plus", "minus", "multiply", "divide", "power", "prime"].includes(
      token.type,
    ),
  );
}

class MathParser {
  private index = 0;

  constructor(private readonly tokens: MathToken[]) {}

  parse(): MathNode | null {
    try {
      const expression = this.parseAdd();
      return expression && this.index === this.tokens.length
        ? expression
        : null;
    } catch {
      return null;
    }
  }

  private parseAdd(): MathNode | null {
    const first = this.parseMultiply();
    if (!first) return null;
    const terms: Array<{ sign: 1 | -1; value: MathNode }> = [
      { sign: 1, value: first },
    ];
    while (this.peek("plus") || this.peek("minus")) {
      const sign = this.consume()!.type === "minus" ? -1 : 1;
      const value = this.parseMultiply();
      if (!value) throw new Error("Missing additive term");
      terms.push({ sign, value });
    }
    return terms.length === 1 ? first : { kind: "add", terms };
  }

  private parseMultiply(): MathNode | null {
    const first = this.parseUnary();
    if (!first) return null;
    let value = first;
    const factors: MathNode[] = [first];
    while (this.index < this.tokens.length) {
      if (this.peek("multiply")) {
        this.consume();
        const factor = this.parseUnary();
        if (!factor) throw new Error("Missing product factor");
        factors.push(factor);
        value = { kind: "multiply", factors: [...factors] };
        continue;
      }
      if (this.peek("divide")) {
        this.consume();
        const denominator = this.parseUnary();
        if (!denominator) throw new Error("Missing denominator");
        value = { kind: "divide", numerator: value, denominator };
        factors.splice(0, factors.length, value);
        continue;
      }
      if (this.startsPrimary()) {
        const factor = this.parseUnary();
        if (!factor) throw new Error("Missing implicit product factor");
        factors.push(factor);
        value = { kind: "multiply", factors: [...factors] };
        continue;
      }
      break;
    }
    return value;
  }

  private parseUnary(): MathNode | null {
    if (this.peek("plus")) {
      this.consume();
      return this.parseUnary();
    }
    if (this.peek("minus")) {
      this.consume();
      const value = this.parseUnary();
      if (!value) throw new Error("Missing negated expression");
      return { kind: "negate", value };
    }
    return this.parsePower();
  }

  private parsePower(): MathNode | null {
    const base = this.parsePrimary();
    if (!base) return null;
    if (!this.peek("power")) return base;
    this.consume();
    const exponent = this.parseUnary();
    if (!exponent) throw new Error("Missing exponent");
    return { kind: "power", base, exponent };
  }

  private parsePrimary(): MathNode | null {
    const token = this.tokens[this.index];
    if (!token) return null;
    if (token.type === "number") {
      this.index += 1;
      return { kind: "atom", value: normalizeNumber(token.value) };
    }
    if (token.type === "identifier") {
      this.index += 1;
      let derivativeOrder = 0;
      while (this.peek("prime")) {
        derivativeOrder += 1;
        this.consume();
      }
      const value: MathNode = {
        kind: "atom",
        value: derivativeOrder
          ? `derivative:${derivativeOrder}:${token.value}`
          : `identifier:${token.value}`,
      };
      // Function arguments identify the point of evaluation, but the generated
      // canonical answers use u/v as the function symbols. Consuming the
      // argument makes u(x), u'(x), and u/u' compare consistently.
      while (this.peek("left") && this.tokens[this.index]?.attached === true) {
        this.consume();
        const argument = this.parseAdd();
        if (!argument || !this.peek("right")) {
          throw new Error("Invalid function argument");
        }
        this.consume();
      }
      return value;
    }
    if (token.type === "left") {
      this.index += 1;
      const value = this.parseAdd();
      if (!value || !this.peek("right")) {
        throw new Error("Unbalanced grouping");
      }
      this.consume();
      return value;
    }
    return null;
  }

  private startsPrimary(): boolean {
    const type = this.tokens[this.index]?.type;
    return type === "identifier" || type === "number" || type === "left";
  }

  private peek(type: MathToken["type"]): boolean {
    return this.tokens[this.index]?.type === type;
  }

  private consume(): MathToken | undefined {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }
}

function normalizeNumber(value: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : value;
}

function formulaComplexity(node: MathNode): number {
  switch (node.kind) {
    case "atom": {
      const identifier = node.value.split(":").at(-1) ?? "";
      const prosePenalty =
        (node.value.startsWith("identifier:") ||
          node.value.startsWith("derivative:")) &&
        !isMathIdentifier(identifier)
          ? 40
          : 0;
      const derivativeBonus = node.value.startsWith("derivative:") ? 10 : 0;
      return 1 + derivativeBonus - prosePenalty;
    }
    case "negate":
      return 3 + formulaComplexity(node.value);
    case "add":
      return (
        10 * (node.terms.length - 1) +
        node.terms.reduce(
          (total, term) => total + formulaComplexity(term.value),
          0,
        )
      );
    case "multiply":
      return (
        4 * (node.factors.length - 1) +
        node.factors.reduce(
          (total, factor) => total + formulaComplexity(factor),
          0,
        )
      );
    case "divide":
      return (
        12 +
        formulaComplexity(node.numerator) +
        formulaComplexity(node.denominator)
      );
    case "power":
      return (
        10 + formulaComplexity(node.base) + formulaComplexity(node.exponent)
      );
  }
}

function isMathIdentifier(value: string): boolean {
  return (
    /^\p{L}$/u.test(value) || /^(?:sin|cos|tan|log|ln|exp|sqrt)$/u.test(value)
  );
}

function canonicalExpression(node: MathNode): string {
  const terms = flattenSignedTerms(node, 1).map((term) => {
    const normalized = canonicalSigned(term.value);
    const sign = term.sign * normalized.sign;
    return { sign, key: normalized.key };
  });
  terms.sort((left, right) =>
    left.key === right.key
      ? left.sign - right.sign
      : left.key.localeCompare(right.key),
  );
  return `sum(${terms
    .map((term) => `${term.sign === 1 ? "+" : "-"}${term.key}`)
    .join("|")})`;
}

function flattenSignedTerms(
  node: MathNode,
  sign: 1 | -1,
): Array<{ sign: 1 | -1; value: MathNode }> {
  if (node.kind === "negate") {
    return flattenSignedTerms(node.value, sign === 1 ? -1 : 1);
  }
  if (node.kind !== "add") return [{ sign, value: node }];
  return node.terms.flatMap((term) =>
    flattenSignedTerms(term.value, sign === term.sign ? 1 : -1),
  );
}

function canonicalSigned(node: MathNode): { sign: 1 | -1; key: string } {
  if (node.kind === "negate") {
    const nested = canonicalSigned(node.value);
    return { sign: nested.sign === 1 ? -1 : 1, key: nested.key };
  }
  if (node.kind === "atom") return { sign: 1, key: `atom(${node.value})` };
  if (node.kind === "add") {
    return { sign: 1, key: canonicalExpression(node) };
  }
  if (node.kind === "multiply" || node.kind === "divide") {
    return canonicalRationalProduct(node);
  }
  const base = canonicalSigned(node.base);
  const exponent = canonicalSigned(node.exponent);
  return {
    sign: base.sign,
    key: `power(${base.key}|${exponent.sign === 1 ? "+" : "-"}${exponent.key})`,
  };
}

/**
 * Multiplication and division share one canonical numerator/denominator form.
 * This keeps denominator placement significant while making equivalent forms
 * such as `(1/x)(1/y)` and `1/x * 1/y` compare identically.
 */
function canonicalRationalProduct(node: MathNode): {
  sign: 1 | -1;
  key: string;
} {
  let sign: 1 | -1 = 1;
  const numeratorFactors: string[] = [];
  const denominatorFactors: string[] = [];

  const collect = (value: MathNode, inverted: boolean): void => {
    if (value.kind === "negate") {
      sign = sign === 1 ? -1 : 1;
      collect(value.value, inverted);
      return;
    }
    if (value.kind === "multiply") {
      for (const factor of value.factors) collect(factor, inverted);
      return;
    }
    if (value.kind === "divide") {
      collect(value.numerator, inverted);
      collect(value.denominator, !inverted);
      return;
    }

    const normalized = canonicalSigned(value);
    if (normalized.sign === -1) sign = sign === 1 ? -1 : 1;
    (inverted ? denominatorFactors : numeratorFactors).push(normalized.key);
  };

  collect(node, false);
  const one = "atom(1)";
  const numerator = normalizedProductKey(numeratorFactors, one);
  const denominator = normalizedProductKey(denominatorFactors, "");
  return {
    sign,
    key: denominator ? `divide(${numerator}|${denominator})` : numerator,
  };
}

function normalizedProductKey(factors: string[], emptyValue: string): string {
  const significant = factors.filter((factor) => factor !== "atom(1)");
  significant.sort((left, right) => left.localeCompare(right));
  if (significant.length === 0) return emptyValue;
  return significant.length === 1
    ? significant[0]!
    : `product(${significant.join("|")})`;
}
