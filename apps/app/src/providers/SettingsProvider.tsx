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
import { AccessibilityInfo, Platform, useColorScheme } from "react-native";
import { messages, type Locale, type MessageKey } from "../i18n/messages";
import {
  deviceClassForWidth,
  parseStoredSettings,
  resolveThemeMode,
  SETTINGS_KEY,
} from "../lib/settings";
import {
  darkTheme,
  lightTheme,
  type AppTheme,
  type ThemeMode,
} from "../theme/tokens";

type SettingsContextValue = {
  locale: Locale;
  setLocale(locale: Locale): void;
  themeMode: ThemeMode;
  setThemeMode(mode: ThemeMode): void;
  theme: AppTheme;
  reduceMotion: boolean;
  setReduceMotion(value: boolean): void;
  ready: boolean;
  t(key: MessageKey): string;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [locale, setLocaleState] = useState<Locale>(() =>
    Localization.getLocales()[0]?.languageCode === "zh" ? "zh-CN" : "en",
  );
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let revealFrame: number | undefined;
    void Promise.all([
      AsyncStorage.getItem(SETTINGS_KEY).catch(() => null),
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
    ]).then(([stored, systemReduceMotion]) => {
      if (cancelled) return;
      const parsed = parseStoredSettings(stored);
      if (parsed.locale) setLocaleState(parsed.locale);
      if (parsed.themeMode) setThemeModeState(parsed.themeMode);
      if (parsed.reduceMotion || systemReduceMotion) setReduceMotionState(true);

      const reveal = () => {
        if (!cancelled) setReady(true);
      };
      if (
        Platform.OS === "web" &&
        typeof requestAnimationFrame === "function"
      ) {
        revealFrame = requestAnimationFrame(reveal);
      } else {
        reveal();
      }
    });
    return () => {
      cancelled = true;
      if (
        revealFrame !== undefined &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(revealFrame);
      }
    };
  }, []);

  const persist = useCallback(
    (next: { locale: Locale; themeMode: ThemeMode; reduceMotion: boolean }) => {
      void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    },
    [],
  );

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

  const resolvedMode = resolveThemeMode(themeMode, systemScheme === "dark");
  const resolvedDark = resolvedMode === "dark";

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const root = document.documentElement;
    const applyDeviceClass = () => {
      root.dataset.cqDevice = deviceClassForWidth(window.innerWidth);
    };
    root.dataset.cqTheme = resolvedMode;
    root.style.colorScheme = resolvedMode;
    root.style.backgroundColor = resolvedDark
      ? darkTheme.background
      : lightTheme.background;
    document.body.style.backgroundColor = resolvedDark
      ? darkTheme.background
      : lightTheme.background;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        resolvedDark ? darkTheme.background : lightTheme.background,
      );
    applyDeviceClass();
    window.addEventListener("resize", applyDeviceClass);
    return () => window.removeEventListener("resize", applyDeviceClass);
  }, [resolvedDark, resolvedMode]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      locale,
      setLocale,
      themeMode,
      setThemeMode,
      theme: resolvedDark ? darkTheme : lightTheme,
      reduceMotion,
      setReduceMotion,
      ready,
      t: (key) => messages[locale][key],
    }),
    [
      locale,
      ready,
      reduceMotion,
      resolvedDark,
      setLocale,
      setReduceMotion,
      setThemeMode,
      themeMode,
    ],
  );
  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value)
    throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}
