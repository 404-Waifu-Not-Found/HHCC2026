import type { LibraryCard } from "@clipquest/contracts";
import { VoxelIcon } from "./VoxelIcon";
import {
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
  onExport?(): void;
}) {
  const { t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const horizontal = !compact && width >= 720;
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
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}. ${t(masteryKeys[card.mastery])}. ${actionLabel}`}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.card,
        fill && styles.fill,
        horizontal && styles.horizontal,
        {
          backgroundColor: theme.surface,
          borderColor: hovered ? theme.primary : theme.border,
          borderBottomColor: hovered
            ? theme.primaryPressed
            : theme.borderStrong,
        },
        {
          borderBottomWidth: borders.tactileDepth + borders.standard,
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
        <MotionView
          preset="from-right"
          delay={120}
          style={[styles.actionRow, { borderTopColor: theme.divider }]}
        >
          <Text style={[styles.action, { color: theme.primary }]}>
            {actionLabel}
          </Text>
          <VoxelIcon name="next" size={20} color={theme.primary} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              card.cheatSheet.status === "ready"
                ? t("exportNotes")
                : card.cheatSheet.status === "failed"
                  ? t("retryNotes")
                  : t("preparingNotes")
            }
            disabled={!onExport || card.cheatSheet.status === "none"}
            onPress={(event) => {
              event.stopPropagation();
              onExport?.();
            }}
            style={({ pressed }) => [
              styles.exportButton,
              {
                borderColor: theme.borderStrong,
                opacity:
                  !onExport || card.cheatSheet.status === "none"
                    ? 0.45
                    : pressed
                      ? 0.7
                      : 1,
              },
            ]}
          >
            <Text style={[styles.exportText, { color: theme.textMuted }]}>
              {card.cheatSheet.status === "ready"
                ? t("exportNotes")
                : card.cheatSheet.status === "failed"
                  ? t("retryNotes")
                  : t("preparingNotes")}
            </Text>
          </Pressable>
        </MotionView>
      </View>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 292,
    maxWidth: "100%",
    overflow: "hidden",
    borderWidth: borders.standard,
    borderRadius: radii.feature,
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
    justifyContent: "flex-end",
    gap: spacing[1],
    borderTopWidth: borders.hairline,
    paddingTop: spacing[3],
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
});
