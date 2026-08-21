import {
  QuizStartResponseSchema,
  VideoImportResponseSchema,
  type LibraryCard,
} from "@clipquest/contracts";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { apiRequest, jsonBody } from "../lib/api";
import { useSettings } from "../providers/SettingsProvider";
import { saveAttemptStart } from "../state/attempt";
import { saveImportedVideo } from "../state/creation";

export function useOpenVideoCard() {
  const { t } = useSettings();
  const [openingId, setOpeningId] = useState<string>();
  const [error, setError] = useState<string>();

  const open = useCallback(async (card: LibraryCard) => {
    setOpeningId(card.videoId);
    setError(undefined);
    try {
      if (card.attemptId) {
        router.push({ pathname: "/quiz/[attemptId]", params: { attemptId: card.attemptId } });
        return;
      }
      if (card.quizId) {
        const start = await apiRequest(
          `/api/quizzes/${card.quizId}/start`,
          {
            method: "POST",
            body: jsonBody({ mode: card.action === "review" ? "review" : "learn", sessionLength: "medium" }),
          },
          QuizStartResponseSchema,
        );
        await saveAttemptStart(start);
        router.push({ pathname: "/quiz/[attemptId]", params: { attemptId: start.attemptId } });
        return;
      }
      const imported = await apiRequest(
        "/api/videos/import",
        { method: "POST", body: jsonBody({ url: card.originalUrl }) },
        VideoImportResponseSchema,
      );
      await saveImportedVideo(imported);
      router.push({ pathname: "/create/[videoId]", params: { videoId: imported.video.id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("openQuestFailed"));
    } finally {
      setOpeningId(undefined);
    }
  }, [t]);

  return { open, openingId, error, clearError: () => setError(undefined) };
}
