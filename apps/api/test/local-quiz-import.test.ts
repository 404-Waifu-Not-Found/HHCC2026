import { describe, expect, it } from "vitest";
import { storedQuestionFields } from "../src/routes/quiz-imports";

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
  });
});
