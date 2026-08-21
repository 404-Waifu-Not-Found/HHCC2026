import {
  AttemptGenerationResponseSchema,
  AttemptAnswerResponseSchema,
  AttemptResumeResponseSchema,
  type AttemptAnswerResponse,
  type AttemptGenerationAvailability,
  type AttemptResumeResponse,
  type MasteryState,
  type PublicQuestion,
} from "@clipquest/contracts";
import { VoxelIcon } from "../../src/components/VoxelIcon";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AnswerCard, type AnswerState } from "../../src/components/AnswerCard";
import { AppTextInput } from "../../src/components/AppTextInput";
import { EmptyState } from "../../src/components/EmptyState";
import { FeedbackPanel } from "../../src/components/FeedbackPanel";
import { IconButton } from "../../src/components/IconButton";
import { LessonHeader } from "../../src/components/LessonHeader";
import { LearningPrism } from "../../src/components/LearningPrism";
import { MathText } from "../../src/components/MathText";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { QuestionStreamIndicator } from "../../src/components/QuestionStreamIndicator";
import { Screen } from "../../src/components/Screen";
import { StatTile } from "../../src/components/StatTile";
import { Surface } from "../../src/components/Surface";
import { apiRequest, ClientApiError, jsonBody } from "../../src/lib/api";
import {
  presentQuizPrompt,
  presentQuizText,
} from "../../src/lib/question-presentation";
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
import { subscribeToClipQuestExtension } from "../../src/transcription/clipquest-extension";
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

export default function QuizScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const { t, theme } = useSettings();
  const [question, setQuestion] = useState<PublicQuestion>();
  const [primer, setPrimer] = useState<string | null>(null);
  const [showPrimer, setShowPrimer] = useState(false);
  const [answer, setAnswer] = useState<Answer>();
  const [orderingTouched, setOrderingTouched] = useState(false);
  const [feedback, setFeedback] = useState<AttemptAnswerResponse>();
  const [score, setScore] = useState<number>();
  const [mastery, setMastery] = useState<MasteryState>();
  const [showCompletion, setShowCompletion] = useState(false);
  const [completedTotal, setCompletedTotal] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [waitingForQuestions, setWaitingForQuestions] = useState(false);
  const [generation, setGeneration] = useState<AttemptGenerationAvailability>();
  const [choicePresentation, setChoicePresentation] =
    useState<ChoicePresentation>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [questionActivation, setQuestionActivation] = useState(0);
  const [questionInteractionReady, setQuestionInteractionReady] =
    useState(false);
  const recoveryAttemptedRef = useRef(false);

  const updateGeneration = useCallback(
    (next: AttemptGenerationAvailability) =>
      setGeneration((current) =>
        current?.state === next.state &&
        current.availableQuestions === next.availableQuestions &&
        current.totalQuestions === next.totalQuestions &&
        current.reasonCode === next.reasonCode
          ? current
          : next,
      ),
    [],
  );

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

  const applyResume = useCallback(
    async (resumed: AttemptResumeResponse) => {
      setFeedback(undefined);
      setError(undefined);
      updateGeneration(resumed.generation);
      if (resumed.completed) {
        setQuestion(undefined);
        setAnswer(undefined);
        setWaitingForQuestions(false);
        setScore(resumed.score ?? 0);
        setMastery(resumed.mastery ?? "learning");
        setShowCompletion(true);
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
        setError(t("quizResumeMissing"));
        return;
      }
      activateQuestion(resumed.question);
      setScore(undefined);
      setMastery(undefined);
      setShowCompletion(false);
      await saveAttemptQuestion(attemptId, resumed.question);
    },
    [activateQuestion, attemptId, t, updateGeneration],
  );

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
      const stored = await loadAttempt(attemptId);
      if (!active) return;
      if (stored) {
        if (stored.question) activateQuestion(stored.question);
        setPrimer(stored.primer);
        setShowPrimer(Boolean(stored.primer && !stored.primerSeen));
        if (stored.question) {
          setLoading(false);
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
  }, [activateQuestion, attemptId, resume, t]);

  useEffect(() => {
    if (!waitingForQuestions) return;
    let active = true;
    let failures = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        await resume();
        failures = 0;
      } catch (cause) {
        failures += 1;
        if (failures >= 3 && active) {
          setWaitingForQuestions(false);
          setError(
            cause instanceof Error ? cause.message : t("quizResumeFailed"),
          );
          return;
        }
      }
      if (active) timeout = setTimeout(() => void poll(), 900);
    };
    timeout = setTimeout(() => void poll(), 500);
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [resume, t, waitingForQuestions]);

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
    if (typeof window !== "undefined")
      window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
      if (typeof window !== "undefined")
        window.removeEventListener("focus", onFocus);
    };
  }, [attemptId, t, updateGeneration]);

  useEffect(() => {
    if (generation?.state !== "action_required") return;
    return subscribeToClipQuestExtension((extension) => {
      if (!extension.configured || recoveryAttemptedRef.current) return;
      recoveryAttemptedRef.current = true;
      void ensureProgressiveAttemptRecovery(attemptId).finally(() => {
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
      updateGeneration(result.generation);
      await saveAttemptQuestion(attemptId, result.nextQuestion);
      if (result.completed) {
        setScore(result.score ?? 0);
        setMastery(result.mastery ?? "learning");
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
      return;
    }
    if (feedback.nextQuestion) {
      activateQuestion(feedback.nextQuestion);
      return;
    }
    setFeedback(undefined);
    setQuestion(undefined);
    setAnswer(undefined);
    void saveAttemptQuestion(attemptId, null);
    if (feedback.generation.state !== "ready") {
      setWaitingForQuestions(true);
      setError(undefined);
      return;
    }
    setWaitingForQuestions(false);
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
    const mastered = mastery === "mastered";
    return (
      <Screen contentWidth="lesson" centered>
        <FeedbackMotion signal={score} kind="success" style={styles.complete}>
          <MotionView preset="pop" duration={520} style={styles.celebrationArt}>
            <LearningPrism size={176} variant="hero" />
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
          <View style={styles.stats}>
            <StaggerItem index={0} style={styles.statItem}>
              <StatTile
                value={`${Math.round(score)}%`}
                label={t("score")}
                tone={score >= 80 ? "success" : "primary"}
                icon={
                  <VoxelIcon
                    name="target"
                    size={22}
                    color={score >= 80 ? theme.success : theme.primary}
                  />
                }
              />
            </StaggerItem>
            <StaggerItem index={1} style={styles.statItem}>
              <StatTile
                value={t(mastery === "mastered" ? "mastered" : "learning")}
                label={t("mastery")}
                tone={mastered ? "success" : "secondary"}
                icon={
                  <VoxelIcon
                    name={mastered ? "correct" : "progress"}
                    size={22}
                    color={mastered ? theme.success : theme.secondary}
                  />
                }
              />
            </StaggerItem>
            {completedTotal ? (
              <StaggerItem index={2} style={styles.statItem}>
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
          </View>
          <MotionView preset="rise" delay={176} style={styles.completeButton}>
            <PrimaryButton
              trailingIcon={
                <VoxelIcon name="next" size={20} color={theme.textOnAction} />
              }
              onPress={() => {
                void clearAttempt(attemptId);
                router.replace("/(tabs)/library");
              }}
            >
              {t("returnToLibrary")}
            </PrimaryButton>
          </MotionView>
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
              void markPrimerSeen(attemptId);
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
  const footer = feedback ? (
    <FeedbackPanel
      status={feedback.correct ? "correct" : "incorrect"}
      title={feedback.correct ? t("correct") : t("incorrect")}
      detail={presentQuizText(feedback.explanation)}
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
  answer,
  feedback,
  setAnswer,
  onInteraction,
  disabled,
}: {
  question: PublicQuestion;
  displayOptions?: string[];
  answer: Answer | undefined;
  feedback?: AttemptAnswerResponse;
  setAnswer(answer: Answer): void;
  onInteraction(): void;
  disabled: boolean;
}) {
  const { t, theme } = useSettings();
  const stateFor = (selected: boolean): AnswerState => {
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
              state={stateFor(answer === index)}
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
            state={stateFor(answer === true)}
            onPress={() => setAnswer(true)}
          />
        </StaggerItem>
        <StaggerItem index={1} preset="from-right" style={styles.binaryOption}>
          <AnswerCard
            label={t("false")}
            state={stateFor(answer === false)}
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
  statItem: { minWidth: 132, flex: 1 },
  completeButton: {
    width: "100%",
    maxWidth: 440,
  },
});
