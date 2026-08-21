import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ProgressiveQuizSummarySchema,
  assertProgressiveChunkMetadata,
  generationAvailability,
  gradeProgressiveShortAnswer,
  parseProgressiveQuizSummary,
  readProgressiveGenerationSnapshot,
  tryProgressiveQuizSummary,
} from "../src/lib/progressive-quiz";

const questionTypes = [
  "multiple_choice",
  "true_false",
  "short_answer",
] as const;

function summary(count = 2) {
  const types = Array.from(
    { length: count },
    (_, index) => questionTypes[index % questionTypes.length]!,
  );
  return {
    source: "extension-local-json-stream" as const,
    importVersion: "extension-progressive-import-v3" as const,
    pipelineVersion: 9 as const,
    model: "deepseek-v4-flash" as const,
    reasoningEffort: "high" as const,
    promptVersion: "quiz-local-json-stream-v5.0" as const,
    validatorVersion: "validator-local-progressive-v4.0" as const,
    generationState: (count === 5 ? "ready" : "generating") as
      "ready" | "generating",
    requestedQuestionTypes: [...questionTypes],
    generatedQuestionTypes: types,
    plannedCount: 5 as const,
    acceptedCount: count,
    lastProgressAt: 1_786_000_000_000,
    acceptedQuestionSummaries: types.map((type, index) => ({
      id: `q${index + 1}`,
      type,
      concept: `Concept ${index + 1}`,
      question: `How does concept ${index + 1} work?`,
    })),
    transcriptStored: false as const,
    aiCalls: 1,
    retryCount: 0,
    inputTokens: 100,
    outputTokens: 200,
    reasoningTokens: 50,
    elapsedMs: 1_000,
  };
}

describe("progressive quiz storage state", () => {
  it("reads summary and authoritative count from one coherent statement", async () => {
    const preparedSql: string[] = [];
    const current = { ...summary(), lastProgressAt: Date.now() };
    const db = {
      prepare(sql: string) {
        preparedSql.push(sql);
        return {
          bind() {
            return {
              first: async () => ({
                quiz_id: "11111111-1111-4111-8111-111111111111",
                pipeline_version: 9,
                quality_status: "generating",
                quality_summary_json: JSON.stringify(current),
                authoritative_count: 2,
              }),
            };
          },
        };
      },
    } as unknown as D1Database;

    const snapshot = await readProgressiveGenerationSnapshot(
      db,
      "11111111-1111-4111-8111-111111111111",
    );

    expect(preparedSql).toHaveLength(1);
    expect(preparedSql[0]).toMatch(
      /SELECT COUNT\(\*\)[\s\S]+WHERE stored_question\.quiz_id = qb\.id/,
    );
    expect(snapshot.authoritativeCount).toBe(2);
    expect(snapshot.summary?.acceptedCount).toBe(2);
    expect(snapshot.availability).toEqual({
      state: "generating",
      availableQuestions: 2,
      totalQuestions: 5,
    });
  });

  it("fails closed before callers can use a corrupt coherent snapshot", async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              first: async () => ({
                quiz_id: "11111111-1111-4111-8111-111111111111",
                pipeline_version: 9,
                quality_status: "generating",
                quality_summary_json: JSON.stringify({
                  ...summary(),
                  lastProgressAt: Date.now(),
                }),
                authoritative_count: 3,
              }),
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      readProgressiveGenerationSnapshot(
        db,
        "11111111-1111-4111-8111-111111111111",
      ),
    ).rejects.toThrow("Stored question counts do not match generation state.");
  });

  it("derives availability only from agreeing typed and authoritative state", () => {
    const parsed = ProgressiveQuizSummarySchema.parse(summary());
    expect(generationAvailability(parsed, "generating", 2)).toEqual({
      state: "generating",
      availableQuestions: 2,
      totalQuestions: 5,
    });
    expect(() => generationAvailability(parsed, "generating", 3)).toThrow(
      "Stored question counts do not match generation state.",
    );

    const complete = ProgressiveQuizSummarySchema.parse(summary(5));
    expect(generationAvailability(complete, "passed", 5)).toEqual({
      state: "ready",
      availableQuestions: 5,
      totalQuestions: 5,
    });
    expect(() => generationAvailability(complete, "generating", 5)).toThrow(
      "Quiz quality and generation state do not agree.",
    );
  });

  it("fails closed on prototype versions, plan drift, and sensitive extras", () => {
    const current = summary();
    expect(tryProgressiveQuizSummary(JSON.stringify(current))).not.toBeNull();
    expect(
      tryProgressiveQuizSummary(
        JSON.stringify({ ...current, pipelineVersion: 8 }),
      ),
    ).toBeNull();
    expect(
      tryProgressiveQuizSummary(
        JSON.stringify({
          ...current,
          acceptedQuestionSummaries: current.acceptedQuestionSummaries.map(
            (question, index) =>
              index === 1 ? { ...question, type: "short_answer" } : question,
          ),
        }),
      ),
    ).toBeNull();
    expect(
      tryProgressiveQuizSummary(
        JSON.stringify({
          ...current,
          apiKey: "never-store-this",
          transcript: "never-store-this-either",
          deepSeekResponseBody: "also-forbidden",
        }),
      ),
    ).toBeNull();
    expect(() => parseProgressiveQuizSummary("not json")).toThrow(
      "This quiz does not support current progressive question delivery.",
    );
  });

  it("keeps existing v5.0 banks readable and rejects mixed later chunks", () => {
    const current = ProgressiveQuizSummarySchema.parse(summary());
    expect(current.promptVersion).toBe("quiz-local-json-stream-v5.0");
    expect(() =>
      assertProgressiveChunkMetadata(current, {
        pipelineVersion: 9,
        model: "deepseek-v4-flash",
        promptVersion: "quiz-local-json-stream-v5.0",
        validatorVersion: "validator-local-progressive-v4.0",
      }),
    ).not.toThrow();
    expect(() =>
      assertProgressiveChunkMetadata(current, {
        pipelineVersion: 9,
        model: "deepseek-v4-flash",
        promptVersion: "quiz-local-json-stream-v5.1",
        validatorVersion: "validator-local-progressive-v4.0",
      }),
    ).toThrow("Every streamed question must use the quiz's original");

    expect(
      ProgressiveQuizSummarySchema.safeParse({
        ...summary(),
        promptVersion: "quiz-local-json-stream-v5.1",
      }).success,
    ).toBe(true);
  });

  it("adds pipeline-9 indexes without dropping the pipeline-7 index", () => {
    const migration = readFileSync(
      resolve(
        import.meta.dirname,
        "../migrations/0016_progressive_quiz_streaming.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("quiz_banks_passed_v9_idx");
    expect(migration).toContain("quiz_banks_generating_v9_idx");
    expect(migration).toContain("pipeline_version = 9");
    expect(migration).not.toMatch(/DROP\s+INDEX/i);
    expect(migration).not.toMatch(/pipeline_version\s*=\s*8/i);
  });
});

describe("progressive short-answer grading", () => {
  const areaDerivativeRubric = {
    requiredIdeas: [
      "dA/dx is the ratio of a tiny change in area to a tiny change in x",
      "As dx gets smaller, the ratio approaches the height of the graph at that point",
      "For the x² graph, that height is x²",
    ],
    acceptableAlternatives: [
      "dA/dx is the derivative of A; it is the limit of the change in area divided by the change in x, equal to the value of x² at that point.",
    ],
  };

  it("accepts equivalent learner wording without a Worker-side model call", () => {
    expect(
      gradeProgressiveShortAnswer({
        answer:
          "It is the rate of change dA/dx, the added area divided by dx; as dx approaches zero it approaches x², the graph's height at x.",
        ...areaDerivativeRubric,
      }),
    ).toBe(true);
  });

  it("rejects answers that mention only one idea", () => {
    expect(
      gradeProgressiveShortAnswer({
        answer: "It is a derivative.",
        ...areaDerivativeRubric,
      }),
    ).toBe(false);
  });

  it("normalizes Chinese rubric wording without accepting a lone keyword", () => {
    const rubric = {
      requiredIdeas: ["它被称为积分", "这个函数表示从0到x的x²曲线下面积"],
      acceptableAlternatives: ["x²从0到x的积分，也就是曲线下的面积"],
    };
    expect(
      gradeProgressiveShortAnswer({
        answer: "这是 x² 从 0 到 x 的积分，也就是曲线下的面积。",
        ...rubric,
      }),
    ).toBe(true);
    expect(gradeProgressiveShortAnswer({ answer: "积分", ...rubric })).toBe(
      false,
    );
  });

  describe("formula-aware grading", () => {
    const quotientRuleRubric = {
      requiredIdeas: [
        "differentiate the numerator and denominator",
        "subtract the cross products in the correct order",
        "divide by the square of the denominator",
      ],
      acceptableAlternatives: ["(u'v - uv') / v^2"],
    };

    it.each([
      "(v·u′ - u·v′) / v²",
      "((du/dx) v - u (dv/dx)) / (v^2)",
      "For u(x)/v(x), the derivative is [v u'(x) - v'(x) u(x)] / v².",
    ])("accepts a quotient-rule equivalent: %s", (answer) => {
      expect(
        gradeProgressiveShortAnswer({ answer, ...quotientRuleRubric }),
      ).toBe(true);
    });

    it.each([
      "(uv' - u'v) / v²",
      "(u'v + uv') / v²",
      "(u'v - uv') / v",
      "(u'v - uv') / u²",
      "u'v - uv' / v²",
      "differentiate numerator denominator subtract square",
    ])("rejects a structurally wrong formula: %s", (answer) => {
      expect(
        gradeProgressiveShortAnswer({ answer, ...quotientRuleRubric }),
      ).toBe(false);
    });

    it("accepts the equivalent product-of-fractions wording seen in production", () => {
      expect(
        gradeProgressiveShortAnswer({
          answer:
            "The derivative of ln x is 1/x because the general log rule gives (1/x)(1/ln(e)) and ln(e)=1.",
          requiredIdeas: [
            "derivative is 1/x",
            "general log derivative 1/x * 1/ln(e)",
            "ln(e)=1 simplifies",
          ],
          acceptableAlternatives: [
            "The derivative of ln x is 1/x. Using the general form for log base e of x, it is 1/x * 1/ln(e), and since ln(e) = 1, this simplifies to 1/x.",
            "d/dx ln(x) = 1/x because the log rule gives 1/x times 1/ln(e), and ln(e) = 1.",
            "The derivative is 1/x; from the general rule, it is (1/x)(1/ln e) = 1/x.",
          ],
        }),
      ).toBe(true);
    });

    it("falls back to semantic grading when only the reference parses as a formula", () => {
      expect(
        gradeProgressiveShortAnswer({
          answer:
            "d/dx[f(x) ± g(x)] = f'(x) ± g'(x). Thus d/dx(x+x) = 1+1 = 2.",
          requiredIdeas: [
            "State that d/dx [f(x) ± g(x)] = f'(x) ± g'(x)",
            "Derivative of x is 1",
            "Apply to x+x to get 2",
          ],
          acceptableAlternatives: [
            "The sum and difference rule says the derivative of f(x) ± g(x) equals f'(x) ± g'(x). For y = x + x, the derivative is 1 + 1 = 2.",
            "d/dx (f(x)+g(x)) = f'(x)+g'(x) and d/dx (f(x)-g(x)) = f'(x)-g'(x); for x+x, derivative = 2.",
            "The derivative of a sum/difference is the sum/difference of the derivatives, so y' = 1+1 = 2.",
          ],
        }),
      ).toBe(true);
    });
  });
});
