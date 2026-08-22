// Renders the safe Markdown subset produced by `parseMarkdownBlocks` with React
// Native primitives. Text is treated as untrusted: no HTML is interpreted and
// links render as styled, non-interactive text rather than navigable anchors.
// Plain text runs flow through `MathText` so inline math still renders.
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import { useSettings } from "../../providers/SettingsProvider";
import { radii, spacing, typography } from "../../theme/tokens";
import { MathText } from "../MathText";
import {
  parseMarkdownBlocks,
  type MarkdownBlock,
  type MarkdownInlineNode,
} from "../../lib/markdown";

function InlineNodes({
  nodes,
  color,
}: {
  nodes: MarkdownInlineNode[];
  color: string;
}) {
  const { theme } = useSettings();
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return (
              <MathText key={index} style={{ color }}>
                {node.value}
              </MathText>
            );
          case "strong":
            return (
              <Text key={index} style={styles.strong}>
                <InlineNodes nodes={node.children} color={color} />
              </Text>
            );
          case "emphasis":
            return (
              <Text key={index} style={styles.emphasis}>
                <InlineNodes nodes={node.children} color={color} />
              </Text>
            );
          case "code":
            return (
              <Text
                key={index}
                style={[
                  styles.inlineCode,
                  { color: theme.text, backgroundColor: theme.surfaceSunken },
                ]}
              >
                {node.value}
              </Text>
            );
          case "link":
            return (
              <Text
                key={index}
                accessibilityHint={node.href}
                style={[styles.link, { color: theme.secondary }]}
              >
                <InlineNodes nodes={node.label} color={theme.secondary} />
              </Text>
            );
          case "break":
            return <Text key={index}>{"\n"}</Text>;
          default:
            return null;
        }
      })}
    </>
  );
}

function BlockView({ block }: { block: MarkdownBlock }) {
  const { theme } = useSettings();
  if (block.type === "heading") {
    const headingStyle: TextStyle =
      block.level <= 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
    return (
      <Text
        accessibilityRole="header"
        style={[headingStyle, { color: theme.text }]}
      >
        <InlineNodes nodes={block.children} color={theme.text} />
      </Text>
    );
  }
  if (block.type === "code") {
    return (
      <View
        style={[
          styles.codeBlock,
          { backgroundColor: theme.surfaceSunken, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.codeText, { color: theme.text }]}>
          {block.value}
        </Text>
      </View>
    );
  }
  if (block.type === "list") {
    return (
      <View style={styles.list}>
        {block.items.map((item, index) => (
          <View key={index} style={styles.listItem}>
            <Text style={[styles.listMarker, { color: theme.primary }]}>
              {block.ordered ? `${block.start + index}.` : "\u2022"}
            </Text>
            <Text style={[styles.listContent, { color: theme.text }]}>
              <InlineNodes nodes={item} color={theme.text} />
            </Text>
          </View>
        ))}
      </View>
    );
  }
  return (
    <Text style={[styles.paragraph, { color: theme.text }]}>
      <InlineNodes nodes={block.children} color={theme.text} />
    </Text>
  );
}

/** Render an untrusted Markdown string as a formatted document. */
export function Markdown({ children }: { children: string }) {
  const blocks = parseMarkdownBlocks(children);
  if (blocks.length === 0) return null;
  return (
    <View style={styles.document}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </View>
  );
}

const monospace = {
  fontFamily: "monospace" as const,
};

const styles = StyleSheet.create({
  document: {
    gap: spacing[2],
  },
  paragraph: {
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  strong: {
    fontFamily: typography.bodyBold,
  },
  emphasis: {
    fontStyle: "italic",
  },
  inlineCode: {
    ...monospace,
    fontSize: typography.size.label,
    borderRadius: radii.small,
    paddingHorizontal: 4,
  },
  link: {
    textDecorationLine: "underline",
  },
  h1: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
    marginTop: spacing[1],
  },
  h2: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.bodyLarge,
    lineHeight: typography.lineHeight.bodyLarge,
    marginTop: spacing[1],
  },
  h3: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  list: {
    gap: spacing[1],
  },
  listItem: {
    flexDirection: "row",
    gap: spacing[2],
  },
  listMarker: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    minWidth: spacing[4],
  },
  listContent: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  codeBlock: {
    borderWidth: 1,
    borderRadius: radii.medium,
    padding: spacing[3],
  },
  codeText: {
    ...monospace,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
