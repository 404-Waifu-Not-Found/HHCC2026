/**
 * ClipQuest's cross-platform visual system.
 *
 * Values are intentionally distinct from Duolingo's proprietary palette and
 * are shared by web, iOS, and Android. Components should consume semantic
 * theme roles instead of importing raw palette values wherever possible.
 */
export const palette = {
  ink: "#17234A",
  inkDeep: "#0B1430",
  indigo: "#4856D8",
  indigoDeep: "#3542B8",
  indigoSoft: "#E8EBFF",
  lime: "#B8F244",
  limeDepth: "#82B92C",
  limeSoft: "#EEFFD0",
  sky: "#43BCEB",
  skyDepth: "#228FBD",
  skySoft: "#DDF5FF",
  emerald: "#25B978",
  emeraldDepth: "#16835A",
  emeraldSoft: "#DDF8EC",
  coral: "#EF6262",
  coralDepth: "#C9444C",
  coralSoft: "#FFE5E5",
  amber: "#F5B73B",
  amberSoft: "#FFF4D6",
  mist: "#F6F8FC",
  white: "#FFFFFF",
  cloud: "#EEF1F7",
  line: "#D8DDEA",
  lineStrong: "#B7C0D7",
  slate: "#69748E",
  slateSoft: "#929CB2",
  midnight: "#080F25",
  midnightSurface: "#111A36",
  midnightRaised: "#182445",
  midnightLine: "#314066",
} as const;

export type ThemeMode = "light" | "dark" | "system";

export const lightTheme = {
  mode: "light" as const,
  background: palette.mist,
  backgroundAccent: "#F1F4FF",
  surface: palette.white,
  surfaceRaised: palette.white,
  surfaceSunken: palette.cloud,
  surfaceTint: palette.indigoSoft,
  elevated: palette.white,
  text: palette.ink,
  textMuted: palette.slate,
  textSubtle: palette.slateSoft,
  textOnPrimary: palette.white,
  textOnAction: palette.inkDeep,
  border: palette.line,
  borderStrong: palette.lineStrong,
  divider: "#E3E7F0",
  primary: palette.indigo,
  primaryPressed: palette.indigoDeep,
  primarySoft: palette.indigoSoft,
  action: palette.lime,
  actionPressed: palette.limeDepth,
  actionSoft: palette.limeSoft,
  secondary: palette.sky,
  secondaryPressed: palette.skyDepth,
  secondarySoft: palette.skySoft,
  success: palette.emerald,
  successPressed: palette.emeraldDepth,
  successSoft: palette.emeraldSoft,
  error: palette.coral,
  errorPressed: palette.coralDepth,
  errorSoft: palette.coralSoft,
  warning: palette.amber,
  warningSoft: palette.amberSoft,
  disabled: "#D8DDEA",
  disabledDepth: "#BEC5D6",
  focus: palette.indigo,
  overlay: "rgba(11, 20, 48, 0.58)",
};

export const darkTheme = {
  mode: "dark" as const,
  background: palette.midnight,
  backgroundAccent: "#0D1733",
  surface: palette.midnightSurface,
  surfaceRaised: palette.midnightRaised,
  surfaceSunken: "#0C1530",
  surfaceTint: "#222D63",
  elevated: palette.midnightRaised,
  text: "#F5F7FF",
  textMuted: "#B4BED6",
  textSubtle: "#8793B0",
  textOnPrimary: palette.white,
  textOnAction: palette.inkDeep,
  border: palette.midnightLine,
  borderStrong: "#4A5A82",
  divider: "#263656",
  primary: "#7A86FF",
  primaryPressed: "#5967DB",
  primarySoft: "#252F61",
  action: palette.lime,
  actionPressed: "#91C934",
  actionSoft: "#27371F",
  secondary: "#64CFF5",
  secondaryPressed: palette.skyDepth,
  secondarySoft: "#143B50",
  success: "#4BD69B",
  successPressed: palette.emeraldDepth,
  successSoft: "#153D31",
  error: "#FF7C7C",
  errorPressed: palette.coralDepth,
  errorSoft: "#4B232E",
  warning: "#FFC85A",
  warningSoft: "#493A1E",
  disabled: "#33405F",
  disabledDepth: "#25314D",
  focus: "#9EA7FF",
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
  small: 10,
  medium: 14,
  large: 16,
  feature: 22,
  modal: 26,
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
  subtle: "0 2px 8px rgba(23, 35, 74, 0.08)",
  floating: "0 10px 28px rgba(23, 35, 74, 0.14)",
  darkSubtle: "0 2px 8px rgba(0, 0, 0, 0.24)",
  darkFloating: "0 12px 30px rgba(0, 0, 0, 0.34)",
} as const;

