import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-sharing", () => ({}));
vi.mock("expo-asset", () => ({
  Asset: {
    fromModule: () => ({
      downloadAsync: async () => undefined,
      uri: "file:///NotoSansKR-Regular.ttf",
      localUri: undefined,
    }),
  },
}));
let assetFetchCount = 0;
vi.stubGlobal(
  "fetch",
  vi.fn(async () => {
    assetFetchCount += 1;
    const assetUrl =
      assetFetchCount === 1
        ? new URL("../assets/fonts/NotoSansKR-Regular.ttf", import.meta.url)
        : new URL("../assets/platform/app-icon-1024.png", import.meta.url);
    const bytes = await readFile(assetUrl);
    return new Response(bytes);
  }),
);
vi.mock("../src/lib/api", () => ({
  apiBinaryRequest: vi.fn(),
  apiRequest: vi.fn(),
  ClientApiError: class ClientApiError extends Error {},
  jsonBody: vi.fn(),
}));
vi.mock("../src/generation/local-generation-client", () => ({
  requestLocalCheatSheet: vi.fn(),
}));

import { renderCheatSheetPdf } from "../src/lib/cheat-sheet";

describe("cheat-sheet PDF rendering", () => {
  it("renders Unicode arrows from generated notes with the built-in fonts", async () => {
    await expect(
      renderCheatSheetPdf({
        title: "한국어 → continuity",
        source: "youtube",
        summary: "한국어 요약: As x → a, compare the left and right behavior.",
        keyConcepts: ["A limit can exist even when f(a) is undefined."],
        definitions: [],
        formulas: ["x ≤ a and x ≥ a"],
        rememberThis: ["Use ε → 0 when checking the definition."],
        generatedAt: "2026-08-21T00:00:00.000Z",
        sourceRevision: "video:test",
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
