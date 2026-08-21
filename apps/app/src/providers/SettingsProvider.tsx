import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { messages, type Locale, type MessageKey } from "../i18n/messages";
import { darkTheme, lightTheme, type AppTheme, type ThemeMode } from "../theme/tokens";

type SettingsContextValue = {
  locale: Locale;
  setLocale(locale: Locale): void;
  themeMode: ThemeMode;
  setThemeMode(mode: ThemeMode): void;
  theme: AppTheme;
  reduceMotion: boolean;
  setReduceMotion(value: boolean): void;
  t(key: MessageKey): string;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const SETTINGS_KEY = "clipquest:settings:v1";

export function SettingsProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [locale, setLocaleState] = useState<Locale>(() =>
    Localization.getLocales()[0]?.languageCode === "zh" ? "zh-CN" : "en",
  );
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [reduceMotion, setReduceMotionState] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(SETTINGS_KEY).then((stored) => {
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as Partial<{
          locale: Locale;
          themeMode: ThemeMode;
          reduceMotion: boolean;
        }>;
        if (parsed.locale === "en" || parsed.locale === "zh-CN") setLocaleState(parsed.locale);
        if (["light", "dark", "system"].includes(parsed.themeMode ?? "")) {
          setThemeModeState(parsed.themeMode ?? "system");
        }
        if (typeof parsed.reduceMotion === "boolean") setReduceMotionState(parsed.reduceMotion);
      } catch {
        // Ignore obsolete local settings.
      }
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (enabled) setReduceMotionState(true);
    });
  }, []);

  const persist = useCallback((next: { locale: Locale; themeMode: ThemeMode; reduceMotion: boolean }) => {
    void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }, []);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      persist({ locale: next, themeMode, reduceMotion });
    },
    [persist, reduceMotion, themeMode],
  );
  const setThemeMode = useCallback(
    (next: ThemeMode) => {
      setThemeModeState(next);
      persist({ locale, themeMode: next, reduceMotion });
    },
    [locale, persist, reduceMotion],
  );
  const setReduceMotion = useCallback(
    (next: boolean) => {
      setReduceMotionState(next);
      persist({ locale, themeMode, reduceMotion: next });
    },
    [locale, persist, themeMode],
  );

  const resolvedDark = themeMode === "dark" || (themeMode === "system" && systemScheme === "dark");
  const value = useMemo<SettingsContextValue>(
    () => ({
      locale,
      setLocale,
      themeMode,
      setThemeMode,
      theme: resolvedDark ? darkTheme : lightTheme,
      reduceMotion,
      setReduceMotion,
      t: (key) => messages[locale][key],
    }),
    [locale, reduceMotion, resolvedDark, setLocale, setReduceMotion, setThemeMode, themeMode],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}

