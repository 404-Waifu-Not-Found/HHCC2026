import type { LibraryCard } from "@clipquest/contracts";
import { VoxelIcon } from "./VoxelIcon";
import {
  Alert,
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
}: {
  card: LibraryCard;
  onPress(): void;
  compact?: boolean;
  fill?: boolean;
  onExport?(): void | Promise<void>;
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
      <View style={[styles.actionRow, { borderTopColor: theme.divider }]}>
        <Text style={[styles.action, { color: theme.primary }]}>
          {actionLabel}
        </Text>
        <VoxelIcon name="next" size={20} color={theme.primary} />
        {card.cheatSheet.status === "none" ? (
          <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${t("notesNotReady")}. Complete a quiz to enable notes export.`}
            accessibilityHint="Complete a quiz to enable notes export."
            style={styles.exportStatus}
          >
            <Text style={[styles.exportText, { color: theme.textMuted }]}>
              {t("notesNotReady")}
            </Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              card.cheatSheet.status === "ready"
                ? t("exportNotes")
                : t("retryNotes")
            }
            accessibilityState={{ disabled: !onExport }}
            onPress={() => {
              if (!onExport) return;
              void Promise.resolve(onExport()).catch((cause) => {
                Alert.alert(
                  t("exportNotes"),
                  cause instanceof Error
                    ? cause.message
                    : "The cheat sheet could not be exported.",
                );
              });
            }}
            style={({ pressed }) => [
              styles.exportButton,
              {
                borderColor: theme.borderStrong,
                opacity: !onExport ? 0.45 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.exportText, { color: theme.textMuted }]}>
              {card.cheatSheet.status === "ready"
                ? t("exportNotes")
                : t("retryNotes")}
            </Text>
          </Pressable>
        )}
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
  actionRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing[2],
    borderTopWidth: borders.hairline,
    paddingTop: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
  },
  action: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
  },
  exportButton: {
    minHeight: 34,
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
  },
  exportText: {
    fontFamily: typography.bodyBold,
    fontSize: 11,
  },
  exportStatus: {
    paddingHorizontal: spacing[2],
  },
});
