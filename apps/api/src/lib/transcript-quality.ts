import type { TranscriptSegment } from "@clipquest/contracts";

export const TRANSCRIPT_QUALITY_VERSION = "transcript-quality-v1";

const MIN_LOCAL_TIMELINE_COVERAGE = 0.95;
const MIN_CAPTION_TIMELINE_COVERAGE = 0.8;
const REPEATED_PHRASE_UNITS = 8;
const MAX_REPETITION_WINDOWS = 150_000;

export type TranscriptQualityOrigin =
  "captions" | "device_whisper" | "browser_tab_capture";

export type TranscriptQualityIssueCode =
  | "duration_coverage_insufficient"
  | "timeline_edge_missing"
  | "timeline_gap_excessive"
  | "timeline_out_of_bounds"
  | "repeated_phrase_across_timeline"
  | "repeated_speech_loop"
  | "repetition_scan_incomplete"
  | "language_mismatch"
  | "token_rate_implausible"
  | "speech_content_insufficient";

export type TranscriptQualitySummary = {
  schemaVersion: 1;
  validatorVersion: typeof TRANSCRIPT_QUALITY_VERSION;
  origin: TranscriptQualityOrigin;
  expectedDurationMs: number;
  timelineCoverageRatio: number;
  unionCoverageRatio: number;
  firstStartMs: number;
  lastEndMs: number;
  largestInternalGapMs: number;
  lexicalUnits: number;
  tokenRatePerMinute: number | null;
  repeatedPhraseMatches: number;
  repeatedSpeechLoop: boolean;
  repetitionScanComplete: boolean;
  languageCheck: "english" | "chinese" | "not_applicable";
};

export type TranscriptQualityResult = {
  passed: boolean;
  issueCodes: TranscriptQualityIssueCode[];
  summary: TranscriptQualitySummary;
};

type TranscriptQualityInput = {
  origin: TranscriptQualityOrigin;
  language: string;
  expectedDurationMs: number;
  segments: TranscriptSegment[];
};

type TimelineMetrics = {
  firstStartMs: number;
  lastEndMs: number;
  timelineCoverageRatio: number;
  unionCoverageRatio: number;
  largestInternalGapMs: number;
};

type RepetitionMetrics = {
  repeatedPhraseMatches: number;
  repeatedSpeechLoop: boolean;
  repetitionScanComplete: boolean;
};

type ScriptMetrics = {
  latinLetters: number;
  hanCharacters: number;
  lexicalUnits: number;
};

/**
 * Performs only structural, transcript-derived checks. It never normalizes or
 * mutates the supplied segments and never returns transcript text, phrases, or
 * model-facing prompts. That keeps the original stored caption identity intact
 * and makes the returned summary safe for structured logs.
 */
export function validateTranscriptQuality(
  input: TranscriptQualityInput,
): TranscriptQualityResult {
  const expectedDurationMs = input.expectedDurationMs;
  const localSpeech = input.origin !== "captions";
  const timeline = timelineMetrics(input.segments, expectedDurationMs);
  const scripts = scriptMetrics(input.segments);
  const repetition = localSpeech
    ? repetitionMetrics(input.segments, expectedDurationMs)
    : {
        repeatedPhraseMatches: 0,
        repeatedSpeechLoop: false,
        repetitionScanComplete: true,
      };
  const durationMinutes = expectedDurationMs / 60_000;
  const languageCheck = languageCheckKind(input.language);
  const tokenRatePerMinute = localSpeech
    ? roundMetric(scripts.lexicalUnits / durationMinutes)
    : null;
  const issues = new Set<TranscriptQualityIssueCode>();

  const minimumCoverage = localSpeech
    ? MIN_LOCAL_TIMELINE_COVERAGE
    : MIN_CAPTION_TIMELINE_COVERAGE;
  if (
    !Number.isFinite(timeline.timelineCoverageRatio) ||
    timeline.timelineCoverageRatio < minimumCoverage
  ) {
    issues.add("duration_coverage_insufficient");
  }

  const edgeAllowanceMs = localSpeech
    ? Math.max(1_000, expectedDurationMs * 0.05)
    : Math.min(90_000, Math.max(10_000, expectedDurationMs * 0.1));
  if (
    timeline.firstStartMs > edgeAllowanceMs ||
    expectedDurationMs - timeline.lastEndMs > edgeAllowanceMs
  ) {
    issues.add("timeline_edge_missing");
  }

  const overrunAllowanceMs = Math.max(5_000, expectedDurationMs * 0.02);
  if (
    timeline.firstStartMs >= expectedDurationMs ||
    timeline.lastEndMs > expectedDurationMs + overrunAllowanceMs
  ) {
    issues.add("timeline_out_of_bounds");
  }

  const maximumGapMs = localSpeech
    ? Math.min(45_000, Math.max(15_000, expectedDurationMs * 0.08))
    : Math.min(120_000, Math.max(30_000, expectedDurationMs * 0.15));
  if (timeline.largestInternalGapMs > maximumGapMs) {
    issues.add("timeline_gap_excessive");
  }

  if (localSpeech) {
    if (repetition.repeatedPhraseMatches > 0) {
      issues.add("repeated_phrase_across_timeline");
    }
    if (repetition.repeatedSpeechLoop) {
      issues.add("repeated_speech_loop");
    }
    if (!repetition.repetitionScanComplete) {
      issues.add("repetition_scan_incomplete");
    }

    if (!languageIsConsistent(languageCheck, scripts)) {
      issues.add("language_mismatch");
    }

    const plausibleRate = tokenRateIsPlausible(
      languageCheck,
      tokenRatePerMinute ?? 0,
    );
    if (!plausibleRate) issues.add("token_rate_implausible");

    const minimumLexicalUnits = Math.max(
      languageCheck === "chinese" ? 12 : 8,
      Math.floor(durationMinutes * (languageCheck === "chinese" ? 20 : 12)),
    );
    if (scripts.lexicalUnits < minimumLexicalUnits) {
      issues.add("speech_content_insufficient");
    }
  }

  return {
    passed: issues.size === 0,
    issueCodes: [...issues],
    summary: {
      schemaVersion: 1,
      validatorVersion: TRANSCRIPT_QUALITY_VERSION,
      origin: input.origin,
      expectedDurationMs,
      timelineCoverageRatio: roundMetric(timeline.timelineCoverageRatio),
      unionCoverageRatio: roundMetric(timeline.unionCoverageRatio),
      firstStartMs: timeline.firstStartMs,
      lastEndMs: timeline.lastEndMs,
      largestInternalGapMs: timeline.largestInternalGapMs,
      lexicalUnits: scripts.lexicalUnits,
      tokenRatePerMinute,
      repeatedPhraseMatches: repetition.repeatedPhraseMatches,
      repeatedSpeechLoop: repetition.repeatedSpeechLoop,
      repetitionScanComplete: repetition.repetitionScanComplete,
      languageCheck,
    },
  };
}

function timelineMetrics(
  segments: TranscriptSegment[],
  expectedDurationMs: number,
): TimelineMetrics {
  const firstStartMs = segments[0]?.startMs ?? expectedDurationMs;
  const lastEndMs = segments.reduce(
    (latest, segment) => Math.max(latest, segment.endMs),
    0,
  );
  let cursorMs = 0;
  let coveredMs = 0;
  let largestInternalGapMs = 0;
  let seenTimeline = false;

  for (const segment of segments) {
    const startMs = clamp(segment.startMs, 0, expectedDurationMs);
    const endMs = clamp(segment.endMs, 0, expectedDurationMs);
    if (endMs <= startMs) continue;
    if (seenTimeline && startMs > cursorMs) {
      largestInternalGapMs = Math.max(largestInternalGapMs, startMs - cursorMs);
    }
    if (endMs > cursorMs) {
      coveredMs += Math.max(0, endMs - Math.max(startMs, cursorMs));
      cursorMs = endMs;
    }
    seenTimeline = true;
  }

  const boundedFirstMs = clamp(firstStartMs, 0, expectedDurationMs);
  const boundedLastMs = clamp(lastEndMs, 0, expectedDurationMs);
  return {
    firstStartMs,
    lastEndMs,
    timelineCoverageRatio:
      expectedDurationMs > 0
        ? Math.max(0, boundedLastMs - boundedFirstMs) / expectedDurationMs
        : 0,
    unionCoverageRatio:
      expectedDurationMs > 0 ? coveredMs / expectedDurationMs : 0,
    largestInternalGapMs,
  };
}

function repetitionMetrics(
  segments: TranscriptSegment[],
  expectedDurationMs: number,
): RepetitionMetrics {
  const unrelatedDistanceMs = Math.min(
    120_000,
    Math.max(30_000, expectedDurationMs * 0.1),
  );
  const occurrences = new Map<
    string,
    {
      firstSegmentIndex: number;
      firstStartMs: number;
      lastCountedSegmentIndex: number;
      distantCount: number;
    }
  >();
  const repeated = new Set<string>();
  let repeatedSpeechLoop = false;
  let windowsVisited = 0;

  for (
    let segmentIndex = 0;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    const segment = segments[segmentIndex];
    if (!segment) continue;
    const units = repetitionUnits(segment.text);
    for (
      let unitIndex = 0;
      unitIndex + REPEATED_PHRASE_UNITS <= units.length;
      unitIndex += 1
    ) {
      windowsVisited += 1;
      if (windowsVisited > MAX_REPETITION_WINDOWS) {
        return {
          repeatedPhraseMatches: repeated.size,
          repeatedSpeechLoop,
          repetitionScanComplete: false,
        };
      }
      const signature = units
        .slice(unitIndex, unitIndex + REPEATED_PHRASE_UNITS)
        .join("\u001f");
      const previous = occurrences.get(signature);
      if (!previous) {
        occurrences.set(signature, {
          firstSegmentIndex: segmentIndex,
          firstStartMs: segment.startMs,
          lastCountedSegmentIndex: segmentIndex,
          distantCount: 1,
        });
        continue;
      }
      if (
        segmentIndex <= previous.firstSegmentIndex + 1 ||
        segment.startMs - previous.firstStartMs < unrelatedDistanceMs ||
        segmentIndex === previous.lastCountedSegmentIndex
      ) {
        continue;
      }
      repeated.add(signature);
      previous.distantCount += 1;
      previous.lastCountedSegmentIndex = segmentIndex;
      if (previous.distantCount >= 3) repeatedSpeechLoop = true;
    }
  }
  return {
    repeatedPhraseMatches: repeated.size,
    repeatedSpeechLoop,
    repetitionScanComplete: true,
  };
}

function repetitionUnits(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/\p{Script=Han}|[\p{L}\p{N}]+/gu) ?? []
  );
}

function scriptMetrics(segments: TranscriptSegment[]): ScriptMetrics {
  let latinLetters = 0;
  let hanCharacters = 0;
  let lexicalUnits = 0;
  for (const segment of segments) {
    const normalized = segment.text.normalize("NFKC");
    latinLetters += normalized.match(/\p{Script=Latin}/gu)?.length ?? 0;
    hanCharacters += normalized.match(/\p{Script=Han}/gu)?.length ?? 0;
    lexicalUnits += repetitionUnits(normalized).length;
  }
  return { latinLetters, hanCharacters, lexicalUnits };
}

function languageCheckKind(
  language: string,
): TranscriptQualitySummary["languageCheck"] {
  const normalized = language.trim().toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-")) return "english";
  if (normalized === "zh" || normalized.startsWith("zh-")) return "chinese";
  return "not_applicable";
}

function languageIsConsistent(
  language: TranscriptQualitySummary["languageCheck"],
  scripts: ScriptMetrics,
): boolean {
  const knownScriptCharacters = scripts.latinLetters + scripts.hanCharacters;
  if (language === "not_applicable" || knownScriptCharacters < 20) return true;
  if (language === "english") {
    return scripts.latinLetters / knownScriptCharacters >= 0.6;
  }
  return scripts.hanCharacters / knownScriptCharacters >= 0.35;
}

function tokenRateIsPlausible(
  language: TranscriptQualitySummary["languageCheck"],
  rate: number,
): boolean {
  if (!Number.isFinite(rate)) return false;
  if (language === "chinese") return rate >= 30 && rate <= 600;
  if (language === "not_applicable") return rate >= 15 && rate <= 600;
  return rate >= 15 && rate <= 320;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
