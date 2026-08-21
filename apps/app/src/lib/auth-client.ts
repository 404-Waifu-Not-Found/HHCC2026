import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { inferAdditionalFields, usernameClient } from "better-auth/client/plugins";
import { API_ORIGIN } from "./config";

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
    // Better Auth 1.6.25 exposes a valid Expo plugin at runtime, but its
    // BetterFetch generic is narrower than the public core plugin type.
    nativeCookiePlugin,
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
