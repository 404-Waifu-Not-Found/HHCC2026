// Animated trail of tool calls an assistant message made while answering:
// each step shows the tool's learner-facing label, a status indicator
// (requested/running/complete/error), and any grounding citations or error
// summary produced once it settles. Reduced-motion-safe via `StaggerItem`/
// `MotionView`, which fall back to plain views when motion is disabled.
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { WorkplaceToolName } from "@clipquest/contracts";
import { useSettings } from "../../providers/SettingsProvider";
import { borders, radii, spacing, typography } from "../../theme/tokens";
import { StaggerItem } from "../../motion/Motion";
import { VoxelIcon } from "../VoxelIcon";
import type { WorkplaceLiveToolEntry } from "../../workplace/thread-state";
import { CitationChip } from "./CitationChip";
import type { MessageKey } from "../../i18n/messages";

const TOOL_LABEL_KEYS: Record<WorkplaceToolName, MessageKey> = {
  search_videos: "workplaceToolSearchVideos",
  search_transcript: "workplaceToolSearchTranscript",
  generate_practice_set: "workplaceToolGeneratePracticeSet",
  lookup_mastery: "workplaceToolLookupMastery",
  find_due_reviews: "workplaceToolFindDueReviews",
};

function ToolStatusIcon({
  status,
  color,
}: {
  status: WorkplaceLiveToolEntry["status"];
  color: string;
}) {
  if (status === "running" || status === "requested") {
    return <ActivityIndicator size="small" color={color} />;
  }
  return (
    <VoxelIcon
      name={status === "error" ? "error" : "correct"}
      size={16}
      color={color}
    />
  );
}

export function ToolCallTrail({
  entries,
}: {
  entries: WorkplaceLiveToolEntry[];
}) {
  const { t, theme } = useSettings();
  if (!entries.length) return null;

  return (
    <View
      accessibilityRole="list"
      accessibilityLabel={t("workplaceSourcesTitle")}
      style={styles.trail}
    >
      {entries.map((entry, index) => {
        const color =
          entry.status === "error"
            ? theme.error
            : entry.status === "complete"
              ? theme.primary
              : theme.textMuted;
        return (
          <StaggerItem key={entry.id} index={index} style={styles.stepWrap}>
            <View style={styles.step}>
              <View
                style={[
                  styles.marker,
                  { borderColor: color, backgroundColor: theme.surface },
                ]}
              >
                <ToolStatusIcon status={entry.status} color={color} />
              </View>
              {index < entries.length - 1 ? (
                <View
                  style={[styles.connector, { backgroundColor: theme.border }]}
                />
              ) : null}
            </View>
            <View style={styles.stepBody}>
              <Text style={[styles.stepLabel, { color: theme.text }]}>
                {t(TOOL_LABEL_KEYS[entry.name])}
              </Text>
              {entry.status === "error" && entry.summary ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.stepSummary, { color: theme.error }]}
                >
                  {entry.summary}
                </Text>
              ) : entry.status === "complete" && entry.summary ? (
                <Text style={[styles.stepSummary, { color: theme.textMuted }]}>
                  {entry.summary}
                </Text>
              ) : null}
              {entry.citations.length ? (
                <View style={styles.citations}>
                  {entry.citations.map((citation, citationIndex) => (
                    <CitationChip
                      key={`${citation.videoId}-${citationIndex}`}
                      citation={citation}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          </StaggerItem>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  trail: {
    gap: spacing[1],
    marginVertical: spacing[2],
  },
  stepWrap: {
    flexDirection: "row",
  },
  step: {
    alignItems: "center",
    width: 32,
  },
  marker: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.pill,
  },
  connector: {
    width: borders.hairline,
    flex: 1,
    minHeight: spacing[3],
  },
  stepBody: {
    flex: 1,
    gap: spacing[1],
    paddingBottom: spacing[3],
    paddingLeft: spacing[2],
  },
  stepLabel: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  stepSummary: {
    fontFamily: typography.body,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  citations: {
    gap: spacing[1],
    marginTop: spacing[1],
  },
});
