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
  questionConceptFailure,
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

test("strict v5.7 excerpts fail closed and never promote score-zero title matches", () => {
  const generic =
    "ClipQuest review session introduces several topics and shares background context.";
  assert.ok(buildInstructionalExcerpts(generic).length > 0);
  assert.deepEqual(
    buildInstructionalExcerpts(generic, {
      strict: true,
      topicHint: "ClipQuest review session",
    }),
    [],
  );

  const mixed = [
    "Welcome to the continuity review session.",
    "Unit 1 weighs 10 percent of the AP Calculus BC exam.",
    "A function is continuous at x = c when f(c) exists, the limit exists, and the limit equals f(c).",
    "Remember to submit late assignments through the course website.",
  ].join(" ");
  const strict = buildInstructionalExcerpts(mixed, {
    strict: true,
    topicHint: "Unit 1 continuity review",
  }).join(" ");
  assert.match(strict, /function is continuous/iu);
  assert.doesNotMatch(
    strict,
    /welcome|10 percent|late assignments|course website/iu,
  );
});

test("strict v5.7 ranks the strongest instructional evidence first", () => {
  const transcript = [
    "The atom contains several components.",
    "A derivative represents instantaneous rate of change and is calculated as the limit of a difference quotient.",
    "A function is useful in mathematics.",
  ].join(" ");
  const excerpts = buildInstructionalExcerpts(transcript, {
    strict: true,
    topicHint: "Derivatives",
  });
  assert.match(excerpts[0] ?? "", /instantaneous rate of change/iu);
  assert.match(
    focusExcerptForOrdinal(transcript, 0, 5, 0, {
      strict: true,
      topicHint: "Derivatives",
    }),
    /instantaneous rate of change/iu,
  );
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

  const preserved = [
    "In the lesson's polynomial example, which factor is repeated?",
    "In the video’s matrix-based representation, which row is reduced first?",
    "Based on the lecturer's account, which premise follows?",
    "According to the lecturer's account, which premise follows?",
  ];
  for (const question of preserved) {
    assert.equal(stripQuestionSourceFraming(question), question, question);
  }

  assert.equal(
    stripQuestionSourceFraming(
      "According to the lecturer, what is continuity?",
    ),
    "What is continuity?",
  );
  assert.equal(
    stripQuestionSourceFraming(
      "According to the lecturer what continuity means",
    ),
    "What continuity means",
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

  assert.equal(
    questionTestsTaughtConcept({
      concept: "continuity",
      question: "According to the lesson, what is continuity?",
      explanation: "A function is continuous when the limit equals its value.",
    }),
    false,
  );
  assert.equal(
    questionTestsTaughtConcept({
      concept: "continuity",
      question: "What three conditions define continuity?",
      explanation: "The transcript lists all three conditions.",
    }),
    false,
  );
  assert.equal(
    questionTestsTaughtConcept({
      concept: "continuity",
      question: "What three conditions define continuity?",
      explanation: "The lesson explicitly supports all three conditions.",
    }),
    false,
  );
  assert.equal(
    questionTestsTaughtConcept({
      concept: "continuity",
      question: "What three conditions define continuity?",
      explanation: "All three conditions must hold.",
      claim: {
        subject: "the lecturer's explanation",
        relation: "defines",
        value: "continuity",
        cluster: "continuity conditions",
      },
    }),
    false,
  );

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

test("v5.7 reports precise framing, logistics, and low-value failures", () => {
  const directConcept = {
    concept: "continuity conditions",
    question:
      "What conditions must hold for a function to be continuous at a point?",
    explanation:
      "The function value and limit must exist, and the limit must equal the value.",
    answer:
      "The value and limit exist at the point, and the limit equals the value.",
    rubricIdeas: ["the value and limit exist", "the limit equals the value"],
    acceptableAnswers: [
      "The value and limit exist, and the limit equals the value.",
    ],
    claim: {
      subject: "continuity",
      relation: "requires",
      value: "an existing value and matching limit",
      cluster: "continuity conditions",
    },
  };
  expectConceptFailure(directConcept, null);

  const sourceFraming = [
    { question: "According to the lesson, what defines continuity?" },
    { explanation: "The transcript says that all three conditions must hold." },
    { answer: "According to the presenter, all three conditions hold." },
    { correctAnswer: "The answer stated in the video" },
    { choices: ["The lecturer's account", "A", "B", "C"] },
    {
      distractors: [
        { text: "A", whyWrong: "The narrator said a different answer." },
      ],
    },
    { rubricIdeas: ["what the source states"] },
    { acceptableAnswers: ["As mentioned in the lecture, all conditions"] },
    { claim: { subject: "the speaker's explanation" } },
  ];
  for (const override of sourceFraming) {
    expectConceptFailure(
      mergeConceptCandidate(directConcept, override),
      "source_framing_invalid",
    );
  }

  const logistics = [
    "What percentage of the exam covers limits?",
    "What joke did the presenter make during the introduction?",
    "How many years has the instructor taught this course?",
    "Where did Mendeleev apply to university?",
    "Which department cross-listed the course?",
    "What is the late assignment policy?",
    "How many times was this topic requested by viewers?",
  ];
  for (const question of logistics) {
    expectConceptFailure(
      { ...directConcept, question },
      "course_logistics_invalid",
    );
  }

  const lowValue = [
    "Who discovered the element?",
    "When was the experiment first performed?",
    "What institution stored the sample?",
  ];
  for (const question of lowValue) {
    expectConceptFailure(
      { ...directConcept, question },
      "low_pedagogical_value",
    );
  }
  expectConceptFailure(
    { ...directConcept, question: "根据本课，连续的条件是什么？" },
    "source_framing_invalid",
  );
  expectConceptFailure(
    { ...directConcept, question: "这门课程的考试占比是多少？" },
    "course_logistics_invalid",
  );
});

test("v5.7 preserves direct concept questions across disciplines", () => {
  const questions = [
    "What conditions must hold for a function to be continuous at a point?",
    "How does the derivative describe instantaneous rate of change?",
    "How do sensory neurons transfer signals toward the central nervous system?",
    "How does periodic position relate to recurring chemical properties?",
    "What role does CRISPR-Cas9 play in targeted gene editing?",
    "How did resource competition contribute to the conflict?",
    "Where are protons and neutrons located in an atom?",
    "为什么极限决定函数在一点是否连续？",
  ];
  for (const question of questions) {
    expectConceptFailure(
      {
        concept: "transferable concept",
        question,
        explanation: "This directly explains the relevant relationship.",
      },
      null,
    );
  }
});

function mergeConceptCandidate(base, override) {
  return {
    ...base,
    ...override,
    ...(override.claim ? { claim: { ...base.claim, ...override.claim } } : {}),
  };
}

function expectConceptFailure(candidate, expected) {
  assert.equal(questionConceptFailure(candidate), expected, candidate.question);
}

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
