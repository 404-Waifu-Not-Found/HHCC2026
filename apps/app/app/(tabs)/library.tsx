import { LibraryResponseSchema, type LibraryCard } from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { Screen } from "../../src/components/Screen";
import { VideoCard } from "../../src/components/VideoCard";
import { useOpenVideoCard } from "../../src/hooks/useOpenVideoCard";
import { apiRequest } from "../../src/lib/api";
import { useSettings } from "../../src/providers/SettingsProvider";
import { radii, typography } from "../../src/theme/tokens";

export default function LibraryScreen() {
  const { t, theme } = useSettings();
  const [cards, setCards] = useState<LibraryCard[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const { open, error: openError } = useOpenVideoCard();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest("/api/library", {}, LibraryResponseSchema);
      const unique = new Map<string, LibraryCard>();
      [...response.dueReviews, ...response.saved, ...response.youtubeSuggestions].forEach((card) => unique.set(card.videoId, card));
      setCards([...unique.values()]);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("libraryLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? cards.filter((card) => card.title.toLowerCase().includes(normalized)) : cards;
  }, [cards, query]);

  return (
    <Screen>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{t("library")}</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>{t("tagline")}</Text>
      <View style={styles.search}>
        <AppTextInput label={t("savedVideos")} accessibilityLabel={t("searchSavedQuests")} placeholder={t("search")} value={query} onChangeText={setQuery} />
      </View>
      {error || openError ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error ?? openError}</Text> : null}
      {loading ? (
        <ActivityIndicator style={styles.loader} color={theme.secondary} />
      ) : filtered.length ? (
        <View style={styles.list}>{filtered.map((card) => <VideoCard key={card.videoId} card={card} onPress={() => void open(card)} />)}</View>
      ) : (
        <View style={[styles.empty, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <MaterialCommunityIcons name="bookshelf" size={44} color={theme.textMuted} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>{t("emptyLibrary")}</Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: typography.display, fontSize: 38, lineHeight: 44 },
  subtitle: { fontFamily: typography.body, fontSize: 15, marginTop: 4 },
  search: { marginTop: 20, marginBottom: 12, maxWidth: 560 },
  error: { fontFamily: typography.bodyMedium, fontSize: 14, marginBottom: 10 },
  loader: { marginTop: 80 },
  list: { flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "stretch" },
  empty: { minHeight: 250, borderWidth: 2, borderStyle: "dashed", borderRadius: radii.large, alignItems: "center", justifyContent: "center", gap: 12, padding: 28 },
  emptyTitle: { fontFamily: typography.displayMedium, fontSize: 19, textAlign: "center" },
});
