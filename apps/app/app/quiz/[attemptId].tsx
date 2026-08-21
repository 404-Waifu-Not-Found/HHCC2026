import {
  AttemptAnswerResponseSchema,
  AttemptResumeResponseSchema,
  type AttemptAnswerResponse,
  type MasteryState,
  type PublicQuestion,
} from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Mascot } from "../../src/components/Mascot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { ProgressBar } from "../../src/components/ProgressBar";
import { Screen } from "../../src/components/Screen";
import { apiRequest, jsonBody } from "../../src/lib/api";
import { useSettings } from "../../src/providers/SettingsProvider";
import { clearAttempt, loadAttempt, markPrimerSeen, saveAttemptQuestion } from "../../src/state/attempt";
import { radii, typography } from "../../src/theme/tokens";

type Answer = number | boolean | number[] | string;

export default function QuizScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const { t, theme, reduceMotion } = useSettings();
  const [question, setQuestion] = useState<PublicQuestion>();
  const [primer, setPrimer] = useState<string | null>(null);
  const [showPrimer, setShowPrimer] = useState(false);
  const [answer, setAnswer] = useState<Answer>();
  const [feedback, setFeedback] = useState<AttemptAnswerResponse>();
  const [score, setScore] = useState<number>();
  const [mastery, setMastery] = useState<MasteryState>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await loadAttempt(attemptId);
      if (!active) return;
      if (stored?.question) {
        setQuestion(stored.question);
        setPrimer(stored.primer);
        setShowPrimer(Boolean(stored.primer && !stored.primerSeen));
        setLoading(false);
        return;
      }
      try {
        const resumed = await apiRequest(`/api/attempts/${attemptId}/resume`, {}, AttemptResumeResponseSchema);
        if (!active) return;
        if (resumed.completed) setScore(resumed.score ?? 0);
        else if (resumed.question) {
          setQuestion(resumed.question);
          await saveAttemptQuestion(attemptId, resumed.question);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not resume this quiz.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [attemptId]);

  useEffect(() => {
    setAnswer(question?.type === "ordering" ? question.items?.map((_, index) => index) : undefined);
    setFeedback(undefined);
    setError(undefined);
  }, [question?.id, question?.isRetry]);

  const canSubmit = useMemo(() => {
    if (answer === undefined) return false;
    if (typeof answer === "string") return answer.trim().length > 0;
    return true;
  }, [answer]);

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
      }
      if (result.correct) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check that answer.");
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (!feedback) return;
    if (feedback.completed) return;
    if (feedback.nextQuestion) setQuestion(feedback.nextQuestion);
  };

  if (loading) return <Screen scroll={false}><View style={styles.center}><ActivityIndicator size="large" color={theme.secondary} /></View></Screen>;

  if (score !== undefined && (!question || feedback?.completed)) {
    return (
      <Screen scroll={false}>
        <View style={styles.complete}>
          <Mascot mood="happy" size={124} />
          <Text accessibilityRole="header" style={[styles.completeTitle, { color: theme.text }]}>{t("quizComplete")}</Text>
          <View style={[styles.scoreCircle, { backgroundColor: score >= 80 ? theme.primary : theme.secondary }]}>
            <Text style={[styles.scoreNumber, { color: theme.text }]}>{Math.round(score)}%</Text>
            <Text style={[styles.scoreLabel, { color: theme.text }]}>{t("score")}</Text>
          </View>
          <Text style={[styles.completeBody, { color: theme.textMuted }]}>{mastery === "mastered" ? t("masteryBuilt") : t("laterReview")}</Text>
          <View style={styles.completeButton}><PrimaryButton onPress={() => { void clearAttempt(attemptId); router.replace("/(tabs)"); }}>{t("finish")}</PrimaryButton></View>
        </View>
      </Screen>
    );
  }

  if (error && !question) {
    return <Screen><View style={styles.center}><Mascot mood="oops" /><Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</Text><PrimaryButton onPress={() => router.replace("/(tabs)")}>{t("home")}</PrimaryButton></View></Screen>;
  }
  if (!question) return null;

  if (showPrimer && primer) {
    return (
      <Screen>
        <View style={styles.primerTop}><Mascot mood="ready" size={100} /><Text accessibilityRole="header" style={[styles.primerTitle, { color: theme.text }]}>{t("primerTitle")}</Text></View>
        <View style={[styles.primerCard, { backgroundColor: theme.surface, borderColor: theme.border }]}><Text style={[styles.primerText, { color: theme.text }]}>{primer}</Text></View>
        <View style={styles.primerButton}><PrimaryButton onPress={() => { setShowPrimer(false); void markPrimerSeen(attemptId); }}>{t("beginQuiz")}</PrimaryButton></View>
      </Screen>
    );
  }

  const progress = (question.position - 1) / question.total;
  return (
    <Screen scroll={false} footer={
      feedback ? <PrimaryButton onPress={next}>{feedback.completed ? t("finish") : t("next")}</PrimaryButton> : <PrimaryButton loading={submitting} disabled={!canSubmit} onPress={() => void submit()}>{t("checkAnswer")}</PrimaryButton>
    }>
      <View style={styles.quizHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={() => router.replace("/(tabs)")} style={styles.close}>
          <MaterialCommunityIcons name="close" size={27} color={theme.textMuted} />
        </Pressable>
        <View style={styles.topProgress}><ProgressBar progress={progress} accessibilityLabel={`${t("question")} ${question.position} of ${question.total}`} /></View>
        <Text style={[styles.counter, { color: theme.textMuted }]}>{question.position}/{question.total}</Text>
      </View>
      <View style={styles.quizBody}>
        {question.isRetry ? <View style={[styles.retryBadge, { backgroundColor: theme.secondary }]}><MaterialCommunityIcons name="refresh" size={16} color={theme.text} /><Text style={[styles.retryText, { color: theme.text }]}>{t("retryingConcept")}</Text></View> : null}
        <Text accessibilityRole="header" style={[styles.question, { color: theme.text }]}>{question.prompt}</Text>
        <QuestionInput question={question} answer={answer} setAnswer={setAnswer} disabled={Boolean(feedback)} />
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
        {feedback ? (
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(280)}
            accessibilityLiveRegion="polite"
            style={[styles.feedback, { backgroundColor: feedback.correct ? `${theme.success}24` : `${theme.error}1D`, borderColor: feedback.correct ? theme.success : theme.error }]}
          >
            <Mascot mood={feedback.correct ? "happy" : "oops"} size={60} />
            <View style={styles.feedbackCopy}>
              <Text style={[styles.feedbackTitle, { color: theme.text }]}>{feedback.correct ? t("correct") : t("incorrect")}</Text>
              <Text style={[styles.explanation, { color: theme.text }]}>{feedback.explanation}</Text>
            </View>
          </Animated.View>
        ) : null}
      </View>
    </Screen>
  );
}

function QuestionInput({ question, answer, setAnswer, disabled }: { question: PublicQuestion; answer: Answer | undefined; setAnswer(answer: Answer): void; disabled: boolean }) {
  const { t, theme } = useSettings();
  if (question.type === "multiple_choice") {
    return <View style={styles.options}>{question.options?.map((option, index) => <OptionButton key={`${index}-${option}`} label={option} selected={answer === index} disabled={disabled} onPress={() => setAnswer(index)} />)}</View>;
  }
  if (question.type === "true_false") {
    return <View style={styles.binary}><OptionButton label={t("true")} icon="check-circle-outline" selected={answer === true} disabled={disabled} onPress={() => setAnswer(true)} /><OptionButton label={t("false")} icon="close-circle-outline" selected={answer === false} disabled={disabled} onPress={() => setAnswer(false)} /></View>;
  }
  if (question.type === "ordering") {
    const order = Array.isArray(answer) ? answer : question.items?.map((_, index) => index) ?? [];
    return (
      <View accessibilityLabel="Arrange the items in order" style={styles.options}>
        {order.map((itemIndex, position) => (
          <View key={itemIndex} style={[styles.orderItem, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={[styles.orderNumber, { backgroundColor: theme.secondary }]}><Text style={[styles.orderNumberText, { color: theme.text }]}>{position + 1}</Text></View>
            <Text style={[styles.orderText, { color: theme.text }]}>{question.items?.[itemIndex]}</Text>
            <View style={styles.orderActions}>
              <MoveButton label={t("moveUp")} icon="chevron-up" disabled={disabled || position === 0} onPress={() => setAnswer(move(order, position, position - 1))} />
              <MoveButton label={t("moveDown")} icon="chevron-down" disabled={disabled || position === order.length - 1} onPress={() => setAnswer(move(order, position, position + 1))} />
            </View>
          </View>
        ))}
      </View>
    );
  }
  return (
    <TextInput
      accessibilityLabel="Short answer"
      editable={!disabled}
      multiline
      maxLength={2_000}
      value={typeof answer === "string" ? answer : ""}
      onChangeText={setAnswer}
      placeholder="Write a short answer…"
      placeholderTextColor={theme.textMuted}
      style={[styles.shortAnswer, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
    />
  );
}

function OptionButton({ label, selected, disabled, onPress, icon }: { label: string; selected: boolean; disabled: boolean; onPress(): void; icon?: "check-circle-outline" | "close-circle-outline" }) {
  const { theme } = useSettings();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.option, { backgroundColor: selected ? theme.primary : theme.surface, borderColor: selected ? theme.text : theme.border }, pressed && styles.pressed]}>
      {icon ? <MaterialCommunityIcons name={icon} size={25} color={theme.text} /> : null}
      <Text style={[styles.optionText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

function MoveButton({ label, icon, disabled, onPress }: { label: string; icon: "chevron-up" | "chevron-down"; disabled: boolean; onPress(): void }) {
  const { theme } = useSettings();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.moveButton, disabled && styles.disabled]}><MaterialCommunityIcons name={icon} size={25} color={theme.text} /></Pressable>;
}

function move(values: number[], from: number, to: number): number[] {
  const next = [...values];
  const [value] = next.splice(from, 1);
  if (value !== undefined) next.splice(to, 0, value);
  return next;
}

const styles = StyleSheet.create({
  center: { flex: 1, minHeight: 400, alignItems: "center", justifyContent: "center", gap: 18 },
  quizHeader: { flexDirection: "row", alignItems: "center", gap: 13 },
  close: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  topProgress: { flex: 1 },
  counter: { minWidth: 44, fontFamily: typography.bodyBold, fontSize: 14, textAlign: "right" },
  quizBody: { width: "100%", maxWidth: 760, alignSelf: "center", flex: 1, paddingTop: 24, gap: 20 },
  retryBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: radii.pill },
  retryText: { fontFamily: typography.bodyBold, fontSize: 12 },
  question: { fontFamily: typography.displayMedium, fontSize: 27, lineHeight: 34 },
  options: { gap: 11 },
  binary: { flexDirection: "row", gap: 12 },
  option: { flex: 1, minHeight: 60, borderWidth: 2, borderRadius: radii.medium, paddingHorizontal: 16, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  optionText: { flex: 1, fontFamily: typography.bodyBold, fontSize: 16, lineHeight: 22 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  shortAnswer: { minHeight: 150, borderWidth: 2, borderRadius: radii.medium, padding: 16, fontFamily: typography.body, fontSize: 16, lineHeight: 23, textAlignVertical: "top" },
  orderItem: { minHeight: 64, borderWidth: 2, borderRadius: radii.medium, flexDirection: "row", alignItems: "center", padding: 9, gap: 10 },
  orderNumber: { width: 35, height: 35, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  orderNumberText: { fontFamily: typography.bodyBold, fontSize: 14 },
  orderText: { flex: 1, fontFamily: typography.bodyMedium, fontSize: 15, lineHeight: 20 },
  orderActions: { flexDirection: "row" },
  moveButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.28 },
  feedback: { borderWidth: 2, borderRadius: radii.large, padding: 14, flexDirection: "row", alignItems: "center", gap: 13 },
  feedbackCopy: { flex: 1, gap: 4 },
  feedbackTitle: { fontFamily: typography.displayMedium, fontSize: 19 },
  explanation: { fontFamily: typography.body, fontSize: 14, lineHeight: 20 },
  error: { fontFamily: typography.bodyMedium, fontSize: 14, lineHeight: 20, textAlign: "center" },
  primerTop: { alignItems: "center", gap: 10 },
  primerTitle: { fontFamily: typography.display, fontSize: 32 },
  primerCard: { width: "100%", maxWidth: 720, alignSelf: "center", borderWidth: 2, borderRadius: radii.large, padding: 24, marginTop: 18 },
  primerText: { fontFamily: typography.body, fontSize: 17, lineHeight: 27 },
  primerButton: { width: "100%", maxWidth: 520, alignSelf: "center", marginTop: 20 },
  complete: { flex: 1, minHeight: 500, alignItems: "center", justifyContent: "center", gap: 17 },
  completeTitle: { fontFamily: typography.display, fontSize: 36, textAlign: "center" },
  scoreCircle: { width: 142, height: 142, borderRadius: 71, alignItems: "center", justifyContent: "center" },
  scoreNumber: { fontFamily: typography.display, fontSize: 39 },
  scoreLabel: { fontFamily: typography.bodyBold, fontSize: 13 },
  completeBody: { maxWidth: 520, fontFamily: typography.bodyMedium, fontSize: 15, lineHeight: 22, textAlign: "center" },
  completeButton: { width: "100%", maxWidth: 420 },
});
