// TypeScript resolves this facade during static analysis. Metro's platform
// resolver selects the sibling .web.ts, .android.ts, or .ios.ts
// implementation at bundle time (see `chat-client.web.ts` for details on the
// shared `workplaceChatClient` export every platform file provides).
export * from "./chat-client.web";
