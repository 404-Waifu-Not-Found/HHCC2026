import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { admin } from "better-auth/plugins/admin";
import { adminAccessControl, betterAuthAdminRoles } from "./admin/access";
import { authSchema } from "./db/auth-schema";
import { hasConfirmedMinimumAge } from "./lib/age";
import { sendEmail } from "./lib/email";
import type { AppEnv } from "./types";

export function createAuth(env: AppEnv) {
  const database = drizzle(env.DB, { schema: authSchema });

  return betterAuth({
    appName: "ClipQuest",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [
      env.APP_ORIGIN,
      "http://localhost",
      "http://localhost:8081",
      "http://localhost:8787",
      "http://localhost:19006",
      "http://127.0.0.1:8081",
      "http://127.0.0.1",
      "clipquest://",
      "clipquest://*",
    ],
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
      deleteUser: {
        enabled: true,
        beforeDelete: async (authUser) =>
          deletePrivateUserObjects(env, authUser.id),
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (nextUser) => hasConfirmedMinimumAge(nextUser),
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: authUser, url }) => {
        await sendEmail(env, {
          to: authUser.email,
          subject: "Reset your ClipQuest password",
          heading: "Reset your password",
          message:
            "Use this link to choose a new ClipQuest password. The link expires soon.",
          actionLabel: "Reset password",
          actionUrl: url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user: authUser, url }) => {
        await sendEmail(env, {
          to: authUser.email,
          subject: "Verify your ClipQuest email",
          heading: "One tap to start learning",
          message:
            "Verify your email to finish creating your ClipQuest account.",
          actionLabel: "Verify email",
          actionUrl: url,
        });
      },
    },
    plugins: [
      expo(),
      admin({
        ac: adminAccessControl,
        roles: betterAuthAdminRoles,
        defaultRole: "user",
        adminRoles: ["admin", "owner"],
        bannedUserMessage: "This ClipQuest account is currently suspended.",
      }),
      username({
        minUsernameLength: 3,
        maxUsernameLength: 24,
        usernameNormalization: (value) => value.toLowerCase(),
        usernameValidator: (value) => /^[a-zA-Z0-9._]+$/.test(value),
      }),
    ],
  });
}

async function deletePrivateUserObjects(
  env: AppEnv,
  userId: string,
): Promise<void> {
  const thumbnails = await env.DB.prepare(
    "SELECT thumbnail_key FROM videos WHERE owner_id = ? AND thumbnail_key IS NOT NULL",
  )
    .bind(userId)
    .all<{ thumbnail_key: string }>();
  const keys = thumbnails.results.map((row) => row.thumbnail_key);
  let cursor: string | undefined;
  do {
    const page = await env.PRIVATE_BUCKET.list({
      prefix: `transcripts/${userId}/`,
      cursor,
    });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  for (let index = 0; index < keys.length; index += 1_000) {
    await env.PRIVATE_BUCKET.delete(keys.slice(index, index + 1_000));
  }
}

export type ClipQuestAuth = ReturnType<typeof createAuth>;
