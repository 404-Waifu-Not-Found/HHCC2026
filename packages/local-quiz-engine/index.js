// The Chrome extension generator is deliberately browser-API free. Re-export
// that implementation so native clients execute the identical prompt, parser,
// validator, shuffle, and retry code. Platform transports are injected through
// generateLocalQuiz's adapters argument.
export * from "./src/local-generator.js";

// Workplace chat orchestration shares the same browser/platform-free posture:
// a stateless, client-managed DeepSeek tool-calling loop whose source execution
// and streaming are injected by native/extension adapters.
export * from "./src/workplace-chat.js";
