import { Image } from "expo-image";
import { StyleSheet } from "react-native";
import { MotionView } from "../motion/Motion";
import { motion } from "../theme/tokens";

const learningPrismAsset = require("../../assets/brand/learning-prism.png");

export type LearningPrismVariant = "plain" | "tile" | "hero";

export function LearningPrism({
  size = 96,
  variant = "plain",
}: {
  size?: number;
  variant?: LearningPrismVariant;
}) {
  return (
    <MotionView
      preset="pop"
      duration={motion.emphasized}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.wrap,
        variant !== "plain" && styles.tile,
        variant === "hero" && styles.hero,
        { width: size, height: size },
      ]}
    >
      <Image
        source={learningPrismAsset}
        contentFit="contain"
        style={styles.image}
      />
    </MotionView>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  tile: { borderRadius: 20, backgroundColor: "transparent" },
  hero: { borderRadius: 24 },
  image: { width: "100%", height: "100%" },
});
