# ClipQuest

!Warning - This project havent been implenmented yet. NO CODE IS WRITTEN

ClipQuest turns public YouTube lessons into interactive quizzes, helping learners replace passive watching with active recall. Its Chrome extension or native app generates questions locally with the learner's DeepSeek API key, while the backend handles authentication and stores progress.

## Features

- Creates multiple-choice, true/false, and short-answer questions from captions.
- Streams the first question while remaining questions generate.
- Provides feedback, progress tracking, saved lessons, and review.
- Supports web, Android, and iOS through shared quiz contracts.
- Keeps credentials on the user's device.

## Requirements and dependencies

Install Node.js 22.13+, npm 10+, Chrome, and a DeepSeek API key. Core dependencies include TypeScript, React 19, React Native, Expo, Cloudflare Workers, Hono, D1, Better Auth, Zod, Vitest, and Playwright.

## Install and run

```bash
git clone https://github.com/404-Waifu-Not-Found/HHCC2026.git
cd ClipQuest
npm ci
cp .dev.vars.example apps/api/.dev.vars
npm run db:migrate:local
```

Start the API and web app in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

Build the Chrome extension with `npm run build -w @clipquest/extension`, then load `apps/extension/dist/clipquest-captions-extension` through Chrome's Extensions page in Developer mode. Add your DeepSeek key in the extension popup.

Run checks with `npm test`, `npm run typecheck`, `npm run lint`, and `npm run test:e2e`
