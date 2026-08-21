import { Image } from "expo-image";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { API_ORIGIN } from "../lib/config";
import { typography } from "../theme/tokens";
import { useSettings } from "../providers/SettingsProvider";
import { authClient } from "../lib/auth-client";

export function ProfileAvatar({
  name,
  image,
  size = 64,
}: {
  name: string;
  image?: string | null;
  size?: number;
}) {
  const { theme } = useSettings();
  const [cookie, setCookie] = useState<string>();
  useEffect(() => {
    if (Platform.OS === "web") return;
    const timer = setTimeout(() => setCookie(authClient.getCookie()), 0);
    return () => clearTimeout(timer);
  }, [image]);
  const uri = image
    ? image.startsWith("http")
      ? image
      : `${API_ORIGIN}/api/profile/avatar?v=${encodeURIComponent(image)}`
    : undefined;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name} profile picture`}
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 3,
          backgroundColor: theme.actionSoft,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri, ...(cookie ? { headers: { Cookie: cookie } } : {}) }}
          contentFit="cover"
          cachePolicy="memory-disk"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <Text
          style={[
            styles.text,
            { color: theme.text, fontSize: Math.max(16, size * 0.3) },
          ]}
        >
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : value.slice(0, 2)
  ).toUpperCase();
}

const styles = StyleSheet.create({
  avatar: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  text: { fontFamily: typography.displayMedium },
});
