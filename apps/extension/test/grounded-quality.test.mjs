import assert from "node:assert/strict";
import test from "node:test";
import {
  answerSupportedByEvidence,
  applyVerifiedMutation,
  buildConceptFirstInstructionalSelection,
  buildInstructionalExcerpts,
  candidateDuplicatesAccepted,
  claimKeyForCandidate,
  choicesLikelyEquivalent,
  conceptClusterForCandidate,
  constructConceptFirstTrueFalseQuestion,
  focusExcerptForOrdinal,
  groundedMultipleChoiceCandidate,
  groundedTrueFalseQuestion,
  multipleChoiceQuestionAnswerIsCoherent,
  questionConceptFailure,
  questionMatchesQuizLanguage,
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

test("multiple-choice grounding resolves an equivalent private answer span locally", () => {
  const evidence =
    "Rising levels of greenhouse gases in the atmosphere trap more outgoing heat.";
  const candidate = {
    evidenceQuote: evidence,
    answerSpan: "higher atmospheric greenhouse-gas levels",
    answerText: "rising levels of greenhouse gases in the atmosphere",
    distractors: [
      {
        text: "lower ocean salinity",
        whyWrong: "It does not describe the heat-trapping mechanism.",
      },
      {
        text: "faster plate movement",
        whyWrong: "It is unrelated to atmospheric heat retention.",
      },
      {
        text: "weaker solar radiation",
        whyWrong: "It reverses the direction of the supported mechanism.",
      },
    ],
  };

  assert.deepEqual(groundedMultipleChoiceCandidate(candidate, evidence), {
    correctAnswer: candidate.answerText,
    distractors: candidate.distractors.map((entry) => entry.text),
  });
  assert.equal(
    groundedMultipleChoiceCandidate(
      {
        ...candidate,
        answerSpan: "lower ocean salinity",
        answerText: "lower ocean salinity",
      },
      evidence,
    ),
    null,
    "an unrelated private span must never be repaired into acceptance",
  );
});

test("v5.8 accepts compact distractor strings but never trusts a mismatched learner answer", () => {
  const evidence =
    "Species that lack genetic diversity are much more vulnerable to environmental fluctuations.";
  const base = {
    evidenceQuote: evidence,
    answerSpan:
      "Species that lack genetic diversity are much more vulnerable to environmental fluctuations",
    answerText:
      "Species that lack genetic diversity are much more vulnerable to environmental fluctuations",
    distractors: [
      "Genetic diversity affects appearance but not survival.",
      "Low genetic diversity makes a species more resilient.",
      "Environmental fluctuations affect every species equally.",
    ],
  };
  assert.deepEqual(groundedMultipleChoiceCandidate(base, evidence), {
    correctAnswer: base.answerSpan,
    distractors: base.distractors,
  });
  assert.deepEqual(
    groundedMultipleChoiceCandidate(
      {
        ...base,
        answerText: "High genetic diversity makes species vulnerable.",
      },
      evidence,
    ),
    { correctAnswer: base.answerSpan, distractors: base.distractors },
    "the locally resolved exact span replaces a contradictory model answer",
  );
});

test("v5.8 preserves directional scope between a relationship stem and its answer", () => {
  const evidence =
    "A species with less genetic diversity is much more vulnerable to fluctuations caused by climate change, disease, or habitat fragmentation.";
  assert.equal(
    multipleChoiceQuestionAnswerIsCoherent(
      "What is the role of genetic diversity in a species' ability to cope with environmental changes?",
      "It makes the species much more vulnerable to environmental fluctuations.",
      evidence,
    ),
    false,
  );
  assert.equal(
    multipleChoiceQuestionAnswerIsCoherent(
      "How does less genetic diversity affect a species' ability to cope with environmental changes?",
      "It makes the species much more vulnerable to environmental fluctuations.",
      evidence,
    ),
    true,
  );
  assert.equal(
    multipleChoiceQuestionAnswerIsCoherent(
      "How does genetic diversity affect a species' ability to cope with environmental changes?",
      "Less genetic diversity makes the species much more vulnerable to environmental fluctuations.",
      evidence,
    ),
    true,
  );
});

test("v5.8 rejects source-specific metaphor scaffolding from learner copy", () => {
  for (const question of [
    "What condition strengthens biodiversity's weave in a rainforest?",
    "How does the loss of biodiversity strands affect human well-being?",
    "How does cutting too many links in biodiversity affect human survival?",
  ]) {
    assert.equal(
      questionConceptFailure({
        question,
        concept: "ecosystem interdependence",
        explanation: "Ecosystem interdependence supports resilience.",
      }),
      "source_framing_invalid",
    );
  }
  assert.equal(
    questionConceptFailure({
      question:
        "How does biodiversity loss affect ecosystem resilience and human well-being?",
      concept: "ecosystem interdependence",
      explanation:
        "Biodiversity loss weakens ecological interactions that support resilience and human well-being.",
    }),
    null,
  );
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

test("v5.8 source selection uses safe neighboring concept windows and aggregate metrics", () => {
  const transcript = [
    "Welcome to the channel and subscribe for future uploads.",
    "The midterm is worth 30 percent and late work loses five points.",
    "Greenhouse gases absorb outgoing infrared radiation, which slows heat loss from Earth.",
    "As greenhouse-gas concentration increases, more outgoing energy is retained in the lower atmosphere.",
    "This energy imbalance raises the average surface temperature until outgoing and incoming energy balance again.",
    "The presenter studied at Example University for four years.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "Greenhouse effect",
  });
  assert.ok(selection.excerpts.length > 0);
  assert.match(selection.excerpts[0], /infrared radiation|energy imbalance/iu);
  assert.doesNotMatch(
    selection.excerpts.join(" "),
    /subscribe|midterm|late work|university/iu,
  );
  assert.ok(selection.metrics.candidateWindowCount >= 1);
  assert.ok(selection.metrics.selectedWindowCount >= 1);
  assert.equal("text" in selection.metrics, false);
});

test("v5.8 source selection fails closed for logistics-only material", () => {
  const selection = buildConceptFirstInstructionalSelection(
    "Welcome to the course. The exam is worth 40 percent. Office hours begin at noon. Subscribe for updates.",
    { topicHint: "Course introduction" },
  );
  assert.deepEqual(selection.excerpts, []);
  assert.equal(selection.metrics.selectedWindowCount, 0);
});

test("v5.8 repair windows do not consume the next ordinal's primary focus", () => {
  const transcript = Array.from(
    { length: 18 },
    (_, index) =>
      `Mechanism ${index + 1} transfers energy through pathway${index + 1} because its distinct condition changes output ${index + 20}.`,
  ).join(" ");
  const options = { conceptFirstV58: true, topicHint: "Energy mechanisms" };
  const repairedQ1 = focusExcerptForOrdinal(transcript, 0, 5, 1, options);
  const primaryQ2 = focusExcerptForOrdinal(transcript, 1, 5, 0, options);
  assert.notEqual(repairedQ1, primaryQ2);

  const exactPartitionTranscript = Array.from(
    { length: 25 },
    (_, index) =>
      `Partition ${index + 1} transfers energy through route${index + 1} because its distinct mechanism changes result ${index + 40}.`,
  ).join(" ");
  const exactRepair = focusExcerptForOrdinal(
    exactPartitionTranscript,
    0,
    5,
    1,
    options,
  );
  const exactNextPrimary = focusExcerptForOrdinal(
    exactPartitionTranscript,
    1,
    5,
    0,
    options,
  );
  assert.notEqual(exactRepair, exactNextPrimary);
});

test("v5.8 spreads primary ordinals across the ranked evidence set", () => {
  const transcript = Array.from(
    { length: 30 },
    (_, index) =>
      `Mechanism ${index + 1} transfers energy through pathway${index + 1} because its distinct condition changes output ${index + 20}.`,
  ).join(" ");
  const options = { conceptFirstV58: true, topicHint: "Energy mechanisms" };
  const primaryFocuses = Array.from({ length: 5 }, (_, ordinal) =>
    focusExcerptForOrdinal(transcript, ordinal, 5, 0, options),
  );
  assert.equal(new Set(primaryFocuses).size, 5);
  for (let index = 1; index < primaryFocuses.length; index += 1) {
    assert.notEqual(primaryFocuses[index], primaryFocuses[index - 1]);
  }
});

test("v5.8 constructs true-false polarity locally from one supported fact", () => {
  const evidence =
    "Increasing the resistance decreases current when voltage remains fixed.";
  const falseQuestion = constructConceptFirstTrueFalseQuestion(
    {
      evidenceQuote: evidence,
      supportedFact: evidence,
      explanation:
        "At fixed voltage, current and resistance vary in opposite directions.",
    },
    evidence,
    false,
  );
  assert.equal(falseQuestion?.answer, false);
  assert.match(falseQuestion?.question ?? "", /increases current/iu);
  assert.equal(falseQuestion?.correction, evidence);

  const trueQuestion = constructConceptFirstTrueFalseQuestion(
    { evidenceQuote: evidence, supportedFact: evidence },
    evidence,
    true,
  );
  assert.equal(trueQuestion?.answer, true);
  assert.equal(trueQuestion?.question, evidence);
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
    {
      question:
        "How does biodiversity loss affect human survival according to the weave metaphor?",
    },
    {
      question:
        "Which of the following is a method mentioned to reduce deforestation's environmental impact?",
    },
    { explanation: "The transcript says that all three conditions must hold." },
    {
      explanation:
        "The reference lists managing forest resources and planting new trees.",
    },
    { answer: "According to the presenter, all three conditions hold." },
    { correctAnswer: "The answer stated in the video" },
    { choices: ["The lecturer's account", "A", "B", "C"] },
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

  expectConceptFailure(
    mergeConceptCandidate(directConcept, {
      answerSpan: "According to the lesson, the supported answer",
      distractors: [
        {
          text: "A different mechanism",
          whyWrong: "The evidence states a different relationship.",
        },
      ],
    }),
    null,
  );

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
    "What percentage of viewers use 5 GHz WiFi?",
    "How many devices used the older protocol?",
    "What is the estimated annual monetary value of the services that ecosystems provide for humanity, according to economic calculations?",
    "How does the estimated annual monetary value of ecosystem services compare to the annual output of the global economy?",
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
  expectConceptFailure(
    {
      ...directConcept,
      question: "Which factor shapes language variation?",
      answer: "Degrees of variation among speakers",
    },
    "question_answer_kind_mismatch",
  );
  expectConceptFailure(
    {
      ...directConcept,
      concept: "socialization",
      question: "Which process is called socialization?",
      answer: "socialization",
    },
    "question_tautology_invalid",
  );
  expectConceptFailure(
    {
      ...directConcept,
      question:
        "How can an ecosystem become vulnerable to collapse even without catastrophic events?",
      answer: "even without cataclysmic events, like volcanoes and asteroids",
    },
    "question_answer_kind_mismatch",
  );
  expectConceptFailure(
    {
      ...directConcept,
      question:
        "How can an ecosystem become vulnerable to collapse even without catastrophic events?",
      answer: "when biodiversity becomes too low to maintain resilience",
    },
    null,
  );

  for (const answer of [
    "Every link provides stability to the next",
    "Cut too many links, and we risk unraveling it all.",
    "a jacket of gases",
  ]) {
    expectConceptFailure(
      {
        ...directConcept,
        question: "How does biodiversity support ecosystem stability?",
        answer,
      },
      "low_pedagogical_value",
    );
  }

  expectConceptFailure(
    {
      ...directConcept,
      question:
        "What minimum percentage is required by the defined safety threshold?",
      answer: "75 percent",
    },
    null,
  );
  expectConceptFailure(
    {
      ...directConcept,
      question:
        "A 12 N force acts on a 3 kg object. What acceleration does it produce?",
      answer: "4 m/s^2",
    },
    null,
  );
});

test("v5.8 source selection excludes figurative presentation scaffolding", () => {
  const selection = buildConceptFirstInstructionalSelection(
    [
      "Biodiversity is like a tapestry woven from many strands.",
      "Every link provides stability to the next.",
      "Cut too many links and the ecosystem may unravel.",
      "Genetic diversity increases the range of traits available for adaptation.",
      "Greater trait variation makes it more likely that some organisms survive environmental change.",
      "Interacting species distribute ecological functions across the community.",
    ].join(" "),
    { topicHint: "biodiversity and ecosystem resilience" },
  );

  assert.ok(selection.excerpts.length > 0);
  assert.doesNotMatch(
    selection.excerpts.join(" "),
    /tapestry|woven|strands|every link|unravel/iu,
  );
  assert.match(
    selection.excerpts.join(" "),
    /genetic diversity|trait variation/iu,
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

test("learner-visible quiz language may differ from private evidence language", () => {
  const arabicEvidence =
    "تتحول بقايا الكائنات القديمة تحت الضغط إلى وقود أحفوري.";
  const englishCandidate = {
    question: "What are fossil fuels?",
    concept: "fossil fuel formation",
    explanation:
      "Fossil fuels form from ancient organic matter under pressure.",
    evidenceQuote: arabicEvidence,
    answerSpan: "وقود أحفوري",
    answerText: "carbon-based fuels formed from ancient organic matter",
    distractors: [
      { text: "recent plant waste", whyWrong: "It has not undergone burial." },
      { text: "solar radiation", whyWrong: "It is energy, not buried matter." },
      { text: "atmospheric oxygen", whyWrong: "It is not a carbon fuel." },
    ],
  };
  assert.equal(questionMatchesQuizLanguage(englishCandidate, "en"), true);
  assert.equal(
    questionMatchesQuizLanguage(
      {
        ...englishCandidate,
        distractors: englishCandidate.distractors.map((entry) => ({
          ...entry,
          whyWrong: "الدليل الخاص يدعم إجابة مختلفة.",
        })),
      },
      "en",
    ),
    true,
  );
  assert.equal(
    questionMatchesQuizLanguage(
      {
        ...englishCandidate,
        answerText: "وقود أحفوري",
      },
      "en",
    ),
    false,
  );
  assert.equal(
    questionMatchesQuizLanguage(
      {
        ...englishCandidate,
        question: "什么是化石燃料？",
        concept: "化石燃料形成",
        explanation: "化石燃料由古代有机物在压力下形成。",
        answerText: "由古代有机物形成的含碳燃料",
        distractors: englishCandidate.distractors.map((entry, index) => ({
          text: [`近期植物废物`, `太阳辐射`, `大气中的氧气`][index],
          whyWrong: [
            `它尚未经历长期埋藏。`,
            `它是能量而不是埋藏物质。`,
            `它不是含碳燃料。`,
          ][index],
        })),
      },
      "zh-CN",
    ),
    true,
  );
});

test("v5.8 locally resolves the prior greenhouse, vaccine, cryptography, and photosynthesis answers", () => {
  const cases = [
    {
      evidence:
        "Greenhouse gases absorb outgoing infrared radiation and slow the loss of heat to space.",
      answer: "absorb outgoing infrared radiation",
      distractors: [
        "reflect all visible sunlight",
        "create energy from nothing",
        "stop atmospheric circulation",
      ],
    },
    {
      evidence:
        "Vaccination exposes the immune system to a safe antigen so memory cells can respond faster later.",
      answer: "memory cells can respond faster later",
      distractors: [
        "every pathogen is removed immediately",
        "the body no longer needs immune cells",
        "antibiotics become permanently active",
      ],
    },
    {
      evidence:
        "Public-key cryptography uses a public key for encryption while the matching private key performs decryption.",
      answer: "the matching private key performs decryption",
      distractors: [
        "the public key must remain secret",
        "both keys are discarded before transmission",
        "encryption requires publishing the private key",
      ],
    },
    {
      evidence:
        "Photosynthesis converts light energy into chemical energy stored in sugars.",
      answer: "chemical energy stored in sugars",
      distractors: [
        "heat energy stored in oxygen",
        "sound energy stored in roots",
        "motion energy stored in minerals",
      ],
    },
  ];

  for (const item of cases) {
    const candidate = groundedMultipleChoiceCandidate(
      {
        sourceEvidence: item.evidence,
        correctAnswer: item.answer,
        distractors: item.distractors.map((text) => ({
          text,
          whyWrong: "It contradicts the supported mechanism.",
        })),
      },
      item.evidence,
    );
    assert.equal(candidate?.correctAnswer, item.answer);
    assert.deepEqual(candidate?.distractors, item.distractors);
  }
});

test("v5.8 retains instructional supply-and-demand windows without raw transcript fallback", () => {
  const selection = buildConceptFirstInstructionalSelection(
    [
      "Welcome to the channel and remember to subscribe.",
      "When demand increases while supply stays fixed, buyers compete for the available quantity.",
      "That competition raises the market price, which encourages producers to offer more output.",
      "A higher price can therefore coordinate buyer choices with producer incentives.",
      "Thanks for watching and see you next time.",
    ].join(" "),
    { topicHint: "Supply and demand" },
  );
  assert.ok(selection);
  assert.match(selection.excerpts[0], /demand|market price|producer/iu);
  assert.doesNotMatch(selection.excerpts.join(" "), /subscribe|watching/iu);
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

test("resolved answer propositions block the live climate projection paraphrase", () => {
  const first = {
    type: "multiple_choice",
    concept: "Climate projections definition",
    objectiveCategory: "definition",
    question:
      "What do scientists and climate experts use to make projections about the world's future climate over the next 30 to 80 years?",
    correctAnswer: "They factor in the current state of affairs.",
    claim: {
      subject: "Climate projections definition",
      relation: "definition",
      value: "Climate projections definition",
      cluster: "Climate projections definition",
    },
  };
  const accepted = [
    {
      claimKey: claimKeyForCandidate(first),
      conceptCluster: conceptClusterForCandidate(first),
      concept: first.concept,
      question: first.question,
      answer: first.correctAnswer,
    },
  ];
  assert.equal(
    candidateDuplicatesAccepted(
      {
        type: "multiple_choice",
        concept: "condition for climate projections",
        objectiveCategory: "condition",
        question:
          "What condition is necessary for scientists and climate experts to make projections about the world's future climate over the next 30 to 80 years?",
        correctAnswer: "They factor in the current state of affairs.",
        claim: {
          subject: "condition for climate projections",
          relation: "condition",
          value: "condition for climate projections",
          cluster: "condition for climate projections",
        },
      },
      accepted,
      5,
    ),
    true,
  );
});

test("a focused source may assess distinct claims in one broad concept cluster", () => {
  const accepted = [
    {
      claimKey: "lithosphere consists crust upper mantle",
      conceptCluster: "plate tectonics earth structure",
      concept: "Lithosphere composition",
      question: "Which layers together form the lithosphere?",
    },
  ];
  assert.equal(
    candidateDuplicatesAccepted(
      {
        concept: "Convergent plate interaction",
        question:
          "How do tectonic plates interact at a convergent plate margin?",
        claim: {
          subject: "tectonic plates",
          relation: "move toward one another at",
          value: "a convergent margin",
          cluster: "plate tectonics earth structure",
        },
      },
      accepted,
      5,
    ),
    false,
  );
});
