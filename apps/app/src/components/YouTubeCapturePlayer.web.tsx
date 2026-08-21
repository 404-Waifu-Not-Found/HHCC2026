import { useEffect, useRef } from "react";

type Player = { destroy(): void };
type YouTubeWindow = Window & {
  YT?: {
    Player: new (
      element: HTMLElement,
      options: {
        videoId: string;
        host?: string;
        playerVars: Record<string, number>;
        events: {
          onStateChange(event: { data: number }): void;
          onError(event: { data: number }): void;
        };
      },
    ) => Player;
    PlayerState: { ENDED: number };
  };
  onYouTubeIframeAPIReady?: () => void;
};

export function YouTubeCapturePlayer({
  videoId,
  onEnded,
  onEmbeddingBlocked,
}: {
  videoId: string;
  onEnded: () => void;
  onEmbeddingBlocked?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const endedRef = useRef(onEnded);
  const blockedRef = useRef(onEmbeddingBlocked);
  endedRef.current = onEnded;
  blockedRef.current = onEmbeddingBlocked;

  useEffect(() => {
    const target = window as YouTubeWindow;
    let player: Player | undefined;
    let disposed = false;
    const createPlayer = () => {
      if (disposed || !containerRef.current || !target.YT?.Player) return;
      player = new target.YT.Player(containerRef.current, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0 },
        events: {
          onStateChange(event) {
            if (event.data === target.YT?.PlayerState.ENDED) endedRef.current();
          },
          onError(event) {
            if (event.data === 101 || event.data === 150)
              blockedRef.current?.();
          },
        },
      });
    };
    if (target.YT?.Player) createPlayer();
    else {
      const previous = target.onYouTubeIframeAPIReady;
      target.onYouTubeIframeAPIReady = () => {
        previous?.();
        createPlayer();
      };
      if (
        !document.querySelector(
          'script[src="https://www.youtube.com/iframe_api"]',
        )
      ) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(script);
      }
    }
    return () => {
      disposed = true;
      player?.destroy();
    };
  }, [videoId]);

  return (
    <div
      ref={containerRef}
      aria-label="YouTube capture player"
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
        borderRadius: 16,
        overflow: "hidden",
      }}
    />
  );
}
