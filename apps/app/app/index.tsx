import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Mascot } from "../src/components/Mascot";
import { authClient } from "../src/lib/auth-client";
import { useSettings } from "../src/providers/SettingsProvider";
import { spacing, typography } from "../src/theme/tokens";

export default function Index() {
  const { data, isPending } = authClient.useSession();
  const { t, theme } = useSettings();
  if (isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Mascot mood="thinking" size={104} />
        <Text style={[styles.brand, { color: theme.text }]}>
          {t("appName")}
        </Text>
        <ActivityIndicator
          accessibilityLabel={t("loading")}
          size="large"
          color={theme.primary}
        />
      </View>
    );
  }
  return <Redirect href={data ? "/(tabs)" : "/(auth)/welcome"} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
  },
  brand: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
});
