import {
  QuizShareClaimResponseSchema,
  QuizSharePreviewSchema,
  QuizStartResponseSchema,
  type QuizSharePreview,
} from "@clipquest/contracts";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { EmptyState } from "../../src/components/EmptyState";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { ReliableThumbnail } from "../../src/components/ReliableThumbnail";
import { Screen } from "../../src/components/Screen";
import { Surface } from "../../src/components/Surface";
import { VoxelIcon } from "../../src/components/VoxelIcon";
import { apiRequest, ClientApiError, jsonBody } from "../../src/lib/api";
import { useAppSession } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { saveAttemptStart } from "../../src/state/attempt";
import { borders, radii, spacing, typography } from "../../src/theme/tokens";
import { MotionView } from "../../src/motion/Motion";

type LoadStatus = "loading" | "ready" | "missing" | "failed";

export default function SharedQuestScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const shareToken = Array.isArray(params.token)
    ? params.token[0]
    : params.token;
  const { t, theme } = useSettings();
  const { data: session, isPending } = useAppSession();
  const [preview, setPreview] = useState<QuizSharePreview>();
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!shareToken) return;
    let active = true;
    apiRequest(
      `/api/shares/${encodeURIComponent(shareToken)}`,
      {},
      QuizSharePreviewSchema,
    )
      .then((value) => {
        if (!active) return;
        setPreview(value);
        setStatus("ready");
      })
      .catch((cause) => {
        if (!active) return;
        setStatus(
          cause instanceof ClientApiError && cause.status === 404
            ? "missing"
            : "failed",
        );
      });
    return () => {
      active = false;
    };
  }, [reloadKey, shareToken]);

  const effectiveStatus: LoadStatus = shareToken ? status : "missing";

  const start = useCallback(async () => {
    const userId = session?.user.id;
    if (!shareToken || !userId || starting) return;
    setStarting(true);
    setError(undefined);
    try {
      const claim = await apiRequest(
        `/api/shares/${encodeURIComponent(shareToken)}/claim`,
        { method: "POST" },
        QuizShareClaimResponseSchema,
      );
      const started = await apiRequest(
        `/api/quizzes/${claim.quizId}/start`,
        {
          method: "POST",
          headers: { "Idempotency-Key": Crypto.randomUUID() },
          body: jsonBody({ mode: "learn", ...claim.startSettings }),
        },
        QuizStartResponseSchema,
      );
      await saveAttemptStart(userId, started);
      router.replace({
        pathname: "/quiz/[attemptId]",
        params: { attemptId: started.attemptId },
      });
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 401) {
        // `replace`, not `push`: signing in returns here, and a pushed preview
        // would stay mounted beneath the fresh one.
        router.replace({
          pathname: "/(auth)/sign-in",
          params: { next: `/s/${shareToken}` },
        });
        return;
      }
      setError(cause instanceof Error ? cause.message : t("shareClaimFailed"));
    } finally {
      setStarting(false);
    }
  }, [session?.user.id, shareToken, starting, t]);

  if (effectiveStatus === "loading") {
    return (
      <Screen contentWidth="reading" centered>
        <ActivityIndicator
          accessibilityLabel={t("loading")}
          size="large"
          color={theme.primary}
        />
      </Screen>
    );
  }

  if (effectiveStatus === "failed") {
    return (
      <Screen contentWidth="reading" centered>
        <EmptyState
          icon="error"
          title={t("shareLoadFailed")}
          description={t("shareLoadFailedBody")}
          action={
            <PrimaryButton
              onPress={() => {
                setStatus("loading");
                setReloadKey((key) => key + 1);
              }}
            >
              {t("retry")}
            </PrimaryButton>
          }
        />
      </Screen>
    );
  }

  if (effectiveStatus === "missing") {
    return (
      <Screen contentWidth="reading" centered>
        <EmptyState
          icon="link"
          title={t("shareNotFoundTitle")}
          description={t("shareNotFoundBody")}
          action={
            <PrimaryButton
              leadingIcon={
                <VoxelIcon name="home" size={20} color={theme.textOnAction} />
              }
              onPress={() => router.replace("/")}
            >
              {t("home")}
            </PrimaryButton>
          }
        />
      </Screen>
    );
  }

  if (!preview) {
    return (
      <Screen contentWidth="reading" centered>
        <ActivityIndicator
          accessibilityLabel={t("loading")}
          size="large"
          color={theme.primary}
        />
      </Screen>
    );
  }

  const typeLabels = preview.questionTypes.map((type) =>
    type === "multiple_choice"
      ? t("multipleChoice")
      : type === "true_false"
        ? t("trueFalse")
        : t("shortAnswer"),
  );
  const languageLabel =
    preview.language === "zh-CN"
      ? t("languageChinese")
      : preview.language === "en"
        ? t("languageEnglish")
        : preview.language;
  const meta = [
    `${preview.questionCount} ${t("questions").toLowerCase()}`,
    ...typeLabels,
    languageLabel,
  ].join(" · ");

  return (
    <Screen contentWidth="reading" centered>
      <MotionView preset="rise" style={styles.wrap}>
        <Surface elevated padded={false} style={styles.card}>
          <ReliableThumbnail
            uri={preview.thumbnailUrl}
            accessibilityLabel={preview.title}
            presentation="preview"
            recyclingKey={preview.token}
            testID="share-preview-thumbnail"
            style={styles.thumbnail}
          />
          <View style={styles.body}>
            <Text style={[styles.eyebrow, { color: theme.primary }]}>
              {t("sharePreviewEyebrow")}
            </Text>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: theme.text }]}
            >
              {preview.title}
            </Text>
            {preview.sharedBy ? (
              <Text style={[styles.sharedBy, { color: theme.textMuted }]}>
                {`${t("sharedBy")} ${preview.sharedBy}`}
              </Text>
            ) : null}
            <Text
              testID="share-preview-meta"
              style={[styles.meta, { color: theme.textMuted }]}
            >
              {meta}
            </Text>
            {preview.concepts.length ? (
              <View style={styles.concepts}>
                <Text style={[styles.conceptsTitle, { color: theme.text }]}>
                  {t("shareConceptsTitle")}
                </Text>
                <View style={styles.chips}>
                  {preview.concepts.map((concept) => (
                    <View
                      key={concept}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: theme.primarySoft,
                          borderColor: theme.primary,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: theme.text }]}>
                        {concept}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            <View style={styles.actions}>
              {isPending ? (
                <ActivityIndicator
                  accessibilityLabel={t("loading")}
                  color={theme.primary}
                />
              ) : session ? (
                <PrimaryButton
                  testID="start-shared-quest"
                  loading={starting}
                  trailingIcon={
                    <VoxelIcon
                      name="next"
                      size={20}
                      color={theme.textOnAction}
                    />
                  }
                  onPress={() => void start()}
                >
                  {t("startSharedQuest")}
                </PrimaryButton>
              ) : (
                <>
                  <PrimaryButton
                    testID="sign-in-to-start"
                    leadingIcon={
                      <VoxelIcon
                        name="sign-in"
                        size={20}
                        color={theme.textOnAction}
                      />
                    }
                    onPress={() =>
                      router.replace({
                        pathname: "/(auth)/sign-in",
                        params: { next: `/s/${shareToken}` },
                      })
                    }
                  >
                    {t("signInToStart")}
                  </PrimaryButton>
                  <PrimaryButton
                    testID="sign-up-to-start"
                    variant="ghost"
                    onPress={() =>
                      router.replace({
                        pathname: "/(auth)/sign-up",
                        params: { next: `/s/${shareToken}` },
                      })
                    }
                  >
                    {t("signUp")}
                  </PrimaryButton>
                </>
              )}
              <PrimaryButton
                variant="ghost"
                leadingIcon={
                  <VoxelIcon name="video" size={20} color={theme.text} />
                }
                onPress={() => void Linking.openURL(preview.originalUrl)}
              >
                {t("watchLesson")}
              </PrimaryButton>
            </View>
            {error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: theme.error }]}
              >
                {error}
              </Text>
            ) : null}
          </View>
        </Surface>
      </MotionView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  card: { overflow: "hidden" },
  thumbnail: { width: "100%", aspectRatio: 16 / 9 },
  body: { padding: spacing[5], gap: spacing[3] },
  eyebrow: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
    letterSpacing: typography.tracking.wide,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  sharedBy: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  meta: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  concepts: { gap: spacing[2], marginTop: spacing[1] },
  conceptsTitle: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  chip: {
    borderWidth: borders.hairline,
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  chipText: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  actions: { gap: spacing[3], marginTop: spacing[2] },
  error: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
