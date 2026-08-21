// TypeScript resolves this facade during static analysis. Metro's platform
// resolver selects the sibling .web.ts or .android.ts implementation at runtime.
export * from "./local-generation-client.web";
