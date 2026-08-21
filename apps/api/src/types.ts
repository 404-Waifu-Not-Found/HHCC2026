export type AppSecrets = {
  DEEPSEEK_API_KEY: string;
  RESEND_API_KEY: string;
  BETTER_AUTH_SECRET: string;
  YOUTUBE_CREDENTIALS_ENCRYPTION_KEY: string;
};

export type AppEnv = Omit<Env, "ENABLE_YOUTUBE_DEMO_HISTORY"> &
  AppSecrets & {
    ENABLE_YOUTUBE_DEMO_HISTORY: string;
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

export type GenerationQueueMessage = {
  jobId: string;
  userId: string;
  videoId: string;
};

export type MediaToken = {
  userId: string;
  videoId: string;
  expiresAt: number;
};
