import {
  AttemptGenerationResponseSchema,
  AttemptAnswerResponseSchema,
  AttemptResumeResponseSchema,
  type AttemptAnswerResponse,
  type AttemptGenerationAvailability,
  type AttemptResumeResponse,
  type MasteryState,
  type PublicQuestion,
  masteryStateForScore,
} from "@clipquest/contracts";
import { VoxelIcon } from "../../src/components/VoxelIcon";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { AnswerCard, type AnswerState } from "../../src/components/AnswerCard";
import { AppTextInput } from "../../src/components/AppTextInput";
import { EmptyState } from "../../src/components/EmptyState";
import { FeedbackPanel } from "../../src/components/FeedbackPanel";
import { IconButton } from "../../src/components/IconButton";
import { LessonHeader } from "../../src/components/LessonHeader";
import { CelebrationHalo } from "../../src/components/Backdrops";
import { LearningPrism } from "../../src/components/LearningPrism";
import { MathText } from "../../src/components/MathText";
import {
  masteryColors,
  masteryPresentation,
  masteryTone,
} from "../../src/components/MasteryBadge";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { QuestionStreamIndicator } from "../../src/components/QuestionStreamIndicator";
import { Screen } from "../../src/components/Screen";
import { StatTile } from "../../src/components/StatTile";
import { Surface } from "../../src/components/Surface";
import { apiRequest, ClientApiError, jsonBody } from "../../src/lib/api";
import {
  exportCheatSheet,
  exportCheatSheetPdf,
  generateCheatSheetDocumentWithLocalAi,
  loadCheatSheetContext,
  recordCheatSheetFailure,
  renderCheatSheetPdf,
  uploadCheatSheet,
} from "../../src/lib/cheat-sheet";
import { useAppSession } from "../../src/lib/auth-client";
import {
  presentQuizPrompt,
  presentQuizText,
} from "../../src/lib/question-presentation";
import {
  attachLocalReason,
  summarizeCombo,
  summarizeRecap,
  type RecapEntry,
} from "../../src/lib/session-recap";
import {
  createChoicePresentation,
  createInitialOrdering,
  type ChoicePresentation,
} from "../../src/lib/quiz-order";
import { ensureProgressiveAttemptRecovery } from "../../src/generation/progressive-continuation";
import {
  hasActiveProgressiveGenerationForAttempt,
  publishAttemptGeneration,
  subscribeToAttemptGeneration,
} from "../../src/generation/progressive-coordinator";
import { useSettings } from "../../src/providers/SettingsProvider";
import {
  requestLocalAnswerGrade,
  subscribeToLocalGenerationClient,
} from "../../src/generation/local-generation-client";
import {
  FeedbackMotion,
  MotionSkeleton,
  MotionView,
  StaggerItem,
} from "../../src/motion/Motion";
import {
  clearAttempt,
  loadAttempt,
  markPrimerSeen,
  saveAttemptQuestion,
  saveAttemptRecap,
} from "../../src/state/attempt";
import {
  borders,
  breakpoints,
  motion,
  radii,
  spacing,
  typography,
} from "../../src/theme/tokens";

type Answer = number | boolean | number[] | string;

const QUESTION_WAIT_TIMEOUT_MS = 30_000;

function learnerFeedbackDetail(
  feedback: AttemptAnswerResponse,
  localGrade: import("@clipquest/contracts").LocalAnswerGrade | undefined,
  correctAnswer: string | undefined,
  translate: (
    key:
      | "answerReason"
      | "answerMarkedCorrect"
      | "answerMarkedIncorrect"
      | "correctAnswer",
  ) => string,
): string {
  const localDecisionMatches =
    localGrade !== undefined && localGrade.correct === feedback.correct;
  const reason = localDecisionMatches
    ? localGrade.reason
    : feedback.explanation;
  const verdict = feedback.correct
    ? translate("answerMarkedCorrect")
    : translate("answerMarkedIncorrect");
  const answerDetail =
    !feedback.correct && correctAnswer
      ? `\n\n${translate("correctAnswer")}: ${correctAnswer}`
      : "";
  return `${translate("answerReason")}: ${reason}${answerDetail}\n\n${verdict}`;
}

function presentCorrectAnswer(
  question: PublicQuestion,
  answer: Answer | null,
  translate: (key: "true" | "false") => string,
): string | undefined {
  if (answer === null) return undefined;
  if (question.type === "multiple_choice" && typeof answer === "number")
    return question.options?.[answer];
  if (question.type === "true_false" && typeof answer === "boolean")
    return translate(answer ? "true" : "false");
  if (question.type === "ordering" && Array.isArray(answer))
    return answer
      .map(
        (itemIndex, index) =>
          `${index + 1}. ${question.items?.[itemIndex] ?? ""}`,
      )
      .join("\n");
  if (question.type === "short_answer" && typeof answer === "string")
    return answer;
  return undefined;
}

export default function QuizScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const { data: session, isPending: sessionPending } = useAppSession();
  const userId = session?.user.id;
  const { t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const compactCompletion = width < breakpoints.compact;
  const [question, setQuestion] = useState<PublicQuestion>();
  const [primer, setPrimer] = useState<string | null>(null);
  const [showPrimer, setShowPrimer] = useState(false);
  const [answer, setAnswer] = useState<Answer>();
  const [orderingTouched, setOrderingTouched] = useState(false);
  const [feedback, setFeedback] = useState<AttemptAnswerResponse>();
  const [localGrade, setLocalGrade] =
    useState<import("@clipquest/contracts").LocalAnswerGrade>();
  const [score, setScore] = useState<number>();
  const [mastery, setMastery] = useState<MasteryState>();
  const [showCompletion, setShowCompletion] = useState(false);
  const [completedTotal, setCompletedTotal] = useState<number>();
  const [recapEntries, setRecapEntries] = useState<RecapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [waitingForQuestions, setWaitingForQuestions] = useState(false);
  const [waitingTooLong, setWaitingTooLong] = useState(false);
  const [generation, setGeneration] = useState<AttemptGenerationAvailability>();
  const [choicePresentation, setChoicePresentation] =
    useState<ChoicePresentation>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [questionActivation, setQuestionActivation] = useState(0);
  const [questionInteractionReady, setQuestionInteractionReady] =
    useState(false);
  const [cheatSheetStatus, setCheatSheetStatus] = useState<
    "preparing" | "ready" | "failed"
  >("preparing");
  const [cheatSheetId, setCheatSheetId] = useState<string>();
  const [cheatSheetTitle, setCheatSheetTitle] = useState<string>(
    "ClipQuest cheat sheet",
  );
  const cheatSheetStartedRef = useRef(false);
  const pendingCheatSheetRef = useRef<
    | {
        videoId: string;
        quizId: string;
        document: import("@clipquest/contracts").CheatSheetDocument;
        pdf: Uint8Array;
      }
    | undefined
  >(undefined);
  const cheatSheetContextRef = useRef<
    { videoId: string; quizId: string } | undefined
  >(undefined);
  const cheatSheetSyncRef = useRef<Promise<void> | undefined>(undefined);
  const recoveryAttemptedRef = useRef(false);

  const updateGeneration = useCallback(
    (next: AttemptGenerationAvailability) =>
      setGeneration((current) =>
        current?.state === next.state &&
        current.availableQuestions === next.availableQuestions &&
        current.totalQuestions === next.totalQuestions &&
        current.reasonCode === next.reasonCode &&
        current.retryAvailable === next.retryAvailable
          ? current
          : next,
      ),
    [],
  );

  // Persist the session recap beside the stored attempt so a reload or an
  // app resume mid-quest keeps every earlier answer in the completion recap.
  useEffect(() => {
    if (!userId || recapEntries.length === 0) return;
    void saveAttemptRecap(userId, attemptId, recapEntries).catch(
      () => undefined,
    );
  }, [attemptId, recapEntries, userId]);

  const activateQuestion = useCallback((nextQuestion: PublicQuestion) => {
    setQuestionInteractionReady(false);
    setQuestionActivation((current) => current + 1);
    setQuestion(nextQuestion);
    setChoicePresentation(
      nextQuestion.type === "multiple_choice" &&
        nextQuestion.options?.length === 4
        ? createChoicePresentation(nextQuestion.options)
        : undefined,
    );
    setAnswer(
      nextQuestion.type === "ordering"
        ? createInitialOrdering(nextQuestion.items?.length ?? 0)
        : undefined,
    );
    setOrderingTouched(false);
    setFeedback(undefined);
    setLocalGrade(undefined);
    setError(undefined);
    setWaitingForQuestions(false);
  }, []);

  useEffect(() => {
    if (!question) return;
    const controlCount =
      question.type === "multiple_choice"
        ? (question.options?.length ?? 0)
        : question.type === "true_false"
          ? 2
          : question.type === "ordering"
            ? (question.items?.length ?? 0)
            : 1;
    const delay =
      motion.standard +
      Math.min(Math.max(0, controlCount - 1), 8) * motion.stagger +
      motion.quick;
    const timeout = setTimeout(() => setQuestionInteractionReady(true), delay);
    return () => clearTimeout(timeout);
  }, [question, questionActivation]);

  const syncCheatSheet = useCallback(async () => {
    if (cheatSheetId) return;
    if (cheatSheetSyncRef.current) {
      await cheatSheetSyncRef.current;
      return;
    }
    const pending = pendingCheatSheetRef.current;
    if (!pending) return;
    const task = (async () => {
      let failed = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const uploaded = await uploadCheatSheet(pending);
          setCheatSheetId(uploaded.id);
          return;
        } catch {
          failed = true;
          if (attempt < 2)
            await new Promise((resolve) =>
              setTimeout(resolve, [500, 1_500][attempt]),
            );
        }
      }
      if (failed) setCheatSheetStatus("failed");
    })();
    cheatSheetSyncRef.current = task;
    try {
      await task;
    } finally {
      if (cheatSheetSyncRef.current === task) {
        cheatSheetSyncRef.current = undefined;
      }
    }
  }, [cheatSheetId]);

  const applyResume = useCallback(
    async (resumed: AttemptResumeResponse) => {
      setFeedback(undefined);
      setError(undefined);
      updateGeneration(resumed.generation);
      if (resumed.quizId && resumed.videoId && !cheatSheetStartedRef.current) {
        cheatSheetStartedRef.current = true;
        cheatSheetContextRef.current = {
          quizId: resumed.quizId,
          videoId: resumed.videoId,
        };
        setCheatSheetTitle(resumed.title ?? "ClipQuest cheat sheet");
        void prepareCheatSheet(resumed.quizId, resumed.videoId);
      }
      if (resumed.completed) {
        setQuestion(undefined);
        setAnswer(undefined);
        setWaitingForQuestions(false);
        setWaitingTooLong(false);
        setScore(resumed.score ?? 0);
        setMastery(resumed.mastery ?? "basic");
        setShowCompletion(true);
        void syncCheatSheet();
        return;
      }
      if (!resumed.question) {
        setQuestion(undefined);
        setAnswer(undefined);
        setScore(undefined);
        setMastery(undefined);
        setShowCompletion(false);
        if (resumed.generation.state !== "ready") {
          setWaitingForQuestions(true);
          return;
        }
        setWaitingForQuestions(false);
        setWaitingTooLong(false);
        setError(t("quizResumeMissing"));
        return;
      }
      activateQuestion(resumed.question);
      setScore(undefined);
      setMastery(undefined);
      setShowCompletion(false);
      if (userId)
        await saveAttemptQuestion(userId, attemptId, resumed.question);
    },
    [activateQuestion, attemptId, syncCheatSheet, t, updateGeneration, userId],
  );

  async function prepareCheatSheet(quizId: string, videoId: string) {
    let lastError = "Local cheat-sheet generation failed.";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const context = await loadCheatSheetContext(quizId);
        setCheatSheetTitle(context.title);
        const document = await generateCheatSheetDocumentWithLocalAi(context);
        const pdf = await renderCheatSheetPdf(document);
        pendingCheatSheetRef.current = { videoId, quizId, document, pdf };
        setCheatSheetStatus("ready");
        return;
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : lastError;
        if (attempt < 2)
          await new Promise((resolve) =>
            setTimeout(resolve, [1_000, 3_000][attempt]),
          );
      }
    }
    setCheatSheetStatus("failed");
    const context = await loadCheatSheetContext(quizId).catch(() => undefined);
    if (context)
      void recordCheatSheetFailure({
        videoId,
        quizId,
        sourceRevision: context.sourceRevision,
        lastError,
      });
  }

  useEffect(() => {
    if (
      showCompletion &&
      pendingCheatSheetRef.current &&
      !cheatSheetId &&
      cheatSheetStatus !== "preparing"
    ) {
      void syncCheatSheet();
    }
  }, [cheatSheetId, cheatSheetStatus, showCompletion, syncCheatSheet]);

  const resume = useCallback(async () => {
    const resumed = await apiRequest(
      `/api/attempts/${attemptId}/resume`,
      {},
      AttemptResumeResponseSchema,
    );
    await applyResume(resumed);
  }, [applyResume, attemptId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!userId) {
        if (!sessionPending) {
          setError(t("quizResumeFailed"));
          setLoading(false);
        }
        return;
      }
      const stored = await loadAttempt(userId, attemptId);
      if (!active) return;
      if (stored) {
        if (stored.question) activateQuestion(stored.question);
        if (stored.recap.length) setRecapEntries(stored.recap);
        setPrimer(stored.primer);
        setShowPrimer(Boolean(stored.primer && !stored.primerSeen));
        if (stored.question) {
          setLoading(false);
          void resume().catch(() => undefined);
          return;
        }
      }
      try {
        await resume();
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : t("quizResumeFailed"),
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [activateQuestion, attemptId, resume, sessionPending, t, userId]);

  useEffect(() => {
    if (!waitingForQuestions) return;
    let active = true;
    let failures = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let delayMs = 900;
      try {
        await resume();
        failures = 0;
      } catch {
        failures += 1;
        // A temporary resume failure must not turn progressive generation into
        // a learner-facing retry task. Keep polling with bounded backoff while
        // the generation-status loop separately owns AI suffix recovery.
        delayMs = Math.min(5_000, 900 * 2 ** Math.min(failures, 3));
      }
      if (active) timeout = setTimeout(() => void poll(), delayMs);
    };
    timeout = setTimeout(() => void poll(), 500);
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [resume, waitingForQuestions]);

  useEffect(() => {
    if (!waitingForQuestions) return;
    const timeout = setTimeout(
      () => setWaitingTooLong(true),
      QUESTION_WAIT_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, [waitingForQuestions]);

  useEffect(
    () =>
      subscribeToAttemptGeneration(attemptId, (snapshot) => {
        if (snapshot.generation) updateGeneration(snapshot.generation);
      }),
    [attemptId, updateGeneration],
  );

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await apiRequest(
          `/api/attempts/${attemptId}/generation`,
          {},
          AttemptGenerationResponseSchema,
        );
        if (!active) return;
        updateGeneration(status.generation);
        publishAttemptGeneration(attemptId, status.quizId, status.generation);
        if (
          !recoveryAttemptedRef.current &&
          status.generation.state !== "ready" &&
          status.generation.state !== "action_required" &&
          (status.generation.state !== "generation_failed" ||
            status.continuation?.claim.state === "available") &&
          !hasActiveProgressiveGenerationForAttempt(attemptId)
        ) {
          recoveryAttemptedRef.current = true;
          void ensureProgressiveAttemptRecovery(attemptId).finally(() => {
            if (active) recoveryAttemptedRef.current = false;
          });
        }
        if (status.generation.state !== "ready") {
          timeout = setTimeout(() => void poll(), 1_000);
        }
      } catch {
        if (active) timeout = setTimeout(() => void poll(), 1_500);
      }
    };
    const onFocus = () => {
      if (timeout) clearTimeout(timeout);
      void poll();
    };
    void poll();
    if (Platform.OS === "web") window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
      if (Platform.OS === "web") window.removeEventListener("focus", onFocus);
    };
  }, [attemptId, t, updateGeneration]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // Native generation is intentionally paused while the app is not
      // foregrounded. Refresh the authoritative attempt and immediately
      // restart the bounded AI recovery task when the learner returns, rather
      // than leaving the quiz stranded on a stale retrying snapshot.
      recoveryAttemptedRef.current = false;
      void resume().catch(() => undefined);
      void ensureProgressiveAttemptRecovery(attemptId).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [attemptId, resume]);

  useEffect(() => {
    if (generation?.state !== "action_required") return;
    return subscribeToLocalGenerationClient((client) => {
      if (
        !client.available ||
        !client.configured ||
        recoveryAttemptedRef.current
      )
        return;
      recoveryAttemptedRef.current = true;
      void ensureProgressiveAttemptRecovery(attemptId, {
        allowActionRequired: true,
      }).finally(() => {
        recoveryAttemptedRef.current = false;
      });
    });
  }, [attemptId, generation?.state]);

  const canSubmit = useMemo(() => {
    if (!questionInteractionReady) return false;
    if (answer === undefined) return false;
    if (typeof answer === "string") return answer.trim().length > 0;
    return question?.type !== "ordering" || orderingTouched;
  }, [answer, orderingTouched, question?.type, questionInteractionReady]);

  const streamIndicator = generation ? (
    <QuestionStreamIndicator generation={generation} />
  ) : undefined;
  const comboSummary = useMemo(() => summarizeCombo(recapEntries), [recapEntries]);

  const submit = async () => {
    if (!question || !canSubmit || answer === undefined) {
      setError(t("answerRequired"));
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const submittedAnswer =
        question.type === "multiple_choice" && typeof answer === "number"
          ? choicePresentation?.displayToCanonical[answer]
          : answer;
      if (submittedAnswer === undefined) {
        throw new Error(t("answerRequired"));
      }
      let localGradePromise:
        Promise<import("@clipquest/contracts").LocalAnswerGrade> | undefined;
      if (question.type !== "ordering") {
        const responseText =
          question.type === "multiple_choice" &&
          typeof submittedAnswer === "number"
            ? (question.options?.[submittedAnswer] ?? String(submittedAnswer))
            : question.type === "true_false"
              ? submittedAnswer
                ? "True"
                : "False"
              : String(submittedAnswer);
        const gradingController = new AbortController();
        const gradingTimeout = setTimeout(() => {
          gradingController.abort(new Error("Local grading timed out."));
        }, 30_000);
        localGradePromise = requestLocalAnswerGrade(
          {
            question: presentQuizPrompt(question.prompt),
            response: responseText,
            questionType: question.type,
            ...(question.options ? { options: question.options } : {}),
          },
          gradingController.signal,
        ).finally(() => clearTimeout(gradingTimeout));
        void localGradePromise
          .then((grade) => setLocalGrade(grade))
          .catch(() => undefined);
      }
      const result = await apiRequest(
        `/api/attempts/${attemptId}/answer`,
        {
          method: "POST",
          body: jsonBody({
            questionId: question.id,
            answer: submittedAnswer,
          }),
        },
        AttemptAnswerResponseSchema,
      );
      setFeedback(result);
      const recapTarget = {
        questionId: question.id,
        isRetry: question.isRetry,
      };
      setRecapEntries((entries) => [
        ...entries,
        {
          ...recapTarget,
          prompt: presentQuizPrompt(question.prompt),
          correct: result.correct,
          learnerAnswer: presentCorrectAnswer(question, submittedAnswer, t),
          correctAnswer: result.correct
            ? undefined
            : presentCorrectAnswer(question, result.correctAnswer, t),
          explanation: presentQuizText(result.explanation),
        },
      ]);
      // Keep the recap's reasoning identical to what the feedback panel shows:
      // when the device-local grade agrees with the server verdict, the panel
      // prefers its reason, so the recap records that same text.
      void localGradePromise
        ?.then((grade) =>
          setRecapEntries((entries) =>
            attachLocalReason(entries, recapTarget, grade),
          ),
        )
        .catch(() => undefined);
      updateGeneration(result.generation);
      if (userId)
        await saveAttemptQuestion(userId, attemptId, result.nextQuestion);
      if (result.completed) {
        setScore(result.score ?? 0);
        setMastery(result.mastery ?? "basic");
        setCompletedTotal(question.total);
      }
      if (result.correct)
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      else
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning,
        );
    } catch (cause) {
      if (
        cause instanceof ClientApiError &&
        cause.code === "answer_out_of_sequence"
      ) {
        try {
          await resume();
          setError(t("quizResynced"));
        } catch (resumeCause) {
          setError(
            resumeCause instanceof Error
              ? resumeCause.message
              : t("quizResumeFailed"),
          );
        }
      } else {
        setError(
          cause instanceof Error ? cause.message : t("answerCheckFailed"),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (!feedback) return;
    if (feedback.completed) {
      setShowCompletion(true);
      void syncCheatSheet();
      return;
    }
    if (feedback.nextQuestion) {
      activateQuestion(feedback.nextQuestion);
      return;
    }
    setFeedback(undefined);
    setQuestion(undefined);
    setAnswer(undefined);
    if (userId) void saveAttemptQuestion(userId, attemptId, null);
    if (feedback.generation.state !== "ready") {
      setWaitingForQuestions(true);
      setError(undefined);
      return;
    }
    setWaitingForQuestions(false);
    setWaitingTooLong(false);
    setError(t("quizResumeMissing"));
  };

  if (loading) {
    return (
      <Screen scroll={false} contentWidth="lesson" centered>
        <MotionView
          preset="pop"
          accessibilityLiveRegion="polite"
          style={styles.center}
        >
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            {t("loading")}
          </Text>
          <MotionSkeleton
            color={theme.primarySoft}
            style={styles.loadingLine}
          />
          <MotionSkeleton
            color={theme.primarySoft}
            delay={100}
            style={styles.loadingLineShort}
          />
        </MotionView>
      </Screen>
    );
  }

  if (showCompletion && score !== undefined) {
    const masteryState = mastery ?? masteryStateForScore(score);
    const mastered = masteryState === "mastered";
    const masteryRank = masteryPresentation(masteryState);
    const masteryColor = masteryColors(masteryState, theme).color;
    const masteryRankTone = masteryTone(masteryState);
    const recap = summarizeRecap(recapEntries);
    const showComboStats = comboSummary.best > 1;
    const showRecap = recapEntries.length > 0;
    // Only claim a perfect run when the recap saw every question; a session
    // restored without its earlier answers must not overstate itself.
    const recapCoversAttempt =
      completedTotal === undefined || recap.answered >= completedTotal;
    const showCompactCompletionStats =
      compactCompletion && completedTotal !== undefined;
    const localCheatSheetReady = Boolean(pendingCheatSheetRef.current);
    return (
      <Screen contentWidth="lesson" centered>
        <FeedbackMotion signal={score} kind="success" style={styles.complete}>
          <MotionView preset="pop" duration={520} style={styles.celebrationArt}>
            <CelebrationHalo
              color={masteryColor}
              size={showCompactCompletionStats ? 232 : 300}
              style={{
                top: showCompactCompletionStats ? -50 : -62,
                left: showCompactCompletionStats ? -50 : -62,
              }}
            />
            <LearningPrism
              size={showCompactCompletionStats ? 132 : 176}
              variant="hero"
            />
          </MotionView>
          <MotionView preset="rise" delay={88} style={styles.completeCopy}>
            <Text
              accessibilityRole="header"
              style={[styles.completeTitle, { color: theme.text }]}
            >
              {t("quizComplete")}
            </Text>
            <Text style={[styles.completeBody, { color: theme.textMuted }]}>
              {mastered ? t("masteryBuilt") : t("laterReview")}
            </Text>
          </MotionView>
          <View
            style={[
              styles.stats,
              showCompactCompletionStats && styles.statsCompact,
            ]}
          >
            <StaggerItem
              index={0}
              style={[
                styles.statItem,
                showCompactCompletionStats && styles.statItemCompact,
              ]}
            >
              <StatTile
                emphasis
                value={`${Math.round(score)}%`}
                label={t("score")}
                tone={masteryRankTone}
                icon={
                  <VoxelIcon name="target" size={24} color={masteryColor} />
                }
              />
            </StaggerItem>
            <StaggerItem
              index={1}
              style={[
                styles.statItem,
                showCompactCompletionStats && styles.statItemCompact,
              ]}
            >
              <StatTile
                value={t(masteryRank.labelKey)}
                label={t("mastery")}
                tone={masteryRankTone}
                icon={
                  <VoxelIcon
                    name={masteryRank.icon}
                    size={22}
                    color={masteryColor}
                  />
                }
              />
            </StaggerItem>
            {completedTotal !== undefined ? (
              <StaggerItem
                index={2}
                style={[
                  styles.statItem,
                  compactCompletion && styles.statItemCompact,
                ]}
              >
                <StatTile
                  value={String(completedTotal)}
                  label={t("questions")}
                  tone="warning"
                  icon={
                    <VoxelIcon name="help" size={22} color={theme.warning} />
                  }
                />
              </StaggerItem>
            ) : null}
            {showRecap ? (
              <StaggerItem
                index={completedTotal !== undefined ? 3 : 2}
                style={[
                  styles.statItem,
                  showCompactCompletionStats && styles.statItemCompact,
                ]}
              >
                <StatTile
                  value={`${recap.firstTryCorrect}/${recap.answered}`}
                  label={t("firstTry")}
                  tone={recap.missed.length ? "secondary" : "success"}
                  icon={
                    <VoxelIcon
                      name={recap.missed.length ? "progress" : "correct"}
                      size={22}
                      color={
                        recap.missed.length ? theme.secondary : theme.success
                      }
                    />
                  }
                />
              </StaggerItem>
            ) : null}
            {showComboStats ? (
              <StaggerItem
                index={completedTotal !== undefined ? 4 : 3}
                style={[
                  styles.statItem,
                  showCompactCompletionStats && styles.statItemCompact,
                ]}
              >
                <StatTile
                  value={`x${comboSummary.best}`}
                  label={t("bestCombo")}
                  tone="warning"
                  icon={
                    <VoxelIcon name="progress" size={22} color={theme.warning} />
                  }
                />
              </StaggerItem>
            ) : null}
            {showComboStats ? (
              <StaggerItem
                index={completedTotal !== undefined ? 5 : 4}
                style={[
                  styles.statItem,
                  showCompactCompletionStats && styles.statItemCompact,
                ]}
              >
                <StatTile
                  value={`+${comboSummary.bonus}`}
                  label={t("comboBonus")}
                  tone="secondary"
                  icon={
                    <VoxelIcon name="target" size={22} color={theme.secondary} />
                  }
                />
              </StaggerItem>
            ) : null}
          </View>
          {showRecap ? (
            <MotionView preset="rise" delay={132} style={styles.recap}>
              <Surface tone="tinted" style={styles.recapCard}>
                <Text
                  accessibilityRole="header"
                  style={[styles.recapTitle, { color: theme.text }]}
                >
                  {t("recapTitle")}
                </Text>
                <Text style={[styles.recapBody, { color: theme.textMuted }]}>
                  {recap.missed.length
                    ? t("recapSubtitle")
                    : recapCoversAttempt
                      ? t("recapPerfect")
                      : t("recapPartial")}
                </Text>
                {recap.missed.map((item, index) => (
                  <View
                    key={`${item.questionId}-${index}`}
                    testID="recap-missed-item"
                    style={[
                      styles.recapItem,
                      {
                        backgroundColor: theme.surfaceRaised,
                        borderColor: theme.divider,
                      },
                    ]}
                  >
                    {/* Each line is one top-level MathText (the FeedbackPanel
                        pattern) so formula answers typeset and native MathText
                        is never nested inside Text. */}
                    <MathText
                      selectable
                      style={[styles.recapPrompt, { color: theme.text }]}
                    >
                      {item.prompt}
                    </MathText>
                    {item.learnerAnswer ? (
                      <MathText
                        selectable
                        style={[styles.recapLine, { color: theme.error }]}
                      >
                        {`${t("recapYourAnswer")}: ${item.learnerAnswer}`}
                      </MathText>
                    ) : null}
                    {item.correctAnswer ? (
                      <MathText
                        selectable
                        style={[styles.recapLine, { color: theme.success }]}
                      >
                        {`${t("correctAnswer")}: ${item.correctAnswer}`}
                      </MathText>
                    ) : null}
                    <MathText
                      selectable
                      style={[styles.recapLine, { color: theme.textMuted }]}
                    >
                      {`${t("answerReason")}: ${item.reason ?? item.explanation}`}
                    </MathText>
                    {item.recoveredOnRetry ? (
                      <View
                        style={[
                          styles.recapBadge,
                          { backgroundColor: theme.successSoft },
                        ]}
                      >
                        <VoxelIcon
                          name="correct"
                          size={16}
                          color={theme.success}
                        />
                        <Text
                          style={[
                            styles.recapBadgeText,
                            { color: theme.success },
                          ]}
                        >
                          {t("recapRecovered")}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </Surface>
            </MotionView>
          ) : null}
          <MotionView preset="rise" delay={176} style={styles.completeActions}>
            <PrimaryButton
              testID="download-cheat-sheet-pdf"
              accessibilityLabel={
                cheatSheetStatus === "failed" && !localCheatSheetReady
                  ? t("retryPdf")
                  : cheatSheetId || localCheatSheetReady
                    ? t("downloadPdf")
                    : t("preparingPdf")
              }
              variant="secondary"
              disabled={
                cheatSheetStatus === "preparing" ||
                (!cheatSheetId &&
                  !localCheatSheetReady &&
                  cheatSheetStatus !== "failed")
              }
              onPress={() => {
                if (pendingCheatSheetRef.current)
                  void exportCheatSheetPdf(
                    pendingCheatSheetRef.current.pdf,
                    cheatSheetTitle,
                  ).catch((cause) => {
                    setCheatSheetStatus("failed");
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "The cheat sheet could not be exported.",
                    );
                  });
                else if (cheatSheetId)
                  void exportCheatSheet(cheatSheetId, cheatSheetTitle).catch(
                    (cause) => {
                      setCheatSheetStatus("failed");
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "The cheat sheet could not be exported.",
                      );
                    },
                  );
                else if (cheatSheetContextRef.current) {
                  setCheatSheetStatus("preparing");
                  void prepareCheatSheet(
                    cheatSheetContextRef.current.quizId,
                    cheatSheetContextRef.current.videoId,
                  );
                }
              }}
            >
              {cheatSheetStatus === "failed" && !localCheatSheetReady
                ? t("retryPdf")
                : cheatSheetId || localCheatSheetReady
                  ? t("downloadPdf")
                  : t("preparingPdf")}
            </PrimaryButton>
            <PrimaryButton
              trailingIcon={
                <VoxelIcon name="next" size={20} color={theme.textOnAction} />
              }
              onPress={() => {
                if (userId) void clearAttempt(userId, attemptId);
                router.replace("/(tabs)/library");
              }}
            >
              {t("returnToLibrary")}
            </PrimaryButton>
          </MotionView>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: theme.error }]}
            >
              {error}
            </Text>
          ) : null}
        </FeedbackMotion>
      </Screen>
    );
  }

  if (waitingForQuestions) {
    return (
      <Screen
        scroll={false}
        contentWidth="reading"
        centered
        floating={streamIndicator}
      >
        <MotionView
          preset="pop"
          accessibilityLiveRegion="polite"
          style={styles.waiting}
        >
          <LearningPrism size={124} variant="tile" />
          <ActivityIndicator size="large" color={theme.primary} />
          <View style={styles.waitingCopy}>
            <Text
              accessibilityRole="header"
              style={[styles.waitingTitle, { color: theme.text }]}
            >
              {t("preparingNextQuestion")}
            </Text>
            <Text style={[styles.waitingBody, { color: theme.textMuted }]}>
              {t("quizStillGenerating")}
            </Text>
            {error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: theme.error }]}
              >
                {error}
              </Text>
            ) : null}
          </View>
          <MotionSkeleton
            color={theme.primarySoft}
            style={styles.loadingLine}
          />
          <MotionSkeleton
            color={theme.primarySoft}
            delay={100}
            style={styles.loadingLineShort}
          />
          {waitingTooLong ? (
            <MotionView preset="rise" style={styles.waitingActions}>
              <Text style={[styles.waitingTimeoutTitle, { color: theme.text }]}>
                {t("quizTakingLonger")}
              </Text>
              <Text style={[styles.waitingBody, { color: theme.textMuted }]}>
                {t("quizTakingLongerBody")}
              </Text>
              <View style={styles.waitingButtons}>
                <PrimaryButton
                  testID="quiz-stay-here"
                  variant="secondary"
                  onPress={() => setWaitingTooLong(false)}
                >
                  {t("stayOnQuiz")}
                </PrimaryButton>
                <PrimaryButton
                  testID="quiz-return-home"
                  variant="ghost"
                  onPress={() => router.replace("/(tabs)")}
                >
                  {t("returnHome")}
                </PrimaryButton>
              </View>
            </MotionView>
          ) : null}
        </MotionView>
      </Screen>
    );
  }

  if (error && !question) {
    return (
      <Screen contentWidth="reading" centered>
        <EmptyState
          icon="error"
          title={t("quizResumeFailed")}
          description={error}
          action={
            <PrimaryButton onPress={() => router.replace("/(tabs)")}>
              {t("home")}
            </PrimaryButton>
          }
        />
      </Screen>
    );
  }
  if (!question) return null;

  const displayPrompt = presentQuizPrompt(question.prompt);

  if (showPrimer && primer) {
    return (
      <Screen contentWidth="reading" centered floating={streamIndicator}>
        <MotionView preset="from-left" style={styles.primerTop}>
          <LearningPrism size={132} variant="tile" />
          <View style={styles.primerHeading}>
            <Text style={[styles.eyebrow, { color: theme.primary }]}>
              {t("question")}
            </Text>
            <Text
              accessibilityRole="header"
              style={[styles.primerTitle, { color: theme.text }]}
            >
              {t("primerTitle")}
            </Text>
          </View>
        </MotionView>
        <MotionView preset="rise" delay={80}>
          <Surface tone="tinted" style={styles.primerCard}>
            <View style={styles.primerLabel}>
              <VoxelIcon name="idea" size={22} color={theme.primary} />
              <Text style={[styles.primerLabelText, { color: theme.primary }]}>
                {t("primerTitle")}
              </Text>
            </View>
            <MathText
              selectable
              style={[styles.primerText, { color: theme.text }]}
            >
              {primer}
            </MathText>
          </Surface>
        </MotionView>
        <MotionView preset="rise" delay={140} style={styles.primerButton}>
          <PrimaryButton
            onPress={() => {
              setShowPrimer(false);
              if (userId) void markPrimerSeen(userId, attemptId);
            }}
          >
            {t("beginQuiz")}
          </PrimaryButton>
        </MotionView>
      </Screen>
    );
  }

  const progress = (question.position - 1) / question.total;
  const progressLabel = `${t("question")} ${question.position} of ${question.total}`;
  const activeCombo = comboSummary.current;
  const comboActive = activeCombo > 0;
  const footer = feedback ? (
    <FeedbackPanel
      status={feedback.correct ? "correct" : "incorrect"}
      title={feedback.correct ? t("correct") : t("incorrect")}
      detail={presentQuizText(
        learnerFeedbackDetail(
          feedback,
          localGrade,
          presentCorrectAnswer(question, feedback.correctAnswer, (key) =>
            t(key),
          ),
          (key) => t(key),
        ),
      )}
      action={
        <PrimaryButton onPress={next}>
          {feedback.completed ? t("finish") : t("next")}
        </PrimaryButton>
      }
    />
  ) : (
    <View
      style={[
        styles.actionBar,
        { backgroundColor: theme.surface, borderTopColor: theme.divider },
      ]}
    >
      <View style={styles.actionInner}>
        <PrimaryButton
          loading={submitting}
          disabled={!canSubmit}
          onPress={() => void submit()}
        >
          {t("checkAnswer")}
        </PrimaryButton>
      </View>
    </View>
  );

  return (
    <Screen
      contentWidth="lesson"
      footer={footer}
      footerFlush
      floating={streamIndicator}
    >
      <LessonHeader
        progress={progress}
        progressLabel={progressLabel}
        statusLabel={`${question.position}/${question.total}`}
        closeLabel={t("cancel")}
        onClose={() => router.replace("/(tabs)")}
      />
      <MotionView
        key={`${question.position}-${displayPrompt}`}
        testID={
          questionInteractionReady ? "clipquest-question-ready" : undefined
        }
        accessibilityLabel={
          questionInteractionReady
            ? `Interactive question ${question.position} of ${question.total}`
            : undefined
        }
        accessibilityState={{
          disabled:
            !questionInteractionReady || Boolean(feedback) || submitting,
        }}
        preset="from-right"
        style={styles.quizBody}
      >
        <View style={styles.questionMeta}>
          <Text style={[styles.eyebrow, { color: theme.primary }]}>
            {questionTypeLabel(question.type)}
          </Text>
          {(question.isRetry || comboActive) && (
            <View style={styles.metaBadges}>
              {question.isRetry ? (
                <MotionView
                  preset="pop"
                  style={[
                    styles.retryBadge,
                    { backgroundColor: theme.secondarySoft },
                  ]}
                >
                  <VoxelIcon
                    name="refresh"
                    size={16}
                    color={theme.secondaryPressed}
                  />
                  <Text
                    style={[styles.retryText, { color: theme.secondaryPressed }]}
                  >
                    {t("retryingConcept")}
                  </Text>
                </MotionView>
              ) : null}
              {comboActive ? (
                <MotionView
                  preset="pop"
                  style={[
                    styles.comboBadge,
                    {
                      backgroundColor:
                        activeCombo > 1 ? theme.warningSoft : theme.surfaceSunken,
                      borderColor:
                        activeCombo > 1 ? theme.warning : theme.borderStrong,
                    },
                  ]}
                >
                  <VoxelIcon
                    name="progress"
                    size={16}
                    color={activeCombo > 1 ? theme.warning : theme.textMuted}
                  />
                  <Text
                    style={[
                      styles.comboText,
                      { color: activeCombo > 1 ? theme.warning : theme.textMuted },
                    ]}
                  >
                    {`${t("combo")} x${activeCombo}`}
                  </Text>
                </MotionView>
              ) : null}
            </View>
          )}
        </View>
        <MotionView preset="rise" delay={44}>
          <MathText
            accessibilityRole="header"
            style={[styles.question, { color: theme.text }]}
          >
            {displayPrompt}
          </MathText>
        </MotionView>
        <QuestionInput
          question={question}
          displayOptions={choicePresentation?.options}
          displayToCanonical={choicePresentation?.displayToCanonical}
          answer={answer}
          feedback={feedback}
          setAnswer={setAnswer}
          onInteraction={() => setOrderingTouched(true)}
          disabled={
            !questionInteractionReady || Boolean(feedback) || submitting
          }
        />
        {error ? (
          <FeedbackMotion signal={error} kind="error">
            <MotionView preset="rise" exiting>
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: theme.error }]}
              >
                {error}
              </Text>
            </MotionView>
          </FeedbackMotion>
        ) : null}
      </MotionView>
    </Screen>
  );
}

function QuestionInput({
  question,
  displayOptions,
  displayToCanonical,
  answer,
  feedback,
  setAnswer,
  onInteraction,
  disabled,
}: {
  question: PublicQuestion;
  displayOptions?: string[];
  displayToCanonical?: number[];
  answer: Answer | undefined;
  feedback?: AttemptAnswerResponse;
  setAnswer(answer: Answer): void;
  onInteraction(): void;
  disabled: boolean;
}) {
  const { t, theme } = useSettings();
  const stateFor = (
    selected: boolean,
    isCorrectChoice: boolean,
  ): AnswerState => {
    if (feedback && isCorrectChoice) return "correct";
    if (feedback && selected) return feedback.correct ? "correct" : "incorrect";
    if (selected) return "selected";
    return disabled ? "disabled" : "default";
  };

  if (question.type === "multiple_choice") {
    return (
      <View style={styles.options}>
        {(displayOptions ?? question.options)?.map((option, index) => (
          <StaggerItem key={`${index}-${option}`} index={index}>
            <AnswerCard
              indexLabel={String.fromCharCode(65 + index)}
              label={option}
              state={stateFor(
                answer === index,
                typeof feedback?.correctAnswer === "number" &&
                  (displayToCanonical?.[index] ?? index) ===
                    feedback.correctAnswer,
              )}
              onPress={() => setAnswer(index)}
            />
          </StaggerItem>
        ))}
      </View>
    );
  }
  if (question.type === "true_false") {
    return (
      <View style={styles.binary}>
        <StaggerItem index={0} preset="from-left" style={styles.binaryOption}>
          <AnswerCard
            label={t("true")}
            state={stateFor(answer === true, feedback?.correctAnswer === true)}
            onPress={() => setAnswer(true)}
          />
        </StaggerItem>
        <StaggerItem index={1} preset="from-right" style={styles.binaryOption}>
          <AnswerCard
            label={t("false")}
            state={stateFor(
              answer === false,
              feedback?.correctAnswer === false,
            )}
            onPress={() => setAnswer(false)}
          />
        </StaggerItem>
      </View>
    );
  }
  if (question.type === "ordering") {
    const order = Array.isArray(answer)
      ? answer
      : (question.items?.map((_, index) => index) ?? []);
    return (
      <View accessibilityLabel={t("arrangeItems")} style={styles.options}>
        {order.map((itemIndex, position) => (
          <StaggerItem
            key={itemIndex}
            index={position}
            layout
            style={[
              styles.orderItem,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                borderBottomColor: theme.borderStrong,
              },
            ]}
          >
            <View
              style={[
                styles.orderNumber,
                {
                  backgroundColor: theme.primarySoft,
                  borderColor: theme.primary,
                },
              ]}
            >
              <Text style={[styles.orderNumberText, { color: theme.primary }]}>
                {position + 1}
              </Text>
            </View>
            <MathText style={[styles.orderText, { color: theme.text }]}>
              {question.items?.[itemIndex] ?? ""}
            </MathText>
            <View style={styles.orderActions}>
              <IconButton
                label={t("moveUp")}
                icon="collapse"
                disabled={disabled || position === 0}
                onPress={() => {
                  onInteraction();
                  setAnswer(move(order, position, position - 1));
                }}
              />
              <IconButton
                label={t("moveDown")}
                icon="expand"
                disabled={disabled || position === order.length - 1}
                onPress={() => {
                  onInteraction();
                  setAnswer(move(order, position, position + 1));
                }}
              />
            </View>
          </StaggerItem>
        ))}
      </View>
    );
  }
  return (
    <AppTextInput
      label={t("shortAnswer")}
      accessibilityLabel={t("shortAnswer")}
      editable={!disabled}
      multiline
      maxLength={2_000}
      value={typeof answer === "string" ? answer : ""}
      onChangeText={setAnswer}
      placeholder={t("shortAnswerPlaceholder")}
      style={styles.shortAnswer}
    />
  );
}

function move(values: number[], from: number, to: number): number[] {
  const next = [...values];
  const [value] = next.splice(from, 1);
  if (value !== undefined) next.splice(to, 0, value);
  return next;
}

function questionTypeLabel(type: PublicQuestion["type"]): string {
  if (type === "multiple_choice") return "SELECT ONE";
  if (type === "true_false") return "TRUE OR FALSE";
  if (type === "ordering") return "PUT IN ORDER";
  return "SHORT ANSWER";
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    minHeight: 380,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
  },
  loadingText: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
  },
  loadingLine: {
    width: 220,
    height: 10,
    borderRadius: radii.pill,
  },
  loadingLineShort: {
    width: 150,
    height: 10,
    borderRadius: radii.pill,
  },
  waiting: {
    width: "100%",
    minHeight: 420,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
  },
  waitingCopy: {
    maxWidth: 460,
    alignItems: "center",
    gap: spacing[2],
  },
  waitingTitle: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    textAlign: "center",
  },
  waitingBody: {
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  waitingActions: {
    width: "100%",
    maxWidth: 460,
    alignItems: "center",
    gap: spacing[3],
    marginTop: spacing[2],
  },
  waitingTimeoutTitle: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  waitingButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing[3],
  },
  quizBody: {
    width: "100%",
    flex: 1,
    alignSelf: "center",
    paddingTop: spacing[10],
    paddingBottom: spacing[8],
    gap: spacing[6],
  },
  questionMeta: {
    minHeight: 28,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  metaBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing[2],
  },
  eyebrow: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
    letterSpacing: 1.4,
  },
  retryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
  },
  retryText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
  },
  comboBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radii.pill,
    borderWidth: borders.hairline,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
  },
  comboText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
  },
  question: {
    maxWidth: 680,
    fontFamily: typography.displayMedium,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    letterSpacing: -0.3,
  },
  options: {
    gap: spacing[3],
  },
  binary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3],
  },
  binaryOption: {
    minWidth: 260,
    flex: 1,
  },
  shortAnswer: {
    minHeight: 150,
    paddingTop: spacing[3],
    textAlignVertical: "top",
  },
  orderItem: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderWidth: borders.standard,
    borderBottomWidth: borders.tactileDepth + borders.standard,
    borderRadius: radii.large,
    padding: spacing[3],
  },
  orderNumber: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.small,
  },
  orderNumberText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
  },
  orderText: {
    minWidth: 0,
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  orderActions: {
    flexDirection: "row",
    gap: spacing[1],
  },
  error: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
    textAlign: "center",
  },
  actionBar: {
    minHeight: 88,
    justifyContent: "center",
    borderTopWidth: borders.hairline,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  actionInner: {
    width: "100%",
    maxWidth: breakpoints.compact,
    alignSelf: "center",
  },
  primerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[5],
    marginBottom: spacing[5],
  },
  primerHeading: {
    minWidth: 0,
    flex: 1,
    gap: spacing[2],
  },
  primerTitle: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  primerCard: {
    gap: spacing[4],
  },
  primerLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  primerLabelText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
  },
  primerText: {
    fontFamily: typography.body,
    fontSize: typography.size.bodyLarge,
    lineHeight: 29,
  },
  primerButton: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "flex-end",
    marginTop: spacing[6],
  },
  complete: {
    flex: 1,
    minHeight: 560,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[6],
    paddingVertical: spacing[8],
  },
  celebrationArt: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  completeCopy: {
    maxWidth: 560,
    alignItems: "center",
    gap: spacing[2],
  },
  completeTitle: {
    fontFamily: typography.display,
    fontSize: typography.size.displaySmall,
    lineHeight: typography.lineHeight.displaySmall,
    textAlign: "center",
  },
  completeBody: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  stats: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3],
  },
  statsCompact: {
    flexDirection: "column",
    flexWrap: "nowrap",
  },
  statItem: { minWidth: 132, flex: 1 },
  statItemCompact: { width: "100%", flexGrow: 0 },
  completeActions: {
    width: "100%",
    gap: spacing[3],
  },
  recap: {
    width: "100%",
  },
  recapCard: {
    gap: spacing[3],
  },
  recapTitle: {
    fontFamily: typography.display,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  recapBody: {
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  recapItem: {
    gap: spacing[2],
    padding: spacing[4],
    borderRadius: radii.medium,
    borderWidth: borders.hairline,
  },
  recapPrompt: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  recapLine: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  recapLabel: {
    fontFamily: typography.bodyBold,
  },
  recapBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: radii.pill,
  },
  recapBadgeText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
});
