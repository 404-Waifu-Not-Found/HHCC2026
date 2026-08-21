import { Redirect, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { BrandLockup } from "../src/components/BrandLockup";
import { authClient } from "../src/lib/auth-client";
import {
  parseQuickOpenRequest,
  type QuickOpenSearchParams,
} from "../src/lib/quick-open";
import { useSettings } from "../src/providers/SettingsProvider";
import { spacing } from "../src/theme/tokens";

export default function Index() {
  const { data, isPending } = authClient.useSession();
  const { t, theme } = useSettings();
  const params = useLocalSearchParams<QuickOpenSearchParams>();
  const quickOpen = parseQuickOpenRequest(params);
  if (isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <BrandLockup centered size="standard" />
        <ActivityIndicator
          accessibilityLabel={t("loading")}
          size="large"
          color={theme.primary}
        />
      </View>
    );
  }
  if (data) {
    return (
      <Redirect
        href={
          quickOpen ? { pathname: "/(tabs)", params: quickOpen } : "/(tabs)"
        }
      />
    );
  }
  return (
    <Redirect
      href={
        quickOpen
          ? { pathname: "/(auth)/sign-in", params: quickOpen }
          : "/(auth)/sign-in"
      }
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
  },
});
