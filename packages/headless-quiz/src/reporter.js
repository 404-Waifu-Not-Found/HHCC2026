import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function elapsedLabel(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function scalar(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  return JSON.stringify(value);
}

function detailText(event) {
  return Object.entries(event)
    .filter(
      ([key, value]) =>
        key !== "type" && key !== "elapsedMs" && value !== undefined,
    )
    .map(([key, value]) => `${key}=${scalar(value)}`)
    .join(" ");
}

export function createHeadlessReporter(options = {}) {
  const startedAt = options.startedAt ?? Date.now();
  const events = [];
  const lines = [];
  const output =
    options.output ?? ((line) => process.stdout.write(`${line}\n`));

  function line(value = "") {
    lines.push(value);
    output(value);
  }

  function event(type, details = {}) {
    const value = {
      type,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      ...details,
    };
    events.push(value);
    const detail = detailText(value);
    line(
      `[${elapsedLabel(value.elapsedMs)}] ${type}${detail ? ` ${detail}` : ""}`,
    );
    return value;
  }

  return {
    startedAt,
    events,
    lines,
    line,
    event,
    async writeArtifacts({ directory, basename, result }) {
      await mkdir(directory, { recursive: true });
      const textPath = join(directory, `${basename}.txt`);
      const jsonPath = join(directory, `${basename}.json`);
      const jsonlPath = join(directory, `${basename}.jsonl`);
      await Promise.all([
        writeFile(textPath, `${lines.join("\n")}\n`, "utf8"),
        writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
        writeFile(
          jsonlPath,
          `${events.map((value) => JSON.stringify(value)).join("\n")}\n`,
          "utf8",
        ),
      ]);
      return { textPath, jsonPath, jsonlPath };
    },
  };
}
