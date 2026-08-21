export const GENERATION_POLL_TIMEOUT_MS = 15 * 60 * 1_000;

export function isGenerationPollExpired(startedAt: number, currentTime: number): boolean {
  return currentTime - startedAt >= GENERATION_POLL_TIMEOUT_MS;
}
