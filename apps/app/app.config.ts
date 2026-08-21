import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "ClipQuest",
  slug: "clipquest",
  version: "0.2.0",
  orientation: "portrait",
  scheme: "clipquest",
  userInterfaceStyle: "automatic",
  icon: "./assets/platform/app-icon-1024.png",
  web: {
    bundler: "metro",
    output: "static",
  },
  ios: {
    icon: "./assets/platform/app-icon-1024.png",
    supportsTablet: true,
    bundleIdentifier: "cc.ccwu.clipquest",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "cc.ccwu.clipquest",
    versionCode: 2,
    permissions: ["INTERNET", "VIBRATE", "POST_NOTIFICATIONS"],
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        category: ["BROWSABLE", "DEFAULT"],
        data: [
          {
            scheme: "https",
            host: "clipquest.ccwu.cc",
            pathPrefix: "/reset-password",
          },
          {
            scheme: "https",
            host: "clipquest.ccwu.cc",
            pathPrefix: "/verify-email",
          },
          {
            scheme: "https",
            host: "clipquest.ccwu.cc",
            pathPrefix: "/library",
          },
          {
            scheme: "https",
            host: "clipquest.ccwu.cc",
            pathPrefix: "/quiz",
          },
        ],
      },
    ],
    adaptiveIcon: {
      foregroundImage: "./assets/platform/adaptive-icon.png",
      backgroundColor: "#19683A",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 29,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          buildToolsVersion: "36.0.0",
        },
      },
    ],
    "./plugins/withAndroidShareIntent",
    [
      "expo-splash-screen",
      {
        image: "./assets/platform/splash-icon.png",
        imageWidth: 240,
        resizeMode: "contain",
        backgroundColor: "#F7F9F4",
        dark: {
          image: "./assets/platform/splash-icon.png",
          backgroundColor: "#101B15",
        },
      },
    ],
    [
      "expo-notifications",
      {
        defaultChannel: "study-reviews",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  updates: { enabled: false },
  extra: {
    apiOrigin:
      process.env.EXPO_PUBLIC_API_ORIGIN ?? "https://clipquest.ccwu.cc",
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    },
  },
};

export default config;
