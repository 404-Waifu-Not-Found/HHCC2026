# ClipQuest production release

ClipQuest deploys its Cloudflare Worker and content-hashed static assets as one version. Production releases use a guarded version upload, version-override smoke test, and atomic promotion. Do not replace this workflow with a direct one-step `wrangler deploy`.

## Last verified production baseline

Verified on 2026-08-11:

| Item                                       | Production value                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| Origin                                     | `https://clipquest.ccwu.cc`                                                  |
| Worker version                             | `a8d8cda5-ea66-4e87-afae-388b2cf237dd`                                       |
| Worker tag / Git SHA                       | `9c1bc3b75929819cc18f1a7bb4a50b7cd954dc03`                                   |
| D1 migration                               | `0019_grounded_generation_telemetry.sql`                                     |
| Extension observed in Chrome               | `0.8.5`                                                                      |
| Health architecture                        | extension-local; backend generation disabled; extension enabled and required |
| Deployed supported metadata                | model `deepseek-v4-flash`, pipeline 9, prompt v5.5, validator v4.4           |
| Generation rollout                         | disabled                                                                     |
| Profile actually persisted by new QA banks | `legacy_reasoning_v5_1`, prompt v5.1                                         |

The current [ten-video production report](../qa-results/live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-11.md) completed ten final banks and all 100 planned learner questions, but only 9/10 first attempts completed. It also found legacy source-referential prompts, display-time prompt corruption, and an automatic recovery recorded as `manual_continuation`. This baseline is deployed, but the evidence-grounded rollout is **not cleared for enablement**.

This table is a dated observation, not a substitute for checking the live service before the next release.

## Pending 0.8.6 candidate

The current local source candidate uses extension `0.8.6`, result protocol `8`, capability `question-stream-v5`, pipeline `9`, prompt `quiz-local-json-stream-v5.6`, validator `validator-local-progressive-v4.5`, progressive import `v6`, and generation profile `evidence_grounded_auto_v5_4`.

Its compatibility path preserves accepted legacy prefixes and uses the original bank and attempt. Previously failed ordinals are retried as singleton `automatic_retry` requests; never-attempted ordinals remain `primary`. New `manual_continuation` inserts are rejected after the exact historical replay check, but existing rows remain immutable evidence. Prompt v5.6 rejects source framing and course logistics before storage, and the display compatibility guard removes only complete grammar-safe source-attribution clauses from old prompts.

This change requires no D1 migration. The existing `0018_automatic_generation_recovery.sql` and `0019_grounded_generation_telemetry.sql` columns are sufficient. The candidate has not been pushed, deployed, installed for acceptance, benchmarked, canaried, or enabled merely because it exists in the local source tree.

## One-time Cloudflare version affinity

Create a zone-level Request Header Transform Rule for `clipquest.ccwu.cc` in the `http_request_late_transform` phase:

- Expression: `http.host eq "clipquest.ccwu.cc"`
- Operation: set dynamic request header
- Header: `Cloudflare-Workers-Version-Key`
- Value: `ip.src`

The release runner verifies this rule through `/health` while the candidate Worker is at 0% and aborts with rollback if the header is absent. Version affinity prevents an HTML shell from one Worker version from requesting a content-hashed asset available only in another version.

References:

- [Cloudflare version affinity](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/)
- [Cloudflare version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)
- [Cloudflare versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Cloudflare rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

## Release prerequisites

- The exact branch HEAD is committed and pushed upstream.
- The worktree is clean so source, version tag, app assets, Worker code, and extension ZIP refer to one immutable revision.
- Every migration has a backward-compatible rollout plan. A Worker rollback does not roll back D1.
- The compatible unpacked extension has been built and its exact version has passed Chrome acceptance.
- The target generation rollout mode is deliberate. Enabling a profile is a separate product gate from merely deploying code that supports it.
- No API key, transcript, DeepSeek body, raw prompt, answer export, or QA credential is present in release evidence.

Before deploying:

```bash
git status --short
git rev-parse HEAD
git rev-parse @{upstream}
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run cf:types
npm run cf:dry-run
```

Apply and verify migrations before the candidate promotion:

```bash
npm run db:migrate:remote
cd apps/api
npx wrangler d1 execute DB --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 5"
cd ../..
```

Resolve exact migration targets and inspect the ledger before any production write. Do not report a local migration as proof that remote D1 is current.

## Guarded release

From the workspace root:

```bash
npm run cf:deploy
```

The runner uses the workspace-pinned Wrangler through `npx` and performs these gates in order:

1. Build contracts, the extension ZIP, the web app, and the Worker.
2. Recursively verify that every generated HTML shell references files present in the final asset directory.
3. Run `npx wrangler deploy --dry-run`.
4. Record the single version currently receiving 100% of production traffic.
5. Upload the pushed Git SHA with `npx wrangler versions upload` and smoke-test its preview URL.
6. Create a deployment with the old version at 100% and the candidate at 0%.
7. Probe every production shell and entry asset with `Cloudflare-Workers-Version-Overrides` on every request, while verifying the version-affinity transform rule.
8. Promote the verified candidate directly to 100%.
9. Repeat shell and bundle probes at 0, 2, 5, and 10 minutes.

Any failure after the 0% deployment automatically runs `npx wrangler rollback <previous-version-id>`. Evidence is retained under the ignored `apps/api/.wrangler/release-evidence/` directory. Preserve that evidence when diagnosing a failed release.

The matching extension artifacts are:

- `apps/extension/dist/clipquest-captions-extension/`
- `apps/extension/dist/clipquest-captions-extension.zip`

## Post-promotion verification

Verify the deployed version and architecture:

```bash
curl -fsS https://clipquest.ccwu.cc/health
cd apps/api
npx wrangler deployments status
```

Require the health response to identify the promoted Worker version and report:

- maintenance disabled;
- pipeline 9;
- backend quiz generation disabled;
- extension quiz generation enabled and required;
- expected model, current prompt, validator, and rollout mode;
- the expected newest applied D1 migration.

Probe `/`, `/library`, `/settings`, `/admin`, `/admin/jobs`, `/admin/system`, and representative dynamic quiz routes. Parse each HTML shell, request every same-origin script/module preload/stylesheet/font/image reference, and require the expected content type and a successful response.

Health metadata alone is insufficient for a generation-profile release. Create a disposable quiz through the real Chrome extension, then verify its stored `generationProfile`, `promptVersion`, `validatorVersion`, `protocolVersion`, and planned count. `/health` describes the deployed code's current capability; rollout flags can still assign a compatibility profile to a newly created bank.

## Generation rollout gate

Do not enable `QUIZ_V5_4_ROLLOUT` merely because extension 0.8.6 is installed or `/health` advertises prompt v5.6. Source-level regression tests are necessary but do not clear the canary or production gate. Before canary or general enablement:

1. Deploy one immutable pushed 0.8.6 Worker/app candidate with the grounded rollout still disabled and install the matching extension ZIP.
2. Verify the authenticated `/api/local-ai/profile` assignment, capability handshake, and one newly persisted bank—not only the supported versions advertised by `/health`.
3. Run at least 100 complete healthy banks across 5/10/15 lengths, all question-type combinations, English/CJK, short/long captions, formula-heavy lessons, and manual/automatic captions.
4. Require at least 99% healthy first-pass completion, 100% eligible completion without learner recovery actions, zero new `manual_continuation` rows, exact HTTP-call/event reconciliation, no shortened completion, and no accepted-question replacement.
5. Set the grounded rollout to canary for `unoxyrich`, then run one immutable enabled-profile artifact across ten different real YouTube videos and complete all 100 learner questions.
6. Require question 1 before the remaining bank, 10/10 first-attempt completion, truthful retry totals, prompt v5.6/validator v4.5/protocol 8 on every new bank, no source framing or logistics trivia, and no compatibility-presentation corruption.
7. Revisit a recoverable legacy failed bank or reproduce Run 8's q12-q13 failure; require automatic completion of the same bank without replacing its accepted prefix.
8. Confirm the page bridge and Worker requests contain no API key, captions, transcript, generation instructions, or raw DeepSeek response.
9. Enable the grounded profile generally only after every benchmark and canary gate passes.

If a canary gate fails, restore the rollout variable to the prior profile without rolling back the additive D1 migrations. Retain safe call-event evidence for diagnosis.

## Reporting rules

Report these states separately:

- local source and test status;
- commit and pushed SHA;
- remote migration state;
- uploaded Worker version;
- production traffic allocation;
- installed/reloaded extension version;
- profile actually persisted by a fresh bank;
- completed real-browser learner acceptance.

A green test, generated ZIP, successful upload, browser toast, or healthy `/health` response proves only its own layer. None of those observations alone proves the full learner journey or the enabled generation profile.
