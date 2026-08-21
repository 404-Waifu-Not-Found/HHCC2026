/**
 * ClipQuest's cross-platform visual system.
 *
 * Values are intentionally distinct from Duolingo's proprietary palette and
 * are shared by web, iOS, and Android. Components should consume semantic
 * theme roles instead of importing raw palette values wherever possible.
 */
export const palette = {
  ink: "#203329",
  inkDeep: "#14231A",
  structural: "#247D49",
  structuralDepth: "#19683A",
  structuralSoft: "#E9F7EC",
  action: "#54C878",
  actionDepth: "#2F9859",
  actionSoft: "#DCF5E5",
  blue: "#246FAE",
  blueDepth: "#195A91",
  blueSoft: "#E4F1FB",
  success: "#247D49",
  successDepth: "#19683A",
  successSoft: "#E1F4E6",
  error: "#C53A43",
  errorDepth: "#9D2D35",
  errorSoft: "#FFF1F2",
  warning: "#B57200",
  warningSoft: "#FFF1C7",
  canvas: "#F7F9F4",
  white: "#FFFFFF",
  sunken: "#EEF2EC",
  line: "#DCE4DD",
  lineStrong: "#BED0C2",
  slate: "#637368",
  slateSoft: "#7E8E83",
  midnight: "#101B15",
  midnightSurface: "#16231B",
  midnightRaised: "#1B2B21",
  midnightLine: "#2E4436",
} as const;

export type ThemeMode = "light" | "dark" | "system";

export const lightTheme = {
  mode: "light" as const,
  background: palette.canvas,
  backgroundAccent: "#F1F6F0",
  surface: palette.white,
  surfaceRaised: palette.white,
  surfaceSunken: palette.sunken,
  surfaceTint: palette.structuralSoft,
  elevated: palette.white,
  text: palette.ink,
  textMuted: palette.slate,
  textSubtle: palette.slateSoft,
  textOnPrimary: palette.white,
  textOnAction: palette.inkDeep,
  border: palette.line,
  borderStrong: palette.lineStrong,
  divider: "#E5EBE5",
  primary: palette.structural,
  primaryPressed: palette.structuralDepth,
  primarySoft: palette.structuralSoft,
  action: palette.action,
  actionPressed: palette.actionDepth,
  actionSoft: palette.actionSoft,
  secondary: palette.blue,
  secondaryPressed: palette.blueDepth,
  secondarySoft: palette.blueSoft,
  success: palette.success,
  successPressed: palette.successDepth,
  successSoft: palette.successSoft,
  error: palette.error,
  errorPressed: palette.errorDepth,
  errorSoft: palette.errorSoft,
  warning: palette.warning,
  warningText: "#815100",
  warningSoft: palette.warningSoft,
  disabled: "#D6DED7",
  disabledDepth: "#BAC8BD",
  focus: palette.blue,
  overlay: "rgba(16, 27, 21, 0.62)",
};

export const darkTheme = {
  mode: "dark" as const,
  background: palette.midnight,
  backgroundAccent: "#132019",
  surface: palette.midnightSurface,
  surfaceRaised: palette.midnightRaised,
  surfaceSunken: "#0D1711",
  surfaceTint: "#183D29",
  elevated: palette.midnightRaised,
  text: "#F0F6F1",
  textMuted: "#B5C4B9",
  textSubtle: "#8FA095",
  textOnPrimary: "#102218",
  textOnAction: palette.inkDeep,
  border: palette.midnightLine,
  borderStrong: "#43624E",
  divider: "#273B2E",
  primary: "#84D6A0",
  primaryPressed: "#54C878",
  primarySoft: "#183D29",
  action: "#62D687",
  actionPressed: "#2F9859",
  actionSoft: "#193C29",
  secondary: "#64B5E4",
  secondaryPressed: "#3A8FC1",
  secondarySoft: "#14354A",
  success: "#84D6A0",
  successPressed: "#54C878",
  successSoft: "#173C2B",
  error: "#FF8585",
  errorPressed: "#C95459",
  errorSoft: "#482427",
  warning: "#F3C85C",
  warningText: "#F3C85C",
  warningSoft: "#423516",
  disabled: "#34483A",
  disabledDepth: "#27382E",
  focus: "#91D8FF",
  overlay: "rgba(0, 0, 0, 0.72)",
};

export type AppTheme = typeof lightTheme | typeof darkTheme;

export const typography = {
  display: "Fredoka_700Bold",
  displayMedium: "Fredoka_600SemiBold",
  body: "DMSans_400Regular",
  bodyMedium: "DMSans_500Medium",
  bodyBold: "DMSans_700Bold",
  size: {
    caption: 12,
    label: 14,
    body: 16,
    bodyLarge: 18,
    titleSmall: 22,
    title: 28,
    displaySmall: 36,
    display: 46,
  },
  lineHeight: {
    caption: 16,
    label: 19,
    body: 24,
    bodyLarge: 27,
    titleSmall: 28,
    title: 34,
    displaySmall: 42,
    display: 51,
  },
  tracking: {
    tight: -1.1,
    normal: 0,
    wide: 0.5,
  },
} as const;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
} as const;

export const radii = {
  small: 12,
  medium: 16,
  large: 20,
  feature: 24,
  modal: 24,
  pill: 999,
} as const;

export const borders = {
  hairline: 1,
  standard: 2,
  selected: 3,
  tactileDepth: 4,
} as const;

export const controls = {
  iconTarget: 44,
  inputHeight: 56,
  urlInputHeight: 62,
  buttonHeight: 52,
  buttonHeightDesktop: 56,
  answerMinHeight: 68,
  navigationHeight: 68,
  progressHeight: 12,
} as const;

export const layout = {
  compactGutter: 20,
  gutter: 24,
  desktopGutter: 32,
  desktopSidebar: 248,
  content: 1080,
  reading: 704,
  lesson: 760,
  auth: 440,
  feedbackMinHeight: 164,
} as const;

export const breakpoints = {
  compact: 480,
  tablet: 768,
  desktop: 1024,
  wide: 1280,
} as const;

export const motion = {
  instant: 80,
  fast: 120,
  standard: 180,
  route: 260,
  celebration: 420,
} as const;

export const safeArea = {
  minimumTop: 12,
  minimumBottom: 12,
} as const;

export const shadows = {
  subtle: "0 2px 8px rgba(36, 125, 73, 0.08)",
  floating: "0 10px 28px rgba(25, 104, 58, 0.14)",
  darkSubtle: "0 2px 8px rgba(0, 0, 0, 0.24)",
  darkFloating: "0 12px 30px rgba(0, 0, 0, 0.34)",
} as const;
