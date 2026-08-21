import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-sharing", () => ({}));
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
        title: "Limits → continuity",
        source: "youtube",
        summary: "As x → a, compare the left and right behavior.",
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
