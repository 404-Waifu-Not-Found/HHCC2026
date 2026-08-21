import { describe, expect, it } from "vitest";
import { formatMathText, isMathExpressionText } from "../src/lib/math-text";

describe("math text presentation", () => {
  it("classifies formulas without treating ordinary prose as math", () => {
    expect(isMathExpressionText("(f(b)-f(a))/(b-a)")).toBe(true);
    expect(isMathExpressionText("The derivative is u'v - v'u.")).toBe(true);
    expect(isMathExpressionText("Which statement matches the lesson?")).toBe(
      false,
    );
  });

  it("uses readable operators while preserving the accessible source", () => {
    expect(formatMathText("x^2 * y -> z")).toBe("x² · y → z");
    expect(formatMathText("ordinary prose")).toBe("ordinary prose");
  });
});
