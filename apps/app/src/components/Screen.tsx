import type { PropsWithChildren, ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSettings } from "../providers/SettingsProvider";
import { breakpoints, layout, safeArea, spacing } from "../theme/tokens";
import { MotionView } from "../motion/Motion";

type ContentWidth = "wide" | "reading" | "lesson" | "auth" | "full";

export function Screen({
  children,
  scroll = true,
  footer,
  contentWidth = "wide",
  centered = false,
  padded = true,
  footerFlush = false,
}: PropsWithChildren<{
  scroll?: boolean;
  footer?: ReactNode;
  contentWidth?: ContentWidth;
  centered?: boolean;
  padded?: boolean;
  footerFlush?: boolean;
}>) {
  const { theme } = useSettings();
  const { width } = useWindowDimensions();
  const horizontal =
    width >= breakpoints.desktop
      ? layout.desktopGutter
      : width >= breakpoints.tablet
        ? layout.gutter
        : layout.compactGutter;
  const maxWidth =
    contentWidth === "reading"
      ? layout.reading
      : contentWidth === "lesson"
        ? layout.lesson
        : contentWidth === "auth"
          ? layout.auth
          : contentWidth === "full"
            ? undefined
            : layout.content;
  const content = (
    <MotionView
      preset="rise"
      testID="motion-route-content"
      style={[
        styles.content,
        centered && styles.centered,
        padded && {
          paddingHorizontal: horizontal,
          paddingTop: spacing[6],
          paddingBottom: spacing[10],
        },
        maxWidth ? { maxWidth } : null,
      ]}
    >
      {children}
    </MotionView>
  );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.background }]}
      edges={["top", "left", "right", "bottom"]}
    >
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={styles.flex}>{content}</View>
      )}
      {footer ? (
        <MotionView
          preset="rise"
          delay={80}
          style={[
            styles.footer,
            footerFlush && styles.footerFlush,
            {
              backgroundColor: theme.surface,
              borderTopColor: theme.divider,
              paddingHorizontal: footerFlush ? 0 : horizontal,
            },
          ]}
        >
          {footer}
        </MotionView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    width: "100%",
    alignSelf: "center",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
  },
  footer: {
    minHeight: 72,
    borderTopWidth: 1,
    paddingTop: spacing[3],
    paddingBottom: safeArea.minimumBottom,
  },
  footerFlush: {
    paddingTop: 0,
    paddingBottom: 0,
  },
});
