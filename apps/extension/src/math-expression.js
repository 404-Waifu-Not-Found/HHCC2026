const MAX_MATH_INPUT_LENGTH = 2_000;
const MAX_MATH_TOKENS = 256;
const MAX_CANDIDATE_TOKENS = 80;
const MIN_SIGNIFICANT_FORMULA_SCORE = 18;
const SUPERSCRIPT_DIGITS = {
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

export function formulaFingerprint(value) {
  return extractFormulaCandidate(value)?.fingerprint ?? null;
}

function extractFormulaCandidate(value) {
  const groups = tokenizeMath(value).reduce(
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
  let best = null;
  for (const group of groups) {
    for (let start = 0; start < group.length; start += 1) {
      const limit = Math.min(group.length, start + MAX_CANDIDATE_TOKENS);
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

function normalizeMathInput(value) {
  return String(value ?? "")
    .slice(0, MAX_MATH_INPUT_LENGTH)
    .replace(
      /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/gu,
      (run) =>
        `^(${[...run].map((character) => SUPERSCRIPT_DIGITS[character]).join("")})`,
    )
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
      (_match, dependent) => `${dependent}'`,
    );
}

function tokenizeMath(value) {
  const input = normalizeMathInput(value);
  const tokens = [];
  let index = 0;
  let separatedFromPrevious = true;
  const push = (token) => {
    if (tokens.length < MAX_MATH_TOKENS) {
      tokens.push({ ...token, attached: !separatedFromPrevious });
    }
    separatedFromPrevious = false;
  };
  const pushBoundary = () => {
    if (tokens.at(-1)?.type !== "boundary") tokens.push({ type: "boundary" });
    separatedFromPrevious = true;
  };
  while (index < input.length && tokens.length < MAX_MATH_TOKENS) {
    const character = input[index];
    if (/\s/u.test(character)) {
      separatedFromPrevious = true;
      index += 1;
      continue;
    }
    if (/[\p{L}_]/u.test(character)) {
      const start = index++;
      while (index < input.length && /[\p{L}\p{N}_]/u.test(input[index])) {
        index += 1;
      }
      const identifier = input.slice(start, index);
      if (/^[uv]{2,4}$/u.test(identifier)) {
        for (const variable of identifier)
          push({ type: "identifier", value: variable });
      } else push({ type: "identifier", value: identifier });
      continue;
    }
    if (
      /\d/u.test(character) ||
      (character === "." && /\d/u.test(input[index + 1] ?? ""))
    ) {
      const start = index++;
      while (/\d/u.test(input[index] ?? "")) index += 1;
      if (input[index] === ".") {
        index += 1;
        while (/\d/u.test(input[index] ?? "")) index += 1;
      }
      push({ type: "number", value: input.slice(start, index) });
      continue;
    }
    const type = {
      "+": "plus",
      "-": "minus",
      "*": "multiply",
      "/": "divide",
      "^": "power",
      "(": "left",
      ")": "right",
      "'": "prime",
    }[character];
    if (type) push({ type });
    else pushBoundary();
    index += 1;
  }
  return tokens;
}

function hasStructuralToken(tokens) {
  return tokens.some((token) =>
    ["plus", "minus", "multiply", "divide", "power", "prime"].includes(
      token.type,
    ),
  );
}

class MathParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }
  parse() {
    try {
      const expression = this.parseAdd();
      return expression && this.index === this.tokens.length
        ? expression
        : null;
    } catch {
      return null;
    }
  }
  parseAdd() {
    const first = this.parseMultiply();
    if (!first) return null;
    const terms = [{ sign: 1, value: first }];
    while (this.peek("plus") || this.peek("minus")) {
      const sign = this.consume().type === "minus" ? -1 : 1;
      const value = this.parseMultiply();
      if (!value) throw new Error("Missing additive term");
      terms.push({ sign, value });
    }
    return terms.length === 1 ? first : { kind: "add", terms };
  }
  parseMultiply() {
    const first = this.parseUnary();
    if (!first) return null;
    let value = first;
    const factors = [first];
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
  parseUnary() {
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
  parsePower() {
    const base = this.parsePrimary();
    if (!base) return null;
    if (!this.peek("power")) return base;
    this.consume();
    const exponent = this.parseUnary();
    if (!exponent) throw new Error("Missing exponent");
    return { kind: "power", base, exponent };
  }
  parsePrimary() {
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
      let value = {
        kind: "atom",
        value: derivativeOrder
          ? `derivative:${derivativeOrder}:${token.value}`
          : `identifier:${token.value}`,
      };
      while (this.peek("left") && this.tokens[this.index]?.attached === true) {
        this.consume();
        const argument = this.parseAdd();
        if (!argument || !this.peek("right"))
          throw new Error("Invalid function argument");
        this.consume();
        if (!isIgnorableFunctionArgument(argument)) {
          value = { kind: "call", callee: value, argument };
        }
      }
      return value;
    }
    if (token.type === "left") {
      this.index += 1;
      const value = this.parseAdd();
      if (!value || !this.peek("right")) throw new Error("Unbalanced grouping");
      this.consume();
      return value;
    }
    return null;
  }
  startsPrimary() {
    return ["identifier", "number", "left"].includes(
      this.tokens[this.index]?.type,
    );
  }
  peek(type) {
    return this.tokens[this.index]?.type === type;
  }
  consume() {
    return this.tokens[this.index++];
  }
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : value;
}

function isIgnorableFunctionArgument(node) {
  return node.kind === "atom" && node.value === "identifier:x";
}

function formulaComplexity(node) {
  if (node.kind === "atom") {
    const identifier = node.value.split(":").at(-1) ?? "";
    const prosePenalty =
      (node.value.startsWith("identifier:") ||
        node.value.startsWith("derivative:")) &&
      !(
        /^\p{L}$/u.test(identifier) ||
        /^(?:sin|cos|tan|log|ln|exp|sqrt)$/u.test(identifier)
      )
        ? 40
        : 0;
    return 1 + (node.value.startsWith("derivative:") ? 10 : 0) - prosePenalty;
  }
  if (node.kind === "negate") return 3 + formulaComplexity(node.value);
  if (node.kind === "call") {
    return (
      6 + formulaComplexity(node.callee) + formulaComplexity(node.argument)
    );
  }
  if (node.kind === "add") {
    return (
      10 * (node.terms.length - 1) +
      node.terms.reduce((sum, term) => sum + formulaComplexity(term.value), 0)
    );
  }
  if (node.kind === "multiply") {
    return (
      4 * (node.factors.length - 1) +
      node.factors.reduce((sum, factor) => sum + formulaComplexity(factor), 0)
    );
  }
  if (node.kind === "divide")
    return (
      12 +
      formulaComplexity(node.numerator) +
      formulaComplexity(node.denominator)
    );
  return 10 + formulaComplexity(node.base) + formulaComplexity(node.exponent);
}

function canonicalExpression(node) {
  let terms = flattenSignedTerms(node, 1).map((term) => {
    const normalized = canonicalSigned(term.value);
    return { sign: term.sign * normalized.sign, key: normalized.key };
  });
  const significant = terms.filter((term) => term.key !== "atom(0)");
  if (significant.length) terms = significant;
  terms.sort((left, right) =>
    left.key === right.key
      ? left.sign - right.sign
      : left.key.localeCompare(right.key),
  );
  return `sum(${terms.map((term) => `${term.sign === 1 ? "+" : "-"}${term.key}`).join("|")})`;
}

function flattenSignedTerms(node, sign) {
  if (node.kind === "negate")
    return flattenSignedTerms(node.value, sign === 1 ? -1 : 1);
  if (node.kind !== "add") return [{ sign, value: node }];
  return node.terms.flatMap((term) =>
    flattenSignedTerms(term.value, sign === term.sign ? 1 : -1),
  );
}

function canonicalSigned(node) {
  if (node.kind === "negate") {
    const nested = canonicalSigned(node.value);
    return { sign: nested.sign === 1 ? -1 : 1, key: nested.key };
  }
  if (node.kind === "atom") return { sign: 1, key: `atom(${node.value})` };
  if (node.kind === "call") {
    const callee = canonicalSigned(node.callee);
    const argument = canonicalSigned(node.argument);
    return {
      sign: callee.sign,
      key: `call(${callee.key}|${argument.sign === 1 ? "+" : "-"}${argument.key})`,
    };
  }
  if (node.kind === "add") return { sign: 1, key: canonicalExpression(node) };
  if (node.kind === "multiply" || node.kind === "divide")
    return canonicalRationalProduct(node);
  const base = canonicalSigned(node.base);
  const exponent = canonicalSigned(node.exponent);
  return {
    sign: base.sign,
    key: `power(${base.key}|${exponent.sign === 1 ? "+" : "-"}${exponent.key})`,
  };
}

function canonicalRationalProduct(node) {
  let sign = 1;
  const numeratorFactors = [];
  const denominatorFactors = [];
  const collect = (value, inverted) => {
    if (value.kind === "negate") {
      sign *= -1;
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
    if (normalized.sign === -1) sign *= -1;
    (inverted ? denominatorFactors : numeratorFactors).push(normalized.key);
  };
  collect(node, false);
  const numerator = normalizedProductKey(numeratorFactors, "atom(1)");
  const denominator = normalizedProductKey(denominatorFactors, "");
  return {
    sign,
    key: denominator ? `divide(${numerator}|${denominator})` : numerator,
  };
}

function normalizedProductKey(factors, emptyValue) {
  const significant = factors.filter((factor) => factor !== "atom(1)");
  significant.sort((left, right) => left.localeCompare(right));
  if (!significant.length) return emptyValue;
  return significant.length === 1
    ? significant[0]
    : `product(${significant.join("|")})`;
}
