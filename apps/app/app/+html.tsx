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
        <meta name="theme-color" content="#F6F8FC" />
        <script src="/theme-preflight.js" />
        <style>{`
          html, body { background: #F6F8FC; }
          html[data-cq-theme="dark"], html[data-cq-theme="dark"] body { background: #080F25; }
          @media (prefers-color-scheme: dark) {
            html:not([data-cq-theme]), html:not([data-cq-theme]) body { background: #080F25; }
          }
        `}</style>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/site.webmanifest" />
        <title>ClipQuest — Paste a video, build mastery</title>
        <meta
          name="description"
          content="Turn YouTube and bilibili learning videos into evidence-backed adaptive quizzes."
        />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
