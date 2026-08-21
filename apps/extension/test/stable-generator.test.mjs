import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  adaptiveChunkQuestionCount,
  boundedRetryDelayMilliseconds,
  buildQuestionTypePlanFromSeed,
  buildTrueFalseAnswerPlanFromSeed,
  CONCEPT_FIRST_SYSTEM_PROMPT,
  PROMPT_FIRST_SYSTEM_PROMPT,
  generateQuizFromPlainText,
  normalizeGeneratedQuestion,
  serializeFormulaTokens,
} from "../src/local-generator.js";

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
  const focusExcerpt = task.match(
    /Instructional evidence:\n([\s\S]*?)\n\nAlready accepted questions and concepts/u,
  )?.[1];
  assert.ok(focusExcerpt, "request contains one instructional window");
  return {
    body,
    task,
    ordinal: Number(slot[1]),
    type: slot[3],
    polarity: /Required answer polarity: true\./u.test(task),
    focusExcerpt,
  };
}

function promptFirstResponse(request, mutate = (value) => value) {
  const task = promptFirstTaskFromRequest(request);
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
        ? {
            ...common,
            question: task.polarity
              ? `Pathway ${task.ordinal} transfers energy between the states.`
              : `Pathway ${task.ordinal} prevents energy transfer between the states.`,
            answer: task.polarity,
            correction: `Pathway ${task.ordinal} transfers energy between the states.`,
          }
        : {
            ...common,
            question: `What term names energy route ${task.ordinal}?`,
            answer: `route ${task.ordinal}`,
            gradingMode: "atomic_term",
          };
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
        const groundedSentence = sentence.replace(
          "pathway",
          `pathway${index + 1}`,
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
  const pathway = evidence.match(/pathway\d+/u)?.[0];
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
              answerText: isChinese ? `能量传递路径${pathway}` : pathway,
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

test("v5.9 sends the compact prompt-first singleton contract and accepts gradeable output immediately", async (context) => {
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
    promptFirstInput(),
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
  assert.equal(
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
    promptFirstInput(5, ["multiple_choice"]),
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
    promptFirstInput(5, ["multiple_choice"]),
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

test("v5.8 repairs learner-visible source-language leakage before storing a question", async (context) => {
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
        value.questions[0].answerText = "وقود أحفوري";
        value.questions[0].distractors[0].text = "غازات دفيئة";
      }
      return value;
    });
  };

  const result = await generateQuizFromPlainText(
    conceptFirstInput(),
    "sk-local-test",
    () => undefined,
    undefined,
    () => undefined,
    (event) => calls.push(event),
  );

  assert.equal(result.quiz.questions.length, 5);
  assert.equal(httpCalls, 6);
  assert.equal(result.metrics.retryCount, 1);
  assert.ok(
    result.quiz.questions.every((question) =>
      question.type !== "multiple_choice"
        ? true
        : question.choices.every(
            (choice) => !/[\p{Script=Arabic}\p{Script=Han}]/u.test(choice),
          ),
    ),
  );
  assert.ok(
    calls.some(
      (event) =>
        event.lifecycleState === "completed" &&
        event.outcome === "quiz_language_mismatch",
    ),
  );
  assert.equal(
    calls.filter(
      (event) =>
        event.lifecycleState === "started" &&
        event.classification === "automatic_retry",
    ).length,
    1,
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
      throw new Error(
        `Recorded benchmark bank ${bankIndex + 1} failed (${questionCount} questions).`,
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
  assert.equal(fetchCount, 5);
  assert.deepEqual(
    events.map((event) => event.classification),
    [
      "primary",
      "automatic_retry",
      "automatic_retry",
      "automatic_retry",
      "automatic_retry",
    ],
  );
  assert.deepEqual(
    events.slice(1).map((event) => event.retryKind),
    ["content_repair", "content_repair", "content_repair", "content_repair"],
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
  test(`${failure.name} exhausts exactly four bounded automatic retries`, async (context) => {
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
    assert.equal(fetchCount, 5);
    assert.equal(events.length, 5);
    assert.deepEqual(
      events.map((event) => event.classification),
      [
        "primary",
        "automatic_retry",
        "automatic_retry",
        "automatic_retry",
        "automatic_retry",
      ],
    );
    assert.deepEqual(
      events.map((event) => event.outcome),
      [
        failure.expected,
        failure.expected,
        failure.expected,
        failure.expected,
        failure.expected,
      ],
    );
    assert.equal(events[1].retryKind, failure.retryKind);
    assert.equal(events[2].retryKind, failure.retryKind);
    assert.equal(events[3].retryKind, failure.retryKind);
    assert.equal(events[4].retryKind, failure.retryKind);
    assert.equal(events[4].retryDelayMs, 0);
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
        event.detail.maxAttempts === 5 &&
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
  assert.ok(requests.every((request) => request.thinking.type === "enabled"));
  assert.ok(requests.every((request) => request.reasoning_effort === "high"));
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
  assert.ok(requests.every((request) => request.thinking.type === "enabled"));
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
