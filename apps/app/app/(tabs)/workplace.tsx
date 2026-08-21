// Workplace: the learner's AI learning workspace. A responsive thread rail +
// document-style assistant surface, wired to the platform Workplace chat
// client (`../../src/workplace/chat-client`) for streaming turns and the
// synced REST API (`../../src/workplace/api`) for thread/message persistence.
//
// Layout contract (see `workplaceLayoutForWidth`):
//   - desktop: rail and detail panes side by side, both always visible.
//   - tablet: same side-by-side split, narrower proportions.
//   - mobile: only one pane visible at a time; the detail pane gets a back
//     button that returns to the rail instead of a persistent sidebar.
import type {
  WorkplaceMessage,
  WorkplaceSuggestion,
  WorkplaceThreadSummary,
} from "@clipquest/contracts";
import { useFocusEffect, router } from "expo-router";
import * as Network from "expo-network";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AssistantDocument } from "../../src/components/workplace/AssistantDocument";
import {
  Composer,
  SuggestionPills,
} from "../../src/components/workplace/Composer";
import { ThreadRail } from "../../src/components/workplace/ThreadRail";
import { EmptyState } from "../../src/components/EmptyState";
import { IconButton } from "../../src/components/IconButton";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { useSettings } from "../../src/providers/SettingsProvider";
import {
  borders,
  radii,
  safeArea,
  spacing,
  typography,
} from "../../src/theme/tokens";
import {
  FeedbackMotion,
  MotionSkeleton,
  MotionView,
} from "../../src/motion/Motion";
import {
  createWorkplaceThread,
  deleteWorkplaceThread,
  fetchWorkplaceMessages,
  fetchWorkplaceSuggestions,
  listWorkplaceThreads,
  newWorkplaceClientMessageId,
  renameWorkplaceThread,
  syncWorkplaceMessage,
} from "../../src/workplace/api";
import { workplaceChatClient } from "../../src/workplace/chat-client";
import { WorkplaceChatRequestError } from "../../src/workplace/chat-client.types";
import {
  applyWorkplaceChatEvent,
  cancelWorkplaceLiveMessage,
  createLiveAssistantMessage,
  liveMessageToParts,
  messageToEntries,
  messagesToChatTurns,
  removeThreadSummary,
  sortThreadsByRecency,
  threadPreviewText,
  unreadCountForThread,
  upsertThreadSummary,
  workplaceLayoutForWidth,
  type WorkplaceLiveMessage,
} from "../../src/workplace/thread-state";
import {
  loadWorkplaceReadState,
  markThreadRead,
  saveWorkplaceReadState,
  type WorkplaceReadState,
} from "../../src/workplace/thread-read-state";

type MobilePane = "rail" | "detail";

export default function WorkplaceScreen() {
  const { t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const layoutMode = workplaceLayoutForWidth(width);
  const isMobile = layoutMode === "mobile";
  const networkState = Network.useNetworkState();
  const offline =
    networkState.isConnected === false ||
    networkState.isInternetReachable === false;

  const [mobilePane, setMobilePane] = useState<MobilePane>("rail");
  const [threads, setThreads] = useState<WorkplaceThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string>();
  const [selectedThreadId, setSelectedThreadIdState] = useState<string>();
  const [suggestions, setSuggestions] = useState<WorkplaceSuggestion[]>([]);
  const [readState, setReadState] = useState<WorkplaceReadState>({});
  const [previewByThreadId, setPreviewByThreadId] = useState<
    Record<string, string>
  >({});

  const [messagesByThread, setMessagesByThread] = useState<
    Record<string, WorkplaceMessage[]>
  >({});
  const [cursorByThread, setCursorByThread] = useState<
    Record<string, string | null>
  >({});
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingMoreThreadId, setLoadingMoreThreadId] = useState<string>();
  const [messagesError, setMessagesError] = useState<string>();

  const [composerValue, setComposerValue] = useState("");
  const [pendingVideoIds, setPendingVideoIds] = useState<string[]>([]);
  const [liveMessage, setLiveMessage] = useState<WorkplaceLiveMessage>();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [needsLocalAi, setNeedsLocalAi] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const hasLoadedThreadsRef = useRef(false);
  const loadWorkspace = useCallback(async () => {
    if (!hasLoadedThreadsRef.current) setThreadsLoading(true);
    try {
      const [threadList, suggestionList] = await Promise.all([
        listWorkplaceThreads(),
        fetchWorkplaceSuggestions().catch(() => []),
      ]);
      setThreads(sortThreadsByRecency(threadList));
      setSuggestions(suggestionList);
      setThreadsError(undefined);
      hasLoadedThreadsRef.current = true;
    } catch {
      setThreadsError(t("workplaceLoadFailed"));
    } finally {
      setThreadsLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void loadWorkspace();
    }, [loadWorkspace]),
  );

  useEffect(() => {
    void loadWorkplaceReadState().then(setReadState);
  }, []);

  const loadMessages = useCallback(
    async (threadId: string, cursor?: string | null) => {
      if (cursor) setLoadingMoreThreadId(threadId);
      else setMessagesLoading(true);
      try {
        const response = await fetchWorkplaceMessages(threadId, cursor ?? null);
        // The server returns each page newest-first; reverse it so within a
        // page (and once stitched to an older page) history reads oldest to
        // newest, matching how a chat thread is displayed.
        const chronological = [...response.messages].reverse();
        setMessagesByThread((current) => ({
          ...current,
          [threadId]: cursor
            ? [...chronological, ...(current[threadId] ?? [])]
            : chronological,
        }));
        setCursorByThread((current) => ({
          ...current,
          [threadId]: response.nextCursor,
        }));
        if (!cursor) {
          const previewMessage = chronological[chronological.length - 1];
          if (previewMessage) {
            setPreviewByThreadId((current) => ({
              ...current,
              [threadId]: threadPreviewText(previewMessage),
            }));
          }
        }
        setMessagesError(undefined);
      } catch {
        setMessagesError(t("workplaceLoadFailed"));
      } finally {
        setMessagesLoading(false);
        setLoadingMoreThreadId(undefined);
      }
    },
    [t],
  );

  const selectThread = useCallback(
    (threadId: string) => {
      setSelectedThreadIdState(threadId);
      setMobilePane("detail");
      setSendError(undefined);
      setNeedsLocalAi(false);
      setMessagesByThread((current) => {
        if (!current[threadId]) void loadMessages(threadId);
        return current;
      });
      setThreads((current) => {
        const thread = current.find((item) => item.id === threadId);
        if (thread) {
          setReadState((currentRead) => {
            const next = markThreadRead(
              currentRead,
              threadId,
              thread.messageCount,
            );
            if (next !== currentRead) void saveWorkplaceReadState(next);
            return next;
          });
        }
        return current;
      });
    },
    [loadMessages],
  );

  const createThread = useCallback(async () => {
    setThreadsError(undefined);
    try {
      const thread = await createWorkplaceThread();
      setThreads((current) => upsertThreadSummary(current, thread));
      setMessagesByThread((current) => ({ ...current, [thread.id]: [] }));
      setCursorByThread((current) => ({ ...current, [thread.id]: null }));
      setSelectedThreadIdState(thread.id);
      setMobilePane("detail");
      setSendError(undefined);
      setNeedsLocalAi(false);
    } catch {
      setThreadsError(t("workplaceLoadFailed"));
    }
  }, [t]);

  const renameThread = useCallback(
    async (threadId: string, title: string) => {
      let previous: WorkplaceThreadSummary[] = [];
      setThreads((current) => {
        previous = current;
        return current.map((thread) =>
          thread.id === threadId ? { ...thread, title } : thread,
        );
      });
      try {
        const updated = await renameWorkplaceThread(threadId, title);
        setThreads((current) => upsertThreadSummary(current, updated));
      } catch {
        setThreads(previous);
        setThreadsError(t("workplaceLoadFailed"));
      }
    },
    [t],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      let previous: WorkplaceThreadSummary[] = [];
      setThreads((current) => {
        previous = current;
        return removeThreadSummary(current, threadId);
      });
      setMessagesByThread((current) => {
        const next = { ...current };
        delete next[threadId];
        return next;
      });
      setSelectedThreadIdState((current) => {
        if (current !== threadId) return current;
        setMobilePane("rail");
        return undefined;
      });
      try {
        await deleteWorkplaceThread(threadId);
      } catch {
        setThreads(previous);
        setThreadsError(t("workplaceLoadFailed"));
      }
    },
    [t],
  );

  const onSuggestionPress = useCallback((suggestion: WorkplaceSuggestion) => {
    setComposerValue((current) =>
      current.trim() ? current : suggestion.title,
    );
    setPendingVideoIds((current) =>
      current.includes(suggestion.videoId)
        ? current
        : [...current, suggestion.videoId],
    );
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(
    async (text: string, videoIds: string[]) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setSendError(undefined);
      setNeedsLocalAi(false);

      let activeThreadId = selectedThreadId;
      try {
        if (!activeThreadId) {
          const thread = await createWorkplaceThread();
          setThreads((current) => upsertThreadSummary(current, thread));
          setMessagesByThread((current) => ({ ...current, [thread.id]: [] }));
          setCursorByThread((current) => ({ ...current, [thread.id]: null }));
          activeThreadId = thread.id;
          setSelectedThreadIdState(thread.id);
          setMobilePane("detail");
        }
        const threadId = activeThreadId;
        const history = messagesToChatTurns(messagesByThread[threadId] ?? []);
        const userClientId = newWorkplaceClientMessageId();
        const optimisticUser: WorkplaceMessage = {
          id: userClientId,
          threadId,
          clientMessageId: userClientId,
          role: "user",
          parts: [{ type: "text", text: trimmed }],
          createdAt: Date.now(),
        };
        setMessagesByThread((current) => ({
          ...current,
          [threadId]: [...(current[threadId] ?? []), optimisticUser],
        }));
        setComposerValue("");
        setPendingVideoIds([]);

        const assistantClientId = newWorkplaceClientMessageId();
        let live = createLiveAssistantMessage(threadId, assistantClientId);
        setLiveMessage(live);
        setSending(true);

        const controller = new AbortController();
        abortRef.current = controller;
        try {
          await workplaceChatClient.runTurn(
            { userText: trimmed, thread: history, recentVideoIds: videoIds },
            (event) => {
              live = applyWorkplaceChatEvent(live, event);
              setLiveMessage(live);
            },
            controller.signal,
          );
        } finally {
          abortRef.current = null;
        }

        const finished =
          live.status === "streaming" ? cancelWorkplaceLiveMessage(live) : live;
        const parts = liveMessageToParts(finished);

        // Persist the user turn, then the assistant turn, in the same order
        // the learner experienced them.
        const savedUser = await syncWorkplaceMessage({
          threadId,
          clientMessageId: userClientId,
          role: "user",
          parts: [{ type: "text", text: trimmed }],
        });
        let savedAssistant: WorkplaceMessage | undefined;
        if (parts.length) {
          savedAssistant = await syncWorkplaceMessage({
            threadId,
            clientMessageId: assistantClientId,
            role: "assistant",
            parts,
          });
        }

        setMessagesByThread((current) => {
          const existing = current[threadId] ?? [];
          const withoutOptimistic = existing.filter(
            (message) => message.clientMessageId !== userClientId,
          );
          return {
            ...current,
            [threadId]: [
              ...withoutOptimistic,
              savedUser,
              ...(savedAssistant ? [savedAssistant] : []),
            ],
          };
        });
        const previewSource = savedAssistant ?? savedUser;
        setPreviewByThreadId((current) => ({
          ...current,
          [threadId]: threadPreviewText(previewSource),
        }));
        const addedCount = savedAssistant ? 2 : 1;
        setThreads((current) => {
          const thread = current.find((item) => item.id === threadId);
          if (!thread) return current;
          return upsertThreadSummary(current, {
            ...thread,
            messageCount: thread.messageCount + addedCount,
            lastMessageAt: previewSource.createdAt,
            updatedAt: previewSource.createdAt,
          });
        });
        setReadState((current) => {
          const thread = threads.find((item) => item.id === threadId);
          const nextCount = (thread?.messageCount ?? 0) + addedCount;
          const next = markThreadRead(current, threadId, nextCount);
          if (next !== current) void saveWorkplaceReadState(next);
          return next;
        });
        setLiveMessage(undefined);
      } catch (cause) {
        if (cause instanceof WorkplaceChatRequestError) {
          setSendError(
            cause.code === "sign_in_required"
              ? t("workplaceSignInRequired")
              : t("workplaceCredentialRequired"),
          );
          setNeedsLocalAi(cause.code === "credential_required");
        } else {
          setSendError(t("workplaceSendFailed"));
        }
        setLiveMessage((current) =>
          current ? cancelWorkplaceLiveMessage(current) : current,
        );
      } finally {
        setSending(false);
      }
    },
    [messagesByThread, selectedThreadId, sending, t, threads],
  );

  const selectedThread = useMemo(
    () => threads.find((item) => item.id === selectedThreadId),
    [threads, selectedThreadId],
  );
  const messages = selectedThreadId
    ? (messagesByThread[selectedThreadId] ?? [])
    : [];
  const nextCursor = selectedThreadId
    ? cursorByThread[selectedThreadId]
    : undefined;

  const unreadByThreadId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const thread of threads) {
      map[thread.id] = unreadCountForThread(thread, readState);
    }
    return map;
  }, [threads, readState]);

  const showRail = !isMobile || mobilePane === "rail";
  const showDetail = !isMobile || mobilePane === "detail";

  return (
    <SafeAreaView
      edges={["top", "left", "right", "bottom"]}
      style={[styles.frame, { backgroundColor: theme.background }]}
    >
      {offline ? (
        <View
          style={[
            styles.offlineBanner,
            { backgroundColor: theme.warningSoft, borderColor: theme.warning },
          ]}
          accessibilityRole="alert"
        >
          <Text style={[styles.offlineTitle, { color: theme.text }]}>
            {t("workplaceOfflineTitle")}
          </Text>
          <Text style={[styles.offlineBody, { color: theme.warningText }]}>
            {t("workplaceOfflineBody")}
          </Text>
        </View>
      ) : null}

      <View style={[styles.body, isMobile && styles.bodyMobile]}>
        {showRail ? (
          <View
            style={[
              styles.railPane,
              isMobile && styles.railPaneMobile,
              !isMobile && {
                borderRightWidth: borders.hairline,
                borderRightColor: theme.divider,
              },
            ]}
          >
            {threadsError ? (
              <FeedbackMotion signal={threadsError} kind="error">
                <MotionView preset="rise" exiting>
                  <Text
                    accessibilityRole="alert"
                    style={[styles.error, { color: theme.error }]}
                  >
                    {threadsError}
                  </Text>
                  <PrimaryButton
                    variant="secondary"
                    compact
                    onPress={() => void loadWorkspace()}
                  >
                    {t("retry")}
                  </PrimaryButton>
                </MotionView>
              </FeedbackMotion>
            ) : null}
            <ThreadRail
              threads={threads}
              selectedThreadId={selectedThreadId}
              previewByThreadId={previewByThreadId}
              unreadByThreadId={unreadByThreadId}
              loading={threadsLoading}
              onSelect={selectThread}
              onCreate={() => void createThread()}
              onRename={(threadId, title) => void renameThread(threadId, title)}
              onDelete={(threadId) => void deleteThread(threadId)}
            />
          </View>
        ) : null}

        {showDetail ? (
          <DetailPane
            isMobile={isMobile}
            thread={selectedThread}
            messages={messages}
            messagesLoading={messagesLoading}
            loadingMore={loadingMoreThreadId === selectedThreadId}
            hasMore={Boolean(nextCursor)}
            onLoadMore={() =>
              selectedThreadId &&
              void loadMessages(selectedThreadId, nextCursor)
            }
            messagesError={messagesError}
            liveMessage={liveMessage}
            sending={sending}
            onStop={stopGeneration}
            suggestions={suggestions}
            onSuggestionPress={onSuggestionPress}
            composerValue={composerValue}
            onComposerChange={setComposerValue}
            onSend={() => void sendMessage(composerValue, pendingVideoIds)}
            sendError={sendError}
            needsLocalAi={needsLocalAi}
            offline={offline}
            onBack={() => setMobilePane("rail")}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function DetailPane({
  isMobile,
  thread,
  messages,
  messagesLoading,
  loadingMore,
  hasMore,
  onLoadMore,
  messagesError,
  liveMessage,
  sending,
  onStop,
  suggestions,
  onSuggestionPress,
  composerValue,
  onComposerChange,
  onSend,
  sendError,
  needsLocalAi,
  offline,
  onBack,
}: {
  isMobile: boolean;
  thread?: WorkplaceThreadSummary;
  messages: WorkplaceMessage[];
  messagesLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore(): void;
  messagesError?: string;
  liveMessage?: WorkplaceLiveMessage;
  sending: boolean;
  onStop(): void;
  suggestions: WorkplaceSuggestion[];
  onSuggestionPress(suggestion: WorkplaceSuggestion): void;
  composerValue: string;
  onComposerChange(value: string): void;
  onSend(): void;
  sendError?: string;
  needsLocalAi: boolean;
  offline: boolean;
  onBack(): void;
}) {
  const { t, theme } = useSettings();

  return (
    <KeyboardAvoidingView
      style={styles.detailPane}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <View
        style={[
          styles.detailHeader,
          {
            borderBottomColor: theme.divider,
            borderBottomWidth: borders.hairline,
          },
        ]}
      >
        {isMobile ? (
          <IconButton icon="back" label={t("back")} onPress={onBack} />
        ) : null}
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[styles.detailTitle, { color: theme.text }]}
        >
          {thread?.title ?? t("workplaceUnnamedThread")}
        </Text>
      </View>

      <ScrollView
        style={styles.detailScroll}
        contentContainerStyle={styles.detailContent}
        showsVerticalScrollIndicator={false}
      >
        {messagesError ? (
          <Text
            accessibilityRole="alert"
            style={[styles.error, { color: theme.error }]}
          >
            {messagesError}
          </Text>
        ) : null}

        {hasMore ? (
          <View style={styles.loadMoreRow}>
            {loadingMore ? (
              <ActivityIndicator color={theme.secondary} />
            ) : (
              <PrimaryButton variant="ghost" compact onPress={onLoadMore}>
                {t("retry")}
              </PrimaryButton>
            )}
          </View>
        ) : null}

        {messagesLoading && !messages.length ? (
          <MotionView preset="fade" style={styles.loader}>
            <ActivityIndicator color={theme.secondary} />
            <MotionSkeleton color={theme.primarySoft} style={styles.skeleton} />
            <MotionSkeleton
              color={theme.primarySoft}
              delay={100}
              style={styles.skeletonShort}
            />
          </MotionView>
        ) : messages.length || liveMessage ? (
          <View style={styles.messages}>
            {messages.map((message) =>
              message.role === "user" ? (
                <UserBubble key={message.id} message={message} />
              ) : (
                <View key={message.id} style={styles.assistantWrap}>
                  <AssistantDocument
                    entries={messageToEntries(message)}
                    threadId={message.threadId}
                  />
                </View>
              ),
            )}
            {liveMessage ? (
              <View style={styles.assistantWrap}>
                <AssistantDocument
                  entries={liveMessage.entries}
                  threadId={liveMessage.threadId}
                  streaming={liveMessage.status === "streaming"}
                />
                {liveMessage.status === "error" && liveMessage.error ? (
                  <Text
                    accessibilityRole="alert"
                    style={[styles.error, { color: theme.error }]}
                  >
                    {liveMessage.error.message}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="workplace"
              title={t("workplaceEmptyThreadTitle")}
              description={t("workplaceEmptyThreadBody")}
            />
          </View>
        )}
      </ScrollView>

      <View
        style={[
          styles.composerArea,
          {
            borderTopColor: theme.divider,
            borderTopWidth: borders.hairline,
            backgroundColor: theme.surface,
          },
        ]}
      >
        {sendError ? (
          <FeedbackMotion signal={sendError} kind="error">
            <MotionView preset="rise" exiting style={styles.sendErrorWrap}>
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: theme.error }]}
              >
                {sendError}
              </Text>
              {needsLocalAi ? (
                <PrimaryButton
                  variant="secondary"
                  compact
                  onPress={() => router.push("/local-ai" as never)}
                >
                  {t("workplaceOpenLocalAi")}
                </PrimaryButton>
              ) : null}
            </MotionView>
          </FeedbackMotion>
        ) : null}

        {sending ? (
          <View style={styles.stopRow}>
            <PrimaryButton variant="ghost" compact onPress={onStop}>
              {t("cancel")}
            </PrimaryButton>
          </View>
        ) : (
          <SuggestionPills
            suggestions={suggestions}
            onPress={onSuggestionPress}
          />
        )}

        <Composer
          value={composerValue}
          onChangeText={onComposerChange}
          onSend={onSend}
          sending={sending}
          disabled={offline}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function UserBubble({ message }: { message: WorkplaceMessage }) {
  const { theme } = useSettings();
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n\n");
  if (!text) return null;
  return (
    <View style={styles.userRow}>
      <View
        style={[
          styles.userBubble,
          { backgroundColor: theme.primary, borderColor: theme.primary },
        ]}
      >
        <Text style={[styles.userText, { color: theme.textOnPrimary }]}>
          {text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  offlineBanner: {
    borderBottomWidth: borders.hairline,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  offlineTitle: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
  },
  offlineBody: {
    fontFamily: typography.body,
    fontSize: typography.size.caption,
    marginTop: 2,
  },
  body: { flex: 1, flexDirection: "row" },
  bodyMobile: { flexDirection: "column" },
  railPane: {
    width: 320,
    padding: spacing[4],
  },
  railPaneMobile: {
    width: "100%",
    flex: 1,
  },
  detailPane: {
    flex: 1,
    minWidth: 0,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  detailTitle: {
    flex: 1,
    fontFamily: typography.displayMedium,
    fontSize: typography.size.bodyLarge,
  },
  detailScroll: { flex: 1 },
  detailContent: {
    padding: spacing[4],
    paddingBottom: spacing[6],
    gap: spacing[4],
  },
  loadMoreRow: {
    alignItems: "center",
    marginBottom: spacing[2],
  },
  loader: {
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
  },
  skeleton: {
    width: "82%",
    height: 10,
    borderRadius: 999,
  },
  skeletonShort: {
    width: "58%",
    height: 10,
    borderRadius: 999,
  },
  messages: {
    gap: spacing[5],
  },
  assistantWrap: {
    gap: spacing[2],
  },
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  userBubble: {
    maxWidth: "82%",
    borderRadius: radii.large,
    borderWidth: borders.hairline,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  userText: {
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  emptyWrap: {
    paddingVertical: spacing[8],
  },
  composerArea: {
    padding: spacing[4],
    paddingBottom: safeArea.minimumBottom,
    gap: spacing[2],
  },
  sendErrorWrap: {
    gap: spacing[2],
  },
  stopRow: {
    alignItems: "flex-start",
  },
  error: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
