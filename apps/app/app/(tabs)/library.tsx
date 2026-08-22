import {
  LibraryResponseSchema,
  VideoDeleteResponseSchema,
  type LibraryCard,
  type LibraryResponse,
} from "@clipquest/contracts";
import { VoxelIcon } from "../../src/components/VoxelIcon";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { EmptyState } from "../../src/components/EmptyState";
import { Screen } from "../../src/components/Screen";
import { SectionHeader } from "../../src/components/SectionHeader";
import { Surface } from "../../src/components/Surface";
import { VideoCard } from "../../src/components/VideoCard";
import { useOpenVideoCard } from "../../src/hooks/useOpenVideoCard";
import { apiRequest } from "../../src/lib/api";
import { useAppSession } from "../../src/lib/auth-client";
import {
  createLibraryCheatSheetContext,
  exportCheatSheet,
  exportCheatSheetPdf,
  generateCheatSheetDocumentWithLocalAi,
  loadCheatSheetContext,
  renderCheatSheetPdf,
  uploadCheatSheet,
} from "../../src/lib/cheat-sheet";
import { createQuizShareLink, shareQuizLink } from "../../src/lib/quiz-share";
import { useSettings } from "../../src/providers/SettingsProvider";
import { clearImportedVideo } from "../../src/state/creation";
import { breakpoints, spacing, typography } from "../../src/theme/tokens";
import {
  FeedbackMotion,
  MotionSkeleton,
  MotionView,
  StaggerItem,
} from "../../src/motion/Motion";

type VisibleLibrary = Pick<LibraryResponse, "dueReviews" | "saved">;

const emptyLibrary: VisibleLibrary = { dueReviews: [], saved: [] };

export default function LibraryScreen() {
  const { t, theme } = useSettings();
  const { data: session } = useAppSession();
  const { width } = useWindowDimensions();
  const compact = width < breakpoints.tablet;
  const narrow = width < breakpoints.compact;
  const [library, setLibrary] = useState<VisibleLibrary>(emptyLibrary);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [notesGeneratingId, setNotesGeneratingId] = useState<string>();
  const [notesError, setNotesError] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const refreshRequestRef = useRef<Promise<void> | null>(null);
  const refreshRequestIdRef = useRef(0);
  const hasLoadedLibraryRef = useRef(false);
  const [sharingId, setSharingId] = useState<string>();
  const [shareError, setShareError] = useState<string>();
  const [shareNotice, setShareNotice] = useState<string>();
  const { open, openingId, error: openError } = useOpenVideoCard();

  const refresh = useCallback(async () => {
    if (refreshRequestRef.current) return refreshRequestRef.current;
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    const firstLoad = !hasLoadedLibraryRef.current;
    if (firstLoad) setLoading(true);
    else setRefreshing(true);
    const request = (async () => {
      try {
        const response = await apiRequest(
          "/api/library",
          {},
          LibraryResponseSchema,
        );
        if (requestId !== refreshRequestIdRef.current) return;
        setLibrary({ dueReviews: response.dueReviews, saved: response.saved });
        setError(undefined);
        hasLoadedLibraryRef.current = true;
      } catch {
        if (requestId !== refreshRequestIdRef.current) return;
        // Keep transport and platform details out of the learner-facing UI.
        // Android can surface verbose TLS/OkHttp messages that are neither
        // actionable nor safe to treat as product copy.
        setError(t("libraryLoadFailed"));
      } finally {
        if (requestId === refreshRequestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
        refreshRequestRef.current = null;
      }
    })();
    refreshRequestRef.current = request;
    return request;
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const generateNotes = useCallback(
    async (card: LibraryCard) => {
      if (notesGeneratingId) return;
      setNotesGeneratingId(card.videoId);
      setNotesError(undefined);
      try {
        const context = card.quizId
          ? await loadCheatSheetContext(card.quizId)
          : createLibraryCheatSheetContext(card);
        const document = await generateCheatSheetDocumentWithLocalAi(context);
        const pdf = await renderCheatSheetPdf(document);
        let persistenceError: unknown;
        try {
          await uploadCheatSheet({
            videoId: card.videoId,
            quizId: context.quizId,
            document,
            pdf,
          });
        } catch (cause) {
          persistenceError = cause;
        }
        await exportCheatSheetPdf(pdf, card.title);
        if (persistenceError) {
          const detail =
            persistenceError instanceof Error
              ? persistenceError.message
              : "The notes could not be saved.";
          throw new Error(
            `Notes downloaded, but could not be saved: ${detail}`,
          );
        }
        await refresh();
      } catch (cause) {
        setNotesError(
          cause instanceof Error
            ? cause.message
            : "The notes could not be generated.",
        );
      } finally {
        setNotesGeneratingId(undefined);
      }
    },
    [notesGeneratingId, refresh],
  );

  const deleteQuest = useCallback(
    async (card: LibraryCard) => {
      if (deletingId) return;
      setDeletingId(card.videoId);
      setError(undefined);
      try {
        await apiRequest(
          `/api/videos/${encodeURIComponent(card.videoId)}`,
          { method: "DELETE" },
          VideoDeleteResponseSchema,
        );
        if (session?.user.id) {
          await clearImportedVideo(session.user.id, card.videoId);
        }
        setLibrary((current) => ({
          dueReviews: current.dueReviews.filter(
            (item) => item.videoId !== card.videoId,
          ),
          saved: current.saved.filter((item) => item.videoId !== card.videoId),
        }));
      } catch {
        setError(t("deleteQuestFailed"));
      } finally {
        setDeletingId(undefined);
      }
    },
    [deletingId, session, t],
  );

  const confirmDeleteQuest = useCallback(
    (card: LibraryCard) => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const confirmed = window.confirm(
          `${t("deleteQuest")}\n\n${t("deleteQuestBody")}`,
        );
        if (confirmed) void deleteQuest(card);
        return;
      }
      Alert.alert(t("deleteQuest"), t("deleteQuestBody"), [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("deleteQuest"),
          style: "destructive",
          onPress: () => void deleteQuest(card),
        },
      ]);
    },
    [deleteQuest, t],
  );

  const shareQuest = useCallback(
    async (card: LibraryCard) => {
      if (!card.quizId || sharingId) return;
      setSharingId(card.videoId);
      setShareError(undefined);
      setShareNotice(undefined);
      try {
        const link = await createQuizShareLink(card.quizId);
        const outcome = await shareQuizLink({
          url: link.url,
          title: card.title,
        });
        setShareNotice(
          outcome === "copied" ? t("shareLinkCopied") : t("shareLinkShared"),
        );
      } catch (cause) {
        setShareError(
          cause instanceof Error ? cause.message : t("shareFailed"),
        );
      } finally {
        setSharingId(undefined);
      }
    },
    [sharingId, t],
  );

  useEffect(() => {
    if (!shareNotice) return;
    const timer = setTimeout(() => setShareNotice(undefined), 2_500);
    return () => clearTimeout(timer);
  }, [shareNotice]);

  const allCards = useMemo(() => {
    const unique = new Map<string, LibraryCard>();
    [...library.dueReviews, ...library.saved].forEach((card) =>
      unique.set(card.videoId, card),
    );
    return [...unique.values()];
  }, [library]);

  const dueIds = useMemo(
    () => new Set(library.dueReviews.map((card) => card.videoId)),
    [library.dueReviews],
  );
  const savedCards = useMemo(
    () => library.saved.filter((card) => !dueIds.has(card.videoId)),
    [dueIds, library.saved],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? allCards.filter((card) =>
            card.title.toLowerCase().includes(normalizedQuery),
          )
        : allCards,
    [allCards, normalizedQuery],
  );

  return (
    <Screen contentWidth="reading">
      <Text
        accessibilityRole="header"
        style={[
          styles.title,
          narrow && styles.titleNarrow,
          { color: theme.text },
        ]}
      >
        {t("library")}
      </Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>
        {t("tagline")}
      </Text>

      <View style={styles.search}>
        <AppTextInput
          label={t("savedVideos")}
          accessibilityLabel={t("searchSavedQuests")}
          placeholder={t("search")}
          value={query}
          leading={
            <VoxelIcon name="search" size={22} color={theme.textMuted} />
          }
          onChangeText={setQuery}
        />
      </View>
      {refreshing && !loading ? (
        <View style={styles.refreshing}>
          <ActivityIndicator size="small" color={theme.secondary} />
          <Text style={[styles.refreshingText, { color: theme.textMuted }]}>
            {t("loading")}
          </Text>
        </View>
      ) : null}

      {error || openError || notesError || shareError ? (
        <FeedbackMotion
          signal={error ?? openError ?? notesError ?? shareError}
          kind="error"
        >
          <MotionView preset="rise" exiting>
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: theme.error }]}
            >
              {error ?? openError ?? notesError ?? shareError}
            </Text>
          </MotionView>
        </FeedbackMotion>
      ) : null}
      {shareNotice ? (
        <FeedbackMotion signal={shareNotice} kind="success">
          <MotionView preset="rise" exiting>
            <Text
              accessibilityLiveRegion="polite"
              testID="library-share-notice"
              style={[styles.error, { color: theme.success }]}
            >
              {shareNotice}
            </Text>
          </MotionView>
        </FeedbackMotion>
      ) : null}

      {loading ? (
        <MotionView preset="fade" style={styles.loader}>
          <ActivityIndicator color={theme.secondary} />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            {t("loading")}
          </Text>
          <MotionSkeleton
            color={theme.primarySoft}
            style={styles.listSkeleton}
          />
          <MotionSkeleton
            color={theme.primarySoft}
            delay={100}
            style={styles.listSkeletonShort}
          />
        </MotionView>
      ) : filtered.length ? (
        <View style={styles.sections}>
          {normalizedQuery ? (
            <QuestList
              title={t("savedVideos")}
              cards={filtered}
              compact={compact}
              openingId={openingId}
              onOpen={(card) => void open(card)}
              notesGeneratingId={notesGeneratingId}
              onGenerateNotes={(card) => void generateNotes(card)}
              sharingId={sharingId}
              onShare={(card) => void shareQuest(card)}
              deletingId={deletingId}
              onDelete={(card) => void confirmDeleteQuest(card)}
            />
          ) : (
            <>
              {library.dueReviews.length ? (
                <QuestList
                  title={t("dueReviews")}
                  cards={library.dueReviews}
                  compact={compact}
                  openingId={openingId}
                  onOpen={(card) => void open(card)}
                  notesGeneratingId={notesGeneratingId}
                  onGenerateNotes={(card) => void generateNotes(card)}
                  sharingId={sharingId}
                  onShare={(card) => void shareQuest(card)}
                  deletingId={deletingId}
                  onDelete={(card) => void confirmDeleteQuest(card)}
                />
              ) : null}
              {savedCards.length ? (
                <QuestList
                  title={t("savedVideos")}
                  cards={savedCards}
                  compact={compact}
                  openingId={openingId}
                  onOpen={(card) => void open(card)}
                  notesGeneratingId={notesGeneratingId}
                  onGenerateNotes={(card) => void generateNotes(card)}
                  sharingId={sharingId}
                  onShare={(card) => void shareQuest(card)}
                  deletingId={deletingId}
                  onDelete={(card) => void confirmDeleteQuest(card)}
                />
              ) : null}
            </>
          )}
        </View>
      ) : (
        <Surface padded={false} tone="sunken" style={styles.emptySurface}>
          <EmptyState
            icon={normalizedQuery ? "search" : "library"}
            title={t("emptyLibrary")}
            description={
              normalizedQuery ? t("searchSavedQuests") : t("tagline")
            }
          />
        </Surface>
      )}
    </Screen>
  );
}

function QuestList({
  title,
  cards,
  compact,
  openingId,
  onOpen,
  notesGeneratingId,
  onGenerateNotes,
  sharingId,
  onShare,
  deletingId,
  onDelete,
}: {
  title: string;
  cards: LibraryCard[];
  compact: boolean;
  openingId?: string;
  onOpen(card: LibraryCard): void;
  notesGeneratingId?: string;
  onGenerateNotes(card: LibraryCard): void;
  sharingId?: string;
  onShare(card: LibraryCard): void;
  deletingId?: string;
  onDelete(card: LibraryCard): void;
}) {
  const { theme } = useSettings();
  return (
    <View>
      <SectionHeader title={title} count={cards.length} />
      <View style={styles.list}>
        {cards.map((card, index) => (
          <StaggerItem
            key={card.videoId}
            index={index}
            style={[
              styles.cardWrap,
              compact && styles.cardWrapCompact,
              openingId === card.videoId && styles.opening,
            ]}
          >
            <VideoCard
              compact={compact}
              fill
              card={card}
              onPress={() => onOpen(card)}
              onExport={
                card.cheatSheet.status === "ready" && card.cheatSheet.sheetId
                  ? () => exportCheatSheet(card.cheatSheet.sheetId!, card.title)
                  : undefined
              }
              onGenerateNotes={() => onGenerateNotes(card)}
              notesPending={notesGeneratingId === card.videoId}
              onShare={card.quizId ? () => onShare(card) : undefined}
              sharePending={sharingId === card.videoId}
              onDelete={() => onDelete(card)}
              deletePending={deletingId === card.videoId}
            />
            {openingId === card.videoId ? (
              <ActivityIndicator
                style={styles.cardSpinner}
                color={theme.secondary}
              />
            ) : null}
          </StaggerItem>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: typography.display,
    fontSize: typography.size.displaySmall,
    lineHeight: typography.lineHeight.displaySmall,
  },
  titleNarrow: {
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  subtitle: {
    marginTop: spacing[1],
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  search: {
    marginTop: spacing[6],
    marginBottom: spacing[3],
  },
  refreshing: {
    marginBottom: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  refreshingText: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  error: {
    marginBottom: spacing[3],
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  loader: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
  },
  loadingText: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
  },
  listSkeleton: {
    width: "82%",
    height: 10,
    borderRadius: 999,
  },
  listSkeletonShort: {
    width: "58%",
    height: 10,
    borderRadius: 999,
  },
  sections: {
    marginTop: spacing[4],
    gap: spacing[8],
  },
  list: {
    gap: spacing[4],
    paddingTop: spacing[2],
  },
  cardWrap: {
    width: "100%",
  },
  cardWrapCompact: {
    width: "100%",
  },
  opening: {
    opacity: 0.65,
  },
  cardSpinner: {
    position: "absolute",
    top: "45%",
    left: "50%",
  },
  emptySurface: {
    marginTop: spacing[5],
  },
});
