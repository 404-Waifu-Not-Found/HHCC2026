import {
  PublicProfileResponseSchema,
  type PublicProfileResponse,
} from "@clipquest/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { ProfileAvatar } from "../../src/components/ProfileAvatar";
import { IconButton } from "../../src/components/IconButton";
import { Screen } from "../../src/components/Screen";
import { Surface } from "../../src/components/Surface";
import { QuizContributionCalendar } from "../../src/components/QuizContributionCalendar";
import { apiRequest } from "../../src/lib/api";
import { useSettings } from "../../src/providers/SettingsProvider";
import { spacing, typography } from "../../src/theme/tokens";

export default function PublicProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { t, theme } = useSettings();
  const [profile, setProfile] = useState<PublicProfileResponse>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void apiRequest(
      `/api/profile/public/${encodeURIComponent(userId)}`,
      {},
      PublicProfileResponseSchema,
    )
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => {
        if (active) setProfile(undefined);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  if (loading) {
    return (
      <Screen scroll={false} centered>
        <ActivityIndicator color={theme.secondary} />
      </Screen>
    );
  }

  return (
    <Screen contentWidth="reading">
      <View style={styles.header}>
        <IconButton
          icon="back"
          label={t("back")}
          onPress={() => router.back()}
        />
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: theme.text }]}
        >
          {t("profile")}
        </Text>
      </View>
      {profile ? (
        <>
          <Surface elevated style={styles.identityCard}>
            <ProfileAvatar
              name={profile.name}
              image={profile.image}
              size={96}
            />
            <View style={styles.identityCopy}>
              <Text style={[styles.name, { color: theme.text }]}>
                {profile.name}
              </Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                {t("leaderboard")}
              </Text>
            </View>
          </Surface>
          <Surface style={styles.activity}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t("quizActivity")}
            </Text>
            <QuizContributionCalendar
              completions={profile.dailyQuizCompletions}
            />
          </Surface>
          <Surface style={styles.stats}>
            <ProfileStat
              label={t("completedLessons")}
              value={String(profile.completedQuizzes)}
            />
            <ProfileStat
              label={t("totalDuration")}
              value={formatLearningDuration(profile.totalDurationSeconds)}
            />
          </Surface>
        </>
      ) : (
        <Surface tone="error">
          <Text style={{ color: theme.error }}>
            {t("leaderboardLoadFailed")}
          </Text>
        </Surface>
      )}
    </Screen>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  const { theme } = useSettings();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

function formatLearningDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    marginBottom: spacing[6],
  },
  title: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[5],
    padding: spacing[6],
    marginBottom: spacing[5],
  },
  identityCopy: { minWidth: 0, flex: 1, gap: spacing[1] },
  name: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  subtitle: {
    fontFamily: typography.body,
    fontSize: typography.size.body,
  },
  stats: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: spacing[5],
    gap: spacing[5],
  },
  activity: {
    padding: spacing[5],
    marginBottom: spacing[5],
  },
  sectionTitle: {
    marginBottom: spacing[3],
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
  },
  stat: { flex: 1, alignItems: "center", gap: spacing[1] },
  statValue: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.title,
  },
  statLabel: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    textAlign: "center",
  },
});
