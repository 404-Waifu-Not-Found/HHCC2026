import type { LibraryCard } from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { radii, shadows, typography } from "../theme/tokens";

const masteryKeys = {
  not_started: "notStarted",
  learning: "learning",
  mastered: "mastered",
} as const;

export function VideoCard({ card, onPress, compact = false }: { card: LibraryCard; onPress(): void; compact?: boolean }) {
  const { t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const horizontal = !compact && width >= 720;
  const actionLabel = card.action === "continue" ? t("continue") : card.action === "review" ? t("review") : t("start");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}. ${t(masteryKeys[card.mastery])}. ${actionLabel}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        horizontal && styles.horizontal,
        { backgroundColor: theme.surface, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
    >
      <Image source={{ uri: card.thumbnailUrl }} contentFit="cover" transition={180} style={[styles.image, horizontal && styles.imageHorizontal]} />
      <View style={styles.body}>
        <View style={styles.sourceRow}>
          <MaterialCommunityIcons name={card.source === "youtube" ? "youtube" : "television-play"} size={18} color={theme.textMuted} />
          <Text style={[styles.source, { color: theme.textMuted }]}>{card.source === "youtube" ? "YouTube" : "bilibili"}</Text>
        </View>
        <Text numberOfLines={2} style={[styles.title, { color: theme.text }]}>{card.title}</Text>
        <View style={styles.meta}>
          <View style={[styles.badge, { backgroundColor: card.mastery === "mastered" ? theme.primary : theme.elevated }]}>
            <Text style={[styles.badgeText, { color: theme.text }]}>{t(masteryKeys[card.mastery])}</Text>
          </View>
          {card.bestScore !== null ? <Text style={[styles.score, { color: theme.textMuted }]}>{Math.round(card.bestScore)}%</Text> : null}
          <View style={styles.spacer} />
          <Text style={[styles.action, { color: theme.text }]}>{actionLabel}</Text>
          <MaterialCommunityIcons name="arrow-right" size={20} color={theme.text} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: 286, overflow: "hidden", borderWidth: 2, borderRadius: radii.large, ...shadows.card },
  horizontal: { width: "100%", flexDirection: "row" },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  image: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#CBD2DE" },
  imageHorizontal: { width: 236, aspectRatio: 16 / 10 },
  body: { flex: 1, padding: 15, gap: 8 },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  source: { fontFamily: typography.bodyMedium, fontSize: 12 },
  title: { minHeight: 44, fontFamily: typography.bodyBold, fontSize: 16, lineHeight: 21 },
  meta: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7 },
  badge: { borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5 },
  badgeText: { fontFamily: typography.bodyBold, fontSize: 11 },
  score: { fontFamily: typography.bodyBold, fontSize: 13 },
  spacer: { flex: 1 },
  action: { fontFamily: typography.bodyBold, fontSize: 13 },
});
