import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { thumbnailRetryDelay, thumbnailUriForAttempt } from "../lib/thumbnail";
import { useSettings } from "../providers/SettingsProvider";
import { borders, motion, radii, spacing, typography } from "../theme/tokens";
import { LearningPrism } from "./LearningPrism";
import { MotionSkeleton } from "../motion/Motion";

type ThumbnailStatus = "loading" | "ready" | "error";

const absoluteFill = {
  position: "absolute" as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export function ReliableThumbnail({
  uri,
  accessibilityLabel,
  style,
  presentation = "card",
  recyclingKey,
  testID,
}: {
  uri: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  presentation?: "card" | "preview";
  recyclingKey?: string;
  testID?: string;
}) {
  return (
    <ThumbnailController
      key={uri}
      uri={uri}
      accessibilityLabel={accessibilityLabel}
      style={style}
      presentation={presentation}
      recyclingKey={recyclingKey}
      testID={testID}
    />
  );
}

function ThumbnailController({
  uri,
  accessibilityLabel,
  style,
  presentation,
  recyclingKey,
  testID,
}: {
  uri: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  presentation: "card" | "preview";
  recyclingKey?: string;
  testID?: string;
}) {
  const { t, theme, reduceMotion } = useSettings();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<ThumbnailStatus>("loading");
  const retryDelay = thumbnailRetryDelay(attempt);
  const retryUri = useMemo(
    () => thumbnailUriForAttempt(uri, attempt),
    [attempt, uri],
  );
  const terminalFailure = status === "error" && retryDelay === null;

  useEffect(() => {
    if (status !== "error" || retryDelay === null) return;
    const timer = setTimeout(() => {
      setAttempt((value) => value + 1);
      setStatus("loading");
    }, retryDelay);
    return () => clearTimeout(timer);
  }, [retryDelay, status]);

  const retry = () => {
    setAttempt((value) => value + 1);
    setStatus("loading");
  };

  return (
    <View
      testID={testID}
      style={[styles.frame, { backgroundColor: theme.surfaceSunken }, style]}
    >
      {status !== "ready" ? (
        <View
          testID={testID ? `${testID}-placeholder` : undefined}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.placeholder, { backgroundColor: theme.surfaceSunken }]}
        >
          <LearningPrism
            size={presentation === "preview" ? 74 : 52}
            variant="plain"
          />
          {presentation === "preview" && terminalFailure ? (
            <Text style={[styles.message, { color: theme.textMuted }]}>
              {t("thumbnailUnavailable")}
            </Text>
          ) : null}
        </View>
      ) : null}

      {status === "loading" || (status === "error" && retryDelay !== null) ? (
        <MotionSkeleton color={theme.primarySoft} style={styles.skeleton} />
      ) : null}

      <Image
        testID={testID ? `${testID}-image` : undefined}
        accessibilityLabel={accessibilityLabel}
        source={{ uri: retryUri }}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={`${recyclingKey ?? uri}:${attempt}`}
        transition={reduceMotion ? 0 : motion.fast}
        onDisplay={() => setStatus("ready")}
        onError={() => setStatus("error")}
        style={styles.image}
      />

      {presentation === "preview" && terminalFailure ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("retryThumbnail")}
          testID={testID ? `${testID}-retry` : undefined}
          onPress={retry}
          style={({ pressed }) => [
            styles.retry,
            {
              backgroundColor: theme.surface,
              borderColor: theme.borderStrong,
              opacity: pressed ? 0.84 : 1,
            },
          ]}
        >
          <Text style={[styles.retryText, { color: theme.primary }]}>
            {t("retry")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: "relative",
    overflow: "hidden",
  },
  image: {
    ...absoluteFill,
  },
  placeholder: {
    ...absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    padding: spacing[4],
  },
  skeleton: {
    ...absoluteFill,
  },
  message: {
    maxWidth: 240,
    textAlign: "center",
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  retry: {
    position: "absolute",
    right: spacing[4],
    bottom: spacing[4],
    minWidth: 72,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.medium,
    paddingHorizontal: spacing[4],
  },
  retryText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
