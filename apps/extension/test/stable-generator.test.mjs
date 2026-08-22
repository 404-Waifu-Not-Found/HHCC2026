import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inspect } from "node:util";
import {
  adaptiveChunkQuestionCount,
  boundedRetryDelayMilliseconds,
  buildQuestionTypePlanFromSeed,
  buildTrueFalseAnswerPlanFromSeed,
  CONCEPT_FIRST_SYSTEM_PROMPT,
  PROMPT_FIRST_SYSTEM_PROMPT,
  generateQuizFromPlainText,
  hasPromptFirstV511FormulaEvidence,
  hasPromptFirstV512FormulaEvidence,
  normalizeGeneratedQuestion,
  promptFirstLearnerQualityFailure,
  promptFirstV512AssessmentText,
  promptFirstV512DistinctContext,
  promptFirstV512EvidenceIndex,
  promptFirstV512RepeatsAcceptedFamily,
  serializeFormulaTokens,
} from "../src/local-generator.js";

test("rejects a false true/false item whose explanation labels the statement true", () => {
  assert.equal(
    promptFirstLearnerQualityFailure(
      {
        type: "true_false",
        concept: "current and resistance",
        question: "Increasing resistance increases current at fixed voltage.",
        answer: false,
        correction: "Increasing resistance decreases current at fixed voltage.",
        explanation:
          "The statement is true because current changes with resistance.",
      },
      "Increasing resistance decreases current at fixed voltage.",
      "Increasing resistance decreases current at fixed voltage.",
    ),
    "polarity_mismatch",
  );
});

test("rejects a true true/false item whose explanation labels the statement false", () => {
  assert.equal(
    promptFirstLearnerQualityFailure(
      {
        type: "true_false",
        concept: "current and resistance",
        question: "Increasing resistance decreases current at fixed voltage.",
        answer: true,
        correction: "Increasing resistance decreases current at fixed voltage.",
        explanation:
          "The statement is false because current changes with resistance.",
      },
      "Increasing resistance decreases current at fixed voltage.",
      "Increasing resistance decreases current at fixed voltage.",
    ),
    "polarity_mismatch",
  );
});

test("stable v5.2 reconciles a false label whose correction repeats the prompt", () => {
  const prompt =
    "Increased dehydration can cause drops in energy, mood, and blood pressure.";
  const normalized = normalizeGeneratedQuestion(
    {
      id: "q1",
      type: "true_false",
      concept: "dehydration effects",
      question: prompt,
      answer: false,
      correction: `The correct statement is: ${prompt}`,
      explanation: "Dehydration can cause all of these effects.",
    },
    { expectedId: "q1" },
  );

  assert.equal(normalized.answer, true);
  assert.equal(normalized.correction, prompt);
  assert.equal(normalized.question, prompt);
});

test("v5.12 evidence allocation avoids an already used narrative window", () => {
  const input = {
    promptFirstPrimaryClaims: [
      "Leukocytes originate in bone marrow.",
      "Autoimmune diseases attack healthy cells.",
      "A mosquito injects chemicals into the skin.",
    ],
    promptFirstEvidenceWindows: [
      "A mosquito injects chemicals into the skin. Leukocytes originate in bone marrow.",
      "B and T cells create long-term immunity. Autoimmune diseases attack healthy cells.",
      "A mosquito injects chemicals into the skin. A red itchy bump appears after the bite.",
    ],
  };
  const accepted = [
    {
      type: "multiple_choice",
      concept: "leukocyte origin",
      question: "Where do leukocytes originate?",
      answer: "They originate in bone marrow.",
    },
  ];

  assert.equal(
    promptFirstV512EvidenceIndex(input, 1, accepted, new Set([0])),
    1,
  );
});

test("v5.12 automatic refill rotates away from the previous round's opening evidence", () => {
  const base = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Claim zero explains alpha.",
      "Claim one explains beta.",
      "Claim two explains gamma.",
      "Claim three explains delta.",
    ],
    promptFirstEvidenceWindows: [
      "Claim zero explains alpha.",
      "Claim one explains beta.",
      "Claim two explains gamma.",
      "Claim three explains delta.",
    ],
  };
  assert.equal(promptFirstV512EvidenceIndex(base, 1, [], new Set()), 1);
  assert.equal(
    promptFirstV512EvidenceIndex(
      {
        ...base,
        continuation: { nextOrdinalAttempt: 4 },
      },
      1,
      [],
      new Set(),
    ),
    0,
  );
});

test("v5.12 evidence allocation prefers a used distinct family over an unused repeated family", () => {
  const input = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Burning fossil fuels releases greenhouse gases and other air pollutants.",
      "Nonrenewable energy sources exist in a fixed amount and cannot be easily replaced.",
    ],
    promptFirstEvidenceWindows: [
      "Burning fossil fuels releases greenhouse gases and other air pollutants.",
      "Nonrenewable resources are finite because they form too slowly to be replenished quickly.",
    ],
  };
  const accepted = [
    {
      type: "short_answer",
      concept: "finite nonrenewable resources",
      question: "Why are nonrenewable resources finite?",
      answer: "They form too slowly to be replenished quickly.",
      explanation:
        "Their current supply cannot be renewed on a human timescale.",
    },
  ];

  assert.equal(
    promptFirstV512EvidenceIndex(input, 4, accepted, new Set([0])),
    0,
  );
});

test("v5.12 family integrity catches synonym and cross-type repeats", () => {
  const accepted = [
    {
      type: "multiple_choice",
      concept: "median for an even-sized data set",
      question: "How is the median found when a data set has an even count?",
      answer: "Take the mean of the two middle values.",
      explanation: "The two central values share the middle position.",
    },
    {
      type: "short_answer",
      concept: "conventional current direction",
      question:
        "How does conventional current direction compare with electron flow?",
      answer: "They point in opposite directions.",
      explanation:
        "Conventional current goes from positive to negative while electrons move the other way.",
    },
  ];
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "true_false",
        concept: "median calculation",
        question:
          "For an even-sized data set, the median is the average of the two central values.",
        answer: true,
        correction:
          "For an even-sized data set, the median is the average of the two central values.",
        explanation: "No single observation occupies the middle position.",
      },
      accepted,
    ),
    true,
  );
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "true_false",
        concept: "historical current convention",
        question:
          "Conventional electric current points in the same direction as electron flow.",
        answer: false,
        correction:
          "Conventional electric current points opposite to electron flow.",
        explanation: "The sign convention predates the discovery of electrons.",
      },
      accepted,
    ),
    true,
  );
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "multiple_choice",
        concept: "mean application",
        question: "What is the mean of 23, 29, 20, 32, 23, 21, 33, and 25?",
        answer: "25.75",
        explanation: "Their sum is 206, and 206 divided by 8 is 25.75.",
      },
      [accepted[0]],
    ),
    false,
  );

  const acceptedDomainFamilies = [
    {
      type: "true_false",
      concept: "energy release in cellular respiration",
      question: "Cellular respiration releases energy from glucose.",
      answer: true,
      correction: "Cellular respiration releases energy from glucose.",
    },
    {
      type: "short_answer",
      concept: "nonpolar covalent bond condition",
      question: "When is a covalent bond nonpolar?",
      answer:
        "When equal electronegativities cause the electrons to be shared equally.",
    },
    {
      type: "short_answer",
      concept: "sound wave mechanism",
      question: "What are sound waves physically?",
      answer: "Pressure waves traveling through air.",
    },
    {
      type: "short_answer",
      concept: "selective breeding mechanism",
      question: "How does selective breeding change a population?",
      answer: "Desired heritable traits become more common over generations.",
    },
    {
      type: "true_false",
      concept: "polar bond charge distribution",
      question:
        "The more electronegative atom in a polar bond becomes partially negative.",
      answer: true,
      correction:
        "The more electronegative atom in a polar bond becomes partially negative.",
    },
    {
      type: "multiple_choice",
      concept: "wavelength-dependent transmission",
      question:
        "What determines how much light a material transmits at each wavelength?",
      answer: "The wavelength and the material's properties.",
    },
    {
      type: "short_answer",
      concept: "light transmission through a lens",
      question: "What happens when light passes through a lens?",
      answer: "It exits the other side and continues onward.",
    },
    {
      type: "short_answer",
      concept: "photosynthesis mass source",
      question: "Where does most new plant mass come from?",
      answer: "Carbon dioxide and water become plant biomass.",
    },
  ];

  for (const candidate of [
    {
      type: "multiple_choice",
      concept: "cellular respiration energy conversion",
      question: "How does cellular respiration provide usable energy?",
      answer: "It releases chemical energy while breaking down glucose.",
    },
    {
      type: "short_answer",
      concept: "equal electronegativity",
      question:
        "How are electrons distributed when bonded atoms have equal electronegativity?",
      answer: "They are shared evenly, producing a nonpolar bond.",
    },
    {
      type: "short_answer",
      concept: "sound transmission",
      question: "Which wave travels through air as pressure changes?",
      answer: "Sound waves.",
    },
    {
      type: "true_false",
      concept: "selective breeding outcome",
      question:
        "Selecting desired traits over generations changes breed characteristics.",
      answer: true,
    },
    {
      type: "short_answer",
      concept: "electronegativity and partial charge",
      question:
        "Why does carbon become partially positive when bonded to oxygen?",
      answer:
        "Oxygen pulls shared electron density toward itself more strongly.",
    },
    {
      type: "true_false",
      concept: "selective light transmission",
      question:
        "A material transmits different wavelengths of light by different amounts.",
      answer: true,
      correction:
        "A material transmits different wavelengths of light by different amounts.",
    },
    {
      type: "true_false",
      concept: "lens transmission path",
      question:
        "Light is absorbed by a lens instead of continuing to the other side.",
      answer: false,
      correction: "Light passes through the lens and continues onward.",
    },
    {
      type: "short_answer",
      concept: "photosynthesis inputs",
      question: "Which environmental substances enter photosynthesis?",
      answer: "Carbon dioxide and water.",
    },
  ]) {
    assert.equal(
      promptFirstV512RepeatsAcceptedFamily(candidate, acceptedDomainFamilies),
      true,
    );
  }
});

test("v5.12 family integrity catches Fresh12 free-energy and elasticity repeats", () => {
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "true_false",
        concept: "free energy and equilibrium",
        question:
          "The standard free energy change is related to the equilibrium constant by an equation.",
        answer: true,
      },
      [
        {
          type: "multiple_choice",
          concept: "calculating the equilibrium constant",
          question:
            "How can the equilibrium constant be calculated from standard free energy?",
          choices: [
            "Divide by negative RT and exponentiate.",
            "Multiply by RT.",
            "Add RT.",
            "Square RT.",
          ],
          answerIndex: 0,
          explanation:
            "The equation delta G naught equals negative RT ln K is solved by dividing by negative RT and exponentiating.",
        },
      ],
    ),
    true,
  );
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "multiple_choice",
        concept: "equilibrium direction",
        question:
          "What does positive standard free energy imply about equilibrium?",
        correctAnswer: "K is below one and reactants are favored.",
      },
      [
        {
          type: "true_false",
          concept: "positive free energy and K",
          question: "If delta G naught is positive, K is less than one.",
          answer: true,
        },
      ],
    ),
    true,
  );
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "multiple_choice",
        concept: "income elasticity",
        question: "What does positive income elasticity indicate?",
        correctAnswer: "The good is normal.",
      },
      [
        {
          type: "true_false",
          concept: "normal good",
          question: "A positive income elasticity identifies a normal good.",
          answer: true,
        },
      ],
    ),
    true,
  );
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "true_false",
        concept: "income elasticity",
        question:
          "Demand can fall as income rises, producing negative income elasticity.",
        answer: true,
      },
      [
        {
          type: "short_answer",
          concept: "inferior good",
          question: "What type of good has negative income elasticity?",
          answer: "inferior good",
        },
      ],
    ),
    true,
  );
});

test("v5.12 family integrity catches Fresh13 repeated objectives", () => {
  const repeatedPairs = [
    [
      {
        type: "short_answer",
        concept: "nonrenewable resources",
        question: "Why are nonrenewable resources finite?",
        answer: "They form too slowly to replace the fixed supply.",
      },
      {
        type: "true_false",
        concept: "nonrenewable supply",
        question: "Nonrenewable resources exist in a fixed amount.",
        answer: true,
      },
    ],
    [
      {
        type: "multiple_choice",
        concept: "sexual reproduction",
        question: "Why are sexually produced offspring genetically varied?",
        correctAnswer: "They combine genes from two parents.",
      },
      {
        type: "true_false",
        concept: "genetic diversity",
        question: "Sexual reproduction creates genetic variation.",
        answer: true,
      },
    ],
    [
      {
        type: "multiple_choice",
        concept: "phylogenetic parsimony",
        question: "Which phylogenetic hypothesis is preferred?",
        correctAnswer: "The simplest hypothesis explaining the traits.",
      },
      {
        type: "short_answer",
        concept: "parsimony",
        question: "What principle favors the fewest evolutionary changes?",
        answer: "Phylogenetic parsimony.",
      },
    ],
    [
      {
        type: "multiple_choice",
        concept: "long-run monopolistic competition",
        question: "What happens to economic profit after long-run entry?",
        correctAnswer: "It falls to zero.",
      },
      {
        type: "short_answer",
        concept: "firm entry",
        question: "Why does further entry stop in the long run?",
        answer: "There is no economic profit left to attract firms.",
      },
    ],
    [
      {
        type: "true_false",
        concept: "energy resource categories",
        question:
          "Energy resources are divided into renewable and nonrenewable groups.",
        answer: true,
      },
      {
        type: "short_answer",
        concept: "energy classification",
        question: "What are the two groups of energy resources?",
        answer: "Renewable energy and nonrenewable energy.",
      },
    ],
    [
      {
        type: "short_answer",
        concept: "right to organize",
        question: "Which economic right protects union organization?",
        answer: "The right to organize a labor union.",
      },
      {
        type: "multiple_choice",
        concept: "union membership",
        question: "What does the right to join a union protect?",
        correctAnswer:
          "A worker's freedom to organize without employer interference.",
      },
    ],
    [
      {
        type: "multiple_choice",
        concept: "fossil fuel formation",
        question: "What process forms fossil fuels?",
        correctAnswer:
          "Ancient organic remains are transformed by burial, heat, and pressure.",
      },
      {
        type: "short_answer",
        concept: "fossil fuel origin",
        question: "What is the origin of fossil fuels?",
        answer:
          "Fossil fuels formed from the remains of ancient organisms in the geologic past.",
      },
    ],
  ];
  for (const [accepted, candidate] of repeatedPairs) {
    assert.equal(
      promptFirstV512RepeatsAcceptedFamily(candidate, [accepted]),
      true,
    );
  }
});

test("v5.12 scopes political recommendations as viewpoints before prompting", () => {
  assert.equal(
    promptFirstV512AssessmentText(
      "On the other hand, someone who really cares about equality of opportunity might say, well, hold on a second, not everyone is born into the same circumstance.",
    ),
    "An equality-of-opportunity viewpoint argues that unequal starting circumstances can justify a government role in leveling the playing field.",
  );
  assert.equal(
    promptFirstV512AssessmentText(
      "Instead of only learning household skills or etiquette, women should learn philosophy and mathematics.",
    ),
    "Republican motherhood advocated expanding women's education beyond household skills and etiquette to include philosophy and mathematics.",
  );
  assert.equal(
    promptFirstV512AssessmentText(
      "To some degree, they feed into these first two bullet points, that if there truly is equality of oppurtunity, it kind of backs up the idea that, hey, let's just let people take care of themselves.",
    ),
    "An equality-of-opportunity viewpoint argues that unequal starting circumstances can justify a government role in leveling the playing field.",
  );
  assert.equal(
    promptFirstV512AssessmentText(
      "The entire core, as far as we know, is made up of the same stuff.",
    ),
    "Earth's inner and outer core share the same metallic composition even though the outer core is liquid and the inner core is solid.",
  );
});

test("v5.12 family integrity catches Fresh10 atomic and monopsony repeats", () => {
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "short_answer",
        concept: "photon absorption relationship",
        question: "What determines whether an atom absorbs a photon?",
        answer:
          "The photon energy must match an allowed electron energy-level difference.",
        explanation:
          "Electrons can occupy only discrete allowed energy levels.",
      },
      [
        {
          type: "multiple_choice",
          concept: "photon absorption condition",
          question: "What condition allows an electron to absorb a photon?",
          answer:
            "The photon energy exactly equals the gap to an allowed higher energy level.",
          explanation:
            "A photon passes through when its energy does not match an allowed transition.",
        },
      ],
    ),
    true,
  );
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "short_answer",
        concept: "monopsony marginal factor cost",
        question:
          "How does marginal factor cost relate to the labor supply curve in a monopsony?",
        answer:
          "The marginal factor cost curve lies above the labor supply curve.",
        explanation:
          "Hiring one more worker requires raising the wage paid to all workers.",
      },
      [
        {
          type: "multiple_choice",
          concept: "monopsony wage setting",
          question:
            "What wage condition applies when a monopsonist hires another worker?",
          answer: "The higher wage must be paid to every worker.",
          explanation:
            "The labor supply curve slopes upward for the sole employer.",
        },
      ],
    ),
    true,
  );
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "true_false",
        concept: "S-wave shadow zone",
        question:
          "S-waves are not detected in the shadow zone opposite an earthquake.",
        correction:
          "S-waves are not detected in the shadow zone opposite an earthquake.",
        explanation:
          "The liquid outer core blocks S-waves from reaching that region.",
      },
      [
        {
          type: "short_answer",
          concept: "S-wave propagation through the core",
          question: "Why can S-waves not travel through Earth's outer core?",
          answer:
            "The outer core is liquid, and S-waves require a solid medium.",
          explanation: "The liquid outer core creates the S-wave shadow zone.",
        },
      ],
    ),
    true,
  );
  assert.equal(
    promptFirstV512RepeatsAcceptedFamily(
      {
        type: "true_false",
        concept: "domestication and settlement",
        question:
          "Domesticating plants and animals allowed people to settle and live more sedentary lives.",
        correction:
          "Domesticating plants and animals allowed people to settle and live more sedentary lives.",
        explanation:
          "A dependable food supply reduced the need to move in search of food.",
      },
      [
        {
          type: "multiple_choice",
          concept: "agriculture and settlement",
          question:
            "How did adopting agriculture change a group's settlement pattern?",
          answer: "It allowed the group to become more sedentary.",
          explanation:
            "Agriculture let groups stay in one place for longer periods.",
        },
      ],
    ),
    true,
  );
});

test("v5.12 family allocation blocks the Fresh9 repeated objectives", () => {
  const cases = [
    {
      accepted: {
        type: "true_false",
        concept: "peppered moth visibility",
        question:
          "White peppered moths are easier for predators to see on dark surfaces.",
        answer: true,
        correction:
          "White peppered moths are easier for predators to see on dark surfaces.",
        explanation:
          "The light coloration contrasts with soot-darkened resting surfaces.",
      },
      candidate: {
        type: "short_answer",
        concept: "peppered moth survival",
        question: "When do birds pick off white peppered moths more easily?",
        answer: "When the resting background is dark.",
        explanation:
          "The white moths lose camouflage against a dark background.",
      },
    },
    {
      accepted: {
        type: "short_answer",
        concept: "English varieties",
        question:
          "How does Standard American English relate to other English varieties?",
        answer: "It is one of many valid English varieties.",
        explanation: "No English variety is inherently superior.",
      },
      candidate: {
        type: "multiple_choice",
        concept: "dialect legitimacy",
        question:
          "What is appropriate when two people use different forms of English?",
        answer: "Recognize both as legitimate varieties.",
        explanation: "Different English varieties are equally valid.",
      },
    },
    {
      accepted: {
        type: "short_answer",
        concept: "entropy and gas expansion",
        question: "Why does a gas spread into a larger volume?",
        answer:
          "The dispersed arrangement has far more accessible molecular states.",
        explanation:
          "Random motion makes the more numerous dispersed states overwhelmingly probable.",
      },
      candidate: {
        type: "multiple_choice",
        concept: "return to an ordered gas state",
        question:
          "Why do gas molecules not spontaneously return to one side of a container?",
        answer: "The ordered arrangement is overwhelmingly unlikely.",
        explanation:
          "Disordered molecular arrangements greatly outnumber the ordered arrangement.",
      },
    },
  ];

  for (const { accepted, candidate } of cases) {
    assert.equal(
      promptFirstV512RepeatsAcceptedFamily(candidate, [accepted]),
      true,
    );
  }
});

test("v5.12 uses a bounded window as a family hint for pronoun fragments", () => {
  const input = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "The darker ones are easier to spot in the cleaner environment.",
      "Gas initially confined to one side spreads through the container.",
      "White peppered moths stand out against soot-darkened surfaces.",
    ],
    promptFirstEvidenceWindows: [
      "In a cleaner environment, darker peppered moths are easier for predators to spot.",
      "Gas particles spread through the available container volume because dispersed arrangements are more numerous.",
      "White peppered moths stand out against soot-darkened surfaces and are easier for birds to catch.",
    ],
  };
  const accepted = [
    {
      type: "true_false",
      concept: "peppered moth camouflage",
      question:
        "Darker peppered moths are easier to spot on clean, light surfaces.",
      answer: true,
      correction:
        "Darker peppered moths are easier to spot on clean, light surfaces.",
      explanation: "Their coloration contrasts with the resting surface.",
    },
  ];

  assert.equal(
    promptFirstV512EvidenceIndex(input, 1, accepted, new Set([0])),
    1,
  );
});

test("v5.12 reserves predictable crop production after population growth", () => {
  const input = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Domesticating crops increased the food supply and allowed population density to rise.",
      "Planting crops enabled predictable harvesting and a predictable food supply.",
    ],
    promptFirstEvidenceWindows: [
      "Domesticating crops increased the food supply and allowed population density to rise.",
      "Instead of gathering plants wherever they emerged, people planted crops so they could harvest predictably and maintain a predictable food supply.",
    ],
  };
  const accepted = [
    {
      type: "multiple_choice",
      concept: "agriculture and population growth",
      question: "How did agriculture permit population density to increase?",
      answer: "It increased the food supply so more people could be supported.",
      explanation:
        "Domesticated crops and animals increased the available food supply.",
    },
  ];

  assert.equal(
    promptFirstV512EvidenceIndex(input, 1, accepted, new Set([0])),
    1,
  );
});

test("v5.12 normalizes misleading caption shorthand before prompting", () => {
  const normalized = promptFirstV512AssessmentText(
    [
      "Data of any kind can be kept secret through a process known as encryption, descrambling or changing of the message to hide the original text.",
      "Here we will call our system this beaker that has the solution inside of it.",
      "The energy level diagram gives us a way to show what energy the electron has without having to draw an atom with a bunch of circles all the time.",
      "Instead of shifting every letter by the same amount, let's shift each letter by a different amount.",
      "Maybe you had positive climate change, at least from a human point of view, that allowed land to support agriculture.",
      "These extra electrons move freely, making the material negatively charged.",
      "Until, we talk about secondary effects, it led to a wage spiral.",
      "In order for this money supply to be inflationary, you need to see the transaction levels or that velocity of money go up again.",
      "That means it's infeasible to compute in the reverse direction. If I show you some string of 1s and 0s, and ask you to find an input so that the SHA256 hash of that input gives this exact string of bits, you will have no better method than to just guess and check.",
    ].join(" "),
  );

  assert.match(normalized, /scrambling or transforming a message/u);
  assert.doesNotMatch(normalized, /encryption, descrambling/iu);
  assert.match(normalized, /system consists of the beaker and its solution/u);
  assert.match(normalized, /discrete energies that an electron is allowed/u);
  assert.match(normalized, /multi-shift key specifies/u);
  assert.match(normalized, /Post-glacial climate conditions/u);
  assert.match(normalized, /electrically neutral overall/u);
  assert.match(normalized, /wage-price spiral/u);
  assert.match(normalized, /cash-hoarding situation/u);
  assert.match(normalized, /remaining held as cash/u);
  assert.match(normalized, /brute-force guessing and checking/u);
  assert.match(normalized, /computationally infeasible/u);
  assert.match(
    promptFirstV512AssessmentText(
      "The place where the plates collide is called a subduction zone.",
    ),
    /denser plate bends and descends beneath another plate/u,
  );
  assert.match(
    promptFirstV512AssessmentText(
      "The sun, the remaining dust and gas particles collided with each other and eventually formed larger objects like Earth.",
    ),
    /After the Sun formed, the remaining dust and gas particles/u,
  );
  assert.match(
    promptFirstV512AssessmentText(
      "In 1543, Nicolaus Copernicus publishes On the Revolutions of the Heavenly Spheres, famous for suggesting that earth is not the center of the universe but that the earth revolves around the sun.",
    ),
    /Copernicus proposed that Earth is not the center/u,
  );
  assert.doesNotMatch(normalized, /material negatively charged/u);
  assert.doesNotMatch(normalized, /Until, we talk/u);
  assert.equal(
    promptFirstV512AssessmentText(
      "Instead of saying, okay let's just gather those berries there where it happens to emerge, oh let's actually start to plant things.",
    ),
    "Plant cultivation involves deliberately planting crops so they can be harvested predictably instead of gathering plants only where they happen to grow.",
  );
  assert.equal(
    promptFirstV512AssessmentText(
      "But if you do the math based on the shadow, and you know the speed of the material, and all of that type of thing, then you can figure out the depth at which these transitions occur.",
    ),
    "Scientists can calculate the depth of an internal boundary by combining seismic shadow-zone geometry with the wave speed in the material.",
  );
  assert.match(
    promptFirstV512AssessmentText(
      "If we look at differences in amino acid sequences, species one, once again, has the most differences in amino acid sequences, so that confirms our belief that it might be the most different from the unknown plant species.",
    ),
    /Fewer amino-acid sequence differences indicate a closer evolutionary relationship/u,
  );
  assert.equal(
    promptFirstV512AssessmentText(
      "The amount of income to capital is 52, the value of the capital is 1,050 gold pieces.",
    ),
    "Return on capital equals capital income divided by the value of the capital stock.",
  );
  assert.match(
    promptFirstV512AssessmentText(
      "Some of this carbonate might go and nab some of these hydrogen ions, less likely to form an ionic bond with the calcium.",
    ),
    /Additional hydrogen ions bind with carbonate ions/u,
  );
  const commanderInChief = promptFirstV512AssessmentText(
    "States and clearly they don't say all of the different forces of the United States because we didn't have an Air Force then. [Jeffrey] Yes. [Sal] Or Marines. [Jeffrey] We sure didn't, but there was a concern about the king controlling the military.",
  );
  assert.match(
    commanderInChief,
    /establishes unified civilian control of the military under the President/u,
  );
  assert.doesNotMatch(commanderInChief, /Or Marines|We sure didn't/u);
  assert.equal(
    promptFirstV512AssessmentText(
      "But S-waves, S for secondary, these are the transverse waves, these can only travel through solids.",
    ),
    "S-waves travel through solids but not liquids.",
  );
  assert.equal(
    promptFirstV512AssessmentText(
      "But if it goes into a liquid, in general, sound waves, or I should say P-waves, seismic waves move slower in liquids.",
    ),
    "P-waves travel more slowly in liquids than in comparable solid material.",
  );
  assert.equal(
    promptFirstV512AssessmentText(
      "But the real way to know that we have an inner core that's solid, as opposed to the whole thing being liquid, is that the P-waves is the pattern of when and how the P-waves reach essentially the other side of the globe.",
    ),
    "The arrival pattern of P-waves on the far side of Earth is evidence for a solid inner core within the liquid outer core.",
  );
});

test("v5.12 removes already accepted answer-bearing facts from later context", () => {
  const primary =
    "Long-term potentiation strengthens synaptic connections during memory formation.";
  const context = [
    "Activating tagged hippocampal neurons triggered the same learned behavior.",
    primary,
    "Repeated signaling adds receptors and increases neurotransmitter release.",
  ].join(" ");
  const distinct = promptFirstV512DistinctContext(context, primary, [
    {
      type: "multiple_choice",
      question: "What happened when tagged hippocampal neurons were activated?",
      answer: "They triggered the same learned behavior.",
    },
  ]);

  assert.doesNotMatch(distinct, /tagged hippocampal neurons/iu);
  assert.match(distinct, /Long-term potentiation/iu);
  assert.match(distinct, /increases neurotransmitter release/iu);
});

test("v5.12 avoids a previously assessed concept family in later evidence", () => {
  const input = {
    promptFirstPrimaryClaims: [
      "Plastic makes up most marine debris.",
      "The Antarctic Circumpolar Current flows continuously around Antarctica.",
    ],
    promptFirstEvidenceWindows: [
      "The North Pacific Garbage Patch is a dispersed soup of microplastics. Plastic makes up most marine debris.",
      "The Antarctic Circumpolar Current flows continuously around Antarctica. Garbage patches concentrate marine plastic.",
    ],
  };
  const accepted = [
    {
      type: "multiple_choice",
      concept: "marine plastic debris",
      question: "What material makes up most marine debris?",
      answer: "Plastic.",
    },
  ];

  assert.equal(
    promptFirstV512EvidenceIndex(input, 1, accepted, new Set([0])),
    1,
  );
  const distinct = promptFirstV512DistinctContext(
    input.promptFirstEvidenceWindows[1],
    input.promptFirstPrimaryClaims[1],
    accepted,
  );
  assert.match(distinct, /Antarctic Circumpolar Current/iu);
  assert.doesNotMatch(distinct, /marine plastic|garbage patch/iu);
});

test("v5.12 ranks the candidate fact rather than mixed neighboring context", () => {
  const sharedContext =
    "Transmission depends on wavelength and material. Sound crosses a wall when its particles vibrate. Light exits the other side of a lens.";
  const input = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Transmission depends on wavelength and material.",
      "Sound crosses a wall when its particles vibrate.",
      "Light exits the other side of a lens.",
    ],
    promptFirstEvidenceWindows: [sharedContext, sharedContext, sharedContext],
  };
  const accepted = [
    {
      type: "multiple_choice",
      concept: "wavelength-dependent transmission",
      question:
        "What determines how much light a material transmits at each wavelength?",
      answer: "The wavelength and the material's properties.",
    },
  ];

  assert.equal(
    promptFirstV512EvidenceIndex(input, 1, accepted, new Set([0])),
    1,
  );
});

test("v5.12 keeps quality-ranked facts ahead of overlapping window tails", () => {
  const sharedWindow =
    "Trait evidence refines a phylogenetic tree. A tree is a hypothesis. An outgroup locates the root. Derived traits mark divergence. Parsimony favors fewer changes.";
  const input = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Additional trait, protein, and DNA evidence refines phylogenetic trees.",
      "A phylogenetic tree is a hypothesis about evolutionary relationships.",
      "An outgroup helps locate the root of common ancestry.",
      "A derived trait evolves after a lineage diverges.",
      "Parsimony favors the hypothesis with the fewest evolutionary changes.",
      "A branch label can identify a pictured species.",
    ],
    // Neighboring caption windows intentionally share context. That overlap
    // must not cause an unused low-quality tail fact to jump ahead of the
    // selector's quality-ranked primary claims.
    promptFirstEvidenceWindows: Array.from({ length: 6 }, () => sharedWindow),
  };

  assert.equal(promptFirstV512EvidenceIndex(input, 1, [], new Set([0])), 1);
});

test("v5.12 allocates distinct Fresh14 cell, atomic, and dice objectives", () => {
  const cellInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Chloroplasts give plant cells their green coloration and are absent from animal cells.",
      "Animal cells do not contain chloroplasts, unlike plant cells.",
      "Both animal and plant cells have a cell membrane that regulates what enters and leaves the cell.",
    ],
    promptFirstEvidenceWindows: [
      "Chloroplasts give plant cells their green coloration and are absent from animal cells.",
      "Animal cells do not contain chloroplasts, unlike plant cells.",
      "Both animal and plant cells have a cell membrane that regulates what enters and leaves the cell.",
    ],
  };
  const acceptedChloroplast = [
    {
      type: "short_answer",
      concept: "chloroplast role",
      question: "Which organelle performs photosynthesis in plant cells?",
      answer: "Chloroplasts.",
      explanation: "Chloroplasts capture light energy for photosynthesis.",
    },
  ];
  assert.equal(
    promptFirstV512EvidenceIndex(
      cellInput,
      1,
      acceptedChloroplast,
      new Set([0]),
    ),
    2,
  );

  const atomicInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "A particular element is identified by the number of protons in its atoms.",
      "The number of protons in an atom is its atomic number.",
      "Elements in the same periodic-table column tend to have similar properties.",
    ],
    promptFirstEvidenceWindows: [
      "A particular element is identified by the number of protons in its atoms.",
      "The number of protons in an atom is its atomic number.",
      "Elements in the same periodic-table column tend to have similar properties.",
    ],
  };
  const acceptedProtons = [
    {
      type: "multiple_choice",
      concept: "element identity",
      question: "What determines an element's identity?",
      answer: "Its number of protons.",
      explanation: "Changing proton count changes the element.",
    },
  ];
  assert.equal(
    promptFirstV512EvidenceIndex(atomicInput, 1, acceptedProtons, new Set([0])),
    2,
  );

  const diceInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "When two fair six-sided dice are rolled, six of the 36 equally likely ordered outcomes have a sum of seven, so P(sum = 7) = 1/6.",
      "Rolling two fair six-sided dice produces 36 equally likely ordered outcomes.",
      "When two fair six-sided dice are rolled, five of the 36 equally likely ordered outcomes have a sum of 10 or 11, so P(sum = 10 or 11) = 5/36.",
    ],
    promptFirstEvidenceWindows: [
      "When two fair six-sided dice are rolled, six of the 36 equally likely ordered outcomes have a sum of seven, so P(sum = 7) = 1/6.",
      "Rolling two fair six-sided dice produces 36 equally likely ordered outcomes.",
      "When two fair six-sided dice are rolled, five of the 36 equally likely ordered outcomes have a sum of 10 or 11, so P(sum = 10 or 11) = 5/36.",
    ],
  };
  assert.equal(promptFirstV512EvidenceIndex(diceInput, 1, [], new Set([0])), 1);
});

test("v5.12 keeps gravity and childbirth objectives from repeating", () => {
  const gravityInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Gravitational force exists between all objects with mass.",
      "Any object with mass generates a gravitational pull.",
      "The gravitational force between two objects depends on their masses and the distance between them.",
    ],
    promptFirstEvidenceWindows: [
      "Gravitational force exists between all objects with mass.",
      "Any object with mass generates a gravitational pull.",
      "The gravitational force between two objects depends on their masses and the distance between them.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      gravityInput,
      1,
      [
        {
          type: "short_answer",
          concept: "gravitational attraction",
          question: "Between which objects does gravitational force exist?",
          answer: "All objects with mass.",
        },
      ],
      new Set([0]),
    ),
    2,
  );

  const gravityStrengthInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "The gravitational force between two objects depends on their masses and the distance between them.",
      "The mass of each object is proportional to the gravitational force.",
      "Gravitational force attracts every pair of objects that have mass.",
    ],
    promptFirstEvidenceWindows: [
      "The gravitational force between two objects depends on their masses and the distance between them.",
      "The mass of each object is proportional to the gravitational force.",
      "Gravitational force attracts every pair of objects that have mass.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      gravityStrengthInput,
      1,
      [
        {
          type: "true_false",
          concept: "gravitational force strength",
          question:
            "Gravitational force depends on the masses and distance between two objects.",
          answer: true,
        },
      ],
      new Set([0]),
    ),
    2,
  );

  const childbirthInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "The baby's head pressing against the cervix triggers the oxytocin feedback loop.",
      "Pressure from the baby's head against the cervix provides the stimulus that initiates childbirth.",
      "Negative feedback counteracts a change to restore internal conditions.",
    ],
    promptFirstEvidenceWindows: [
      "The baby's head pressing against the cervix triggers the oxytocin feedback loop.",
      "Pressure from the baby's head against the cervix provides the stimulus that initiates childbirth.",
      "Negative feedback counteracts a change to restore internal conditions.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      childbirthInput,
      1,
      [
        {
          type: "true_false",
          concept: "childbirth feedback",
          question:
            "Pressure from the baby's head against the cervix triggers oxytocin signaling.",
          answer: true,
        },
      ],
      new Set([0]),
    ),
    2,
  );

  const acidRainInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Wind can carry acid-rain pollutants to downwind communities and natural environments.",
      "Acid rain affects distant natural environments because pollutants can travel far from their source.",
      "Acid rain can leach aluminum from soil and rocks into lakes.",
    ],
    promptFirstEvidenceWindows: [
      "Wind can carry acid-rain pollutants to downwind communities and natural environments.",
      "Acid rain affects distant natural environments because pollutants can travel far from their source.",
      "Acid rain can leach aluminum from soil and rocks into lakes.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      acidRainInput,
      1,
      [
        {
          type: "multiple_choice",
          concept: "pollutant transport",
          question: "Where can wind carry acid-rain pollutants?",
          answer: "To downwind communities and natural environments.",
        },
      ],
      new Set([0]),
    ),
    2,
  );

  const salmonInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Salmon restore internal salt balance by changing salt exchange at the gills and urine dilution.",
      "Osmoregulation in salmon is an example of a negative feedback loop.",
      "Physiological responses are unconscious internal changes, while behavioral responses are conscious actions.",
    ],
    promptFirstEvidenceWindows: [
      "Salmon restore internal salt balance by changing salt exchange at the gills and urine dilution.",
      "Osmoregulation in salmon is an example of a negative feedback loop.",
      "Physiological responses are unconscious internal changes, while behavioral responses are conscious actions.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      salmonInput,
      1,
      [
        {
          type: "multiple_choice",
          concept: "salmon osmoregulation",
          question:
            "How does a salmon restore its internal salt concentration?",
          answer:
            "It adjusts salt exchange at the gills and changes urine dilution.",
        },
      ],
      new Set([0]),
    ),
    2,
  );

  const cellInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "The variety of protein structures enables a wide range of cellular functions.",
      "A protein's structure and amino-acid chemistry determine its function.",
      "Groups of specialized cells are organized into tissues.",
    ],
    promptFirstEvidenceWindows: [
      "The variety of protein structures enables a wide range of cellular functions.",
      "A protein's structure and amino-acid chemistry determine its function.",
      "Groups of specialized cells are organized into tissues.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      cellInput,
      1,
      [
        {
          type: "multiple_choice",
          concept: "protein structure and function",
          question: "How does protein structure relate to cellular function?",
          answer: "Different structures enable different functions.",
        },
      ],
      new Set([0]),
    ),
    2,
  );

  const heatInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Thermal equilibrium occurs when there is no heat transfer in a system.",
      "When particles in both objects have the same kinetic energy, the system reaches thermal equilibrium.",
      "Heat is the transfer of energy between objects at different temperatures.",
    ],
    promptFirstEvidenceWindows: [
      "Thermal equilibrium occurs when there is no heat transfer in a system.",
      "When particles in both objects have the same kinetic energy, the system reaches thermal equilibrium.",
      "Heat is the transfer of energy between objects at different temperatures.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      heatInput,
      1,
      [
        {
          type: "multiple_choice",
          concept: "thermal equilibrium",
          question: "What condition defines thermal equilibrium?",
          answer: "There is no heat transfer in the system.",
        },
      ],
      new Set([0]),
    ),
    2,
  );
});

test("v5.12 treats food-web heat loss and grammar context as single families", () => {
  const foodInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "A rabbit releases some stored food energy as heat while living.",
      "Every organism releases some of the energy it uses as heat.",
      "Producers use sunlight to build energy-rich molecules.",
    ],
    promptFirstEvidenceWindows: [
      "A rabbit releases some stored food energy as heat while living.",
      "Every organism releases some of the energy it uses as heat.",
      "Producers use sunlight to build energy-rich molecules.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      foodInput,
      1,
      [
        {
          type: "multiple_choice",
          concept: "energy dissipation",
          question: "What happens to some energy when an animal uses it?",
          answer: "Some energy is released as heat.",
        },
      ],
      new Set([0]),
    ),
    2,
  );

  const grammarInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "The kind of grammar used changes with context.",
      "Grammar depends on the audience, message, and manner of expression.",
      "Grammar is a set of conventions and rules that govern language.",
    ],
    promptFirstEvidenceWindows: [
      "The kind of grammar used changes with context.",
      "Grammar depends on the audience, message, and manner of expression.",
      "Grammar is a set of conventions and rules that govern language.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      grammarInput,
      1,
      [
        {
          type: "multiple_choice",
          concept: "context-dependent grammar",
          question: "What determines the kind of grammar a person uses?",
          answer: "The audience, message, and manner of expression.",
        },
      ],
      new Set([0]),
    ),
    2,
  );
});

test("v5.12 treats social-contract exchange and bond-distance energy as single families", () => {
  const socialInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Under a social contract, people give up some rights to a government that protects their remaining rights.",
      "A government protects retained rights in exchange for authority surrendered under the social contract.",
      "Natural rights include life, liberty, and property.",
    ],
    promptFirstEvidenceWindows: [
      "Under a social contract, people give up some rights to a government that protects their remaining rights.",
      "A government protects retained rights in exchange for authority surrendered under the social contract.",
      "Natural rights include life, liberty, and property.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      socialInput,
      1,
      [
        {
          type: "multiple_choice",
          concept: "social contract",
          question:
            "How does the social contract exchange rights and protection?",
          answer:
            "People surrender some rights and government protects the rest.",
        },
      ],
      new Set([0]),
    ),
    2,
  );

  const bondInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Two bonded atoms have minimum potential energy at their stable equilibrium distance.",
      "Moving bonded atoms farther than equilibrium raises their potential energy.",
      "As charged particles move farther apart, the Coulomb force weakens.",
    ],
    promptFirstEvidenceWindows: [
      "Two bonded atoms have minimum potential energy at their stable equilibrium distance.",
      "Moving bonded atoms farther than equilibrium raises their potential energy.",
      "As charged particles move farther apart, the Coulomb force weakens.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      bondInput,
      1,
      [
        {
          type: "multiple_choice",
          concept: "bond potential energy",
          question: "Where is the potential energy of two bonded atoms lowest?",
          answer: "At their stable equilibrium distance.",
        },
      ],
      new Set([0]),
    ),
    2,
  );
});

test("v5.12 treats the small-population genetic-drift effect as one family", () => {
  const input = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Genetic drift is much more likely to occur in small populations than in large populations.",
      "In a small population, random fluctuations in allele frequencies have a larger relative impact.",
      "A bottleneck randomly reduces population size regardless of fitness.",
    ],
    promptFirstEvidenceWindows: [
      "Genetic drift is much more likely to occur in small populations than in large populations.",
      "In a small population, random fluctuations in allele frequencies have a larger relative impact.",
      "A bottleneck randomly reduces population size regardless of fitness.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      input,
      1,
      [
        {
          type: "true_false",
          concept: "genetic drift and population size",
          question: "Where does genetic drift have a larger effect?",
          answer: true,
          correction:
            "Genetic drift has a larger relative effect in small populations.",
        },
      ],
      new Set([0]),
    ),
    2,
  );
});

test("v5.12 avoids repeated rain-shadow, ionization, and VA-incentive objectives", () => {
  const cases = [
    {
      claims: [
        "Descending dry air warms on a mountain's leeward side and increases evaporation.",
        "Mountains block moisture and create a dry rain shadow on the leeward side.",
        "A nearby ocean moderates annual temperature ranges.",
      ],
      accepted: {
        concept: "rain shadow",
        question:
          "What happens to dry air descending a mountain's leeward side?",
        answer: "It compresses, warms, and increases evaporation.",
      },
    },
    {
      claims: [
        "Ultraviolet radiation can eject electrons from atoms and ionize them.",
        "High-frequency electromagnetic waves can knock electrons out of atoms.",
        "Absorbed electromagnetic energy is generally converted to thermal energy.",
      ],
      accepted: {
        concept: "ionizing radiation",
        question: "How can ultraviolet radiation ionize atoms?",
        answer: "It can eject electrons from atoms.",
      },
    },
    {
      claims: [
        "VA wait-time bonuses encouraged officials to falsify records.",
        "The VA abandoned an unrealistic wait-time goal to remove the perverse incentive.",
        "The bureaucracy's size and independence make oversight difficult.",
      ],
      accepted: {
        concept: "VA wait-time incentive",
        question: "How did wait-time bonuses distort officials' incentives?",
        answer: "Officials falsified records to appear eligible for bonuses.",
      },
    },
  ];

  for (const fixture of cases) {
    const input = {
      totalQuestionCount: 5,
      promptFirstPrimaryClaims: fixture.claims,
      promptFirstEvidenceWindows: fixture.claims,
    };
    assert.equal(
      promptFirstV512EvidenceIndex(
        input,
        1,
        [{ type: "multiple_choice", ...fixture.accepted }],
        new Set([0]),
      ),
      2,
    );
  }
});

test("v5.12 separates Fresh20 banks into nonrepeating assessment families", () => {
  const cases = [
    [
      [
        "Ionization energy increases from left to right across a period.",
        "Across a period, increasing effective nuclear charge pulls outer electrons more strongly.",
        "Ionization energy decreases down a group as outer shells become farther from the nucleus.",
      ],
      "Ionization energy increases from left to right across a period.",
    ],
    [
      [
        "The standard cell potential is the sum of the standard reduction and oxidation potentials.",
        "The half-reaction potentials determine standard cell potential.",
        "A positive standard cell potential indicates a spontaneous galvanic-cell reaction.",
      ],
      "The standard cell potential equals the sum of reduction and oxidation half-reaction potentials.",
    ],
    [
      [
        "The surface-area-to-volume ratio of a sphere is 3/r.",
        "Simplifying a sphere's surface-area-to-volume ratio gives 3/r.",
        "As a cell grows, surface area per unit volume decreases.",
      ],
      "A sphere's surface-area-to-volume ratio is 3/r.",
    ],
    [
      [
        "A growing cell eventually has insufficient surface area for exchange across its volume.",
        "As cell volume increases, surface area per unit volume decreases and limits exchange.",
        "A sphere's surface-area-to-volume ratio is 3/r.",
      ],
      "A large cell can have insufficient surface area for exchange required by its volume.",
    ],
    [
      [
        "The Necessary and Proper Clause lets Congress execute its enumerated powers.",
        "Congress may make laws necessary and proper for carrying its enumerated powers into execution.",
        "Enumerated powers are explicitly listed in the Constitution.",
      ],
      "The Necessary and Proper Clause authorizes laws that execute enumerated powers.",
    ],
    [
      [
        "A negative delta G favors the forward reaction and products.",
        "A positive delta G favors the reverse reaction and reactants.",
        "At delta G equal to zero, a process is at equilibrium.",
      ],
      "When delta G is negative, the forward reaction is thermodynamically favored.",
    ],
  ];

  for (const [claims, answer] of cases) {
    assert.equal(
      promptFirstV512EvidenceIndex(
        {
          totalQuestionCount: 5,
          promptFirstPrimaryClaims: claims,
          promptFirstEvidenceWindows: claims,
        },
        1,
        [
          {
            type: "short_answer",
            concept: claims[0],
            question: claims[0],
            answer,
          },
        ],
        new Set([0]),
      ),
      2,
    );
  }
});

test("v5.12 separates Fresh21 repeated genome, figurative, investment, and field objectives", () => {
  const cases = [
    [
      [
        "Specialized cells contain the same genetic information but develop into different cell types.",
        "Most cells contain the organism's complete genetic information.",
        "Cells are the basic building blocks of multicellular organisms.",
      ],
      "Specialized cells share the same genetic information.",
    ],
    [
      [
        "Figurative language says one thing but means another.",
        "The intended meaning of figurative language differs from its literal wording.",
        "A simile compares two things using like or as.",
      ],
      "Figurative language has a nonliteral intended meaning.",
    ],
    [
      [
        "More capital goods today increase future production but reduce current consumption.",
        "Producing capital goods today raises future economic growth.",
        "A production possibilities curve shows feasible combinations of output.",
      ],
      "Capital investment trades current consumption for future production.",
    ],
    [
      [
        "Moving a mass against a field's force increases stored energy.",
        "Moving a charge opposite the electric force requires work and increases potential energy.",
        "Opposite point charges attract each other.",
      ],
      "Moving against a field force increases stored energy.",
    ],
  ];

  for (const [claims, answer] of cases) {
    assert.equal(
      promptFirstV512EvidenceIndex(
        {
          totalQuestionCount: 5,
          promptFirstPrimaryClaims: claims,
          promptFirstEvidenceWindows: claims,
        },
        1,
        [
          {
            type: "short_answer",
            concept: claims[0],
            question: claims[0],
            answer,
          },
        ],
        new Set([0]),
      ),
      2,
    );
  }
});

test("v5.12 separates economies and diseconomies of scale families", () => {
  const cases = [
    [
      [
        "A falling long-run average total cost as output rises indicates economies of scale.",
        "Economies of scale occur while long-run average total cost declines.",
        "A flat long-run average total cost curve indicates constant returns to scale.",
      ],
      "Falling long-run average total cost indicates economies of scale.",
    ],
    [
      [
        "Rising long-run average total cost indicates diseconomies of scale.",
        "Coordination problems cause diseconomies of scale as an organization grows.",
        "A flat long-run average total cost curve indicates constant returns to scale.",
      ],
      "Rising long-run average total cost indicates diseconomies of scale.",
    ],
  ];

  for (const [claims, answer] of cases) {
    assert.equal(
      promptFirstV512EvidenceIndex(
        {
          totalQuestionCount: 5,
          promptFirstPrimaryClaims: claims,
          promptFirstEvidenceWindows: claims,
        },
        1,
        [
          {
            type: "short_answer",
            concept: claims[0],
            question: claims[0],
            answer,
          },
        ],
        new Set([0]),
      ),
      2,
    );
  }
});

test("v5.12 separates Fresh23 evolution, genotype, kinetic, force, and body families", () => {
  const cases = [
    [
      [
        "Homologous features help infer evolutionary relationships and common ancestry.",
        "Species sharing more homologous features likely share a more recent common ancestor.",
        "Analogous features have similar functions but different evolutionary origins.",
      ],
      "Homologous features provide clues about common ancestry.",
    ],
    [
      [
        "A genotype is the set of alleles an organism carries.",
        "Homozygous and heterozygous describe an organism's genotype.",
        "A phenotype is an observable trait.",
      ],
      "A genotype identifies an organism's alleles.",
    ],
    [
      [
        "Kinetic energy is energy due to an object's motion.",
        "Kinetic energy is the motion energy of an object.",
        "Kinetic energy is proportional to mass at constant speed.",
      ],
      "Kinetic energy is an object's motion energy.",
    ],
    [
      [
        "A table exerts an equal opposite force on a finger pressing it.",
        "Pressing a table applies a force to the table and compresses the finger.",
        "Action-reaction forces act on different objects.",
      ],
      "The table pushes back on the finger with an equal opposite force.",
    ],
    [
      [
        "The human body has a hierarchy of cells, tissues, organs, and organ systems.",
        "The human body is made of nested layers that increase in complexity.",
        "Organ systems work together to keep the body alive.",
      ],
      "The human body has nested organizational levels.",
    ],
  ];

  for (const [claims, answer] of cases) {
    assert.equal(
      promptFirstV512EvidenceIndex(
        {
          totalQuestionCount: 5,
          promptFirstPrimaryClaims: claims,
          promptFirstEvidenceWindows: claims,
        },
        1,
        [
          {
            type: "short_answer",
            concept: claims[0],
            question: claims[0],
            answer,
          },
        ],
        new Set([0]),
      ),
      2,
    );
  }
});

test("v5.12 separates Fresh24 environment, photosynthesis, and covalent-network families", () => {
  const cases = [
    [
      [
        "Environmental stress can change gene expression.",
        "Food and hormones can activate or inactivate genes.",
        "A trait can be influenced by both genes and the environment.",
      ],
      "Environmental factors can change gene expression.",
    ],
    [
      [
        "Plants store some sugars made during photosynthesis for later use.",
        "Stored sugars provide energy when immediate photosynthesis is unavailable.",
        "Photosynthesis produces oxygen and sugars.",
      ],
      "Sugars made during photosynthesis can store energy for later use.",
    ],
    [
      [
        "Covalent network solids consist of atoms joined in a continuous network of covalent bonds.",
        "Covalent bonds form the extended structure of a covalent network solid.",
        "Melting graphite requires breaking strong covalent bonds.",
      ],
      "Covalent bonds form the continuous structure of a covalent network solid.",
    ],
  ];

  for (const [claims, answer] of cases) {
    assert.equal(
      promptFirstV512EvidenceIndex(
        {
          totalQuestionCount: 5,
          promptFirstPrimaryClaims: claims,
          promptFirstEvidenceWindows: claims,
        },
        1,
        [
          {
            type: "short_answer",
            concept: claims[0],
            question: claims[0],
            answer,
          },
        ],
        new Set([0]),
      ),
      2,
    );
  }
});

test("v5.12 separates Fresh25 ecology, organelle, momentum, and angular-momentum families", () => {
  const cases = [
    [
      [
        "A community contains all living species in the same area.",
        "A community collectively includes all living organisms in an area.",
        "An ecosystem includes living organisms and nonliving environmental components.",
      ],
      "A community includes all living organisms in one area.",
    ],
    [
      [
        "Organelles have different functions and work together on cellular tasks.",
        "Cell structures each make a unique functional contribution to life's processes.",
        "The cell membrane is a selective barrier controlling entry and exit.",
      ],
      "Organelles coordinate their specialized functions to perform cellular tasks.",
    ],
    [
      [
        "A truck has more momentum than a Formula One car at the same velocity because it has greater mass.",
        "The Formula One car has less momentum than the truck when both move at the same velocity.",
        "Momentum depends on the observer's frame of reference.",
      ],
      "The truck has greater momentum than the Formula One car at equal velocity.",
    ],
    [
      [
        "Angular momentum remains unchanged when no external torque acts on a system.",
        "Final angular momentum equals initial angular momentum when external torque is zero.",
        "Moment of inertia depends on mass distribution relative to the rotation axis.",
      ],
      "Without external torque, angular momentum is conserved.",
    ],
  ];

  for (const [claims, answer] of cases) {
    assert.equal(
      promptFirstV512EvidenceIndex(
        {
          totalQuestionCount: 5,
          promptFirstPrimaryClaims: claims,
          promptFirstEvidenceWindows: claims,
        },
        1,
        [
          {
            type: "short_answer",
            concept: claims[0],
            question: claims[0],
            answer,
          },
        ],
        new Set([0]),
      ),
      2,
    );
  }
});

test("v5.12 separates Fresh26 vessel, protein, energy, demand, and gas-law families", () => {
  const cases = [
    [
      [
        "The pulmonary artery carries deoxygenated blood away from the heart, while the pulmonary vein carries oxygenated blood toward it.",
        "Pulmonary arteries and pulmonary veins reverse the usual systemic oxygenation pattern.",
        "Hemoglobin binds oxygen and maintains a diffusion gradient.",
      ],
      "Pulmonary arteries and veins carry blood with the opposite oxygenation pattern from systemic vessels.",
    ],
    [
      [
        "Quaternary structure describes multiple polypeptide chains assembled into a protein complex.",
        "Proteins with more than one polypeptide chain have quaternary structure.",
        "DNA encodes the amino-acid order of primary protein structure.",
      ],
      "Multiple polypeptide chains form a protein's quaternary structure.",
    ],
    [
      [
        "Total mechanical energy remains constant in a closed system without dissipative forces.",
        "Mechanical energy is conserved when no dissipative forces act on a closed system.",
        "Friction transforms mechanical energy into thermal energy.",
      ],
      "A closed nondissipative system conserves total mechanical energy.",
    ],
    [
      [
        "A decrease in demand shifts the demand curve to the left.",
        "When demand decreases, quantity demanded falls at every price point.",
        "Higher production costs reduce supply at each price.",
      ],
      "Lower demand produces a leftward demand-curve shift.",
    ],
    [
      [
        "The ideal gas law relates pressure, volume, moles, and absolute temperature as PV=nRT.",
        "Rearranging the ideal gas law for moles gives n=PV/(RT).",
        "A balanced equation supplies the mole ratio between reactants and products.",
      ],
      "The ideal gas law is PV=nRT.",
    ],
  ];

  for (const [claims, answer] of cases) {
    assert.equal(
      promptFirstV512EvidenceIndex(
        {
          totalQuestionCount: 5,
          promptFirstPrimaryClaims: claims,
          promptFirstEvidenceWindows: claims,
        },
        1,
        [
          {
            type: "short_answer",
            concept: claims[0],
            question: claims[0],
            answer,
          },
        ],
        new Set([0]),
      ),
      2,
    );
  }
});

test("v5.12 separates Fresh27 oxygenation, atomic, inflation, probability, and plate families", () => {
  const cases = [
    [
      [
        "The Great Oxygenation Event raised atmospheric oxygen and harmed many anaerobic organisms.",
        "The Oxygen Catastrophe caused extinction because oxygen was poisonous to anaerobic organisms.",
        "Photosynthesis produces sugars and oxygen from carbon dioxide and water.",
      ],
      "Rising atmospheric oxygen was toxic to many anaerobic organisms.",
    ],
    [
      [
        "For identical bonded atoms, atomic radius is half the distance between their nuclei.",
        "Atomic radius measures atomic size using half the internuclear distance in a covalent bond.",
        "Atomic radius increases down a periodic-table group.",
      ],
      "Atomic radius can be measured as half the distance between bonded nuclei.",
    ],
    [
      [
        "Unexpected inflation lowers a fixed-rate lender's real return because repaid dollars lose purchasing power.",
        "A fixed-rate lender receives a negative real return when inflation makes the repaid dollars worth less.",
        "Deflation raises the real burden on a fixed-rate borrower.",
      ],
      "Higher-than-expected inflation reduces a fixed lender's real return.",
    ],
    [
      [
        "Events are independent when a conditional probability equals the corresponding unconditional probability.",
        "Delayed and snowy are independent if P(delayed given snowy) equals P(delayed).",
        "More trials make an experimental probability more likely to approach the theoretical probability.",
      ],
      "Independence means conditioning does not change the event probability.",
    ],
    [
      [
        "Experimental probabilities estimate theoretical probabilities and can differ from them.",
        "More experiments make experimental probability more likely to approximate true theoretical probability.",
        "Independent events preserve their probabilities after conditioning.",
      ],
      "Experimental probability can differ from the true probability it estimates.",
    ],
    [
      [
        "Lithospheric plates include Earth's crust and the solid upper mantle.",
        "Calling tectonic plates crustal plates is incomplete because the lithosphere also includes upper mantle.",
        "The outer core is liquid at very high temperature.",
      ],
      "Tectonic plates contain crust and rigid upper mantle.",
    ],
  ];

  for (const [claims, answer] of cases) {
    assert.equal(
      promptFirstV512EvidenceIndex(
        {
          totalQuestionCount: 5,
          promptFirstPrimaryClaims: claims,
          promptFirstEvidenceWindows: claims,
        },
        1,
        [
          {
            type: "short_answer",
            concept: claims[0],
            question: claims[0],
            answer,
          },
        ],
        new Set([0]),
      ),
      2,
    );
  }
});

test("v5.12 keeps semiconductor-role and hippocampal-memory objectives distinct", () => {
  const accepted = [
    {
      type: "true_false",
      concept: "semiconductors in modern technology",
      question: "Semiconductors are at the core of modern technology.",
      correction: "Semiconductors are at the core of modern technology.",
    },
    {
      type: "short_answer",
      concept: "hippocampal memory formation",
      question: "What did HM's case reveal about the hippocampus?",
      answer: "The hippocampus is critical for forming declarative memories.",
    },
  ];
  const input = {
    promptFirstPrimaryClaims: [
      "Semiconductors form the backbone of modern computing and telecommunications.",
      "Doping changes the concentration of mobile charge carriers.",
      "Henry Molaison's surgery showed that hippocampal removal prevents forming new declarative memories.",
      "Long-term potentiation strengthens synaptic connections.",
    ],
    promptFirstEvidenceWindows: [
      "Semiconductors form the backbone of modern computing and telecommunications.",
      "Doping changes the concentration of mobile charge carriers.",
      "Henry Molaison's surgery showed that hippocampal removal prevents forming new declarative memories.",
      "Long-term potentiation strengthens synaptic connections.",
    ],
  };

  assert.ok(
    [1, 3].includes(
      promptFirstV512EvidenceIndex(input, 2, accepted, new Set([0, 2])),
    ),
  );
});

test("v5.12 does not reuse action-potential generation as propagation", () => {
  const accepted = [
    {
      type: "short_answer",
      concept: "action potential propagation",
      question: "How does an action potential spread along an axon?",
      answer:
        "Depolarization opens voltage-gated sodium channels in the neighboring region.",
    },
  ];
  const input = {
    promptFirstPrimaryClaims: [
      "An excitable cell generates an action potential from a stimulus.",
      "The sodium-potassium pump maintains the resting membrane potential.",
    ],
    promptFirstEvidenceWindows: [
      "An excitable cell generates an electrical signal called an action potential from a stimulus.",
      "The sodium-potassium pump moves three sodium ions out for every two potassium ions moved in.",
    ],
  };

  assert.equal(promptFirstV512EvidenceIndex(input, 1, accepted, new Set()), 1);
});

test("v5.12 allocates an equilibrium-pressure objective only once", () => {
  const accepted = [
    {
      type: "multiple_choice",
      concept: "gas equilibrium under pressure",
      question: "Which side is favored when pressure is applied?",
      answer: "The side with fewer gas molecules.",
    },
  ];
  const input = {
    promptFirstPrimaryClaims: [
      "Applying pressure favors the side with fewer gas molecules.",
      "Adding a product shifts equilibrium toward the reactants.",
      "If I have a container—nope, too shocking.",
    ],
    promptFirstEvidenceWindows: [
      "A gaseous equilibrium under pressure shifts toward the side with fewer gas molecules because that side is easier to compress.",
      "Adding more product causes the system to consume products and form reactants.",
      "A container under pressure may hold four molecules that merge to make two molecules.",
    ],
  };

  assert.equal(promptFirstV512EvidenceIndex(input, 1, accepted, new Set()), 1);
});

test("v5.12 does not allocate the same scarcity family after it is answered", () => {
  const accepted = [
    {
      type: "multiple_choice",
      concept: "scarcity from limited resources",
      question: "What relationship creates scarcity?",
      answer: "Unlimited wants combined with limited resources.",
    },
  ];
  const input = {
    promptFirstPrimaryClaims: [
      "Unlimited wants and limited resources create scarcity.",
      "A need is something necessary for survival, while a want is optional.",
    ],
    promptFirstEvidenceWindows: [
      "Scarcity forces people to choose because resources cannot satisfy every want.",
      "Food and shelter are needs, while optional goods are wants.",
    ],
  };

  assert.equal(
    promptFirstV512EvidenceIndex(input, 1, accepted, new Set([0])),
    1,
  );
});

test("v5.12 allocates the land-measurement decision method only once", () => {
  const accepted = [
    {
      type: "multiple_choice",
      concept: "information for space allocation",
      question: "How does the group decide how much space to allocate?",
      answer:
        "They measure the land and research each item's space requirement.",
      explanation:
        "Measurements provide the area and the space required by each option.",
    },
  ];
  const input = {
    promptFirstPrimaryClaims: [
      "Measuring the land provides its available area.",
      "The board chose a playground instead of additional parking.",
    ],
    promptFirstEvidenceWindows: [
      "The group measures the land and searches online for each item's space requirement.",
      "The limited land could be used for a playground or for parking.",
    ],
  };

  assert.equal(
    promptFirstV512EvidenceIndex(input, 4, accepted, new Set([0])),
    1,
  );
});

test("v5.12 avoids repeated statistics and natural-selection families", () => {
  const statisticsInput = {
    promptFirstPrimaryClaims: [
      "The median is the mean of the two middle values when the count is even.",
      "The range is the maximum value minus the minimum value.",
    ],
    promptFirstEvidenceWindows: [
      "For an even-sized sample, average the two middle values to find the median.",
      "Subtract the smallest observation from the largest observation to calculate the range.",
    ],
  };
  const acceptedMedian = [
    {
      type: "multiple_choice",
      concept: "median for an even-sized sample",
      question:
        "How is the median found when a sample has an even number of values?",
      answer: "Average the two middle values.",
      explanation: "The two central observations share the middle position.",
    },
  ];
  assert.equal(
    promptFirstV512EvidenceIndex(
      statisticsInput,
      1,
      acceptedMedian,
      new Set([0]),
    ),
    1,
  );

  const repeatedMeanInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "So if I say 206 divided by 8 gets us 25.75.",
      "The range is the maximum value minus the minimum value.",
    ],
    promptFirstEvidenceWindows: [
      "The sum of all the numbers is 206, and 206 divided by 8 gets us 25.75.",
      "Subtract the smallest observation from the largest observation to calculate the range.",
    ],
  };
  const acceptedMean = [
    {
      type: "short_answer",
      concept: "arithmetic mean method",
      question: "How is the arithmetic mean calculated?",
      answer: "Add all values and divide the sum by the number of values.",
      explanation:
        "The arithmetic mean distributes the total equally across the observations.",
    },
  ];
  assert.equal(
    promptFirstV512EvidenceIndex(
      repeatedMeanInput,
      4,
      acceptedMean,
      new Set([0]),
    ),
    1,
  );

  const exhaustedStatisticsInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "The sum of all the numbers is 206, and 206 divided by 8 gets 25.75.",
      "The mean is called the arithmetic mean because it sums values and divides by their count.",
    ],
    promptFirstEvidenceWindows: [
      "For 23, 29, 20, 32, 23, 21, 33, and 25, the sum is 206 and 206 divided by 8 is 25.75.",
      "The arithmetic mean sums the values and divides by their count.",
    ],
  };
  assert.equal(
    promptFirstV512EvidenceIndex(
      exhaustedStatisticsInput,
      4,
      acceptedMean,
      new Set(),
    ),
    0,
  );

  const selectionInput = {
    promptFirstPrimaryClaims: [
      "The favored triangular trait becomes more common across generations.",
      "Mutation and sexual reproduction create heritable variation.",
    ],
    promptFirstEvidenceWindows: [
      "Individuals with the triangular trait survive and reproduce more, so its frequency rises.",
      "Mutation creates alleles and sexual reproduction recombines them.",
    ],
  };
  const acceptedTrait = [
    {
      type: "true_false",
      concept: "favored trait frequency",
      question: "The favored triangular trait decreases across generations.",
      correction: "The favored triangular trait increases across generations.",
      explanation:
        "Individuals with the trait survive and reproduce more often.",
    },
  ];
  assert.equal(
    promptFirstV512EvidenceIndex(
      selectionInput,
      4,
      acceptedTrait,
      new Set([0]),
    ),
    1,
  );

  const brakingInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "The acceleration is backwards, which slows the train.",
      "Distance equals average velocity multiplied by elapsed time.",
    ],
    promptFirstEvidenceWindows: [
      "The force pulls back, so the acceleration is backwards and slows the train.",
      "For uniform acceleration, multiply average velocity by time to calculate distance.",
    ],
  };
  const acceptedBraking = [
    {
      type: "true_false",
      concept: "braking-force direction",
      question: "A backward braking force produces backward acceleration.",
      correction: "A backward braking force produces backward acceleration.",
      explanation:
        "The acceleration points with the net force and slows the train.",
    },
  ];
  assert.equal(
    promptFirstV512EvidenceIndex(
      brakingInput,
      3,
      acceptedBraking,
      new Set([0]),
    ),
    1,
  );

  const circuitInput = {
    totalQuestionCount: 5,
    promptFirstPrimaryClaims: [
      "Benjamin Franklin did not know about electrons when the current convention was chosen.",
      "An open circuit interrupts the conducting path, so current cannot flow.",
    ],
    promptFirstEvidenceWindows: [
      "Conventional electric current points opposite to electron flow because the convention predates the discovery of electrons.",
      "Opening a switch breaks the conducting path and stops current in the circuit.",
    ],
  };
  const acceptedCurrentDirection = [
    {
      type: "short_answer",
      concept: "conventional current direction",
      question:
        "How does conventional current direction compare with electron flow?",
      answer: "They point in opposite directions.",
      explanation:
        "Conventional current points from positive to negative while electrons move the other way.",
    },
  ];
  assert.equal(
    promptFirstV512EvidenceIndex(
      circuitInput,
      4,
      acceptedCurrentDirection,
      new Set(),
    ),
    1,
  );
});

const IDS = {
  generation: "11111111-1111-4111-8111-111111111111",
  session: "22222222-2222-4222-8222-222222222222",
  job: "33333333-3333-4333-8333-333333333333",
  recovery: "44444444-4444-4444-8444-444444444444",
};

function stableInput(
  questionCount = 5,
  questionTypes = ["multiple_choice", "true_false", "short_answer"],
) {
  return {
    title: "Trusted source lesson title",
    quizLanguage: "en",
    questionCount,
    questionTypes,
    generationId: IDS.generation,
    generationSessionId: IDS.session,
    recoverySessionId: IDS.recovery,
    jobId: IDS.job,
    generationProfile: "stable_auto_recovery_v5_3",
    transcriptFingerprint: "1234abcd",
    plainText:
      "This complete lesson transcript explains supported concepts, examples, applications, and careful reasoning. ".repeat(
        12,
      ),
  };
}

const GROUNDED_MECHANISMS = [
  [
    "photosynthesis",
    "electron transport",
    "convert light energy into chemical energy",
  ],
  [
    "immune signaling",
    "receptor activation",
    "trigger a targeted cellular response",
  ],
  [
    "language learning",
    "pattern consolidation",
    "stabilize recurring grammatical structures",
  ],
  [
    "public-key encryption",
    "one-way transformation",
    "protect a private value",
  ],
  [
    "market coordination",
    "price signaling",
    "align buyers with available supply",
  ],
  [
    "catalysis",
    "activation-barrier reduction",
    "accelerate a chemical reaction",
  ],
  [
    "constitutional government",
    "separation of powers",
    "limit unilateral authority",
  ],
  [
    "wireless communication",
    "error correction",
    "reconstruct a damaged signal",
  ],
  [
    "orbital motion",
    "gravitational transfer",
    "change kinetic and potential energy",
  ],
  ["cellular respiration", "proton gradient", "drive ATP synthesis"],
  ["feedback control", "negative feedback", "stabilize a changing output"],
  [
    "computer networking",
    "packet routing",
    "deliver data across connected nodes",
  ],
  [
    "protein synthesis",
    "ribosomal translation",
    "assemble an amino-acid sequence",
  ],
  [
    "ecosystem regulation",
    "predator response",
    "constrain unchecked population growth",
  ],
  [
    "memory formation",
    "synaptic strengthening",
    "preserve a learned association",
  ],
  ["heat transfer", "thermal conduction", "move energy through a solid"],
  [
    "genetic inheritance",
    "chromosome segregation",
    "distribute replicated DNA",
  ],
  [
    "water purification",
    "membrane filtration",
    "separate contaminants from water",
  ],
  [
    "sound production",
    "resonant vibration",
    "amplify a periodic pressure wave",
  ],
  [
    "battery operation",
    "ion transport",
    "sustain charge flow through a circuit",
  ],
];

function groundedInput(questionCount = 5, questionTypes = ["multiple_choice"]) {
  return {
    ...stableInput(questionCount, questionTypes),
    generationProfile: "evidence_grounded_auto_v5_4",
    plainText: Array.from({ length: 20 }, (_, index) => {
      const [subject, process, effect] = GROUNDED_MECHANISMS[index];
      return `${subject} uses the ${process} process to ${effect} because each step changes a defined input into a measurable output.`;
    }).join(" "),
  };
}

const CONCEPT_FIRST_OBJECTIVES = [
  "absorption",
  "diffusion",
  "feedback",
  "conversion",
  "regulation",
  "storage",
  "transport",
  "detection",
  "comparison",
  "sequencing",
  "inhibition",
  "amplification",
  "equilibrium",
  "adaptation",
  "prediction",
  "allocation",
  "verification",
  "compression",
  "replication",
  "coordination",
  "mutation",
  "selection",
  "classification",
  "calibration",
];

function conceptFirstInput(
  questionCount = 5,
  questionTypes = ["multiple_choice", "true_false", "short_answer"],
) {
  return {
    ...groundedInput(questionCount, questionTypes),
    generationProfile: "concept_first_auto_v5_8",
    plainText: Array.from({ length: 24 }, (_, index) => {
      const pathway = `pathway${index + 1}`;
      const value = index + 11;
      const objective = `objective${CONCEPT_FIRST_OBJECTIVES[index]}`;
      return [
        `Catalyst ${index + 1} transfers energy through ${pathway} during ${objective} because the reaction changes by ${value} units under the defined condition.`,
        `Energy enters ${pathway} during ${objective} before the catalyst produces a ${value}-unit change in the reaction.`,
        `${pathway} connects the reactants during ${objective}, causing energy transfer to increase by ${value} units.`,
        `A ${value}-unit reaction shift occurs when ${pathway} carries energy between the defined states during ${objective}.`,
        `The ${objective} mechanism routes energy along ${pathway}, which changes the reaction by ${value} units.`,
        `When ${objective} conditions are met, ${pathway} relays energy and the reaction changes by ${value} units.`,
      ][index % 6];
    }).join(" "),
  };
}

function promptFirstInput(
  questionCount = 5,
  questionTypes = ["multiple_choice", "true_false", "short_answer"],
) {
  return {
    ...conceptFirstInput(questionCount, questionTypes),
    generationProfile: "prompt_first_auto_v5_12",
  };
}

function promptFirstV511Input(
  questionCount = 5,
  questionTypes = ["multiple_choice", "true_false", "short_answer"],
) {
  return {
    ...conceptFirstInput(questionCount, questionTypes),
    generationProfile: "prompt_first_auto_v5_11",
  };
}

function promptFirstV59Input(
  questionCount = 5,
  questionTypes = ["multiple_choice", "true_false", "short_answer"],
) {
  return {
    ...conceptFirstInput(questionCount, questionTypes),
    generationProfile: "prompt_first_auto_v5_9",
  };
}

function promptFirstTaskFromRequest(request) {
  const body = typeof request === "string" ? JSON.parse(request) : request;
  const task = body.messages.at(-1).content;
  const slot = task.match(
    /Create q(\d+) of (\d+)\. Required type: (multiple_choice|true_false|short_answer)\./u,
  );
  assert.ok(slot, "request contains one prompt-first slot");
  const focusExcerpt =
    task.match(
      /Additional private context — preserve its original order\. Use it to clarify the assigned fact\. Select an alternative from it only when the assigned fact is forbidden, incomplete, corrected later, or duplicates a blocked grading target:\n([\s\S]*?)\n\nBLOCKED prior questions and grading targets/u,
    )?.[1] ??
    task.match(
      /Additional private context — preserve its original order\. Use this as the only alternative source when the candidate is forbidden, incomplete, corrected later, or duplicates a blocked grading target:\n([\s\S]*?)\n\nBLOCKED prior questions and grading targets/u,
    )?.[1] ??
    task.match(
      /Additional private context — preserve its original order and use it only to clarify the selected target:\n([\s\S]*?)\n\nForbidden prior grading targets/u,
    )?.[1] ??
    task.match(
      /Additional private context — preserve its original order\. Use it to explain the assigned fact\. Select a different precise supported fact only when the assigned fact is forbidden, incomplete, corrected later, or duplicates a blocked grading target:\n([\s\S]*?)\n\nPreviously accepted questions, complete grading targets, concepts, and objectives/u,
    )?.[1] ??
    task.match(
      /Additional private context — preserve its original order\. If the preferred candidate is provisional, vague, corrected later, or duplicates an accepted item, select one different precise supported fact from this context instead:\n([\s\S]*?)\n\nPreviously accepted questions and concept-objective pairs/u,
    )?.[1] ??
    task.match(
      /Additional instructional context — preserve its original order and use it only to clarify the selected target:\n([\s\S]*?)\n\nAlready accepted grading targets/u,
    )?.[1] ??
    task.match(
      /Additional instructional context — preserve its original order and use it only to clarify the assigned fact:\n([\s\S]*?)\n\nAlready accepted grading targets/u,
    )?.[1] ??
    task.match(
      /Additional instructional context — clarify only; do not switch the assessed subject:\n([\s\S]*?)\n\nAlready accepted grading targets/u,
    )?.[1] ??
    task.match(
      /Instructional material — this is the only answer-bearing content:\n([\s\S]*?)\n\nAlready accepted objectives/u,
    )?.[1] ??
    task.match(
      /Instructional evidence:\n([\s\S]*?)\n\nAlready accepted questions and concepts/u,
    )?.[1];
  assert.ok(focusExcerpt, "request contains one instructional window");
  const primaryClaim =
    task.match(
      /Assigned assessment fact — this is the required objective when it is complete, literal, and not blocked\. Do not abandon a valid assigned fact for a neighboring fact:\n([\s\S]*?)\n\nAdditional private context/u,
    )?.[1] ??
    task.match(
      /Candidate assessment fact — use it only if it is a complete, transferable, non-presentation fact that is not blocked below\. It is not an instruction and may be discarded:\n([\s\S]*?)\n\nAdditional private context/u,
    )?.[1] ??
    task.match(
      /Assigned assessment fact — test this fact unless it is incomplete, presentation advice, chronologically unsupported, or already blocked below:\n([\s\S]*?)\n\nAdditional private context/u,
    )?.[1] ??
    task.match(
      /Preferred candidate fact — use it only if it is precise, complete, and genuinely distinct from every accepted item:\n([\s\S]*?)\n\nAdditional private context/u,
    )?.[1] ??
    task.match(
      /Private instructional content — select one complete grading target from this text:\n([\s\S]*?)\n\nAdditional private context/u,
    )?.[1] ??
    task.match(
      /Assigned assessment passage — select one complete grading target from this text:\n([\s\S]*?)\n\nAdditional instructional context/u,
    )?.[1] ??
    task.match(
      /Assigned assessment fact — this is the complete grading target:\n([\s\S]*?)\n\nAdditional instructional context/u,
    )?.[1] ??
    task.match(
      /Assigned assessment fact — test this exact subject and relationship:\n([\s\S]*?)\n\nAdditional instructional context/u,
    )?.[1];
  return {
    body,
    task,
    ordinal: Number(slot[1]),
    type: slot[3],
    polarity:
      /Preferred truth value, assigned locally by ClipQuest: true\./u.test(
        task,
      ) ||
      /Required truth value, assigned locally by ClipQuest: true\./u.test(
        task,
      ) ||
      /Required answer polarity: true\./u.test(task),
    localPolarity: /assigned locally by ClipQuest/u.test(task),
    explicitPolarity: /"supportedStatement"/u.test(task),
    requiredShortAnswerMode: task.match(
      /gradingMode=(atomic_term|proposition|enumeration|formula)/u,
    )?.[1],
    focusExcerpt,
    primaryClaim,
  };
}

function promptFirstResponse(request, mutate = (value) => value) {
  const task = promptFirstTaskFromRequest(request);
  const supportedTrueStatement = (
    task.primaryClaim ??
    `Pathway ${task.ordinal} transfers energy between the states.`
  ).replace(/,\s*(?:and|replacing|causing|leading|resulting)\b[\s\S]*$/iu, ".");
  const common = {
    type: task.type,
    concept: `energy pathway ${task.ordinal}`,
    question: `How does pathway ${task.ordinal} transfer energy?`,
    explanation: `Pathway ${task.ordinal} transfers energy between defined states.`,
  };
  const question =
    task.type === "multiple_choice"
      ? {
          ...common,
          correctAnswer: `Through route ${task.ordinal}`,
          distractors: [
            `By stopping route ${task.ordinal}`,
            `By removing state ${task.ordinal}`,
            `By isolating input ${task.ordinal}`,
          ],
        }
      : task.type === "true_false"
        ? task.localPolarity
          ? task.explicitPolarity
            ? task.polarity
              ? {
                  type: common.type,
                  concept: common.concept,
                  supportedStatement: supportedTrueStatement,
                  explanation: `Pathway ${task.ordinal} transfers energy because the route couples the defined states.`,
                }
              : {
                  type: common.type,
                  concept: common.concept,
                  supportedStatement: supportedTrueStatement,
                  falseStatement: supportedTrueStatement.replace(
                    /\b(?:transfers?|enters?|connects?|carries|relays|routes?|occurs?|increases?)\b/iu,
                    (value) =>
                      /^enter/iu.test(value)
                        ? "leaves"
                        : /^connect/iu.test(value)
                          ? "separates"
                          : /^occur/iu.test(value)
                            ? "stops"
                            : /^increase/iu.test(value)
                              ? "decreases"
                              : "blocks",
                  ),
                  explanation: `Blocking route ${task.ordinal} would prevent rather than transfer energy between the states.`,
                }
            : task.polarity
              ? {
                  ...common,
                  question:
                    task.primaryClaim ??
                    `Pathway ${task.ordinal} transfers energy between the states.`,
                }
              : {
                  ...common,
                  question: `Pathway ${task.ordinal} blocks energy transfer between the states.`,
                  correction: `Pathway ${task.ordinal} transfers energy between the states.`,
                }
          : {
              ...common,
              question: task.polarity
                ? `Pathway ${task.ordinal} transfers energy between the states.`
                : `Pathway ${task.ordinal} prevents energy transfer between the states.`,
              answer: task.polarity,
              correction: `Pathway ${task.ordinal} transfers energy between the states.`,
            }
        : task.requiredShortAnswerMode === "formula"
          ? {
              ...common,
              question: `What equation relates force, mass, and acceleration for pathway ${task.ordinal}?`,
              answer: "F=m*a",
              gradingMode: "formula",
              acceptableAnswers: [],
              requiredItems: [],
              formulaTokens: [
                { kind: "identifier", value: "F" },
                { kind: "operator", value: "=" },
                { kind: "identifier", value: "m" },
                { kind: "operator", value: "*" },
                { kind: "identifier", value: "a" },
              ],
            }
          : task.requiredShortAnswerMode === "proposition"
            ? {
                ...common,
                question: `How does pathway ${task.ordinal} transfer energy?`,
                answer: `Pathway ${task.ordinal} transfers energy between defined states.`,
                gradingMode: "proposition",
                acceptableAnswers: [],
                requiredItems: [`transfers energy between defined states`],
              }
            : {
                ...common,
                question: `What term names energy route ${task.ordinal}?`,
                answer: `route ${task.ordinal}`,
                gradingMode: "atomic_term",
                acceptableAnswers: [],
                requiredItems: [],
              };
  if (task.task.includes('"retryQuestion"')) {
    question.retryQuestion =
      task.type === "multiple_choice"
        ? `Which mechanism carries energy through pathway ${task.ordinal}?`
        : task.type === "true_false"
          ? task.polarity
            ? `Energy moves between the defined states through pathway ${task.ordinal}.`
            : `Pathway ${task.ordinal} prevents energy movement between the defined states.`
          : `Which response describes energy transfer through pathway ${task.ordinal}?`;
  }
  return completionResponse(mutate({ questions: [question] }, task));
}

const RECORDED_BENCHMARK_TOPICS = [
  [
    "Climate feedback mechanisms",
    "Carbon dioxide traps outgoing infrared energy through pathway",
  ],
  [
    "Immune response signaling",
    "An immune receptor transfers a pathogen signal through pathway",
  ],
  [
    "Language acquisition mechanisms",
    "Repeated meaningful input strengthens a language pattern through pathway",
  ],
  [
    "Public-key cryptography",
    "A one-way operation protects a private value through pathway",
  ],
  [
    "Supply and demand relationships",
    "A price signal coordinates buyers and sellers through pathway",
  ],
  [
    "Chemical reaction energy",
    "A catalyst lowers the activation barrier through pathway",
  ],
  [
    "Institutional checks and balances",
    "Separated authority limits unilateral power through pathway",
  ],
  [
    "Wireless error correction",
    "Redundant information repairs a damaged signal through pathway",
  ],
  [
    "Orbital energy transfer",
    "A gravitational interaction changes orbital energy through pathway",
  ],
  [
    "光合作用中的能量转换",
    "叶绿体通过 pathway 转换光能 because 电子传递形成可用的化学能",
  ],
];

function recordedConceptFirstInput(bankIndex, questionCount, questionTypes) {
  const [title, sentence] =
    RECORDED_BENCHMARK_TOPICS[bankIndex % RECORDED_BENCHMARK_TOPICS.length];
  const uuid = (prefix) =>
    `${prefix}0000000-0000-4000-8000-${String(bankIndex + 1).padStart(12, "0")}`;
  return {
    ...conceptFirstInput(questionCount, questionTypes),
    title,
    quizLanguage: bankIndex % 10 === 9 ? "zh-CN" : "en",
    generationId: uuid("1"),
    generationSessionId: uuid("2"),
    recoverySessionId: uuid("3"),
    jobId: uuid("4"),
    plainText: Array.from(
      { length: Math.max(24, questionCount * 2) },
      (_, index) => {
        const objectives = [
          "absorption",
          "diffusion",
          "feedback",
          "conversion",
          "regulation",
          "storage",
          "transport",
          "detection",
          "comparison",
          "sequencing",
          "inhibition",
          "amplification",
          "equilibrium",
          "adaptation",
          "prediction",
          "allocation",
          "verification",
          "compression",
          "replication",
          "coordination",
          "mutation",
          "selection",
          "classification",
          "calibration",
          "recombination",
          "insulation",
          "oscillation",
          "resonance",
          "transmission",
          "stabilization",
        ];
        // The zh-CN bank grounds a Chinese term: the refined quiz-language
        // check requires every learner-visible value to read as Chinese.
        const groundedSentence = sentence.replace(
          "pathway",
          bankIndex % 10 === 9 ? `路径${index + 1}` : `pathway${index + 1}`,
        );
        return `${groundedSentence} by objective${objectives[index % objectives.length]} because the defined mechanism changes measurable outcome ${index + 11} under condition ${index + 1}.`;
      },
    ).join(bankIndex % 10 === 9 ? "。 " : " "),
  };
}

function conceptFirstTaskFromRequest(request) {
  const body = typeof request === "string" ? JSON.parse(request) : request;
  const task = body.messages.at(-1).content;
  const slot = task.match(
    /Create the singleton (multiple_choice|true_false|short_answer) item for q(\d+) of (\d+)/u,
  );
  assert.ok(slot, "request contains one concept-first slot");
  const focusExcerpt = task.match(
    /Eligible instructional evidence[^:]*:\n([\s\S]*?)\n\nAlready accepted objectives/u,
  )?.[1];
  assert.ok(focusExcerpt, "request contains eligible evidence");
  return {
    body,
    task,
    type: slot[1],
    ordinal: Number(slot[2]),
    focusExcerpt,
    quizLanguage: /Selected quiz language: Simplified Chinese \(zh-CN\)/u.test(
      task,
    )
      ? "zh-CN"
      : "en",
  };
}

function conceptFirstResponse(request, mutate = (value) => value) {
  const task = conceptFirstTaskFromRequest(request);
  const evidence = task.focusExcerpt.split(/(?<=[.!?。！？])\s+/u)[0];
  const pathway = evidence.match(/(?:pathway|路径)\d+/u)?.[0];
  assert.ok(pathway, "eligible evidence contains an atomic mechanism term");
  const objective =
    evidence.match(/objective[a-z]+/iu)?.[0] ??
    evidence.match(/catalyst \d+/iu)?.[0] ??
    `mechanism ${task.ordinal}`;
  const isChinese = task.quizLanguage === "zh-CN";
  const common = {
    id: `q${task.ordinal}`,
    type: task.type,
    concept: isChinese
      ? `${objective} ${pathway}`
      : `${objective} energy function`,
    objectiveCategory: "mechanism",
    question: isChinese
      ? [
          `${objective}过程中哪条路径负责传递能量？`,
          `${objective}如何通过特定路径完成能量传递？`,
          `哪种机制在${objective}期间传递能量？`,
          `请识别${objective}所使用的能量传递路径。`,
          `${objective}过程依靠哪条路径输送能量？`,
        ][(task.ordinal - 1) % 5]
      : [
          `Which pathway carries energy during ${objective}?`,
          `What route performs energy transfer for ${objective}?`,
          `Which route moves energy between states during ${objective}?`,
          `Identify the pathway responsible for ${objective}.`,
          `Which mechanism carries energy in the ${objective} process?`,
        ][(task.ordinal - 1) % 5],
    explanation: isChinese
      ? `${pathway}在${objective}过程中传递能量。`
      : `${pathway} carries energy during ${objective}.`,
    evidenceQuote: evidence,
  };
  if (task.type === "multiple_choice") {
    return completionResponse(
      mutate(
        {
          questions: [
            {
              ...common,
              answerSpan: pathway,
              answerText: isChinese ? `能量传递${pathway}` : pathway,
              distractors: [
                {
                  text: isChinese
                    ? `能量储存库${task.ordinal}`
                    : `reservoir${task.ordinal}`,
                  whyWrong: isChinese
                    ? "它储存能量，而不是传递能量。"
                    : "It stores rather than transfers energy.",
                },
                {
                  text: isChinese
                    ? `能量屏障${task.ordinal}`
                    : `barrier${task.ordinal}`,
                  whyWrong: isChinese
                    ? "它会阻碍所描述的能量传递。"
                    : "It blocks the supported transfer.",
                },
                {
                  text: isChinese
                    ? `能量汇${task.ordinal}`
                    : `sink${task.ordinal}`,
                  whyWrong: isChinese
                    ? "它移除能量，而不是输送能量。"
                    : "It removes rather than carries energy.",
                },
              ],
            },
          ],
        },
        task,
      ),
    );
  }
  if (task.type === "true_false") {
    return completionResponse(
      mutate(
        {
          questions: [
            {
              ...common,
              question: isChinese
                ? `${pathway}会在反应过程中传递能量。`
                : `${pathway} transfers energy during the reaction.`,
              supportedFact: evidence,
            },
          ],
        },
        task,
      ),
    );
  }
  return completionResponse(
    mutate(
      {
        questions: [
          {
            ...common,
            question: isChinese
              ? [
                  `${objective}的能量传递路径叫什么？`,
                  `哪个机制术语表示${objective}路径？`,
                  `请写出执行${objective}的路径名称。`,
                  `${objective}期间由哪条路径传递能量？`,
                  `请识别${objective}使用的机制。`,
                ][(task.ordinal - 1) % 5]
              : [
                  `What term names the energy-transfer route for ${objective}?`,
                  `Which mechanism term identifies the ${objective} route?`,
                  `Name the pathway that performs ${objective}.`,
                  `What route carries energy during ${objective}?`,
                  `Identify the mechanism used for ${objective}.`,
                ][(task.ordinal - 1) % 5],
            shortAnswerMode: "atomic_term",
            answer: pathway,
            aliases: [],
          },
        ],
      },
      task,
    ),
  );
}

function taskFromRequest(request) {
  const body = typeof request === "string" ? JSON.parse(request) : request;
  const task = body.messages.at(-1).content;
  const planText = task.match(
    /Mandatory slot plan:\n([\s\S]*?)\n\n(?:Primary source focus|Eligible instructional evidence|Already accepted questions)/,
  )?.[1];
  assert.ok(planText, "request contains a bounded slot plan");
  const slots = planText.split("\n").map((line) => {
    const match = line.match(
      /^q(\d+): (multiple_choice|true_false|short_answer)(?:, (?:answer|preferred_answer)=(true|false))?$/,
    );
    assert.ok(match, `valid slot line: ${line}`);
    return {
      ordinal: Number(match[1]),
      type: match[2],
      polarity: match[3] === undefined ? undefined : match[3] === "true",
    };
  });
  const focusExcerpt = task.match(
    /(?:Primary source focus for this slot; use only instructional claims copied from this excerpt|Eligible instructional evidence; only this excerpt may ground the learner-facing content):\n([\s\S]*?)\n\nAlready accepted questions/,
  )?.[1];
  return { body, task, slots, focusExcerpt };
}

function groundedQuestionForSlot(slot, focusExcerpt) {
  const evidenceSentences = String(focusExcerpt)
    .split(/(?<=[.!?])\s+/u)
    .filter(Boolean);
  const evidence = evidenceSentences[slot.ordinal % evidenceSentences.length];
  assert.ok(evidence, "grounded task contains a usable evidence sentence");
  const subject = evidence.match(/^(.+?) uses the /iu)?.[1];
  const correctAnswer = evidence.match(/uses the (.+? process) to /iu)?.[1];
  const effect = evidence.match(/ process to (.+?) because/iu)?.[1];
  assert.ok(subject, "grounded evidence contains a conceptual subject");
  assert.ok(correctAnswer, "grounded evidence contains an exact answer phrase");
  assert.ok(effect, "grounded evidence contains a supported conceptual effect");
  const prompts = [
    `Which process enables ${subject} to ${effect}?`,
    `How does ${subject} ${effect}?`,
    `What process links the input and output in ${subject}?`,
    `Which process produces the supported effect in ${subject}?`,
    `Identify the process used by ${subject}.`,
  ];
  const common = {
    id: `q${slot.ordinal}`,
    type: slot.type,
    concept: `${subject} mechanism`,
    explanation: `${correctAnswer} enables ${subject} to ${effect}.`,
    sourceEvidence: evidence,
    claim: {
      subject,
      relation: "uses",
      value: correctAnswer,
      cluster: `${subject} ${correctAnswer}`,
    },
  };
  if (slot.type === "true_false") {
    return {
      ...common,
      question: evidence,
      supportedStatement: evidence,
      mode: "supported",
      mutation: null,
    };
  }
  if (slot.type === "short_answer") {
    return {
      ...common,
      question: prompts[(slot.ordinal - 1) % prompts.length],
      answer: correctAnswer,
      rubricIdeas: [correctAnswer],
      acceptableAnswers: [
        correctAnswer,
        `the ${correctAnswer}`,
        `${subject} uses the ${correctAnswer}`,
      ],
    };
  }
  return {
    ...common,
    question: prompts[(slot.ordinal - 1) % prompts.length],
    correctAnswer,
    distractors: ["storage reserve", "blocking barrier", "signal receptor"].map(
      (kind) => ({
        text: `${kind} process`,
        whyWrong: `This ${kind} process does not perform the supported energy transfer.`,
      }),
    ),
  };
}

function questionForSlot(slot, automaticMode = true) {
  const marker = [
    "photosynthesis",
    "kinematics",
    "quotient",
    "ecosystem",
    "probability",
    "momentum",
    "derivative",
    "equilibrium",
    "mitosis",
    "algorithm",
    "geometry",
    "oxidation",
    "inference",
    "frequency",
    "integral",
  ][slot.ordinal - 1];
  const common = {
    id: `q${slot.ordinal}`,
    type: slot.type,
    concept: `Supported ${marker} concept`,
    question: `Which specific ${marker} result is supported for case ${slot.ordinal}?`,
    explanation: `The stated relationship supports concept ${slot.ordinal}.`,
  };
  if (slot.type === "multiple_choice") {
    if (!automaticMode) {
      return {
        ...common,
        choices: [
          `Supported answer ${slot.ordinal}`,
          `Distractor A ${slot.ordinal}`,
          `Distractor B ${slot.ordinal}`,
          `Distractor C ${slot.ordinal}`,
        ],
        answerIndex: 0,
        answer: `Supported answer ${slot.ordinal}`,
      };
    }
    return {
      ...common,
      correctAnswer: `Supported answer ${slot.ordinal}`,
      distractors: [
        `Distractor A ${slot.ordinal}`,
        `Distractor B ${slot.ordinal}`,
        `Distractor C ${slot.ordinal}`,
      ],
    };
  }
  if (slot.type === "true_false") {
    const answer =
      typeof slot.polarity === "boolean"
        ? slot.polarity
        : slot.ordinal % 2 === 0;
    return {
      ...common,
      answer,
      correction: answer
        ? "The statement is accurate as written."
        : `The corrected statement for concept ${slot.ordinal} is supported.`,
    };
  }
  return {
    ...common,
    answer: `Complete reference answer ${slot.ordinal}`,
    rubricIdeas: [`Required idea ${slot.ordinal}`],
    acceptableAnswers: [],
  };
}

function completionResponse(value, finishReason = "stop") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: finishReason,
          message: {
            content: typeof value === "string" ? value : JSON.stringify(value),
          },
        },
      ],
      usage: {
        prompt_tokens: 101,
        completion_tokens: 37,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function formulaTokens(expression) {
  const matches = expression.match(
    /\p{L}[\p{L}\p{N}_]*|\d+(?:\.\d+)?|[+\-*/^=(),']/gu,
  );
  assert.equal(matches?.join(""), expression);
  return matches.map((value) => ({
    kind: /^[\p{L}_]/u.test(value)
      ? "identifier"
      : /^\d/.test(value)
        ? "number"
        : value === "("
          ? "left_paren"
          : value === ")"
            ? "right_paren"
            : value === ","
              ? "comma"
              : value === "'"
                ? "prime"
                : "operator",
    value,
  }));
}

function responseForRequest(request, mutate = (value) => value) {
  const task = taskFromRequest(request);
  const automaticMode = task.body.messages[0].content.includes(
    "return one correctAnswer",
  );
  const groundedMode = task.body.messages[0].content.includes(
    "sourceEvidence copied exactly",
  );
  return completionResponse(
    mutate(
      {
        title: "A model title that must be ignored",
        questions: task.slots.map((slot) =>
          groundedMode
            ? groundedQuestionForSlot(slot, task.focusExcerpt)
            : questionForSlot(slot, automaticMode),
        ),
      },
      task,
    ),
  );
}

function oneCharacterSseResponse(value, options = {}) {
  const encoder = new TextEncoder();
  const source = JSON.stringify(value);
  const pauseAfterQuestion = options.pauseAfterQuestion ?? false;
  const questionText = pauseAfterQuestion
    ? JSON.stringify(value.questions[0])
    : "";
  const splitIndex = pauseAfterQuestion
    ? source.indexOf(questionText) + questionText.length
    : 0;
  let release = () => undefined;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const frame = (payload, crlf = false) =>
    encoder.encode(
      `data: ${JSON.stringify(payload)}${crlf ? "\r\n\r\n" : "\n\n"}`,
    );
  const enqueue = (controller, content) => {
    for (const character of content) {
      controller.enqueue(
        frame(
          {
            choices: [{ finish_reason: null, delta: { content: character } }],
          },
          true,
        ),
      );
      controller.enqueue(encoder.encode(": keep-alive\r\n\r\n"));
    }
  };
  const response = new Response(
    new ReadableStream({
      async start(controller) {
        enqueue(controller, source.slice(0, splitIndex || undefined));
        if (splitIndex) await gate;
        if (splitIndex) enqueue(controller, source.slice(splitIndex));
        controller.enqueue(
          frame({ choices: [{ finish_reason: "stop", delta: {} }] }, true),
        );
        controller.enqueue(
          frame(
            {
              choices: [],
              usage: {
                prompt_tokens: 103,
                completion_tokens: 41,
                completion_tokens_details: { reasoning_tokens: 0 },
              },
            },
            true,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\r\n\r\n"));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
  return { response, release };
}

function rawContentSseResponse(content) {
  const encoder = new TextEncoder();
  const frame = (payload) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          frame({
            choices: [{ finish_reason: null, delta: { content } }],
          }),
        );
        controller.enqueue(
          frame({
            choices: [{ finish_reason: "stop", delta: { content: "" } }],
          }),
        );
        controller.enqueue(
          frame({
            choices: [],
            usage: {
              prompt_tokens: 103,
              completion_tokens: 41,
              completion_tokens_details: { reasoning_tokens: 0 },
            },
          }),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function interruptedSseResponse(value, acceptedCount) {
  const encoder = new TextEncoder();
  const source = JSON.stringify(value);
  const questionText = JSON.stringify(value.questions[acceptedCount - 1]);
  const splitIndex = source.indexOf(questionText) + questionText.length;
  let read = false;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (read) {
          controller.error(new Error("forced transport interruption"));
          return;
        }
        read = true;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  finish_reason: null,
                  delta: { content: source.slice(0, splitIndex) },
                },
              ],
            })}\n\n`,
          ),
        );
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function interruptedBeforeQuestionCompletes(value) {
  const encoder = new TextEncoder();
  const source = JSON.stringify(value);
  const splitIndex = Math.max(
    1,
    source.indexOf('"question"') + '"question":"partial'.length,
  );
  let read = false;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (read) {
          controller.error(new Error("forced transport interruption"));
          return;
        }
        read = true;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  finish_reason: null,
                  delta: { content: source.slice(0, splitIndex) },
                },
              ],
            })}\n\n`,
          ),
        );
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function maxRun(values) {
  let maximum = 0;
  let current = 0;
  let previous;
  for (const value of values) {
    current = value === previous ? current + 1 : 1;
    maximum = Math.max(maximum, current);
    previous = value;
  }
  return maximum;
}

test("v5.3 uses singleton primary calls and local answer mapping", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task);
    return responseForRequest(init.body);
  };

  const result = await generateQuizFromPlainText(
    stableInput(15, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.deepEqual(
    requests.map((request) => request.slots.length),
    Array(15).fill(1),
  );
  for (const request of requests) {
    assert.deepEqual(request.body.thinking, { type: "disabled" });
    assert.equal(request.body.temperature, 0.2);
    assert.equal("reasoning_effort" in request.body, false);
    assert.equal("top_p" in request.body, false);
    assert.equal(request.body.max_tokens, 4_096);
    assert.match(
      request.body.messages[0].content,
      /one correctAnswer and exactly three unique distractors/,
    );
    assert.doesNotMatch(request.task, /"answerIndex"/);
  }
  assert.equal(result.protocolVersion, 7);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.3");
  assert.equal(result.validatorVersion, "validator-local-progressive-v4.2");
  assert.equal(result.importVersion, "extension-progressive-import-v5");
  assert.equal(result.generationProfile, "stable_auto_recovery_v5_3");
  assert.equal(result.quiz.title, "Trusted source lesson title");
  assert.equal(result.metrics.aiCalls, requests.length);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(calls.length, requests.length);
  assert.ok(calls.every((event) => event.classification === "primary"));
  assert.ok(calls.every((event) => event.protocolVersion === 7));
  assert.ok(calls.every((event) => event.requestedCount === 1));
  assert.ok(calls.every((event) => event.ordinalAttempt === 1));
  assert.ok(calls.every((event) => event.retryKind === undefined));
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        question.answerIndex >= 0 &&
        question.answer === question.choices[question.answerIndex],
    ),
  );
});

test("v5.7 streams concept-only grounded singleton calls with protocol 8 telemetry", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => responseForRequest(init.body);

  const result = await generateQuizFromPlainText(
    groundedInput(5),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.protocolVersion, 8);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.7");
  assert.equal(result.validatorVersion, "validator-local-progressive-v4.6");
  assert.equal(result.importVersion, "extension-progressive-import-v6");
  assert.equal(result.generationProfile, "evidence_grounded_auto_v5_4");
  assert.equal(calls.length, 5);
  assert.ok(
    calls.every(
      (event) => event.protocolVersion === 8 && event.purpose === "generation",
    ),
  );
  assert.ok(
    result.quiz.questions.every(
      (question) => question.claimKey && question.conceptCluster,
    ),
  );
});

test("v5.8 sends the concept-first singleton contract and truthful call lifecycles", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const fetchCountAtCallEvent = [];
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const parsed = conceptFirstTaskFromRequest(init.body);
    requests.push(parsed);
    return conceptFirstResponse(init.body);
  };

  const input = conceptFirstInput();
  const result = await generateQuizFromPlainText(
    input,
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => {
      calls.push(event);
      fetchCountAtCallEvent.push(requests.length);
    },
  );

  assert.equal(result.protocolVersion, 9);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.8");
  assert.equal(result.validatorVersion, "validator-local-progressive-v4.12");
  assert.equal(result.importVersion, "extension-progressive-import-v7");
  assert.equal(result.generationProfile, "concept_first_auto_v5_8");
  assert.match(result.promptFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(requests.length, 5);
  for (const request of requests) {
    assert.deepEqual(request.body.thinking, { type: "disabled" });
    assert.equal(request.body.temperature, 0.2);
    assert.deepEqual(request.body.response_format, { type: "json_object" });
    assert.equal(request.body.stream, true);
    assert.equal(request.body.stream_options.include_usage, true);
    assert.equal(request.body.messages.length, 3);
    assert.match(
      request.body.messages[0].content,
      /direct assessment generator/u,
    );
    assert.match(
      request.body.messages[0].content,
      /Never ask learners to recall an estimate/u,
    );
    assert.match(
      request.body.messages[0].content,
      /the first word of question must be one of/u,
    );
    assert.match(
      request.body.messages[0].content,
      /copy one unique answerSpan character-for-character/u,
    );
    assert.match(
      request.body.messages[2].content,
      /estimated annual monetary value of ecosystem services/u,
    );
    assert.doesNotMatch(
      request.body.messages[2].content,
      /The reference gives a direct relationship/u,
    );
    assert.match(request.body.messages[1].content, /Context boundary/iu);
    assert.doesNotMatch(
      request.body.messages[1].content,
      /Private reference material — never mention this source/u,
    );
    assert.doesNotMatch(
      request.body.messages[1].content,
      /pathway\d+/iu,
      "v5.8 never sends the complete transcript in its stable prefix",
    );
    assert.match(request.task, /Preferred objective category/iu);
    assert.match(request.task, /never invent a mechanism/iu);
    if (request.type === "multiple_choice") {
      assert.match(
        request.task,
        /If answerText is only a term, name, noun phrase, or factor/iu,
      );
    }
    const unsentTranscriptSentence = input.plainText
      .split(/(?<=[.!?。！？])\s+/u)
      .find((sentence) => !request.focusExcerpt.includes(sentence));
    assert.ok(
      unsentTranscriptSentence,
      "fixture contains transcript material outside the selected focus",
    );
    assert.ok(
      !request.body.messages.some((message) =>
        message.content.includes(unsentTranscriptSentence),
      ),
      "v5.8 sends only the locally selected evidence window",
    );
    assert.match(request.task, /Exact JSON schema/u);
    assert.match(request.task, /Final learner-copy gate/u);
    assert.doesNotMatch(request.task, /Mandatory slot plan/u);
    if (request.type === "multiple_choice") {
      assert.match(request.task, /answerText must equal answerSpan except/u);
      assert.match(
        request.task,
        /do not paraphrase, summarize, change morphology/u,
      );
      assert.match(
        request.task,
        /distractors as exactly six concise candidate strings/u,
      );
      assert.doesNotMatch(request.task, /Each whyWrong must/u);
      const schemaStart = request.task.indexOf("Exact JSON schema:");
      const schemaText = request.task.slice(schemaStart);
      assert.ok(
        schemaText.indexOf('"evidenceQuote"') <
          schemaText.indexOf('"answerSpan"'),
        "v5.8 schema locks evidence before the answer span",
      );
      assert.ok(
        schemaText.indexOf('"answerSpan"') < schemaText.indexOf('"question"'),
        "v5.8 schema locks the answer before drafting the question",
      );
    }
  }
  const sentSystemFingerprints = new Set(
    requests.map((request) =>
      createHash("sha256")
        .update(request.body.messages[0].content)
        .digest("hex"),
    ),
  );
  assert.deepEqual([...sentSystemFingerprints], [result.promptFingerprint]);
  assert.deepEqual(
    [...new Set(requests.map((request) => request.body.messages[1].content))],
    [requests[0].body.messages[1].content],
    "the context-boundary prefix remains byte-identical",
  );
  assert.notEqual(
    requests[0].body.messages[2].content,
    requests[1].body.messages[2].content,
    "only the current singleton task suffix evolves",
  );
  assert.equal(calls.length, 10);
  for (let index = 0; index < calls.length; index += 2) {
    const started = calls[index];
    const completed = calls[index + 1];
    assert.equal(started.lifecycleState, "started");
    assert.equal(completed.lifecycleState, "completed");
    assert.equal(started.callIndex, completed.callIndex);
    assert.equal(started.protocolVersion, 9);
    assert.equal(completed.outcome, "complete");
    assert.ok(
      fetchCountAtCallEvent[index] >= started.callIndex + 1,
      "started lifecycle is emitted only after fetch dispatch",
    );
  }
  assert.ok(
    result.quiz.questions.some(
      (question) =>
        question.type === "short_answer" &&
        question.shortAnswerMode === "atomic_term" &&
        question.rubricV2?.mode === "atomic_term",
    ),
  );
});

test("v5.12 sends the grading-consistent local-polarity contract", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let framedAttempts = 0;
  globalThis.fetch = async (_url, init) => {
    const parsed = promptFirstTaskFromRequest(init.body);
    requests.push(parsed);
    return promptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 2 && framedAttempts++ === 0) {
        value.questions[0].question =
          "In the described mechanism, how does route 2 transfer energy?";
        value.questions[0].explanation =
          "The passage states that route 2 transfers energy between defined states.";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.protocolVersion, 10);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.12");
  assert.equal(result.validatorVersion, "validator-minimal-gradeability-v5.3");
  assert.equal(result.importVersion, "extension-progressive-import-v8");
  assert.equal(result.generationProfile, "prompt_first_auto_v5_12");
  const invalidRetryQuestions = result.quiz.questions.filter(
    (question) =>
      typeof question.retryQuestion !== "string" ||
      question.retryQuestion.trim().length === 0 ||
      question.retryQuestion
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim() ===
        question.question
          .normalize("NFKC")
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .trim(),
  );
  assert.deepEqual(invalidRetryQuestions, []);
  assert.equal(requests.length, 5);
  assert.equal(
    calls.filter((event) => event.lifecycleState === "started").length,
    5,
  );
  assert.equal(
    calls.filter(
      (event) =>
        event.lifecycleState === "started" &&
        event.classification === "automatic_retry",
    ).length,
    0,
  );
  assert.equal(
    requests[0].body.messages[0].content,
    PROMPT_FIRST_SYSTEM_PROMPT,
  );
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /assigns the desired truth value/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /sponsor, brand/u);
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /SUBJECT → RELATION OR ACTION → OBJECT/u,
  );
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /Never begin with this, that/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /every technical qualifier/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /isolated statistic/u);
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Never build a False item by changing an incidental measurement/u,
  );
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /never reverse n-k/u);
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /sufficient suitable habitat is available/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /continents were once connected and later moved apart/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /must not introduce not, no, never, without/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Never write "the evidence indicates/u,
  );
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /"and ideally,"/u);
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Never write "the described process/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Never write "the context specifies/u,
  );
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /omit who approved or knew/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /lithosphere composition/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /B-cells, activated with help/u);
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Do not say antibodies attack cells/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /three additional required effects/u,
  );
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /exchange route information/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /two interpretations/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /must not contain the answer/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /correction or refinement/u);
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Neighboring claims are independent by default/u,
  );
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /particles on the left/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /never say that energy cycles/u);
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Do not create a False item by replacing one possible location/u,
  );
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /provisional claim followed by/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /weakened but living/u);
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /action–reaction pair/u);
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /cannot establish what causes most cases/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /A selected fact must name the actual subject, relationship, and direction/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Those descriptions are mathematically equivalent/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Do not rename a contact or normal force as gravity/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /A method answer states the operation/u,
  );
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /Do not merely repeat/u);
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Never ask what is important, central, useful, necessary, or helpful for understanding/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /explicitly dates both events and states their order/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /distractor may not restate one true stage/u,
  );
  assert.match(PROMPT_FIRST_SYSTEM_PROMPT, /same electrical-signal mechanism/u);
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Treat the assigned candidate as a search lead, not as text to copy/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Never turn a blocked answer into a False statement/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /Once opportunity cost has been defined/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /assess that decision method directly/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /breaking a chemical bond requires energy/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /tidal-force explanation compares the gravitational pull on the near and far sides/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /a subduction zone is a convergent boundary where one plate descends beneath another/u,
  );
  assert.match(
    PROMPT_FIRST_SYSTEM_PROMPT,
    /the grading target must name the actual alternatives or allocation/u,
  );
  assert.match(
    requests[1].body.messages.at(-1).content,
    /BLOCKED prior questions and grading targets/u,
  );
  assert.match(
    requests[1].body.messages.at(-1).content,
    /these are unavailable evidence/u,
  );
  assert.equal(
    createHash("sha256")
      .update(requests[0].body.messages[0].content)
      .digest("hex"),
    result.promptFingerprint,
  );
  assert.match(requests[0].task, /Required objective:/u);
  assert.match(requests[0].task, /Assigned assessment fact/u);
  assert.match(requests[0].task, /Additional private context/u);
  assert.match(
    requests[0].task,
    /BLOCKED prior questions and grading targets/u,
  );
  assert.doesNotMatch(requests[1].task, /prior question:/u);
  assert.match(requests[1].task, /blocked assessment families:/u);
  assert.doesNotMatch(requests[1].task, /\nblocked grading target:/u);
  assert.doesNotMatch(requests[1].task, /prior question:/u);
  assert.match(
    requests[0].task,
    /definition and a purpose question are duplicates/u,
  );
  assert.match(requests.at(-1).task, /blocked assessment families:/u);
  assert.match(
    requests.find((request) => request.type === "true_false").task,
    /Never assess a claim that the internal context labels as an oversimplification/u,
  );
  assert.match(
    requests.find((request) => request.type === "true_false").task,
    /Preserve every (?:source )?negation/u,
  );
  assert.match(
    requests.find((request) => request.type === "true_false").task,
    /rewrite the chosen complete fact as one concise, standalone true sentence/u,
  );
  assert.match(
    requests.find((request) => request.type === "true_false").task,
    /supportedStatement is always the TRUE correction/u,
  );
  assert.match(requests[0].task, /Never attribute a fact to a speaker/u);
  assert.match(requests[0].task, /ClipQuest constructs them locally/u);
  assert.match(
    requests[0].task,
    /When the chosen fact states only a relationship, category, or association/u,
  );
  assert.match(
    requests[0].task,
    /if they supply no additional reason, briefly restate the fact/u,
  );
  assert.doesNotMatch(requests[0].task, /repairContext|answerSpan/u);
  assert.ok(
    requests.every((request) =>
      /Required objective: (?!formula)/u.test(request.task),
    ),
    "v5.12 never forces a formula objective onto formula-free evidence",
  );
  assert.ok(
    requests
      .filter((request) => request.type === "short_answer")
      .every((request) =>
        /"gradingMode":"proposition"|"gradingMode":"enumeration"/u.test(
          request.task,
        ),
      ),
    "the structure example matches the supported short-answer objective",
  );
  assert.doesNotMatch(
    result.quiz.questions[1].question,
    /(?:According to the lesson|described mechanism)/iu,
  );
  assert.doesNotMatch(
    result.quiz.questions[1].explanation,
    /(?:reference material|the passage states)/iu,
  );
});

test("v5.12 continuation normalizes a missing retry kind to a schema-safe structural retry", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => promptFirstResponse(init.body);

  const input = promptFirstInput(5, ["multiple_choice"]);
  input.continuation = {
    startIndex: 1,
    resultProtocolVersion: 10,
    promptVersion: "quiz-local-json-stream-v5.12",
    validatorVersion: "validator-minimal-gradeability-v5.3",
    promptFingerprint: createHash("sha256")
      .update(PROMPT_FIRST_SYSTEM_PROMPT)
      .digest("hex"),
    generationProfile: "prompt_first_auto_v5_12",
    nextCallIndex: 0,
    nextOrdinalAttempt: 2,
    automaticRetryCount: 1,
    retryBudgetUsedCount: 1,
    retryKind: "automatic_resume",
    retryOrdinals: [2],
    acceptedQuestions: [
      {
        id: "q1",
        type: "multiple_choice",
        concept: "accepted concept",
        question: "Which mechanism explains accepted concept?",
      },
    ],
  };

  const result = await generateQuizFromPlainText(
    input,
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.generatedStartIndex, 1);
  assert.equal(result.totalQuestions, 5);
  const firstRetry = calls.find(
    (event) =>
      event.lifecycleState === "started" &&
      event.classification === "automatic_retry",
  );
  assert.equal(firstRetry?.retryKind, "structural");
});

test("v5.12 retries an exact repeated question and grading target", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let q2Attempts = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) =>
    promptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 2 && q2Attempts++ === 0) {
        value.questions[0].question = "How does pathway 1 transfer energy?";
        value.questions[0].answer =
          "Pathway 1 transfers energy between defined states.";
        value.questions[0].requiredItems = [
          "transfers energy between defined states",
        ];
      }
      return value;
    });

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["short_answer"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(q2Attempts, 2);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(
    calls.some(
      (event) =>
        event.outcome === "schema_invalid" && event.acceptedCount === 0,
    ),
    true,
  );
  assert.equal(
    new Set(result.quiz.questions.map((question) => question.answer)).size,
    5,
  );
});

test("v5.12 abandons a low-value evidence slot before automatic retry", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = promptFirstTaskFromRequest(init.body);
    requests.push(task);
    return promptFirstResponse(init.body, (value) => {
      if (requests.length === 1) {
        value.questions[0].concept = "historical scope";
        value.questions[0].question =
          "What is the historical scope of this field?";
        value.questions[0].answer = "It dates back to antiquity.";
        value.questions[0].requiredItems = ["dates back to antiquity"];
        value.questions[0].acceptableAnswers = [
          "The field dates back to antiquity.",
        ];
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["short_answer"]),
    "sk-local-test",
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(requests.length, 6);
  assert.notEqual(requests[0].primaryClaim, requests[1].primaryClaim);
  assert.doesNotMatch(result.quiz.questions[0].question, /historical scope/iu);
});

test("v5.12 abandons evidence that repeatedly invites an unsupported absolute", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = promptFirstTaskFromRequest(init.body);
    requests.push(task);
    return promptFirstResponse(init.body, (value) => {
      if (requests.length === 1) {
        // Keep the otherwise-valid answer, rubric, and source overlap intact so
        // this attempt fails for exactly one reason: the model introduced an
        // absolute that the assigned evidence does not support.
        value.questions[0].question = value.questions[0].question.replace(
          /\?$/u,
          " in every case?",
        );
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["short_answer"]),
    "sk-local-test",
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(requests.length, 6);
  assert.notEqual(requests[0].primaryClaim, requests[1].primaryClaim);
  assert.doesNotMatch(
    `${result.quiz.questions[0].question} ${result.quiz.questions[0].answer}`,
    /\b(?:always|every|must)\b/iu,
  );
});

test("v5.12 changes evidence after one true-false polarity mismatch", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = promptFirstTaskFromRequest(init.body);
    requests.push(task);
    return promptFirstResponse(init.body, (value) => {
      if (requests.length === 1) {
        value.questions[0].explanation = task.polarity
          ? "The statement is false, so the proposed relationship does not hold."
          : "The statement is true, so the proposed relationship does hold.";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["true_false"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(requests.length, 6);
  assert.equal(
    calls.some((event) => event.outcome === "polarity_mismatch"),
    true,
  );
  assert.notEqual(requests[0].primaryClaim, requests[1].primaryClaim);
});

test("v5.12 changes evidence after one compound true-false claim", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = promptFirstTaskFromRequest(init.body);
    requests.push(task);
    return promptFirstResponse(init.body, (value) => {
      if (requests.length === 1) {
        const field = task.polarity ? "supportedStatement" : "falseStatement";
        value.questions[0][field] =
          `${value.questions[0][field].replace(/\.$/u, "")}, and the reaction changes by 11 units.`;
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["true_false"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(requests.length, 6);
  assert.equal(
    calls.some((event) => event.outcome === "true_false_compound_claim"),
    true,
  );
  assert.notEqual(requests[0].primaryClaim, requests[1].primaryClaim);
});

test("v5.12 repairs an interrogative true-false retry before storage", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const requests = [];
  const primaryClaims = [];
  let firstQuestionAttempts = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = promptFirstTaskFromRequest(init.body);
    requests.push(task.body.messages.at(-1).content);
    primaryClaims.push(task.primaryClaim);
    return promptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 1 && firstQuestionAttempts++ === 0) {
        value.questions[0].retryQuestion =
          "Under this relationship, does pathway 1 transfer or block energy?";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["true_false"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(firstQuestionAttempts, 2);
  assert.equal(result.metrics.retryCount, 1);
  assert.doesNotMatch(result.quiz.questions[0].retryQuestion, /[?？]\s*$/u);
  assert.equal(
    calls.some((event) => event.outcome === "retry_question_invalid"),
    true,
  );
  assert.match(
    requests[1],
    /previous retryQuestion was missing, copied the original prompt, or used the wrong response format/u,
  );
  assert.notEqual(primaryClaims[0], primaryClaims[1]);
});

test("v5.12 locally normalizes a collapsed false item without another model request", async (context) => {
  const originalFetch = globalThis.fetch;
  let injected = false;
  let requests = 0;
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value, task) => {
      if (!injected && task.type === "true_false" && !task.polarity) {
        injected = true;
        delete value.questions[0].falseStatement;
        value.questions[0].explanation =
          "The route couples the two states, allowing energy to move between them.";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["true_false"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(requests, 5);
  assert.equal(
    calls.filter(
      (event) =>
        event.lifecycleState === "completed" &&
        event.outcome === "polarity_mismatch",
    ).length,
    0,
  );
  assert.equal(
    calls.filter(
      (event) =>
        event.lifecycleState === "started" &&
        event.classification === "automatic_retry",
    ).length,
    0,
  );
  assert.ok(
    result.quiz.questions.some(
      (question) =>
        question.answer === true && question.correction === question.question,
    ),
  );
  for (const question of result.quiz.questions) {
    assert.doesNotMatch(question.correction, /statement is true/iu);
    assert.notEqual(question.explanation, question.correction);
  }
});

test("v5.12 keeps a nonexclusive modal contrast as the supported true fact", () => {
  const question = normalizeGeneratedQuestion(
    {
      type: "true_false",
      concept: "environmental selection",
      supportedStatement:
        "Environmental factors can make some traits more favorable than others.",
      falseStatement:
        "Environmental factors can make some traits less favorable than others.",
      explanation:
        "Environmental conditions affect which traits improve survival and reproduction.",
    },
    {
      expectedId: "q1",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
      expectedTrueFalseAnswer: false,
    },
  );

  assert.equal(question.answer, true);
  assert.equal(
    question.question,
    "Environmental factors can make some traits more favorable than others.",
  );
  assert.equal(question.correction, question.question);
  assert.equal(question.localPolarityFallback, true);
  assert.match(question.explanation, /^This statement is true:/u);
});

test("v5.12 keeps a bare-negation contrast as the supported true fact", () => {
  const supportedStatement =
    "The Shah Hamdan mosque served as a place of worship, interaction, and learning that spread Islamic tradition.";
  const question = normalizeGeneratedQuestion(
    {
      type: "true_false",
      concept: "mosque cultural role",
      supportedStatement,
      falseStatement:
        "The Shah Hamdan mosque served as a place of worship but not interaction or learning, so it did not spread Islamic tradition.",
      explanation:
        "Worship, interaction, and learning made the mosque a center of cultural transmission.",
    },
    {
      expectedId: "q1",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
      expectedTrueFalseAnswer: false,
    },
  );

  assert.equal(question.answer, true);
  assert.equal(question.question, supportedStatement);
  assert.equal(question.correction, supportedStatement);
  assert.equal(question.localPolarityFallback, true);
  assert.equal(
    question.explanation,
    `This statement is true: ${supportedStatement}`,
  );
  assert.doesNotMatch(question.explanation, /false statement/iu);
});

test("v5.12 removes a described-setup prefix without changing the fact", () => {
  const question = normalizeGeneratedQuestion(
    {
      type: "true_false",
      concept: "thermodynamic system boundary",
      supportedStatement:
        "In the described setup, the system consists of the beaker and its solution, excluding the external burner.",
      explanation:
        "The burner and everything beyond the beaker boundary are surroundings.",
    },
    {
      expectedId: "q1",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
      expectedTrueFalseAnswer: true,
    },
  );

  assert.equal(
    question.question,
    "The system consists of the beaker and its solution, excluding the external burner.",
  );
  assert.equal(question.correction, question.question);
});

test("v5.11 does not classify an ordinal fraction as a formula", () => {
  assert.equal(
    hasPromptFirstV511FormulaEvidence(
      "The compromise counted an enslaved person as 3/5ths for representation and taxation.",
    ),
    false,
  );
  assert.equal(
    hasPromptFirstV511FormulaEvidence(
      "Average speed is calculated with the formula v=d/t.",
    ),
    true,
  );
});

test("v5.12 requires a complete formula target rather than an equation example", () => {
  assert.equal(
    hasPromptFirstV512FormulaEvidence(
      "Memory is learning that has persisted over time.",
    ),
    false,
  );
  assert.equal(
    hasPromptFirstV512FormulaEvidence(
      "If 1 + 2 = 3 and 4 + 2 = 6, subtracting the equations gives 3 = 3.",
    ),
    false,
  );
  assert.equal(
    hasPromptFirstV512FormulaEvidence(
      "Net force is expressed by the equation F=ma.",
    ),
    true,
  );
  assert.equal(
    hasPromptFirstV512FormulaEvidence(
      "Average speed is calculated with the formula v=d/t.",
    ),
    true,
  );
  assert.equal(
    hasPromptFirstV512FormulaEvidence(
      "Return on capital equals capital income divided by the value of the capital stock.",
    ),
    false,
  );
});

test("v5.12 uses explicit True/False field ownership and explanatory feedback", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const parsed = promptFirstTaskFromRequest(init.body);
    requests.push(parsed);
    return promptFirstResponse(init.body);
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["true_false"]),
    "sk-local-test",
  );

  assert.equal(requests.length, 5);
  assert.ok(requests.every((request) => request.explicitPolarity));
  assert.ok(
    requests.every((request) => /"supportedStatement"/u.test(request.task)),
  );
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        question.explanation !== question.question &&
        question.explanation !== question.correction,
    ),
  );
});

test("v5.12 preserves a role-reversal false contrast instead of relabeling it true", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) =>
    promptFirstResponse(init.body, (value, task) => {
      if (task.type === "true_false" && !task.polarity) {
        value.questions[0].supportedStatement = `In market ${task.ordinal}, a price change moves along the demand curve and changes quantity demanded, not demand.`;
        value.questions[0].falseStatement = `In market ${task.ordinal}, a price change moves along the demand curve and changes demand, not quantity demanded.`;
        value.questions[0].retryQuestion = `A price change in market ${task.ordinal} moves along the existing demand curve and changes demand, not quantity demanded.`;
        value.questions[0].explanation =
          "The false statement swaps demand with quantity demanded; a price change moves along the existing curve.";
      }
      return value;
    });

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["true_false"]),
    "sk-local-test",
  );
  const contrast = result.quiz.questions.find((question) =>
    /changes demand, not quantity demanded/u.test(question.question),
  );
  assert.ok(contrast);
  assert.equal(contrast.answer, false);
  assert.match(contrast.correction, /changes quantity demanded, not demand/u);
});

test("v5.12 removes presentation scaffolding without requesting another question", () => {
  const normalized = normalizeGeneratedQuestion(
    {
      type: "multiple_choice",
      concept: "prediction",
      question:
        "What relationship does the example illustrate between training data and prediction reliability?",
      explanation:
        "The private content states that more relevant training data makes prediction more reliable, as shown by repeated trials.",
      correctAnswer:
        "More relevant training data generally makes prediction more reliable.",
      distractors: [
        "Training data prevents prediction.",
        "Prediction reliability never changes.",
        "Less relevant data always guarantees accuracy.",
      ],
    },
    {
      expectedId: "q1",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
    },
  );
  assert.equal(
    normalized.question,
    "What is the relationship between training data and prediction reliability?",
  );
  assert.equal(
    normalized.explanation,
    "More relevant training data makes prediction more reliable. For example, repeated trials.",
  );
  const hiddenDiagram = normalizeGeneratedQuestion(
    {
      type: "multiple_choice",
      concept: "energy conversion",
      question:
        "What relationship does the diagram show between petroleum and electricity?",
      explanation:
        "Petroleum can be used directly or converted into electricity for use by different sectors.",
      correctAnswer:
        "Petroleum can be used directly or converted into electricity.",
      distractors: [
        "Petroleum can only be used directly.",
        "Electricity is converted into petroleum.",
        "Petroleum cannot contribute to electricity generation.",
      ],
    },
    {
      expectedId: "q2",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
    },
  );
  assert.equal(
    hiddenDiagram.question,
    "What is the relationship between petroleum and electricity?",
  );
  const describedCovalent = normalizeGeneratedQuestion(
    {
      type: "short_answer",
      concept: "hydrogen duet",
      question:
        "In the described covalent sharing between hydrogen and oxygen, why does hydrogen achieve a stable electron configuration?",
      explanation:
        "Hydrogen shares an electron with oxygen and fills its 1s shell with two electrons.",
      answer: "Its 1s shell contains two shared electrons.",
      gradingMode: "proposition",
      acceptableAnswers: [],
      requiredItems: [],
    },
    {
      expectedId: "q3",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
    },
  );
  assert.equal(
    describedCovalent.question,
    "When hydrogen shares electrons with oxygen, why does hydrogen achieve a stable electron configuration?",
  );
  const contextNormalized = normalizeGeneratedQuestion(
    {
      type: "short_answer",
      concept: "hippocampal memory",
      question: "What role does the hippocampus play in memory?",
      explanation:
        "The context indicates that the hippocampus is necessary for forming new declarative memories.",
      answer: "It helps form new declarative memories.",
      gradingMode: "proposition",
      acceptableAnswers: [],
      requiredItems: [],
    },
    {
      expectedId: "q2",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
    },
  );
  assert.equal(
    contextNormalized.explanation,
    "The hippocampus is necessary for forming new declarative memories.",
  );
  const normalizedContrast = normalizeGeneratedQuestion(
    {
      type: "short_answer",
      concept: "prediction reliability",
      question:
        "How does additional training data affect prediction reliability?",
      explanation:
        "The private content contrasts limited training data with more data., the additional examples improve prediction reliability.",
      answer: "More training data improves prediction reliability.",
      gradingMode: "proposition",
      acceptableAnswers: [],
      requiredItems: ["more training data improves prediction reliability"],
    },
    {
      expectedId: "q2",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
    },
  );
  assert.equal(
    normalizedContrast.explanation,
    "Limited training data with more data; the additional examples improve prediction reliability.",
  );
  const normalizedTrueFalse = normalizeGeneratedQuestion(
    {
      type: "true_false",
      concept: "next-word prediction",
      question:
        "A language model ignores the words that precede the next word.",
      correction:
        "A language model predicts the next word by seeing certain types of words in context.",
      explanation:
        "Seeing certain types of words helps predict the next word in the described scenario.",
    },
    {
      expectedId: "q2",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
      expectedTrueFalseAnswer: false,
    },
  );
  assert.doesNotMatch(
    `${normalizedTrueFalse.correction} ${normalizedTrueFalse.explanation}`,
    /certain types|described scenario/iu,
  );
  const midSentenceAttribution = normalizeGeneratedQuestion(
    {
      type: "true_false",
      concept: "contact forces",
      question:
        "Contact forces arise from electromagnetic interactions between matter.",
      correction:
        "Contact forces arise from electromagnetic interactions between matter.",
      explanation:
        "The statement is true. The context specifies that the forces between contacting materials are electromagnetic interactions.",
    },
    {
      expectedId: "q3",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
      expectedTrueFalseAnswer: true,
    },
  );
  assert.doesNotMatch(
    midSentenceAttribution.explanation,
    /context specifies/iu,
  );
  assert.match(
    midSentenceAttribution.explanation,
    /forces between contacting materials are electromagnetic interactions/iu,
  );
});

test("v5.12 removes hidden example feedback and fixes environment grammar locally", () => {
  const normalized = normalizeGeneratedQuestion(
    {
      type: "short_answer",
      concept: "evolutionary adaptation",
      question:
        "How does evolution operate relative to the environment in which the organisms are in?",
      explanation:
        "Evolution changes trait frequencies across generations. In the given data, 23 appears twice while every other number appears once.",
      answer:
        "Traits change relative to the environment in which the organisms are in.",
      gradingMode: "proposition",
      acceptableAnswers: [],
      requiredItems: ["Traits change relative to the environment"],
    },
    {
      expectedId: "q1",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV512Mode: true,
    },
  );

  assert.doesNotMatch(
    `${normalized.question} ${normalized.answer} ${normalized.explanation}`,
    /environment in which the organisms are in|given data/iu,
  );
  assert.match(normalized.question, /environment the organisms inhabit/iu);
  assert.equal(
    normalized.explanation,
    "Evolution changes trait frequencies across generations.",
  );
});

test("v5.12 requires formula tokens in the DeepSeek schema when the assigned fact is a formula", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let injectedMeaningQuestion = false;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const parsed = promptFirstTaskFromRequest(init.body);
    requests.push(parsed);
    return promptFirstResponse(init.body, (value) => {
      if (!injectedMeaningQuestion) {
        injectedMeaningQuestion = true;
        value.questions[0].question =
          "In the equation F=m*a, what does F represent?";
        value.questions[0].explanation =
          "F is the net force in the described scenario.";
      }
      return value;
    });
  };
  const input = promptFirstInput(5, ["short_answer"]);
  input.plainText = [
    "Newton's second law uses the complete formula F=m*a, where F is net force, m is mass, and a is acceleration.",
    "Average speed uses the complete formula v=d/t, where v is speed, d is distance, and t is time.",
    "Momentum uses the complete formula p=m*v, where p is momentum, m is mass, and v is velocity.",
    "Electrical power uses the complete formula P=V*I, where P is power, V is voltage, and I is current.",
    "Density uses the complete formula rho=m/V, where rho is density, m is mass, and V is volume.",
  ].join(" ");

  const result = await generateQuizFromPlainText(
    input,
    "sk-local-test",
    () => undefined,
  );

  assert.equal(requests.length, 5);
  for (const request of requests) {
    assert.match(request.task, /gradingMode=formula/u);
    assert.match(request.task, /"required":\[[^\]]*"formulaTokens"/u);
  }
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        question.shortAnswerMode === "formula" &&
        question.rubricV2.canonicalFormula,
    ),
  );
  assert.match(result.quiz.questions[0].question, /^What is the formula for/u);
  assert.match(result.quiz.questions[0].explanation, /^The formula is /u);
});

test("v5.11 fills non-grading labels locally instead of retrying", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 1) {
        value.questions[0].topic = value.questions[0].concept;
        delete value.questions[0].concept;
        value.questions[0].prompt = value.questions[0].question;
        delete value.questions[0].question;
        value.questions[0].rationale = "";
        delete value.questions[0].explanation;
        value.questions[0].answer = value.questions[0].correctAnswer;
        delete value.questions[0].correctAnswer;
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
  );

  assert.equal(requests, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.ok(result.quiz.questions[0].concept.length > 0);
  assert.equal(
    result.quiz.questions[0].question,
    "How does pathway 1 transfer energy?",
  );
  assert.equal(
    result.quiz.questions[0].explanation,
    result.quiz.questions[0].answer,
  );
});

test("v5.11 assigns false polarity locally without a changed-detail contract", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value, task) => {
      if (!task.polarity) {
        delete value.questions[0].changedDetail;
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstV511Input(5, ["true_false"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(requests, 5);
  assert.equal(
    calls.filter(
      (event) =>
        event.lifecycleState === "started" &&
        event.classification === "automatic_retry",
    ).length,
    0,
  );
  assert.ok(
    result.quiz.questions.some(
      (question) => question.type === "true_false" && question.answer === false,
    ),
  );
});

test("v5.11 keeps an echoed supported fact true instead of persisting a false contradiction", () => {
  const supportedStatement =
    "A femboy is a male-presenting person who adopts feminine attributes while still identifying as male.";
  const question = normalizeGeneratedQuestion(
    {
      type: "true_false",
      concept: "femboy definition",
      question: supportedStatement,
      correction:
        "A femboy is a female-presenting person who adopts masculine attributes while still identifying as female.",
      explanation:
        "The definition specifies a male-presenting person who retains a male identity.",
    },
    {
      expectedId: "q2",
      automaticMode: true,
      promptFirstV59Mode: true,
      promptFirstV511Mode: true,
      promptFirstPrimaryClaim: supportedStatement,
      expectedTrueFalseAnswer: false,
    },
  );

  assert.equal(question.question, supportedStatement);
  assert.equal(question.answer, true);
  assert.equal(question.correction, supportedStatement);
  assert.equal(question.localPolarityFallback, true);
});

test("v5.11 keeps a collapsed false candidate as a supported true item without retrying", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value, task) => {
      if (!task.polarity) {
        value.questions[0].question = `Pathway ${task.ordinal} transfers energy between the states.`;
        if (task.ordinal % 2 === 0) {
          delete value.questions[0].correction;
        } else {
          value.questions[0].correction = value.questions[0].question;
        }
        value.questions[0].incorrectText = "transfers";
        value.questions[0].correctText = "transfers";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstV511Input(5, ["true_false"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(requests, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(
    calls.filter(
      (event) =>
        event.lifecycleState === "started" &&
        event.classification === "automatic_retry",
    ).length,
    0,
  );
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        question.answer === true && question.correction === question.question,
    ),
  );
});

test("v5.11 collapses a deictic or nonexclusive false paraphrase without undefined feedback", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value, task) => {
      if (!task.polarity) {
        value.questions[0].question = `Mineral composition in rock layers can indicate when volcanic event ${task.ordinal} occurred.`;
        value.questions[0].correction =
          task.ordinal % 2 === 0
            ? `This principle can indicate when event ${task.ordinal} occurred.`
            : `Differences in mineral composition can indicate when volcanic event ${task.ordinal} occurred.`;
        value.questions[0].explanation =
          "The statement is false because the same relationship is true.";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstV511Input(5, ["true_false"]),
    "sk-local-test",
  );

  assert.equal(requests, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        question.answer === true &&
        question.correction === question.question &&
        !/undefined|statement is (?:true|false)/iu.test(question.explanation),
    ),
  );
});

test("v5.11 assigns complete nonvisual facts and avoids repeated source families", async (context) => {
  const originalFetch = globalThis.fetch;
  const primaryClaims = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = promptFirstTaskFromRequest(init.body);
    primaryClaims.push(task.primaryClaim);
    return promptFirstResponse(init.body);
  };
  const input = promptFirstV511Input(5, ["multiple_choice"]);
  input.title = "Scientific relationships";
  input.plainText = [
    "Relative to this diagram, the region below the membrane is inside the cell.",
    "At most you might have two electrons on one side of helium, which would cause some imbalance.",
    "Credit card APRs can reach the 30% range.",
    "Phospholipids form bilayers because hydrophilic heads face water while hydrophobic tails cluster away from water.",
    "Glycolipids act as recognition tags that help immune cells distinguish self cells from foreign cells.",
    "Larger electron clouds are more polarizable and therefore produce stronger London dispersion forces.",
    "Index fossils correlate rock layers because each index fossil existed during a limited geologic interval.",
    "Stare decisis guides courts to use prior decisions when current cases are materially similar.",
    "A resistor's impedance is independent of angular frequency because its impedance contains no frequency term.",
    "A market forms when multiple parties exchange things of value.",
  ].join(" ");

  await generateQuizFromPlainText(input, "sk-local-test");

  assert.equal(primaryClaims.length, 5);
  assert.doesNotMatch(
    primaryClaims.join(" "),
    /diagram|region below|two electrons|30% range/iu,
  );
  assert.equal(new Set(primaryClaims).size, primaryClaims.length);
});

test("v5.11 recovers a complete singleton emitted after a leaked non-thinking trace", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    if (requests !== 1) return promptFirstResponse(init.body);
    const task = promptFirstTaskFromRequest(init.body);
    const question = {
      type: "multiple_choice",
      concept: "energy pathway",
      question: "How does the pathway transfer energy?",
      retryQuestion: "Which mechanism carries energy through the pathway?",
      explanation: "The pathway transfers energy between defined states.",
      correctAnswer: "Through the defined route",
      distractors: [
        "By blocking the route",
        "By removing every state",
        "By isolating the input",
      ],
    };
    const leaked =
      '{"questions":[{"type":"multiple_choice","explanation":"private trace' +
      `<｜end▁of▁thinking｜>${JSON.stringify({ questions: [question] })}`;
    assert.equal(task.type, "multiple_choice");
    return rawContentSseResponse(leaked);
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
  );

  assert.equal(requests, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(result.quiz.questions.length, 5);
  assert.equal(
    result.quiz.questions[0].question,
    "How does the pathway transfer energy?",
  );
});

test("v5.11 leaves editorial ranking review to the prompt and QA audit", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value) => {
      if (requests === 1) {
        value.questions[0].question =
          "Which route most directly transfers energy?";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(requests, 5);
  assert.equal(result.metrics.retryCount, 0);
});

test("v5.11 requires the evidence-assigned short-answer mode", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value) => {
      const question = value.questions[0];
      if (requests === 1) {
        question.question = "What term names the energy route?";
        question.answer = "energy route";
        question.gradingMode = "atomic_term";
        question.requiredItems = [];
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["short_answer"]),
    "sk-local-test",
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(requests, 6);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(result.quiz.questions[0].shortAnswerMode, "proposition");
});

test("v5.11 accepts a proposition answering one explicit condition", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value, task) => {
      const question = value.questions[0];
      question.question = `Under what condition does process ${task.ordinal} begin?`;
      question.retryQuestion = `What activation-threshold condition starts process ${task.ordinal}?`;
      question.answer = `Process ${task.ordinal} begins when input ${task.ordinal} exceeds its activation threshold.`;
      question.gradingMode = "proposition";
      question.acceptableAnswers = [];
      question.requiredItems = [
        `input ${task.ordinal} exceeds its activation threshold`,
      ];
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstInput(5, ["short_answer"]),
    "sk-local-test",
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(requests, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(result.quiz.questions[0].shortAnswerMode, "proposition");
});

test("v5.11 accepts a compact parseable equation without requiring formula tokens", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value, task) => {
      delete value.questions[0].formulaTokens;
      value.questions[0].answer = ["F=m*a", "p=m*v", "v=d/t", "P=W/t", "a=F/m"][
        task.ordinal - 1
      ];
      return value;
    });
  };

  const input = promptFirstInput(5, ["short_answer"]);
  input.plainText = Array.from(
    { length: 12 },
    (_, index) =>
      `Newton's second law uses the equation F=m*a to relate force, mass, and acceleration for system ${index + 1}.`,
  ).join(" ");
  const result = await generateQuizFromPlainText(input, "sk-local-test");

  assert.equal(requests, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        question.shortAnswerMode === "formula" && question.answer.includes("="),
    ),
  );
});

test("v5.9 compatibility sends its original compact prompt-first contract", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const parsed = promptFirstTaskFromRequest(init.body);
    requests.push(parsed);
    return promptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 2) {
        value.questions[0].question =
          "According to the lesson, what route transfers energy?";
      }
      if (task.ordinal === 3) {
        value.questions[0].concept = "the same broad energy concept";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstV59Input(),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.protocolVersion, 10);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.9");
  assert.equal(result.validatorVersion, "validator-minimal-structural-v5.0");
  assert.equal(result.importVersion, "extension-progressive-import-v8");
  assert.equal(result.generationProfile, "prompt_first_auto_v5_9");
  assert.equal(requests.length, 5);
  assert.equal(
    calls.filter((event) => event.lifecycleState === "started").length,
    5,
  );
  assert.equal(
    calls.filter((event) => event.classification === "automatic_retry").length,
    0,
  );
  assert.ok(calls.every((event) => event.protocolVersion === 10));
  assert.equal(requests[0].body.messages.length, 2);
  assert.notEqual(
    requests[0].body.messages[0].content,
    PROMPT_FIRST_SYSTEM_PROMPT,
  );
  assert.equal(
    createHash("sha256")
      .update(requests[0].body.messages[0].content)
      .digest("hex"),
    result.promptFingerprint,
  );
  assert.match(requests[0].task, /Preferred objective:/u);
  assert.match(requests[0].task, /Exact JSON schema:/u);
  assert.doesNotMatch(
    requests[0].task,
    /repairContext|Final learner-copy gate|answerSpan/u,
  );
  assert.ok(
    result.quiz.questions.some((question) =>
      question.question.startsWith("According to the lesson"),
    ),
    "editorial wording is accepted instead of causing a runtime retry",
  );
});

test("v5.9 retries only structurally unusable singleton output", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value) => {
      if (requests === 1)
        value.questions[0].distractors = ["same", "same", "other"];
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstV59Input(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );
  assert.equal(result.quiz.questions.length, 5);
  assert.equal(requests, 6);
  const retries = calls.filter(
    (event) =>
      event.lifecycleState === "started" &&
      event.classification === "automatic_retry",
  );
  assert.equal(retries.length, 1);
  assert.equal(retries[0].retryKind, "structural");
});

test("v5.9 keeps mathematical operators when checking choice uniqueness", async (context) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return promptFirstResponse(init.body, (value) => {
      value.questions[0].correctAnswer = "(1 + 1) / 2";
      value.questions[0].distractors = [
        "(1 - 1) / 2",
        "(1 * 1) / 2",
        "(1 + 1) * 2",
      ];
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    promptFirstV59Input(5, ["multiple_choice"]),
    "sk-local-test",
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(requests, 5);
  assert.equal(result.metrics.retryCount, 0);
});

test("v5.8 does not revalidate an already persisted streamed singleton", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => conceptFirstResponse(init.body);

  const result = await generateQuizFromPlainText(
    conceptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(calls.length, 10);
  assert.ok(
    calls
      .filter((event) => event.lifecycleState === "completed")
      .every(
        (event) => event.outcome === "complete" && event.acceptedCount === 1,
      ),
  );
});

test("v5.8 does not retry source wording confined to private MC validation aids", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    return conceptFirstResponse(init.body, (value) => {
      value.questions[0].distractors[0].whyWrong =
        "The evidence states that a different pathway carries energy.";
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(httpCalls, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(result.quiz.questions.length, 5);
  assert.ok(
    calls
      .filter((event) => event.lifecycleState === "completed")
      .every(
        (event) =>
          event.classification === "primary" && event.outcome === "complete",
      ),
  );
});

test("v5.8 rejects a pre-release continuation with a different prompt fingerprint before dispatch", async (context) => {
  const originalFetch = globalThis.fetch;
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    httpCalls += 1;
    throw new Error("The mismatched continuation must not dispatch.");
  };
  await assert.rejects(
    () =>
      generateQuizFromPlainText(
        {
          ...conceptFirstInput(),
          continuation: {
            startIndex: 1,
            resultProtocolVersion: 9,
            promptVersion: "quiz-local-json-stream-v5.8",
            validatorVersion: "validator-local-progressive-v4.12",
            promptFingerprint: "0".repeat(64),
            generationProfile: "concept_first_auto_v5_8",
            acceptedQuestions: [
              {
                id: "q1",
                type: "multiple_choice",
                concept: "Stored concept",
                question: "Which pathway carries energy?",
              },
            ],
          },
        },
        "sk-local-test",
      ),
    (error) =>
      error?.reasonCode === "local_state_conflict" &&
      /different concept-first prompt fingerprint/iu.test(error.message),
  );
  assert.equal(httpCalls, 0);
});

test("v5.8 resolves grading-sensitive values against the local focus when a private evidence quote is paraphrased", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    return conceptFirstResponse(init.body, (value) => {
      value.questions[0].evidenceQuote =
        "A concise private paraphrase that does not reproduce the instructional sentence.";
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(5, ["multiple_choice", "true_false", "short_answer"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(httpCalls, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(result.quiz.questions.length, 5);
  assert.ok(
    calls
      .filter((event) => event.lifecycleState === "completed")
      .every(
        (event) =>
          event.classification === "primary" && event.outcome === "complete",
      ),
  );
});

test("v5.8 accepts one uniquely grounded learner answer when the private MC span is malformed", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    return conceptFirstResponse(init.body, (value) => {
      const question = value.questions[0];
      const pathway = question.answerText;
      question.evidenceQuote =
        "A private paraphrase that does not reproduce the instructional sentence.";
      question.answerSpan = "an unsupported private span hint";
      question.answerText = `${pathway} energy`;
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(httpCalls, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(result.quiz.questions.length, 5);
  assert.ok(
    result.quiz.questions.every((question) =>
      question.choices.includes(question.answer),
    ),
  );
  assert.ok(
    calls
      .filter((event) => event.lifecycleState === "completed")
      .every(
        (event) =>
          event.classification === "primary" && event.outcome === "complete",
      ),
  );
});

test("v5.8 repairs a relationship answer that drops its directional qualifier", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const chunks = [];
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    return conceptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 5 && httpCalls === 1) {
        const question = value.questions[0];
        question.evidenceQuote = task.focusExcerpt
          .split(/(?<=[.!?。！？])\s+/u)
          .find((sentence) => /less genetic diversity/iu.test(sentence));
        question.question =
          "What is the role of genetic diversity in a species' ability to cope with environmental changes?";
        question.answerSpan = "much more vulnerable";
        question.answerText =
          "It makes the species much more vulnerable to environmental fluctuations.";
      }
      return value;
    });
  };

  const input = conceptFirstInput(5, ["multiple_choice"]);
  input.plainText = Array.from(
    { length: 5 },
    (_, index) =>
      `Species ${index + 1} uses pathway${index + 1} during objectiveadaptation${index + 1} because less genetic diversity is much more vulnerable to environmental fluctuation ${index + 11}; the defined mechanism links variation to a distinct adaptive response.`,
  ).join(" ");
  input.continuation = {
    startIndex: 4,
    resultProtocolVersion: 9,
    promptVersion: "quiz-local-json-stream-v5.8",
    validatorVersion: "validator-local-progressive-v4.12",
    promptFingerprint: createHash("sha256")
      .update(CONCEPT_FIRST_SYSTEM_PROMPT)
      .digest("hex"),
    generationProfile: "concept_first_auto_v5_8",
    questionPlan: {
      seed: "a".repeat(64),
      types: Array.from({ length: 5 }, () => "multiple_choice"),
    },
    nextCallIndex: 0,
    nextOrdinalAttempt: 1,
    automaticRetryCount: 0,
    retryBudgetUsedCount: 0,
    acceptedQuestions: Array.from({ length: 4 }, (_, index) => ({
      id: `q${index + 1}`,
      type: "multiple_choice",
      concept: `Immutable accepted concept ${index + 1}`,
      question: `Which distinct mechanism explains accepted concept ${index + 1}?`,
      claimKey: `immutable accepted claim ${index + 1}`,
      conceptCluster: `immutable cluster ${index + 1}`,
    })),
  };
  const result = await generateQuizFromPlainText(
    input,
    "sk-local-test",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
    (event) => calls.push(event),
  );

  assert.equal(
    httpCalls,
    2,
    JSON.stringify(
      calls
        .filter((event) => event.lifecycleState === "completed")
        .map((event) => ({
          ordinal: event.startIndex,
          classification: event.classification,
          outcome: event.outcome,
        })),
    ),
  );
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(calls[1]?.outcome, "mc_question_answer_mismatch");
  assert.equal(calls[2]?.classification, "automatic_retry");
  assert.equal(calls[2]?.retryKind, "answer_repair");
  assert.doesNotMatch(
    chunks[0]?.question.question,
    /role of genetic diversity/iu,
  );
});

test("v5.8 rejects presentation statistics before storage and repairs only that ordinal", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    return conceptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 1 && httpCalls === 1) {
        value.questions[0].concept = "ecosystem services monetary value";
        value.questions[0].question =
          "What is the estimated annual monetary value of the services that ecosystems provide for humanity, according to economic calculations?";
        value.questions[0].answerText = "$46 trillion per year";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(5),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(
    httpCalls,
    6,
    JSON.stringify(
      calls
        .filter((event) => event.lifecycleState === "completed")
        .map((event) => ({
          ordinal: event.startIndex,
          classification: event.classification,
          outcome: event.outcome,
        })),
    ),
  );
  assert.equal(calls[1]?.outcome, "source_framing_invalid");
  assert.equal(calls[2]?.classification, "automatic_retry");
  assert.equal(calls[2]?.retryKind, "content_repair");
  assert.doesNotMatch(result.quiz.questions[0].question, /monetary value/iu);
});

test("v5.8 repairs the production how-can non-answer and figurative scaffolding", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    return conceptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 1 && httpCalls === 1) {
        const question = value.questions[0];
        question.concept = "ecosystem collapse without catastrophes";
        question.question =
          "How can an ecosystem become vulnerable to collapse even without catastrophic events?";
        question.answerSpan =
          "even without cataclysmic events, like volcanoes and asteroids";
        question.answerText = question.answerSpan;
        question.evidenceQuote = `${question.answerSpan}. ${task.focusExcerpt}`;
        question.explanation =
          "Cut too many links, and the ecosystem can unravel.";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(httpCalls, 6);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(calls[1]?.outcome, "low_pedagogical_value");
  assert.equal(calls[2]?.classification, "automatic_retry");
  assert.equal(calls[2]?.retryKind, "content_repair");
  assert.doesNotMatch(
    JSON.stringify(result.quiz.questions[0]),
    /even without|cataclysmic|cut too many links|unravel/iu,
  );
});

test("v5.8 repairs a how-can answer that merely repeats the outcome", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    return conceptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 1 && httpCalls === 1) {
        const question = value.questions[0];
        question.concept = "ecosystem vulnerability";
        question.question =
          "How can an ecosystem become vulnerable to collapse even without catastrophic events?";
        question.answerSpan = "they're actually vulnerable to collapse";
        question.answerText = question.answerSpan;
        question.explanation =
          "Loss of biodiversity weakens the resilience of the ecosystem.";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(httpCalls, 6);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(calls[1]?.outcome, "question_answer_kind_mismatch");
  assert.equal(calls[2]?.classification, "automatic_retry");
  assert.equal(calls[2]?.retryKind, "answer_repair");
  assert.notEqual(
    result.quiz.questions[0].answer,
    "they're actually vulnerable to collapse",
  );
});

test("v5.8 repairs a malformed MC stem locally when its grounded answer is a complete assertion", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    return conceptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 1) {
        const question = value.questions[0];
        const assertion = task.focusExcerpt.split(/(?<=[.!?])\s+/u)[0];
        question.concept = "reaction energy trend";
        question.objectiveCategory = "relationship";
        question.question =
          "What condition do catalysts provide for reaction energy?";
        question.answerSpan = assertion;
        question.answerText = assertion;
        question.explanation = assertion;
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(httpCalls, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(
    result.quiz.questions[0].question,
    "Which statement correctly describes reaction energy trend?",
  );
  assert.equal(
    calls.filter((event) => event.classification === "automatic_retry").length,
    0,
  );
});

test("v5.8 selects three safe distractors from a six-candidate pool without another request", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const requestBodies = [];
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    requestBodies.push(JSON.parse(init.body));
    return conceptFirstResponse(init.body, (value, task) => {
      const question = value.questions[0];
      if (question.type === "multiple_choice") {
        question.distractors = [
          question.answerText,
          `${question.answerText}.`,
          `reservoir${task.ordinal}`,
          `barrier${task.ordinal}`,
          `sink${task.ordinal}`,
          `detour${task.ordinal}`,
        ];
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(httpCalls, 5);
  assert.equal(result.metrics.retryCount, 0);
  assert.ok(
    requestBodies.every((body) =>
      /"distractors":\{"type":"array","minItems":6,"maxItems":6/u.test(
        body.messages.at(-1).content,
      ),
    ),
  );
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        question.choices.length === 4 &&
        new Set(question.choices.map((choice) => choice.toLowerCase())).size ===
          4 &&
        !question.choices.includes(`${question.answer}.`),
    ),
  );
  assert.equal(
    calls.filter((event) => event.classification === "automatic_retry").length,
    0,
  );
});

test("v5.8 repairs How-does component lists before storing the singleton", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    return conceptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 1 && httpCalls === 1) {
        const question = value.questions[0];
        question.concept = "biodiversity and ecosystem resilience";
        question.question =
          "How does biodiversity contribute to ecosystem resilience?";
        question.answerSpan =
          "Biodiversity includes ecosystem, species, and genetic diversity";
        question.answerText = question.answerSpan;
        question.evidenceQuote = `${question.answerSpan}. ${task.focusExcerpt}`;
        question.explanation = "These three components define biodiversity.";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(httpCalls, 6);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(calls[1]?.outcome, "question_answer_kind_mismatch");
  assert.equal(calls[2]?.classification, "automatic_retry");
  assert.equal(calls[2]?.retryKind, "answer_repair");
  assert.notEqual(
    result.quiz.questions[0].answer,
    "Biodiversity includes ecosystem, species, and genetic diversity",
  );
});

test("v5.8 source-framing repair carries private evidence and explicit deictic guidance", async (context) => {
  const originalFetch = globalThis.fetch;
  const tasks = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const parsed = conceptFirstTaskFromRequest(init.body);
    tasks.push(parsed.task);
    return conceptFirstResponse(init.body, (value, task) => {
      if (task.ordinal === 1 && tasks.length === 1) {
        value.questions[0].question =
          "Which method is mentioned for transferring energy?";
        value.questions[0].explanation =
          "The reference lists the pathway as the correct mechanism.";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(),
    "sk-local-test",
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(result.metrics.retryCount, 1);
  assert.match(tasks[1], /sourceEvidence/u);
  assert.match(tasks[1], /Do not use the words.*mentioned.*listed.*stated/iu);
  assert.doesNotMatch(
    `${result.quiz.questions[0].question} ${result.quiz.questions[0].explanation}`,
    /mentioned|the reference lists/iu,
  );
});

test("v5.8 completes a 100-bank recorded-fixture release benchmark without content retries", async (context) => {
  const originalFetch = globalThis.fetch;
  let httpCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    httpCalls += 1;
    return conceptFirstResponse(init.body);
  };
  const typeCombinations = [
    ["multiple_choice"],
    ["true_false"],
    ["short_answer"],
    ["multiple_choice", "true_false"],
    ["multiple_choice", "short_answer"],
    ["true_false", "short_answer"],
    ["multiple_choice", "true_false", "short_answer"],
  ];
  const questionCounts = [5, 10, 15];
  const durations = [];
  let expectedHttpCalls = 0;

  for (let bankIndex = 0; bankIndex < 100; bankIndex += 1) {
    const questionCount = questionCounts[bankIndex % questionCounts.length];
    const questionTypes = typeCombinations[bankIndex % typeCombinations.length];
    const callEvents = [];
    const startedAt = performance.now();
    let result;
    try {
      result = await generateQuizFromPlainText(
        recordedConceptFirstInput(bankIndex, questionCount, questionTypes),
        "sk-local-benchmark",
        () => undefined,
        undefined,
        () => undefined,
        (event) => callEvents.push(event),
      );
    } catch (error) {
      // Surface the underlying reason in the message itself: the TAP reporter
      // used by CI prints only `error:` and drops the `cause` chain.
      const reason =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      const lastEvent = callEvents.at(-1);
      const lastCall = lastEvent
        ? ` Last call event: ${JSON.stringify(lastEvent)}.`
        : "";
      // Full diagnostics for CI, where only this test output is available.
      console.error(
        "[recorded-benchmark-failure]",
        inspect(error, { depth: 6, breakLength: 200 }),
        JSON.stringify(callEvents),
      );
      throw new Error(
        `Recorded benchmark bank ${bankIndex + 1} failed (${questionCount} questions, ${questionTypes.join("+")}): ${reason}.${lastCall}`,
        { cause: error },
      );
    }
    durations.push(performance.now() - startedAt);
    expectedHttpCalls += questionCount;

    assert.equal(result.quiz.questions.length, questionCount);
    assert.equal(result.metrics.aiCalls, questionCount);
    assert.equal(result.metrics.retryCount, 0);
    assert.equal(callEvents.length, questionCount * 2);
    assert.equal(
      callEvents.filter((event) => event.lifecycleState === "started").length,
      questionCount,
    );
    assert.ok(
      callEvents.every(
        (event) =>
          event.classification === "primary" &&
          event.protocolVersion === 9 &&
          event.recoverySessionId,
      ),
    );
    assert.ok(
      result.quiz.questions.every(
        (question) =>
          !/according to|lesson|transcript|presenter|exam weighting|course logistics/iu.test(
            `${question.question} ${question.explanation}`,
          ),
      ),
    );
  }

  assert.equal(httpCalls, expectedHttpCalls);
  durations.sort((left, right) => left - right);
  assert.ok(durations[Math.floor(durations.length * 0.95)] < 10_000);
});

test("v5.5 validates grounded true-false and short-answer singletons", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => responseForRequest(init.body);

  const result = await generateQuizFromPlainText(
    groundedInput(5, ["true_false", "short_answer"]),
    "sk-local-test",
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.ok(
    result.quiz.questions
      .filter((question) => question.type === "true_false")
      .every(
        (question) =>
          question.answer === true &&
          question.correction === "The statement is accurate as written.",
      ),
  );
  assert.ok(
    result.quiz.questions
      .filter((question) => question.type === "short_answer")
      .every((question) => question.answer.includes("process")),
  );
});

test("v5.5 grants content retry budgets independently to each ordinal", async (context) => {
  const originalFetch = globalThis.fetch;
  const attempts = new Map();
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    const ordinal = task.slots[0].ordinal;
    const attempt = (attempts.get(ordinal) ?? 0) + 1;
    attempts.set(ordinal, attempt);
    return responseForRequest(init.body, (value) => {
      if ((ordinal === 1 && attempt <= 2) || (ordinal === 2 && attempt === 1)) {
        value.questions[0].distractors[0].text =
          value.questions[0].correctAnswer;
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    groundedInput(5),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(attempts.get(1), 3);
  assert.equal(attempts.get(2), 2);
  assert.equal(
    calls.filter((event) => event.classification === "automatic_retry").length,
    3,
  );
  assert.deepEqual(
    calls
      .filter((event) => event.classification === "automatic_retry")
      .map((event) => event.retryKind),
    ["answer_repair", "answer_repair", "answer_repair"],
  );
});

test("v5.7 rejects raw lesson framing and repairs only that singleton", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const focuses = [];
  let q1Attempts = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) =>
    responseForRequest(init.body, (value, task) => {
      focuses.push(task.focusExcerpt);
      if (task.slots[0].ordinal === 1 && ++q1Attempts === 1) {
        value.questions[0].question =
          "According to the lesson, which process enables photosynthesis to convert light energy into chemical energy?";
        value.questions[0].explanation =
          "According to the lesson, the route transfer process connects input and output.";
      }
      return value;
    });

  const result = await generateQuizFromPlainText(
    groundedInput(5),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.metrics.aiCalls, calls.length);
  assert.equal(
    result.metrics.retryCount,
    calls.filter((event) => event.classification === "automatic_retry").length,
  );
  assert.doesNotMatch(result.quiz.questions[0].question, /according to/iu);
  assert.equal(
    result.quiz.questions[0].question,
    "Which process enables immune signaling to trigger a targeted cellular response?",
  );
  assert.equal(calls[0]?.outcome, "source_framing_invalid");
  assert.equal(calls[1]?.classification, "automatic_retry");
  assert.equal(calls[1]?.retryKind, "content_repair");
  assert.equal(calls[0]?.startIndex, 0);
  assert.equal(calls[1]?.startIndex, 0);
  assert.equal(focuses[0], focuses[1]);
});

test("v5.7 uses private-evidence prompt labels and concept-first quality checks", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task.body);
    return responseForRequest(init.body);
  };

  await generateQuizFromPlainText(groundedInput(5), "sk-local-test");

  const [systemMessage, referenceMessage, taskMessage] = requests[0].messages;
  assert.match(systemMessage.content, /direct assessment items/iu);
  assert.match(
    systemMessage.content,
    /remains meaningful without the source/iu,
  );
  assert.match(
    referenceMessage.content,
    /Topic hint — never test this label/iu,
  );
  assert.match(
    referenceMessage.content,
    /Private reference material — never mention this source/iu,
  );
  assert.doesNotMatch(referenceMessage.content, /Lesson title:/u);
  assert.doesNotMatch(
    referenceMessage.content,
    /Complete plain-text lesson transcript:/u,
  );
  assert.match(taskMessage.content, /Eligible instructional evidence/iu);
  assert.match(taskMessage.content, /structure only/iu);
  assert.match(systemMessage.content, /Where did Mendeleev apply/iu);
  assert.match(systemMessage.content, /How do limits determine/iu);
});

test("v5.7 repairs an overlapping short-answer rubric with its specific outcome", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const requests = [];
  let q1Attempts = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return responseForRequest(init.body, (value, task) => {
      if (task.slots[0].ordinal === 1 && ++q1Attempts === 1) {
        const answer = value.questions[0].answer;
        value.questions[0].rubricIdeas = [answer, `The ${answer}`];
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    groundedInput(5, ["short_answer"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(q1Attempts, 2);
  assert.equal(calls[0]?.outcome, "rubric_invalid");
  assert.equal(calls[1]?.classification, "automatic_retry");
  assert.equal(calls[1]?.retryKind, "content_repair");
  assert.match(
    requests[1].messages.at(-1).content,
    /independent indispensable ideas/iu,
  );
  assert.match(
    requests[1].messages.at(-1).content,
    /shortest full-credit answer first/iu,
  );
  assert.match(
    requests[1].messages.at(-1).content,
    /Repair context from the rejected model candidate/iu,
  );
  assert.match(requests[1].messages.at(-1).content, /"question":/u);
  assert.equal(
    taskFromRequest(requests[0]).focusExcerpt,
    taskFromRequest(requests[1]).focusExcerpt,
  );
});

test("v5.7 fails a logistics-only source before any DeepSeek request", async (context) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error(
      "DeepSeek must not be called for a non-instructional source",
    );
  };
  const input = {
    ...groundedInput(5),
    plainText: [
      "Welcome to the course and subscribe to the channel.",
      "Unit 1 weighs 10 percent of the AP Calculus BC exam.",
      "Late assignments must be submitted through the course website.",
      "The instructor has taught this course for twelve years.",
    ]
      .join(" ")
      .repeat(3),
  };

  await assert.rejects(
    generateQuizFromPlainText(input, "sk-local-test"),
    (error) => error?.reasonCode === "non_instructional_source",
  );
  assert.equal(fetchCount, 0);
});

test("v5.7 classifies and repairs grounded course trivia before storage", async (context) => {
  const originalFetch = globalThis.fetch;
  const attempts = new Map();
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    const ordinal = task.slots[0].ordinal;
    const attempt = (attempts.get(ordinal) ?? 0) + 1;
    attempts.set(ordinal, attempt);
    return responseForRequest(init.body, (value) => {
      if (ordinal === 1 && attempt === 1) {
        value.questions[0].concept = "AP Calculus BC exam weighting";
        value.questions[0].question =
          "What percentage of the AP Calculus BC exam is Unit 1 worth?";
        value.questions[0].claim = {
          subject: "Unit 1",
          relation: "is worth",
          value: "10 percent of the AP Calculus BC exam",
          cluster: "AP exam weighting",
        };
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    groundedInput(5),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(attempts.get(1), 2);
  assert.equal(
    result.metrics.retryCount,
    calls.filter((event) => event.classification === "automatic_retry").length,
  );
  assert.equal(calls[0]?.outcome, "course_logistics_invalid");
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        !/exam|weight|percentage|unit 1 worth/iu.test(question.question),
    ),
  );
  const retry = calls.find(
    (event) => event.classification === "automatic_retry",
  );
  assert.equal(retry?.retryKind, "content_repair");
  assert.equal(retry?.startIndex, 0);
});

test("question one is emitted from one-character SSE before its response resolves", async (context) => {
  const originalFetch = globalThis.fetch;
  let firstStream;
  let fetchCount = 0;
  const chunks = [];
  let resolveFirst;
  const firstReady = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  context.after(() => {
    firstStream?.release();
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    const task = taskFromRequest(init.body);
    const value = {
      questions: task.slots.map((slot) =>
        groundedQuestionForSlot(slot, task.focusExcerpt),
      ),
    };
    if (fetchCount === 1) {
      firstStream = oneCharacterSseResponse(value, {
        pauseAfterQuestion: true,
      });
      return firstStream.response;
    }
    return completionResponse(value);
  };

  let settled = false;
  const generation = generateQuizFromPlainText(
    groundedInput(5),
    "sk-local-test",
    () => undefined,
    undefined,
    (chunk) => {
      chunks.push(chunk);
      if (chunk.startIndex === 0) resolveFirst();
    },
  ).finally(() => {
    settled = true;
  });

  await firstReady;
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].question.id, "q1");
  assert.equal(settled, false);
  assert.equal(fetchCount, 1);
  firstStream.release();
  const result = await generation;
  assert.equal(result.quiz.questions.length, 5);
});

test("one-character SSE supports singleton MC, true/false, and short-answer calls", async (context) => {
  const originalFetch = globalThis.fetch;
  const observedTypes = new Set();
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    assert.equal(task.slots.length, 1);
    observedTypes.add(task.slots[0].type);
    return oneCharacterSseResponse({
      questions: task.slots.map(questionForSlot),
    }).response;
  };

  await generateQuizFromPlainText(stableInput(), "sk-local-test");
  assert.deepEqual([...observedTypes].sort(), [
    "multiple_choice",
    "short_answer",
    "true_false",
  ]);
});

test("safe normalization repairs only bounded representation differences", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) =>
    responseForRequest(init.body, (value) => {
      value.questions = value.questions.map((question) => {
        if (question.type === "multiple_choice") {
          const choices = [question.correctAnswer, ...question.distractors];
          const { correctAnswer, distractors, ...common } = question;
          return {
            ...common,
            concept: `  ${question.concept}  `,
            choices,
            answerIndex: "0",
            answer: correctAnswer.toUpperCase(),
            unknownModelField: "discard me",
          };
        }
        if (question.type === "true_false") {
          return {
            ...question,
            answer: String(question.answer).toUpperCase(),
            unknownModelField: true,
          };
        }
        const { acceptableAnswers: _optional, ...withoutOptional } = question;
        return { ...withoutOptional, unknownModelField: [] };
      });
      return value;
    });

  const result = await generateQuizFromPlainText(
    stableInput(),
    "sk-local-test",
  );
  assert.equal(result.quiz.questions.length, 5);
  assert.ok(
    result.quiz.questions.every(
      (question) => !("unknownModelField" in question),
    ),
  );
  assert.deepEqual(
    normalizeGeneratedQuestion({
      id: " q1 ",
      type: " true_false ",
      concept: " C ",
      question: " Q ",
      explanation: " E ",
      answer: "FALSE",
      correction: " fixed ",
    }),
    {
      id: "q1",
      type: "true_false",
      concept: "C",
      question: "Q",
      explanation: "E",
      answer: false,
      correction: "fixed",
    },
  );
});

test("formula token structures are serialized locally into canonical stored answers", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const canonical = "(u'(x)*v(x)-u(x)*v'(x))/(v(x)^2)";
  const prompts = [
    "Which quotient-rule derivative formula is supported by the lesson?",
    "How does the lesson express the derivative of a ratio of functions?",
    "Write the formula used to differentiate a numerator divided by a denominator.",
    "What symbolic expression combines u, v, and their derivatives for a quotient?",
    "State the lesson's denominator-squared differentiation equation.",
  ];
  globalThis.fetch = async (_url, init) =>
    responseForRequest(init.body, (value, task) => {
      const ordinal = task.slots[0].ordinal;
      value.questions[0] = {
        ...value.questions[0],
        question: prompts[ordinal - 1],
        answer: "(u'(x)*v(x)-u(x)*v'(x))/(v(x)²)",
        formulaTokens: formulaTokens(canonical),
        acceptableAnswers: [],
      };
      return value;
    });

  const result = await generateQuizFromPlainText(
    stableInput(5, ["short_answer"]),
    "sk-local-test",
  );
  assert.equal(result.quiz.questions.length, 5);
  assert.ok(
    result.quiz.questions.every(
      (question) =>
        question.answer === canonical && !("formulaTokens" in question),
    ),
  );
  assert.equal(serializeFormulaTokens(formulaTokens(canonical)), canonical);
  assert.equal(
    serializeFormulaTokens(formulaTokens("u(x)/v(x)")),
    null,
    "division operands must be explicitly parenthesized",
  );
});

test("a formula question without a valid token structure uses only bounded automatic retries", async (context) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const events = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    return responseForRequest(init.body, (value) => {
      value.questions[0].question =
        "What derivative formula is supported by the lesson?";
      value.questions[0].answer = "(f(b)-f(a))/(b-a)";
      delete value.questions[0].formulaTokens;
      return value;
    });
  };

  await assert.rejects(
    generateQuizFromPlainText(
      stableInput(5, ["short_answer"]),
      "sk-local-test",
      () => undefined,
      undefined,
      () => undefined,
      (event) => events.push(event),
    ),
    (error) => error?.reasonCode === "schema_invalid",
  );
  assert.equal(fetchCount, 3);
  assert.deepEqual(
    events.map((event) => event.classification),
    ["primary", "automatic_retry", "automatic_retry"],
  );
  assert.deepEqual(
    events.slice(1).map((event) => event.retryKind),
    ["content_repair", "content_repair"],
  );
});

for (const failure of [
  {
    name: "empty successful content",
    expected: "empty_content",
    input: stableInput(5, ["multiple_choice"]),
    response: () => completionResponse(""),
  },
  {
    name: "length finish",
    expected: "finish_length",
    input: stableInput(5, ["multiple_choice"]),
    response: () => completionResponse('{"questions":[', "length"),
  },
  {
    name: "ambiguous choices",
    expected: "answer_mapping_invalid",
    retryKind: "answer_repair",
    input: stableInput(5, ["multiple_choice"]),
    response: (request) =>
      responseForRequest(request, (value) => {
        value.questions[0].distractors[0] = value.questions[0].correctAnswer;
        return value;
      }),
  },
  {
    name: "missing rubric",
    expected: "schema_invalid",
    retryKind: "content_repair",
    input: stableInput(5, ["short_answer"]),
    response: (request) =>
      responseForRequest(request, (value) => {
        delete value.questions[0].rubricIdeas;
        return value;
      }),
  },
]) {
  if (!failure.retryKind) {
    failure.retryKind =
      failure.expected === "empty_content"
        ? "empty_content"
        : "truncated_output";
  }
  test(`${failure.name} exhausts exactly two bounded automatic repairs`, async (context) => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    const events = [];
    context.after(() => {
      globalThis.fetch = originalFetch;
    });
    globalThis.fetch = async (_url, init) => {
      fetchCount += 1;
      return failure.response(init.body);
    };
    await assert.rejects(
      generateQuizFromPlainText(
        failure.input,
        "sk-local-test",
        () => undefined,
        undefined,
        () => undefined,
        (event) => events.push(event),
      ),
      (error) => error?.reasonCode === failure.expected,
    );
    assert.equal(fetchCount, 3);
    assert.equal(events.length, 3);
    assert.deepEqual(
      events.map((event) => event.classification),
      ["primary", "automatic_retry", "automatic_retry"],
    );
    assert.deepEqual(
      events.map((event) => event.outcome),
      [failure.expected, failure.expected, failure.expected],
    );
    assert.equal(events[1].retryKind, failure.retryKind);
    assert.equal(events[2].retryKind, failure.retryKind);
    assert.equal(events[2].retryDelayMs, 0);
  });
}

test("a wrong model id is assigned locally without another DeepSeek request", async (context) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const events = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    return responseForRequest(init.body, (value) => {
      value.questions[0].id = "q15";
      return value;
    });
  };
  const result = await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => events.push(event),
  );
  assert.equal(fetchCount, 5);
  assert.deepEqual(
    result.quiz.questions.map((question) => question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.ok(events.every((event) => event.classification === "primary"));
});

test("duplicate content repairs only the first missing singleton", async (context) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const chunks = [];
  const events = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    return responseForRequest(init.body, (value) => {
      if (fetchCount === 2) {
        value.questions[0].question =
          "Which specific photosynthesis result is supported for case 1?";
      }
      return value;
    });
  };
  const result = await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
    (event) => events.push(event),
  );
  assert.equal(fetchCount, 6, "five singleton primaries plus one q2 repair");
  assert.equal(result.quiz.questions.length, 5);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.equal(events[1].outcome, "duplicate_question");
  assert.equal(events[1].acceptedCount, 0);
  assert.equal(events[2].classification, "automatic_retry");
  assert.equal(events[2].retryKind, "duplicate_repair");
  assert.equal(events[2].startIndex, 1);
});

test("a confirmed transient failure retries only the missing singleton", async (context) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const events = [];
  const progress = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Response("", {
        status: 429,
        headers: { "retry-after": "0.8" },
      });
    }
    return responseForRequest(init.body);
  };
  const result = await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    (stage, value, detail) => progress.push({ stage, value, detail }),
    undefined,
    () => undefined,
    (event) => events.push(event),
  );
  assert.equal(result.quiz.questions.length, 5);
  assert.equal(fetchCount, 6);
  assert.deepEqual(
    events.slice(0, 2).map((event) => event.classification),
    ["primary", "automatic_retry"],
  );
  assert.ok(events[0].retryDelayMs >= 800);
  assert.ok(events[0].retryDelayMs <= 938);
  assert.equal(events[1].retryDelayMs, 0);
  assert.equal(events[1].retryKind, "transport");
  assert.ok(
    progress.some(
      (event) =>
        event.detail.status === "retrying" &&
        event.detail.attempt === 2 &&
        event.detail.maxAttempts === 3 &&
        event.detail.retryDelayMs >= 800,
    ),
  );
});

for (const failure of [
  { status: 401, reasonCode: "credential_required" },
  { status: 402, reasonCode: "billing_required" },
]) {
  test(`${failure.status} enters action-required handling with no blind model retry`, async (context) => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    const events = [];
    context.after(() => {
      globalThis.fetch = originalFetch;
    });
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response("", { status: failure.status });
    };

    await assert.rejects(
      generateQuizFromPlainText(
        stableInput(5, ["multiple_choice"]),
        "sk-local-test",
        () => undefined,
        undefined,
        () => undefined,
        (event) => events.push(event),
      ),
      (error) => error?.reasonCode === failure.reasonCode,
    );
    assert.equal(fetchCount, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].classification, "primary");
    assert.equal(events[0].outcome, failure.reasonCode);
    assert.equal(events[0].retryDelayMs, 0);
  });
}

test("a transport close after every requested object does not waste the retry budget", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task);
    const value = { questions: task.slots.map(questionForSlot) };
    return requests.length === 1
      ? interruptedSseResponse(value, task.slots.length)
      : completionResponse(value);
  };

  const result = await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => events.push(event),
  );

  assert.deepEqual(
    requests.map((request) => request.slots.map((slot) => slot.ordinal)),
    [[1], [2], [3], [4], [5]],
  );
  assert.equal(result.metrics.retryCount, 0);
  assert.ok(events.every((event) => event.classification === "primary"));
  assert.equal(events[0].outcome, "complete");
  assert.equal(events[0].acceptedCount, events[0].requestedCount);
});

test("a partial transport failure preserves accepted questions and retries only the first missing slot", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const chunks = [];
  const events = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task);
    const value = { questions: task.slots.map(questionForSlot) };
    if (requests.length === 2) return interruptedBeforeQuestionCompletes(value);
    return completionResponse(value);
  };

  const result = await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
    (event) => events.push(event),
  );
  assert.deepEqual(
    requests.map((request) => request.slots.map((slot) => slot.ordinal)),
    [[1], [2], [2], [3], [4], [5]],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q1", "q2", "q3", "q4", "q5"],
  );
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(events.length, requests.length);
  assert.equal(events[1].acceptedCount, 0);
  assert.equal(events[1].outcome, "network_interrupted");
  assert.equal(events[2].classification, "automatic_retry");
});

test("stable prompt prefixes are byte-identical while suffix tasks evolve", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task.body);
    return responseForRequest(init.body);
  };
  await generateQuizFromPlainText(
    stableInput(5, ["multiple_choice"]),
    "sk-local-test",
  );
  assert.ok(requests.length > 1);
  for (const request of requests.slice(1)) {
    assert.deepEqual(request.messages[0], requests[0].messages[0]);
    assert.deepEqual(request.messages[1], requests[0].messages[1]);
  }
  assert.notEqual(
    requests[0].messages[2].content,
    requests[1].messages[2].content,
  );
  assert.match(
    requests[0].messages[1].content,
    /Complete plain-text lesson transcript/,
  );
  assert.match(requests[1].messages[2].content, /Already accepted questions/);
});

test("v5.1 continuation uses singleton automatic recovery on original metadata", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  const accepted = [
    {
      id: "q1",
      type: "multiple_choice",
      concept: "Supported concept 1",
      question: "How does supported concept 1 apply to scenario 1?",
    },
  ];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task.body);
    return responseForRequest(init.body);
  };
  const result = await generateQuizFromPlainText(
    {
      ...stableInput(),
      continuation: {
        startIndex: 1,
        resultProtocolVersion: 5,
        promptVersion: "quiz-local-json-stream-v5.1",
        validatorVersion: "validator-local-progressive-v4.0",
        generationProfile: "legacy_reasoning_v5_1",
        acceptedQuestions: accepted,
      },
    },
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => events.push(event),
  );
  assert.equal(result.protocolVersion, 5);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.1");
  assert.equal(result.validatorVersion, "validator-local-progressive-v4.0");
  assert.ok(requests.every((request) => request.thinking.type === "disabled"));
  assert.ok(requests.every((request) => !("reasoning_effort" in request)));
  assert.ok(requests.every((request) => request.temperature === 0.2));
  assert.ok(events.every((event) => event.classification === "primary"));
  assert.ok(events.every((event) => event.protocolVersion === 5));
  assert.ok(events.every((event) => event.purpose === "automatic_recovery"));
  assert.ok(events.every((event) => event.requestedCount === 1));
  assert.ok(events.every((event) => event.recoverySessionId === IDS.recovery));
});

test("Run 8 recovery preserves q1-q11 and classifies only attempted q12-q13 as retries", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];
  const chunks = [];
  const types = Array.from(
    { length: 15 },
    (_, index) => ["multiple_choice", "true_false", "short_answer"][index % 3],
  );
  const acceptedQuestions = types.slice(0, 11).map((type, index) => ({
    id: `q${index + 1}`,
    type,
    concept: `Immutable accepted concept ${index + 1}`,
    question: `How does immutable concept ${index + 1} work?`,
  }));
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => responseForRequest(init.body);

  const result = await generateQuizFromPlainText(
    {
      ...stableInput(15),
      generationProfile: "legacy_reasoning_v5_1",
      continuation: {
        startIndex: 11,
        resultProtocolVersion: 5,
        promptVersion: "quiz-local-json-stream-v5.1",
        validatorVersion: "validator-local-progressive-v4.0",
        generationProfile: "legacy_reasoning_v5_1",
        nextCallIndex: 7,
        nextOrdinalAttempt: 2,
        retryOrdinals: [12, 13],
        previousOutcome: "schema_invalid",
        automaticRetryCount: 0,
        retryBudgetUsedCount: 1,
        acceptedQuestions,
      },
    },
    "sk-local-test",
    () => undefined,
    undefined,
    (chunk) => chunks.push(chunk),
    (event) => events.push(event),
  );

  assert.equal(result.generatedStartIndex, 11);
  assert.deepEqual(
    chunks.map((chunk) => chunk.question.id),
    ["q12", "q13", "q14", "q15"],
  );
  assert.deepEqual(
    events.map((event) => event.classification),
    ["automatic_retry", "automatic_retry", "primary", "primary"],
  );
  assert.deepEqual(
    events.map((event) => event.callIndex),
    [7, 8, 9, 10],
  );
  assert.deepEqual(
    events.slice(0, 2).map((event) => event.retryKind),
    ["content_repair", "content_repair"],
  );
  assert.ok(events.every((event) => event.protocolVersion === 5));
  assert.ok(events.every((event) => event.purpose === "automatic_recovery"));
  assert.ok(
    acceptedQuestions.every(
      (question, index) => question.id === `q${index + 1}`,
    ),
  );
});

test("v5.3 recovery resumes the first server-missing singleton without a manual call", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  const seed = "a".repeat(64);
  const types = buildQuestionTypePlanFromSeed(["multiple_choice"], 5, seed);
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task);
    return responseForRequest(init.body);
  };

  const result = await generateQuizFromPlainText(
    {
      ...stableInput(5, ["multiple_choice"]),
      continuation: {
        startIndex: 1,
        resultProtocolVersion: 7,
        promptVersion: "quiz-local-json-stream-v5.3",
        validatorVersion: "validator-local-progressive-v4.2",
        generationProfile: "stable_auto_recovery_v5_3",
        questionPlan: { seed, types },
        nextCallIndex: 1,
        nextOrdinalAttempt: 1,
        automaticRetryCount: 0,
        acceptedQuestions: [
          {
            id: "q1",
            type: "multiple_choice",
            concept: "Stored first concept",
            question: "Which first result did the lesson support?",
          },
        ],
      },
    },
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => events.push(event),
  );

  assert.equal(result.protocolVersion, 7);
  assert.equal(result.generatedStartIndex, 1);
  assert.deepEqual(
    requests.map((request) => request.slots[0].ordinal),
    [2, 3, 4, 5],
  );
  assert.deepEqual(
    events.map((event) => event.callIndex),
    [1, 2, 3, 4],
  );
  assert.ok(events.every((event) => event.classification === "primary"));
  assert.ok(events.every((event) => event.recoverySessionId === IDS.recovery));
});

test("a disabled rollout can start a new bank on the v5.1 profile", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const task = taskFromRequest(init.body);
    requests.push(task.body);
    return responseForRequest(init.body);
  };
  const result = await generateQuizFromPlainText(
    {
      ...stableInput(),
      generationProfile: "legacy_reasoning_v5_1",
    },
    "sk-local-test",
  );
  assert.equal(result.protocolVersion, 5);
  assert.equal(result.promptVersion, "quiz-local-json-stream-v5.1");
  assert.equal(result.generationProfile, "legacy_reasoning_v5_1");
  assert.ok(requests.every((request) => request.thinking.type === "disabled"));
  assert.ok(requests.every((request) => !("reasoning_effort" in request)));
  assert.ok(requests.every((request) => request.temperature === 0.2));
});

test("10,000 seeded plans are balanced, reproducible, and avoid avoidable runs", () => {
  let observedRepeatedPolarity = false;
  for (let index = 0; index < 10_000; index += 1) {
    const seed = index.toString(16).padStart(64, "0");
    const types = buildQuestionTypePlanFromSeed(
      ["multiple_choice", "true_false", "short_answer"],
      15,
      seed,
    );
    assert.deepEqual(
      buildQuestionTypePlanFromSeed(
        ["multiple_choice", "true_false", "short_answer"],
        15,
        seed,
      ),
      types,
    );
    assert.equal(types[0], "multiple_choice");
    assert.ok(maxRun(types) <= 2);
    const counts = ["multiple_choice", "true_false", "short_answer"].map(
      (type) => types.filter((candidate) => candidate === type).length,
    );
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);

    const polarity = buildTrueFalseAnswerPlanFromSeed(types, seed).filter(
      (value) => typeof value === "boolean",
    );
    const trueCount = polarity.filter(Boolean).length;
    assert.ok(Math.abs(trueCount - (polarity.length - trueCount)) <= 1);
    assert.ok(maxRun(polarity) <= 2);
    if (maxRun(polarity) === 2) observedRepeatedPolarity = true;
  }
  assert.equal(observedRepeatedPolarity, true);
  assert.deepEqual(
    buildQuestionTypePlanFromSeed(["short_answer"], 5, "f".repeat(64)),
    Array(5).fill("short_answer"),
  );
});

test("adaptive chunk sizing is singleton-first and bounded by short answers", () => {
  assert.equal(adaptiveChunkQuestionCount(["multiple_choice"], 0), 1);
  assert.equal(
    adaptiveChunkQuestionCount(
      [
        "multiple_choice",
        "multiple_choice",
        "multiple_choice",
        "multiple_choice",
      ],
      1,
    ),
    3,
  );
  assert.equal(
    adaptiveChunkQuestionCount(
      ["multiple_choice", "short_answer", "multiple_choice", "true_false"],
      1,
    ),
    2,
  );
  assert.equal(boundedRetryDelayMilliseconds(1, 30_000), 30_000);
  assert.equal(boundedRetryDelayMilliseconds(1, 900_000), 300_000);
});
