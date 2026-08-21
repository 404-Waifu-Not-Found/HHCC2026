export const palette = {
  lime: "#B8F244",
  limeDark: "#8CC72D",
  sky: "#54C8F5",
  skySoft: "#DDF5FF",
  navy: "#101C3B",
  navySoft: "#24365F",
  cream: "#F8F8EF",
  white: "#FFFFFF",
  inkMuted: "#65708A",
  line: "#DDE2E7",
  success: "#2DBE72",
  error: "#F25F5C",
  warning: "#FFB547",
} as const;

export type ThemeMode = "light" | "dark" | "system";

export const lightTheme = {
  mode: "light" as const,
  background: palette.cream,
  surface: palette.white,
  elevated: "#FFFFFF",
  text: palette.navy,
  textMuted: palette.inkMuted,
  border: palette.line,
  primary: palette.lime,
  primaryPressed: palette.limeDark,
  secondary: palette.sky,
  success: palette.success,
  error: palette.error,
  overlay: "rgba(16, 28, 59, 0.48)",
};

export const darkTheme = {
  mode: "dark" as const,
  background: "#081127",
  surface: "#111F3E",
  elevated: "#182A50",
  text: "#F7FAEE",
  textMuted: "#AAB7D2",
  border: "#304369",
  primary: palette.lime,
  primaryPressed: "#9AD336",
  secondary: palette.sky,
  success: "#4ED991",
  error: "#FF7975",
  overlay: "rgba(0, 0, 0, 0.65)",
};

export type AppTheme = typeof lightTheme | typeof darkTheme;

export const typography = {
  display: "Fredoka_700Bold",
  displayMedium: "Fredoka_600SemiBold",
  body: "DMSans_400Regular",
  bodyMedium: "DMSans_500Medium",
  bodyBold: "DMSans_700Bold",
} as const;

export const radii = {
  small: 12,
  medium: 18,
  large: 26,
  pill: 999,
} as const;

export const shadows = {
  card: {
    shadowColor: palette.navy,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
};

