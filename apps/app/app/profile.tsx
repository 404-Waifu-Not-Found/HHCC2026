import {
  ProfileLearningStatsResponseSchema,
  type ProfileLearningStatsResponse,
} from "@clipquest/contracts";
import { router, Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { ProfileAvatar } from "../src/components/ProfileAvatar";
import { IconButton } from "../src/components/IconButton";
import { Screen } from "../src/components/Screen";
import { Surface } from "../src/components/Surface";
import { useAppSession } from "../src/lib/auth-client";
import { apiRequest } from "../src/lib/api";
import { useSettings } from "../src/providers/SettingsProvider";
import { MotionView } from "../src/motion/Motion";
import { borders, spacing, typography } from "../src/theme/tokens";

export default function ProfileScreen() {
  const { data: session, isPending } = useAppSession();
  const { t, theme } = useSettings();
  const [stats, setStats] = useState<ProfileLearningStatsResponse>();

  useEffect(() => {
    if (!session?.user.id) return;
    let active = true;
    void apiRequest(
      "/api/profile/stats",
      {},
      ProfileLearningStatsResponseSchema,
    )
      .then((value) => {
        if (active) setStats(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [session?.user.id]);

  if (isPending) {
    return (
      <Screen scroll={false} centered>
        <ActivityIndicator color={theme.secondary} />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/(auth)/sign-in" />;

  const user = session.user;
  const displayName = user.name.trim() || user.email;
  const role =
    user.role === "owner"
      ? t("owner")
      : user.role === "admin"
        ? t("administrator")
        : t("learner");

  return (
    <Screen contentWidth="reading">
      <MotionView preset="from-left" style={styles.header}>
        <IconButton
          icon="back"
          label={t("back")}
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(tabs)/settings" as never)
          }
        />
        <View style={styles.headingCopy}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: theme.text }]}
          >
            {t("profile")}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            {t("profileSubtitle")}
          </Text>
        </View>
      </MotionView>

      <MotionView preset="rise" delay={44}>
        <Surface elevated style={styles.identityCard}>
          <ProfileAvatar name={displayName} image={user.image} size={112} />
          <View style={styles.identityCopy}>
            <Text style={[styles.name, { color: theme.text }]}>
              {displayName}
            </Text>
            <Text style={[styles.email, { color: theme.textMuted }]}>
              {user.email}
            </Text>
          </View>
        </Surface>
      </MotionView>

      <MotionView preset="rise" delay={88}>
        <Surface style={styles.section}>
          <Text
            accessibilityRole="header"
            style={[styles.sectionTitle, { color: theme.text }]}
          >
            {t("profileDetails")}
          </Text>
          <ProfileField label={t("username")} value={displayName} />
          <ProfileField label={t("email")} value={user.email} />
          <ProfileField
            label={t("emailStatus")}
            value={user.emailVerified ? t("verified") : t("unverified")}
          />
          <ProfileField label={t("accountRole")} value={role} last />
        </Surface>
      </MotionView>

      <MotionView preset="rise" delay={132}>
        <Surface style={styles.section}>
          <Text
            accessibilityRole="header"
            style={[styles.sectionTitle, { color: theme.text }]}
          >
            {t("account")}
          </Text>
          <View style={styles.stats}>
            <ProfileStat
              label={t("completedLessons")}
              value={stats ? String(stats.completedLessons) : "—"}
            />
            <View
              style={[styles.statDivider, { backgroundColor: theme.divider }]}
            />
            <ProfileStat
              label={t("totalDuration")}
              value={
                stats ? formatLearningDuration(stats.totalDurationSeconds) : "—"
              }
            />
          </View>
        </Surface>
      </MotionView>
    </Screen>
  );
}

function ProfileField({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  const { theme } = useSettings();
  return (
    <View
      style={[
        styles.field,
        !last && { borderBottomColor: theme.divider, borderBottomWidth: 1 },
      ]}
    >
      <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text style={[styles.fieldValue, { color: theme.text }]}>{value}</Text>
    </View>
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
    alignItems: "flex-start",
    gap: spacing[4],
    marginBottom: spacing[6],
  },
  headingCopy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  title: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  subtitle: {
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[5],
    padding: spacing[6],
    marginBottom: spacing[5],
  },
  identityCopy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  name: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  email: {
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  section: {
    padding: spacing[5],
    marginBottom: spacing[5],
  },
  sectionTitle: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
    marginBottom: spacing[3],
  },
  field: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[4],
    paddingVertical: spacing[3],
  },
  fieldLabel: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
  },
  fieldValue: {
    flexShrink: 1,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    textAlign: "right",
  },
  stats: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "stretch",
  },
  stat: {
    minWidth: 0,
    flex: 1,
    justifyContent: "center",
    gap: spacing[1],
  },
  statDivider: {
    width: borders.hairline,
    marginHorizontal: spacing[4],
  },
  statValue: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  statLabel: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
