import type { AdminMeResponse } from "@clipquest/contracts";
import { VoxelIcon } from "../components/VoxelIcon";
import { Redirect, Slot, router, usePathname } from "expo-router";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type PropsWithChildren,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandLockup } from "../components/BrandLockup";
import { EmptyState } from "../components/EmptyState";
import { PrimaryButton } from "../components/PrimaryButton";
import { Screen } from "../components/Screen";
import { useAppSession } from "../lib/auth-client";
import { ClientApiError } from "../lib/api";
import { useSettings } from "../providers/SettingsProvider";
import {
  borders,
  breakpoints,
  layout,
  motion,
  radii,
  safeArea,
  spacing,
  typography,
} from "../theme/tokens";
import { getAdminMe } from "./api";
import { useAdminCopy } from "./copy";

const AdminContext = createContext<AdminMeResponse | null>(null);

const navigation = [
  { href: "/admin", label: "overview", icon: "operations" },
  { href: "/admin/users", label: "users", icon: "people" },
  { href: "/admin/jobs", label: "jobs", icon: "processing" },
  {
    href: "/admin/lessons",
    label: "lessons",
    icon: "lessons",
  },
  {
    href: "/admin/audit",
    label: "audit",
    icon: "audit",
  },
  { href: "/admin/system", label: "system", icon: "system" },
] as const;

export function useAdminSession(): AdminMeResponse {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdminSession must be used inside AdminShell");
  return value;
}

export function AdminShell() {
  const { data: session, isPending } = useAppSession();
  const [me, setMe] = useState<AdminMeResponse>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const copy = useAdminCopy();

  useEffect(() => {
    if (!session) return;
    let current = true;
    void getAdminMe()
      .then((next) => {
        if (current) setMe(next);
      })
      .catch((cause: unknown) => {
        if (current)
          setError(cause instanceof Error ? cause : new Error(copy.loadFailed));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [copy.loadFailed, session]);

  if (isPending) return <AdminLoading />;
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  if (loading) return <AdminLoading />;
  if (!me || error) {
    const denied = error instanceof ClientApiError && error.status === 403;
    return (
      <Screen contentWidth="reading" centered>
        <EmptyState
          icon={denied ? "privacy" : "warning"}
          title={denied ? copy.accessDenied : copy.loadFailed}
          description={
            denied ? copy.accessDeniedBody : (error?.message ?? copy.loadFailed)
          }
          action={
            <PrimaryButton
              variant="secondary"
              onPress={() => router.replace("/(tabs)")}
            >
              {copy.returnToApp}
            </PrimaryButton>
          }
        />
      </Screen>
    );
  }

  return (
    <AdminContext.Provider value={me}>
      <AdminFrame me={me}>
        <Slot />
      </AdminFrame>
    </AdminContext.Provider>
  );
}

function AdminLoading() {
  const { theme } = useSettings();
  const copy = useAdminCopy();
  return (
    <View
      style={[styles.loading, { backgroundColor: theme.background }]}
      accessibilityRole="progressbar"
    >
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={[styles.loadingText, { color: theme.textMuted }]}>
        {copy.loading}
      </Text>
    </View>
  );
}

function AdminFrame({
  children,
  me,
}: PropsWithChildren<{ me: AdminMeResponse }>) {
  const { theme } = useSettings();
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoints.desktop;
  return (
    <SafeAreaView
      edges={["top", "left", "right", "bottom"]}
      style={[
        styles.frame,
        !desktop && styles.frameMobile,
        { backgroundColor: theme.background },
      ]}
    >
      {desktop ? <AdminSidebar me={me} /> : <AdminMobileHeader me={me} />}
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

function AdminSidebar({ me }: { me: AdminMeResponse }) {
  const { theme } = useSettings();
  const copy = useAdminCopy();
  return (
    <View
      style={[
        styles.sidebar,
        { backgroundColor: theme.surface, borderRightColor: theme.divider },
      ]}
    >
      <BrandBlock />
      <View style={styles.sidebarNav} accessibilityRole="tablist">
        {navigation.map((item) => (
          <AdminNavItem key={item.href} {...item} />
        ))}
      </View>
      <View style={[styles.identity, { borderTopColor: theme.divider }]}>
        <View style={[styles.avatar, { backgroundColor: theme.primarySoft }]}>
          <Text style={[styles.avatarText, { color: theme.primary }]}>
            {initials(me.user.name)}
          </Text>
        </View>
        <View style={styles.identityCopy}>
          <Text
            numberOfLines={1}
            style={[styles.identityName, { color: theme.text }]}
          >
            {me.user.name}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.identityRole, { color: theme.textMuted }]}
          >
            {copy[me.user.role]}
          </Text>
        </View>
      </View>
      <PrimaryButton
        variant="ghost"
        compact
        onPress={() => router.replace("/(tabs)")}
      >
        {copy.returnToApp}
      </PrimaryButton>
    </View>
  );
}

function AdminMobileHeader({ me }: { me: AdminMeResponse }) {
  const { theme } = useSettings();
  const copy = useAdminCopy();
  return (
    <View
      style={[
        styles.mobileHeader,
        { backgroundColor: theme.surface, borderBottomColor: theme.divider },
      ]}
    >
      <View style={styles.mobileTopRow}>
        <BrandBlock compact />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.returnToApp}
          onPress={() => router.replace("/(tabs)")}
          style={({ pressed }) => [
            styles.exitButton,
            { backgroundColor: theme.surfaceSunken, borderColor: theme.border },
            pressed && styles.exitPressed,
          ]}
        >
          <VoxelIcon name="close" size={23} color={theme.text} />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.mobileNav}
      >
        {navigation.map((item) => (
          <AdminNavItem key={item.href} {...item} compact />
        ))}
      </ScrollView>
      <Text style={[styles.mobileRole, { color: theme.textMuted }]}>
        {me.user.name} · {copy[me.user.role]}
      </Text>
    </View>
  );
}

function BrandBlock({ compact = false }: { compact?: boolean }) {
  const copy = useAdminCopy();
  return (
    <View style={[styles.brand, compact && styles.brandCompact]}>
      <BrandLockup
        descriptor={copy.operations}
        size="compact"
        style={styles.brandLockup}
      />
    </View>
  );
}

function AdminNavItem({
  href,
  label,
  icon,
  compact = false,
}: {
  href: string;
  label: keyof ReturnType<typeof useAdminCopy>;
  icon: ComponentProps<typeof VoxelIcon>["name"];
  compact?: boolean;
}) {
  const pathname = usePathname();
  const { reduceMotion, theme } = useSettings();
  const copy = useAdminCopy();
  const selected =
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={() => router.push(href as never)}
      style={({ pressed, hovered }) => [
        compact ? styles.navItemCompact : styles.navItem,
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
          transitionProperty: "transform, background-color, border-color",
        },
      ]}
    >
      <VoxelIcon
        name={icon}
        size={compact ? 20 : 23}
        color={selected ? theme.primary : theme.textMuted}
      />
      <Text
        numberOfLines={1}
        style={[
          compact ? styles.navLabelCompact : styles.navLabel,
          { color: selected ? theme.primary : theme.textMuted },
        ]}
      >
        {copy[label]}
      </Text>
    </Pressable>
  );
}

function initials(value: string): string {
  return (
    value
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "CQ"
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, flexDirection: "row" },
  frameMobile: { flexDirection: "column" },
  content: { flex: 1, minWidth: 0 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
  },
  loadingText: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
  },
  sidebar: {
    width: layout.desktopSidebar + 24,
    borderRightWidth: borders.hairline,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    paddingBottom: safeArea.minimumBottom,
    gap: spacing[5],
  },
  brand: {
    paddingHorizontal: spacing[2],
  },
  brandCompact: { paddingHorizontal: 0 },
  brandLockup: { maxWidth: "100%" },
  sidebarNav: { flex: 1, gap: spacing[2] },
  navItem: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    borderWidth: borders.standard,
    borderRadius: radii.medium,
  },
  navItemCompact: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    borderWidth: borders.standard,
    borderRadius: radii.medium,
  },
  navLabel: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: 21,
  },
  navLabelCompact: {
    fontFamily: typography.bodyBold,
    fontSize: 13,
    lineHeight: 18,
  },
  identity: {
    borderTopWidth: borders.hairline,
    paddingTop: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
  },
  identityCopy: { minWidth: 0, flex: 1 },
  identityName: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: 18,
  },
  identityRole: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.caption,
    lineHeight: 16,
  },
  mobileHeader: {
    width: "100%",
    borderBottomWidth: borders.hairline,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
  },
  mobileTopRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  exitButton: {
    width: 44,
    height: 44,
    borderWidth: borders.standard,
    borderRadius: radii.medium,
    alignItems: "center",
    justifyContent: "center",
  },
  exitPressed: { transform: [{ translateY: 2 }] },
  mobileNav: { gap: spacing[2], paddingVertical: spacing[2] },
  mobileRole: {
    fontFamily: typography.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: spacing[1],
  },
});
