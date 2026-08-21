export type BrowserCaptureResult = {
  language: string;
  segments: import("@clipquest/contracts").TranscriptSegment[];
  capturedThroughMs: number;
};

export type BrowserCaptureOptions = {
  videoId: string;
  durationSeconds: number;
  language: string | null;
  signal: AbortSignal;
  onPhase: (phase: "downloading_model" | "transcribing_device") => void;
  onProgress: (progress: number) => void;
  onStarted: (stop: () => void) => void;
};

export async function preloadBrowserSpeechModel(): Promise<void> {
  throw new Error("Browser tab capture is only available in a web browser.");
}

export async function getBrowserCaptureResumeMs(
  _videoId: string,
): Promise<number> {
  return 0;
}

export async function captureBrowserTabAudio(
  _options: BrowserCaptureOptions,
): Promise<BrowserCaptureResult> {
  throw new Error("Browser tab capture is only available in a web browser.");
}
