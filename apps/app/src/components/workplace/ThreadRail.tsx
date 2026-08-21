// Thread rail: the list of a learner's recent Workplace threads. Each row
// shows the thread title (or an inline rename field), an unread badge, a
// last-message preview, and a relative timestamp. The rail itself is always
// rendered by the parent screen -- it decides whether to show it side-by-side
// with the detail pane (desktop/tablet) or as the only visible pane
// (mobile), per the responsive layout contract in `workplace.tsx`.
//
// A brief, always-visible privacy notice sits above the thread list: it
// clarifies that synced chat history (this rail + its messages) lives on
// ClipQuest's servers and travels across the learner's devices, while local
// video captions/notes never sync, and the learner's own DeepSeek key is
// never stored by ClipQuest.
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { WorkplaceThreadSummary } from "@clipquest/contracts";
import { useSettings } from "../../providers/SettingsProvider";
import { borders, radii, spacing, typography } from "../../theme/tokens";
import {
  MotionPressable,
  MotionSkeleton,
  StaggerItem,
} from "../../motion/Motion";
import { AppTextInput } from "../AppTextInput";
import { EmptyState } from "../EmptyState";
import { IconButton } from "../IconButton";
import { Surface } from "../Surface";
import { VoxelIcon } from "../VoxelIcon";
import { formatWorkplaceTimestamp } from "../../workplace/thread-state";

export function ThreadRail({
  threads,
  selectedThreadId,
  previewByThreadId,
  unreadByThreadId,
  loading,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  threads: WorkplaceThreadSummary[];
  selectedThreadId?: string;
  previewByThreadId: Readonly<Record<string, string>>;
  unreadByThreadId: Readonly<Record<string, number>>;
  loading: boolean;
  onSelect(threadId: string): void;
  onCreate(): void;
  onRename(threadId: string, title: string): void;
  onDelete(threadId: string): void;
}) {
  const { t, theme, locale } = useSettings();
  const [renamingId, setRenamingId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");

  const startRename = useCallback((thread: WorkplaceThreadSummary) => {
    setRenamingId(thread.id);
    setRenameValue(thread.title);
  }, []);

  const commitRename = useCallback(
    (threadId: string) => {
      const title = renameValue.trim();
      setRenamingId(undefined);
      if (title) onRename(threadId, title);
    },
    [onRename, renameValue],
  );

  const confirmDelete = useCallback(
    (thread: WorkplaceThreadSummary) => {
      Alert.alert(t("workplaceDeleteThread"), t("workplaceDeleteThreadBody"), [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("workplaceConfirmDelete"),
          style: "destructive",
          onPress: () => onDelete(thread.id),
        },
      ]);
    },
    [onDelete, t],
  );

  return (
    <View style={styles.rail}>
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: theme.text }]}
        >
          {t("workplaceThreads")}
        </Text>
        <IconButton
          icon="add"
          label={t("workplaceNewThread")}
          tone="primary"
          onPress={onCreate}
        />
      </View>

      <Surface tone="tinted" style={styles.privacySurface}>
        <View style={styles.privacyRow}>
          <View
            style={[styles.privacyIcon, { backgroundColor: theme.surface }]}
          >
            <VoxelIcon name="privacy" size={18} color={theme.primary} />
          </View>
          <Text
            accessibilityRole="text"
            style={[styles.privacyText, { color: theme.textMuted }]}
          >
            {t("workplacePrivacyNotice")}
          </Text>
        </View>
      </Surface>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={theme.secondary} />
          <MotionSkeleton color={theme.primarySoft} style={styles.skeleton} />
          <MotionSkeleton
            color={theme.primarySoft}
            delay={100}
            style={styles.skeleton}
          />
        </View>
      ) : threads.length ? (
        <FlatList
          accessibilityRole="list"
          accessibilityLabel={t("workplaceThreadListLabel")}
          data={threads}
          keyExtractor={(thread) => thread.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: thread, index }) => {
            const selected = thread.id === selectedThreadId;
            const unread = unreadByThreadId[thread.id] ?? 0;
            const preview = previewByThreadId[thread.id] ?? "";
            const renaming = renamingId === thread.id;
            return (
              <StaggerItem index={index} style={styles.rowWrap}>
                {renaming ? (
                  <View style={styles.renameRow}>
                    <AppTextInput
                      label={t("workplaceRenameThread")}
                      labelPlacement="inside"
                      accessibilityLabel={t("workplaceRenameThread")}
                      placeholder={t("workplaceRenamePlaceholder")}
                      value={renameValue}
                      autoFocus
                      maxLength={200}
                      onChangeText={setRenameValue}
                      onSubmitEditing={() => commitRename(thread.id)}
                    />
                    <IconButton
                      icon="correct"
                      label={t("workplaceRenameThread")}
                      onPress={() => commitRename(thread.id)}
                    />
                  </View>
                ) : (
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityLabel={thread.title}
                    accessibilityState={{ selected }}
                    onPress={() => onSelect(thread.id)}
                    style={({ pressed, hovered }) => [
                      styles.row,
                      {
                        backgroundColor: selected
                          ? theme.primarySoft
                          : hovered
                            ? theme.surfaceTint
                            : "transparent",
                        borderColor: selected ? theme.primary : "transparent",
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <View style={styles.rowMain}>
                      <View style={styles.rowTitleLine}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.rowTitle,
                            { color: theme.text },
                            unread > 0 && styles.rowTitleUnread,
                          ]}
                        >
                          {thread.title}
                        </Text>
                        <Text
                          style={[styles.timestamp, { color: theme.textMuted }]}
                        >
                          {thread.lastMessageAt
                            ? formatWorkplaceTimestamp(
                                thread.lastMessageAt,
                                locale,
                              )
                            : ""}
                        </Text>
                      </View>
                      {preview ? (
                        <Text
                          numberOfLines={1}
                          style={[styles.preview, { color: theme.textMuted }]}
                        >
                          {preview}
                        </Text>
                      ) : null}
                    </View>
                    {unread > 0 ? (
                      <View
                        accessibilityLabel={`${unread} ${t("workplaceUnreadLabel")}`}
                        style={[
                          styles.badge,
                          { backgroundColor: theme.primary },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            { color: theme.textOnPrimary },
                          ]}
                        >
                          {unread > 9 ? "9+" : unread}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.rowActions}>
                      <IconButton
                        icon="rename"
                        label={t("workplaceRenameThread")}
                        size={18}
                        onPress={() => startRename(thread)}
                      />
                      <IconButton
                        icon="delete"
                        label={t("workplaceDeleteThread")}
                        tone="danger"
                        size={18}
                        onPress={() => confirmDelete(thread)}
                      />
                    </View>
                  </MotionPressable>
                )}
              </StaggerItem>
            );
          }}
        />
      ) : (
        <View style={styles.empty}>
          <EmptyState
            icon="workplace"
            title={t("workplaceEmptyThreadListTitle")}
            description={t("workplaceEmptyThreadListBody")}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    flex: 1,
    gap: spacing[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.bodyLarge,
  },
  privacySurface: { padding: spacing[3] },
  privacyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  privacyIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  privacyText: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  loader: {
    gap: spacing[3],
    alignItems: "center",
    paddingVertical: spacing[6],
  },
  skeleton: {
    width: "100%",
    height: 56,
    borderRadius: radii.medium,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: spacing[1],
    paddingBottom: spacing[4],
  },
  rowWrap: {
    width: "100%",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderWidth: borders.standard,
    borderRadius: radii.medium,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  rowMain: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  rowTitle: {
    flexShrink: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
  },
  rowTitleUnread: {
    fontFamily: typography.bodyBold,
  },
  timestamp: {
    fontFamily: typography.body,
    fontSize: typography.size.caption,
  },
  preview: {
    fontFamily: typography.body,
    fontSize: typography.size.caption,
  },
  badge: {
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing[1],
  },
  badgeText: {
    fontFamily: typography.bodyBold,
    fontSize: 11,
  },
  rowActions: {
    flexDirection: "row",
  },
  renameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  empty: {
    flex: 1,
    justifyContent: "center",
  },
});
