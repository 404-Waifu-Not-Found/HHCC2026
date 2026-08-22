import {
  LeaderboardResponseSchema,
  type LeaderboardEntry,
} from "@clipquest/contracts";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Screen } from "../../src/components/Screen";
import { Surface } from "../../src/components/Surface";
import { ProfileAvatar } from "../../src/components/ProfileAvatar";
import { apiRequest } from "../../src/lib/api";
import { useSettings } from "../../src/providers/SettingsProvider";
import { radii, spacing, typography } from "../../src/theme/tokens";

export default function LeaderboardScreen() {
  const { t, theme } = useSettings();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest(
        "/api/profile/leaderboard",
        {},
        LeaderboardResponseSchema,
      );
      setEntries(response.entries);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => void refresh(), [refresh]));

  return (
    <Screen contentWidth="reading">
      <Text style={[styles.title, { color: theme.text }]}>
        {t("leaderboard")}
      </Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>
        {t("leaderboardSubtitle")}
      </Text>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.secondary} />
          <Text style={{ color: theme.textMuted }}>{t("loading")}</Text>
        </View>
      ) : error ? (
        <Surface tone="error">
          <Text style={[styles.message, { color: theme.error }]}>
            {t("leaderboardLoadFailed")}
          </Text>
        </Surface>
      ) : (
        <View style={styles.list}>
          {entries.map((entry) => (
            <Surface
              key={`${entry.rank}-${entry.name}`}
              padded={false}
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: "/profile/[userId]",
                  params: { userId: entry.userId },
                })
              }
            >
              <Text style={[styles.rank, { color: theme.primary }]}>
                {entry.rank}
              </Text>
              <View style={styles.identity}>
                <ProfileAvatar
                  name={entry.name}
                  image={
                    entry.image ??
                    `https://github.com/identicons/${encodeURIComponent(entry.userId)}.png`
                  }
                  size={40}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.name, { color: theme.text }]}
                >
                  {entry.name}
                </Text>
              </View>
              <Text style={[styles.score, { color: theme.text }]}>
                {entry.completedQuizzes}
              </Text>
            </Surface>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: typography.display,
    fontSize: typography.size.display,
    lineHeight: typography.lineHeight.display,
  },
  subtitle: {
    marginTop: spacing[2],
    marginBottom: spacing[7],
    fontFamily: typography.body,
    fontSize: typography.size.body,
  },
  loading: { alignItems: "center", gap: spacing[3], padding: spacing[10] },
  message: { fontFamily: typography.bodyBold },
  list: { gap: spacing[3] },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing[4],
    borderRadius: radii.large,
  },
  rank: {
    width: 38,
    fontFamily: typography.display,
    fontSize: typography.size.title,
    textAlign: "center",
  },
  identity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  name: {
    flex: 1,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
  },
  score: {
    minWidth: 48,
    fontFamily: typography.display,
    fontSize: typography.size.title,
    textAlign: "right",
  },
});
