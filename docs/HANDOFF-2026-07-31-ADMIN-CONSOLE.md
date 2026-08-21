# ClipQuest Admin Console Handoff

**Date:** 2026-07-31 CST  
**Branch:** `codex/duolingo-ui-rebuild`  
**Previous handoff:** `docs/HANDOFF-2026-07-31-UI-REBUILD.md`

## Completed work

ClipQuest now includes a private, responsive `/admin` operations console that follows the rebuilt ClipQuest indigo/lime visual language. It is part of the existing Expo application and Cloudflare Worker rather than a separate dashboard stack.

The implementation adds server-enforced `user`, `admin`, and `owner` roles; audited moderation and generation controls; real overview/user/job/lesson/audit/system views; a hidden settings shortcut for authorized sessions; desktop and mobile browser evidence; and shared Zod contracts.

The learner-facing paste-to-lesson flow, authentication screens, transcripts, generation, quiz validation, library, and settings remain intact.

## Architecture additions

- **D1 migrations:** `apps/api/migrations/0006_admin_console.sql` and `0007_admin_audit_retention.sql`
- **Better Auth:** admin schema/session hooks with a least-privilege custom role map; generic admin mutation routes are blocked.
- **Authorization:** `apps/api/src/middleware/admin.ts` checks a server session permission for every management endpoint.
- **Audit:** privileged writes batch their state change with an `admin_audit_log` insert.
- **Contracts:** `packages/contracts/src/admin.ts` allowlists all management request/response fields.
- **API:** `apps/api/src/routes/admin.ts`
- **Client shell:** `apps/app/src/admin/AdminShell.tsx`
- **Shared management UI:** `apps/app/src/admin/AdminUI.tsx`
- **Routes:** `/admin`, `/admin/users`, `/admin/jobs`, `/admin/lessons`, `/admin/audit`, `/admin/system`

## Security boundaries

- The client cannot assign or elevate a role.
- Learners receive HTTP 403 from management APIs even when they navigate directly to `/admin`.
- Operators cannot change roles; only owners can.
- Self-moderation and self-role changes are rejected.
- The last active owner is protected from suspension and demotion.
- Suspension revokes all sessions for the target account.
- Hard delete, impersonation, password/email changes, secret editing, raw transcripts, answer payloads, and credentials are out of scope and absent.
- The system view exposes configuration presence only, never secret values.

## UI status

- Desktop-first fixed operations rail at 1440/1280/1024 widths.
- Compact horizontal navigation below 1024 px.
- Responsive record cards and action dialogs at 390 px with no document-level horizontal overflow.
- Existing Fredoka/DM Sans typography, semantic theme tokens, thick borders, tactile controls, dark-mode compatibility, 44 px targets, and reduced-motion behavior are preserved.
- Loading, empty, error, access-denied, success, disabled, selected, and destructive states are implemented.

## Testing status

- Shared admin contract tests added.
- API permission and auth-schema tests added.
- Local D1 migrations `0002` through `0007` applied successfully; a read-only foreign-key inspection confirmed `ON DELETE SET NULL` for audit actors.
- App, API, and contract type checks passed after implementation.
- Existing five learner Playwright journeys passed during the first full run.
- Focused admin Playwright journey passed after the mobile-axis refinement.
- Final verification passed: formatting, lint, all workspace type checks, 43 Vitest tests, seven Playwright journeys, Expo static export, and Worker dry build.

Browser coverage includes server-denied learner access, desktop overview/people/processing, owner-only role control visibility, an audited suspension action, mobile navigation, and 390 px overflow.

## Deployment status

This admin-console change has **not** been pushed, remotely migrated, or deployed. The existing production version recorded in the previous handoff remains the live version.

Before production deployment:

1. Apply migrations `0006` and `0007` remotely.
2. Promote one trusted, verified existing account to `owner` using its D1 user ID.
3. Build and rerun all tests.
4. Deploy the Worker/static export.
5. Verify `/admin` and one reversible audited action.

See `docs/ADMIN-CONSOLE.md` for exact rollout and bootstrap guidance.

## Dependencies

No dependency was added or removed. The implementation uses the existing Expo, React Native, Better Auth, Hono, D1, Zod, MaterialCommunityIcons, Vitest, and Playwright stack.

## Known limitations and deferred work

- No analytics charting or event warehouse exists; overview metrics are D1 aggregates.
- No bulk actions, impersonation, hard delete, password/email editing, or secret editing.
- Audit records are append-only by application convention; D1 does not provide a separate write-once database role.
- Pagination is page/offset based for V1. Large production tables may later move to cursor pagination.
- Native iOS/Android admin screens share the responsive route code but were not accepted on physical devices in this task.
- Production migration, first-owner promotion, live role enforcement, and live audit insertion remain operational acceptance steps.

## Exact local commands

```bash
cd /Users/unoxyrich/Documents/GitHub/ClipQuest
npm ci
npm run db:migrate:local
npm run dev:api
npm run dev:web
```

Run the API and web commands in separate terminals. Quality gates:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```
