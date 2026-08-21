import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

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
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.wrap,
        variant !== "plain" && styles.tile,
        variant === "hero" && styles.hero,
        { width: size, height: size },
      ]}
    >
      <Image source={learningPrismAsset} contentFit="contain" style={styles.image} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  tile: { borderRadius: 20, backgroundColor: "#F4F4F4" },
  hero: { borderRadius: 24 },
  image: { width: "100%", height: "100%" },
});
