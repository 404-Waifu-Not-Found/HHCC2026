import { describe, expect, it } from "vitest";
import {
  formatMathText,
  isMathExpressionText,
  isStandaloneMathExpressionText,
  mathTextToLatex,
  segmentMathText,
} from "../src/lib/math-text";

describe("math text presentation", () => {
  it("classifies formulas without treating ordinary prose as math", () => {
    expect(isMathExpressionText("(f(b)-f(a))/(b-a)")).toBe(true);
    expect(isMathExpressionText("The derivative is u'v - v'u.")).toBe(true);
    expect(isMathExpressionText("Which statement matches the lesson?")).toBe(
      false,
    );
    expect(isMathExpressionText("yes/no, true/false, or input/output")).toBe(
      false,
    );
  });

  it("uses readable operators while preserving the accessible source", () => {
    expect(formatMathText("x^2 * y -> z")).toBe("x² · y → z");
    expect(formatMathText("ordinary prose")).toBe("ordinary prose");
  });

  it("uses the math typeface only for standalone expressions", () => {
    expect(isStandaloneMathExpressionText("(f(b)-f(a))/(b-a)")).toBe(true);
    expect(isStandaloneMathExpressionText("x^2 * y -> z")).toBe(true);
    expect(isStandaloneMathExpressionText("sin(x) + cos(x)")).toBe(true);

    const question =
      "For a function f defined on an interval from x = a to x = b, the average rate of change is (f(b)-f(a))/(b-a), and this value is the slope of the secant line.";
    expect(isMathExpressionText(question)).toBe(true);
    expect(isStandaloneMathExpressionText(question)).toBe(false);
    expect(isStandaloneMathExpressionText("The derivative is u'v - v'u.")).toBe(
      false,
    );
  });

  it("formats embedded math without classifying the whole sentence as standalone", () => {
    const question = "The transformed value is x^2 * y.";
    expect(formatMathText(question)).toBe("The transformed value is x² · y.");
    expect(isStandaloneMathExpressionText(question)).toBe(false);
  });

  it("keeps prose in the display face and isolates only inline formulas", () => {
    const question =
      "For f on a to b, the average rate is (f(b)-f(a))/(b-a), the secant slope.";
    const segments = segmentMathText(question);
    expect(segments.map((segment) => segment.text).join("")).toBe(question);
    expect(segments.filter((segment) => segment.mathematical)).toEqual([
      { text: "(f(b)-f(a))/(b-a)", mathematical: true },
    ]);
    expect(segments[0]?.mathematical).toBe(false);
  });

  it("isolates every expression in a limit question and its choices", () => {
    const question =
      "When evaluating the limit as x approaches 0 of (4x cos 2x) / (5 tan 2x), how is the expression split to apply the identity that (2x)/(tan 2x) approaches 1?";
    expect(
      segmentMathText(question)
        .filter((segment) => segment.mathematical)
        .map((segment) => segment.text),
    ).toEqual([
      "x approaches 0",
      "(4x cos 2x) / (5 tan 2x)",
      "(2x)/(tan 2x) approaches 1",
    ]);

    const choice =
      "It is split into the limit of (2x)/(tan 2x) times the limit of (2 cos 2x)/5.";
    expect(
      segmentMathText(choice)
        .filter((segment) => segment.mathematical)
        .map((segment) => segment.text),
    ).toEqual(["(2x)/(tan 2x)", "(2 cos 2x)/5"]);
  });

  it("converts plaintext formulas into semantic typesetting input", () => {
    expect(mathTextToLatex("x approaches 0")).toBe("x \\to 0");
    expect(mathTextToLatex("(4x cos 2x) / (5 tan 2x)")).toBe(
      "\\frac{4x \\cos 2x}{5 \\tan 2x}",
    );
    expect(mathTextToLatex("(2x)/(tan 2x) approaches 1")).toBe(
      "\\frac{2x}{\\tan 2x} \\to 1",
    );
    expect(mathTextToLatex("(f(b)-f(a))/(b-a)")).toBe("\\frac{f(b)-f(a)}{b-a}");
    expect(mathTextToLatex("$\\frac{x}{2}$")).toBe("\\frac{x}{2}");
    expect(mathTextToLatex("\\(x^2 + y^2\\)")).toBe("x^2 + y^2");
  });
});
