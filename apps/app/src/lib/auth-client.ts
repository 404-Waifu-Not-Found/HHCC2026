import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { inferAdditionalFields, usernameClient } from "better-auth/client/plugins";
import { Platform } from "react-native";
import { API_ORIGIN } from "./config";
import { usesNativeAuthCookies } from "./request-cookie";

const nativeCookiePlugin = expoClient({
  scheme: "clipquest",
  storagePrefix: "clipquest",
  storage: SecureStore,
}) as ReturnType<typeof expoClient> & BetterAuthClientPlugin;

export const authClient = createAuthClient({
  baseURL: API_ORIGIN,
  plugins: [
    usernameClient(),
    inferAdditionalFields({
      user: {
        ageConfirmed: {
          type: "boolean",
          required: true,
          input: true,
        },
      },
    }),
    // Browsers use their ordinary same-origin cookie jar. Registering the
    // Expo bridge on web makes it call native-only SecureStore sync methods.
    ...(usesNativeAuthCookies(Platform.OS) ? [nativeCookiePlugin] : []),
  ],
});

export type AppSession = {
  user: { id: string; name: string; email: string; emailVerified: boolean; image?: string | null };
  session: { id: string; userId: string; expiresAt: Date };
};

export function useAppSession(): {
  data: AppSession | null;
  isPending: boolean;
  error: Error | null;
} {
  // The Expo plugin's upstream BetterFetch generic narrows Better Auth's
  // session inference to `never`; its runtime session shape is unchanged.
  return authClient.useSession() as unknown as {
    data: AppSession | null;
    isPending: boolean;
    error: Error | null;
  };
}
