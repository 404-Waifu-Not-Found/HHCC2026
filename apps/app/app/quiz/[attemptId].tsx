import {
  AttemptAnswerResponseSchema,
  AttemptResumeResponseSchema,
  type AttemptAnswerResponse,
  type AttemptResumeResponse,
  type MasteryState,
  type PublicQuestion,
} from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AnswerCard, type AnswerState } from "../../src/components/AnswerCard";
import { AppTextInput } from "../../src/components/AppTextInput";
import { EmptyState } from "../../src/components/EmptyState";
import { FeedbackPanel } from "../../src/components/FeedbackPanel";
import { IconButton } from "../../src/components/IconButton";
import { LessonHeader } from "../../src/components/LessonHeader";
import { Mascot } from "../../src/components/Mascot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Screen } from "../../src/components/Screen";
import { StatTile } from "../../src/components/StatTile";
import { Surface } from "../../src/components/Surface";
import { apiRequest, ClientApiError, jsonBody } from "../../src/lib/api";
import { createInitialOrdering } from "../../src/lib/quiz-order";
import { useSettings } from "../../src/providers/SettingsProvider";
import {
  clearAttempt,
  loadAttempt,
  markPrimerSeen,
  saveAttemptQuestion,
} from "../../src/state/attempt";
import {
  borders,
  breakpoints,
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const activateQuestion = useCallback((nextQuestion: PublicQuestion) => {
    setQuestion(nextQuestion);
    setAnswer(
      nextQuestion.type === "ordering"
        ? createInitialOrdering(nextQuestion.items?.length ?? 0)
        : undefined,
    );
    setOrderingTouched(false);
    setFeedback(undefined);
    setError(undefined);
  }, []);

  const applyResume = useCallback(
    async (resumed: AttemptResumeResponse) => {
      setFeedback(undefined);
      setError(undefined);
      if (resumed.completed) {
        setQuestion(undefined);
        setAnswer(undefined);
        setScore(resumed.score ?? 0);
        setMastery(resumed.mastery ?? "learning");
        setShowCompletion(true);
        return;
      }
      if (!resumed.question) throw new Error(t("quizResumeMissing"));
      activateQuestion(resumed.question);
      setScore(undefined);
      setMastery(undefined);
      setShowCompletion(false);
      await saveAttemptQuestion(attemptId, resumed.question);
    },
    [activateQuestion, attemptId, t],
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

  const canSubmit = useMemo(() => {
    if (answer === undefined) return false;
    if (typeof answer === "string") return answer.trim().length > 0;
    return question?.type !== "ordering" || orderingTouched;
  }, [answer, orderingTouched, question?.type]);

  const submit = async () => {
    if (!question || !canSubmit || answer === undefined) {
      setError(t("answerRequired"));
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await apiRequest(
        `/api/attempts/${attemptId}/answer`,
        { method: "POST", body: jsonBody({ questionId: question.id, answer }) },
        AttemptAnswerResponseSchema,
      );
      setFeedback(result);
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
    if (feedback.nextQuestion) activateQuestion(feedback.nextQuestion);
  };

  if (loading) {
    return (
      <Screen scroll={false} contentWidth="lesson" centered>
        <View accessibilityLiveRegion="polite" style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            {t("loading")}
          </Text>
        </View>
      </Screen>
    );
  }

  if (showCompletion && score !== undefined) {
    const mastered = mastery === "mastered";
    return (
      <Screen contentWidth="lesson" centered>
        <View style={styles.complete}>
          <View style={styles.celebrationArt}>
            <MaterialCommunityIcons
              name="star-four-points"
              size={30}
              color={theme.warning}
              style={styles.sparkLeft}
            />
            <Mascot mood="happy" size={176} />
            <MaterialCommunityIcons
              name="star-four-points"
              size={24}
              color={theme.secondary}
              style={styles.sparkRight}
            />
          </View>
          <View style={styles.completeCopy}>
            <Text
              accessibilityRole="header"
              style={[styles.completeTitle, { color: theme.text }]}
            >
              {t("quizComplete")}
            </Text>
            <Text style={[styles.completeBody, { color: theme.textMuted }]}>
              {mastered ? t("masteryBuilt") : t("laterReview")}
            </Text>
          </View>
          <View style={styles.stats}>
            <StatTile
              value={`${Math.round(score)}%`}
              label={t("score")}
              tone={score >= 80 ? "success" : "primary"}
              icon={
                <MaterialCommunityIcons
                  name="target"
                  size={22}
                  color={score >= 80 ? theme.success : theme.primary}
                />
              }
            />
            <StatTile
              value={t(mastery === "mastered" ? "mastered" : "learning")}
              label={t("mastery")}
              tone={mastered ? "success" : "secondary"}
              icon={
                <MaterialCommunityIcons
                  name={
                    mastered
                      ? "check-decagram"
                      : "chart-timeline-variant-shimmer"
                  }
                  size={22}
                  color={mastered ? theme.success : theme.secondary}
                />
              }
            />
            {completedTotal ? (
              <StatTile
                value={String(completedTotal)}
                label={t("questions")}
                tone="warning"
                icon={
                  <MaterialCommunityIcons
                    name="help-circle-outline"
                    size={22}
                    color={theme.warning}
                  />
                }
              />
            ) : null}
          </View>
          <View style={styles.completeButton}>
            <PrimaryButton
              trailingIcon={
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={20}
                  color={theme.textOnAction}
                />
              }
              onPress={() => {
                void clearAttempt(attemptId);
                router.replace("/(tabs)");
              }}
            >
              {t("finish")}
            </PrimaryButton>
          </View>
        </View>
      </Screen>
    );
  }

  if (error && !question) {
    return (
      <Screen contentWidth="reading" centered>
        <EmptyState
          icon="alert-circle-outline"
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

  if (showPrimer && primer) {
    return (
      <Screen contentWidth="reading" centered>
        <View style={styles.primerTop}>
          <Mascot mood="ready" size={132} />
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
        </View>
        <Surface tone="tinted" style={styles.primerCard}>
          <View style={styles.primerLabel}>
            <MaterialCommunityIcons
              name="lightbulb-on-outline"
              size={22}
              color={theme.primary}
            />
            <Text style={[styles.primerLabelText, { color: theme.primary }]}>
              {t("primerTitle")}
            </Text>
          </View>
          <Text selectable style={[styles.primerText, { color: theme.text }]}>
            {primer}
          </Text>
        </Surface>
        <View style={styles.primerButton}>
          <PrimaryButton
            onPress={() => {
              setShowPrimer(false);
              void markPrimerSeen(attemptId);
            }}
          >
            {t("beginQuiz")}
          </PrimaryButton>
        </View>
      </Screen>
    );
  }

  const progress = (question.position - 1) / question.total;
  const progressLabel = `${t("question")} ${question.position} of ${question.total}`;
  const footer = feedback ? (
    <FeedbackPanel
      status={feedback.correct ? "correct" : "incorrect"}
      title={feedback.correct ? t("correct") : t("incorrect")}
      detail={feedback.explanation}
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
    <Screen contentWidth="lesson" footer={footer} footerFlush>
      <LessonHeader
        progress={progress}
        progressLabel={progressLabel}
        statusLabel={`${question.position}/${question.total}`}
        closeLabel={t("cancel")}
        onClose={() => router.replace("/(tabs)")}
      />
      <View style={styles.quizBody}>
        <View style={styles.questionMeta}>
          <Text style={[styles.eyebrow, { color: theme.primary }]}>
            {questionTypeLabel(question.type)}
          </Text>
          {question.isRetry ? (
            <View
              style={[
                styles.retryBadge,
                { backgroundColor: theme.secondarySoft },
              ]}
            >
              <MaterialCommunityIcons
                name="refresh"
                size={16}
                color={theme.secondaryPressed}
              />
              <Text
                style={[styles.retryText, { color: theme.secondaryPressed }]}
              >
                {t("retryingConcept")}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          accessibilityRole="header"
          style={[styles.question, { color: theme.text }]}
        >
          {question.prompt}
        </Text>
        <QuestionInput
          question={question}
          answer={answer}
          feedback={feedback}
          setAnswer={setAnswer}
          onInteraction={() => setOrderingTouched(true)}
          disabled={Boolean(feedback) || submitting}
        />
        {error ? (
          <Text
            accessibilityRole="alert"
            style={[styles.error, { color: theme.error }]}
          >
            {error}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

function QuestionInput({
  question,
  answer,
  feedback,
  setAnswer,
  onInteraction,
  disabled,
}: {
  question: PublicQuestion;
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
        {question.options?.map((option, index) => (
          <AnswerCard
            key={`${index}-${option}`}
            indexLabel={String.fromCharCode(65 + index)}
            label={option}
            state={stateFor(answer === index)}
            onPress={() => setAnswer(index)}
          />
        ))}
      </View>
    );
  }
  if (question.type === "true_false") {
    return (
      <View style={styles.binary}>
        <View style={styles.binaryOption}>
          <AnswerCard
            label={t("true")}
            leading={
              <MaterialCommunityIcons
                name="check-circle-outline"
                size={26}
                color={theme.success}
              />
            }
            state={stateFor(answer === true)}
            onPress={() => setAnswer(true)}
          />
        </View>
        <View style={styles.binaryOption}>
          <AnswerCard
            label={t("false")}
            leading={
              <MaterialCommunityIcons
                name="close-circle-outline"
                size={26}
                color={theme.error}
              />
            }
            state={stateFor(answer === false)}
            onPress={() => setAnswer(false)}
          />
        </View>
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
          <View
            key={itemIndex}
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
            <Text style={[styles.orderText, { color: theme.text }]}>
              {question.items?.[itemIndex]}
            </Text>
            <View style={styles.orderActions}>
              <IconButton
                label={t("moveUp")}
                icon="chevron-up"
                disabled={disabled || position === 0}
                onPress={() => {
                  onInteraction();
                  setAnswer(move(order, position, position - 1));
                }}
              />
              <IconButton
                label={t("moveDown")}
                icon="chevron-down"
                disabled={disabled || position === order.length - 1}
                onPress={() => {
                  onInteraction();
                  setAnswer(move(order, position, position + 1));
                }}
              />
            </View>
          </View>
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
  sparkLeft: {
    position: "absolute",
    left: -28,
    top: 28,
  },
  sparkRight: {
    position: "absolute",
    right: -22,
    top: 10,
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
  completeButton: {
    width: "100%",
    maxWidth: 440,
  },
});
