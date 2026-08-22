import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

/**
 * Decorative, purely visual backdrops shared by the learner screens.
 *
 * Every component here is `pointerEvents="none"` and hidden from assistive
 * technology: they add atmosphere (soft light, the prism motif, a scrim that
 * keeps thumbnail text legible) without adding meaning. Gradient ids are
 * generated per instance because web SVG ids are document-global.
 */

let backdropCounter = 0;

function useBackdropId(prefix: string): string {
  const [id] = useState(() => {
    backdropCounter += 1;
    return `cq-${prefix}-${backdropCounter}`;
  });
  return id;
}

const decorative = {
  pointerEvents: "none" as const,
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants" as const,
};

/**
 * A vertical wash of one colour that fades to transparent. Used full-bleed
 * behind the Home banner so the greeting sits in soft light instead of on
 * a flat canvas.
 */
export function GradientWash({
  color,
  opacity = 1,
  direction = "down",
  style,
}: {
  color: string;
  opacity?: number;
  direction?: "down" | "up";
  style?: StyleProp<ViewStyle>;
}) {
  const id = useBackdropId("wash");
  const startOpacity = direction === "down" ? opacity : 0;
  const endOpacity = direction === "down" ? 0 : opacity;
  return (
    <View {...decorative} style={[StyleSheet.absoluteFill, style]}>
      <Svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={startOpacity} />
            <Stop offset="1" stopColor={color} stopOpacity={endOpacity} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/**
 * The learning prism reduced to its silhouette: two offset, interlocking
 * rounded frames. Drawn faintly in the banner corner as a brand echo.
 */
export function PrismFrames({
  color,
  size = 180,
  style,
}: {
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const id = useBackdropId("prism");
  const stroke = Math.max(2, Math.round(size / 36));
  return (
    <View {...decorative} style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 180 180">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.34" />
            <Stop offset="1" stopColor={color} stopOpacity="0.04" />
          </LinearGradient>
        </Defs>
        <Rect
          x="18"
          y="30"
          width="112"
          height="84"
          rx="18"
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
        />
        <Rect
          x="58"
          y="70"
          width="104"
          height="76"
          rx="18"
          fill={color}
          fillOpacity="0.06"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
        />
        <Rect
          x="84"
          y="96"
          width="28"
          height="22"
          rx="6"
          fill={color}
          fillOpacity="0.16"
        />
      </Svg>
    </View>
  );
}

/**
 * A dark scrim that rises from the bottom edge of a thumbnail so the source
 * chip and any overlay copy stay legible on bright artwork.
 */
export function ThumbnailScrim({
  color = "#0B1430",
  opacity = 0.6,
  height = "52%",
}: {
  color?: string;
  opacity?: number;
  height?: `${number}%` | number;
}) {
  const id = useBackdropId("scrim");
  return (
    <View
      {...decorative}
      style={[styles.scrim, typeof height === "number" ? { height } : null]}
    >
      <Svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0" />
            <Stop
              offset="0.55"
              stopColor={color}
              stopOpacity={opacity * 0.55}
            />
            <Stop offset="1" stopColor={color} stopOpacity={opacity} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/**
 * Concentric rings of soft light behind a celebratory mark. The radial fill
 * gives the prism a glow; the two hairline rings read as a quiet "level up"
 * without confetti.
 */
export function CelebrationHalo({
  color,
  size = 260,
  style,
}: {
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const id = useBackdropId("halo");
  return (
    <View
      {...decorative}
      style={[styles.halo, { width: size, height: size }, style]}
    >
      <Svg width={size} height={size} viewBox="0 0 260 260">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity="0.34" />
            <Stop offset="0.6" stopColor={color} stopOpacity="0.12" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx="130" cy="130" r="130" fill={`url(#${id})`} />
        <Circle
          cx="130"
          cy="130"
          r="96"
          fill="none"
          stroke={color}
          strokeOpacity="0.22"
          strokeWidth="2"
        />
        <Circle
          cx="130"
          cy="130"
          r="122"
          fill="none"
          stroke={color}
          strokeOpacity="0.1"
          strokeWidth="2"
          strokeDasharray="6 10"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "52%",
  },
  halo: {
    position: "absolute",
    alignSelf: "center",
  },
});
