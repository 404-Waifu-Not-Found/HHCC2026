import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSettings } from "../providers/SettingsProvider";
import { palette } from "../theme/tokens";

export type MascotMood = "ready" | "thinking" | "happy" | "oops";

export function Mascot({ mood = "ready", size = 84 }: { mood?: MascotMood; size?: number }) {
  const { reduceMotion } = useSettings();
  const bob = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      bob.value = 0;
      return;
    }
    bob.value = withRepeat(
      withSequence(
        withTiming(-5, { duration: 850, easing: Easing.inOut(Easing.quad) }),
        withTiming(2, { duration: 850, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
  }, [bob, reduceMotion]);

  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
  const eyeHeight = mood === "happy" ? 4 : 9;
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.wrap, animated, { width: size, height: size }]}
    >
      <View style={[styles.body, { width: size * 0.9, height: size * 0.78, borderRadius: size * 0.36 }]}>
        <View style={styles.face}>
          <View style={[styles.eye, { height: eyeHeight }]} />
          <View style={[styles.eye, { height: eyeHeight }]} />
        </View>
        <View
          style={[
            styles.mouth,
            mood === "happy" && styles.mouthHappy,
            mood === "oops" && styles.mouthOops,
            mood === "thinking" && styles.mouthThinking,
          ]}
        />
      </View>
      <View style={[styles.foot, { left: size * 0.16 }]} />
      <View style={[styles.foot, { right: size * 0.16 }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  body: {
    backgroundColor: palette.lime,
    borderColor: palette.navy,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-3deg" }],
  },
  face: { flexDirection: "row", gap: 15, marginTop: 5 },
  eye: { width: 8, borderRadius: 6, backgroundColor: palette.navy },
  mouth: {
    width: 19,
    height: 4,
    marginTop: 12,
    borderRadius: 5,
    backgroundColor: palette.navy,
  },
  mouthHappy: {
    height: 10,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  mouthOops: { width: 11, height: 11, borderRadius: 8, backgroundColor: "transparent", borderWidth: 3, borderColor: palette.navy },
  mouthThinking: { width: 10, transform: [{ translateX: 7 }] },
  foot: {
    position: "absolute",
    bottom: 0,
    width: 19,
    height: 8,
    borderRadius: 9,
    backgroundColor: palette.navy,
  },
});

