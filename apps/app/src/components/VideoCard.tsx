import type { LibraryCard } from "@clipquest/contracts";
import { VoxelIcon } from "./VoxelIcon";
import { Image } from "expo-image";
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

const masteryKeys = {
  not_started: "notStarted",
  learning: "learning",
  mastered: "mastered",
} as const;

export function VideoCard({
  card,
  onPress,
  compact = false,
}: {
  card: LibraryCard;
  onPress(): void;
  compact?: boolean;
}) {
  const { t, theme, reduceMotion } = useSettings();
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}. ${t(masteryKeys[card.mastery])}. ${actionLabel}`}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.card,
        horizontal && styles.horizontal,
        {
          backgroundColor: theme.surface,
          borderColor: hovered ? theme.primary : theme.border,
          borderBottomColor: hovered
            ? theme.primaryPressed
            : theme.borderStrong,
        },
        {
          borderBottomWidth: pressed
            ? borders.standard
            : borders.tactileDepth + borders.standard,
          transform: [
            {
              translateY: pressed
                ? borders.tactileDepth
                : hovered && !reduceMotion
                  ? -2
                  : 0,
            },
          ],
        },
        Platform.OS === "web" && {
          transitionDuration: `${motion.fast}ms`,
          transitionProperty: "transform, border-color",
          outlineColor: theme.focus,
        },
      ]}
    >
      <View style={[styles.media, horizontal && styles.mediaHorizontal]}>
        <Image
          source={{ uri: card.thumbnailUrl }}
          contentFit="cover"
          transition={reduceMotion ? 0 : 180}
          style={styles.image}
        />
        <View
          style={[
            styles.sourceBadge,
            { backgroundColor: "rgba(11,20,48,0.78)" },
          ]}
        >
          <VoxelIcon name="video" size={15} color="#FFFFFF" />
          <Text style={styles.source}>
            {card.source === "youtube" ? "YouTube" : "bilibili"}
          </Text>
        </View>
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
        <View style={[styles.actionRow, { borderTopColor: theme.divider }]}>
          <Text style={[styles.action, { color: theme.primary }]}>
            {actionLabel}
          </Text>
          <VoxelIcon name="next" size={20} color={theme.primary} />
        </View>
      </View>
    </Pressable>
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
    backgroundColor: "#DCE1ED",
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
});
