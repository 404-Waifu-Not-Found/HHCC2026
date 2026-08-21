# ClipQuest Operations Console

Status reviewed: 2026-08-04. This document describes the current operations surface; release-level implementation and verification state is recorded in [the current handoff](./HANDOFF-2026-08-04.md).

The private operations console lives at `/admin`. It uses ClipQuest's existing Expo application and visual system, but it is deliberately isolated from the learner navigation.

## Access model

| Role    | Access                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `user`  | No operations access                                                                                                                   |
| `admin` | Read overview, users, jobs, lessons, audit, and system health; suspend/restore accounts; revoke sessions; retry/cancel generation jobs |
| `owner` | All operator access plus role changes                                                                                                  |

Roles are read from the authenticated server session. The client never supplies or infers authorization. A hidden route or changed local state cannot grant access because every `/api/admin/*` endpoint checks the server-owned role.

The generic Better Auth admin endpoints are blocked. Privileged changes must use ClipQuest's audited management API.

## Available views

- **Overview:** real user, lesson, active-job, failed-job, and seven-day activity counts.
- **People:** allowlisted account profile fields, role/status filters, reversible suspension, session revocation, and owner-only role changes.
- **Processing:** durable generation-job summaries with audited retry and cancel controls.
- **Lessons:** read-only lesson ownership, question-count, attempt-count, source, language, and session summaries.
- **Audit log:** actor, action, target, reason, outcome, and timestamp for privileged mutations.
- **System:** configuration-presence booleans, model name, migration level, and generation state counts. Secret values are never returned.

The console does not expose auth tokens, passwords, account credentials, raw transcript text, correct-answer payloads, R2 objects, or Worker secret values. It does not support impersonation, password/email changes, or hard account deletion.

## Database migration

Migration `apps/api/migrations/0006_admin_console.sql` adds:

- `user.role`, `user.banned`, `user.ban_reason`, and `user.ban_expires`
- `session.impersonated_by` for Better Auth schema compatibility
- indexes for role, suspension, and job-state queries
- append-only `admin_audit_log`

Migration `0007_admin_audit_retention.sql` changes the audit actor foreign key to `ON DELETE SET NULL`. Existing ClipQuest self-deletion therefore remains available; historical events show an anonymized deleted-operator identity instead of retaining account PII.

Migration `0008_question_types.sql` is not an admin-schema change, but it must be applied in the same release. It records each generation job's user-selected question types so retries and operator-triggered recovery preserve the original quiz contract.

Verify locally:

```bash
cd /Users/unoxyrich/Documents/GitHub/ClipQuest
npm run db:migrate:local
npm run typecheck
npm test
```

## First-owner bootstrap

There is intentionally no public sign-up path for an owner. After the migration is applied, select one trusted, email-verified existing ClipQuest account and promote it by immutable user ID through the D1 dashboard or Wrangler.

Local example:

```bash
cd /Users/unoxyrich/Documents/GitHub/ClipQuest/apps/api
npx wrangler d1 execute DB --local --command "SELECT id, email, role, banned FROM user ORDER BY created_at LIMIT 20"
npx wrangler d1 execute DB --local --command "UPDATE user SET role = 'owner', updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = '<trusted-user-id>' AND email_verified = 1"
```

For production, repeat the same verification using `--remote` only after confirming the account ID and deployment target. Never bootstrap by accepting a role from a client request.

## Production rollout

The safe order is:

1. Back up or inspect the production D1 database.
2. Apply `npm run db:migrate:remote` while the previous Worker is still serving. Added columns are backward-compatible.
3. Promote exactly one trusted verified account to `owner` and verify the row.
4. Run `npm run build` and `npm run test:e2e`.
5. Deploy with `npm run cf:deploy`.
6. Sign in as the owner, open `/admin`, verify read-only views, then perform one reversible test action and confirm its audit entry.
7. Promote additional operators from the console only when needed.

Do not deploy the current Worker before migrations `0006`, `0007`, and `0008` are present. The auth/session queries expect the role and ban columns, `0007` preserves existing account deletion behavior, and generation recovery expects `question_types_json` from `0008`.

## Safety behavior

- Operators cannot change roles or moderate another operator/owner.
- Owners cannot change their own role or moderate their own account.
- The last active owner cannot be suspended or demoted.
- Suspension revokes the target's current sessions.
- Job retry/cancel operations are state-checked and auditable.
- Management requests require a reason of 3 to 500 characters.
- Lists are server filtered and paginated; the API returns allowlisted fields only.

## API surface

Read endpoints:

```text
GET /api/admin/me
GET /api/admin/overview
GET /api/admin/users
GET /api/admin/jobs
GET /api/admin/lessons
GET /api/admin/audit
GET /api/admin/system
```

Audited mutation endpoints:

```text
POST /api/admin/users/:userId/ban
POST /api/admin/users/:userId/unban
POST /api/admin/users/:userId/revoke-sessions
POST /api/admin/users/:userId/role
POST /api/admin/jobs/:jobId/retry
POST /api/admin/jobs/:jobId/cancel
```

## Evidence

- Desktop overview: `docs/screenshots/final/admin-overview-desktop-1440.png`
- Desktop people: `docs/screenshots/final/admin-users-desktop-1440.png`
- Desktop processing: `docs/screenshots/final/admin-processing-desktop-1440.png`
- Mobile people: `docs/screenshots/final/admin-users-mobile-390.png`

Playwright uses contract-shaped fixtures and verifies server-denied access, owner navigation, an audited moderation action, and 390 px overflow behavior. It does not mutate production data.
