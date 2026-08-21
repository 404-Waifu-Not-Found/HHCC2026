import assert from "node:assert/strict";
import test from "node:test";
import { questionConceptFailure } from "../src/grounded-quality.js";
import { promptFirstLearnerQualityFailure } from "../src/local-generator.js";

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
        question: "How often do package-tracking systems update their location?",
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
