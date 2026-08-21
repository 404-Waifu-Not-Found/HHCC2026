import { Image, type ImageStyle } from "expo-image";
import type { ReactNode } from "react";
import {
  StyleSheet,
  View,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { VoxelIconName } from "../theme/voxel-icons";

export type { VoxelIconName } from "../theme/voxel-icons";

export const voxelIconRegistry = {
  appearance: require("../../assets/icons/voxel/appearance.png"),
  audit: require("../../assets/icons/voxel/audit.png"),
  back: require("../../assets/icons/voxel/back.png"),
  calendar: require("../../assets/icons/voxel/calendar.png"),
  captions: require("../../assets/icons/voxel/captions.png"),
  checklist: require("../../assets/icons/voxel/checklist.png"),
  close: require("../../assets/icons/voxel/close.png"),
  collapse: require("../../assets/icons/voxel/collapse.png"),
  correct: require("../../assets/icons/voxel/correct.png"),
  database: require("../../assets/icons/voxel/database.png"),
  download: require("../../assets/icons/voxel/download.png"),
  error: require("../../assets/icons/voxel/error.png"),
  expand: require("../../assets/icons/voxel/expand.png"),
  help: require("../../assets/icons/voxel/help.png"),
  home: require("../../assets/icons/voxel/home.png"),
  idea: require("../../assets/icons/voxel/idea.png"),
  lessons: require("../../assets/icons/voxel/lessons.png"),
  library: require("../../assets/icons/voxel/library.png"),
  link: require("../../assets/icons/voxel/link.png"),
  mail: require("../../assets/icons/voxel/mail.png"),
  model: require("../../assets/icons/voxel/model.png"),
  next: require("../../assets/icons/voxel/next.png"),
  notifications: require("../../assets/icons/voxel/notifications.png"),
  operations: require("../../assets/icons/voxel/operations.png"),
  password: require("../../assets/icons/voxel/password.png"),
  people: require("../../assets/icons/voxel/people.png"),
  privacy: require("../../assets/icons/voxel/privacy.png"),
  processing: require("../../assets/icons/voxel/processing.png"),
  progress: require("../../assets/icons/voxel/progress.png"),
  refresh: require("../../assets/icons/voxel/refresh.png"),
  registration: require("../../assets/icons/voxel/registration.png"),
  search: require("../../assets/icons/voxel/search.png"),
  selected: require("../../assets/icons/voxel/selected.png"),
  settings: require("../../assets/icons/voxel/settings.png"),
  "sign-in": require("../../assets/icons/voxel/sign-in.png"),
  system: require("../../assets/icons/voxel/system.png"),
  target: require("../../assets/icons/voxel/target.png"),
  time: require("../../assets/icons/voxel/time.png"),
  translation: require("../../assets/icons/voxel/translation.png"),
  video: require("../../assets/icons/voxel/video.png"),
  warning: require("../../assets/icons/voxel/warning.png"),
} as const satisfies Record<VoxelIconName, number>;

export type VoxelIconProps = {
  name: VoxelIconName;
  size?: number;
  accessibleLabel?: string;
  decorative?: boolean;
  style?: StyleProp<ImageStyle>;
  /** Raster planes are intentionally never runtime-tinted. */
  color?: ColorValue;
};

export function VoxelIcon({
  name,
  size = 32,
  accessibleLabel,
  decorative = !accessibleLabel,
  style,
}: VoxelIconProps) {
  const renderedSize = Math.max(28, size);
  return (
    <Image
      source={voxelIconRegistry[name]}
      contentFit="contain"
      accessible={!decorative}
      accessibilityLabel={decorative ? undefined : accessibleLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? "no" : "auto"}
      style={[
        styles.icon,
        { width: renderedSize, height: renderedSize },
        style,
      ]}
    />
  );
}

export function VoxelIconTile({
  children,
  icon,
  size = 44,
  style,
}: {
  children?: ReactNode;
  icon?: VoxelIconProps["name"];
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.tile, { width: size, height: size }, style]}>
      {children ??
        (icon ? (
          <VoxelIcon name={icon} size={Math.max(28, size - 10)} />
        ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    backgroundColor: "#F4F4F4",
    borderRadius: 6,
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 12,
    backgroundColor: "#F4F4F4",
  },
});
