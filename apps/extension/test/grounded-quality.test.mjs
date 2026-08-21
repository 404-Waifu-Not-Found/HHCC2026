import assert from "node:assert/strict";
import test from "node:test";
import {
  answerSupportedByEvidence,
  applyVerifiedMutation,
  buildInstructionalExcerpts,
  candidateDuplicatesAccepted,
  choicesLikelyEquivalent,
  focusExcerptForOrdinal,
  groundedMultipleChoiceCandidate,
  groundedTrueFalseQuestion,
  questionTestsTaughtConcept,
  stripQuestionSourceFraming,
} from "../src/grounded-quality.js";
import { formulaFingerprint } from "../src/math-expression.js";

test("instructional excerpts exclude course administration when lesson content exists", () => {
  const transcript = [
    "Welcome to the course. Send complaints to the teaching assistant and share the textbook with your classmates.",
    "The course roadmap includes essays, required readings, grading, and office hours.",
    "Average rate of change means the difference in output divided by the difference in input.",
    "For f on an interval from a to b, the formula is (f(b)-f(a))/(b-a).",
    "This value is the slope of the secant line through the two endpoint coordinates.",
  ].join(" ");
  const excerpts = buildInstructionalExcerpts(transcript);
  const focus = focusExcerptForOrdinal(transcript, 0, 5);
  assert.ok(excerpts.some((value) => value.includes("Average rate of change")));
  assert.doesNotMatch(focus, /complaints|office hours|grading/iu);
});

test("instructional excerpts reject numeric course metadata without losing concepts", () => {
  const transcript = [
    "Unit 1 weighs 10 percent of the AP Calculus BC exam.",
    "The instructor has taught this course for 12 years.",
    "A function is continuous at x = c when f(c) exists, the limit exists, and the limit equals f(c).",
    "The derivative represents the instantaneous rate of change of a function.",
  ].join(" ");
  const excerpts = buildInstructionalExcerpts(transcript).join(" ");
  assert.doesNotMatch(excerpts, /10 percent|taught this course for 12 years/iu);
  assert.match(excerpts, /continuous at x = c/iu);
  assert.match(excerpts, /instantaneous rate of change/iu);
});

test("a source containing only course metadata yields no quiz focus", () => {
  const transcript = [
    "Welcome to the course and subscribe to the channel.",
    "Unit 1 weighs 10 percent of the AP Calculus BC exam.",
    "Office hours are listed on the course website.",
    "The instructor has taught this course for 12 years.",
  ].join(" ");
  assert.deepEqual(buildInstructionalExcerpts(transcript), []);
  assert.equal(focusExcerptForOrdinal(transcript, 0, 5), "");
});

test("source framing is removed without rewriting the concept question", () => {
  assert.equal(
    stripQuestionSourceFraming(
      "According to the lesson, what three conditions must be true for a function to be continuous at x = c?",
    ),
    "What three conditions must be true for a function to be continuous at x = c?",
  );
  assert.equal(
    stripQuestionSourceFraming(
      "In the lecture, how does the quotient rule combine u, v, u', and v'?",
    ),
    "How does the quotient rule combine u, v, u', and v'?",
  );
  assert.equal(
    stripQuestionSourceFraming("根据本课，连续的三个条件是什么？"),
    "连续的三个条件是什么？",
  );
});

test("question focus gate rejects source and course trivia but accepts taught concepts", () => {
  const rejected = [
    "What is the weighting of Unit 1 on the AP Calculus BC exam?",
    "What percentage of the AP BC exam is Unit 1 worth?",
    "Who is the instructor for this course?",
    "How long has the professor been teaching this class?",
    "What will the next module cover?",
    "What did the presenter say about continuity?",
    "Which formula was mentioned in the video?",
  ];
  for (const question of rejected) {
    assert.equal(
      questionTestsTaughtConcept({ concept: "course information", question }),
      false,
      question,
    );
  }

  const accepted = [
    "What three conditions must hold for a function to be continuous at x = c?",
    "How is the average rate of change calculated on an interval?",
    "Where are protons and neutrons located in an atom?",
    "What role does CRISPR-Cas9 play in targeted gene editing?",
    "A force of 12 N acts on a 3 kg mass. What acceleration does it produce?",
  ];
  for (const question of accepted) {
    assert.equal(
      questionTestsTaughtConcept({
        concept: "instructional concept",
        question,
      }),
      true,
      question,
    );
  }
});

test("true false answer is constructed from exact evidence instead of model polarity", () => {
  const evidence =
    "Elephants are unsuitable for domestication because pregnancy lasts 22 months and they have one offspring at a time.";
  const supported = groundedTrueFalseQuestion(
    {
      sourceEvidence: evidence,
      supportedStatement: evidence,
      mode: "supported",
      question: evidence,
    },
    `The lesson explains several animals. ${evidence}`,
  );
  assert.equal(supported?.answer, true);

  const mutated = groundedTrueFalseQuestion(
    {
      sourceEvidence: evidence,
      supportedStatement: evidence,
      mode: "mutated",
      mutation: {
        sourceValue: "22 months",
        replacementValue: "2 months",
      },
      question:
        "Elephants are unsuitable for domestication because pregnancy lasts 2 months and they have one offspring at a time.",
    },
    evidence,
  );
  assert.equal(mutated?.answer, false);
  assert.equal(mutated?.correction, evidence);

  assert.equal(
    groundedTrueFalseQuestion(
      {
        sourceEvidence: evidence,
        supportedStatement: evidence,
        mode: "mutated",
        mutation: {
          sourceValue: "22 months",
          replacementValue: "2 months",
        },
        question: evidence,
      },
      evidence,
    ),
    null,
  );
  assert.equal(
    applyVerifiedMutation(evidence, {
      sourceValue: "22 months",
      replacementValue: "twenty-two months",
    }),
    null,
  );
  assert.equal(
    applyVerifiedMutation(evidence, {
      sourceValue: "unsuitable",
      replacementValue: "not ideal",
    }),
    null,
  );
});

test("grounded multiple choice requires exact local evidence and reasons", () => {
  const evidence =
    "The average rate of change is the slope of the secant line through the endpoints.";
  const candidate = groundedMultipleChoiceCandidate(
    {
      sourceEvidence: evidence,
      correctAnswer: "the slope of the secant line",
      distractors: [
        {
          text: "the area under the graph",
          whyWrong: "It changes the requested geometric quantity.",
        },
        {
          text: "the y-intercept",
          whyWrong: "It names an intercept rather than a rate.",
        },
        {
          text: "the instantaneous curvature",
          whyWrong: "It is not the endpoint rate described.",
        },
      ],
    },
    evidence,
  );
  assert.deepEqual(candidate, {
    correctAnswer: "the slope of the secant line",
    distractors: [
      "the area under the graph",
      "the y-intercept",
      "the instantaneous curvature",
    ],
  });
  assert.equal(
    groundedMultipleChoiceCandidate(
      {
        sourceEvidence: "Unsupported material",
        correctAnswer: "the slope of the secant line",
        distractors: [],
      },
      evidence,
    ),
    null,
  );
});

test("semantic and formula equivalence reject the live QA distractors", () => {
  assert.equal(
    choicesLikelyEquivalent(
      "the slope of the secant line",
      "the difference in y-values divided by the difference in x-values",
    ),
    true,
  );
  assert.equal(
    formulaFingerprint("9x^2 - 8x + 7"),
    formulaFingerprint("9x^2 - 8x + 7 + 0"),
  );
});

test("short answers must be structurally or semantically supported by evidence", () => {
  const evidence =
    "For f on an interval from a to b, the average rate of change is (f(b)-f(a))/(b-a).";
  assert.equal(answerSupportedByEvidence("(f(b)-f(a))/(b-a)", evidence), true);
  assert.equal(
    answerSupportedByEvidence(
      "average rate of change on the interval",
      evidence,
    ),
    true,
  );
  assert.equal(answerSupportedByEvidence("the chain rule", evidence), false);
  assert.equal(answerSupportedByEvidence("(f(a)-f(b))/(b-a)", evidence), false);
});

test("claim identity blocks repeated semantic families", () => {
  const accepted = [
    {
      claimKey: "crispr relation bacterial immune system",
      conceptCluster: "bacterial crispr immune",
      concept: "CRISPR bacterial immunity",
      question: "What was CRISPR's original role in bacteria?",
    },
  ];
  assert.equal(
    candidateDuplicatesAccepted(
      {
        concept: "Bacterial immune role of CRISPR",
        question: "How does CRISPR function as bacterial immunity?",
        claim: {
          subject: "CRISPR",
          relation: "functions as",
          value: "bacterial immune system",
          cluster: "CRISPR bacterial immunity",
        },
      },
      accepted,
      10,
    ),
    true,
  );
});
