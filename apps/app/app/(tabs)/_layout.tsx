import { VoxelIcon } from "../../src/components/VoxelIcon";
import { Redirect, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { authClient } from "../../src/lib/auth-client";
import { LearningPrism } from "../../src/components/LearningPrism";
import { useSettings } from "../../src/providers/SettingsProvider";
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

type LearningTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

export default function TabLayout() {
  const { data, isPending } = authClient.useSession();
  const { reduceMotion, t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoints.desktop;

  if (isPending) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.secondary} />
      </View>
    );
  }

  if (!data) return <Redirect href="/(auth)/welcome" />;

  return (
    <Tabs
      tabBar={(props) => <LearningTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: desktop ? "left" : "bottom",
        tabBarHideOnKeyboard: true,
        sceneStyle: { backgroundColor: theme.background },
        animation: reduceMotion ? "none" : "fade",
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
}: LearningTabBarProps) {
  const { reduceMotion, theme } = useSettings();
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoints.desktop;

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
      {desktop ? (
        <View
          style={styles.brand}
          accessible
          accessibilityRole="text"
          accessibilityLabel="ClipQuest"
        >
          <View
            style={[
              styles.brandMark,
              {
                backgroundColor: theme.primarySoft,
                borderColor: theme.primary,
              },
            ]}
          >
            <LearningPrism size={40} variant="tile" />
          </View>
          <Text style={[styles.brandName, { color: theme.text }]}>
            ClipQuest
          </Text>
        </View>
      ) : null}

      <View
        style={[
          styles.items,
          desktop ? styles.desktopItems : styles.mobileItems,
        ]}
      >
        {state.routes.map((route, index) => {
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
            <Pressable
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
                  transform: [{ translateY: pressed && !reduceMotion ? 2 : 0 }],
                },
                Platform.OS === "web" && {
                  transitionDuration: `${motion.fast}ms`,
                  transitionProperty:
                    "transform, background-color, border-color",
                },
              ]}
            >
              {options.tabBarIcon?.({
                focused: selected,
                color,
                size: desktop ? 27 : 25,
              })}
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
            </Pressable>
          );
        })}
      </View>
    </View>
  );
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
    borderTopWidth: borders.hairline,
    paddingTop: spacing[1],
    paddingHorizontal: spacing[2],
  },
  brand: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[2],
    marginBottom: spacing[8],
  },
  brandMark: {
    width: controls.iconTarget,
    height: controls.iconTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.medium,
  },
  brandName: {
    fontFamily: typography.display,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
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
    justifyContent: "space-around",
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
    minHeight: 54,
    maxWidth: 68,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: spacing[1],
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
    display: "none",
  },
});
