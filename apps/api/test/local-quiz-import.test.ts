import { describe, expect, it } from "vitest";
import {
  currentGroundedNewBankMetadataMatches,
  storedQuestionFields,
} from "../src/routes/quiz-imports";

const common = {
  id: "q1",
  concept: "A lesson concept",
  question: "How does this lesson concept work?",
  explanation: "The lesson directly supports this explanation.",
};

describe("extension mixed-question persistence", () => {
  it("stores each supported type without flattening it to multiple choice", () => {
    expect(
      storedQuestionFields({
        ...common,
        type: "multiple_choice",
        choices: ["Correct", "Wrong A", "Wrong B", "Wrong C"],
        answerIndex: 0,
        answer: "Correct",
      }),
    ).toEqual({
      optionsJson: '["Correct","Wrong A","Wrong B","Wrong C"]',
      correctAnswerJson: "0",
      rubricJson: null,
      explanation: common.explanation,
    });
    expect(
      storedQuestionFields({
        ...common,
        type: "true_false",
        answer: false,
        correction: "This is the corrected statement.",
      }),
    ).toEqual({
      optionsJson: null,
      correctAnswerJson: "false",
      rubricJson: null,
      explanation: `This is the corrected statement. ${common.explanation}`,
    });
    expect(
      storedQuestionFields({
        ...common,
        type: "short_answer",
        answer: "Reference answer",
        rubricIdeas: ["Required idea"],
        acceptableAnswers: ["Equivalent answer"],
      }),
    ).toEqual({
      optionsJson: null,
      correctAnswerJson: null,
      rubricJson:
        '{"requiredIdeas":["Required idea"],"acceptableAlternatives":["Reference answer","Equivalent answer"]}',
      explanation: common.explanation,
    });
    expect(
      storedQuestionFields({
        ...common,
        type: "short_answer",
        answer: "atmosphere",
        rubricIdeas: ["atmosphere"],
        acceptableAnswers: [],
        shortAnswerMode: "atomic_term",
        rubricV2: {
          version: 2,
          mode: "atomic_term",
          canonicalAnswer: "atmosphere",
          aliases: ["the atmosphere"],
        },
      }),
    ).toEqual({
      optionsJson: null,
      correctAnswerJson: null,
      rubricJson:
        '{"requiredIdeas":["atmosphere"],"acceptableAlternatives":["atmosphere"],"v2":{"version":2,"mode":"atomic_term","canonicalAnswer":"atmosphere","aliases":["the atmosphere"]}}',
      explanation: common.explanation,
    });
  });

  it("accepts only current v5.8 metadata for a newly assigned concept-first bank", () => {
    const current = {
      generationProfile: "concept_first_auto_v5_8" as const,
      model: "deepseek-v4-flash" as const,
      pipelineVersion: 9 as const,
      promptVersion: "quiz-local-json-stream-v5.8" as const,
      validatorVersion: "validator-local-progressive-v4.7" as const,
      protocolVersion: 9 as const,
      importVersion: "extension-progressive-import-v7" as const,
    };
    expect(currentGroundedNewBankMetadataMatches(current)).toBe(true);
    for (const stale of [
      {
        ...current,
        promptVersion: "quiz-local-json-stream-v5.7" as const,
        validatorVersion: "validator-local-progressive-v4.6" as const,
      },
      { ...current, protocolVersion: 5 as const },
      {
        ...current,
        importVersion: "extension-progressive-import-v6" as const,
      },
    ]) {
      expect(
        currentGroundedNewBankMetadataMatches(
          stale as Parameters<typeof currentGroundedNewBankMetadataMatches>[0],
        ),
      ).toBe(false);
    }
  });
});
