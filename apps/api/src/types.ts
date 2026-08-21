export type AppSecrets = {
  DEEPSEEK_API_KEY: string;
  RESEND_API_KEY: string;
  BETTER_AUTH_SECRET: string;
  YOUTUBE_CREDENTIALS_ENCRYPTION_KEY: string;
};

export type AppEnv = Omit<
  Env,
  | "ENABLE_YOUTUBE_DEMO_HISTORY"
  | "QUIZ_V5_2_ROLLOUT"
  | "QUIZ_V5_2_CANARY_USER_IDS"
  | "QUIZ_V5_3_ROLLOUT"
  | "QUIZ_V5_3_CANARY_USER_IDS"
  | "QUIZ_V5_4_ROLLOUT"
  | "QUIZ_V5_4_CANARY_USER_IDS"
  | "QUIZ_V5_9_ROLLOUT"
  | "QUIZ_V5_9_CANARY_USER_IDS"
  | "QUIZ_V5_10_ROLLOUT"
  | "QUIZ_V5_10_CANARY_USER_IDS"
  | "QUIZ_V5_11_ROLLOUT"
  | "QUIZ_V5_11_CANARY_USER_IDS"
  | "QUIZ_V5_12_ROLLOUT"
  | "QUIZ_V5_12_CANARY_USER_IDS"
> &
  AppSecrets & {
    ENABLE_YOUTUBE_DEMO_HISTORY: string;
    QUIZ_V5_2_ROLLOUT?: string;
    QUIZ_V5_2_CANARY_USER_IDS?: string;
    QUIZ_V5_3_ROLLOUT?: string;
    QUIZ_V5_3_CANARY_USER_IDS?: string;
    QUIZ_V5_4_ROLLOUT?: string;
    QUIZ_V5_4_CANARY_USER_IDS?: string;
    QUIZ_V5_9_ROLLOUT?: string;
    QUIZ_V5_9_CANARY_USER_IDS?: string;
    QUIZ_V5_10_ROLLOUT?: string;
    QUIZ_V5_10_CANARY_USER_IDS?: string;
    QUIZ_V5_11_ROLLOUT?: string;
    QUIZ_V5_11_CANARY_USER_IDS?: string;
    QUIZ_V5_12_ROLLOUT?: string;
    QUIZ_V5_12_CANARY_USER_IDS?: string;
    ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINT?: string;
  };

import type { AdminRole } from "@clipquest/contracts";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  username?: string | null;
  role: AdminRole;
  banned: boolean;
};

export type MediaToken = {
  userId: string;
  videoId: string;
  expiresAt: number;
};
