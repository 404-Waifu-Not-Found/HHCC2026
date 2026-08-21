// A single grounding citation surfaced inline in an assistant message: a
// small pill showing the source video title and timestamp range. Tapping it
// reveals the grounding quote beneath, since citations do not carry enough
// context to deep-link into a video from a chat message.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { WorkplaceCitation } from "@clipquest/contracts";
import { useSettings } from "../../providers/SettingsProvider";
import { borders, radii, spacing, typography } from "../../theme/tokens";
import { MotionPressable, MotionView } from "../../motion/Motion";
import { VoxelIcon } from "../VoxelIcon";

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function CitationChip({ citation }: { citation: WorkplaceCitation }) {
  const { theme } = useSettings();
  const [expanded, setExpanded] = useState(false);
  const label = `${citation.title} · ${formatTimestamp(citation.startMs)}–${formatTimestamp(citation.endMs)}`;

  return (
    <View style={styles.wrap}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={citation.quote}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed, hovered }) => [
          styles.chip,
          {
            backgroundColor: hovered ? theme.surfaceTint : theme.surface,
            borderColor: expanded ? theme.primary : theme.border,
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        <VoxelIcon name="quote" size={14} color={theme.primary} />
        <Text
          numberOfLines={1}
          style={[styles.label, { color: theme.textMuted }]}
        >
          {label}
        </Text>
      </MotionPressable>
      {expanded ? (
        <MotionView preset="fade" style={styles.quoteWrap}>
          <Text
            style={[styles.quote, { color: theme.text }]}
            accessibilityRole="text"
          >
            {`"${citation.quote}"`}
          </Text>
        </MotionView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    maxWidth: 320,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing[1],
    borderWidth: borders.hairline,
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  label: {
    flexShrink: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.caption,
  },
  quoteWrap: {
    marginTop: spacing[1],
    paddingHorizontal: spacing[2],
  },
  quote: {
    fontFamily: typography.body,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
    fontStyle: "italic",
  },
});
