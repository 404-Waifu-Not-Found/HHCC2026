# ClipQuest iOS Native Full-Feature QA — 2026-08-18

## Outcome

**Release decision: NOT READY.** Authentication, account isolation, settings, YouTube import, caption readiness, password-reset delivery, and Library navigation were exercised successfully. Fresh quiz generation is impossible in the current iOS build, so no learner can reach question 1, complete a quiz, obtain a score, use review/mastery, or verify formatted math.

No product code, configuration, deployment, database schema, or historical user data was changed during this QA pass. The only repository change is this report.

## Test environment

| Item | Observed value |
| --- | --- |
| Device | iPhone 17 Pro simulator |
| OS | iOS 26.2 |
| App bundle | `cc.ccwu.clipquest` |
| App version | `0.2.0` (build `1`) |
| Tested local Git SHA | `2902f1dd8c4d4614309713f351cbb01be59583ee` |
| Current `origin/main` during test | `a8bab6a33656bfb5afae9f9e1d96c27575ac06c8` |
| Branch state | local `main` was two commits ahead of `origin/main` |
| Production Worker version | `0002ea3c-6a51-4ad6-84ad-f130f0a13931` |
| Production Worker tag | `02da4dc2b8226242e465b3793acb463c4df63bc1` |
| Production generation rollout | `disabled`; effective default `prompt_first_auto_v5_11` |
| Production client requirements | Chrome extension and Android app only; no iOS client is advertised |

## Disposable accounts

Two production disposable learner accounts were created through the native sign-up UI. Passwords and verification tokens are intentionally omitted.

| Account | Result | Authoritative stored data |
| --- | --- | --- |
| `iosqa685597` | Created, email delivered, verified through the official link, signed in, signed out | 1 imported video, 0 quiz banks, 0 attempts |
| `iosqb685597` | Created and verification email delivered; simulator shut down before verification/sign-in completion | 0 videos, 0 quiz banks, 0 attempts |

The first account's password-reset email was also delivered successfully. The accounts were not deleted because permanent account deletion requires a separate destructive-action confirmation; retaining them also preserves the QA evidence.

## Live coverage

### Passed

- Native account creation with username, email, password, and age confirmation.
- Verification-email delivery and official HTTPS verification-link handoff back to ClipQuest.
- Verified-account sign-in and sign-out.
- Password-reset request and email delivery.
- Account-specific data isolation in authoritative D1 counts.
- Light/dark/system theme selection.
- English and Simplified Chinese switching.
- Reduced-motion toggle and updated explanatory copy.
- YouTube URL import for `jhRuUoTnA6g`.
- Source-title, thumbnail, duration (`294` seconds), language (`en`), and complete-caption readiness.
- Session-length and question-type controls.
- Generation cancellation and return to Home.
- Library listing, search field presence, and re-entry into the source setup screen.

### Blocked by release defects

- DeepSeek-key configuration on iOS.
- Any DeepSeek request from iOS.
- Interactive question 1.
- Progressive ready-count indicator.
- Multiple-choice, True/False, short-answer, ordering, and formula interactions.
- Choice reshuffling and canonical answer mapping.
- Correct/incorrect feedback and deterministic grading.
- Formatted mathematics in stems, choices, and feedback.
- Waiting/recovery, reload/resume, and background/foreground generation.
- Quiz completion, scoring, mastery, review, and completed-bank Library eligibility.
- Notification permission/reminders on iOS.
- Admin routes from a privileged native account.
- Account deletion completion.
- Second-account sign-in after the simulator shutdown.

## ETA evidence

The imported five-question all-types run displayed **“Question 1 in about 20 sec.”** The generation screen became visible approximately **6.535 seconds** after the Create action, but it was already terminally stopped at `Getting video · 1/7`, `3%` with `A compatible local generation client is required.`

| Metric | Result |
| --- | --- |
| Displayed q1 ETA | 20 seconds |
| Time to stopped generation screen | 6.535 seconds |
| Time to interactive q1 | Never |
| Stored questions | 0 |
| Stored quiz banks | 0 |
| Stored attempts | 0 |
| ETA error | Unbounded / not measurable because readiness is impossible |

This ETA must not be counted in calibration data. The client should determine capability/configuration before presenting a q1 countdown, and a terminal capability failure must not continue to display a countdown or partial progress.

## Problems spotted

### CQ-IOS-001 — P0 — iOS has no quiz-generation client

**Observed:** The app imported complete captions, then immediately stopped quiz creation with `A compatible local generation client is required.`

**Technical evidence:**

- `apps/app/src/generation/local-generation-client.android.ts` implements native generation only for Android.
- There is no `.ios.ts` or shared `.native.ts` generation implementation.
- `apps/app/src/generation/local-generation-client.ts` exports the web/Chrome-extension implementation, which is what iOS falls back to.
- Settings exposes Local AI only when `Platform.OS === "android"`.
- Production `/health` advertises Chrome and Android requirements but no iOS client.

**Impact:** Every fresh iOS quiz fails before question 1. This blocks the product's core learner journey.

### CQ-IOS-002 — P0 — ETA is shown for an impossible journey

**Observed:** The screen promised q1 in about 20 seconds even though the client capability check had already made generation impossible. It simultaneously showed `Quiz creation stopped`, `Getting video · 1/7`, and `3%` after captions had already been declared complete.

**Impact:** The ETA is false, stage/progress are internally inconsistent, and calibration data would be polluted if this sample were recorded as a slow run.

### CQ-IOS-003 — P1 — iPhone UI contains browser-extension privacy copy

**Observed:** The stopped screen said captions and the key stay `browser-side` and that `the extension` sends data to DeepSeek.

**Impact:** The copy is factually wrong on iOS and gives the learner no actionable path. It also contradicts the native-app positioning.

### CQ-IOS-004 — P1 — Forgot Password is a navigation trap

**Observed:** The Forgot Password screen has no Back or Sign in control. An iOS edge-swipe did not return to the prior screen. After the reset email succeeds, the only app control is `Send reset link` again.

**Technical evidence:** `app/(auth)/forgot-password.tsx` renders only the email field, result notice, and submit button.

**Impact:** A learner must leave/relaunch the app or use an external deep link to return to sign-in.

### CQ-IOS-005 — P1 — `clipquest://sign-in` resolves to the not-found screen

**Observed:** Opening the registered custom scheme at `clipquest://sign-in` displayed `This quest wandered off` instead of Sign in.

**Impact:** Custom-scheme auth callbacks and recovery links are unreliable. The tested official HTTPS verification callback did return to Sign in, so the defect is specific to the custom-scheme route mapping.

### CQ-IOS-006 — P1 — Simulator/device shut down during the second-account verification journey

**Observed:** During the second verification pass, Computer Use began timing out and `simctl` reported the iPhone 17 Pro device as `Shutdown`. No recent ClipQuest, Simulator, or SpringBoard diagnostic report was present.

**Impact:** The second account could not be verified or signed in, and remaining native coverage stopped. This requires reproduction before attributing the shutdown to ClipQuest rather than the simulator/control environment.

### CQ-IOS-007 — P2 — Text-field accessibility semantics intermittently report non-secret inputs as secure

**Observed:** After normal navigation, accessibility exposed the following as `secure text field`: Email/Username, forgot-password Email, the YouTube URL field, and Library search. The first Sign in rendering exposed Email/Username correctly as a normal text field, so the behavior is state-dependent.

**Impact:** VoiceOver may announce or interact with ordinary fields incorrectly; password managers and UI automation can misclassify them; visible values may be hidden from assistive technology.

### CQ-IOS-008 — P2 — Automated gates have no iOS-generation regression coverage

**Observed:** App typecheck passed, all 104 app tests passed, and both asset-verifier tests passed. A search of app tests and generation adapters found no iOS generation-client or `ios_app` coverage.

**Impact:** The build can be completely green while its core iOS feature is impossible.

### CQ-IOS-009 — P2 — Native feature parity is Android-only despite cross-device account copy

**Observed:** The sign-up screen promises progress across web, iPhone, and Android, but Local AI configuration, native generation, and review-reminder controls are guarded to Android only.

**Impact:** The app appears feature-complete during authentication but loses essential controls after sign-in. This expectation gap is especially severe because generation is the primary action.

### CQ-IOS-010 — P3 — Failed generation leaves a reusable `Not Started` Library card without failure context

**Observed:** After the capability failure, the imported earthquake video appeared in Library as `Not Started · Start`. Selecting it returned to source setup and offered `Create my quiz` again, without explaining that iOS cannot generate.

**Impact:** Learners can loop through the same guaranteed failure. The stored state is internally safe—there is a video row but no quiz bank or attempt—but the recovery affordance is misleading.

## Automated evidence

- `npm run typecheck --workspace @clipquest/app`: passed.
- `npm test --workspace @clipquest/app -- --runInBand`: 27 files / 104 tests passed.
- Web asset verifier: 2/2 passed.
- No iOS-generation-specific test was found.

## Privacy and integrity observations

- No DeepSeek key was entered because iOS exposes no Local AI settings.
- No DeepSeek request was made from the iOS app.
- The failed run stored the imported video metadata only; it created no quiz bank, questions, or attempt.
- Passwords, auth tokens, verification tokens, reset links, caption text, and API keys are absent from this report.

## Recommended release gate

Do not distribute the iOS beta as a quiz-capable product until an iOS-native generation client and account-scoped credential UI exist, capability checks precede ETA display, the auth navigation/deep-link defects are closed, and one uninterrupted device run completes a fresh 5-, 10-, and 15-question bank with authoritative ETA, grading, Library, review, mastery, and privacy evidence.

## Local remediation follow-up — 2026-08-18

The defects above were remediated locally after the initial QA pass. This follow-up records implementation and signed-simulator evidence; it does not replace the production acceptance gate because the Worker changes are not deployed and a funded DeepSeek credential was not configured during this pass.

### Resolution summary

| Finding | Local disposition | Evidence / remaining boundary |
| --- | --- | --- |
| CQ-IOS-001 | Implemented | Added an iOS `LocalGenerationClient` using the shared engine, native streaming fetch, account-scoped Keychain storage, protocol-safe callbacks, and `ios_app` client metadata. Worker/contracts now accept iOS native banks locally. Production remains unchanged until deployment. |
| CQ-IOS-002 | Implemented | Generation configuration/capability preflight now runs before the q1 countdown. A terminal preflight failure stops ETA/progress and renders `Question 1 unavailable` plus `Local generation unavailable` instead of a continuing percentage. Credentialed ETA calibration remains pending. |
| CQ-IOS-003 | Implemented | Native privacy and recovery copy now describes on-device/native generation instead of a browser extension. |
| CQ-IOS-004 | Verified locally | Forgot Password now includes `Back · Sign in`; the signed iOS simulator build returned to Sign in successfully. |
| CQ-IOS-005 | Verified locally | A native deep-link boundary maps `clipquest://sign-in`, reset-password, verification, Library, and quiz URLs to Expo Router paths. `clipquest://sign-in` opened Sign in in the signed simulator build instead of the not-found route. |
| CQ-IOS-006 | Not reproduced | The rebuilt, locally signed release app remained alive through launch, Forgot Password navigation, and custom-scheme replay. The original unexplained simulator shutdown has no diagnostic evidence and is not declared fixed until a longer device run reproduces or clears it. |
| CQ-IOS-007 | Implemented; device accessibility replay pending | Shared text inputs now set `secureTextEntry` only when explicitly requested. Source/tests cover the invariant, but the simulator control accessibility tree does not expose inner React Native fields reliably enough to close the VoiceOver/device gate. |
| CQ-IOS-008 | Implemented | Added iOS generation-client, native deep-link, contract, and Chrome-to-iOS continuation regression coverage. |
| CQ-IOS-009 | Implemented locally | Local AI settings, native generation, recovery, caption-only source behavior, and review-reminder platform reporting now cover iOS as well as Android. End-to-end credentialed parity remains an acceptance task. |
| CQ-IOS-010 | Mitigated locally | Unsupported/unconfigured generation is rejected during preflight before a false active generation journey begins. Production Library behavior must be replayed after deployment. |

### Signed simulator replay

- Device: iPhone 17 Pro simulator, iOS 26.2 (`158F82F2-C8C4-4C2D-92C2-B775D6C9E4B2`).
- Configuration: Release, arm64, signed by Xcode for local simulator execution.
- Artifact: `/tmp/clipquest-ios-remediation-20260818/Build/Products/Release-iphonesimulator/ClipQuest.app`.
- Launch: passed; Sign in rendered and the process remained alive.
- Forgot Password return path: passed.
- `clipquest://sign-in` mapping: passed after accepting the simulator's open-app confirmation.
- An unsigned release artifact was also tested and failed at startup because SecureStore could not access Keychain without the required entitlement. It was discarded; signed native builds are mandatory for QA.

### Updated automated evidence

- App TypeScript: passed.
- App tests: 29 files / 109 tests passed.
- Web asset verifier: 2/2 passed.
- Contracts tests: 25/25 passed.
- API tests: 158/158 passed, plus 8 script tests.
- Contracts, app, and API typechecks: passed.
- Formatting and lint checks: passed.
- `git diff --check`: passed.

### Remaining release blockers

1. Deploy the backward-compatible contracts/API/health changes and verify the active Worker version.
2. Configure an account-scoped DeepSeek key in the signed iOS build without exposing it.
3. Complete fresh 5-, 10-, and 15-question banks on a physical iPhone and verify q1 readiness, ETA error, progressive counts, grading, Library, review, mastery, background recovery, and privacy boundaries.
4. Run VoiceOver/device accessibility verification for ordinary and password fields.
5. Reproduce or clear the earlier simulator shutdown in a sustained test run.
6. Configure and verify HTTPS Universal Links with a valid AASA file and signing-team application identifier before claiming App Link support. Custom-scheme routing is fixed; Universal Links are not yet certified.

### Current decision

**Improved locally, but still NOT READY for public iOS beta distribution.** The P0 implementation gaps are closed in the working tree, while deployment and credentialed device acceptance remain deliberately unclaimed. No commit, push, migration, or deployment was performed during this remediation pass.
