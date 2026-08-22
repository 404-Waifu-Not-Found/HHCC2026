// A compact "thinking" panel shown while the assistant is reasoning or running
// a tool, before its first visible text. It surfaces the current step in short,
// learner-friendly words with a subtle pulsing shimmer, then collapses (its
// finished tools fold into the ToolCallTrail). Reduced-motion safe.
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { WorkplaceToolName } from "@clipquest/contracts";
import { useSettings } from "../../providers/SettingsProvider";
import {
  borders,
  motion,
  radii,
  spacing,
  typography,
} from "../../theme/tokens";
import { MotionView } from "../../motion/Motion";
import type { MessageKey } from "../../i18n/messages";

const TOOL_ACTIVE_KEYS: Record<WorkplaceToolName, MessageKey> = {
  search_videos: "workplaceToolSearchVideos",
  search_transcript: "workplaceToolSearchTranscript",
  generate_practice_set: "workplaceToolGeneratePracticeSet",
  lookup_mastery: "workplaceToolLookupMastery",
  find_due_reviews: "workplaceToolFindDueReviews",
};

function ThinkingDot({ color }: { color: string }) {
  const { reduceMotion } = useSettings();
  const progress = useSharedValue(0.4);

  useEffect(() => {
    cancelAnimation(progress);
    if (reduceMotion) {
      progress.value = 0.6;
      return;
    }
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: motion.emphasized }),
        withTiming(0.35, { duration: motion.emphasized }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.85 + progress.value * 0.25 }],
  }));

  return (
    <Animated.View
      style={[styles.dot, { backgroundColor: color }, animatedStyle]}
    />
  );
}

export function ThinkingWindow({
  activeToolName,
}: {
  activeToolName?: WorkplaceToolName;
}) {
  const { t, theme } = useSettings();
  const label = activeToolName
    ? t(TOOL_ACTIVE_KEYS[activeToolName])
    : t("workplaceThinking");

  return (
    <MotionView
      preset="rise"
      exiting
      exitPreset="fade"
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.window,
        {
          backgroundColor: theme.primarySoft,
          borderColor: theme.primary,
        },
      ]}
    >
      <View style={styles.dots}>
        <ThinkingDot color={theme.primary} />
      </View>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
    </MotionView>
  );
}

const styles = StyleSheet.create({
  window: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing[2],
    maxWidth: "100%",
    borderWidth: borders.hairline,
    borderRadius: radii.medium,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
  },
  dots: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
  },
  label: {
    flexShrink: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
