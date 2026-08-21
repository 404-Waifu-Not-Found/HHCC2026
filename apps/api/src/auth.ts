import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { authSchema } from "./db/auth-schema";
import { sendEmail } from "./lib/email";
import type { AppEnv } from "./types";

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export function createAuth(env: AppEnv, executionCtx: WaitUntilContext) {
  const database = drizzle(env.DB, { schema: authSchema });

  return betterAuth({
    appName: "ClipQuest",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN, "clipquest://", "clipquest://*"],
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: authSchema,
    }),
    user: {
      additionalFields: {
        ageConfirmed: {
          type: "boolean",
          required: true,
          input: true,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: authUser, url }) => {
        executionCtx.waitUntil(
          sendEmail(env, {
            to: authUser.email,
            subject: "Reset your ClipQuest password",
            heading: "Reset your password",
            message: "Use this link to choose a new ClipQuest password. The link expires soon.",
            actionLabel: "Reset password",
            actionUrl: url,
          }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user: authUser, url }) => {
        executionCtx.waitUntil(
          sendEmail(env, {
            to: authUser.email,
            subject: "Verify your ClipQuest email",
            heading: "One tap to start learning",
            message: "Verify your email to finish creating your ClipQuest account.",
            actionLabel: "Verify email",
            actionUrl: url,
          }),
        );
      },
    },
    plugins: [
      expo(),
      username({
        minUsernameLength: 3,
        maxUsernameLength: 24,
        usernameNormalization: (value) => value.toLowerCase(),
        usernameValidator: (value) => /^[a-zA-Z0-9._]+$/.test(value),
      }),
    ],
  });
}

export type ClipQuestAuth = ReturnType<typeof createAuth>;
