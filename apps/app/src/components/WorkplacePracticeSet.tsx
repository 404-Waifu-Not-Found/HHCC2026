import { type WorkplacePracticeSet as WorkplacePracticeSetData } from "@clipquest/contracts";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { apiRequest } from "../lib/api";
import { useSettings } from "../providers/SettingsProvider";
import { borders, radii, spacing, typography } from "../theme/tokens";
import { AnswerCard, type AnswerState } from "./AnswerCard";
import { AppTextInput } from "./AppTextInput";
import { FeedbackPanel } from "./FeedbackPanel";
import { MathText } from "./MathText";
import { PrimaryButton } from "./PrimaryButton";
import { Surface } from "./Surface";
import {
  classifyPracticeError,
  computePracticeScore,
  gradeLocalPracticeAnswer,
  practiceSaveMode,
  submitWorkplacePracticeAttempt,
  type PracticeApiRequest,
  type PracticeLocalAnswer,
  type PracticeQuestionGrade,
  type PracticeSubmissionOutcome,
} from "../workplace/practice-session";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; outcome: PracticeSubmissionOutcome }
  | { status: "offline" }
  | { status: "error" };

/**
 * Inline, interactive rendering of a Workplace `practice_set` message part.
 *
 * The learner answers each of the five questions in-thread, gets immediate
 * local feedback, and can save the whole attempt. Saving reuses the exact same
 * public question/answer surfaces as the main quiz (`AnswerCard`,
 * `AppTextInput`, `FeedbackPanel`) and routes through the standard
 * `/api/quizzes` grading flow tagged with the Workplace origin. Whether the
 * save is a graded diagnostic or practice-only is decided by the set's policy
 * and video count; mastery movement is never computed here -- the server is the
 * sole authority and this component only reflects its `affectsMastery` reply.
 */
export function WorkplacePracticeSet({
  practiceSet,
  threadId,
  request = apiRequest as PracticeApiRequest,
  createId = () => Crypto.randomUUID(),
  onSaved,
}: {
  practiceSet: WorkplacePracticeSetData;
  threadId: string;
  request?: PracticeApiRequest;
  createId?: () => string;
  onSaved?: (outcome: PracticeSubmissionOutcome) => void;
}) {
  const { t, theme } = useSettings();
  const questionCount = practiceSet.questions.length;
  const [answers, setAnswers] = useState<(PracticeLocalAnswer | undefined)[]>(
    () => Array.from({ length: questionCount }, () => undefined),
  );
  const [grades, setGrades] = useState<(PracticeQuestionGrade | undefined)[]>(
    () => Array.from({ length: questionCount }, () => undefined),
  );
  const [expanded, setExpanded] = useState<boolean[]>(() =>
    Array.from({ length: questionCount }, () => false),
  );
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  // Cancel any pending save if the learner leaves the Workplace tab or the
  // thread unmounts, so an in-flight import/attempt never resolves into a
  // torn-down component.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const saveMode = practiceSaveMode(practiceSet);
  const allChecked = grades.every((grade) => grade !== undefined);

  const setAnswer = useCallback((index: number, value: PracticeLocalAnswer) => {
    setAnswers((current) => {
      if (current[index] === value) return current;
      const next = [...current];
      next[index] = value;
      return next;
    });
  }, []);

  const checkAnswer = useCallback(
    (index: number) => {
      setGrades((current) => {
        if (current[index]) return current;
        const answer = answers[index];
        if (answer === undefined) return current;
        const next = [...current];
        next[index] = gradeLocalPracticeAnswer(
          practiceSet.questions[index]!,
          index,
          answer,
        );
        return next;
      });
    },
    [answers, practiceSet.questions],
  );

  const toggleExplanation = useCallback((index: number) => {
    setExpanded((current) => {
      const next = [...current];
      next[index] = !next[index];
      return next;
    });
  }, []);

  const score = useMemo(() => {
    if (!allChecked) return null;
    return computePracticeScore(
      grades.filter((grade): grade is PracticeQuestionGrade => Boolean(grade)),
    );
  }, [allChecked, grades]);

  const onSave = useCallback(async () => {
    const resolved = answers.filter(
      (answer): answer is PracticeLocalAnswer => answer !== undefined,
    );
    if (resolved.length !== questionCount) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSaveState({ status: "saving" });
    try {
      const outcome = await submitWorkplacePracticeAttempt({
        threadId,
        practiceSet,
        answers: resolved,
        deps: { request, createId },
        signal: controller.signal,
      });
      setSaveState({ status: "saved", outcome });
      onSaved?.(outcome);
    } catch (error) {
      const kind = classifyPracticeError(error);
      if (kind === "aborted") return;
      setSaveState({ status: kind === "offline" ? "offline" : "error" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [
    answers,
    createId,
    onSaved,
    practiceSet,
    questionCount,
    request,
    threadId,
  ]);

  const recommendationLabel =
    practiceSet.effectivePolicy === "diagnostic"
      ? t("workplaceRecommendedDiagnostic")
      : t("workplaceRecommendedPractice");
  const saveLabel =
    saveMode === "diagnostic"
      ? t("workplacePracticeSaveDiagnostic")
      : t("workplacePracticeSavePractice");

  return (
    <Surface tone="tinted" elevated style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.eyebrow, { color: theme.primary }]}>
            {t("workplacePracticeTitle")}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            {t("workplacePracticeSubtitle")}
          </Text>
        </View>
        <PolicyBadge mode={saveMode} />
      </View>

      <View
        style={[
          styles.recommendation,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.recommendationLabel, { color: theme.text }]}>
          {recommendationLabel}
        </Text>
        <Text style={[styles.rationale, { color: theme.textMuted }]}>
          {practiceSet.rationale}
        </Text>
      </View>

      {practiceSet.questions.map((question, index) => {
        const grade = grades[index];
        const answer = answers[index];
        const checked = Boolean(grade);
        return (
          <View key={question.id} style={styles.question}>
            <Text style={[styles.questionMeta, { color: theme.textMuted }]}>
              {`${index + 1} / ${questionCount}`}
            </Text>
            <MathText style={[styles.prompt, { color: theme.text }]}>
              {question.question}
            </MathText>
            <PracticeQuestionInput
              question={question}
              answer={answer}
              grade={grade}
              disabled={checked}
              onAnswer={(value) => setAnswer(index, value)}
            />
            {!checked ? (
              <PrimaryButton
                variant="secondary"
                compact
                disabled={answer === undefined}
                onPress={() => checkAnswer(index)}
              >
                {t("workplacePracticeCheck")}
              </PrimaryButton>
            ) : (
              <FeedbackPanel
                status={grade!.correct ? "correct" : "incorrect"}
                title={
                  grade!.correct
                    ? t("workplacePracticeCorrect")
                    : t("workplacePracticeIncorrect")
                }
                detail={expanded[index] ? grade!.explanation : undefined}
                action={
                  <PrimaryButton
                    variant="ghost"
                    compact
                    onPress={() => toggleExplanation(index)}
                  >
                    {expanded[index]
                      ? t("workplacePracticeHideExplanation")
                      : t("workplacePracticeShowExplanation")}
                  </PrimaryButton>
                }
              />
            )}
          </View>
        );
      })}

      {score !== null ? (
        <View
          style={[
            styles.summary,
            { backgroundColor: theme.surface, borderColor: theme.borderStrong },
          ]}
        >
          <Text style={[styles.scoreLabel, { color: theme.textMuted }]}>
            {t("workplacePracticeScore")}
          </Text>
          <Text style={[styles.scoreValue, { color: theme.text }]}>
            {`${score}%`}
          </Text>
        </View>
      ) : (
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          {t("workplacePracticeAnswerAll")}
        </Text>
      )}

      <SaveRegion
        saveState={saveState}
        saveLabel={saveLabel}
        canSave={allChecked}
        onSave={onSave}
      />
    </Surface>
  );
}

function SaveRegion({
  saveState,
  saveLabel,
  canSave,
  onSave,
}: {
  saveState: SaveState;
  saveLabel: string;
  canSave: boolean;
  onSave: () => void;
}) {
  const { t, theme } = useSettings();
  if (saveState.status === "saved") {
    const savedMessage =
      saveState.outcome.affectsMastery &&
      saveState.outcome.saveMode === "diagnostic"
        ? t("workplacePracticeSavedDiagnostic")
        : t("workplacePracticeSavedPractice");
    return (
      <Text
        accessibilityRole="summary"
        accessibilityLiveRegion="polite"
        style={[styles.saved, { color: theme.success }]}
      >
        {savedMessage}
      </Text>
    );
  }
  return (
    <View style={styles.saveRegion}>
      {saveState.status === "offline" ? (
        <Text
          accessibilityRole="alert"
          style={[styles.saveNotice, { color: theme.textMuted }]}
        >
          {t("workplacePracticeOffline")}
        </Text>
      ) : null}
      {saveState.status === "error" ? (
        <Text
          accessibilityRole="alert"
          style={[styles.saveNotice, { color: theme.error }]}
        >
          {t("workplacePracticeError")}
        </Text>
      ) : null}
      <PrimaryButton
        onPress={onSave}
        disabled={!canSave || saveState.status === "saving"}
        loading={saveState.status === "saving"}
      >
        {saveState.status === "offline" || saveState.status === "error"
          ? t("workplacePracticeRetry")
          : saveState.status === "saving"
            ? t("workplacePracticeSaving")
            : saveLabel}
      </PrimaryButton>
    </View>
  );
}

function PolicyBadge({ mode }: { mode: "diagnostic" | "practice" }) {
  const { t, theme } = useSettings();
  const diagnostic = mode === "diagnostic";
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: diagnostic ? theme.primarySoft : theme.surfaceTint,
          borderColor: diagnostic ? theme.primary : theme.border,
        },
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          { color: diagnostic ? theme.primary : theme.textMuted },
        ]}
      >
        {diagnostic
          ? t("workplaceDiagnosticBadge")
          : t("workplacePracticeBadge")}
      </Text>
    </View>
  );
}

function PracticeQuestionInput({
  question,
  answer,
  grade,
  disabled,
  onAnswer,
}: {
  question: WorkplacePracticeSetData["questions"][number];
  answer: PracticeLocalAnswer | undefined;
  grade: PracticeQuestionGrade | undefined;
  disabled: boolean;
  onAnswer: (value: PracticeLocalAnswer) => void;
}) {
  const { t } = useSettings();
  const stateFor = (
    selected: boolean,
    isCorrectChoice: boolean,
  ): AnswerState => {
    if (grade) {
      if (isCorrectChoice) return "correct";
      if (selected) return grade.correct ? "correct" : "incorrect";
      return "disabled";
    }
    if (selected) return "selected";
    return disabled ? "disabled" : "default";
  };

  if (question.type === "multiple_choice") {
    return (
      <View style={styles.options}>
        {question.choices.map((choice, index) => (
          <AnswerCard
            key={`${index}-${choice}`}
            indexLabel={String.fromCharCode(65 + index)}
            label={choice}
            state={stateFor(answer === index, index === question.answerIndex)}
            onPress={() => onAnswer(index)}
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
            state={stateFor(answer === true, question.answer === true)}
            onPress={() => onAnswer(true)}
          />
        </View>
        <View style={styles.binaryOption}>
          <AnswerCard
            label={t("false")}
            state={stateFor(answer === false, question.answer === false)}
            onPress={() => onAnswer(false)}
          />
        </View>
      </View>
    );
  }
  return (
    <AppTextInput
      label={t("shortAnswer")}
      accessibilityLabel={t("shortAnswer")}
      editable={!disabled}
      multiline
      maxLength={1_000}
      value={typeof answer === "string" ? answer : ""}
      onChangeText={(value) => onAnswer(value)}
      placeholder={t("shortAnswerPlaceholder")}
      style={styles.shortAnswer}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing[4],
    borderRadius: radii.feature,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  headerText: {
    flex: 1,
    gap: spacing[1],
  },
  eyebrow: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.bodyLarge,
  },
  subtitle: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
  },
  badge: {
    borderRadius: radii.pill,
    borderWidth: borders.hairline,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  badgeText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    letterSpacing: typography.tracking.wide,
    textTransform: "uppercase",
  },
  recommendation: {
    gap: spacing[1],
    borderRadius: radii.medium,
    borderWidth: borders.hairline,
    padding: spacing[3],
  },
  recommendationLabel: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
  },
  rationale: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  question: {
    gap: spacing[3],
  },
  questionMeta: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.caption,
    letterSpacing: typography.tracking.wide,
  },
  prompt: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  options: {
    gap: spacing[2],
  },
  binary: {
    flexDirection: "row",
    gap: spacing[3],
  },
  binaryOption: {
    flex: 1,
  },
  shortAnswer: {
    minHeight: 96,
  },
  summary: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    borderRadius: radii.medium,
    borderWidth: borders.standard,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  scoreLabel: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
  },
  scoreValue: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
  },
  hint: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
  },
  saveRegion: {
    gap: spacing[2],
  },
  saveNotice: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
  },
  saved: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
  },
});
