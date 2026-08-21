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
  multipleChoiceOptionMatchesQuestionKind,
  multipleChoiceQuestionAnswerIsCoherent,
  questionConceptFailure,
  questionMatchesQuizLanguage,
  questionTestsTaughtConcept,
  repairMultipleChoiceQuestionKind,
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

test("v5.8 requires How-does choices to state an outcome or mechanism", () => {
  for (const [question, answer] of [
    [
      "How does the presence of interconnected species within an ecosystem contribute to its resilience?",
      "each packed with interconnected species",
    ],
    [
      "How does biodiversity contribute to an ecosystem's strength in the face of change?",
      "Biodiversity is built out of ecosystem, species, and genetic diversity.",
    ],
  ]) {
    assert.equal(
      multipleChoiceOptionMatchesQuestionKind(question, answer),
      false,
    );
    assert.equal(
      questionConceptFailure({
        concept: "ecosystem resilience",
        question,
        answerText: answer,
        explanation: "Biodiversity supports resilience.",
      }),
      "question_answer_kind_mismatch",
    );
  }

  for (const [question, answer] of [
    [
      "How does genetic diversity affect a species' vulnerability to environmental changes?",
      "Species with less genetic diversity are much more vulnerable to environmental change.",
    ],
    [
      "How do many organisms in a reef depend on coral?",
      "Coral provides shelter, breeding grounds, and microhabitats.",
    ],
    [
      "How does periodic position relate to recurring chemical properties?",
      "Elements in the same group share similar chemical properties.",
    ],
    [
      "How do herbivores such as tapirs and agoutis contribute to rainforest regeneration?",
      "They disperse seeds throughout the forest so new trees can grow.",
    ],
    [
      "How does coral support biodiversity?",
      "Corals form interdependent relationships with fungi and bacteria.",
    ],
  ]) {
    assert.equal(
      multipleChoiceOptionMatchesQuestionKind(question, answer),
      true,
    );
  }

  assert.equal(
    multipleChoiceOptionMatchesQuestionKind(
      "How can an ecosystem become vulnerable to collapse even without catastrophic events?",
      "they're actually vulnerable to collapse",
    ),
    false,
  );
  assert.equal(
    multipleChoiceOptionMatchesQuestionKind(
      "How can an ecosystem become vulnerable to collapse even without catastrophic events?",
      "Loss of biodiversity weakens resilience and can lead to collapse.",
    ),
    true,
  );
  assert.equal(
    multipleChoiceOptionMatchesQuestionKind(
      "How does biodiversity affect an ecosystem's ability to withstand change?",
      "biodiversity",
    ),
    false,
  );
  for (const [question, answer] of [
    [
      "What condition do liana vines provide for trees in the Amazon rainforest?",
      "growing thick wooden stems that support these towering trees",
    ],
    [
      "How do corals support other organisms in reef ecosystems?",
      "It provides key microhabitats, shelter, and breeding grounds.",
    ],
  ]) {
    assert.equal(
      questionConceptFailure({
        concept: "ecosystem support",
        question,
        answerText: answer,
        explanation: "The organisms support one another.",
      }),
      "question_answer_kind_mismatch",
    );
  }
});

test("v5.8 corrects only bounded caption spelling in a grounded answer", () => {
  const evidence =
    "A keystone organism is one that many others depend on for their suvival.";
  const candidate = {
    evidenceQuote: evidence,
    answerSpan: "one that many others depend on for their suvival",
    answerText: "one that many others depend on for their survival",
    distractors: [
      "one that is always the most abundant",
      "one that lives without other organisms",
      "one that appears only after a disturbance",
    ],
  };
  assert.deepEqual(groundedMultipleChoiceCandidate(candidate, evidence), {
    correctAnswer: candidate.answerText,
    distractors: candidate.distractors,
  });

  assert.deepEqual(
    groundedMultipleChoiceCandidate(
      {
        ...candidate,
        answerSpan: "one that many others depend on for their survival",
      },
      evidence,
    ),
    {
      correctAnswer: candidate.answerText,
      distractors: candidate.distractors,
    },
  );

  assert.equal(
    groundedMultipleChoiceCandidate(
      {
        ...candidate,
        answerSpan: "one that no others depend on for their survival",
        answerText: "one that no others depend on for their survival",
      },
      evidence,
    ),
    null,
  );

  assert.equal(
    groundedMultipleChoiceCandidate(
      {
        ...candidate,
        answerSpan: "one that many others depend on for their survival",
        answerText: "A keystone organism",
      },
      evidence,
    ),
    null,
    "a corrected private span must not authorize a different exact learner answer",
  );
});

test("v5.8 repairs an obvious caption plural locally", () => {
  const evidence =
    "Coral supports biodiversity in reef ecosystems. It provides key microhabitats, shelter and breeding grounds for thousand of species of fish, crustaceans and mollusks.";
  const candidate = {
    evidenceQuote: evidence,
    answerSpan:
      "It provides key microhabitats, shelter and breeding grounds for thousand of species of fish, crustaceans and mollusks",
    answerText:
      "It provides key microhabitats, shelter and breeding grounds for thousand of species of fish, crustaceans and mollusks",
    distractors: [
      "It reduces the number of species in the reef.",
      "It competes with every other species for resources.",
      "It provides food only for herbivorous fish.",
    ],
  };
  assert.deepEqual(groundedMultipleChoiceCandidate(candidate, evidence), {
    correctAnswer:
      "It provides key microhabitats, shelter and breeding grounds for thousands of species of fish, crustaceans and mollusks",
    distractors: candidate.distractors,
  });

  const quantifiedEvidence =
    "The survey covers one hundred of the selected wetland sites.";
  const quantifiedCandidate = {
    ...candidate,
    evidenceQuote: quantifiedEvidence,
    answerSpan: "one hundred of the selected wetland sites",
    answerText: "one hundred of the selected wetland sites",
  };
  assert.deepEqual(
    groundedMultipleChoiceCandidate(quantifiedCandidate, quantifiedEvidence),
    {
      correctAnswer: "one hundred of the selected wetland sites",
      distractors: candidate.distractors,
    },
  );
});

test("v5.8 rejects a Tetris presentation vehicle as the learner answer", () => {
  assert.equal(
    questionConceptFailure({
      question:
        "How does clearing forests affect Earth's ability to remove carbon?",
      concept: "deforestation and atmospheric carbon",
      answerText: "reducing Earth's ability to remove the blocks",
      explanation:
        "Clearing forests reduces Earth's ability to remove carbon from the atmosphere.",
    }),
    "low_pedagogical_value",
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
        "What happens when a keystone species threatens the entire fabric of the reef?",
      concept: "ecosystem interdependence",
      explanation: "Ecosystem interdependence supports resilience.",
    }),
    "low_pedagogical_value",
  );
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
  assert.equal(
    questionConceptFailure({
      question:
        "Is a regional anesthetic a chemical barricade that blocks pain signals?",
      concept: "regional anesthetic nerve-blocking mechanism",
      explanation:
        "Regional anesthetics block ion passage through nerve-membrane proteins.",
    }),
    "low_pedagogical_value",
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

test("v5.10 evidence selection spreads early ordinals across distinct concepts", () => {
  const transcript = [
    "Greenhouse gases absorb outgoing infrared radiation because their molecular vibrations interact with those wavelengths.",
    "Carbon dioxide slows heat loss when it absorbs infrared energy and emits part of that energy toward the surface.",
    "The resulting energy imbalance raises surface temperature until incoming and outgoing energy balance.",
    "Warmer ocean water expands because increased molecular motion occupies more volume.",
    "Thermal expansion raises sea level even when no additional water enters the ocean.",
    "Melting land ice adds water to the ocean and independently increases sea level.",
    "Ice reflects sunlight, whereas darker ocean water absorbs more incoming solar energy.",
    "Losing reflective ice creates a feedback because extra absorption causes additional warming.",
    "Climate sensitivity relates a sustained forcing change to the eventual global temperature response.",
    "Mitigation lowers future warming by reducing the greenhouse-gas emissions that create radiative forcing.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "Climate change",
    diverse: true,
  });

  assert.ok(selection.excerpts.length >= 5);
  assert.match(selection.excerpts[0], /feedback/iu);
  assert.match(selection.excerpts[1], /carbon dioxide|infrared/iu);
  assert.match(selection.excerpts[2], /thermal expansion|sea level/iu);
});

test("v5.11 evidence selection excludes sponsorship, disclaimers, and presentation scaffolding", () => {
  const transcript = [
    "This video is sponsored by Brilliant, where you can sign up for free and keep your skills sharp.",
    "The disclaimer shown here explains that the example is not legal advice.",
    "Ground News compares reporting outlets and highlights a Blind Spot across media conglomerates.",
    "To learn more about specialization in trade, click here.",
    "To test your knowledge of opportunity cost, click here.",
    "But the Revolution would not end there, as later events would show.",
    "Domain Name System resolvers translate human-readable host names into IP addresses so clients can locate servers.",
    "Caching a DNS response reduces repeated lookup latency until the record's time to live expires.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "Domain Name System",
    diverse: true,
    strictPromptFirst: true,
  });

  assert.ok(selection.excerpts.length >= 1);
  assert.match(selection.excerpts.join(" "), /resolvers|caching|lookup/iu);
  assert.doesNotMatch(
    selection.excerpts.join(" "),
    /Brilliant|sign up|disclaimer|Ground News|Blind Spot|media conglomerates|click here|would not end there/iu,
  );
});

test("v5.12 excludes subscription promotions and presenter quotations", () => {
  const transcript = [
    "Sediment accumulates because a reservoir slows the river and reduces its carrying capacity.",
    "A low-level outlet can pass turbid water downstream when sediment reaches the dam.",
    "Click the link below and get 40% off an annual plan on Nebula.",
    "A lifetime membership lets viewers support what I am doing without another monthly cost.",
    "To quote Seneca the Younger, silk clothing did not hide the body or decency.",
    "Silk Road wealth increased merchant political power and shaped governance.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "dam sediment and Silk Road governance",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  const selected = `${selection.excerpts.join(" ")} ${selection.primaryClaims.join(" ")}`;
  assert.match(selected, /sediment|merchant political power/iu);
  assert.doesNotMatch(
    selected,
    /40%|annual plan|Nebula|lifetime membership|monthly cost|quote Seneca/iu,
  );
});

test("v5.12 splits oversized caption sentences into distinct prompt facts", () => {
  const transcript = [
    "A hash algorithm converts an input into a fixed-size digest that can verify file integrity and the avalanche effect makes a one-bit change produce a very different digest while preimage resistance prevents recovery of the original input and collision resistance makes matching outputs difficult and a download-site hash cannot prove safety when an attacker can replace both the program and digest",
    "Hash speed must be balanced because extremely slow processing is impractical while an excessively fast password hash helps brute-force attacks",
    "This episode is brought to you by Audible and you can click the link below for a free book and support the channel",
    "A check digit depends on all earlier digits and detects common typing errors",
    "Salt gives otherwise identical passwords different stored hash values",
    "Key stretching increases the computation required for every password guess.",
  ].join(". ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "hash algorithms and security",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  assert.ok(selection.primaryClaims.length >= 4);
  const selected = `${selection.excerpts.join(" ")} ${selection.primaryClaims.join(" ")}`;
  assert.match(selected, /avalanche|preimage|collision|check digit|salt/iu);
  assert.doesNotMatch(selected, /Audible|free book|support the channel/iu);
});

test("v5.12 deprioritizes incidental history and publicity outside history topics", () => {
  const transcript = [
    "In 132 CE, Zhang Heng presented the Han court with an early seismoscope.",
    "Primary seismic waves travel faster than destructive secondary waves.",
    "A distributed sensor network can detect primary waves and provide warning before stronger shaking arrives.",
    "The public did not learn about the engineering problem until 1995, when a New Yorker article revealed the story.",
    "Diagonal structural braces transfer wind loads into the building columns.",
    "A tuned mass damper reduces sway by moving out of phase with the building.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "earthquake warning and structural engineering",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  assert.match(
    selection.primaryClaims.join(" "),
    /primary waves|wind loads|reduces sway/iu,
  );
  assert.doesNotMatch(
    selection.primaryClaims.join(" "),
    /132 CE|Han court|public did not learn|New Yorker article/iu,
  );
});

test("v5.12 removes narrative trivia before assigning assessment facts", () => {
  const transcript = [
    "The court was skeptical when an earthquake device triggered on a seemingly quiet afternoon.",
    "Primary seismic waves arrive before more destructive secondary waves.",
    "The term organic chemistry was coined by the Swedish chemist Jons Jacob Berzelius.",
    "Carbon atoms form stable chains and rings because each carbon can make four covalent bonds.",
    "A healthy immune system fights off an estimated 300 colds over a lifetime.",
    "A typical immune response clears a threat within a few days.",
    "Leukocytes identify and eliminate pathogens through coordinated innate and adaptive responses.",
    "Everything he did next was top secret, and crews worked night-time shifts without warning the public.",
    "Officials planned an emergency evacuation, but the hurricane veered out to sea.",
    "The engineering team worked with city officials to craft a confidential plan.",
    "An undergraduate architecture thesis stumbled on a potentially deadly mistake in one of the world's tallest buildings.",
    "The sloped roof was unique in the city skyline.",
    "Wealthfront is an automated investment platform that helps you build a portfolio and grow your money.",
    "Nitrous oxide became popular in the decades that followed and is still used today.",
    "- [Narrator] What if I told you that the earth below you is moving?",
    "This video is part of a series; check the playlist linked in the card.",
    "We're standing on a planet spinning on its axis while our solar system is circling the center of the galaxy.",
    "It is like hiring a financial manager for a quarter-percent annual advisory fee; give it a try at the link in the description.",
    "Support our sponsors and the channel, and thank you for watching.",
    "Rather than make a single video overview like other channels, we are taking a deep dive.",
    "Water gets along with nearly every substance on earth.",
    "The science of chemistry is the science of everything.",
    "Some people do not metabolize betanin, so their urine and feces turn purple.",
    "Intravenous anesthesia was developed in the 1870s after the first common anesthetic.",
    "A quick browser demonstration clicks the padlock to view the certificate.",
    "The padlock icon in the browser address bar means the connection is secure.",
    "In ancient Rome, people sold their urine to dyers.",
    "Join our Patreon community to keep Crash Course free.",
    "Legend has it that Galvani touched a frog nerve with metal.",
    "The brain's electrical signals form a chaotic chorus.",
    "Beets are high in betanin, a dye that gives them a lovely purple color.",
    "In this episode we talked about how Romans soaked their fabrics in urine dye; next time we'll cover nomenclature.",
    "Your phone gives a final plaintive bleep, and you feel like throwing the battery instead of praising its freedom from an infernal tangle of power cables.",
    "The most telling signs may be invisible to all these sensors.",
    "Another kind of plate movement is called a divergent boundary.",
    "Since the 1700s, scientists have improved on Volta's design.",
    "A deeper view could save tens of thousands of lives each year.",
    "Plates move about as fast as your fingernails grow.",
    "Of course, none of these technologies would be as helpful as simply looking deep inside the Earth itself.",
    "For now these technologies help without waiting for directions from a vase.",
    "The Himalayas grow by more than one centimeter each year because the plates are still colliding.",
    "Continental collision lifts the Eurasian plate and creates the Himalayan mountain range.",
    "Tectonic plates spread slowly at 1 to 20 centimeters per year.",
    "This causes the plates to spread very slowly, at anywhere from 1 to 20 centimeters per year.",
    "Just imagine if the continents were still connected today.",
    "A mixture of white and black sand separates as the white sand settles faster.",
    "Grasping reaction logic is a central part of understanding organic chemistry.",
    "Expending one battery to charge another is worse than plugging a charger into the wall.",
    "Because the asthenosphere is also pretty solid, plates rest on top of it.",
    "In the early 1800s, people extracted therapeutic chemicals from medicinal plants.",
    "Galvani believed electricity was stored in living tissue, while Volta argued that metal caused the twitch.",
    "Gravity is the first line of defense in the fight against dirty water.",
    "I sifted the white sand and combined both sands for a sand mixture demonstration.",
    "Plugging your charger into the wall is your best bet to forestall a dead battery.",
    "The circular ponds have a simple but crucial responsibility in the process of treating wastewater.",
    "I'm Grady, and this is Practical Engineering. In today's episode we're talking about settlement.",
    "Today we no longer rely on pots, but earthquakes still offer a unique challenge to those tracking them.",
    "I hope you're just as excited as I am; we're going to learn so much together.",
    "The power e d minus one simplifies to one by Fermat's little theorem.",
    "He thought the reaction was happening in the copper rather than the solution.",
    "The vase indicated the direction they should send aid.",
    "When messengers came for help days later, their doubts turned to gratitude.",
    "Each plate rides on a hot partially molten layer of Earth's mantle.",
    "One of the three magic numbers is public in this RSA example.",
    "Glass, rocks, minerals, and gems other than diamonds are excluded.",
    "Even the best batteries will diminish daily, losing capacity until they die.",
    "Treating organic chemistry problems like a puzzle can help make sense of them.",
    "In the 1840s, doctors started sedating patients with ether during dental extractions.",
    "We honor Volta's discovery by naming the standard unit of electric potential the volt.",
    "How do batteries even store so much charge in the first place?",
    "Autoimmune diseases trick the immune system into attacking healthy cells.",
    "The di in divergent comes from a Latin prefix meaning apart.",
    "Who gets to make decisions for others and on what authority?",
    "Nobody else can know the secret magic numbers or the magic value.",
    "Cryptography of course yet his results are very useful today.",
    "Without the immune system, those threats would escalate; we owe it our lives.",
    "The next time you catch a cold or scratch a mosquito bite, think of the immune system.",
    "I will offer a fully funded PhD and a guaranteed doctorate position.",
    "Where did the magic number come from, and how does the computation work or reverse the operation?",
    "There are three questions we can ask when we see this equation.",
    "On a 12-hour clock, subtracting one hour wraps around to 11.",
    "Everyday batteries die after hundreds of discharge-recharge cycles, while advanced ones last thousands of cycles.",
    "When B- and T-cells identify antigens, the cells can swiftly deploy the right antibodies later.",
    "Napoleon took charge as a general and became Emperor while claiming to defend democratic values.",
    "Marie Antoinette was executed nine months after the king's execution.",
    "Future batteries may be light thin sheets based on quantum physics and last hundreds of thousands of charge cycles.",
    "It is not always easy to determine whether a given large number is prime.",
    "Mike Pound spoke about this in an interesting video on this channel; watch it.",
    "We see RSA everywhere when connecting to the internet.",
    "Napoleon Bonaparte, a general who rose to power, took charge and became Emperor.",
    "The Diffie-Hellman key exchange is covered in another video.",
    "e b minus 1 is a multiple of both prime numbers minus 1, so we apply Fermat's little theorem.",
    "On a 91-hour clock, raising to the power of 5 and then the power of 29 returns the original.",
    "For each of them individually we can apply a theorem known as.",
    "You could drive from Africa to Antarctica or take a train from South America to Europe.",
    "Volta disagreed about what made the leg twitch, and his groundbreaking experiment settled the debate.",
    "Zhang Heng's seismoscope dropped a ball from a dragon mouth to indicate direction to the Han court.",
    "Tectonic plates are solid, and they're denser and cooler than the asthenosphere.",
    "The Revolution produced three constitutions and five governments before the next Republic formed in 1871.",
    "Okay, maybe slide is not the best word because plates don't move in one continuous motion.",
    "The tower was a skyscraper in midtown Manhattan with a one-in-sixteen annual storm chance.",
    "Covert construction went unnoticed because the press was occupied with a newspaper strike.",
    "The work was halfway complete when Hurricane Ella approached.",
    "A tuned mass damper reduces building sway by moving out of phase with the structure.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "earthquakes organic chemistry immunity structural engineering",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  const selected = `${selection.excerpts.join(" ")} ${selection.primaryClaims.join(" ")}`;
  assert.match(
    selected,
    /primary seismic waves|covalent bonds|Leukocytes|mass damper/iu,
  );
  assert.doesNotMatch(
    selected,
    /court was skeptical|coined by|estimated 300 colds|within a few days|top secret|night-time shifts|warning the public|confidential plan|undergraduate architecture thesis|world's tallest|sloped roof|Wealthfront|portfolio|advisory fee|link in the description|sponsors|single video overview|other channels|water gets along|science of everything|metabolize betanin|urine and feces|developed in the 1870s|first common anesthetic|browser demonstration|padlock|secure connection|certificate|ancient Rome|sold their urine|fabrics in urine dye|Patreon|Crash Course|Legend has it|chaotic chorus|betanin|lovely purple|in this episode|next time|plaintive bleep|throwing the battery|infernal tangle|all these sensors|another kind|since the 1700s|tens of thousands|fingernails|one centimeter|1 to 20 centimeters|still connected today|white and black sand|central part of understanding|expending one battery|charger into the wall|pretty solid|early 1800s|Galvani believed|Volta argued|first line of defense|sifted the white sand|sand mixture demonstration|best bet to forestall|simple but crucial responsibility|none of these technologies|looking deep inside|directions from a vase|Zhang Heng|seismoscope|dragon mouth|Han court|denser and cooler than the asthenosphere|three constitutions|five governments|Republic formed in 1871|best word|continuous motion|became popular|still used today|Narrator|what if I told you|video is part|playlist|standing on a planet|solar system|emergency evacuation|hurricane veered|midtown Manhattan|one-in-sixteen|covert construction|newspaper strike|halfway complete/iu,
  );
});

test("v5.12 assigns continental-connection evidence only once", () => {
  const transcript = [
    "Matching coastlines indicate that continents were once connected and later moved apart.",
    "The continents were once joined in a supercontinent called Pangea.",
    "The lithosphere includes the crust and upper mantle and is divided into tectonic plates.",
    "Gravity is a key driver of tectonic plate motion.",
    "Convergent boundaries form where plates move toward one another.",
    "Divergent boundaries form where plates move apart.",
    "Transform boundaries form where plates slide past one another.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "plate tectonics",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  const connectionClaims = selection.primaryClaims.filter((claim) =>
    /coastlines|pangea|supercontinent/iu.test(claim),
  );
  assert.equal(connectionClaims.length, 1);
  assert.ok(selection.primaryClaims.length >= 4);
});

test("v5.12 assigns gravity sedimentation only once", () => {
  const transcript = [
    "Mixed liquor moves through a clarifier and particles settle into a sludge layer.",
    "Large sand particles settle faster than small sand particles in a water column.",
    "Particles denser than water settle downward due to gravity.",
    "Increasing a basin's cross-sectional area lowers flow velocity at constant flow rate.",
    "Charged fine particles repel one another until coagulants neutralize the charge.",
    "Settling time determines the required basin size and construction cost.",
    "A weir controls the clarified water leaving the basin.",
    "Biological treatment uses microorganisms to consume dissolved organic matter.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "wastewater treatment engineering",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  const settlingClaims = selection.primaryClaims.filter((claim) =>
    /(?:sand|particles?|sludge|clarifier).*(?:settle|settling|sludge layer)|(?:settle|settling).*(?:sand|particles?|sludge|clarifier)/iu.test(
      claim,
    ),
  );
  assert.equal(settlingClaims.length, 1);
  assert.ok(selection.primaryClaims.length >= 5);
});

test("v5.12 assigns the battery external-circuit relationship only once", () => {
  const transcript = [
    "An oxidation-reduction cycle creates a flow of electrons that powers a connected device.",
    "Connecting a device between the electrodes routes electrons through the external circuit.",
    "Repeated cycling creates surface imperfections that eventually stop useful oxidation.",
    "Zinc oxidation transfers electrons to ions in the electrolyte.",
    "Battery capacity gradually decreases over time.",
    "Rechargeable cells reverse part of the chemical reaction when external energy is applied.",
    "Electrolytes transport ions between the electrodes.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "battery electrochemistry",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  const circuitClaims = selection.primaryClaims.filter((claim) =>
    /(?:external circuit|connected device|device between the electrodes|powers? a device)/iu.test(
      claim,
    ),
  );
  assert.equal(circuitClaims.length, 1);
  assert.ok(selection.primaryClaims.length >= 5);
});

test("v5.12 assigns battery surface degradation only once", () => {
  const transcript = [
    "Repeated charge-discharge cycles create imperfections and irregularities in the metal surface that prevent it from oxidizing properly.",
    "The electrons are no longer available to flow through a circuit and the battery dies.",
    "Over time, repetition creates imperfections and irregularities in the metal's surface that prevent it from oxidizing properly.",
    "A metal oxidizes and releases electrons through the external circuit.",
    "The electrolyte transports ions between the two electrodes.",
    "A charger supplies external energy that reverses part of the chemical reaction.",
    "The substance being reduced accepts electrons released by the oxidized metal.",
    "A separator prevents direct contact between electrodes while allowing ion transport.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "battery electrochemistry",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  const degradationClaims = selection.primaryClaims.filter((claim) =>
    /surface (?:imperfections?|irregularities?)|(?:imperfections?|irregularities?).{0,80}metal(?:['’]s)? surface|no longer available to flow|battery dies?/iu.test(
      claim,
    ),
  );
  assert.equal(degradationClaims.length, 1);
  assert.ok(selection.primaryClaims.length >= 5);
});

test("v5.12 assigns the rechargeable-cell reversal mechanism only once", () => {
  const transcript = [
    "A charger drives the reaction in reverse and regenerates the electrode metal.",
    "Electrons can flow back in the opposite direction with the application of electricity.",
    "Oxidation releases electrons into the external circuit.",
    "Reduction accepts electrons after useful work is performed.",
    "The electrolyte transports ions between electrodes.",
    "Surface imperfections eventually prevent proper oxidation.",
    "A separator prevents direct electrode contact while allowing ions through.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "rechargeable battery electrochemistry",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  const rechargeClaims = selection.primaryClaims.filter((claim) =>
    /reaction in reverse|regenerates? the electrode metal|electrons? can flow back in the opposite direction/iu.test(
      claim,
    ),
  );
  assert.equal(rechargeClaims.length, 1);
  assert.ok(selection.primaryClaims.length >= 5);
});

test("v5.12 excludes presenter-history framing around an otherwise technical battery example", () => {
  const transcript = [
    "He tested his idea with alternating zinc and copper layers separated by salt-water-soaked paper.",
    "Alternating metal electrodes and an ion-conducting electrolyte create an electrochemical cell.",
    "Oxidation releases electrons that travel through the external circuit.",
    "Reduction accepts the electrons after they have done useful work.",
    "A charger supplies energy that reverses part of the chemical reaction.",
    "Surface imperfections gradually prevent the electrode metal from oxidizing properly.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "battery electrochemistry",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  assert.doesNotMatch(selection.primaryClaims.join(" "), /tested his idea/iu);
  assert.match(
    selection.primaryClaims.join(" "),
    /electrochemical cell|oxidation releases electrons/iu,
  );
});

test("v5.12 keeps the sentence that resolves a hypothetical axis convention", () => {
  const transcript = [
    "People often talk about changing price and observing how quantity demanded changes.",
    "In most mathematics and science, the variable being changed normally goes on the horizontal axis.",
    "If I controlled the economics convention, I would plot price on the horizontal axis.",
    "But economics typically plots price on the vertical axis and quantity demanded on the horizontal axis.",
    "A demand curve connects price and quantity-demanded points from a demand schedule.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "law of demand",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  const horizontalWindows = selection.excerpts.filter((excerpt) =>
    /price on the horizontal axis/iu.test(excerpt),
  );
  assert.ok(horizontalWindows.length >= 1);
  assert.ok(
    horizontalWindows.every((excerpt) =>
      /economics typically plots price on the vertical axis/iu.test(excerpt),
    ),
  );
});

test("v5.11 evidence selection deduplicates repeated primary claims", () => {
  const transcript = [
    "A DNS resolver translates a domain name into an IP address so a client can locate a server.",
    "The client first checks its local DNS cache before contacting a resolver.",
    "A recursive resolver queries other DNS servers when its cache has no usable answer.",
    "A DNS resolver translates a domain name into an IP address so a client can locate a server.",
    "Authoritative name servers return records for domains they manage.",
    "Time to live determines how long a cached DNS record remains reusable.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "Domain Name System",
    diverse: true,
    strictPromptFirst: true,
  });

  assert.ok(selection.excerpts.length >= 4);
  assert.equal(
    selection.excerpts.filter((excerpt) =>
      excerpt.startsWith("A DNS resolver translates a domain name"),
    ).length,
    1,
  );
});

test("v5.12 selects a complete named claim instead of a vague lead sentence", () => {
  const transcript = [
    "Using these tools, scientists found a pattern spanning hundreds of millions of years.",
    "The Wilson Cycle predicts how continents diverge and reassemble.",
    "Plate motion gradually changes the arrangement of continents.",
    "Magnetic minerals record the field present when molten rock cools.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "Continental drift",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const index = selection.primaryClaims.findIndex((claim) =>
    /Wilson Cycle/iu.test(claim),
  );
  assert.ok(index >= 0);
  assert.match(selection.primaryClaims[index], /Wilson Cycle/iu);
});

test("v5.12 keeps punctuation-free caption fragments in source order", () => {
  const transcript = Array.from(
    { length: 36 },
    (_, index) =>
      `marker${String(index + 1).padStart(2, "0")} transfers energy through a distinct pathway because the mechanism changes the system state`,
  ).join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "energy pathways",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  assert.ok(selection.excerpts.length >= 1);
  for (const excerpt of selection.excerpts) {
    const markers = [...excerpt.matchAll(/marker(\d{2})/gu)].map((match) =>
      Number(match[1]),
    );
    assert.deepEqual(
      markers,
      [...markers].sort((left, right) => left - right),
    );
  }
  const firstFiveMarkerSets = selection.excerpts
    .slice(0, 5)
    .map(
      (excerpt) =>
        new Set(
          [...excerpt.matchAll(/marker(\d{2})/gu)].map((match) => match[1]),
        ),
    );
  for (let left = 0; left < firstFiveMarkerSets.length; left += 1) {
    for (let right = left + 1; right < firstFiveMarkerSets.length; right += 1) {
      assert.ok(
        [...firstFiveMarkerSets[left]].filter((marker) =>
          firstFiveMarkerSets[right].has(marker),
        ).length <= 2,
        "early punctuation-free assessment windows do not substantially reuse caption fragments",
      );
    }
  }
  assert.ok(
    selection.primaryClaims.every((claim, index) =>
      selection.excerpts[index].includes(claim),
    ),
    "each bounded primary fact remains inside its chronological context window",
  );
});

test("v5.12 keeps a punctuation-free contrast clause complete", () => {
  const transcript = [
    "machine learning spots outliers when an observed sequence breaks its expected pattern and this supports cyber security analysis",
    "a foundation model can be a large language model where preceding word patterns help predict what comes next",
    "autocomplete predicts the next word except in this case with large language models they are not predicting only the next word",
    "they predict the next sentence the next paragraph and the next document",
    "generative models recombine learned patterns into new arrangements while deep learning uses many neural network layers",
    "those layers can make the path from inputs to outputs difficult to trace",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "AI and machine learning",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const contrastWindow = selection.excerpts.find((excerpt) =>
    /autocomplete predicts the next word/iu.test(excerpt),
  );
  assert.ok(contrastWindow);
  assert.match(contrastWindow, /not predicting only the next word/iu);
  assert.match(contrastWindow, /next sentence the next paragraph/iu);
});

test("v5.12 excludes presentation-heavy AI introduction captions", () => {
  const transcript = [
    "Everybody's talking about artificial intelligence, and I actually did a video about it before reading the comments.",
    "I want to address frequently asked questions since that video was recorded because AI is taking over the world.",
    "Machine learning detects outliers when an observed sequence breaks its expected pattern.",
    "Deep learning uses multiple neural-network layers to transform inputs into outputs.",
    "Training data lets a model learn patterns without every behavior being explicitly programmed.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "AI and machine learning",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const selectedText = selection.excerpts.join(" ");
  assert.doesNotMatch(
    selectedText,
    /did a video|reading the comments|frequently asked questions|taking over the world/iu,
  );
  assert.match(
    selectedText,
    /detects outliers|multiple neural-network layers/iu,
  );
});

test("v5.12 excludes explicit presentation analogies from assessment windows", () => {
  const transcript = [
    "Let me give you an analogy about musical notes and songs.",
    "Machine learning detects outliers when an observed sequence breaks its expected pattern.",
    "Deep learning uses multiple neural-network layers to transform inputs into outputs.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "AI and machine learning",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const selectedText = selection.excerpts.join(" ");
  assert.doesNotMatch(selectedText, /analogy|musical notes|songs/iu);
  assert.match(
    selectedText,
    /detects outliers|multiple neural-network layers/iu,
  );
});

test("v5.12 deprioritizes explicitly simplified or disputed claims", () => {
  const transcript = [
    "For the sake of simplicity, some people have made the argument that the system predicts an entire document instead of the next token.",
    "Machine learning detects outliers when an observed sequence breaks its expected pattern.",
    "Deep learning uses multiple neural-network layers to transform inputs into outputs.",
    "Training data lets a model learn recurring patterns without every behavior being explicitly programmed.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "AI and machine learning",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  assert.doesNotMatch(
    selection.primaryClaims[0],
    /entire document|next token/iu,
  );
  assert.match(
    selection.primaryClaims[0],
    /detects outliers|multiple neural-network layers|learn recurring patterns/iu,
  );
});

test("v5.12 excludes learning advice, compressed chronology, and site trivia", () => {
  const transcript = [
    "A central part of understanding organic chemistry is grasping the logic behind molecular structures and reaction mechanisms.",
    "Carbon catenation is the ability of carbon atoms to form stable bonds with other carbon atoms.",
    "The king was publicly beheaded, finalizing the September declaration of the republic.",
    "The Third Estate declared itself the National Assembly after its demand for fair representation failed.",
    "The construction site was already occupied by a church, so the skyscraper stood on columns like stilts.",
    "A tuned mass damper moves a counterweight opposite the building's sway to reduce motion.",
    "In the biblical story of the Tower of Babel, humanity suddenly split into groups unable to understand one another.",
    "Until our next transmission, I'm Ellie Astrocyte. Over and out.",
    "Michael Faraday studied electrical materials, laying the groundwork for future advancements in semiconductor physics.",
    "A bottle carried by the California Current travels south toward the Baja Peninsula.",
    "The Coriolis effect strengthens because Earth's rotational speed rapidly slows down toward the poles.",
    "The Coriolis effect deflects some surface currents depending on their latitude.",
    "Doping introduces impurity atoms that change the concentration of mobile charge carriers.",
    "The discovery of semiconductor materials dates back to the early 19th century.",
    "The inflation numbers were so high that they were difficult to comprehend.",
    "Memory helps us tie our shoes, walk to school, drive a car, and remember loved ones.",
    "Global currents raise responsibility for cleaning marine debris in international waters.",
    "Bardeen, Brattain, and Shockley invented the transistor at Bell Labs in 1947.",
    "We couldn't do all of this without your support.",
    "Earth rotates fastest at the equator and slower toward the poles.",
    "What do all these things have in common?",
    "Economists have come around to the view that a little bit of inflation is good.",
    "In the 1960s the roles of different brain regions were largely unknown.",
    "The reaction shifts in the other direction because there is less heat here.",
    "No moving parts, no fuss, no muss, no maintenance needed.",
    "The young children wander away from their parents to play in the park.",
    "To explain it very simply, let's say you step on a sharp stick.",
    "Scientists develop new antibiotics to stay one step ahead of bacteria.",
    "Not all sore throats are strep, but strep throat is caused by bacteria.",
    "I'll do a whole video on that because it is interesting.",
    "This area right here, from here to here, is called the renal cortex.",
    "Neurons and skeletal muscle cells are involved in reaction time with the ruler.",
    "Reaction time is the time it takes to respond to a stimulus.",
    "The different parts of the kidney will be important when we discuss its functions later.",
    "Immune system cells work together against the constant threat of pathogens.",
    "An overview of all the major body systems is nice, but something remarkable happens when you explore one system.",
    "Cells in your body work day and night together against the constant threat of pathogens.",
    "This popular lab drops a ruler to make a rough calculation of your reaction time.",
    "Reaction time is how long it takes you to react to some stimulus.",
    "The mathematics gets complicated, but let's say the new concentration of A is 3 molar.",
    "If I have a container—nope, too shocking.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "chemistry, revolution, and structural engineering",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const selectedText = selection.excerpts.join(" ");
  assert.doesNotMatch(
    selectedText,
    /central part of understanding|beheaded, finalizing|site was already occupied|Tower of Babel|Ellie Astrocyte|laid the groundwork|bottle carried|rotational speed rapidly slows|Coriolis effect deflects|discovery of semiconductor|difficult to comprehend|tie our shoes|cleaning marine debris|invented the transistor|without your support|Earth rotates fastest|things have in common|come around to the view|roles of different brain regions|other direction|no fuss|young children|sharp stick|stay one step ahead|sore throats|whole video|area right here|reaction time|parts of the kidney|constant threat of pathogens|overview of all the major body systems|popular lab|new concentration of A|too shocking/iu,
  );
  assert.match(
    selectedText,
    /carbon catenation|National Assembly|tuned mass damper|mobile charge carriers/iu,
  );
});

test("v5.12 removes credits, classroom setup, meta-science, and misleading fragments", () => {
  const transcript = [
    "Crash Course is produced and directed by Stan Muller, and our script supervisor is Danica Johnson.",
    "No it's Gaius, I know from Battlestar Galactica.",
    "Scientists are still trying to figure out even basic things about black holes.",
    "The sea floor is perhaps the most unexplored part of our planet.",
    "Buckle up, because this is wow.",
    "Light near the horizon would be infinitely redshifted and lose all its energy trying to leave.",
    "Class, we have something important to talk about today.",
    "What things would you like to see on a new playground: swings, slides, and climbing ropes?",
    "The kids shared their playground ideas and the school board recognized the scarcity problem.",
    "We measured the land and found out how much space each playground want will take.",
    "A B cell has close to 10,000 receptor proteins on its surface.",
    "Actually, close to 10,000 of them.",
    "(MS. MESZAROS) The school board has been trying to decide what to do with it.",
    "We haven't solved the problem of what happens when things infiltrate cells or we have cancer cells. How do we kill cells that have clearly gone astray?",
    "Check out one of these videos for more lessons.",
    "I think that's a problem we should think about.",
    "You all know there's an empty lot next to our school. Who owns that land?",
    "Great job everyone! What are some things you'd like to see on a new playground?",
    "What equipment should be on the playground? What kind of playground should it be?",
    "I think we have a scarcity problem.",
    "to overcome the attraction between the atoms and force them apart",
    "Scarcity exists when available resources cannot satisfy every want.",
    "Opportunity cost is the next-best alternative forgone when a choice is made.",
    "Breaking a chemical bond requires energy, while forming a bond releases energy.",
    "A black hole's tidal force differs across an object because gravity is stronger on the near side than on the far side.",
    "A massive star can form a stellar-mass black hole when its core collapses.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "scarcity chemistry and black holes",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const selected = `${selection.excerpts.join(" ")} ${selection.primaryClaims.join(" ")}`;

  assert.match(
    selected,
    /Scarcity exists|Opportunity cost|Breaking a chemical bond|tidal force|core collapses/iu,
  );
  assert.doesNotMatch(
    selected,
    /produced and directed|script supervisor|Battlestar|still trying to figure out|most unexplored|Buckle up|infinitely redshifted|playground|10,000|decide what to do|gone astray|check out|problem we should think|empty lot|owns that land|great job|scarcity problem|MESZAROS|to overcome the attraction/iu,
  );
});

test("v5.12 removes worked-example, ambiguous-prevalence, and uncertain-science narration", () => {
  const transcript = [
    "A narrowing in the water-pipe analogy is analogous to electrical resistance.",
    "You might want to review the video on unit conversion. How many seconds are there in an hour? There are 3,600.",
    "Most of the aquatic ecosystems are marine and freshwater is a small subset.",
    "I wonder if magnesium was first discovered in Magnesia. Anyway, enough about Magnesia.",
    "Magnetism is a new fundamental force of the universe.",
    "The naming of Earth's magnetic poles gets a little confusing, so take Earth out of the equation.",
    "A common misconception shows a primitive ancestor becoming a sophisticated modern organism.",
    "Steam coming off microwave-heated food is water vapor.",
    "Water on Earth is older than the dinosaurs.",
    "The average velocity is 67 and one half, something like that.",
    "The acceleration is equal to 1.93 divided by 6.84.",
    "Resistance is denoted with the capital letter R.",
    "The probability of getting zero tails is the same as the probability of getting zero heads.",
    "Think about what it needs to be transmitted through. They can travel through vacuum and through Earth's atmosphere.",
    "As I mentioned, transmission isn't just about light waves.",
    "And then, of course, the light will get to that sand particle.",
    "The clearest way of protecting your IP address is to use a virtual private network.",
    "IP addresses are harder to hide than cookies.",
    "There was a Defense of Marriage Act, and recently the Supreme Court struck that down.",
    "Direct modification of genes for a purpose began in the 1970s.",
    "A genome modification is inherited by all offspring and enters the gene pool.",
    "This whole process releases energy, similar to how firewood releases energy as it burns.",
    "Ohm's law states that voltage equals current multiplied by resistance.",
    "A community contains all populations living in the same area.",
    "The mode is the value that appears most frequently in a data set.",
    "Natural selection changes a population when heritable traits affect survival and reproduction.",
    "Evaporation moves liquid water into the atmosphere as water vapor.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "circuits ecosystems statistics evolution water cycle",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const selected = `${selection.excerpts.join(" ")} ${selection.primaryClaims.join(" ")}`;
  const primaries = selection.primaryClaims.join(" ");

  assert.match(
    selected,
    /Ohm's law|community contains|mode is the value|Natural selection|Evaporation/iu,
  );
  assert.doesNotMatch(
    selected,
    /water-pipe analogy|aquatic ecosystems are marine|Magnesia|new fundamental force|gets a little confusing|primitive ancestor|Steam coming off|older than the dinosaurs|something like that|1\.93 divided by 6\.84|capital letter R|zero tails is the same|Think about what it needs|As I mentioned|sand particle|clearest way|harder to hide|Defense of Marriage Act|Direct modification of genes|inherited by all offspring|firewood releases energy/iu,
  );
  assert.doesNotMatch(primaries, /unit conversion|3,600/iu);
});

test("v5.12 never promotes unresolved caption fragments to primary facts", () => {
  const selection = buildConceptFirstInstructionalSelection(
    [
      "Closer to that end of the spectrum, the reds and yellows are getting through, which means",
      "Transmission depends on the wavelength of light and the material it passes through.",
      "They're gonna stay in the middle and be shared between the two atoms.",
      "Equal electronegativity causes bonding electrons to be shared equally.",
      "A lot of times my kids are in other parts of the house making noise.",
      "Sound crosses a solid wall when air particles make the wall particles vibrate.",
      "Into each other, and then the particles on the other side of the wall will bump into the air.",
      "The vibrating wall particles transfer the sound disturbance to air on the other side.",
      "We could call everything outside the system the surroundings.",
      "Everything outside the selected thermodynamic system is its surroundings.",
      "And to help us visualize that, let me set up a little table here.",
      "Marginal factor cost is the additional cost of hiring one more unit of labor.",
      "And frankly, the P-wave shadow is visible on the other side of Earth.",
      "P-wave refraction patterns reveal boundaries inside Earth.",
    ].join(" "),
    {
      topicHint: "wave transmission and electronegativity",
      diverse: true,
      strictPromptFirst: true,
      coherentPromptFirst: true,
    },
  );
  const primaries = selection.primaryClaims.join(" ");

  assert.match(
    primaries,
    /Transmission depends|Equal electronegativity|Sound crosses|vibrating wall particles|Everything outside the selected|Marginal factor cost|P-wave refraction patterns/iu,
  );
  assert.doesNotMatch(
    primaries,
    /Closer to that end|They're gonna|A lot of times my kids|Into each other|We could call|help us visualize|And frankly/iu,
  );
});

test("v5.12 excludes Fresh10 presentation, uncertainty, and incidental-history facts", () => {
  const unsafe = [
    "Hopefully, that's an intuitive thing to call it.",
    "Let me box these off, so that we don't get confused.",
    "Alright, so now we could figure out every possible photon this atom could absorb.",
    "Obviously, that's more than any human could ever solve.",
    "We don't know yet whether the inner part is liquid or solid.",
    "The P-wave shadow by itself tells you that crazy things are happening someplace in the core.",
    "As more and more people get on the internet, the need to secure private data will be even more important.",
    "American settlers had moved to Texas since the 1820s, when the region was still controlled by Spain.",
    "A tribe of 100 hunter-gatherers needs 50 square kilometers to obtain food.",
    "You would have to walk miles and miles per day to gather food.",
    "And I didn't choose this time span arbitrarily.",
    "For other residents of the territory, life didn't change much at all.",
    "As far as Mexico was concerned, the troops were invading their country, and they had no choice but to defend it.",
    "When you speak, your vocal cords exert force on the particles just in front of you.",
    "We are not talking about revenue for the firm; we are talking about costs for the firm.",
    "P-waves pass through significantly denser material than the inner core.",
    "By 750, the empire had taken over most of Persia and a large part of the Byzantine Empire.",
    "The building commemorates an important Sufi leader.",
    "The periods of modern and pre-modern humanity are named after the types of stone tools found in archaeological digs.",
    "The shift from hunter-gatherer to agriculture is the most profound change, up there with language and writing.",
    "The rope has a squiggly disturbance that mirrors the motion made with the hand.",
    "When the quantity of labor is one, the price of labor is three.",
    "The Islamic conquests took over most of Persia and a large part of the Byzantine Empire.",
    "Neolithic refers to new stone.",
    "Since they're closer compacted, they collide more, and the propagation of the wave happens faster.",
    "Paleo means old, while lithic comes from lithos for stone.",
    "The particles in the liquid are closer together.",
    "The Paleolithic period covers the great bulk of human history.",
    "The Levant is in the eastern Mediterranean and modern-day Middle East.",
  ];
  const safe = [
    "A system consists of the matter selected for study, while everything outside it is the surroundings.",
    "A photon is absorbed only when its energy matches an allowed energy-level difference.",
    "Refraction patterns of P-waves reveal the solid inner core.",
    "Public-key encryption uses a shareable public key and a secret private key.",
    "Agricultural surplus supported permanent settlements and specialized labor.",
    "The disputed border between the Nueces River and Rio Grande contributed to the war.",
  ];
  const selection = buildConceptFirstInstructionalSelection(
    [...unsafe, ...safe].join(" "),
    {
      topicHint:
        "thermodynamics atomic spectra earth science encryption agriculture Mexican-American War",
      diverse: true,
      strictPromptFirst: true,
      coherentPromptFirst: true,
    },
  );
  const selected = `${selection.excerpts.join(" ")} ${selection.primaryClaims.join(" ")}`;

  assert.match(
    selected,
    /matter selected for study|allowed energy-level difference|solid inner core|shareable public key|Agricultural surplus|disputed border/iu,
  );
  for (const fragment of unsafe) {
    assert.doesNotMatch(
      selected,
      new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"),
    );
  }
});

test("v5.12 excludes the Fresh8 unsafe facts before ordinal assignment", () => {
  const unsafe = [
    "The units could be written as kilojoules per mole of reaction.",
    "Since there is a one as a coefficient in front of diamond, multiply by one mole of diamond.",
    "The Muslim Turks made further inroads into the Byzantine Empire in the second millennium.",
    "The space shuttle mixed liquid oxygen and hydrogen in its main tank.",
    "Copper wires surrounded by a good insulator such as plastic carry current faster.",
    "The current has less energy loss and will travel faster.",
    "Without high resistance around it, the current would actually go slower.",
    "Positive ions flood into dendrites when they are stimulated in some way.",
    "Saltatory comes from the Latin word saltare, which means to jump around.",
    "The idea that all cars should be painted teal is a convention.",
    "I am just trying to make sure your wheels are on straight.",
    "These videos cover only Standard American English.",
    "I firmly believe that you can learn anything.",
    "Language can be harnessed and used in any way the speaker wants.",
    "What I want to do is give you the tools to harness language.",
    "To harness English and use it any way you want.",
    "Newton's laws are taught in a first-year physics class.",
    "A change to one species can impact a whole web of interconnected organisms.",
    "Clark's nutcrackers live in alpine ecosystems where winters are harsh with lots of snow.",
    "Each population interacts with many other populations and is affected by non-living parts of the environment.",
    "Many people view Newton's publication of Principia as the capstone of the scientific revolution.",
    "The Scientific Revolution gave humanity a new perspective on the universe and new powers.",
    "Now is it true that all cars should be teal?",
    "Charged particles move chaotically and then align to act in concert.",
    "All of that frozen water raises sea levels and affects the weather system.",
    "The colder years are still much hotter than average temperatures in the past.",
    "Individual sustainable habits combined with community-based initiatives address climate change.",
    "As someone who works in environmental science, sorting through facts and opinions is overwhelming.",
    "Human activities release more CO2 than is normally released by Earth and at a much faster rate.",
    "Species are knots and interactions are ropes that hold the net together.",
    "You can think of biodiversity as a safety net.",
    "There are over 3,000 nene throughout the islands.",
    "Islands are very beautiful and have a lot of biodiversity.",
    "Ecosystem health is measured by the completeness of its biodiversity.",
    "When an ecosystem changes so much that a species can no longer survive?",
    "New diseases and climate change have led to the extinction of many Hawaiian species.",
    "Species in an ecosystem interact in specific ways with one another.",
    "If 'ohi'a starts to disappear from Hawaiian forests?",
  ];
  const safe = [
    "Activation energy is the energy barrier that controls reaction rate.",
    "A reversible reaction can proceed in both forward and reverse directions.",
    "Myelin permits electrotonic spread between nodes where action potentials regenerate.",
    "A noun names a person, place, thing, or idea.",
    "Magnetic fields exert forces on magnets without direct contact.",
    "Ice cores preserve information that scientists use to reconstruct past climate.",
    "Habitat restoration can increase survival and reproduction in a threatened population.",
    "Dependence on nectar links the survival of a bird population to flowering plants.",
  ];
  const selection = buildConceptFirstInstructionalSelection(
    [...unsafe, ...safe].join(" "),
    {
      topicHint:
        "chemistry history neurons grammar magnetism climate biodiversity",
      diverse: true,
      strictPromptFirst: true,
      coherentPromptFirst: true,
    },
  );
  const selected = `${selection.excerpts.join(" ")} ${selection.primaryClaims.join(" ")}`;

  assert.match(
    selected,
    /Activation energy|reversible reaction|Myelin|noun names|Magnetic fields|Ice cores|Habitat restoration|Dependence on nectar/iu,
  );
  for (const fragment of [
    "kilojoules per mole",
    "coefficient in front of diamond",
    "further inroads",
    "space shuttle",
    "Copper wires",
    "less energy loss",
    "current would actually go slower",
    "some way",
    "saltare",
    "painted teal",
    "wheels are on straight",
    "videos cover only",
    "learn anything",
    "any way the speaker wants",
    "tools to harness language",
    "use it any way you want",
    "taught in a first-year physics class",
    "whole web of interconnected organisms",
    "winters are harsh",
    "Each population interacts",
    "capstone of the scientific revolution",
    "gave humanity a new perspective",
    "cars should be teal",
    "act in concert",
    "frozen water raises",
    "colder years",
    "community-based initiatives",
    "environmental science",
    "more CO2 than",
    "knots and interactions",
    "biodiversity as a safety net",
    "3,000 nene",
    "very beautiful",
    "completeness of its biodiversity",
    "changes so much",
    "new diseases and climate change",
    "interact in specific ways",
    "starts to disappear",
  ]) {
    assert.doesNotMatch(selected, new RegExp(fragment, "iu"));
  }
});

test("v5.12 excludes Fresh11 presentation, hidden-visual, and worked-scenario facts", () => {
  const unsafe = [
    "Always look at the world around you and see how concepts learned in school or in a Physics class connect to every moment of your life.",
    "When you see calories on a packaged food label, those are actually kilocalories.",
    "In a desert ecosystem, this number might be in the low hundreds rather than the 8,000 range.",
    "The slightly bungled oath led Roberts to re-administer the oath.",
    "Under the original system, the first place winner in the electoral college became President.",
    "The results of the investigation are shown in the data table below.",
    "The only other band that A shares with C is the one that B does not share with C.",
    "Given all of these numbers, break down year two's national income between labor and capital.",
    "Look at scenarios where R and G are held constant to see what happens to inequality.",
    "The whole economy consists entirely of a gold mine.",
    "National income can grow from one year to the next.",
    "In blue, the graph shows the actual emissions of carbon dioxide.",
    "TUMS is mainly calcium carbonate.",
    "Each of the oxygens in carbonic acid is attached to a hydrogen.",
    "The reaction goes this way as there is more of this stuff.",
    "Neon, oxygen, and you see it right over here.",
    "Pause this video and I will show you the banding pattern again.",
    "Plant species two is looking like the leading candidate.",
    "The first choice is examine the beaks and compare them.",
    "If we look at the word photosynthesis, photo refers to light and synthesis refers to putting together.",
    "National income is 102 gold pieces.",
    "The return on capital is 52 divided by 1,050.",
    "The oceans are about 26% more acidic.",
  ];
  const safe = [
    "A phone microphone converts detected sound into digital information.",
    "Net primary productivity equals gross primary productivity minus respiration.",
    "The Constitution limits presidential power while preserving an energetic executive.",
    "Smaller DNA fragments migrate farther during gel electrophoresis.",
    "Return on capital equals capital income divided by the capital stock.",
    "Additional hydrogen ions leave less carbonate available to bind calcium.",
    "Fusing iron into heavier elements requires energy.",
  ];
  const selection = buildConceptFirstInstructionalSelection(
    [...unsafe, ...safe].join(" "),
    {
      topicHint:
        "waves ecology civics evolution economics ocean chemistry stars",
      diverse: true,
      strictPromptFirst: true,
      coherentPromptFirst: true,
    },
  );
  const selected = `${selection.excerpts.join(" ")} ${selection.primaryClaims.join(" ")}`;

  for (const fact of safe)
    assert.match(selected, new RegExp(fact.slice(0, 18), "iu"));
  for (const fragment of [
    "concepts learned in school",
    "food label",
    "low hundreds",
    "bungled oath",
    "first place winner",
    "data table below",
    "band that A shares",
    "year two's national income",
    "R and G are held constant",
    "entirely of a gold mine",
    "National income can grow",
    "In blue",
    "TUMS",
    "each of the oxygens",
    "more of this stuff",
    "see it right over here",
    "Pause this video",
    "leading candidate",
    "first choice",
    "word photosynthesis",
    "102 gold pieces",
    "52 divided by 1,050",
    "26% more acidic",
  ]) {
    assert.doesNotMatch(selected, new RegExp(fragment, "iu"));
  }
});

test("v5.12 excludes Fresh12 graph, analogy, viewpoint-presentation, statistic, and fragment facts", () => {
  const unsafe = [
    "The horizontal axis of this graphic displays the years from 1750 to 2100.",
    "Plug in the value for delta G naught to solve the equation.",
    "This equation allows us to calculate non-standard changes in free energy.",
    "The speaker says hunger feels like getting stuck in gloppy tar pits.",
    "Voting rights expanded to all white men by the 1830s.",
    "Government research created the Internet so companies could make money.",
    "Quotes from notable Americans make these core beliefs more tangible.",
    "The Moon is roughly 240,000 miles away from Earth.",
    "None of this debate matters because the pressures are so big.",
    "Most of the time it is closer to the high end of this range.",
    "Today, we're going to take a look at forms of energy.",
    "As I said before, this process releases radiant energy.",
    "The red curve shows population growth peaking at 2.1% in the 1970s.",
    "The left-hand vertical axis measures the annual world population growth rate.",
    "Therefore, I'm saying that my hunger is slowing me down.",
    "If I'm comparing myself to a wolf, imagine me looking lean and desperate.",
    "The car is not literally grumbling; the speaker identifies its noises as unhappy.",
    "The greatest kind of figurative language is hyperbole.",
    "Just to hit the point home, let's look at a few examples.",
    "The revolution criticized monarchy, which Thomas Paine called absurd.",
    "Perhaps the joke was on John Adams after all.",
    "What I'm gonna do is talk about a few core beliefs.",
    "When he's saying this, he's clearly making reference to individualism.",
    "Last but not least, I will give you a quote from a famous conservative economist.",
    "When you think about the mechanical properties of the innermost layer, actually I didn't tell you where the mesosphere ends, so the mantle ends at about 2,900 kilometers deep.",
    "We differentiate the mantle from the crust because it is composed of different types of rock.",
    "Compare the sizes of the sun, Earth, and the moon.",
  ];
  const safe = [
    "The standard free-energy equation relates delta G naught to the equilibrium constant.",
    "Improved healthcare can lower death rates and increase population growth.",
    "An allusion references a person, event, or work from shared culture.",
    "Positive income elasticity identifies a normal good.",
    "Revolutionary ideals of liberty and equality were applied to demands for broader rights.",
    "A limited-government viewpoint argues that excessive intervention can restrict free enterprise.",
    "The Moon's tilted orbit usually places it above or below the alignment required for an eclipse.",
    "The asthenosphere lies below the lithosphere.",
  ];
  const selection = buildConceptFirstInstructionalSelection(
    [...unsafe, ...safe].join(" "),
    {
      topicHint:
        "free energy population figurative language economics civics eclipses Earth layers",
      diverse: true,
      strictPromptFirst: true,
      coherentPromptFirst: true,
    },
  );
  const selected = `${selection.excerpts.join(" ")} ${selection.primaryClaims.join(" ")}`;

  for (const fragment of [
    "horizontal axis",
    "Plug in the value",
    "non-standard changes",
    "gloppy tar pits",
    "1830s",
    "companies could make money",
    "more tangible",
    "240,000 miles",
    "None of this debate",
    "high end of this range",
    "Today, we're going",
    "As I said before",
    "2.1%",
    "left-hand vertical axis",
    "my hunger",
    "comparing myself",
    "not literally grumbling",
    "greatest kind",
    "hit the point home",
    "called absurd",
    "joke was on",
    "gonna do",
    "he's saying this",
    "Last but not least",
    "2,900 kilometers",
    "different types of rock",
    "Compare the sizes",
  ]) {
    assert.doesNotMatch(selected, new RegExp(fragment, "iu"));
  }
  assert.match(
    selected,
    /equilibrium constant|population growth|allusion|income elasticity|liberty and equality|limited-government viewpoint|tilted orbit|asthenosphere/iu,
  );
});

test("v5.12 excludes Fresh13 anecdotes, hidden visuals, quote recall, and vague fragments", () => {
  const unsafe = [
    "My car uses oil when I drive to get tea, my stove uses natural gas, and my water heater uses coal-sourced electricity.",
    "For me, the beginning of my day always starts with making tea.",
    "Strength will depend on a couple of factors.",
    "All life comes from other life through the process of reproduction.",
    "City three has two plus zero plus one, for three incoming routes.",
    "Number three: one day Hamza's boss calls him into his office.",
    "Richard Nixon had Republicans in the White House while Democrats controlled Congress.",
    "McConnell said divided government is the perfect time to do big things.",
    "Obama dealt with divided government during the second half of his first term.",
    "For a lot of people, that is a significant negative.",
    "When someone tells you that you are parsimonious, it means you are cheap.",
    "Who knows, but I'm guessing that the trait was favorable.",
    "Everything else listed here has jaws.",
    "It says right here that it is a young bushback.",
    "A louse can view the scalp as almost a shelter from the rest of the environment.",
    "Whatever the price is in the market, each of those firms just have to take that price.",
    "Once again, this is a situation here you have deadweight loss.",
  ];
  const safe = [
    "Renewable energy resources are restored by natural processes quickly enough to be reused.",
    "Electric force weakens as the separation between charged objects increases.",
    "Sexual reproduction combines genetic material from two gametes.",
    "However, alleles on two homologous chromosomes may be different.",
    "In an adjacency matrix, a row sum gives the number of outgoing directed edges.",
    "The right to organize a union includes protection against retaliation.",
    "Congress uses hearings and subpoenas as tools of bureaucratic oversight.",
    "Divided government exists when different parties control the executive and legislative branches.",
    "Phylogenetic parsimony prefers the hypothesis requiring the fewest evolutionary changes.",
    "Long-run entry eliminates economic profit in monopolistic competition.",
    "Parasitism benefits the parasite and harms the host.",
  ];
  const selection = buildConceptFirstInstructionalSelection(
    [...unsafe, ...safe].join(" "),
    {
      topicHint:
        "energy forces genetics matrices rights government evolution economics ecology",
      diverse: true,
      strictPromptFirst: true,
      coherentPromptFirst: true,
    },
  );
  const selected = `${selection.excerpts.join(" ")} ${selection.primaryClaims.join(" ")}`;
  for (const fragment of [
    "My car uses oil",
    "making tea",
    "couple of factors",
    "All life comes from other life",
    "City three",
    "Hamza's boss",
    "Richard Nixon",
    "McConnell said",
    "Obama dealt",
    "significant negative",
    "you are cheap",
    "Who knows",
    "listed here",
    "young bushback",
    "almost a shelter",
    "those firms",
    "Once again, this is a situation",
  ]) {
    assert.doesNotMatch(selected, new RegExp(fragment, "iu"));
  }
  assert.match(
    selected,
    /Renewable energy|Electric force|Sexual reproduction|adjacency matrix|organize a union|hearings and subpoenas|Divided government|Phylogenetic parsimony|economic profit|Parasitism/iu,
  );
  assert.match(
    selection.primaryClaims.join("\n"),
    /Alleles on two homologous chromosomes may be different/iu,
  );
  assert.doesNotMatch(selection.primaryClaims.join("\n"), /^However\b/imu);
});

test("v5.12 converts Fresh14 presentation fragments into standalone concepts", () => {
  const transcript = [
    "In summary, we just identified several similarities and differences in our comparison of animal and plant cells.",
    "The nucleus within each cell type serves as an information database to store the cell's genes, while the mitochondria act as factories to break down sugars.",
    "Animal cells and plant cells also have this jelly-like substance called the cytosol, which contains organelles with specific functions.",
    "The second way is to increase the density of the charged particles, and we can do this by looping the wire into a coil.",
    "A turbine spins a magnet inside a coil to produce electricity.",
    "Some chemical symbols are based on the Latin name for the element.",
    "Looking through the periodic table, phosphorus has atomic number 15 and chemical symbol P.",
    "Elements in the same periodic-table column tend to have similar physical and chemical properties.",
    "If we started out with one mole of H2A plus and added 0.5 moles of hydroxide, we neutralized half.",
    "The number of equivalence points in a titration curve for a polyprotic acid equals the number of acidic protons.",
    "The Supreme Court hears a case about internet copyright law and the First Amendment.",
    "Government describes both the institutions like the Supreme Court which make and enforce laws, as well as the people who serve in those institutions.",
    "If something comes up that you're unfamiliar with, just make a note and look it up later.",
    "Material comforts and visions of suburbia clashed with calls to tune in, turn on, and drop out.",
    "10 or 11, so we have one, two, three, four, five.",
    "If neither of these happen, they are going to roll again.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "cells electromagnetism chemistry civics history probability",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.doesNotMatch(
    primaries,
    /In summary|Latin name|phosphorus has atomic number 15|started out with|Supreme Court hears a case|make a note/iu,
  );
  assert.match(primaries, /nucleus stores a cell's genes/iu);
  assert.match(primaries, /Cytosol is the jelly-like material/iu);
  assert.match(primaries, /Looping a current-carrying wire into a coil/iu);
  assert.match(
    primaries,
    /Relative motion between a magnet and a conducting coil/iu,
  );
  assert.match(primaries, /same periodic-table column/iu);
  assert.match(primaries, /number of equivalence points/iu);
  assert.match(primaries, /Government includes both the institutions/iu);
  assert.match(primaries, /counterculture challenged suburban conformity/iu);
  assert.match(primaries, /P\(sum = 10 or 11\) = 5\/36/iu);
  assert.match(
    primaries,
    /roll is repeated whenever its sum is not assigned/iu,
  );
});

test("v5.12 excludes Fresh15 deictic stories and canonicalizes direct science facts", () => {
  const transcript = [
    "For something like the Earth, you have to go really far away to not be affected by its gravitational force of attraction.",
    "Large galls become an easy meal for them because they're conspicuous in the environment.",
    "For cities, first of all, acid rain is bad news because it can damage buildings and statues, particularly those that are made of limestone, marble, and some metals.",
    "What's happening in the hotter object is that the particles are vibrating faster than when the object is colder, and that's what it means to be hot or cold.",
    "When the temperature is the same, no heat is transferring, and this is what is defined as thermal equilibrium.",
    "Because both the birth rate and the death rate are high, but they're about the same, you can see that you have a relatively stable but we'll say in absolute terms, low population.",
    "In real life, a lot of energy is also going to be transferred from the pizza into the air around it, but for this problem, we're going to simplify it to just look at the pizza and the plate.",
    "All I wanted to do after a while was to find some water and shade as soon as possible.",
    "If we did not have immigration, you would have a declining population because we are in this last phase right over here.",
    "At this phase, women might be entering in the workforce in a major way.",
    "Dinosaurs are far in the past now, but their relatives are still among us.",
    "Objects with mass, to explain this, we first need to remember a couple of things.",
    "The first of these stories is that of directional selection.",
    "The red arrow represents selection pressure, which in this case is imposed by the abiotic factors of weather.",
    "When you put the slice of pizza on the plate, the particles at the surface of the objects will come into contact.",
    "For example, Japan has a declining population, even places like the United States.",
    "The family is overall likely to be wealthier.",
    "People are even having illnesses or dying from malnutrition.",
    "Education generally is at a low level especially for women at this stage because fundamentally of a lack of a healthcare system for most people, you might not have things like family planning.",
    "Countries might start to industrialize.",
    "Another really awesome example of a negative feedback loop is osmoregulation, specifically in salmon.",
    "The snow vole is a mouse-like mammal.",
    "Birds, like every modern species, have a series of ancestors stretching back through time.",
    "What those changes will ultimately be is based on the adaptations promoted by the previous environment and the pressures presented by the new one.",
    "The trees serve as models for studying evolutionary relationships over time.",
    "Some of these stronger magnets are even used to make high-speed trains levitate off the ground.",
    "If you turn one of those magnets around so that you have two north poles facing each other, they will repel.",
    "In most pre-industrial societies, you have a high death rate because healthcare is either non-existent or it isn't that good.",
    "The structure of a protein along with the chemical properties of its amino acid, evidently, determine its function.",
    "As you can see from this diagram, the stimulus in childbirth comes from the baby's head, which presses against the cervix here.",
    "Gravitational force exists between all objects with mass and attracts them toward each other.",
    "Heat is the transfer of energy between objects at different temperatures.",
    "Homeostasis maintains stable internal conditions through feedback responses.",
    "A branch point on an evolutionary tree represents a common ancestor.",
    "Weather stations back on the surface can use electromagnetic wave fields measured through Doppler radar to determine how heavy rain is falling or how strong the wind is blowing in those same clouds.",
    "For small objects without much mass, it doesn't take much distance for their gravitational forces between each other to be so weak that we don't notice them.",
    "Gravitational force is actually attracting the lamp to the floor and these forces exist between all objects with mass.",
    "For comparison, my lamp is only one kilogram, which is why if I jump, I fall towards the Earth and not towards my lamp.",
    "The good news is the forces that drive natural selection don't just disappear when an environment changes.",
    "When the baby is born, because the baby's head isn't pressing up against the cervix and the pelvic floor anymore, the neuron stops sending the signal and the brain stops triggering the release of so much oxytocin.",
    "In a similar way, the body is also composed of specialized cells with unique roles, such as red blood cells that carry oxygen in the blood, muscle cells that contract and relax or even nerve cells that carry signaling messages throughout the body.",
    "Because say farm productivity is higher because they're able to use more modern methods, the nutrition is better, death rates start coming down.",
    "In other words, any of the modern birds that you see today, whether it's a dove or a penguin, they all evolved from the same bird-like dinosaur ancestor.",
    "Magnetic forces don't affect everything the same way.",
    "Both coal and oil burn at such high temperatures that they can cause nitrogen and oxygen in the air to form different compounds.",
    "Adaptations are products of, and are inextricably connected to, the environment.",
    "Oh, in fact, it's definitely going to occur over many decades, but some countries still haven't even gotten through all of these phases.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "gravity acid rain heat feedback demography evolution",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(
    primaries,
    /Acid rain can damage buildings and statues made of limestone, marble, and some metals/iu,
  );
  assert.match(
    primaries,
    /Particles vibrate faster in a hotter object than in a colder object/iu,
  );
  assert.match(primaries, /Gravitational force exists between all objects/iu);
  assert.match(primaries, /Heat is the transfer of energy/iu);
  assert.match(
    primaries,
    /Thermal equilibrium occurs when all parts of a system are at the same temperature and no net heat transfer occurs/iu,
  );
  assert.match(
    primaries,
    /birth and death rates are both high and approximately equal/iu,
  );
  assert.match(primaries, /Homeostasis maintains stable internal conditions/iu);
  assert.match(primaries, /branch point on an evolutionary tree/iu);
  assert.match(
    primaries,
    /Doppler radar measurements.*rainfall intensity.*wind speed/iu,
  );
  assert.match(primaries, /gravitational attraction weakens with distance/iu);
  assert.match(
    primaries,
    /Gravitational force attracts every pair of objects/iu,
  );
  assert.match(
    primaries,
    /Earth's much greater mass produces a much stronger gravitational attraction/iu,
  );
  assert.match(primaries, /Natural selection continues to act/iu);
  assert.match(
    primaries,
    /After birth removes pressure.*neural signal stops.*oxytocin release decreases/iu,
  );
  assert.match(primaries, /Specialized cells have distinct functions/iu);
  assert.match(
    primaries,
    /Modern farming methods can raise farm productivity/iu,
  );
  assert.match(
    primaries,
    /All modern birds share a common bird-like dinosaur ancestor/iu,
  );
  assert.match(primaries, /Strong magnets can levitate high-speed trains/iu);
  assert.match(primaries, /When two north poles face each other/iu);
  assert.match(
    primaries,
    /protein's structure and the chemical properties of its amino acids/iu,
  );
  assert.match(primaries, /Pressure from the baby's head against the cervix/iu);
  assert.match(
    primaries,
    /changes a population undergoes in a new environment depend on adaptations/iu,
  );
  assert.match(
    primaries,
    /Evolutionary trees model evolutionary relationships over time/iu,
  );
  assert.match(
    primaries,
    /pre-industrial societies have high death rates because healthcare is unavailable or poor/iu,
  );
  assert.doesNotMatch(
    primaries,
    /really far away|easy meal for them|for this problem|All I wanted|last phase right over here|At this phase|relatives are still among us|to explain this|first of these stories|red arrow|snow vole|slice of pizza|Japan has a declining population|family is overall likely|illnesses or dying from malnutrition|Education generally|start to industrialize|really awesome example|series of ancestors stretching|affect everything the same way|form different compounds|inextricably connected|occur over many decades/iu,
  );
});

test("v5.12 excludes Fresh16 visual fragments and preserves standalone relationships", () => {
  const transcript = [
    "On top of that, this is going to result in a lot of heat and a lot of friction of the plates grinding past each other essentially allowing magma to form at that part of the rock.",
    "Tthis is essentially an oceanic plate being subducted under another oceanic plate, right over here.",
    "At least the crustal portions on them are just going keep jamming into each other.",
    "Its velocity has changed, but especially, once it got outside of the planets, it's been roughly at this velocity.",
    "If we do the same exercise that we did in the last pair, if you put a mirror behind this guy, only the forward and back parts matter.",
    "All of a sudden, you do not have this symmetry.",
    "If you put a mirror behind it, this hydrogen is actually closer to the mirror.",
    "If you think about it, they are mirror images of each other, and they each have two chiral centers.",
    "Stereoisomers, they're made up of the same thing, the connections are the same, but the three-dimensional configuration is a little bit different.",
    "A subduction zone forms where one plate descends beneath another at a convergent boundary.",
    "A salt bridge permits ion movement that maintains electrical neutrality between two half-cells.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "plate tectonics stereochemistry galvanic cells",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(
    primaries,
    /buoyant crust resists subduction.*building mountain ranges/iu,
  );
  assert.match(primaries, /Voyager's speed has remained roughly constant/iu);
  assert.match(primaries, /Stereoisomers have the same atom connectivity/iu);
  assert.match(
    primaries,
    /subduction zone forms where one plate descends beneath another/iu,
  );
  assert.match(primaries, /salt bridge permits ion movement/iu);
  assert.doesNotMatch(
    primaries,
    /heat and friction|same exercise|all of a sudden|this hydrogen|they each have two chiral/iu,
  );
});

test("v5.12 excludes Fresh17 incomplete trivia and canonicalizes complete concepts", () => {
  const transcript = [
    "If you're going to have them very separate from each other, you're not going to have as high of a potential energy, but this is still going to be higher than if you're at this stable point.",
    "During the golden age of Athens, you have what was first referred to as a democracy.",
    "The predominant form of government throughout most of human history has been a monarchy.",
    "Break even if only 1 Sal dies.",
    "No matter how complex the electricity generation system, that all boils down to the same idea, basically turning a wheel.",
    "Most nuclear power plants use light water reactors to generate electricity, which are made up of five basic parts.",
    "If anything were to happen to me, I'd want them to at least be able to pay off the mortgage and have money left for college and to live.",
    "At the 21st year, I have to get a new policy.",
    "A nuclear fission chain reaction continues when released neutrons split additional uranium-235 nuclei.",
    "A salt bridge permits ion movement that maintains electrical neutrality between two half-cells.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "bond energy insurance nuclear power galvanic cells",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(
    primaries,
    /minimum potential energy at their stable equilibrium distance/iu,
  );
  assert.match(primaries, /Life insurance provides financial support/iu);
  assert.match(
    primaries,
    /term life policy expires.*older age.*mortality risk/iu,
  );
  assert.match(primaries, /nuclear fission chain reaction/iu);
  assert.match(primaries, /salt bridge permits ion movement/iu);
  assert.doesNotMatch(
    primaries,
    /first referred to as a democracy|predominant form of government|only 1 Sal|No matter how complex|five basic parts/iu,
  );
});

test("v5.12 excludes Fresh18 tautologies and canonicalizes the genetic-drift example", () => {
  const transcript = [
    "The benefits are, and I'll do those as pluses, a benefit is, well, it kind of seems closest to the original spirit of a democracy.",
    "If you go down to the atomic level, we can get to a fundamental level of where the charge is happening.",
    "On another level it's this deep property of matter that we can manipulate and predict, but it is still mysterious.",
    "The reason why this happened isn't because the white allele somehow makes the bunnies less fit; the allele may even be advantageous.",
    "A disaster can randomly reduce a population to a small number of survivors regardless of fitness.",
    "Genetic drift is much more likely to occur in small populations than in large populations.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "democracy electric charge genetic drift",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(
    primaries,
    /Genetic drift can eliminate an allele by random chance even when the allele is not harmful/iu,
  );
  assert.doesNotMatch(
    primaries,
    /original spirit|fundamental level of where the charge is happening|deep property of matter/iu,
  );
});

test("v5.12 excludes Fresh19 presentation tautologies and preserves precise legal content", () => {
  const transcript = [
    "For example, here's a satellite image of the Andes Mountain Range in South America.",
    "Depending on the exact region, one factor may be more responsible for the local climate than the others.",
    "If you don't want it, of course, you can delete it.",
    "When you look at the world around you, just think about how a wave is transmitting from one material into another.",
    "Something that is somewhat related to some of the function that a vacuole plays is the idea of a lysosome.",
    "The big thing to appreciate is that cells are incredibly complex.",
    "Another famous membrane-bound organelle is known as the powerhouse of the cell.",
    "The government protects copyright and patent so that you can sue someone who steals your ideas, work, or inventions.",
    "Workers have a right to organize and join labor unions without employer retaliation.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "regional climate privacy waves organelles economic rights",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(
    primaries,
    /Copyright and patent laws let rights holders seek a legal remedy for infringement/iu,
  );
  assert.match(primaries, /Workers have a right to organize/iu);
  assert.doesNotMatch(
    primaries,
    /satellite image|one factor may be more responsible|If you don't want it|think about how a wave|somewhat related|big thing to appreciate|most famous/iu,
  );
});

test("v5.12 excludes Fresh20 worked fragments and preserves the climate mitigation relationship", () => {
  const transcript = [
    "When you consider the nucleus, the shielding from electrons in between, and the distance of those outer electrons.",
    "When we look at the time period between 1880 and 1940, temperatures swing around an average.",
    "Scientists are working on technologies that can remove excess CO2, but in the meantime they recommend that we emit less CO2 in the first place.",
    "Most scientists now prefer the more general term climate change.",
    "The standard reduction potential for zinc is -0.76 V.",
    "If we divide the numerator and denominator by r squared, we get one and r.",
    "The important thing to think about is the significant loss of energy between pyramid layers.",
    "The previous 17 clauses were very explicit, but I am not going to read them.",
    "A cell's surface-area-to-volume ratio decreases as the cell grows.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "chemistry climate ecosystems cells government",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(
    primaries,
    /Reducing carbon dioxide emissions limits additional atmospheric buildup/iu,
  );
  assert.match(primaries, /surface-area-to-volume ratio decreases/iu);
  assert.doesNotMatch(
    primaries,
    /When you consider|between 1880 and 1940|Most scientists now prefer|0\.76 V|divide the numerator|important thing to think|previous 17 clauses/iu,
  );
});

test("v5.12 canonicalizes Fresh21 terminology and hidden charge setups", () => {
  const transcript = [
    "Photovoltaic means using light to produce electric force because volt is a unit of electric force.",
    "Adding a fourth electron to an orbital that already has one electron makes one easier to remove because like charges repel.",
    "When the forces are exerted on each of these point charges, they pull the attached masses towards each other.",
    "Cell specialization is when different cells specialize in different functions.",
    "A cell membrane regulates what enters and leaves the cell.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "solar energy ionization electric fields cells",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(primaries, /convert light energy into electrical energy/iu);
  assert.match(primaries, /In beryllium, the fourth electron pairs/iu);
  assert.match(primaries, /Opposite point charges attract/iu);
  assert.match(primaries, /cell membrane regulates what enters and leaves/iu);
  assert.doesNotMatch(
    primaries,
    /using light to produce electric force|Cell specialization is when different cells specialize/iu,
  );
});

test("v5.12 removes Fresh22 visual trivia and preserves energy terminology", () => {
  const transcript = [
    "My thick hair is probably closer to 180 micrometers.",
    "If cost assumptions baked into this chart change, then this diagram might change.",
    "This visual shows entitlement programs as a share of the budget and a percentage of GDP.",
    "The energy of our products is about 100 kilojoules per mole and the energy of our reactants is about 50.",
    "In other words, nuclear fusion produces a lot of energy.",
    "Burning fossil fuels transforms stored energy into a less organized form of energy, like heat and ash.",
    "Heat flows from the surroundings to the system in an endothermic process and delta H is positive.",
    "Corporate taxes apply to corporate profits.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "cells federal budget reaction energy nonrenewable energy",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(
    primaries,
    /Burning fossil fuels releases stored chemical energy primarily as heat/iu,
  );
  assert.match(primaries, /enthalpy change, delta H, is positive/iu);
  assert.match(primaries, /Corporate taxes apply to corporate profits/iu);
  assert.doesNotMatch(
    primaries,
    /180 micrometers|diagram might change|This visual|100 kilojoules|fusion produces a lot of energy|form of energy, like heat and ash/iu,
  );
});

test("v5.12 corrects Fresh23 genetics, weather, and force fragments", () => {
  const transcript = [
    "The word homologous begins with a Latin prefix meaning the same.",
    "Either of these genotypes would express the phenotype brown if we assume this is the dominant allele.",
    "Satellites and Doppler radar observe wind, temperature, pressure, and nearby geographic features.",
    "Weather results from air masses moving from high air pressure to low air pressure.",
    "Say the Swiss has a mass of .05 kilograms and the cheddar has .1 kilograms.",
    "First, let's consider some comparisons.",
    "When you press on a table, you are putting a force onto the table.",
    "The forces do not cancel out.",
    "All of these components come together to make up the human body.",
    "Cells, tissues, organs, and organ systems form a hierarchy in the human body.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "genetics weather kinetic energy forces human body",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(primaries, /homozygous BB genotype.*heterozygous Bb genotype/iu);
  assert.match(primaries, /Air-pressure differences drive air masses/iu);
  assert.match(primaries, /action-reaction force pair does not cancel/iu);
  assert.match(primaries, /form a hierarchy in the human body/iu);
  assert.doesNotMatch(
    primaries,
    /Latin prefix|nearby geographic features|Swiss|cheddar|let's consider|putting a force onto|All of these components/iu,
  );
});

test("v5.12 rejects Fresh24 hidden and vague fragments and canonicalizes solubility interactions", () => {
  const transcript = [
    "An electron in the ground state needs 4 eV to reach the next energy level shown in the diagram.",
    "Electrons do interesting stuff: move around, jump around, and bind.",
    "The body itself produces heat because it's a mammal, and further parts lose heat.",
    "Take a closer look at Planty because its cells are hiding a secret.",
    "Water molecules are attracted to sodium and chloride ions because of their partial charges.",
    "A vat of pentane can mix with a vat of hexane because the weak forces are comparable.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "atomic spectra organism energy photosynthesis solubility",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(primaries, /Ion-dipole attractions draw/iu);
  assert.match(primaries, /London dispersion attractions/iu);
  assert.doesNotMatch(
    primaries,
    /needs 4 eV|interesting stuff|move around, jump around|The body itself|it's a mammal|hiding a secret|take a closer look/iu,
  );
});

test("v5.12 canonicalizes Fresh25 frame, dipole, energy, rotation, and acid-base fragments", () => {
  const transcript = [
    "When we need to, we can also burn wood to get energy.",
    "Energy Information Administration says residential site electricity consumption by end use.",
    "From your frame of reference, the velocity would now be zero.",
    "The temporary positive end of one molecule is attracted to the temporarily negative end of another and that phenomenon can domino.",
    "For a complex structure like a human body, the radius is indicative of the average distance of the mass from the center of rotation.",
    "OK, he's got a positive charge when everything was done, so maybe that's a Bronsted-Lowry base.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint:
      "organism energy household energy momentum intermolecular forces angular momentum acids bases",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(primaries, /Burning wood releases stored chemical energy/iu);
  assert.match(
    primaries,
    /Household energy consumption can include electricity/iu,
  );
  assert.match(
    primaries,
    /observer and an object move with the same velocity/iu,
  );
  assert.match(primaries, /London dispersion forces arise/iu);
  assert.match(
    primaries,
    /moment of inertia depends on how its mass is distributed/iu,
  );
  assert.match(
    primaries,
    /Brønsted–Lowry base is a species that accepts a proton/iu,
  );
  assert.doesNotMatch(
    primaries,
    /from your frame of reference, the velocity would now be zero|got a positive charge|diagram|can domino/iu,
  );
});

test("v5.12 rejects Fresh26 visual trivia and canonicalizes complete scientific relationships", () => {
  const transcript = [
    "Igneous rocks make up more than 90% of the Earth's crust.",
    "Depending on your size, there are about five liters of blood.",
    "Where to dump the oxygen, because maybe I'm running and need oxygen around my thigh muscles.",
    "Get a better understanding of pulmonary arteries and veins relative to other vessels.",
    "The pulmonary artery was blue.",
    "Hydrophobic side chains are pulled away from the surrounding water.",
    "The entire demand curve will shift to the left.",
    "The box first crosses position zero at time equals one second.",
    "The plant uses solar energy to fix carbon from a gas form into a solid form.",
    "An animal gets energy from those bonds in the biological molecules.",
    "See if you can have a go at this now.",
    "The number of moles of oxygen is equal to the pressure of the oxygen.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint:
      "circulation protein folding markets simple harmonic motion ecosystems stoichiometry",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(primaries, /pulmonary artery carries deoxygenated blood/iu);
  assert.match(primaries, /Nonpolar hydrophobic side chains cluster/iu);
  assert.match(
    primaries,
    /decrease in demand.*shifts the entire demand curve to the left/iu,
  );
  assert.match(
    primaries,
    /Photosynthesis uses solar energy to incorporate carbon/iu,
  );
  assert.match(
    primaries,
    /oxidizing food molecules through cellular respiration/iu,
  );
  assert.doesNotMatch(
    primaries,
    /more than 90%|five liters of blood|where to dump|Get a better understanding|time equals one second|have a go|moles of oxygen is equal to the pressure/iu,
  );
});

test("v5.12 rejects Fresh27 trivia and canonicalizes atomic, mantle, noble-gas, and civics claims", () => {
  const transcript = [
    "Earth has only been around for about four and a half billion years.",
    "The radius of a circular object is the distance between its center and edge.",
    "The distance between the 2 nuclei can be divided in half and called the atomic radius.",
    "The mantle actually has some parts of it that are solid, while the rest is somewhat fluid.",
    "The noble gases do not form covalent bonds.",
    "The Articles of Confederation had a very strong sense of limited government.",
    "Under the New Jersey Plan, each state had one vote, so equal numbers of votes did not depend on population.",
    "The founders didn't want all white men to be able to vote.",
    "What the founders intended was a safeguard against a mob choosing an unsuitable president.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint:
      "atomic radius Earth layers periodic trends constitutional government representation elections",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");

  assert.match(
    primaries,
    /atomic radius is half the distance between their nuclei/iu,
  );
  assert.match(primaries, /mantle is predominantly solid rock/iu);
  assert.match(primaries, /noble gases generally unreactive and unlikely/iu);
  assert.match(
    primaries,
    /Articles of Confederation created a weak central government/iu,
  );
  assert.match(
    primaries,
    /New Jersey Plan gave each state one legislative vote/iu,
  );
  assert.match(
    primaries,
    /Some framers supported indirect presidential election/iu,
  );
  assert.doesNotMatch(
    primaries,
    /four and a half billion|radius of a circular object|founders didn't want all white men|founders intended.*mob/iu,
  );
});

test("v5.12 abstracts worked network examples into five visible-independent matrix rules", () => {
  const transcript = [
    "Each node is a city and each directed arrow represents a direct bus route from city to city.",
    "Complete the matrix where rows are starting points and columns are end points.",
    "There are nine entries in this matrix for each combination between the starting city and ending city.",
    "City one has zero plus one plus three for four incoming routes, and we look at the cities that are the end points.",
    "City one has six outgoing routes because I am just adding up along the row.",
    "Starts at city two, ends at city three.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "using matrices to represent directed networks",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");
  assert.equal(selection.primaryClaims.length, 5);
  assert.match(primaries, /directed edge is ordered/iu);
  assert.match(
    primaries,
    /rows represent starting nodes.*columns represent ending nodes/iu,
  );
  assert.match(primaries, /entry.*counts the directed edges/iu);
  assert.match(primaries, /column.*incoming edges/iu);
  assert.match(primaries, /row.*outgoing edges/iu);
  assert.doesNotMatch(primaries, /city (?:one|two|three)|zero plus one/iu);
});

test("v5.12 converts named civics examples and colloquial ecology into durable concepts", () => {
  const transcript = [
    "Hamza does not want to move departments and later uses his right to change employment.",
    "The bureaucracy itself is under the executive branch, and the president can fire a cabinet secretary.",
    "Ronald Reagan and Tip O'Neill negotiated a Social Security bargain during divided government.",
    "McConnell said divided government provides political cover and credit to both parties after legislation passes.",
    "The lamprey is the outgroup because its common ancestor is most distant from all the other groups.",
    "Parsimony, which in everyday language means cheap, means using the simplest explanation in this context.",
    "Technically, symbiosis is not just about benefiting each other; one species can benefit while another is hurt or indifferent.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "economic rights government phylogenetics ecology",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");
  assert.match(
    primaries,
    /right to choose their work and change their employment/iu,
  );
  assert.match(primaries, /executive branch can investigate agencies/iu);
  assert.match(
    primaries,
    /Divided government exists when different political parties control the executive and legislative branches/iu,
  );
  assert.match(primaries, /pro-divided-government viewpoint/iu);
  assert.match(primaries, /outgroup.*root/iu);
  assert.match(primaries, /fewest evolutionary changes/iu);
  assert.match(primaries, /Symbiosis is a long-term, close interaction/iu);
  assert.doesNotMatch(
    primaries,
    /Hamza|Reagan|O'Neill|McConnell said|everyday language|cheap/iu,
  );
});

test("v5.12 preserves the firm scope of monopolistic-competition claims", () => {
  const transcript = [
    "Whatever the price is in the market, each of those firms just have to take that price.",
    "Once again, this is a situation here you have deadweight loss.",
    "The demand for your specific product is going to go down because other people offer similar alternatives.",
    "The rational quantity to produce for a profit-maximizing firm is where marginal revenue intersects marginal cost.",
    "Marginal revenue goes down twice as fast because selling another unit means lowering the price for everyone.",
    "Once firms are no longer able to earn economic profit, additional firms no longer try to enter.",
    "The curve drawn here is the demand curve for this particular firm's product, not the demand curve for the entire market.",
    "A firm is productively efficient at the minimum point of its average total cost curve.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "long-run monopolistic competition",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");
  assert.match(primaries, /close substitutes reduces the demand/iu);
  assert.match(primaries, /marginal revenue equals marginal cost/iu);
  assert.match(primaries, /marginal revenue falls twice as steeply/iu);
  assert.match(primaries, /long-run economic profit to zero/iu);
  assert.match(primaries, /individual firm's product demand/iu);
  assert.match(primaries, /minimizes average total cost/iu);
  assert.doesNotMatch(primaries, /those firms|Once again|price as given/iu);
});

test("v5.12 replaces conversational scarcity leads with complete decision facts", () => {
  const selection = buildConceptFirstInstructionalSelection(
    [
      "Maybe the custodian can help with that.",
      "Measuring the land and searching for each item's space requirement provides information for allocating the limited area.",
      "Well, it was a hard choice for the school board.",
      "The school board could use the limited land for either parking or a larger playground.",
      "I think that we have unlimited wants for the playground.",
      "The available land cannot satisfy every desired use.",
      "Opportunity cost is the next-best alternative forgone by a choice.",
    ].join(" "),
    {
      topicHint: "scarcity and opportunity cost",
      diverse: true,
      strictPromptFirst: true,
      coherentPromptFirst: true,
    },
  );
  const primaries = selection.primaryClaims.join(" ");
  assert.match(
    primaries,
    /allocating|either parking|cannot satisfy|Opportunity cost/iu,
  );
  assert.doesNotMatch(
    primaries,
    /Maybe the custodian|Well, it was|I think that/iu,
  );
});

test("v5.12 keeps distinct seismic observations inside assessment evidence", () => {
  const transcript = [
    "But S-waves, S for secondary, these are the transverse waves, these can only travel through solids.",
    "S-waves disappear beyond the shadow-zone boundary because Earth's liquid outer core blocks them.",
    "But if it goes into a liquid, in general, sound waves, or I should say P-waves, seismic waves move slower in liquids.",
    "And so the refraction patterns we get when we do measure from seismograph stations around the world is that it looks like the P-waves are kind of doing what you would expect in the mantle, but then they're getting refracted as if they're going to a slower medium as they go through the outer core.",
    "But the real way to know that we have an inner core that's solid, as opposed to the whole thing being liquid, is that the P-waves is the pattern of when and how the P-waves reach essentially the other side of the globe.",
    "Wave speeds and shadow-zone geometry allow scientists to calculate the depth of boundaries between Earth's layers.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "how seismic waves reveal Earth's core",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });

  const evidence = selection.excerpts.join(" ");
  assert.ok(selection.primaryClaims.length >= 2);
  assert.match(evidence, /S-waves/iu);
  assert.match(evidence, /P-waves/iu);
  assert.match(evidence, /(?:solid inner core|inner core that's solid)/iu);
  assert.match(evidence, /depth of boundaries/iu);
});

test("v5.12 assigns plastic-debris and tagged-neuron objectives only once", () => {
  const transcript = [
    "The North Pacific Garbage Patch is mostly a dispersed soup of microplastics.",
    "Plastic makes up most marine debris in the twenty-first century.",
    "Deep currents carry oxygen-rich surface water to organisms near the ocean floor.",
    "Scientists tagged hippocampal neurons that were active while mice learned a behavior.",
    "Activating the tagged neurons later triggered the same learned behavior.",
    "Long-term potentiation strengthens synaptic connections during memory formation.",
    "Repeated neural firing strengthens synaptic connections used to store a memory.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "ocean circulation and memory",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  const primaries = selection.primaryClaims.join("\n");
  assert.ok(
    selection.primaryClaims.filter((claim) =>
      /(?:garbage patch|marine debris|microplastics?)/iu.test(claim),
    ).length <= 1,
  );
  assert.ok(
    selection.primaryClaims.filter((claim) =>
      /(?:tagged hippocampal neurons?|tagged neurons?)/iu.test(claim),
    ).length <= 1,
  );
  assert.ok(
    selection.primaryClaims.filter((claim) =>
      /(?:Long-term potentiation|strengthens synaptic connections)/iu.test(
        claim,
      ),
    ).length <= 1,
  );
  assert.match(primaries, /oxygen-rich|Long-term potentiation/iu);
});

test("v5.12 deprioritizes presentation-bound equation examples", () => {
  const transcript = [
    "For example, subtract the first equation from the second equation to get 3 = 3.",
    "Newton's third law states that every force has an equal and opposite reaction force.",
    "A free body diagram represents each force on an object with a labeled arrow.",
    "Net force determines an object's acceleration according to its mass.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "Newton's laws",
    diverse: true,
    strictPromptFirst: true,
    coherentPromptFirst: true,
  });
  assert.doesNotMatch(selection.primaryClaims[0], /first equation/iu);
});

test("v5.12 excludes episode dependency metadata without rejecting mathematical series", () => {
  assert.equal(
    questionConceptFailure({
      concept: "layers of abstraction",
      question:
        "What relationship does the series establish between its episodes?",
      answerText:
        "Episodes build on prior episodes but do not depend on one another.",
      explanation:
        "The series says later episodes build on earlier ones without requiring them.",
    }),
    "course_logistics_invalid",
  );
  assert.equal(
    questionConceptFailure({
      concept: "arithmetic series",
      question:
        "What relationship does an arithmetic series establish between successive terms?",
      answerText: "Successive terms differ by a constant amount.",
      explanation:
        "An arithmetic sequence uses the same common difference between successive terms.",
    }),
    null,
  );

  const selection = buildConceptFirstInstructionalSelection(
    [
      "Each episode builds on the previous episode but does not depend on it.",
      "The abacus enables people to perform calculations with movable counters.",
      "A slide rule uses logarithmic scales to support multiplication and division.",
      "The Analytical Engine was designed as a general-purpose mechanical computer.",
    ].join(" "),
    {
      topicHint: "early computing",
      diverse: true,
      strictPromptFirst: true,
      coherentPromptFirst: true,
    },
  );
  const evidence = selection.excerpts.join(" ");
  assert.doesNotMatch(evidence, /episode|previous episode|does not depend/iu);
  assert.match(evidence, /abacus|slide rule|Analytical Engine/iu);

  const mathSelection = buildConceptFirstInstructionalSelection(
    [
      "A geometric series is the sum of terms in a geometric sequence.",
      "A geometric series converges when the absolute value of its common ratio is less than one.",
      "The convergent sum equals the first term divided by one minus the common ratio.",
    ].join(" "),
    {
      topicHint: "geometric series",
      diverse: true,
      strictPromptFirst: true,
      coherentPromptFirst: true,
    },
  );
  assert.match(mathSelection.excerpts.join(" "), /geometric series/iu);
});

test("v5.8 source selection fails closed for logistics-only material", () => {
  const selection = buildConceptFirstInstructionalSelection(
    "Welcome to the course. The exam is worth 40 percent. Office hours begin at noon. Subscribe for updates.",
    { topicHint: "Course introduction" },
  );
  assert.deepEqual(selection.excerpts, []);
  assert.equal(selection.metrics.selectedWindowCount, 0);
});

test("v5.8 source selection excludes attributed and statistic-only measurements", () => {
  const transcript = [
    "Greenhouse gases absorb outgoing infrared radiation and slow the loss of heat from Earth.",
    "The resulting energy imbalance raises surface temperature until incoming and outgoing energy balance again.",
    "The year 2005 was one of the warmest years in the instrumental record.",
    "According to NASA studies, the extent of Arctic sea ice declined about 10 percent over recent decades.",
    "Fossil-fuel combustion adds carbon dioxide to the atmosphere because oxidation converts carbon in the fuel into carbon dioxide.",
    "Warmer ocean water expands, which contributes to sea-level rise alongside water released by melting land ice.",
  ].join(" ");
  const options = {
    conceptFirstV58: true,
    topicHint: "Global warming and the greenhouse effect",
  };
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: options.topicHint,
  });
  const allEvidence = selection.excerpts.join(" ");
  assert.doesNotMatch(allEvidence, /2005|10 percent|according to NASA/iu);
  assert.match(allEvidence, /infrared radiation|fossil-fuel combustion/iu);
  assert.match(allEvidence, /ocean water expands|sea-level rise/iu);
  const primaryFocuses = Array.from({ length: 5 }, (_, ordinal) =>
    focusExcerptForOrdinal(transcript, ordinal, 5, 0, options),
  );
  assert.ok(new Set(primaryFocuses).size >= 2);
  assert.notEqual(primaryFocuses[0], primaryFocuses[1]);
  for (const focus of primaryFocuses) {
    assert.doesNotMatch(focus, /2005|10 percent|according to NASA/iu);
  }
});

test("v5.8 isolates statistics inside punctuation-free auto captions", () => {
  const transcript = [
    "Solar energy reaches Earth and the surface radiates energy back toward space",
    "naturally occurring greenhouse gases absorb some outgoing infrared energy and slow heat loss",
    "human activity intensifies this mechanism because burning fossil fuels adds carbon dioxide to the atmosphere",
    "scientists report that 1998 was the warmest year in measured history with 2005 close behind",
    "according to NASA studies the extent of Arctic sea ice declined about 10 percent in recent decades",
    "warming melts land ice and warmer ocean water expands which together raise sea level",
    "changing temperature and precipitation shift habitat ranges and threaten species that cannot adapt or migrate",
    "energy efficiency reduces fossil fuel demand by providing the same service with less fuel combustion",
    "renewable electricity avoids carbon dioxide emissions during operation by replacing fossil fuel generation",
    "protecting forests keeps stored carbon out of the atmosphere and preserves carbon uptake by living trees",
  ].join(" ");
  const options = {
    conceptFirstV58: true,
    topicHint: "Global warming and the greenhouse effect",
  };
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: options.topicHint,
  });
  assert.ok(selection.metrics.selectedWindowCount >= 5);
  assert.match(
    selection.excerpts[0] ?? "",
    /greenhouse gases|infrared energy|carbon dioxide/iu,
  );
  assert.doesNotMatch(
    selection.excerpts.join(" "),
    /1998|2005|10 percent|according to NASA/iu,
  );
  const primaryFocuses = Array.from({ length: 5 }, (_, ordinal) =>
    focusExcerptForOrdinal(transcript, ordinal, 5, 0, options),
  );
  assert.equal(new Set(primaryFocuses).size, 5);
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

test("v5.8 never flips a planned false item back to true", () => {
  const evidence =
    "A subunit vaccine is made from one antigen that triggers an immune response.";
  const question = constructConceptFirstTrueFalseQuestion(
    { evidenceQuote: evidence, supportedFact: evidence },
    evidence,
    false,
  );
  assert.equal(question?.answer, false);
  assert.match(question?.question ?? "", /not made (?:of|from)/iu);

  const immutable =
    "Cytokines coordinate communication between immune cells during a response.";
  assert.equal(
    constructConceptFirstTrueFalseQuestion(
      { evidenceQuote: immutable, supportedFact: immutable },
      immutable,
      false,
    ),
    null,
  );
});

test("v5.8 rewrites a false explanation from the exact local mutation", () => {
  const evidence =
    "Increasing the resistance decreases current when voltage remains fixed.";
  const question = constructConceptFirstTrueFalseQuestion(
    {
      evidenceQuote: evidence,
      supportedFact: evidence,
      explanation: "The statement is accurate as written.",
    },
    evidence,
    false,
  );
  assert.equal(question?.answer, false);
  assert.match(question?.explanation ?? "", /supported fact|changes/iu);
  assert.doesNotMatch(question?.explanation ?? "", /statement is accurate/iu);
});

test("v5.8 resolves a concise supported fact from a longer evidence window", () => {
  const evidence =
    "Cytokines coordinate immune communication. They activate B and T cells before the adaptive response expands.";
  const question = constructConceptFirstTrueFalseQuestion(
    {
      evidenceQuote: evidence,
      supportedFact: "They activate B and T cells",
    },
    evidence,
    true,
  );
  assert.equal(question?.answer, true);
  assert.equal(question?.question, "They activate B and T cells");
  assert.match(question?.explanation ?? "", /statement is accurate/iu);
});

test("v5.8 excludes production credits from instructional evidence", () => {
  const transcript = [
    "Cytokines activate B and T cells before the adaptive response expands.",
    "This episode was filmed in the Doctor Cheryl C. Kinney Crash Course Studio.",
    "MHC I proteins present short amino-acid chains made from proteins inside a cell.",
  ].join(" ");
  const selection = buildConceptFirstInstructionalSelection(transcript, {
    topicHint: "Immune System",
  });
  assert.ok(selection.excerpts.length >= 1);
  assert.ok(
    selection.excerpts.every(
      (excerpt) => !/episode|filmed|crash course studio/iu.test(excerpt),
    ),
  );
  assert.equal(
    questionConceptFailure({
      concept: "immune response coordination",
      question:
        "This episode was filmed in the Doctor Cheryl C. Kinney Crash Course Studio.",
      explanation: "The episode was produced in that studio.",
      supportedFact:
        "This episode was filmed in the Doctor Cheryl C. Kinney Crash Course Studio.",
      claim: {
        subject: "this episode",
        relation: "was filmed in",
        value: "the Doctor Cheryl C. Kinney Crash Course Studio",
        cluster: "immune response coordination",
      },
    }),
    "course_logistics_invalid",
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

test("bounded presentation cleanup removes only a complete terminal source clause", () => {
  assert.equal(
    stripQuestionSourceFraming(
      "Ice loss amplifies warming, as stated in the material.",
    ),
    "Ice loss amplifies warming",
  );
  assert.equal(
    stripQuestionSourceFraming(
      "The material's thermal-expansion example compares two water volumes.",
    ),
    "The material's thermal-expansion example compares two water volumes.",
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
        "How do people become socialized according to the social process of socialization?",
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
    "How does the estimated annual monetary value of ecosystem services compare to the annual output of the global economy?",
    "What is the projected range of temperature increase by the end of the century?",
  ];
  for (const question of lowValue) {
    expectConceptFailure(
      { ...directConcept, question },
      "low_pedagogical_value",
    );
  }
  expectConceptFailure(
    {
      ...directConcept,
      question:
        "What is the estimated annual monetary value of the services that ecosystems provide for humanity, according to economic calculations?",
    },
    "source_framing_invalid",
  );
  expectConceptFailure(
    {
      ...directConcept,
      question:
        "What method do many organizations advocate to reduce the impact of global warming?",
    },
    "source_framing_invalid",
  );
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
      concept: "socialization mechanism",
      question: "How do people become socialized?",
      answer: "by interacting with other people",
    },
    "question_tautology_invalid",
  );
  expectConceptFailure(
    {
      ...directConcept,
      concept: "depth of processing",
      question: "What does the depth of processing determine?",
      answer: "how deep you dig through the different levels of processing",
      explanation:
        "The depth of processing determines how well information is retained.",
    },
    "question_tautology_invalid",
  );
  expectConceptFailure(
    {
      ...directConcept,
      concept: "depth of processing",
      question: "What does the depth of processing determine?",
      answer: "how well information is retained",
    },
    null,
  );
  expectConceptFailure(
    {
      ...directConcept,
      concept: "memory loss case study",
      question:
        "What caused Clive's inability to remember his past and make new memories?",
      answer:
        "a rare Herpes encephalitis virus that ravaged his central nervous system",
    },
    "low_pedagogical_value",
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
  expectConceptFailure(
    {
      ...directConcept,
      concept: "ecosystem resilience",
      objectiveCategory: "mechanism",
      question:
        "How does biodiversity influence an ecosystem's ability to withstand change?",
      answerText: "The answer, to a large extent, is biodiversity.",
    },
    "question_answer_kind_mismatch",
  );
  expectConceptFailure(
    {
      ...directConcept,
      concept: "ecosystem resilience",
      objectiveCategory: "relationship",
      question:
        "What factor largely determines whether an ecosystem is strong or weak in the face of change?",
      answerText: "biodiversity",
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
  assert.equal(formulaFingerprint("F=ma"), formulaFingerprint("F=m*a"));
  assert.ok(formulaFingerprint("a=(W1-W2)/(m1+m2)"));
  assert.ok(formulaFingerprint("a=F_net/m_total"));
  assert.notEqual(formulaFingerprint("F=m+a"), formulaFingerprint("F=m*a"));
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

test("same climate-cause objective cannot pass under condition and relationship wording", () => {
  const first = {
    type: "multiple_choice",
    concept: "cause of global warming",
    question:
      "What condition is identified as the cause of the recent rise in global temperatures?",
    correctAnswer:
      "human factories power plants and eventually cars have burned fossil fuels",
  };
  const accepted = [
    {
      ...first,
      answer: first.correctAnswer,
      claimKey: claimKeyForCandidate(first),
      conceptCluster: conceptClusterForCandidate(first),
    },
  ];
  assert.equal(
    candidateDuplicatesAccepted(
      {
        type: "multiple_choice",
        concept: "cause of global warming",
        question: "What is driving the recent rise in global temperatures?",
        correctAnswer: "human activity",
      },
      accepted,
      5,
    ),
    true,
  );
});

test("a complete grounded assertion can receive a deterministic safe MC stem", () => {
  assert.equal(
    repairMultipleChoiceQuestionKind(
      {
        concept: "greenhouse gas concentration trend",
        objectiveCategory: "relationship",
        question:
          "What condition do industrialized nations provide for greenhouse gases?",
      },
      "The concentration of greenhouse gases in the atmosphere will continue to rise.",
    ),
    "Which statement correctly describes greenhouse gas concentration trend?",
  );
  assert.equal(
    repairMultipleChoiceQuestionKind(
      { concept: "language variation", objectiveCategory: "relationship" },
      "degrees of variation among speakers",
    ),
    null,
  );
  assert.equal(
    repairMultipleChoiceQuestionKind(
      { concept: "ecosystem vulnerability", objectiveCategory: "mechanism" },
      "even without catastrophic events",
    ),
    null,
  );
  assert.equal(
    repairMultipleChoiceQuestionKind(
      { concept: "温室气体浓度变化", objectiveCategory: "relationship" },
      "温室气体的浓度会继续上升。",
    ),
    "请选择正确描述温室气体浓度变化的陈述。",
  );
});

test("resolved answer propositions block the live coral habitat duplicate", () => {
  const first = {
    type: "multiple_choice",
    concept: "coral reef biodiversity support",
    objectiveCategory: "mechanism",
    question: "How does coral support biodiversity in reef ecosystems?",
    correctAnswer:
      "It provides key microhabitats, shelter and breeding grounds for thousand of species of fish, crustaceans and mollusks.",
  };
  const accepted = [
    {
      ...first,
      answer: first.correctAnswer,
      claimKey: claimKeyForCandidate(first),
      conceptCluster: conceptClusterForCandidate(first),
    },
  ];
  assert.equal(
    candidateDuplicatesAccepted(
      {
        type: "multiple_choice",
        concept: "coral reef interdependence",
        objectiveCategory: "method",
        question: "How do corals support other organisms in reef ecosystems?",
        correctAnswer:
          "It provides key microhabitats, shelter and breeding grounds for thousands of species of fish, crustaceans and mollusks.",
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
