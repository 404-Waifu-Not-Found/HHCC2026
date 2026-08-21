export const WEB_TRANSCRIPTION_MAX_SECONDS = 20 * 60;

export function canTranscribeInBrowser(durationSeconds: number): boolean {
  return durationSeconds <= WEB_TRANSCRIPTION_MAX_SECONDS;
}
