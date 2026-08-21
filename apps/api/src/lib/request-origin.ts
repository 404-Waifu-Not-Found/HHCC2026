type OriginEnvironment = {
  APP_ORIGIN: string;
  BETTER_AUTH_URL: string;
};

const NATIVE_AUTH_ORIGINS = ["clipquest://", "clipquest://*"] as const;

const LOCAL_DEVELOPMENT_ORIGINS = [
  "http://localhost",
  "http://localhost:8081",
  "http://localhost:8787",
  "http://localhost:19006",
  "http://127.0.0.1",
  "http://127.0.0.1:8081",
  "http://127.0.0.1:8787",
] as const;

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function localDevelopmentEnabled(env: OriginEnvironment): boolean {
  return (
    isLoopbackOrigin(env.APP_ORIGIN) || isLoopbackOrigin(env.BETTER_AUTH_URL)
  );
}

export function authTrustedOrigins(env: OriginEnvironment): string[] {
  return [
    env.APP_ORIGIN,
    ...NATIVE_AUTH_ORIGINS,
    ...(localDevelopmentEnabled(env) ? LOCAL_DEVELOPMENT_ORIGINS : []),
  ];
}

export function isAllowedRequestOrigin(
  origin: string | undefined,
  env: OriginEnvironment,
): boolean {
  if (!origin) return true;
  if (origin === "clipquest://") return true;

  const configuredAppOrigin = normalizedOrigin(env.APP_ORIGIN);
  if (configuredAppOrigin && normalizedOrigin(origin) === configuredAppOrigin) {
    return true;
  }

  return (
    localDevelopmentEnabled(env) &&
    LOCAL_DEVELOPMENT_ORIGINS.includes(
      origin as (typeof LOCAL_DEVELOPMENT_ORIGINS)[number],
    )
  );
}
