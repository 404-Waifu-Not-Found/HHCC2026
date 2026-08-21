import type { Locale } from "../i18n/messages";
import { breakpoints, type ThemeMode } from "../theme/tokens";

export const SETTINGS_KEY = "clipquest:settings:v1";

export type StoredSettings = {
  locale?: Locale;
  themeMode?: ThemeMode;
  reduceMotion?: boolean;
};

export type DeviceClass = "mobile" | "tablet" | "desktop";

export function parseStoredSettings(stored: string | null): StoredSettings {
  if (!stored) return {};
  try {
    const candidate = JSON.parse(stored) as Record<string, unknown>;
    return {
      ...(candidate.locale === "en" || candidate.locale === "zh-CN"
        ? { locale: candidate.locale }
        : {}),
      ...(candidate.themeMode === "light" ||
      candidate.themeMode === "dark" ||
      candidate.themeMode === "system"
        ? { themeMode: candidate.themeMode }
        : {}),
      ...(typeof candidate.reduceMotion === "boolean"
        ? { reduceMotion: candidate.reduceMotion }
        : {}),
    };
  } catch {
    return {};
  }
}

export function resolveThemeMode(
  mode: ThemeMode,
  systemDark: boolean,
): "light" | "dark" {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return systemDark ? "dark" : "light";
}

export function deviceClassForWidth(width: number): DeviceClass {
  if (width >= breakpoints.desktop) return "desktop";
  if (width >= breakpoints.tablet) return "tablet";
  return "mobile";
}
