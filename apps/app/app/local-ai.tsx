import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { AppTextInput } from "../src/components/AppTextInput";
import { IconButton } from "../src/components/IconButton";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { Screen } from "../src/components/Screen";
import { Surface } from "../src/components/Surface";
import {
  configureLocalGenerationCredential,
  detectLocalGenerationClient,
  removeLocalGenerationCredential,
} from "../src/generation/local-generation-client";
import { useAppSession } from "../src/lib/auth-client";
import { useSettings } from "../src/providers/SettingsProvider";
import { spacing, typography } from "../src/theme/tokens";

export default function LocalAiSettingsScreen() {
  const { data: session } = useAppSession();
  const { locale, theme } = useSettings();
  const isIos = Platform.OS === "ios";
  const copy = false
    ? {
        back: "返回",
        title: "本地 AI",
        subtitle: `测验生成由此 ${isIos ? "iPhone" : "Android"} 应用直接连接 DeepSeek 完成。`,
        configured: "已在此设备配置",
        missing: "尚未配置",
        key: "DeepSeek API 密钥",
        save: "保存并测试",
        remove: "移除密钥",
        saved: "DeepSeek 已为此 ClipQuest 帐户配置。",
        removed: "DeepSeek 密钥已从此设备移除。",
        saveFailed: "无法保存此密钥。",
        privacy: `密钥由 ${isIos ? "iOS 钥匙串" : "Android Keystore"} 加密，并仅供当前登录的 ClipQuest 帐户使用。密钥和字幕会由此设备直接发送到 DeepSeek，ClipQuest 服务器不会收到它们。`,
      }
    : {
        back: "Back",
        title: "Local AI",
        subtitle: `Quiz generation runs directly between this ${isIos ? "iPhone app" : "Android app"} and DeepSeek.`,
        configured: "Configured on this device",
        missing: "Not configured",
        key: "DeepSeek API key",
        save: "Save and test",
        remove: "Remove key",
        saved: "DeepSeek is configured for this ClipQuest account.",
        removed: "The DeepSeek key was removed from this device.",
        saveFailed: "The key could not be saved.",
        privacy: `The key is encrypted with ${isIos ? "iOS Keychain" : "Android Keystore"} and scoped to your signed-in ClipQuest account. Your key and captions are sent directly to DeepSeek; ClipQuest servers receive neither.`,
      };
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove">();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    void detectLocalGenerationClient().then((status) => {
      if (active) setConfigured(status.available && status.configured);
    });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    if (!session?.user.id || busy) return;
    setBusy("save");
    setMessage(undefined);
    try {
      await configureLocalGenerationCredential(session.user.id, apiKey);
      setApiKey("");
      setConfigured(true);
      setMessage(copy.saved);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : copy.saveFailed);
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async () => {
    if (!session?.user.id || busy) return;
    setBusy("remove");
    setMessage(undefined);
    try {
      await removeLocalGenerationCredential(session.user.id);
      setConfigured(false);
      setApiKey("");
      setMessage(copy.removed);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Screen contentWidth="auth">
      <View style={styles.header}>
        <IconButton
          icon="back"
          label={copy.back}
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(tabs)/settings" as never)
          }
        />
        <Text style={[styles.title, { color: theme.text }]}>{copy.title}</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          {copy.subtitle}
        </Text>
      </View>
      <Surface style={styles.card}>
        <Text style={[styles.status, { color: theme.text }]}>
          {configured ? copy.configured : copy.missing}
        </Text>
        <AppTextInput
          label={copy.key}
          value={apiKey}
          onChangeText={setApiKey}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          placeholder="sk-…"
          editable={!busy}
        />
        <PrimaryButton
          loading={busy === "save"}
          disabled={apiKey.trim().length < 10}
          onPress={() => void save()}
        >
          {copy.save}
        </PrimaryButton>
        {configured ? (
          <PrimaryButton
            variant="danger"
            loading={busy === "remove"}
            onPress={() => void remove()}
          >
            {copy.remove}
          </PrimaryButton>
        ) : null}
        {message ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.text }}>
            {message}
          </Text>
        ) : null}
        <Text style={[styles.privacy, { color: theme.textMuted }]}>
          {copy.privacy}
        </Text>
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing[3] },
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
  card: { gap: spacing[4], padding: spacing[5] },
  status: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.bodyLarge,
  },
  privacy: {
    fontFamily: typography.body,
    fontSize: typography.size.caption,
    lineHeight: 20,
  },
});
