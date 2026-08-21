import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bell,
  BrainCircuit,
  CalendarDays,
  Captions,
  ChartColumnIncreasing,
  ChevronsDown,
  ChevronsUp,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardCheck,
  Clock,
  Database,
  Download,
  GraduationCap,
  House,
  KeyRound,
  Languages,
  Library,
  Lightbulb,
  Link,
  ListChecks,
  LoaderCircle,
  LogIn,
  Mail,
  PanelLeft,
  Palette,
  PencilLine,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Send,
  ServerCog,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  SquareCheckBig,
  Target,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  Video,
  WifiOff,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react-native";
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

export const vectorIconRegistry = {
  add: Plus,
  appearance: Palette,
  audit: ClipboardCheck,
  back: ArrowLeft,
  calendar: CalendarDays,
  captions: Captions,
  "checkbox-checked": SquareCheckBig,
  "checkbox-unchecked": Square,
  checklist: ListChecks,
  close: X,
  collapse: ChevronsUp,
  correct: CircleCheck,
  database: Database,
  delete: Trash2,
  download: Download,
  error: CircleX,
  expand: ChevronsDown,
  help: CircleHelp,
  home: House,
  idea: Lightbulb,
  lessons: GraduationCap,
  library: Library,
  link: Link,
  mail: Mail,
  model: BrainCircuit,
  next: ArrowRight,
  notifications: Bell,
  offline: WifiOff,
  operations: Activity,
  password: KeyRound,
  people: Users,
  privacy: ShieldCheck,
  processing: LoaderCircle,
  progress: ChartColumnIncreasing,
  quote: Quote,
  rail: PanelLeft,
  refresh: RefreshCw,
  registration: UserPlus,
  rename: PencilLine,
  search: Search,
  selected: BadgeCheck,
  send: Send,
  settings: Settings,
  "sign-in": LogIn,
  system: ServerCog,
  target: Target,
  time: Clock,
  tool: Wrench,
  translation: Languages,
  video: Video,
  warning: TriangleAlert,
  workplace: Sparkles,
} as const satisfies Record<VoxelIconName, LucideIcon>;

export type VoxelIconProps = {
  name: VoxelIconName;
  size?: number;
  accessibleLabel?: string;
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
  color?: ColorValue;
};

export function VoxelIcon({
  name,
  size = 32,
  accessibleLabel,
  decorative = !accessibleLabel,
  style,
  color = "#247D49",
}: VoxelIconProps) {
  const Icon = vectorIconRegistry[name];
  return (
    <View
      pointerEvents="none"
      accessible={!decorative}
      accessibilityLabel={decorative ? undefined : accessibleLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? "no" : "auto"}
      style={[styles.icon, { width: size, height: size }, style]}
    >
      <Icon
        size={size}
        color={color as string}
        strokeWidth={2}
        absoluteStrokeWidth
      />
    </View>
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
          <VoxelIcon name={icon} size={Math.max(20, size - 16)} />
        ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    alignItems: "center",
    justifyContent: "center",
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 12,
    backgroundColor: "transparent",
  },
});
