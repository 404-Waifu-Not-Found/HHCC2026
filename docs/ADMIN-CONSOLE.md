# ClipQuest operations console

Status reviewed: 2026-08-11. This document describes the current extension-local operations surface. Release implementation and live acceptance are recorded in the [README release status](../README.md#release-status) and the [current production QA report](../qa-results/live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-11.md).

The private operations console lives at `/admin`. It uses ClipQuest's Expo application and visual system but remains isolated from learner navigation.

## Access model

| Role    | Access                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `user`  | No operations access                                                                                                                       |
| `admin` | Read overview, people, generation streams, lessons, audit, and system health; suspend or restore learner accounts; revoke learner sessions |
| `owner` | All administrator access plus role changes                                                                                                 |

Both `admin` and `owner` receive the existing `jobs:read` permission for Generation streams. The deprecated `jobs:manage` permission is not granted. Operators cannot start, retry, repair, cancel, or continue a learner's DeepSeek stream because generation lives in that learner's Chrome extension.

Roles come from the authenticated server session. The client never supplies or infers authorization, and every `/api/admin/*` endpoint checks the server-owned permission. Hiding a route or changing client state cannot grant access. Generic Better Auth admin endpoints remain blocked; privileged mutations must use ClipQuest's audited management API.

## Available views

- **Overview:** real user, lesson, active-generation, learner-action, and seven-day activity counts. Compatibility fields named `activeJobs` and `failedJobs` are derived from pipeline-9 generation summaries, not a Worker Queue.
- **People:** allowlisted account fields, role/status filters, reversible suspension, session revocation, and owner-only role changes.
- **Generation streams:** read-only pipeline-9 progress. It shows owner and YouTube identifiers, accepted/planned questions, requested types, state, primary calls, automatic retries/recoveries, **Legacy continuation-classified calls** when present, partial calls, bounded outcomes, token-usage completeness, first-question latency, timestamps, and stalled status.
- **Lessons:** read-only lesson ownership, question count, attempt count, source, language, and session summaries.
- **Audit log:** actor, action, target, reason, outcome, and timestamp for privileged mutations.
- **System:** extension-local architecture, Worker version metadata, applied D1 migration, rollout mode, model/protocol metadata, and generation-state counts. Worker quiz generation is labelled disabled by design; local extension generation is available and required.

Generation streams never expose prompts, questions, answers, rubrics, captions, transcript fragments, raw DeepSeek bodies, raw API errors, authorization headers, credentials, or a learner's API key. The broader console also excludes auth tokens, passwords, account credentials, R2 objects, impersonation, password/email changes, and hard account deletion.

## Generation states and telemetry

Current read-only state filters are:

- `generating`
- `retrying`
- `recovering`
- `cooldown`
- `retry_required` for older compatibility states that cannot yet be automatically reclaimed
- `action_required`
- `generation_failed`
- `ready`

For banks with rows in `quiz_generation_call_events`, call counts and timing come from those authoritative events. Planned small calls are `primary`; an extra model request caused by a failure is `automatic_retry`. A recovery that performs only server reconciliation is an automatic recovery, not a model retry. Distinct recovery-session IDs count automatic recoveries separately from DeepSeek requests.

Historical `manual_continuation` rows appear under **Legacy continuation-classified calls** and remain immutable. The label deliberately does not claim that the learner clicked anything: older automatic compatibility recovery could write that classification. Current protocol-5 compatibility recovery emits `purpose: automatic_recovery` and classifies each actual DeepSeek request from stored ordinal history; the API rejects a new manual event after allowing an exact idempotent replay of historical evidence.

For older banks without call events, the console falls back to bounded aggregates in the quality summary and labels that source as legacy telemetry. `lastQuestionAt` changes only when a question is accepted, `lastAttemptAt` comes from the latest safe call event, and state transitions use their own timestamp.

## Database migrations

The admin console began with:

- `0006_admin_console.sql`: roles, suspension fields, Better Auth session compatibility, indexes, and append-only `admin_audit_log`.
- `0007_admin_audit_retention.sql`: audit actors use `ON DELETE SET NULL`, preserving self-deletion while anonymizing a deleted operator.

Progressive-generation visibility additionally depends on:

- `0016_progressive_quiz_streaming.sql`: progressive bank state and ordered availability.
- `0017_quiz_generation_call_events.sql`: privacy-safe authoritative model-call events.
- `0018_automatic_generation_recovery.sql`: automatic retry metadata and short recovery claims.
- `0019_grounded_generation_telemetry.sql`: evidence-grounded generation telemetry.

Admin System reads the newest applied migration from Wrangler's `d1_migrations` ledger. It does not use a hard-coded filename. The production ledger was verified through `0019_grounded_generation_telemetry.sql` on 2026-08-11.

Verify a local database and the current source:

```bash
cd /Users/unoxyrich/Documents/GitHub/ClipQuest
npm run db:migrate:local
npm run typecheck
npm test
```

## First-owner bootstrap

There is intentionally no public path for creating an owner. Select one trusted, email-verified existing ClipQuest account and promote it by immutable user ID through D1 or Wrangler.

Local example:

```bash
cd /Users/unoxyrich/Documents/GitHub/ClipQuest/apps/api
npx wrangler d1 execute DB --local --command "SELECT id, email, role, banned FROM user ORDER BY created_at LIMIT 20"
npx wrangler d1 execute DB --local --command "UPDATE user SET role = 'owner', updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = '<trusted-user-id>' AND email_verified = 1"
```

For production, repeat the read first with `--remote`, resolve the exact immutable account ID, and update only that verified row. Never bootstrap by accepting a role from a client request.

## Production rollout

1. Inspect or back up the target D1 database.
2. Apply all pending migrations with `npm run db:migrate:remote` while the previous compatible Worker still serves traffic.
3. Query Wrangler's `d1_migrations` ledger and confirm the expected newest row.
4. Build and verify the repository.
5. Use the guarded `npm run cf:deploy` workflow in [PRODUCTION-RELEASE.md](./PRODUCTION-RELEASE.md); do not use a direct one-step production deploy.
6. Sign in as the owner and verify every read-only view.
7. Perform one reversible user action, confirm its audit entry, then restore the test account.
8. Confirm Generation streams counts against safe call-event rows for a disposable quiz.

## Safety behavior

- Operators cannot change roles or moderate another operator or owner.
- Owners cannot change their own role or moderate their own account.
- The last active owner cannot be suspended or demoted.
- Suspension revokes the target's active sessions.
- User-management requests require a reason of 3 to 500 characters and create audit records.
- Generation streams are read-only; recovery belongs to the authenticated learner's compatible extension.
- Lists are filtered and paginated on the server and return allowlisted fields only.
- `configuration.generation: true` means quiz generation is available overall. The explicit architecture fields distinguish required extension-local generation from Worker generation disabled by design.

## API surface

Read endpoints:

```text
GET /api/admin/me
GET /api/admin/overview
GET /api/admin/users
GET /api/admin/generations
GET /api/admin/jobs
GET /api/admin/lessons
GET /api/admin/audit
GET /api/admin/system
```

`GET /api/admin/jobs` is a temporary stale-shell compatibility endpoint. It returns a valid empty paginated legacy response; it is not a backend job queue.

Audited mutation endpoints:

```text
POST /api/admin/users/:userId/ban
POST /api/admin/users/:userId/unban
POST /api/admin/users/:userId/revoke-sessions
POST /api/admin/users/:userId/role
```

There are no generation retry or cancel mutations.

## Evidence

- Desktop overview: `docs/screenshots/final/admin-overview-desktop-1440.png`
- Desktop Generation streams: `docs/screenshots/final/admin-processing-desktop-1440.png`
- Desktop people: `docs/screenshots/final/admin-users-desktop-1440.png`
- Mobile people: `docs/screenshots/final/admin-users-mobile-390.png`

Playwright uses contract-shaped fixtures and verifies server-denied access, owner navigation, an audited moderation action, and 390 px overflow behavior. It does not mutate production data and does not prove that a learner's extension completed a real DeepSeek stream.
