// The Workplace chat orchestrator is a browser-API-free, platform-neutral
// module shared with the native clients. During development and node tests this
// re-export resolves through the workspace package; the release build replaces
// this file with an esbuild-bundled, self-contained copy so the unpacked
// extension never depends on a bare module specifier at runtime.
export * from "../../../packages/local-quiz-engine/src/workplace-chat.js";
