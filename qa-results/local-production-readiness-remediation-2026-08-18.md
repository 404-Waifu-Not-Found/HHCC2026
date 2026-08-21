# ClipQuest Local Production-Readiness Remediation — 2026-08-18

## Scope and release boundary

- Repository: `ClipQuest`
- Starting revision: `a4d85ac2da45cfa9b8e2b33081db2ecfc13a6497`
- Validation target: the complete web, Worker, extension, shared quiz engine, Android, and iOS workspace
- This run changes and verifies the local candidate only. It does not push, migrate, deploy, publish, or modify production traffic.
- Existing unrelated and untracked QA artifacts were preserved and were not staged.

## Problems found and fixed

| # | Severity | Problem | Remediation and verification |
|---|---|---|---|
| 1 | High | Password-reset secrets could be accepted through the custom `clipquest://` URL scheme, exposing a sensitive link to any application able to register or intercept the same scheme. | Password reset now accepts only the verified HTTPS app-link origin. The Worker serves an Apple App Site Association document, iOS declares the matching associated domain, and custom-scheme reset links are rejected by tests. |
| 2 | Medium | The production Chrome extension trusted `localhost` and `127.0.0.1` origins through manifest host permissions, content scripts, and origin policy. | Development origins were removed from the packaged extension. Only the exact production ClipQuest origin is authorized; the origin-policy and bridge tests cover the boundary. |
| 3 | Medium | Native transcript checkpoints, imported-video state, and the Android generation outbox were keyed by video or generation ID without an authenticated user boundary. A subsequent account on the same device could inherit another account's local state. | New versioned records include the authenticated user ID in both the key and validated envelope. Ambiguous legacy records are deleted instead of migrated, and sign-out, deletion, and observed user changes clear account-bound state. |
| 4 | Medium | Device-media downloads trusted declared size and could continue reading an unbounded response body. | Native and web download paths enforce both declared and cumulative 180 MiB limits while streaming, abort oversized downloads, and clean temporary state. |
| 5 | Low | DeepSeek SSE and non-stream JSON reads had no strict byte or frame ceilings. | The shared engine now bounds raw response bytes, individual SSE frames, and accumulated model content; focused tests cover oversized streamed and non-streamed responses. |
| 6 | Medium | Answer insertion and mastery updates could occur after a grading reservation was lost, because the answer insert was unconditional and the compare-and-set update result was not checked before side effects. | Answer insertion is conditional on the live grading token, both answer and attempt mutation counts are verified, and mastery is written only after the reservation compare-and-set succeeds. Legacy short-answer grading is deterministic and no longer transmits answers to DeepSeek. |
| 7 | Medium | Progressive question append and generation progress could commit after a recovery lease expired, allowing a stale tab to resurrect or race generation state. | Question insertion, bank updates, progress transitions, and lease renewal now require the live owner claim in SQL. Failed conditional mutations close without appending or advancing the bank. |
| 8 | Medium | Client-reported source metadata could overwrite authoritative video duration and bypass downstream media-duration protections. | The source-metadata endpoint no longer permits the client to replace stored duration. It accepts only privacy-safe caption and language aggregates. |
| 9 | Medium | Several progressive endpoints parsed a request body before rate limiting or confirming the target bank, enabling avoidable CPU and memory work for rejected requests. | Requests are rate-limited and ownership-scoped before parsing where possible. The shared JSON reader now has a one-megabyte body ceiling. |
| 10 | Low | Thumbnail cache misses could amplify third-party requests without a caller/video-specific request budget. | Thumbnail misses are protected by IP and video-scoped D1 rate limits while successful immutable cache behavior is preserved. |
| 11 | Low | Historical short-answer grading could send a learner response and grading context to DeepSeek through the Worker, violating the storage-only privacy boundary. | All Worker grading is deterministic. No learner answer, caption, prompt, or grading context is sent to a model. Formula grading and conservative prose grading remain local. |
| 12 | Medium | Sign-out/account-deletion cleanup and legacy cache migration could either mask a successful remote sign-out or accidentally delete newly versioned account-safe records. | Remote success is preserved even if best-effort device cleanup fails, and legacy cleanup explicitly excludes current v2/v3 prefixes. Regression tests cover account switching and cleanup. |
| 13 | Build | Expo Metro could not start because `react-refresh/babel` was not a declared workspace dependency. | Added the compatible direct development dependency. Android and iOS development bundles now start from the repository without relying on an incidental global install. |
| 14 | Test fidelity | End-to-end fixtures seeded an obsolete unowned imported-video cache and failed after the account boundary was enforced. | The E2E seed helper now writes the same authenticated v3 envelope as the application. The previously failing seven browser scenarios pass with the real boundary. |
| 15 | UI | The Local AI screen used a full-size text button for back navigation, producing inconsistent native spacing. | Replaced it with the shared accessible icon button. Android and iOS simulator screenshots confirm the current responsive application chrome and typography render correctly. |

## Verification evidence

### Automated workspace gates

- API tests: 162 passed.
- App tests: 112 passed.
- Extension tests: 228 passed, including the recorded 100-bank generation benchmark.
- Contracts tests: 25 passed.
- Shared engine tests: 5 passed.
- The seven E2E cases initially exposed by the account-boundary change all pass after fixture correction.
- Formatting, lint, and TypeScript checks pass.
- Expo Doctor: 21/21 checks pass.
- `npm ci --dry-run --legacy-peer-deps` succeeds.
- The complete canonical gate passed in one clean run after the Android Metro server was stopped: formatting, lint, typecheck, all workspace tests, all 23 Playwright scenarios, web/Worker builds, Cloudflare type generation, and both Wrangler dry-runs.

### Native build and runtime evidence

- Android API 36 debug build: `BUILD SUCCESSFUL` (397 Gradle tasks).
- Android emulator: the app launched, loaded the JavaScript bundle through Metro, and rendered the authenticated learner home with question-type selection, YouTube import, Library cards, and bottom navigation.
- iOS simulator build: unsigned compile and signed Debug simulator build both succeeded.
- iPhone 17 Pro simulator: the signed app launched and rendered the responsive sign-in experience. The earlier unsigned build's Keychain entitlement error was an invalid test artifact, not a release behavior.
- Expo configuration reports the Android package, iOS associated domain, app-link intent filters, and disabled over-the-air updates expected by the private beta plan.
- The reproducible extension ZIP generated during the passing build has SHA-256 `d29a37e0e8b9278ac35a0b0cb4fc314727f08bc3cffd8b2470a450fb1ed1c268`.

### Dependency audit

- Full dependency graph: 30 advisories (`1 low`, `10 moderate`, `19 high`, `0 critical`).
- Production dependency graph: 26 advisories (`0 low`, `8 moderate`, `18 high`, `0 critical`).
- Direct `sharp` was upgraded to `0.35.3`. Remaining advisories are inherited through the current Expo, React Native, native-build, and Hugging Face dependency trees. They cannot be removed safely without coordinated framework-major upgrades; `npm audit fix --force` was intentionally not used.

## Security review coverage

The standard security review covered authentication and deep links, cross-account local storage, extension/page trust boundaries, Worker request limits, generation leases, answer reservations, third-party fetches, thumbnails, and privacy-sensitive grading. All reportable application findings identified in this pass were remediated in the local candidate and have focused regression coverage.

- Scan ID: `c7c33089-9dc1-4929-85f7-12c28c2e785c`
- Original reviewed snapshot: `a4d85ac2da45cfa9b8e2b33081db2ecfc13a6497`
- Findings: 11 total (`1 high`, `7 medium`, `3 low`), all fixed in the local working-tree candidate.
- Sealed report: `/private/var/folders/hz/khm8rffn6zz424tl3j6_lbd40000gn/T/codex-security-scans-lFimR6/ClipQuest/a4d85ac2da45cfa9b8e2b33081db2ecfc13a6497_20260817T172120Z_vxrociax/report.md`

## External release gates still required

The local candidate is substantially safer and passes native runtime checks, but these external requirements must be completed before calling the Android/iOS beta publicly ready:

- Configure the real EAS project ID and authenticate the EAS project.
- Configure and verify the EAS-managed signing credentials and back up the keystore securely.
- Publish Android `assetlinks.json` with the final release signing-certificate fingerprint.
- Replace the Apple association placeholder with the final Apple Team ID and verify the hosted AASA response on the production origin.
- Configure production FCM credentials and verify registration/unregistration on a physical Android device.
- Run the real, funded ten-video progressive-generation matrix with the released client and record first-question ETA accuracy, retries, complete scoring, and privacy traffic.
- Run physical-device tests on Android 13+ and the selected iOS test device.
- Push and deploy only after explicit authorization, then repeat live shell/asset, health/profile, app-link, and generation acceptance against the exact deployed SHA.

Because no funded real-video generation was authorized or executed in this local remediation, ETA was not recalibrated from synthetic observations. Existing deterministic ETA tests pass, but public ETA accuracy remains an explicit live acceptance gate.
