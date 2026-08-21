// TypeScript resolves this facade during static analysis. Metro's platform
// resolver selects the sibling .web.ts, .android.ts, or .ios.ts implementation.
export * from "./local-generation-client.web";
