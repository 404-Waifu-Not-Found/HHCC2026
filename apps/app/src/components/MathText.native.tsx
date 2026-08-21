import katex from "katex";
import { useMemo, useState, type ComponentProps } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { WebView } from "react-native-webview";
import {
  formatMathText,
  isMathExpressionText,
  mathTextToLatex,
  segmentMathText,
} from "../lib/math-text";

type Props = Omit<ComponentProps<typeof Text>, "children"> & {
  children: string;
  style?: StyleProp<TextStyle>;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMath(value: string): string {
  try {
    return katex.renderToString(mathTextToLatex(value), {
      displayMode: false,
      output: "mathml",
      strict: "error",
      throwOnError: true,
      trust: false,
    });
  } catch {
    return escapeHtml(formatMathText(value));
  }
}

function documentForText(value: string, style: TextStyle): string {
  const color = typeof style.color === "string" ? style.color : "#203329";
  const fontSize = typeof style.fontSize === "number" ? style.fontSize : 16;
  const lineHeight =
    typeof style.lineHeight === "number"
      ? style.lineHeight
      : Math.ceil(fontSize * 1.45);
  const fontWeight = style.fontWeight === "700" ? "700" : "400";
  const segments = segmentMathText(value);
  const body = segments
    .map((segment) =>
      segment.mathematical
        ? `<span class="math">${renderMath(segment.text)}</span>`
        : escapeHtml(segment.text),
    )
    .join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}body{color:${escapeHtml(color)};font-family:Arial,sans-serif;font-size:${fontSize}px;line-height:${lineHeight}px;font-weight:${fontWeight};overflow-wrap:anywhere}.math{display:inline-block;font-family:serif;font-size:1.08em;line-height:1;vertical-align:-0.08em;white-space:nowrap}math{font-family:serif}</style></head><body>${body}<script>const report=()=>window.ReactNativeWebView.postMessage(String(Math.ceil(document.body.scrollHeight)));new ResizeObserver(report).observe(document.body);report();</script></body></html>`;
}

export function MathText({ children, style, ...props }: Props) {
  const mathematical = isMathExpressionText(children);
  const flattened = useMemo(() => StyleSheet.flatten(style) ?? {}, [style]);
  const [height, setHeight] = useState(
    typeof flattened.lineHeight === "number" ? flattened.lineHeight : 28,
  );
  const html = useMemo(
    () => documentForText(children, flattened),
    [children, flattened],
  );

  if (!mathematical) {
    return (
      <Text
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? children}
        style={style}
      >
        {children}
      </Text>
    );
  }

  return (
    <WebView
      accessibilityLabel={props.accessibilityLabel ?? children}
      accessible
      source={{ html, baseUrl: "about:blank" }}
      originWhitelist={["about:blank"]}
      style={[styles.webView, { height }]}
      containerStyle={{ height }}
      scrollEnabled={false}
      bounces={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      allowFileAccess={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      domStorageEnabled={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) =>
        request.url === "about:blank" || request.url === "about:blank/"
      }
      onMessage={(event) => {
        const measured = Number(event.nativeEvent.data);
        if (Number.isFinite(measured) && measured > 0 && measured < 2_000) {
          setHeight(Math.ceil(measured));
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  webView: {
    width: "100%",
    backgroundColor: "transparent",
  },
});
