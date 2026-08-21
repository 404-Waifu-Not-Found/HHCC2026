import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#247D49" />
        <script src="/theme-preflight.js" />
        <style>{`
          html, body { background: #F7F9F4; }
          html[data-cq-theme="dark"], html[data-cq-theme="dark"] body { background: #101B15; }
          #clipquest-screen-floating { right: 20px; }
          @media (min-width: 768px) {
            #clipquest-screen-floating { right: 24px; }
          }
          @media (min-width: 1024px) {
            #clipquest-screen-floating { right: 32px; }
          }
          @media (prefers-color-scheme: dark) {
            html:not([data-cq-theme]), html:not([data-cq-theme]) body { background: #101B15; }
          }
        `}</style>
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <title>ClipQuest — Paste a YouTube video, build mastery</title>
        <meta
          name="description"
          content="Turn public YouTube learning videos into evidence-backed adaptive quizzes."
        />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
