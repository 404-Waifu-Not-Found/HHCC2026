// Document-style rendering of one assistant message: an ordered list of
// text/tool-trail/practice-set entries, exactly as produced by
// `applyWorkplaceChatEvent` (live/streaming) or `messageToEntries` (history).
// Text segments render as Markdown-light math text, tool call entries render
// through `ToolCallTrail`, and practice sets render through the existing
// interactive `WorkplacePracticeSet` surface.
import { StyleSheet, View } from "react-native";
import { useSettings } from "../../providers/SettingsProvider";
import { spacing } from "../../theme/tokens";
import { MotionView, StreamingCursor } from "../../motion/Motion";
import { Markdown } from "./Markdown";
import { ThinkingWindow } from "./ThinkingWindow";
import { WorkplacePracticeSet as WorkplacePracticeSetView } from "../WorkplacePracticeSet";
import type {
  WorkplaceLiveEntry,
  WorkplaceLiveToolEntry,
} from "../../workplace/thread-state";
import { ToolCallTrail } from "./ToolCallTrail";

export function AssistantDocument({
  entries,
  threadId,
  streaming = false,
}: {
  entries: WorkplaceLiveEntry[];
  threadId: string;
  streaming?: boolean;
}) {
  const { theme } = useSettings();
  const activeTool = entries.find(
    (entry) =>
      entry.kind === "tool" &&
      (entry.status === "requested" || entry.status === "running"),
  );
  const showThinking =
    streaming &&
    (Boolean(activeTool) ||
      !entries.some((entry) => entry.kind === "text" && entry.text.trim()));

  // Group consecutive tool entries into a single trail so a multi-tool round
  // renders as one connected stepper instead of several disjoint ones.
  const groups: (
    | { kind: "text"; entry: Extract<WorkplaceLiveEntry, { kind: "text" }> }
    | {
        kind: "practice";
        entry: Extract<WorkplaceLiveEntry, { kind: "practice" }>;
      }
    | { kind: "tools"; entries: WorkplaceLiveToolEntry[] }
  )[] = [];
  for (const entry of entries) {
    if (entry.kind === "tool") {
      const last = groups[groups.length - 1];
      if (last?.kind === "tools") last.entries.push(entry);
      else groups.push({ kind: "tools", entries: [entry] });
    } else if (entry.kind === "text") {
      groups.push({ kind: "text", entry });
    } else {
      groups.push({ kind: "practice", entry });
    }
  }

  return (
    <View style={styles.document}>
      {showThinking ? (
        <ThinkingWindow
          activeToolName={
            activeTool?.kind === "tool" ? activeTool.name : undefined
          }
        />
      ) : null}
      {groups.map((group, index) => {
        if (group.kind === "tools") {
          return (
            <ToolCallTrail key={`tools-${index}`} entries={group.entries} />
          );
        }
        if (group.kind === "practice") {
          return (
            <MotionView key={group.entry.id} preset="rise" style={styles.block}>
              <WorkplacePracticeSetView
                practiceSet={group.entry.practiceSet}
                threadId={threadId}
              />
            </MotionView>
          );
        }
        const isLast = index === groups.length - 1;
        return (
          <MotionView key={group.entry.id} preset="fade" style={styles.block}>
            <Markdown>{group.entry.text || " "}</Markdown>
            {streaming && isLast && !group.entry.final ? (
              <StreamingCursor color={theme.primary} />
            ) : null}
          </MotionView>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  document: {
    gap: spacing[2],
  },
  block: {
    gap: spacing[1],
  },
});
