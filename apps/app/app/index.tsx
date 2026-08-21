import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { authClient } from "../src/lib/auth-client";
import { useSettings } from "../src/providers/SettingsProvider";

export default function Index() {
  const { data, isPending } = authClient.useSession();
  const { theme } = useSettings();
  if (isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.secondary} />
      </View>
    );
  }
  return <Redirect href={data ? "/(tabs)" : "/(auth)/welcome"} />;
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: "center", justifyContent: "center" } });

