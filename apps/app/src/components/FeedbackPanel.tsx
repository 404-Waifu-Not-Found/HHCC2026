import { VoxelIcon } from "./VoxelIcon";
import type { PropsWithChildren, ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import {
  borders,
  breakpoints,
  layout,
  spacing,
  typography,
} from "../theme/tokens";
import { FeedbackMotion, MotionView } from "../motion/Motion";
import { MathText } from "./MathText";

export function FeedbackPanel({
  status,
  title,
  detail,
  action,
  children,
}: PropsWithChildren<{
  status: "correct" | "incorrect" | "neutral";
  title: string;
  detail?: string;
  action?: ReactNode;
}>) {
  const { theme } = useSettings();
  const { width, height } = useWindowDimensions();
  const compact = width < breakpoints.tablet;
  const compactMaxHeight = Math.round(height * 0.46);
  const isCorrect = status === "correct";
  const isIncorrect = status === "incorrect";
  const color = isCorrect
    ? theme.success
    : isIncorrect
      ? theme.error
      : theme.primary;
  const background = isCorrect
    ? theme.successSoft
    : isIncorrect
      ? theme.errorSoft
      : theme.surface;
  const icon = isCorrect ? "correct" : isIncorrect ? "error" : "idea";

  return (
    <MotionView
      preset="rise"
      exiting
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      style={[
        styles.panel,
        !compact && styles.panelWide,
        compact && { maxHeight: compactMaxHeight },
        { backgroundColor: background, borderTopColor: color },
      ]}
    >
      <ScrollView
        style={[styles.scroll, !compact && styles.scrollWide]}
        contentContainerStyle={[
          styles.inner,
          compact && styles.innerCompact,
        ]}
        showsVerticalScrollIndicator={compact}
      >
        <FeedbackMotion
          signal={status}
          kind={isIncorrect ? "error" : "success"}
        >
          <MotionView
            preset="pop"
            style={[styles.icon, { borderColor: color }]}
          >
            <VoxelIcon name={icon} color={color} size={28} />
          </MotionView>
        </FeedbackMotion>
        <MotionView preset="rise" delay={44} style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.title, { color }]}>
            {title}
          </Text>
          {detail ? (
            <MathText
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              selectable
              style={[styles.detail, { color: theme.text }]}
            >
              {detail}
            </MathText>
          ) : null}
          {children}
        </MotionView>
      </ScrollView>
      {action ? (
        <MotionView
          preset="from-right"
          delay={88}
          style={[styles.action, compact && styles.actionCompact]}
        >
          {action}
        </MotionView>
      ) : null}
    </MotionView>
  );
}

const styles = StyleSheet.create({
  panel: {
    minHeight: layout.feedbackMinHeight,
    borderTopWidth: borders.selected,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[4],
  },
  panelWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  scroll: {
    flexShrink: 1,
  },
  scrollWide: {
    flex: 1,
  },
  inner: {
    width: "100%",
    maxWidth: layout.lesson,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[4],
  },
  icon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.68)",
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[2],
  },
  title: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  detail: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  action: {
    minWidth: 180,
    marginLeft: spacing[4],
  },
  innerCompact: {
    flexWrap: "wrap",
  },
  actionCompact: {
    width: "100%",
    minWidth: 0,
    marginLeft: 0,
    marginTop: spacing[4],
  },
});
