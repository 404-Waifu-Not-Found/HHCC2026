import { cpSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "../..");
const output = resolve(appRoot, "public/runtime");
mkdirSync(output, { recursive: true });

const extensionRoot = resolve(workspaceRoot, "apps/extension");
execFileSync(process.execPath, [resolve(extensionRoot, "scripts/build.mjs")], {
  cwd: extensionRoot,
  stdio: "inherit",
});
cpSync(
  resolve(extensionRoot, "dist/clipquest-captions-extension.zip"),
  resolve(appRoot, "public/clipquest-captions-extension.zip"),
);

const files = [
  [
    "node_modules/@huggingface/transformers/dist/transformers.web.min.js",
    "transformers.web.min.js",
  ],
  [
    "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs",
    "ort-wasm-simd-threaded.jsep.mjs",
  ],
  [
    "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm",
    "ort-wasm-simd-threaded.jsep.wasm",
  ],
  [
    "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.mjs",
  ],
  [
    "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
    "ort-wasm-simd-threaded.wasm",
  ],
];

for (const [source, destination] of files) {
  cpSync(resolve(workspaceRoot, source), resolve(output, destination));
}
