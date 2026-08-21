import {
  LibraryResponseSchema,
  type LibraryCard,
  type LibraryResponse,
} from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { useSettings } from "../../src/providers/SettingsProvider";
import { breakpoints, spacing, typography } from "../../src/theme/tokens";

type VisibleLibrary = Pick<LibraryResponse, "dueReviews" | "saved">;

const emptyLibrary: VisibleLibrary = { dueReviews: [], saved: [] };

export default function LibraryScreen() {
  const { t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const compact = width < breakpoints.tablet;
  const narrow = width < breakpoints.compact;
  const [library, setLibrary] = useState<VisibleLibrary>(emptyLibrary);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const { open, openingId, error: openError } = useOpenVideoCard();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest(
        "/api/library",
        {},
        LibraryResponseSchema,
      );
      setLibrary({ dueReviews: response.dueReviews, saved: response.saved });
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("libraryLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

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
            <MaterialCommunityIcons
              name="magnify"
              size={22}
              color={theme.textMuted}
            />
          }
          onChangeText={setQuery}
        />
      </View>

      {error || openError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: theme.error }]}
        >
          {error ?? openError}
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={theme.secondary} />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            {t("loading")}
          </Text>
        </View>
      ) : filtered.length ? (
        <View style={styles.sections}>
          {normalizedQuery ? (
            <QuestList
              title={t("savedVideos")}
              cards={filtered}
              compact={compact}
              openingId={openingId}
              onOpen={(card) => void open(card)}
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
                />
              ) : null}
              {savedCards.length ? (
                <QuestList
                  title={t("savedVideos")}
                  cards={savedCards}
                  compact={compact}
                  openingId={openingId}
                  onOpen={(card) => void open(card)}
                />
              ) : null}
            </>
          )}
        </View>
      ) : (
        <Surface padded={false} tone="sunken" style={styles.emptySurface}>
          <EmptyState
            icon={normalizedQuery ? "magnify" : "bookshelf"}
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
}: {
  title: string;
  cards: LibraryCard[];
  compact: boolean;
  openingId?: string;
  onOpen(card: LibraryCard): void;
}) {
  const { theme } = useSettings();
  return (
    <View>
      <SectionHeader title={title} />
      <View style={styles.list}>
        {cards.map((card) => (
          <View
            key={card.videoId}
            style={[
              styles.cardWrap,
              compact && styles.cardWrapCompact,
              openingId === card.videoId && styles.opening,
            ]}
          >
            <VideoCard
              compact={compact}
              card={card}
              onPress={() => onOpen(card)}
            />
            {openingId === card.videoId ? (
              <ActivityIndicator
                style={styles.cardSpinner}
                color={theme.secondary}
              />
            ) : null}
          </View>
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
    alignItems: "center",
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
