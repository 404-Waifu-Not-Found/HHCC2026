import { describe, expect, it } from "vitest";
import { readResponseErrorMessage } from "../src/lib/response-error";

describe("readResponseErrorMessage", () => {
  it("uses a structured API error message", async () => {
    const response = Response.json(
      { error: { code: "audio_stream_unavailable", message: "YouTube temporarily blocked audio delivery." } },
      { status: 502 },
    );
    await expect(readResponseErrorMessage(response, "fallback")).resolves.toBe(
      "YouTube temporarily blocked audio delivery.",
    );
  });

  it("falls back for non-JSON and malformed JSON responses", async () => {
    await expect(
      readResponseErrorMessage(new Response("upstream failure", { status: 502 }), "Audio delivery failed (502)."),
    ).resolves.toBe("Audio delivery failed (502).");
    await expect(
      readResponseErrorMessage(
        new Response("{", { status: 502, headers: { "content-type": "application/json" } }),
        "Audio delivery failed (502).",
      ),
    ).resolves.toBe("Audio delivery failed (502).");
  });
});
