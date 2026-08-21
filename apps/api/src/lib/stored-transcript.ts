import {
  TranscriptCompletenessSchema,
  TranscriptSegmentSchema,
} from "@clipquest/contracts";
import { z } from "zod";

export const StoredTranscriptSchema = z
  .object({
    version: z.literal(1),
    videoId: z.string().uuid(),
    language: z.string().min(2).max(35),
    origin: z.enum(["captions", "device_whisper", "browser_tab_capture"]),
    acquisition: z
      .enum([
        "server_captions",
        "youtube_signed_captions",
        "youtube_text_provider",
        "youtube_browser_extension",
        "device_whisper",
        "browser_tab_capture",
      ])
      .optional(),
    completeness: TranscriptCompletenessSchema,
    quality: z
      .object({
        schemaVersion: z.literal(1),
        validatorVersion: z.string().min(1),
        origin: z.enum(["captions", "device_whisper", "browser_tab_capture"]),
        expectedDurationMs: z.number().int().positive(),
        timelineCoverageRatio: z.number().nonnegative(),
        unionCoverageRatio: z.number().nonnegative(),
        firstStartMs: z.number().int().nonnegative(),
        lastEndMs: z.number().int().positive(),
        largestInternalGapMs: z.number().int().nonnegative(),
        lexicalUnits: z.number().int().nonnegative(),
        tokenRatePerMinute: z.number().nullable(),
        repeatedPhraseMatches: z.number().int().nonnegative(),
        repeatedSpeechLoop: z.boolean(),
        repetitionScanComplete: z.boolean(),
        languageCheck: z.enum(["english", "chinese", "not_applicable"]),
      })
      .strict()
      .optional(),
    segments: z.array(TranscriptSegmentSchema).min(1),
  })
  .strict();
