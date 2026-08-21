import { describe, expect, it } from "vitest";
import { SpeechModelManifestSchema } from "../src/transcription/types";

const validManifest = {
  version: 1,
  modelId: "whisper-tiny",
  revision: "ff4177021cc41f7db950912b73ea4fdf7d01d8e7",
  web: {
    repository: "onnx-community/whisper-tiny",
    sizeBytes: 45_000_000,
    files: [
      {
        path: "onnx/encoder_model_quantized.onnx",
        sizeBytes: 10,
        sha256: "a".repeat(64),
      },
    ],
  },
  native: {
    file: {
      path: "native/ggml-tiny-q5_1.bin",
      sizeBytes: 32_152_673,
      sha256: "b".repeat(64),
    },
  },
};

describe("speech model manifest", () => {
  it("accepts pinned model metadata with SHA-256 digests", () => {
    expect(SpeechModelManifestSchema.parse(validManifest)).toEqual(
      validManifest,
    );
  });

  it("rejects a different model repository or malformed digest", () => {
    expect(
      SpeechModelManifestSchema.safeParse({
        ...validManifest,
        web: { ...validManifest.web, repository: "untrusted/model" },
      }).success,
    ).toBe(false);
    expect(
      SpeechModelManifestSchema.safeParse({
        ...validManifest,
        native: { file: { ...validManifest.native.file, sha256: "not-a-sha" } },
      }).success,
    ).toBe(false);
  });
});
