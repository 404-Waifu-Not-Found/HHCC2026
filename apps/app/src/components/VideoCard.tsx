import type { LibraryCard } from "@clipquest/contracts";
import { VoxelIcon } from "./VoxelIcon";
import {
  Alert,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, motion, radii, spacing, typography } from "../theme/tokens";
import { MotionPressable, MotionView } from "../motion/Motion";
import { ReliableThumbnail } from "./ReliableThumbnail";

const masteryKeys = {
  not_started: "notStarted",
  learning: "learning",
  mastered: "mastered",
} as const;

export function VideoCard({
  card,
  onPress,
  compact = false,
  fill = false,
  onExport,
  onGenerateNotes,
  notesPending = false,
}: {
  card: LibraryCard;
  onPress(): void;
  compact?: boolean;
  fill?: boolean;
  onExport?(): void | Promise<void>;
  onGenerateNotes?(): void | Promise<void>;
  notesPending?: boolean;
}) {
  const { t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const horizontal = !compact && width >= 720;
  // Home's compact carousel should read as a deliberate single-card surface
  // on phones, not a desktop-width card with a distracting clipped sliver.
  // Library rows use `fill`, so their responsive list geometry stays intact.
  const compactCardWidth =
    compact && !fill && width < 720
      ? Math.min(360, Math.max(280, width - spacing[8]))
      : undefined;
  const actionLabel =
    card.action === "continue"
      ? t("continue")
      : card.action === "review"
        ? t("review")
        : t("start");
  const masteryColor =
    card.mastery === "mastered"
      ? theme.success
      : card.mastery === "learning"
        ? theme.primary
        : theme.textMuted;
  const notesStatus = notesPending ? "generating" : card.cheatSheet.status;
  const notesLabel =
    notesStatus === "ready"
      ? t("exportNotes")
      : notesStatus === "failed"
        ? t("retryNotes")
        : notesStatus === "generating"
          ? t("generatingNotes")
          : t("generateNotes");
  const notesIcon =
    notesStatus === "ready"
      ? "download"
      : notesStatus === "failed"
        ? "refresh"
        : "idea";
  const notesAction = notesStatus === "ready" ? onExport : onGenerateNotes;

  return (
    <View
      style={[
        styles.card,
        fill && styles.fill,
        compactCardWidth ? { width: compactCardWidth } : undefined,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderBottomColor: theme.borderStrong,
          position: "relative",
        },
      ]}
    >
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`${card.title}, ${t(masteryKeys[card.mastery])}, ${actionLabel}`}
        onPress={onPress}
        style={({ pressed, hovered }) => [
          styles.main,
          horizontal && styles.mainHorizontal,
          {
            borderColor: hovered ? theme.primary : "transparent",
            opacity: pressed ? 0.94 : 1,
          },
          Platform.OS === "web" && {
            transitionDuration: `${motion.fast}ms`,
            transitionProperty: "transform, border-color",
            outlineColor: theme.focus,
          },
        ]}
      >
        <View style={[styles.media, horizontal && styles.mediaHorizontal]}>
          <ReliableThumbnail
            uri={card.thumbnailUrl}
            accessibilityLabel={card.title}
            recyclingKey={card.videoId}
            testID={`video-card-thumbnail-${card.videoId}`}
            style={styles.image}
          />
          <MotionView
            preset="from-left"
            delay={80}
            style={[
              styles.sourceBadge,
              { backgroundColor: "rgba(11,20,48,0.78)" },
            ]}
          >
            <VoxelIcon name="video" size={15} color="#FFFFFF" />
            <Text style={styles.source}>YouTube</Text>
          </MotionView>
        </View>
        <View style={styles.body}>
          <Text numberOfLines={2} style={[styles.title, { color: theme.text }]}>
            {card.title}
          </Text>
          <View style={styles.meta}>
            <View
              style={[styles.badge, { backgroundColor: theme.surfaceSunken }]}
            >
              <View style={[styles.dot, { backgroundColor: masteryColor }]} />
              <Text style={[styles.badgeText, { color: theme.textMuted }]}>
                {t(masteryKeys[card.mastery])}
              </Text>
            </View>
            {card.bestScore !== null ? (
              <Text style={[styles.score, { color: masteryColor }]}>
                {Math.round(card.bestScore)}%
              </Text>
            ) : null}
          </View>
        </View>
      </MotionPressable>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={notesLabel}
          accessibilityState={{
            busy: notesPending,
            disabled: notesPending || !notesAction,
          }}
          onPress={() => {
            if (!notesAction || notesPending) return;
            void Promise.resolve(notesAction()).catch((cause) => {
              Alert.alert(
                notesLabel,
                cause instanceof Error
                  ? cause.message
                  : "The cheat sheet could not be prepared.",
              );
            });
          }}
          style={({ pressed }) => [
            styles.iconButton,
            {
              backgroundColor: theme.surfaceSunken,
              opacity: notesPending || !notesAction ? 0.45 : pressed ? 0.7 : 1,
            },
          ]}
        >
          {notesPending ? (
            <ActivityIndicator color={theme.secondary} size="small" />
          ) : (
            <VoxelIcon name={notesIcon} size={26} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onPress}
          style={({ pressed }) => [
            styles.iconButton,
            {
              backgroundColor: theme.surfaceSunken,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <VoxelIcon name="next" size={26} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 292,
    maxWidth: "100%",
    overflow: "hidden",
    borderWidth: borders.standard,
    borderBottomWidth: borders.tactileDepth + borders.standard,
    borderRadius: radii.feature,
  },
  main: {
    width: "100%",
    borderWidth: borders.hairline,
    borderRadius: radii.feature,
  },
  mainHorizontal: {
    flexDirection: "row",
  },
  fill: {
    width: "100%",
  },
  horizontal: {
    width: "100%",
    flexDirection: "row",
  },
  media: {
    position: "relative",
    width: "100%",
    aspectRatio: 16 / 9,
  },
  mediaHorizontal: {
    width: 250,
    aspectRatio: 16 / 10,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  sourceBadge: {
    position: "absolute",
    left: spacing[3],
    bottom: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radii.pill,
    paddingHorizontal: spacing[2],
    paddingVertical: 5,
  },
  source: {
    color: "#FFFFFF",
    fontFamily: typography.bodyBold,
    fontSize: 11,
  },
  body: {
    minWidth: 0,
    flex: 1,
    padding: spacing[4],
    paddingBottom: spacing[7],
    gap: spacing[3],
  },
  title: {
    minHeight: 48,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  meta: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badgeText: {
    fontFamily: typography.bodyBold,
    fontSize: 11,
  },
  score: {
    marginLeft: "auto",
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
  },
  actions: {
    position: "absolute",
    right: spacing[3],
    bottom: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
});
