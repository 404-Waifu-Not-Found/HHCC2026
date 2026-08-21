#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { runHeadlessQuiz } from "./run-quiz.js";

function usage() {
  return `Usage:
  npm run qa:quiz -- --url <youtube-url> [options]
  npm run qa:quiz -- --file <newline-separated-urls> [options]

Options:
  --count <5|10|15>              Number of questions (default: 10)
  --types <csv|all>              Question types (default: all)
  --transport <native-json|stream|both>
                                  DeepSeek response transport (default: native-json)
  --language <en|zh-CN>          Quiz language (default: en)
  --caption-language <code>      Preferred caption language
  --answer-and-grade             Grade every stored correct answer through DeepSeek
  --interrupt-after <number>     Inject one network interruption after N accepted questions
  --output <directory>           Artifact directory (default: output/headless)
  --no-artifacts                 Print only; do not write text/JSON/JSONL files
  --help                         Show this help

Credential:
  CLIPQUEST_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY must contain the local key.
`;
}

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    file: { type: "string" },
    count: { type: "string", default: "10" },
    types: { type: "string", default: "all" },
    transport: { type: "string", default: "native-json" },
    language: { type: "string", default: "en" },
    "caption-language": { type: "string" },
    "answer-and-grade": { type: "boolean", default: false },
    "interrupt-after": { type: "string" },
    output: { type: "string", default: "output/headless" },
    "no-artifacts": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(usage());
  process.exit(0);
}
if ((!values.url && !values.file) || (values.url && values.file)) {
  process.stderr.write(
    `${usage()}\nError: provide exactly one of --url or --file.\n`,
  );
  process.exit(2);
}

const urls = values.file
  ? (await readFile(resolve(values.file), "utf8"))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  : [values.url];
if (urls.length === 0) {
  process.stderr.write(
    "Error: the URL file did not contain any video links.\n",
  );
  process.exit(2);
}
const transports =
  values.transport === "both" ? ["native-json", "stream"] : [values.transport];
const failures = [];
for (let urlIndex = 0; urlIndex < urls.length; urlIndex += 1) {
  for (const transport of transports) {
    try {
      if (urls.length > 1 || transports.length > 1) {
        process.stdout.write(
          `\n=== RUN ${urlIndex + 1}/${urls.length} · ${transport} ===\n`,
        );
      }
      const result = await runHeadlessQuiz({
        url: urls[urlIndex],
        apiKey:
          process.env.CLIPQUEST_DEEPSEEK_API_KEY ??
          process.env.DEEPSEEK_API_KEY,
        questionCount: Number(values.count),
        questionTypes: values.types,
        transport,
        quizLanguage: values.language,
        preferredLanguage: values["caption-language"],
        answerAndGrade: values["answer-and-grade"],
        interruptAfter:
          values["interrupt-after"] === undefined
            ? undefined
            : Number(values["interrupt-after"]),
      });
      if (!values["no-artifacts"]) {
        const timestamp = new Date().toISOString().replaceAll(":", "-");
        const basename = `${timestamp}-${result.source.videoId}-${result.configuration.transport}`;
        const paths = await result.reporter.writeArtifacts({
          directory: resolve(values.output),
          basename,
          result: {
            ...result,
            reporter: undefined,
          },
        });
        result.reporter.line("");
        result.reporter.line(`Artifacts: ${JSON.stringify(paths)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ url: urls[urlIndex], transport, message });
      process.stderr.write(`\nHEADLESS_QA_FAILED: ${message}\n`);
    }
  }
}
if (failures.length > 0) {
  process.stderr.write(
    `\nHEADLESS_QA_SUMMARY: ${failures.length}/${urls.length * transports.length} runs failed.\n`,
  );
  process.exitCode = 1;
} else if (urls.length > 1 || transports.length > 1) {
  process.stdout.write(
    `\nHEADLESS_QA_SUMMARY: ${urls.length * transports.length}/${urls.length * transports.length} runs passed.\n`,
  );
}
