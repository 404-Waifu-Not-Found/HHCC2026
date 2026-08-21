import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import {
  Fredoka_600SemiBold,
  Fredoka_700Bold,
} from "@expo-google-fonts/fredoka";
import { useFonts } from "expo-font";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Linking from "expo-linking";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  SettingsProvider,
  useSettings,
} from "../src/providers/SettingsProvider";
import { ExtensionInstallGate } from "../src/components/ExtensionInstallGate";
import { removeLocalGenerationCredential } from "../src/generation/local-generation-client";
import { clearNativeGenerationOutboxes } from "../src/generation/android-generation-outbox";
import { pauseAllProgressiveGenerationTasks } from "../src/generation/progressive-coordinator";
import { useAppSession } from "../src/lib/auth-client";
import { clearReviewReminderDeviceState } from "../src/notifications/review-reminders";
import { clearAccountCreationState } from "../src/state/creation";
import { nativeRouteForUrl } from "../src/navigation/native-deep-links";

const SITE_TITLE = "ClipQuest — Paste a YouTube video, build mastery";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    Fredoka_600SemiBold,
    Fredoka_700Bold,
  });

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") pauseAllProgressiveGenerationTasks();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let subscription: { remove(): void } | undefined;
    void import("expo-notifications").then((Notifications) => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      const openResponse = (
        response: import("expo-notifications").NotificationResponse,
      ) => {
        const route = response.notification.request.content.data?.route;
        if (route === "/library") router.push("/(tabs)/library" as never);
      };
      subscription =
        Notifications.addNotificationResponseReceivedListener(openResponse);
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) openResponse(response);
      });
    });
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const frame = requestAnimationFrame(() => {
      document.title = SITE_TITLE;
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!loaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <NativeAccountBoundary />
          <NativeDeepLinkBoundary />
          <RootNavigator />
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function NativeDeepLinkBoundary() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;
    let lastUrl: string | undefined;
    const open = (url: string) => {
      if (!active || url === lastUrl) return;
      const route = nativeRouteForUrl(url);
      if (!route) return;
      lastUrl = url;
      router.replace(route as never);
    };
    const subscription = Linking.addEventListener("url", ({ url }) =>
      open(url),
    );
    void Linking.getInitialURL().then((url) => {
      if (url) open(url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return null;
}

const OBSERVED_NATIVE_USER_KEY = "clipquest:native-local-ai-user:v1";

function NativeAccountBoundary() {
  const { data: session, isPending } = useAppSession();
  useEffect(() => {
    if (Platform.OS === "web" || isPending) return;
    void (async () => {
      const currentUserId = session?.user.id ?? null;
      const previousUserId = await AsyncStorage.getItem(
        OBSERVED_NATIVE_USER_KEY,
      );
      if (previousUserId && previousUserId !== currentUserId) {
        await Promise.allSettled([
          removeLocalGenerationCredential(previousUserId),
          clearReviewReminderDeviceState(previousUserId),
          clearNativeGenerationOutboxes(previousUserId),
          clearAccountCreationState(previousUserId),
        ]);
      }
      if (currentUserId) {
        await AsyncStorage.setItem(OBSERVED_NATIVE_USER_KEY, currentUserId);
      } else {
        await AsyncStorage.removeItem(OBSERVED_NATIVE_USER_KEY);
      }
    })();
  }, [isPending, session?.user.id]);
  return null;
}

function RootNavigator() {
  const { ready, reduceMotion, theme } = useSettings();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  return (
    <ExtensionInstallGate>
      <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          title: SITE_TITLE,
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
          // Native route animation is handled inside Screen. Keeping the
          // navigator option stable prevents a reduced-motion toggle from
          // detaching the active native scene.
          animation: Platform.OS === "web" && !reduceMotion ? "fade" : "none",
          animationDuration: Platform.OS === "web" && !reduceMotion ? 300 : 0,
        }}
      />
    </ExtensionInstallGate>
  );
}
