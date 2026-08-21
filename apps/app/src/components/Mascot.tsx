import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
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
import { borders, radii } from "../theme/tokens";

export type MascotMood = "ready" | "thinking" | "happy" | "oops";

const readyAsset = require("../../assets/illustrations/clip-explorer-ready.png");

export function Mascot({
  mood = "ready",
  size = 84,
}: {
  mood?: MascotMood;
  size?: number;
}) {
  const { reduceMotion, theme } = useSettings();
  const bob = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      bob.value = 0;
      return;
    }
    bob.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(2, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
  }, [bob, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.value }],
  }));
  const moodIcon =
    mood === "happy"
      ? "star-four-points"
      : mood === "thinking"
        ? "dots-horizontal"
        : mood === "oops"
          ? "alert"
          : null;
  const moodColor =
    mood === "happy"
      ? theme.warning
      : mood === "oops"
        ? theme.error
        : theme.primary;

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.wrap, animated, { width: size, height: size }]}
    >
      <Image
        source={readyAsset}
        contentFit="contain"
        style={styles.image}
        transition={reduceMotion ? 0 : 160}
      />
      {moodIcon ? (
        <View
          style={[
            styles.mood,
            { backgroundColor: theme.surface, borderColor: moodColor },
          ]}
        >
          <MaterialCommunityIcons
            name={moodIcon}
            size={Math.max(12, size * 0.16)}
            color={moodColor}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
    borderRadius: radii.feature,
  },
  mood: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 28,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.pill,
  },
});
