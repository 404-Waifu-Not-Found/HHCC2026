import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  LibraryResponseSchema,
  VideoImportResponseSchema,
  identifyVideoSource,
  type LibraryCard,
  type LibraryResponse,
  type QuizQuestionType,
} from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { router, useFocusEffect } from "expo-router";
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
import { Mascot } from "../../src/components/Mascot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { QuestionTypeSelector } from "../../src/components/QuestionTypeSelector";
import { Screen } from "../../src/components/Screen";
import { SectionHeader } from "../../src/components/SectionHeader";
import { Surface } from "../../src/components/Surface";
import { VideoCard } from "../../src/components/VideoCard";
import { useOpenVideoCard } from "../../src/hooks/useOpenVideoCard";
import { apiRequest, jsonBody } from "../../src/lib/api";
import { useAppSession } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { preGenerateImportedQuiz } from "../../src/generation/prework";
import {
  saveGenerationState,
  saveImportedVideo,
  saveQuestPreferences,
} from "../../src/state/creation";
import {
  borders,
  breakpoints,
  radii,
  spacing,
  typography,
} from "../../src/theme/tokens";

type VisibleLibrary = Pick<LibraryResponse, "dueReviews" | "saved">;

const emptyLibrary: VisibleLibrary = { dueReviews: [], saved: [] };
const PENDING_URL_KEY = "clipquest:pending-url:v1";

export default function HomeScreen() {
  const { t, theme, locale } = useSettings();
  const { data: session } = useAppSession();
  const { width } = useWindowDimensions();
  const compact = width < breakpoints.tablet;
  const narrow = width < breakpoints.compact;
  const userEditedUrl = useRef(false);
  const importingRef = useRef(false);
  const [url, setUrl] = useState("");
  const [library, setLibrary] = useState<VisibleLibrary>(emptyLibrary);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [questionTypes, setQuestionTypes] = useState<QuizQuestionType[]>([
    ...DEFAULT_QUIZ_QUESTION_TYPES,
  ]);
  const [libraryError, setLibraryError] = useState<string>();
  const { open, openingId, error: openError } = useOpenVideoCard();

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(PENDING_URL_KEY)
      .then((pendingUrl) => {
        if (active && pendingUrl && !userEditedUrl.current) setUrl(pendingUrl);
      })
      .catch(() => {
        // A draft is a convenience. Storage failure must not block manual import.
      });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await apiRequest(
        "/api/library",
        {},
        LibraryResponseSchema,
      );
      setLibrary({ dueReviews: response.dueReviews, saved: response.saved });
      setLibraryError(undefined);
    } catch (cause) {
      setLibraryError(
        cause instanceof Error ? cause.message : t("libraryLoadFailed"),
      );
    } finally {
      setLoadingLibrary(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const importVideo = async (rawUrl = url) => {
    if (importingRef.current) return;
    const trimmed = rawUrl.trim();
    if (!identifyVideoSource(trimmed)) {
      setImportError(t("pasteError"));
      return;
    }

    importingRef.current = true;
    setImporting(true);
    setImportError(undefined);
    try {
      const imported = await apiRequest(
        "/api/videos/import",
        { method: "POST", body: jsonBody({ url: trimmed }) },
        VideoImportResponseSchema,
      );
      const idempotencyKey = Crypto.randomUUID();
      await Promise.all([
        saveImportedVideo(imported),
        saveQuestPreferences(imported.video.id, {
          quizLanguage: locale,
          questionTypes,
        }),
        saveGenerationState(imported.video.id, {
          idempotencyKey,
          quizLanguage: locale,
          questionTypes,
          preworkStatus: "running",
        }),
      ]);
      void preGenerateImportedQuiz(imported, {
        idempotencyKey,
        quizLanguage: locale,
        questionTypes,
      });
      await AsyncStorage.removeItem(PENDING_URL_KEY);
      setUrl("");
      router.push({
        pathname: "/create/[videoId]",
        params: { videoId: imported.video.id },
      });
    } catch (cause) {
      setImportError(
        cause instanceof Error ? cause.message : t("videoImportFailed"),
      );
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  const accountLabel = session?.user.name ?? session?.user.email;
  const secondaryError = libraryError ?? openError;

  return (
    <Screen>
      <View style={styles.header}>
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
        <Mascot mood="ready" size={narrow ? 62 : compact ? 76 : 90} />
      </View>

      <Surface
        elevated
        style={
          compact
            ? [styles.importSurface, styles.importSurfaceCompact]
            : styles.importSurface
        }
      >
        <View style={styles.platforms}>
          <PlatformBadge icon="youtube" label="YouTube" />
          <PlatformBadge icon="television-play" label="bilibili" />
        </View>

        <View style={styles.questionTypeSetup}>
          <Text style={[styles.questionTypeTitle, { color: theme.text }]}>
            {t("questionTypes")}
          </Text>
          <Text style={[styles.questionTypeHelp, { color: theme.textMuted }]}>
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
            <MaterialCommunityIcons
              name="link-variant"
              size={24}
              color={theme.primary}
            />
          }
          onChangeText={(value) => {
            const pastedSupportedLink =
              value.length - url.length > 8 &&
              Boolean(identifyVideoSource(value.trim()));
            userEditedUrl.current = true;
            setUrl(value);
            setImportError(undefined);
            if (pastedSupportedLink) void importVideo(value);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          editable={!importing}
          onSubmitEditing={() => void importVideo()}
        />

        <View
          style={[styles.importAction, compact && styles.importActionCompact]}
        >
          <PrimaryButton
            disabled={!url.trim()}
            loading={importing}
            trailingIcon={
              <MaterialCommunityIcons
                name="arrow-right"
                size={20}
                color={theme.textOnAction}
              />
            }
            onPress={() => void importVideo()}
          >
            {t("makeQuest")}
          </PrimaryButton>
        </View>
      </Surface>

      {secondaryError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: theme.error }]}
        >
          {secondaryError}
        </Text>
      ) : null}

      {loadingLibrary ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.secondary} />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            {t("loading")}
          </Text>
        </View>
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
                    <MaterialCommunityIcons
                      name="arrow-right"
                      color={theme.primary}
                      size={18}
                    />
                  </Pressable>
                }
              />
              {library.saved.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.cardRow}
                >
                  {library.saved.slice(0, 8).map((card) => (
                    <VideoCard
                      key={card.videoId}
                      compact
                      card={card}
                      onPress={() => void open(card)}
                    />
                  ))}
                </ScrollView>
              ) : (
                <Surface
                  padded={false}
                  tone="sunken"
                  style={styles.emptySurface}
                >
                  <EmptyState
                    icon="movie-open-plus-outline"
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
  icon: ComponentProps<typeof MaterialCommunityIcons>["name"];
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
      <MaterialCommunityIcons name={icon} size={18} color={theme.text} />
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
        {cards.map((card) => (
          <View
            key={card.videoId}
            style={openingId === card.videoId ? styles.opening : undefined}
          >
            <VideoCard compact card={card} onPress={() => onOpen(card)} />
            {openingId === card.videoId ? (
              <ActivityIndicator
                style={styles.cardSpinner}
                color={theme.secondary}
              />
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[4],
    marginBottom: spacing[4],
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
    gap: spacing[4],
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
  sections: {
    marginTop: spacing[8],
    gap: spacing[8],
  },
  cardRow: {
    paddingVertical: spacing[2],
    paddingRight: spacing[5],
    gap: spacing[4],
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
