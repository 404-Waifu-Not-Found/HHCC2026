import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "ClipQuest",
  slug: "clipquest",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "clipquest",
  userInterfaceStyle: "automatic",
  web: {
    bundler: "metro",
    output: "static",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "cc.ccwu.clipquest",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "cc.ccwu.clipquest",
    adaptiveIcon: {
      backgroundColor: "#B8F244",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
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
  extra: {
    apiOrigin: process.env.EXPO_PUBLIC_API_ORIGIN ?? "https://clipquest.ccwu.cc",
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "00000000-0000-0000-0000-000000000000",
    },
  },
};

export default config;
