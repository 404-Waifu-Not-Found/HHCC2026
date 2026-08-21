export const THUMBNAIL_RETRY_DELAYS_MS = [400, 1_200, 3_000] as const;

const RETRY_PARAMETER = "cq_thumbnail_retry";

export function thumbnailUriForAttempt(
  thumbnailUri: string,
  attempt: number,
): string {
  if (!Number.isInteger(attempt) || attempt <= 0) return thumbnailUri;
  try {
    const retryUri = new URL(thumbnailUri);
    retryUri.searchParams.set(RETRY_PARAMETER, String(attempt));
    return retryUri.toString();
  } catch {
    const separator = thumbnailUri.includes("?") ? "&" : "?";
    return `${thumbnailUri}${separator}${RETRY_PARAMETER}=${attempt}`;
  }
}

export function thumbnailRetryDelay(attempt: number): number | null {
  return THUMBNAIL_RETRY_DELAYS_MS[attempt] ?? null;
}
