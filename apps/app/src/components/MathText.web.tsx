import katex from "katex";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import {
  formatMathText,
  isMathExpressionText,
  isStandaloneMathExpressionText,
  mathTextToLatex,
  segmentMathText,
} from "../lib/math-text";

function typesetMath(source: string, key: string): ReactNode {
  try {
    const html = katex.renderToString(mathTextToLatex(source), {
      displayMode: false,
      output: "mathml",
      strict: "error",
      throwOnError: true,
      trust: false,
    });
    return createElement("span", {
      key,
      "data-clipquest-math": source,
      style: {
        display: "inline-block",
        fontSize: "1.08em",
        lineHeight: 1,
        paddingInline: "0.08em",
        verticalAlign: "-0.08em",
        whiteSpace: "nowrap",
      },
      dangerouslySetInnerHTML: { __html: html },
    });
  } catch {
    return formatMathText(source);
  }
}

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
  const segments = mathematical ? segmentMathText(children) : undefined;

  return (
    <Text
      {...props}
      accessibilityLabel={props.accessibilityLabel ?? children}
      style={style}
    >
      {standaloneExpression
        ? typesetMath(children, "standalone")
        : segments
          ? segments.map((segment, index) =>
              segment.mathematical
                ? typesetMath(segment.text, `${index}-${segment.text}`)
                : segment.text,
            )
          : children}
    </Text>
  );
}
