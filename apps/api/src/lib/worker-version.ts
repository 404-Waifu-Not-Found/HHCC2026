import type { AppEnv } from "../types";

export type PublicWorkerVersion = {
  versionId: string;
  versionTag: string | null;
};

export function publicWorkerVersion(env: AppEnv): PublicWorkerVersion {
  const metadata = env.WORKER_VERSION;
  const versionId =
    metadata && typeof metadata.id === "string" && metadata.id.length > 0
      ? metadata.id.slice(0, 128)
      : "unknown";
  const versionTag =
    metadata && typeof metadata.tag === "string" && metadata.tag.length > 0
      ? metadata.tag.slice(0, 128)
      : null;
  return { versionId, versionTag };
}
