# Contributing to ClipQuest

Thanks for helping improve ClipQuest.

## Before you start

1. Search existing issues and pull requests.
2. Open an issue for a substantial change so the approach can be discussed.
3. Never include credentials, API keys, private captions, transcripts, or learner data in commits or test artifacts.

## Development

Use Node.js 22+ and npm 10+:

```bash
npm ci
npm run typecheck -ws
npm test
```

Keep changes focused, follow existing TypeScript and React patterns, and update related documentation or tests when behavior changes.

## Pull requests

Describe the problem, the user-visible change, and the verification performed. Link related issues and call out migrations, deployment steps, or known limitations. Pull requests should pass the repository checks and receive review before merging.
