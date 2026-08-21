import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = resolve(root, ".model-cache");
const webRevision = "ff4177021cc41f7db950912b73ea4fdf7d01d8e7";
const nativeRevision = "98aa99a0a9db05ae2342309f5096248665f7cba3";
const webRepository = "onnx-community/whisper-tiny";
const webFiles = [
  "added_tokens.json",
  "config.json",
  "generation_config.json",
  "merges.txt",
  "normalizer.json",
  "onnx/decoder_model_merged_quantized.onnx",
  "onnx/encoder_model_quantized.onnx",
  "preprocessor_config.json",
  "quantize_config.json",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
];
const native = {
  repository: "ggerganov/whisper.cpp",
  sourcePath: "ggml-tiny-q5_1.bin",
  targetPath: "native/ggml-tiny-q5_1.bin",
  sizeBytes: 32_152_673,
  sha256: "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7",
};

mkdirSync(cache, { recursive: true });
const preparedWeb = [];
for (const path of webFiles) {
  const target = resolve(cache, "web", path);
  await downloadPinnedFile(webRepository, webRevision, path, target);
  preparedWeb.push({ path, sizeBytes: statSync(target).size, sha256: await sha256(target) });
}
const nativeTarget = resolve(cache, native.targetPath);
await downloadPinnedFile(native.repository, nativeRevision, native.sourcePath, nativeTarget);
const nativeDigest = await sha256(nativeTarget);
if (statSync(nativeTarget).size !== native.sizeBytes || nativeDigest !== native.sha256) {
  throw new Error("Pinned native Whisper model failed its expected size or SHA-256 check.");
}

const manifest = {
  version: 1,
  modelId: "whisper-tiny",
  revision: webRevision,
  web: {
    repository: webRepository,
    sizeBytes: preparedWeb.reduce((total, file) => total + file.sizeBytes, 0),
    files: preparedWeb,
  },
  native: {
    file: { path: native.targetPath, sizeBytes: native.sizeBytes, sha256: native.sha256 },
  },
};
await writeFile(resolve(cache, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared ${(manifest.web.sizeBytes / 1_000_000).toFixed(1)} MB web model and ${(native.sizeBytes / 1_000_000).toFixed(1)} MB native model.`);

async function downloadPinnedFile(repository, revision, path, target) {
  if (existsSync(target) && statSync(target).size > 0) return;
  mkdirSync(dirname(target), { recursive: true });
  const url = `https://huggingface.co/${repository}/resolve/${revision}/${path}?download=true`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Failed to download ${repository}/${path}: ${response.status}`);
  console.log(`Downloading ${repository}/${path}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

function sha256(path) {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolveDigest(hash.digest("hex")));
  });
}
