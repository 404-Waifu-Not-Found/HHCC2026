import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { spacing, typography } from "../theme/tokens";
import { LearningPrism } from "./LearningPrism";
import { MotionView } from "../motion/Motion";

export type BrandLockupSize = "compact" | "standard" | "hero";

const metrics = {
  compact: { mark: 42, font: 24, line: 28, gap: spacing[2] },
  standard: { mark: 76, font: 42, line: 48, gap: spacing[3] },
  hero: { mark: 148, font: 68, line: 76, gap: spacing[5] },
} as const;

export function BrandLockup({
  size = "standard",
  descriptor,
  centered = false,
  style,
  testID,
}: {
  size?: BrandLockupSize;
  descriptor?: string;
  centered?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useSettings();
  const metric = metrics[size];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={descriptor ? `ClipQuest ${descriptor}` : "ClipQuest"}
      testID={testID}
      style={[
        styles.lockup,
        centered && styles.centered,
        { gap: metric.gap },
        style,
      ]}
    >
      <LearningPrism size={metric.mark} />
      <MotionView
        preset="from-right"
        delay={80}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.copy, centered && styles.copyCentered]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.wordmark,
            {
              color: theme.text,
              fontSize: metric.font,
              lineHeight: metric.line,
            },
          ]}
        >
          Clip
          <Text style={{ color: theme.primary }}>Quest</Text>
        </Text>
        {descriptor ? (
          <Text
            numberOfLines={1}
            style={[
              styles.descriptor,
              size === "compact" && styles.descriptorCompact,
              { color: theme.primary },
            ]}
          >
            {descriptor}
          </Text>
        ) : null}
      </MotionView>
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  centered: {
    alignSelf: "center",
    justifyContent: "center",
  },
  copy: {
    minWidth: 0,
    justifyContent: "center",
  },
  copyCentered: {
    alignItems: "flex-start",
  },
  wordmark: {
    fontFamily: typography.display,
    letterSpacing: typography.tracking.tight,
  },
  descriptor: {
    marginTop: -2,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: 16,
    letterSpacing: typography.tracking.wide,
    textTransform: "uppercase",
  },
  descriptorCompact: {
    fontSize: 10,
    lineHeight: 12,
  },
});
