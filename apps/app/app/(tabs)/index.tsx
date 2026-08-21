import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  LibraryResponseSchema,
  VideoImportResponseSchema,
  identifyVideoSource,
  type LibraryCard,
  type LibraryResponse,
  type QuizQuestionType,
} from "@clipquest/contracts";
import { VoxelIcon } from "../../src/components/VoxelIcon";
import * as Crypto from "expo-crypto";
import { Image } from "expo-image";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { EmptyState } from "../../src/components/EmptyState";
import { LearningPrism } from "../../src/components/LearningPrism";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { QuestionTypeSelector } from "../../src/components/QuestionTypeSelector";
import { Screen } from "../../src/components/Screen";
import { SectionHeader } from "../../src/components/SectionHeader";
import { Surface } from "../../src/components/Surface";
import { VideoCard } from "../../src/components/VideoCard";
import { useOpenVideoCard } from "../../src/hooks/useOpenVideoCard";
import { apiRequest, jsonBody } from "../../src/lib/api";
import { exportCheatSheet } from "../../src/lib/cheat-sheet";
import { useAppSession } from "../../src/lib/auth-client";
import {
  parseQuickOpenRequest,
  type QuickOpenSearchParams,
} from "../../src/lib/quick-open";
import { useSettings } from "../../src/providers/SettingsProvider";
import { preGenerateImportedQuiz } from "../../src/generation/prework";
import {
  FeedbackMotion,
  MotionSkeleton,
  MotionView,
  StaggerItem,
} from "../../src/motion/Motion";
import {
  saveGenerationRecord,
  saveImportedVideo,
  saveQuestPreferences,
} from "../../src/state/creation";
import {
  claimPendingVideoHandoff,
  clearPendingVideoHandoff,
  createAndSavePendingVideoHandoff,
  markPendingVideoHandoffState,
  type PendingVideoHandoffV2,
} from "../../src/state/pending-video-handoff";
import {
  borders,
  breakpoints,
  radii,
  spacing,
  typography,
} from "../../src/theme/tokens";

type VisibleLibrary = Pick<LibraryResponse, "dueReviews" | "saved">;

const emptyLibrary: VisibleLibrary = { dueReviews: [], saved: [] };

export default function HomeScreen() {
  const { t, theme, locale } = useSettings();
  const { data: session } = useAppSession();
  const { width } = useWindowDimensions();
  const compact = width < breakpoints.tablet;
  const narrow = width < breakpoints.compact;
  const desktop = width >= breakpoints.desktop;
  const params = useLocalSearchParams<QuickOpenSearchParams>();
  const quickOpen = parseQuickOpenRequest(params);
  const quickOpenUrl = quickOpen?.url;
  const userId = session?.user.id;
  const userEditedUrl = useRef(false);
  const importingRef = useRef(false);
  const consumedQuickOpenUrl = useRef<string | undefined>(undefined);
  const [url, setUrl] = useState("");
  const [library, setLibrary] = useState<VisibleLibrary>(emptyLibrary);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [activeHandoff, setActiveHandoff] = useState<PendingVideoHandoffV2>();
  const [questionTypes, setQuestionTypes] = useState<QuizQuestionType[]>([
    ...DEFAULT_QUIZ_QUESTION_TYPES,
  ]);
  const [libraryError, setLibraryError] = useState<string>();
  const { open, openingId, error: openError } = useOpenVideoCard();

  const refresh = useCallback(async () => {
    try {
      const response = await apiRequest(
        "/api/library",
        {},
        LibraryResponseSchema,
      );
      setLibrary({ dueReviews: response.dueReviews, saved: response.saved });
      setLibraryError(undefined);
    } catch {
      // Keep transport and platform details out of the learner-facing UI.
      // Android can surface verbose TLS/OkHttp messages that are neither
      // actionable nor safe to treat as product copy.
      setLibraryError(t("libraryLoadFailed"));
    } finally {
      setLoadingLibrary(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const importVideo = useCallback(
    async (rawUrl = url, handoff?: PendingVideoHandoffV2) => {
      if (importingRef.current) return;
      const trimmed = rawUrl.trim();
      if (!identifyVideoSource(trimmed)) {
        setImportError(t("pasteError"));
        return;
      }

      importingRef.current = true;
      setImporting(true);
      setImportError(undefined);
      let importHandoff = handoff;
      try {
        if (importHandoff) {
          if (!userId || importHandoff.claimedUserId !== userId) {
            await clearPendingVideoHandoff(importHandoff.id);
            return;
          }
          const inFlight = await markPendingVideoHandoffState(
            importHandoff.id,
            userId,
            "in_flight",
          );
          if (!inFlight) return;
          importHandoff = inFlight;
          setActiveHandoff(inFlight);
        }
        const imported = await apiRequest(
          "/api/videos/import",
          { method: "POST", body: jsonBody({ url: trimmed }) },
          VideoImportResponseSchema,
        );
        const idempotencyKey = importHandoff?.id ?? Crypto.randomUUID();
        const generationId = Crypto.randomUUID();
        const generationSessionId = Crypto.randomUUID();
        if (!userId) throw new Error("Sign in again before creating a quiz.");
        const timestamp = Date.now();
        void Image.prefetch(imported.video.thumbnailUrl, "memory-disk").catch(
          () => false,
        );
        await Promise.all([
          saveImportedVideo(userId, imported),
          saveQuestPreferences(userId, imported.video.id, {
            quizLanguage: locale,
            questionTypes,
          }),
          saveGenerationRecord({
            version: 2,
            generationId,
            generationSessionId,
            idempotencyKey,
            ownerUserId: userId,
            videoId: imported.video.id,
            quizLanguage: locale,
            questionTypes,
            sessionLength: "medium",
            watched: true,
            acceptedCount: 0,
            plannedCount: 10,
            state: "pending",
            nextCallIndex: 0,
            preworkStatus: "running",
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        ]);
        void preGenerateImportedQuiz(imported, {
          ownerUserId: userId,
          generationId,
          quizLanguage: locale,
          questionTypes,
        });
        if (importHandoff) await clearPendingVideoHandoff(importHandoff.id);
        setActiveHandoff(undefined);
        setUrl("");
        router.push({
          pathname: "/create/[videoId]",
          params: { videoId: imported.video.id, generationId },
        });
      } catch (cause) {
        if (importHandoff && userId) {
          const retryRequired = await markPendingVideoHandoffState(
            importHandoff.id,
            userId,
            "retry_required",
          ).catch(() => null);
          if (retryRequired) setActiveHandoff(retryRequired);
        }
        setImportError(
          cause instanceof Error ? cause.message : t("videoImportFailed"),
        );
      } finally {
        importingRef.current = false;
        setImporting(false);
      }
    },
    [locale, questionTypes, t, url, userId],
  );

  useEffect(() => {
    if (!quickOpenUrl) {
      consumedQuickOpenUrl.current = undefined;
      return;
    }
    if (!userId || consumedQuickOpenUrl.current === quickOpenUrl) return;
    consumedQuickOpenUrl.current = quickOpenUrl;
    userEditedUrl.current = true;
    setUrl(quickOpenUrl);
    router.setParams({ url: undefined, autostart: undefined });
    void createAndSavePendingVideoHandoff({
      url: quickOpenUrl,
      source: "quick_open",
      claimedUserId: userId,
    })
      .then((handoff) => {
        setActiveHandoff(handoff);
        return importVideo(handoff.url, handoff);
      })
      .catch((cause) => {
        setImportError(
          cause instanceof Error ? cause.message : t("videoImportFailed"),
        );
      });
  }, [importVideo, quickOpenUrl, t, userId]);

  useEffect(() => {
    if (!userId || quickOpenUrl) return;
    let active = true;
    void claimPendingVideoHandoff(userId)
      .then(async (handoff) => {
        if (!active || !handoff) return;
        userEditedUrl.current = true;
        setUrl(handoff.url);
        if (handoff.state === "in_flight") {
          const retryRequired = await markPendingVideoHandoffState(
            handoff.id,
            userId,
            "retry_required",
          );
          if (active && retryRequired) setActiveHandoff(retryRequired);
          return;
        }
        setActiveHandoff(handoff);
        if (handoff.state === "pending") {
          await importVideo(handoff.url, handoff);
        }
      })
      .catch(() => {
        // The learner can still paste a URL if session storage is unavailable.
      });
    return () => {
      active = false;
    };
  }, [importVideo, quickOpenUrl, userId]);

  const accountLabel = session?.user.name ?? session?.user.email;
  const secondaryError = libraryError ?? openError;

  return (
    <Screen>
      <MotionView preset="from-left" style={styles.header}>
        <View style={styles.headerCopy}>
          <Text
            accessibilityRole="header"
            style={[
              styles.greeting,
              narrow && styles.greetingNarrow,
              { color: theme.text },
            ]}
          >
            {t("homeGreeting")}
          </Text>
          {accountLabel ? (
            <Text
              numberOfLines={1}
              style={[styles.account, { color: theme.textMuted }]}
            >
              {accountLabel}
            </Text>
          ) : null}
        </View>
        <LearningPrism size={narrow ? 62 : compact ? 76 : 90} variant="tile" />
      </MotionView>

      <FeedbackMotion signal={importing} kind="progress">
        <MotionView preset="rise" delay={44}>
          <Surface
            elevated
            style={
              compact
                ? [styles.importSurface, styles.importSurfaceCompact]
                : styles.importSurface
            }
          >
            <View style={styles.platforms}>
              <PlatformBadge icon="video" label="YouTube" />
            </View>

            <View style={styles.questionTypeSetup}>
              <Text style={[styles.questionTypeTitle, { color: theme.text }]}>
                {t("questionTypes")}
              </Text>
              <Text
                style={[styles.questionTypeHelp, { color: theme.textMuted }]}
              >
                {t("questionTypesHelp")}
              </Text>
              <QuestionTypeSelector
                value={questionTypes}
                onChange={setQuestionTypes}
                disabled={importing}
              />
            </View>

            <AppTextInput
              large
              label={t("pastePlaceholder")}
              placeholder="https://youtube.com/watch?v=..."
              value={url}
              error={importError}
              leading={
                <VoxelIcon name="link" size={24} color={theme.primary} />
              }
              onChangeText={(value) => {
                const pastedSupportedLink =
                  value.length - url.length > 8 &&
                  Boolean(identifyVideoSource(value.trim()));
                userEditedUrl.current = true;
                if (activeHandoff && value !== activeHandoff.url) {
                  void clearPendingVideoHandoff(activeHandoff.id);
                  setActiveHandoff(undefined);
                }
                setUrl(value);
                setImportError(undefined);
                if (pastedSupportedLink) void importVideo(value);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              editable={!importing}
              onSubmitEditing={() => void importVideo(url, activeHandoff)}
            />

            <View
              style={[
                styles.importAction,
                compact && styles.importActionCompact,
              ]}
            >
              <PrimaryButton
                disabled={!url.trim()}
                loading={importing}
                trailingIcon={
                  <VoxelIcon name="next" size={20} color={theme.textOnAction} />
                }
                onPress={() => void importVideo(url, activeHandoff)}
              >
                {activeHandoff?.state === "retry_required"
                  ? t("retry")
                  : t("makeQuest")}
              </PrimaryButton>
            </View>
          </Surface>
        </MotionView>
      </FeedbackMotion>

      {secondaryError ? (
        <FeedbackMotion signal={secondaryError} kind="error">
          <MotionView preset="rise" exiting>
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: theme.error }]}
            >
              {secondaryError}
            </Text>
          </MotionView>
        </FeedbackMotion>
      ) : null}

      {loadingLibrary ? (
        <MotionView preset="fade" style={styles.loading}>
          <ActivityIndicator color={theme.secondary} />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            {t("loading")}
          </Text>
          <MotionSkeleton
            color={theme.primarySoft}
            style={styles.librarySkeleton}
          />
        </MotionView>
      ) : (
        <View style={styles.sections}>
          {library.dueReviews.length ? (
            <CardSection
              title={t("dueReviews")}
              cards={library.dueReviews}
              openingId={openingId}
              onOpen={(card) => void open(card)}
            />
          ) : null}

          {library.saved.length || !library.dueReviews.length ? (
            <View>
              <SectionHeader
                title={t("savedVideos")}
                action={
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={t("library")}
                    onPress={() => router.push("/(tabs)/library")}
                    style={({ pressed }) => [
                      styles.viewAll,
                      pressed && styles.viewAllPressed,
                    ]}
                  >
                    <Text
                      style={[styles.viewAllText, { color: theme.primary }]}
                    >
                      {t("library")}
                    </Text>
                    <VoxelIcon name="next" color={theme.primary} size={18} />
                  </Pressable>
                }
              />
              {library.saved.length && desktop ? (
                <View style={styles.cardGrid}>
                  {library.saved.slice(0, 3).map((card, index) => (
                    <StaggerItem
                      key={card.videoId}
                      index={index}
                      style={styles.cardGridItem}
                    >
                      <VideoCard
                        compact
                        fill
                        card={card}
                        onPress={() => void open(card)}
                        onExport={
                          card.cheatSheet.status === "failed"
                            ? () => void open(card)
                            : card.cheatSheet.sheetId
                              ? () =>
                                  exportCheatSheet(
                                    card.cheatSheet.sheetId!,
                                    card.title,
                                  )
                              : undefined
                        }
                      />
                    </StaggerItem>
                  ))}
                </View>
              ) : library.saved.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.cardRow}
                >
                  {library.saved.slice(0, 8).map((card, index) => (
                    <StaggerItem key={card.videoId} index={index}>
                      <VideoCard
                        compact
                        card={card}
                        onPress={() => void open(card)}
                        onExport={
                          card.cheatSheet.status === "failed"
                            ? () => void open(card)
                            : card.cheatSheet.sheetId
                              ? () =>
                                  void exportCheatSheet(
                                    card.cheatSheet.sheetId!,
                                    card.title,
                                  )
                              : undefined
                        }
                      />
                    </StaggerItem>
                  ))}
                </ScrollView>
              ) : (
                <Surface
                  padded={false}
                  tone="sunken"
                  style={styles.emptySurface}
                >
                  <EmptyState
                    icon="video"
                    title={t("emptyLibrary")}
                    description={t("tagline")}
                  />
                </Surface>
              )}
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function PlatformBadge({
  icon,
  label,
}: {
  icon: ComponentProps<typeof VoxelIcon>["name"];
  label: string;
}) {
  const { theme } = useSettings();
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.platformBadge,
        { backgroundColor: theme.surfaceSunken, borderColor: theme.border },
      ]}
    >
      <VoxelIcon name={icon} size={18} color={theme.text} />
      <Text style={[styles.platformLabel, { color: theme.text }]}>{label}</Text>
    </View>
  );
}

function CardSection({
  title,
  cards,
  openingId,
  onOpen,
}: {
  title: string;
  cards: LibraryCard[];
  openingId?: string;
  onOpen(card: LibraryCard): void;
}) {
  const { theme } = useSettings();
  return (
    <View>
      <SectionHeader title={title} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cardRow}
      >
        {cards.map((card, index) => (
          <StaggerItem
            key={card.videoId}
            index={index}
            style={openingId === card.videoId ? styles.opening : undefined}
          >
            <VideoCard
              compact
              card={card}
              onPress={() => onOpen(card)}
              onExport={
                card.cheatSheet.status === "failed"
                  ? () => onOpen(card)
                  : card.cheatSheet.sheetId
                    ? () =>
                        exportCheatSheet(
                          card.cheatSheet.sheetId!,
                          card.title,
                        )
                    : undefined
              }
            />
            {openingId === card.videoId ? (
              <ActivityIndicator
                style={styles.cardSpinner}
                color={theme.secondary}
              />
            ) : null}
          </StaggerItem>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[4],
    marginBottom: spacing[3],
  },
  headerCopy: {
    minWidth: 0,
    flex: 1,
  },
  greeting: {
    fontFamily: typography.display,
    fontSize: typography.size.displaySmall,
    lineHeight: typography.lineHeight.displaySmall,
  },
  greetingNarrow: {
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  account: {
    marginTop: spacing[1],
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  importSurface: {
    gap: spacing[5],
  },
  importSurfaceCompact: {
    padding: spacing[4],
    gap: spacing[3],
  },
  platforms: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  questionTypeSetup: { gap: spacing[2] },
  questionTypeTitle: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  questionTypeHelp: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  platformBadge: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderWidth: borders.standard,
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
  },
  platformLabel: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  importAction: {
    width: 240,
    maxWidth: "100%",
    alignSelf: "flex-end",
  },
  importActionCompact: {
    width: "100%",
  },
  error: {
    marginTop: spacing[3],
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  loading: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
  },
  loadingText: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
  },
  librarySkeleton: {
    width: 220,
    height: 10,
    borderRadius: radii.pill,
  },
  sections: {
    marginTop: spacing[6],
    gap: spacing[6],
  },
  cardRow: {
    paddingVertical: spacing[2],
    paddingRight: spacing[5],
    gap: spacing[4],
  },
  cardGrid: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing[4],
    paddingVertical: spacing[2],
  },
  cardGridItem: {
    width: "31.6%",
    minWidth: 0,
  },
  opening: {
    opacity: 0.65,
  },
  cardSpinner: {
    position: "absolute",
    top: "45%",
    left: "45%",
  },
  viewAll: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingHorizontal: spacing[2],
  },
  viewAllPressed: {
    opacity: 0.7,
  },
  viewAllText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
  },
  emptySurface: {
    marginTop: spacing[2],
  },
});
