# ClipQuest

> **Planning status:** ClipQuest is currently a concept and implementation plan for HHCC 2026. The repository does not yet contain application code, a runnable prototype, or a released product. Every feature and technology below describes what our team plans to build.

## Project overview

ClipQuest will turn public YouTube lessons into interactive quizzes so learners can replace passive watching with active recall, immediate feedback, and visible progress. We chose this idea because students can finish an educational video feeling familiar with a topic while still struggling to explain or apply its key ideas. ClipQuest is planned as a quick bridge between watching and practicing.

## Planned learner experience

A learner will open a captioned YouTube lesson and launch ClipQuest from a Chrome extension. The extension will collect the lesson captions, identify important concepts, and ask an AI model to create grounded questions. The first complete, validated question should become available before the remaining questions finish generating. This will reduce waiting time without treating an unfinished quiz as complete.

The planned quiz will support multiple-choice, true/false, and short-answer questions. Learners will answer one question at a time, receive a clear explanation, see their progress, and complete the full attempt. Missing captions, generation failures, and invalid questions will produce understandable recovery options instead of blank screens.

## Planned architecture and dependencies

We plan to use a TypeScript monorepo with shared quiz contracts. React 19 will support the web interface, React Native with Expo will support Android and iOS, and a Chrome extension will provide the browser workflow. The learner's DeepSeek API key will remain in local device storage. Planned server responsibilities will be limited to authentication and learner-owned data such as saved lessons and progress.

The backend is expected to use Cloudflare Workers, Hono, D1, Better Auth, and Zod. Source-grounded prompting, schema validation, duplicate checks, and targeted retries will help improve quality. Vitest will cover shared logic, while Playwright and real-browser testing will check the complete journey.

## Team and planned contributions

- **UnoxyRich - team leader and integration:** scope, architecture, shared contracts, integration, documentation, and final demonstration.
- **JimmyfaQwQ - extension and AI workflow:** caption acquisition, local credential handling, prompting, generation, and recovery states.
- **ILikeLayla (Layla) - web and product design:** learner journey, accessible interface design, quiz interaction, and progress views.
- **Justin-Yonardo - mobile, backend, and quality:** Expo applications, authentication, persistence, automated testing, and cross-platform verification.

These responsibilities are planned workstreams and do not claim completed implementation. Shared reviews will keep every platform aligned with the same quiz rules.

## Development roadmap

Our first milestone will define the monorepo and shared schemas, then create one end-to-end Chrome flow for a public captioned lesson. The next milestones will add validation and retries, authentication and saved progress, web review tools, and native applications. Installation and running instructions will be added only after a reproducible implementation exists. Until then, there are no valid build commands for this repository.

Longer-term possibilities include multilingual quizzes, spaced-repetition review, teacher-curated sharing, accessibility personalization, caption-linked citations, and analytics that identify weak concepts.

## License

The planning materials in this repository are available under the [Apache License 2.0](LICENSE).
