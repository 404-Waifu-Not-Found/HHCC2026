import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  FadeOutUp,
  LinearTransition,
  ZoomIn,
  ZoomOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type BaseAnimationBuilder,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";
import { useSettings } from "../providers/SettingsProvider";
import { motion } from "../theme/tokens";

export type MotionPreset =
  "fade" | "rise" | "drop" | "from-left" | "from-right" | "pop";

type AnimationBuilder =
  | BaseAnimationBuilder
  | typeof BaseAnimationBuilder
  | EntryExitAnimationFunction;

function easing(curve: readonly [number, number, number, number]) {
  "worklet";
  return Easing.bezier(curve[0], curve[1], curve[2], curve[3]);
}

function entrance(preset: MotionPreset): AnimationBuilder {
  switch (preset) {
    case "rise":
      return FadeInUp;
    case "drop":
      return FadeInDown;
    case "from-left":
      return FadeInLeft;
    case "from-right":
      return FadeInRight;
    case "pop":
      return ZoomIn;
    default:
      return FadeIn;
  }
}

function exit(preset: MotionPreset): AnimationBuilder {
  switch (preset) {
    case "rise":
      return FadeOutUp;
    case "drop":
      return FadeOutDown;
    case "pop":
      return ZoomOut;
    default:
      return FadeOut;
  }
}

function configure(
  builder: AnimationBuilder,
  duration: number,
  delay: number,
  curve: readonly [number, number, number, number],
) {
  return (builder as typeof FadeIn)
    .duration(duration)
    .delay(delay)
    .easing(easing(curve));
}

export function MotionView({
  children,
  preset = "rise",
  exitPreset = "fade",
  delay = 0,
  duration = motion.standard,
  exiting = false,
  layout = false,
  style,
  testID,
  ...viewProps
}: PropsWithChildren<
  Omit<ViewProps, "style"> & {
    preset?: MotionPreset | false;
    exitPreset?: MotionPreset;
    delay?: number;
    duration?: number;
    exiting?: boolean;
    layout?: boolean;
    style?: StyleProp<ViewStyle>;
  }
>) {
  const { reduceMotion } = useSettings();
  return (
    <Animated.View
      {...viewProps}
      testID={testID}
      entering={
        reduceMotion || preset === false
          ? undefined
          : configure(entrance(preset), duration, delay, motion.easing.enter)
      }
      exiting={
        reduceMotion || !exiting
          ? undefined
          : configure(exit(exitPreset), motion.fast, 0, motion.easing.exit)
      }
      layout={
        reduceMotion || !layout
          ? undefined
          : LinearTransition.duration(motion.standard).easing(
              easing(motion.easing.standard),
            )
      }
      style={style}
    >
      {children}
    </Animated.View>
  );
}

export function StaggerItem({
  children,
  index,
  preset = "rise",
  layout = false,
  style,
}: PropsWithChildren<{
  index: number;
  preset?: MotionPreset;
  layout?: boolean;
  style?: StyleProp<ViewStyle>;
}>) {
  return (
    <MotionView
      preset={preset}
      delay={Math.min(index, 8) * motion.stagger}
      layout={layout}
      style={style}
    >
      {children}
    </MotionView>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function MotionPressable({
  children,
  disabled,
  onPressIn,
  onPressOut,
  pressScale = motion.scale.press,
  pressDepth = motion.distance.micro,
  style,
  ...props
}: PressableProps & {
  pressScale?: number;
  pressDepth?: number;
}) {
  const { reduceMotion } = useSettings();
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: pressed.value * pressDepth },
      { scale: 1 - pressed.value * (1 - pressScale) },
    ],
  }));

  const handlePressIn: NonNullable<PressableProps["onPressIn"]> = (event) => {
    pressed.value = reduceMotion
      ? 0
      : withTiming(1, {
          duration: motion.quick,
          easing: easing(motion.easing.standard),
        });
    onPressIn?.(event);
  };

  const handlePressOut: NonNullable<PressableProps["onPressOut"]> = (event) => {
    pressed.value = reduceMotion ? 0 : withSpring(0, motion.spring.responsive);
    onPressOut?.(event);
  };

  // Reanimated's web wrapper currently drops Pressable callback styles. Those
  // callbacks carry each control's hover, focus, pressed, and theme treatment,
  // so use the native Pressable on web and reproduce the transform feedback in
  // its resolved style. Native platforms retain the worklet-driven animation.
  if (Platform.OS === "web") {
    return (
      <Pressable
        {...props}
        disabled={disabled}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={(state: PressableStateCallbackType) => [
          typeof style === "function" ? style(state) : style,
          !disabled &&
            !reduceMotion && {
              transform: [
                { translateY: state.pressed ? pressDepth : 0 },
                { scale: state.pressed ? pressScale : 1 },
              ],
            },
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={(state: PressableStateCallbackType) => [
        typeof style === "function" ? style(state) : style,
        !disabled && animatedStyle,
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

export type FeedbackKind = "success" | "error" | "attention" | "progress";

export function FeedbackMotion({
  children,
  signal,
  kind,
  style,
}: PropsWithChildren<{
  signal: string | number | boolean | null | undefined;
  kind: FeedbackKind;
  style?: StyleProp<ViewStyle>;
}>) {
  const { reduceMotion } = useSettings();
  const x = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (
      reduceMotion ||
      signal === undefined ||
      signal === null ||
      signal === false
    )
      return;
    if (kind === "error") {
      x.value = withSequence(
        withTiming(-6, { duration: motion.instant }),
        withTiming(6, { duration: motion.instant }),
        withTiming(-3, { duration: motion.instant }),
        withTiming(0, { duration: motion.instant }),
      );
      return;
    }
    if (kind === "success") {
      scale.value = withSequence(
        withSpring(motion.scale.emphasis, motion.spring.celebration),
        withSpring(1, motion.spring.gentle),
      );
      return;
    }
    if (kind === "attention") {
      scale.value = withSequence(
        withTiming(0.985, { duration: motion.quick }),
        withSpring(1, motion.spring.responsive),
      );
      return;
    }
    opacity.value = withSequence(
      withTiming(0.72, { duration: motion.fast }),
      withTiming(1, { duration: motion.fast }),
    );
  }, [kind, opacity, reduceMotion, scale, signal, x]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
  );
}

export function MotionProgressFill({
  progress,
  color,
  children,
  duration = motion.route,
  style,
}: PropsWithChildren<{
  progress: number;
  color: string;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}>) {
  const { reduceMotion } = useSettings();
  const value = useSharedValue(Math.max(0, Math.min(1, progress)));

  useEffect(() => {
    const next = Math.max(0, Math.min(1, progress));
    value.value = reduceMotion
      ? next
      : withTiming(next, {
          duration,
          easing: easing(motion.easing.emphasized),
        });
  }, [duration, progress, reduceMotion, value]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: value.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.progressFill,
        { backgroundColor: color },
        style,
        animatedStyle,
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function MotionSkeleton({
  color,
  delay = 0,
  style,
}: {
  color: string;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduceMotion } = useSettings();
  const opacity = useSharedValue(0.48);

  useEffect(() => {
    cancelAnimation(opacity);
    opacity.value = reduceMotion
      ? 0.62
      : withDelay(
          delay,
          withRepeat(
            withSequence(
              withTiming(0.86, { duration: 700 }),
              withTiming(0.42, { duration: 700 }),
            ),
            -1,
            true,
          ),
        );
    return () => cancelAnimation(opacity);
  }, [delay, opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.skeleton,
        { backgroundColor: color },
        style,
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  progressFill: {
    width: "100%",
    height: "100%",
    transformOrigin: "left center",
  },
  skeleton: {
    overflow: "hidden",
  },
});
