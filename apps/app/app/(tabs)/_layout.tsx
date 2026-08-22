import {
  ProfileLearningStatsResponseSchema,
  type ProfileLearningStatsResponse,
} from "@clipquest/contracts";
import { VoxelIcon } from "../../src/components/VoxelIcon";
import { Redirect, Tabs } from "expo-router";
import { useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useAppSession } from "../../src/lib/auth-client";
import { BrandLockup } from "../../src/components/BrandLockup";
import { ProfileAvatar } from "../../src/components/ProfileAvatar";
import { apiRequest } from "../../src/lib/api";
import { useSettings } from "../../src/providers/SettingsProvider";
import { observePendingHandoffUser } from "../../src/state/pending-video-handoff";
import { workplaceEnabled } from "../../src/config/features";
import {
  borders,
  breakpoints,
  controls,
  layout,
  motion,
  radii,
  safeArea,
  spacing,
  typography,
} from "../../src/theme/tokens";
import {
  FeedbackMotion,
  MotionPressable,
  MotionView,
} from "../../src/motion/Motion";

type LearningTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

type SidebarUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

export default function TabLayout() {
  const { data, isPending } = useAppSession();
  const { reduceMotion, t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoints.desktop;

  useEffect(() => {
    if (data?.user.id) void observePendingHandoffUser(data.user.id);
  }, [data?.user.id]);

  if (isPending) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.secondary} />
      </View>
    );
  }

  if (!data) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Tabs
      tabBar={(props) => <LearningTabBar {...props} user={data.user} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: desktop ? "left" : "bottom",
        tabBarHideOnKeyboard: true,
        sceneStyle: { backgroundColor: theme.background },
        // Keep the native navigator mode stable. Changing this option while a
        // tab transition is active can leave the destination scene detached;
        // Screen/MotionView already owns the accessible route transition.
        animation: Platform.OS === "web" && !reduceMotion ? "fade" : "none",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("home"),
          tabBarIcon: ({ color, size }) => (
            <VoxelIcon name="home" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: t("library"),
          tabBarIcon: ({ color, size }) => (
            <VoxelIcon name="library" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="workplace"
        options={{
          href: workplaceEnabled ? undefined : null,
          title: t("workplace"),
          tabBarIcon: ({ color, size }) => (
            <VoxelIcon name="workplace" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("settings"),
          tabBarIcon: ({ color, size }) => (
            <VoxelIcon name="settings" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}

function LearningTabBar({
  state,
  descriptors,
  navigation,
  insets,
  user,
}: LearningTabBarProps & { user: SidebarUser }) {
  const { locale, t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoints.desktop;
  const [stats, setStats] = useState<ProfileLearningStatsResponse>();

  useEffect(() => {
    if (!desktop) return;
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
  }, [desktop, state.index, user.id]);

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.navigation,
        desktop ? styles.sidebar : styles.bottomBar,
        desktop
          ? {
              backgroundColor: theme.surface,
              borderRightColor: theme.divider,
              paddingTop:
                Math.max(insets.top, safeArea.minimumTop) + spacing[3],
              paddingBottom:
                Math.max(insets.bottom, safeArea.minimumBottom) + spacing[3],
            }
          : {
              backgroundColor: theme.surface,
              borderTopColor: theme.divider,
              paddingBottom: Math.max(insets.bottom, safeArea.minimumBottom),
            },
      ]}
    >
      {desktop ? <BrandLockup size="compact" style={styles.brand} /> : null}

      <View
        style={[
          styles.items,
          desktop ? styles.desktopItems : styles.mobileItems,
        ]}
      >
        {state.routes.map((route, index) => {
          if (route.name === "workplace" && !workplaceEnabled) return null;
          const descriptor = descriptors[route.key];
          if (!descriptor) return null;
          const { options } = descriptor;
          const selected = state.index === index;
          const label =
            typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : (options.title ?? route.name);
          const color = selected ? theme.primary : theme.textMuted;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });

            if (!selected && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: "tabLongPress", target: route.key });
          };

          return (
            <MotionPressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              accessibilityState={{ selected }}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({ hovered, pressed }) => [
                styles.item,
                desktop ? styles.desktopItem : styles.mobileItem,
                {
                  backgroundColor: selected
                    ? theme.primarySoft
                    : hovered
                      ? theme.surfaceSunken
                      : "transparent",
                  borderColor: selected ? theme.primary : "transparent",
                  opacity: pressed ? 0.76 : 1,
                },
                Platform.OS === "web" && {
                  transitionDuration: `${motion.fast}ms`,
                  transitionProperty:
                    "transform, background-color, border-color",
                },
              ]}
            >
              <FeedbackMotion
                signal={selected ? route.key : false}
                kind="attention"
              >
                <MotionView key={selected ? "selected" : "idle"} preset="pop">
                  {options.tabBarIcon?.({
                    focused: selected,
                    color,
                    size: desktop ? 27 : 24,
                  })}
                </MotionView>
              </FeedbackMotion>
              <Text
                numberOfLines={1}
                style={[
                  styles.itemLabel,
                  desktop ? styles.desktopLabel : styles.mobileLabel,
                  { color },
                ]}
              >
                {label}
              </Text>
            </MotionPressable>
          );
        })}
      </View>
      {desktop ? (
        <View style={[styles.profile, { borderTopColor: theme.divider }]}>
          <View style={styles.profileIdentity}>
            <ProfileAvatar name={user.name} image={user.image} size={44} />
            <View style={styles.profileCopy}>
              <Text
                numberOfLines={1}
                style={[styles.profileName, { color: theme.text }]}
              >
                {user.name}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.profileEmail, { color: theme.textMuted }]}
              >
                {user.email}
              </Text>
            </View>
          </View>
          <View style={styles.profileStats}>
            <View style={styles.profileStat}>
              <Text style={[styles.profileStatValue, { color: theme.text }]}>
                {stats?.completedLessons ?? "—"}
              </Text>
              <Text
                style={[styles.profileStatLabel, { color: theme.textMuted }]}
              >
                {t("completedLessons")}
              </Text>
            </View>
            <View
              style={[
                styles.profileStatDivider,
                { backgroundColor: theme.divider },
              ]}
            />
            <View style={styles.profileStat}>
              <Text style={[styles.profileStatValue, { color: theme.text }]}>
                {stats
                  ? formatLearningDuration(stats.totalDurationSeconds, locale)
                  : "—"}
              </Text>
              <Text
                style={[styles.profileStatLabel, { color: theme.textMuted }]}
              >
                {t("totalDuration")}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function formatLearningDuration(
  totalSeconds: number,
  locale: "en" | "zh-CN",
): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (locale === "zh-CN")
    return hours > 0 ? `${hours}小时 ${minutes}分钟` : `${minutes}分钟`;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  navigation: {
    flexShrink: 0,
  },
  sidebar: {
    width: layout.desktopSidebar,
    height: "100%",
    borderRightWidth: borders.hairline,
    paddingHorizontal: spacing[4],
  },
  bottomBar: {
    width: "100%",
    minHeight: controls.navigationHeight,
    // The tab bar already has a strong surface change from the content. A
    // full-width rule here reads like an accidental extra toolbar on phones.
    borderTopWidth: 0,
    paddingTop: spacing[1],
    paddingHorizontal: spacing[2],
  },
  brand: {
    minHeight: 58,
    paddingHorizontal: spacing[2],
    marginBottom: spacing[8],
  },
  items: {
    minWidth: 0,
  },
  desktopItems: {
    flex: 1,
    gap: spacing[2],
  },
  mobileItems: {
    minHeight: controls.navigationHeight - spacing[1],
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: spacing[1],
  },
  item: {
    minWidth: 0,
    borderWidth: borders.standard,
    borderRadius: radii.large,
  },
  desktopItem: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
  },
  mobileItem: {
    minHeight: 60,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    paddingHorizontal: spacing[1],
    paddingVertical: 3,
    borderWidth: 0,
    borderRadius: radii.medium,
  },
  itemLabel: {
    minWidth: 0,
    fontFamily: typography.bodyBold,
  },
  desktopLabel: {
    flex: 1,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  mobileLabel: {
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center",
  },
  profile: {
    flexShrink: 0,
    gap: spacing[4],
    borderTopWidth: borders.hairline,
    paddingHorizontal: spacing[2],
    paddingTop: spacing[5],
  },
  profileIdentity: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  profileCopy: {
    minWidth: 0,
    flex: 1,
  },
  profileName: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  profileEmail: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  profileStats: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "stretch",
  },
  profileStat: {
    minWidth: 0,
    flex: 1,
    justifyContent: "center",
  },
  profileStatDivider: {
    width: borders.hairline,
    marginHorizontal: spacing[3],
  },
  profileStatValue: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  profileStatLabel: {
    fontFamily: typography.body,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
});
