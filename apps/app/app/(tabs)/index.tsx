import {
  LibraryResponseSchema,
  VideoImportResponseSchema,
  identifyVideoSource,
  type LibraryCard,
  type LibraryResponse,
} from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, router } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { Mascot } from "../../src/components/Mascot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Screen } from "../../src/components/Screen";
import { SectionHeader } from "../../src/components/SectionHeader";
import { VideoCard } from "../../src/components/VideoCard";
import { useOpenVideoCard } from "../../src/hooks/useOpenVideoCard";
import { apiRequest, jsonBody } from "../../src/lib/api";
import { useAppSession } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { saveImportedVideo } from "../../src/state/creation";
import { radii, typography } from "../../src/theme/tokens";

const emptyLibrary: LibraryResponse = { dueReviews: [], saved: [], youtubeSuggestions: [] };

export default function HomeScreen() {
  const { t, theme } = useSettings();
  const { data: session } = useAppSession();
  const [url, setUrl] = useState("");
  const [library, setLibrary] = useState<LibraryResponse>(emptyLibrary);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string>();
  const { open, openingId, error: openError } = useOpenVideoCard();

  const refresh = useCallback(async () => {
    try {
      const response = await apiRequest("/api/library", {}, LibraryResponseSchema);
      setLibrary(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("libraryLoadFailed"));
    } finally {
      setLoadingLibrary(false);
    }
  }, [t]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const importVideo = async () => {
    const trimmed = url.trim();
    if (!identifyVideoSource(trimmed)) {
      setError(t("pasteError"));
      return;
    }
    setImporting(true);
    setError(undefined);
    try {
      const imported = await apiRequest(
        "/api/videos/import",
        { method: "POST", body: jsonBody({ url: trimmed }) },
        VideoImportResponseSchema,
      );
      await saveImportedVideo(imported);
      setUrl("");
      router.push({ pathname: "/create/[videoId]", params: { videoId: imported.video.id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("videoImportFailed"));
    } finally {
      setImporting(false);
    }
  };

  const shownError = error ?? openError;
  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: theme.textMuted }]}>CLIPQUEST</Text>
          <Text accessibilityRole="header" style={[styles.greeting, { color: theme.text }]}>
            {t("homeGreeting")}
          </Text>
          <Text style={[styles.hello, { color: theme.textMuted }]}>{session?.user.name ?? session?.user.email}</Text>
        </View>
        <Mascot mood="ready" size={82} />
      </View>

      <View style={[styles.pasteCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.pasteIcon}>
          <MaterialCommunityIcons name="link-variant" size={26} color={theme.text} />
        </View>
        <View style={styles.pasteContent}>
          <AppTextInput
            label={t("pastePlaceholder")}
            value={url}
            onChangeText={(value) => { setUrl(value); setError(undefined); }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => void importVideo()}
          />
          <PrimaryButton disabled={!url.trim()} loading={importing} onPress={() => void importVideo()}>
            {t("makeQuest")}
          </PrimaryButton>
        </View>
      </View>
      {shownError ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{shownError}</Text> : null}

      {loadingLibrary ? (
        <View style={styles.loading}><ActivityIndicator color={theme.secondary} /><Text style={[styles.loadingText, { color: theme.textMuted }]}>{t("loading")}</Text></View>
      ) : (
        <View style={styles.sections}>
          {library.youtubeSuggestions.length ? (
            <CardSection title={t("youtubeSuggestions")} cards={library.youtubeSuggestions} openingId={openingId} onOpen={(card) => void open(card)} />
          ) : null}
          {library.dueReviews.length ? (
            <CardSection title={t("dueReviews")} cards={library.dueReviews} openingId={openingId} onOpen={(card) => void open(card)} />
          ) : null}
          <View>
            <SectionHeader
              title={t("savedVideos")}
              action={
                <Pressable accessibilityRole="link" onPress={() => router.push("/(tabs)/library")} style={styles.viewAll}>
                  <Text style={[styles.viewAllText, { color: theme.text }]}>{t("library")}</Text>
                  <MaterialCommunityIcons name="arrow-right" color={theme.text} size={18} />
                </Pressable>
              }
            />
            {library.saved.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardRow}>
                {library.saved.slice(0, 8).map((card) => <VideoCard key={card.videoId} card={card} onPress={() => void open(card)} />)}
              </ScrollView>
            ) : (
              <View style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <MaterialCommunityIcons name="movie-open-plus-outline" size={34} color={theme.textMuted} />
                <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t("emptyLibrary")}</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </Screen>
  );
}

function CardSection({ title, cards, openingId, onOpen }: { title: string; cards: LibraryCard[]; openingId?: string; onOpen(card: LibraryCard): void }) {
  const { theme } = useSettings();
  return (
    <View>
      <SectionHeader title={title} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardRow}>
        {cards.map((card) => (
          <View key={card.videoId} style={openingId === card.videoId ? styles.opening : undefined}>
            <VideoCard card={card} onPress={() => onOpen(card)} />
            {openingId === card.videoId ? <ActivityIndicator style={styles.cardSpinner} color={theme.secondary} /> : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 18 },
  headerCopy: { flex: 1 },
  eyebrow: { fontFamily: typography.bodyBold, fontSize: 12, letterSpacing: 2 },
  greeting: { fontFamily: typography.display, fontSize: 34, lineHeight: 39, marginTop: 3 },
  hello: { fontFamily: typography.body, fontSize: 13, marginTop: 5 },
  pasteCard: { borderWidth: 2, borderRadius: radii.large, padding: 18, flexDirection: "row", gap: 14 },
  pasteIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(84, 200, 245, 0.24)", alignItems: "center", justifyContent: "center" },
  pasteContent: { flex: 1, gap: 12 },
  error: { marginTop: 10, fontFamily: typography.bodyMedium, fontSize: 14 },
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { fontFamily: typography.bodyMedium, fontSize: 14 },
  sections: { marginTop: 26, gap: 24 },
  cardRow: { paddingVertical: 8, paddingRight: 20, gap: 14 },
  opening: { opacity: 0.65 },
  cardSpinner: { position: "absolute", top: "45%", left: "45%" },
  viewAll: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 5 },
  viewAllText: { fontFamily: typography.bodyBold, fontSize: 13 },
  empty: { minHeight: 124, borderWidth: 2, borderStyle: "dashed", borderRadius: radii.large, alignItems: "center", justifyContent: "center", gap: 8, padding: 20 },
  emptyText: { fontFamily: typography.bodyMedium, fontSize: 14, textAlign: "center" },
});
