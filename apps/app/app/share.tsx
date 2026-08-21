import { identifyVideoSource } from "@clipquest/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Screen } from "../src/components/Screen";
import { useAppSession } from "../src/lib/auth-client";
import { useSettings } from "../src/providers/SettingsProvider";
import { createAndSavePendingVideoHandoff } from "../src/state/pending-video-handoff";
import { spacing, typography } from "../src/theme/tokens";

export default function AndroidShareHandoffScreen() {
  const params = useLocalSearchParams<{ url?: string | string[] }>();
  const { data: session, isPending } = useAppSession();
  const { locale, theme } = useSettings();
  const handled = useRef(false);

  useEffect(() => {
    if (isPending || handled.current) return;
    handled.current = true;
    const raw = Array.isArray(params.url) ? params.url[0] : params.url;
    const url = raw?.trim();
    void (async () => {
      if (!url || !identifyVideoSource(url)) {
        router.replace(session ? "/(tabs)" : "/(auth)/welcome");
        return;
      }
      await createAndSavePendingVideoHandoff({
        url,
        source: "quick_open",
        claimedUserId: session?.user.id,
      });
      router.replace(session ? "/(tabs)" : "/(auth)/welcome");
    })().catch(() => {
      router.replace(session ? "/(tabs)" : "/(auth)/welcome");
    });
  }, [isPending, params.url, session]);

  return (
    <Screen contentWidth="auth" centered>
      <View style={{ alignItems: "center", gap: spacing[4] }}>
        <ActivityIndicator color={theme.primary} />
        <Text
          style={{
            color: theme.text,
            fontFamily: typography.bodyMedium,
            fontSize: typography.size.body,
          }}
        >
          {locale === "zh-CN"
            ? "正在 ClipQuest 中打开此 YouTube 视频…"
            : "Opening this YouTube video in ClipQuest…"}
        </Text>
      </View>
    </Screen>
  );
}
