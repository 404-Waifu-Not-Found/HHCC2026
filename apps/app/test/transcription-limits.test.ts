import { describe, expect, it } from "vitest";
import {
  WEB_TRANSCRIPTION_MAX_SECONDS,
  canTranscribeInBrowser,
} from "../src/transcription/limits";

describe("browser transcription limit", () => {
  it("allows the documented limit and rejects larger buffered media", () => {
    expect(canTranscribeInBrowser(WEB_TRANSCRIPTION_MAX_SECONDS)).toBe(true);
    expect(canTranscribeInBrowser(WEB_TRANSCRIPTION_MAX_SECONDS + 1)).toBe(
      false,
    );
  });
});
