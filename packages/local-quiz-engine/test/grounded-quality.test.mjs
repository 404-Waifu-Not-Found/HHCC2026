import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConceptFirstInstructionalSelection,
  questionConceptFailure,
  questionMatchesQuizLanguage,
} from "../src/grounded-quality.js";
import {
  promptFirstLearnerQualityFailure,
  promptFirstRetryQuestionFailure,
} from "../src/local-generator.js";

test("Simplified Chinese quizzes reject English learner-visible options", () => {
  const candidate = {
    question: "光合作用如何储存能量？",
    concept: "光合作用",
    explanation: "光合作用把光能转化为化学能。",
    answerText: "It converts light energy into chemical energy.",
    distractors: ["It releases all energy as heat.", "ATP", "H2O"],
  };

  assert.equal(questionMatchesQuizLanguage(candidate, "zh-CN"), false);
  assert.equal(
    questionMatchesQuizLanguage(
      {
        ...candidate,
        answerText: "它把光能转化为化学能。",
        distractors: ["它把全部能量释放为热。", "ATP", "H2O"],
      },
      "zh-CN",
    ),
    true,
  );
});
test("learner-facing quality rejects presentation characterization wording", () => {
  assert.equal(
    questionConceptFailure({
      question:
        "What does the structure of a neural network aim to provide when it is described as motivated?",
      concept: "motivated structure",
      answerText: "Useful behavior",
      explanation: "The structure provides useful behavior.",
    }),
    "source_framing_invalid",
  );
});

test("learner-facing quality rejects inverted catenation definitions", () => {
  assert.equal(
    questionConceptFailure({
      question:
        "With four valence electrons, carbon often catenates, which means it bonds to hydrogen.",
      concept: "carbon catenation",
      answerText: "False",
      explanation:
        "Catenation means carbon bonds to other carbon atoms, not hydrogen.",
    }),
    "source_grounding_invalid",
  );
});

test("prompt-first grounding rejects an unrelated domain but keeps a supported paraphrase", () => {
  const primary =
    "Black and white images represent each pixel with a binary value indicating whether it is black or white.";
  const context = `${primary} Each pixel therefore uses one bit when only two colors are possible.`;
  assert.equal(
    promptFirstLearnerQualityFailure(
      {
        type: "short_answer",
        concept: "package tracking frequency",
        question:
          "How often do package-tracking systems update their location?",
        answer: "Every few minutes.",
      },
      context,
      primary,
      true,
    ),
    "source_grounding_invalid",
  );
  assert.equal(
    promptFirstLearnerQualityFailure(
      {
        type: "short_answer",
        concept: "pixel representation",
        question: "What does one bit represent in a black-and-white image?",
        answer: "Whether a pixel is black or white.",
      },
      context,
      primary,
      true,
    ),
    null,
  );
});

test("prompt-first quality rejects compound true-false claims and consequences", () => {
  const evidence =
    "Newton expressed physical motion as universal mathematical laws. Religious explanations continued to exist alongside scientific ones.";
  assert.equal(
    promptFirstLearnerQualityFailure(
      {
        type: "true_false",
        concept: "Newtonian laws",
        question:
          "Newton established mathematical laws, replacing the idea of a divine hand at work.",
        correction: "Newton established mathematical laws of motion.",
        explanation: "The laws describe physical and celestial motion.",
        answer: true,
      },
      evidence,
      evidence,
      true,
    ),
    "true_false_compound_claim",
  );
  assert.equal(
    promptFirstLearnerQualityFailure(
      {
        type: "true_false",
        concept: "Newtonian laws",
        question: "Newton expressed physical motion as mathematical laws.",
        correction: "Newton expressed physical motion as mathematical laws.",
        explanation: "The laws describe physical motion mathematically.",
        answer: true,
      },
      evidence,
      evidence,
      true,
    ),
    null,
  );
});

test("prompt-first quality rejects historical scope and named-person recall", () => {
  const evidence =
    "Ampere found that parallel wires carrying current in the same direction attract. Oersted observed that a current-carrying wire creates a magnetic field. Electricity has been studied since antiquity. Edison promoted the electric chair during a publicity campaign against alternating current.";
  const rejected = [
    {
      type: "multiple_choice",
      concept: "Ampere's wire experiment",
      question:
        "What did Ampère show about two parallel wires carrying current?",
      correctAnswer:
        "Wires carrying current in the same direction attract each other.",
    },
    {
      type: "short_answer",
      concept: "Oersted's experiment",
      question: "What did Ørsted’s experiments demonstrate about electricity?",
      answer: "A current-carrying wire creates a magnetic field.",
    },
    {
      type: "multiple_choice",
      concept: "history of electricity",
      question: "What is the historical scope of the study of electricity?",
      correctAnswer: "It dates back to antiquity.",
    },
    {
      type: "true_false",
      concept: "AC publicity campaign",
      question:
        "Edison promoted the electric chair during a campaign against alternating current.",
      correction:
        "Edison promoted the electric chair during a campaign against alternating current.",
      answer: true,
    },
    {
      type: "multiple_choice",
      concept: "Oersted's observation",
      question:
        "What relationship did Ørsted's observation of the compass needle reveal?",
      correctAnswer: "Electric current produces a magnetic field.",
    },
    {
      type: "short_answer",
      concept: "Edison's promotion of capital punishment",
      question: "How did Edison promote capital punishment in New York?",
      answer:
        "Edison supported an electric chair powered by alternating current.",
    },
    {
      type: "true_false",
      concept: "public awareness of scientists",
      question:
        "The average person in the 1870s knew who Faraday and Maxwell were.",
      correction:
        "The average person in the 1870s did not know who Faraday and Maxwell were.",
      answer: false,
    },
  ];
  for (const question of rejected) {
    assert.equal(
      promptFirstLearnerQualityFailure(question, evidence, evidence, true),
      "low_pedagogical_value",
    );
  }
});

test("prompt-first quality keeps direct relationships after removing name recall", () => {
  const accepted = [
    {
      type: "short_answer",
      concept: "parallel current-carrying wires",
      question:
        "How do two parallel wires interact when their currents flow in the same direction?",
      answer: "They attract each other.",
    },
    {
      type: "short_answer",
      concept: "magnetic field around a wire",
      question:
        "What forms around a wire when electric current flows through it?",
      answer: "A magnetic field forms around the wire.",
    },
    {
      type: "short_answer",
      concept: "AC publicity campaign",
      question:
        "Why was alternating current associated with the electric chair during the current wars?",
      answer:
        "The association was used to portray alternating current as dangerous.",
    },
  ];
  for (const question of accepted) {
    assert.equal(
      promptFirstLearnerQualityFailure(question, "", "", false),
      null,
    );
  }
});

test("v5.12 source ranking removes history-show narration before DeepSeek", () => {
  const selection = buildConceptFirstInstructionalSelection(
    [
      "The study of electricity goes all the way back to antiquity.",
      "While demonstrating to his students how to heat a wire, Oersted noticed a compass needle jump.",
      "Edison promoted capital punishment using an electric chair powered by alternating current.",
      "The average person in the 1870s did not know who Faraday and Maxwell were.",
      "Born to a poor family, Faraday became obsessed with electricity.",
      "Mostly, people remember Edison for his work on practical light bulbs.",
      "Oersted conducted further experiments and showed that electric currents produce circular magnetic fields around wires.",
      "Current can occur through the movement of electrons in wires or charged ions in a material.",
      "Ohm's law states that current is directly proportional to voltage when resistance is constant.",
      "A voltaic pile uses alternating metal discs and brine-soaked separators to produce a steady electric current.",
      "Maxwell expressed relationships between electricity and magnetism as differential equations.",
      "Parallel wires carrying current in the same direction attract each other.",
    ].join(" "),
    {
      topicHint: "Electricity: History of Science",
      diverse: true,
      strictPromptFirst: true,
      coherentPromptFirst: true,
    },
  );

  const selected = selection.primaryClaims.join(" ");
  assert.ok(selection.primaryClaims.length >= 4);
  assert.doesNotMatch(
    selected,
    /antiquity|demonstrating to his students|capital punishment|average person|born to a poor family|people remember Edison/iu,
  );
  assert.match(selected, /circular magnetic fields|Ohm's law/iu);
});

test("adaptive retries require a genuinely different AI-generated prompt", () => {
  assert.equal(
    promptFirstRetryQuestionFailure({
      question: "What does induction mean?",
      retryQuestion: "What does induction mean!",
    }),
    "retry_question_invalid",
  );
  assert.equal(
    promptFirstRetryQuestionFailure({
      question: "What does induction mean?",
      retryQuestion:
        "Which reasoning process draws a general conclusion from examples?",
    }),
    null,
  );
  assert.equal(
    promptFirstRetryQuestionFailure({
      type: "true_false",
      question:
        "The classical worldview held that space and time were relative.",
      retryQuestion:
        "Under the classical worldview, were space and time absolute or relative?",
      answer: false,
      correction:
        "The classical worldview held that space and time were absolute.",
      explanation:
        "Classical physics treated spatial and temporal measurements as absolute.",
    }),
    "retry_question_invalid",
  );
  assert.equal(
    promptFirstRetryQuestionFailure({
      type: "true_false",
      question:
        "The classical worldview held that space and time were relative.",
      retryQuestion:
        "Classical physics treated space and time as relative rather than absolute.",
      answer: false,
      correction:
        "The classical worldview held that space and time were absolute.",
      explanation:
        "Classical physics treated spatial and temporal measurements as absolute.",
    }),
    null,
  );
});

test("true-false adaptive retries preserve the original negation polarity", () => {
  const trueQuestion = {
    type: "true_false",
    question: "A connected voltaic pile produces a steady electric current.",
    retryQuestion:
      "A voltaic pile produces steady current only when it is not connected.",
    correction: "A connected voltaic pile produces a steady electric current.",
    explanation: "Completing the circuit allows charge to flow.",
    answer: true,
  };
  assert.equal(
    promptFirstRetryQuestionFailure(trueQuestion),
    "polarity_mismatch",
  );
  assert.equal(
    promptFirstRetryQuestionFailure({
      ...trueQuestion,
      retryQuestion:
        "Completing the voltaic pile's circuit allows it to produce a steady current.",
    }),
    null,
  );
});
