import {
  QuizShareResponseSchema,
  type QuizShareResponse,
} from "@clipquest/contracts";
import * as Clipboard from "expo-clipboard";
import { Platform, Share } from "react-native";
import { apiRequest } from "./api";

export type ShareOutcome = "copied" | "shared";

export type ShareQuizLinkDeps = {
  platform: string;
  /** `navigator.share` bound to the navigator, or null when unavailable. */
  webShare: ((data: { title: string; url: string }) => Promise<void>) | null;
  /** True on touch-first browsers, where the OS share sheet is the better UX. */
  coarsePointer: boolean;
  /** `navigator.clipboard.writeText`, or null when the browser has no clipboard API. */
  writeClipboardText: ((text: string) => Promise<void>) | null;
  copyToClipboard(text: string): Promise<void>;
  nativeShare(content: {
    message: string;
    url: string;
    title: string;
  }): Promise<unknown>;
};

export function createQuizShareLink(
  quizId: string,
): Promise<QuizShareResponse> {
  return apiRequest(
    `/api/quizzes/${quizId}/share`,
    { method: "POST" },
    QuizShareResponseSchema,
  );
}

function defaultDeps(): ShareQuizLinkDeps {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    platform: Platform.OS,
    webShare:
      nav && typeof nav.share === "function" ? (data) => nav.share(data) : null,
    coarsePointer:
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches,
    writeClipboardText:
      nav?.clipboard && typeof nav.clipboard.writeText === "function"
        ? (text) => nav.clipboard.writeText(text)
        : null,
    copyToClipboard: (text) =>
      Clipboard.setStringAsync(text).then(() => undefined),
    nativeShare: (content) => Share.share(content),
  };
}

/**
 * Hands a share URL to the learner. Desktop web copies the link (deterministic
 * and demo-friendly); touch browsers try the OS share sheet first and still
 * copy when the sheet is dismissed or refused; native uses React Native's
 * share sheet. Throws when even the clipboard is unavailable so callers can
 * show the URL for manual copying.
 */
export async function shareQuizLink(
  input: { url: string; title: string },
  deps: ShareQuizLinkDeps = defaultDeps(),
): Promise<ShareOutcome> {
  if (deps.platform !== "web") {
    await deps.nativeShare({
      message: input.url,
      url: input.url,
      title: input.title,
    });
    return "shared";
  }
  if (deps.webShare && deps.coarsePointer) {
    try {
      await deps.webShare({ title: input.title, url: input.url });
      return "shared";
    } catch {
      // Dismissed or refused: copying the link is still a useful outcome.
    }
  }
  if (deps.writeClipboardText) {
    await deps.writeClipboardText(input.url);
    return "copied";
  }
  await deps.copyToClipboard(input.url);
  return "copied";
}
