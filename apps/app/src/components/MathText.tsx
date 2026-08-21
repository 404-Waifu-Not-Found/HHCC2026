import type { ComponentProps } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
} from "react-native";
import {
  formatMathText,
  isMathExpressionText,
  isStandaloneMathExpressionText,
} from "../lib/math-text";

export function MathText({
  children,
  style,
  ...props
}: Omit<ComponentProps<typeof Text>, "children"> & {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  const mathematical = isMathExpressionText(children);
  const standaloneExpression = isStandaloneMathExpressionText(children);
  return (
    <Text
      {...props}
      accessibilityLabel={props.accessibilityLabel ?? children}
      style={[style, standaloneExpression && styles.math]}
    >
      {mathematical ? formatMathText(children) : children}
    </Text>
  );
}

const styles = StyleSheet.create({
  math: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      web: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      default: "monospace",
    }),
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.15,
  },
});
