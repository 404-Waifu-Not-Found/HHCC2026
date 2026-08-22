import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { spacing, typography } from "../theme/tokens";
import {
  buildContributionWeeks,
  intensityForCount,
  type ContributionDay,
  type DailyQuizCompletion,
} from "../lib/quiz-contributions";

const DAY_SIZE = 9;
const DAY_GAP = 2;
const WEEK_WIDTH = DAY_SIZE + DAY_GAP;
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

export function QuizContributionCalendar({
  completions,
}: {
  completions: DailyQuizCompletion[];
}) {
  const { t, theme } = useSettings();
  const chartRef = useRef<ScrollView>(null);
  const weeks = buildContributionWeeks(completions);
  const [selected, setSelected] = useState<ContributionDay>(() =>
    latestCompletedDay(weeks),
  );
  const total = completions.reduce((sum, day) => sum + day.count, 0);
  const colors = [
    theme.surfaceSunken,
    theme.successSoft,
    theme.actionSoft,
    theme.action,
    theme.primary,
  ];

  return (
    <View style={styles.container}>
      <Text style={[styles.summary, { color: theme.text }]}>
        {total === 1
          ? t("quizActivitySingle")
          : `${total} ${t("quizActivitySummary")}`}
      </Text>
      <View style={styles.chartRow}>
        <View style={styles.weekdayLabels}>
          <View style={styles.monthSpacer} />
          {WEEKDAY_LABELS.map((label, index) => (
            <Text
              key={index}
              style={[styles.weekdayLabel, { color: theme.textMuted }]}
            >
              {label}
            </Text>
          ))}
        </View>
        <ScrollView
          ref={chartRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: weeks.length * WEEK_WIDTH, y: 0 }}
          contentContainerStyle={styles.scrollContent}
          onLayout={() => chartRef.current?.scrollToEnd({ animated: false })}
          onContentSizeChange={() =>
            chartRef.current?.scrollToEnd({ animated: false })
          }
        >
          <View>
            <View
              style={[styles.monthLabels, { width: weeks.length * WEEK_WIDTH }]}
            >
              {weeks.map((week, index) => {
                const firstOfMonth = week.find(
                  (day) => !day.future && day.date.endsWith("-01"),
                );
                return firstOfMonth ? (
                  <Text
                    key={firstOfMonth.date}
                    style={[
                      styles.monthLabel,
                      {
                        color: theme.textMuted,
                        left: index * WEEK_WIDTH,
                      },
                    ]}
                  >
                    {formatMonth(firstOfMonth.date)}
                  </Text>
                ) : null;
              })}
            </View>
            <View style={styles.weeks}>
              {weeks.map((week, weekIndex) => (
                <View key={week[0]?.date ?? weekIndex} style={styles.week}>
                  {week.map((day) =>
                    day.future ? (
                      <View key={day.date} style={styles.day} />
                    ) : (
                      <Pressable
                        key={day.date}
                        accessibilityRole="button"
                        accessibilityLabel={dayAccessibilityLabel(day)}
                        hitSlop={1}
                        onHoverIn={() => setSelected(day)}
                        onPress={() => setSelected(day)}
                        style={({ pressed }) => [
                          styles.day,
                          {
                            backgroundColor:
                              colors[intensityForCount(day.count)],
                            borderColor:
                              selected.date === day.date
                                ? theme.text
                                : "transparent",
                            opacity: pressed ? 0.68 : 1,
                          },
                        ]}
                      />
                    ),
                  )}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
      <View style={styles.footer}>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.detail, { color: theme.textMuted }]}
        >
          {dayAccessibilityLabel(selected)}
        </Text>
        <View style={styles.legend}>
          <Text style={[styles.legendLabel, { color: theme.textMuted }]}>
            0
          </Text>
          {colors.map((color, index) => (
            <View
              key={color}
              accessibilityLabel={
                index === 4 ? "4 or more quizzes" : `${index} quizzes`
              }
              style={[styles.legendDay, { backgroundColor: color }]}
            />
          ))}
          <Text style={[styles.legendLabel, { color: theme.textMuted }]}>
            4+
          </Text>
        </View>
      </View>
    </View>
  );
}

function latestCompletedDay(weeks: ContributionDay[][]): ContributionDay {
  return (
    weeks
      .flat()
      .filter((day) => !day.future)
      .at(-1) ?? {
      date: new Date().toISOString().slice(0, 10),
      count: 0,
      future: false,
    }
  );
}

function formatMonth(date: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function dayAccessibilityLabel(day: DailyQuizCompletion): string {
  const formatted = new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day.date}T00:00:00Z`));
  return `${formatted}: ${day.count} ${day.count === 1 ? "quiz" : "quizzes"} completed`;
}

const styles = StyleSheet.create({
  container: {
    gap: spacing[3],
  },
  summary: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  chartRow: {
    flexDirection: "row",
    minWidth: 0,
  },
  weekdayLabels: {
    width: 34,
    flexShrink: 0,
  },
  monthSpacer: {
    height: 22,
  },
  weekdayLabel: {
    height: DAY_SIZE + DAY_GAP,
    fontFamily: typography.body,
    fontSize: 10,
    lineHeight: DAY_SIZE,
  },
  scrollContent: {
    paddingRight: spacing[1],
  },
  monthLabels: {
    height: 22,
    position: "relative",
  },
  monthLabel: {
    position: "absolute",
    top: 0,
    width: 36,
    fontFamily: typography.body,
    fontSize: 10,
    lineHeight: 14,
  },
  weeks: {
    flexDirection: "row",
    gap: DAY_GAP,
  },
  week: {
    gap: DAY_GAP,
  },
  day: {
    width: DAY_SIZE,
    height: DAY_SIZE,
    borderWidth: 1,
    borderRadius: 2,
  },
  footer: {
    minHeight: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  detail: {
    minWidth: 0,
    flex: 1,
    fontFamily: typography.body,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: DAY_GAP,
  },
  legendDay: {
    width: DAY_SIZE,
    height: DAY_SIZE,
    borderRadius: 2,
  },
  legendLabel: {
    fontFamily: typography.body,
    fontSize: 10,
    lineHeight: 14,
  },
});
