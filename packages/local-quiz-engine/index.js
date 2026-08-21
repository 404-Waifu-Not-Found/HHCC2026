// The Chrome extension generator is deliberately browser-API free. Re-export
// that implementation so native clients execute the identical prompt, parser,
// validator, shuffle, and retry code. Platform transports are injected through
// generateLocalQuiz's adapters argument.
export * from "./src/local-generator.js";
