import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../src/lib/api";
import {
  createQuizShareLink,
  shareQuizLink,
  type ShareQuizLinkDeps,
} from "../src/lib/quiz-share";

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  Share: { share: vi.fn(async () => ({ action: "sharedAction" })) },
}));
vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(async () => true),
}));
vi.mock("../src/lib/api", () => ({
  apiRequest: vi.fn(async () => ({
    token: "9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a",
    url: "https://clipquest.ccwu.cc/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a",
  })),
}));

const link = {
  url: "https://clipquest.ccwu.cc/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a",
  title: "How memory really works",
};

function deps(overrides: Partial<ShareQuizLinkDeps> = {}): ShareQuizLinkDeps {
  return {
    platform: "web",
    webShare: null,
    coarsePointer: false,
    writeClipboardText: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    nativeShare: vi.fn(async () => ({ action: "sharedAction" })),
    ...overrides,
  };
}

describe("createQuizShareLink", () => {
  beforeEach(() => vi.mocked(apiRequest).mockClear());

  it("posts to the quiz share endpoint and returns the link", async () => {
    const result = await createQuizShareLink(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(result.url).toBe(link.url);
    expect(vi.mocked(apiRequest).mock.calls[0]?.[0]).toBe(
      "/api/quizzes/33333333-3333-4333-8333-333333333333/share",
    );
    expect(vi.mocked(apiRequest).mock.calls[0]?.[1]).toEqual({
      method: "POST",
    });
  });
});

describe("shareQuizLink", () => {
  it("uses the native share sheet off the web", async () => {
    const d = deps({ platform: "ios" });
    await expect(shareQuizLink(link, d)).resolves.toBe("shared");
    expect(d.nativeShare).toHaveBeenCalledWith({
      message: link.url,
      url: link.url,
      title: link.title,
    });
    expect(d.writeClipboardText).not.toHaveBeenCalled();
  });

  it("copies to the clipboard on desktop web even when Web Share exists", async () => {
    const webShare = vi.fn(async () => undefined);
    const d = deps({ webShare, coarsePointer: false });
    await expect(shareQuizLink(link, d)).resolves.toBe("copied");
    expect(webShare).not.toHaveBeenCalled();
    expect(d.writeClipboardText).toHaveBeenCalledWith(link.url);
  });

  it("prefers Web Share on touch devices and falls back to the clipboard when it fails", async () => {
    const accepted = vi.fn(async () => undefined);
    await expect(
      shareQuizLink(link, deps({ webShare: accepted, coarsePointer: true })),
    ).resolves.toBe("shared");
    expect(accepted).toHaveBeenCalledWith({ title: link.title, url: link.url });

    const dismissed = vi.fn(async () => {
      throw new DOMException("Share canceled", "AbortError");
    });
    const d = deps({ webShare: dismissed, coarsePointer: true });
    await expect(shareQuizLink(link, d)).resolves.toBe("copied");
    expect(d.writeClipboardText).toHaveBeenCalledWith(link.url);
  });

  it("falls back to expo-clipboard when the browser clipboard API is missing", async () => {
    const d = deps({ writeClipboardText: null });
    await expect(shareQuizLink(link, d)).resolves.toBe("copied");
    expect(d.copyToClipboard).toHaveBeenCalledWith(link.url);
  });

  it("surfaces clipboard failures to the caller", async () => {
    const d = deps({
      writeClipboardText: vi.fn(async () => {
        throw new Error("Clipboard blocked");
      }),
    });
    await expect(shareQuizLink(link, d)).rejects.toThrow("Clipboard blocked");
  });
});
