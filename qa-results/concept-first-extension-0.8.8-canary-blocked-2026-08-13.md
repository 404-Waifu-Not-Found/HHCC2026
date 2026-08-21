# ClipQuest 0.8.8 canary release evidence — live matrix blocked by untrusted TLS route

Date: 2026-08-13 (Asia/Shanghai)

## Outcome

The exact pushed canary candidate was built, installed, configured, and promoted, but it is **not cleared for general rollout**. The required official-site ten-video Chrome matrix was stopped before sending more credentials when the machine's active network resolver began routing `clipquest.ccwu.cc` to an endpoint presenting a certificate for `183.192.65.101` instead of the ClipQuest hostname.

This report deliberately does not claim a completed live matrix or public readiness. The concept-first rollout remains `canary`.

## Release identity

- Git `main`: `297747e` (`chore(release): add production QA canary`)
- Production Worker: `c1ceecc8-4e6e-4b9a-bdea-49f48031fae2` at 100%
- Rollback baseline: `013b0516-708b-4b3f-b562-1163b12e1175`
- Extension: `0.8.8`, unpacked from the exact clean release worktree
- Extension ZIP SHA-256: `0736064039a04160c15bc2cdb5d3a2e09b1e03eaa917db805f6b281dc9eaf9bc`
- Prompt / validator / protocol: v5.8 / v4.7 / 9
- Profile: `concept_first_auto_v5_8`
- Rollout: canary only

## Verified before the network block

- The previously installed ClipQuest extension was removed, and the clean 0.8.8 unpacked directory was loaded without using the extension Reload control.
- The extension reported a fresh ID and version 0.8.8.
- The DeepSeek key was read without output, stored only through the extension popup, and returned `Key verified`.
- The authenticated disposable QA profile returned `concept_first_auto_v5_8`, minimum extension 0.8.8, and `question-stream-v6`.
- The production-metadata regression was added to the local validator suite; production credits such as episode filming/studio statements are excluded from instructional evidence.
- The exact SHA passed formatting, lint, typecheck, 367 automated tests (145 API, 87 app, 113 extension, 22 contracts), the 100-bank recorded-fixture benchmark, 23 Playwright journeys, static export, 440-reference asset verification, Worker dry run, and extension packaging.
- Production shell/entry probes passed at 0, 2, 5, and 10 minutes for the preceding code-identical Worker; the canary-only SHA changed configuration rather than assets or application code.

## Blocking evidence

- Public resolvers returned Cloudflare addresses `104.21.74.16` and `172.67.152.179`.
- The machine's active resolver returned `198.18.0.59`.
- The intercepted TLS endpoint presented a certificate whose subject was `CN=183.192.65.101`; it did not contain `clipquest.ccwu.cc`.
- Chrome correctly showed `NET::ERR_CERT_COMMON_NAME_INVALID`.
- Direct verification against the public Cloudflare edge returned the exact production headers `x-clipquest-worker-tag: 297747e` and `x-clipquest-worker-version: c1ceecc8-4e6e-4b9a-bdea-49f48031fae2`.
- Wrangler authentication later encountered a Cloudflare bot challenge on the same unstable route; the already completed upload and promotion remain visible in deployment status.

No privacy warning was bypassed. No DeepSeek key, QA password, captions, transcript, prompt text, evidence, or model response was sent across the untrusted route or written into this report.

## Remaining gates

After a trustworthy DNS/TLS path is restored:

1. Reinstall the exact matching extension artifact if Chrome state changed.
2. Replay the production-credit source and require the original bank to complete without accepting metadata trivia.
3. Run the complete ten-video/100-question canary matrix; failed banks may not be replaced and counted.
4. Enable the profile generally only after the canary matrix passes.
5. Run a second fresh ten-video/100-question matrix after general enablement.
6. Update screenshots and the final public-release report only after those live gates pass.
