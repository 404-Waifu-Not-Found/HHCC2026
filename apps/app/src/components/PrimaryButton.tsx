import type { ComponentProps, PropsWithChildren } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSettings } from "../providers/SettingsProvider";
import { radii, typography } from "../theme/tokens";

type Props = PropsWithChildren<{
  onPress(): void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  accessibilityLabel?: string;
}> &
  Pick<ComponentProps<typeof Pressable>, "testID">;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PrimaryButton({
  children,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  accessibilityLabel,
  testID,
}: Props) {
  const { theme, reduceMotion } = useSettings();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const backgroundColor =
    variant === "primary" ? theme.primary : variant === "secondary" ? theme.secondary : "transparent";
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      onPressIn={() => {
        if (!reduceMotion) scale.value = withSpring(0.97, { damping: 18, stiffness: 280 });
      }}
      onPressOut={() => {
        if (!reduceMotion) scale.value = withSpring(1, { damping: 18, stiffness: 280 });
      }}
      style={[
        styles.button,
        { backgroundColor, borderColor: variant === "ghost" ? theme.border : backgroundColor },
        (disabled || loading) && styles.disabled,
        animated,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.text} />
      ) : (
        <Text style={[styles.label, { color: theme.text }]}>{children}</Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radii.medium,
    borderWidth: 2,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontFamily: typography.bodyBold, fontSize: 16 },
  disabled: { opacity: 0.5 },
});

