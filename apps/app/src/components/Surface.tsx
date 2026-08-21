import type { PropsWithChildren, ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, radii, shadows, spacing } from "../theme/tokens";

type SurfaceTone =
  "default" | "tinted" | "sunken" | "success" | "error" | "warning";

export function Surface({
  children,
  tone = "default",
  elevated = false,
  padded = true,
  style,
  footer,
}: PropsWithChildren<{
  tone?: SurfaceTone;
  elevated?: boolean;
  padded?: boolean;
  style?: ViewStyle | ViewStyle[];
  footer?: ReactNode;
}>) {
  const { theme } = useSettings();
  const backgroundColor =
    tone === "tinted"
      ? theme.surfaceTint
      : tone === "sunken"
        ? theme.surfaceSunken
        : tone === "success"
          ? theme.successSoft
          : tone === "error"
            ? theme.errorSoft
            : tone === "warning"
              ? theme.warningSoft
              : elevated
                ? theme.surfaceRaised
                : theme.surface;
  const borderColor =
    tone === "success"
      ? theme.success
      : tone === "error"
        ? theme.error
        : tone === "warning"
          ? theme.warning
          : theme.border;

  return (
    <View
      style={[
        styles.surface,
        padded && styles.padded,
        { backgroundColor, borderColor },
        elevated && Platform.OS === "web"
          ? {
              boxShadow:
                theme.mode === "dark" ? shadows.darkFloating : shadows.floating,
            }
          : null,
        elevated && Platform.OS !== "web"
          ? {
              shadowColor:
                theme.mode === "dark" ? "#000000" : theme.primaryPressed,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: theme.mode === "dark" ? 0.28 : 0.14,
              shadowRadius: 14,
              elevation: 6,
            }
          : null,
        style,
      ]}
    >
      {children}
      {footer ? (
        <View style={[styles.footer, { borderTopColor: theme.divider }]}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: "hidden",
    borderWidth: borders.standard,
    borderBottomWidth: borders.tactileDepth,
    borderRadius: radii.large,
  },
  padded: {
    padding: spacing[6],
  },
  footer: {
    marginHorizontal: -spacing[6],
    marginBottom: -spacing[6],
    marginTop: spacing[6],
    borderTopWidth: borders.hairline,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
  },
});
