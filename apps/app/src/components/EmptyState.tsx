import { VoxelIcon } from "./VoxelIcon";
import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, radii, spacing, typography } from "../theme/tokens";
import { MotionView } from "../motion/Motion";

export function EmptyState({
  icon = "video",
  title,
  description,
  action,
}: {
  icon?: ComponentProps<typeof VoxelIcon>["name"];
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const { theme } = useSettings();
  return (
    <View style={styles.wrap}>
      <MotionView
        preset="pop"
        style={[
          styles.icon,
          { backgroundColor: theme.primarySoft, borderColor: theme.primary },
        ]}
      >
        <VoxelIcon name={icon} size={34} color={theme.primary} />
      </MotionView>
      <MotionView preset="rise" delay={44}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: theme.text }]}
        >
          {title}
        </Text>
      </MotionView>
      <MotionView preset="rise" delay={88}>
        <Text style={[styles.description, { color: theme.textMuted }]}>
          {description}
        </Text>
      </MotionView>
      {action ? (
        <MotionView preset="rise" delay={132} style={styles.action}>
          {action}
        </MotionView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    alignItems: "center",
    paddingVertical: spacing[10],
    gap: spacing[3],
  },
  icon: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.feature,
    marginBottom: spacing[2],
  },
  title: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
    textAlign: "center",
  },
  description: {
    maxWidth: 420,
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  action: {
    width: "100%",
    maxWidth: 280,
    marginTop: spacing[3],
  },
});
