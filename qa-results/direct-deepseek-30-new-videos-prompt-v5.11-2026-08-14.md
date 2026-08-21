# Direct DeepSeek 30-video prompt v5.11 acceptance

Date: 2026-08-14 (Asia/Shanghai)

## Verdict

The final uninterrupted direct-local matrix passed all selected release gates:

- 30/30 new educational-video transcript banks completed.
- 150/150 planned questions were accepted.
- 150 primary DeepSeek requests were dispatched: exactly one per question.
- 0 automatic retries and 0 terminal failures occurred.
- 0 automated editorial or structural audit findings remained.
- Median interactive-question-one latency was 2.646 seconds; p95 was 4.453 seconds.
- Median complete five-question bank latency was 10.729 seconds; p95 was 12.889 seconds.

This benchmark called the current extension-local generator directly from the local machine. It did not use Chrome, the ClipQuest Worker, or a backend model call. The DeepSeek key was read from `.env` without being printed and was sent only to DeepSeek.

## Tested release contract

| Field | Value |
| --- | --- |
| Extension | 0.8.16 |
| Model | `deepseek-v4-flash` |
| Protocol | 10 |
| Capability | `question-stream-v7` |
| Prompt | `quiz-local-json-stream-v5.11` |
| Prompt fingerprint | `db1855765695490ffc3d0db52b4890ef44fdb0de700fed2d8f22f682277133be` |
| Validator | `validator-minimal-gradeability-v5.2` |
| Progressive import | `extension-progressive-import-v8` |
| Profile | `prompt_first_auto_v5_11` |
| Pipeline | 9 |

## Problems reproduced and fixed

1. **False-item retry loops.** A requested False item could be impossible without inventing a fact. The prompt had contradictory instructions requiring every visible fact to be supported while also requiring a false statement. v5.11 now distinguishes supported grading material from deliberately incorrect contrasts. If DeepSeek cannot form a safe False contrast, ClipQuest retains its supported statement as a locally graded True item without another request.
2. **Leaked non-thinking trace.** DeepSeek once placed a hidden internal trace in `delta.content` and then emitted a second valid JSON object. The parser now accepts only a later complete `{"questions": ...}` envelope after a recognized trace boundary; arbitrary malformed text still fails closed.
3. **Redundant formula-token failures.** A valid canonical formula such as `F=m*g` was rejected when the optional token array was malformed or missing. v5.11 now validates the canonical answer with the deterministic expression parser; formula tokens remain optional.
4. **Duplicate DNS objectives.** Evidence windows could differ in their neighboring context while repeating the same center claim. Strict prompt-first selection now deduplicates both complete windows and their primary sentences before assigning ordinals.
5. **Narrative-transition trivia.** A French Revolution candidate asked what “the Revolution would not end there” indicated. Narrative transitions are now removed during source preparation, and the system prompt explicitly forbids questions about what a sentence, phrase, statement, quote, or wording means.
6. **Formula/prose grading drift.** Natural-language words were being parsed as products of single-letter variables. The Worker parser now treats prose words as formula boundaries. Multi-equation explanations fall through to strict semantic grading when one selected formula cannot represent the entire response, while standalone wrong formulas remain definitive mismatches.

## Per-run results

All runs requested five mixed-type questions. `q1` and `total` are wall-clock milliseconds measured from generator invocation.

| Run | Video ID | Title | Duration | Words | Types | Requests | Retries | q1 | Total | Audit |
| ---: | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1 | `SbIpWHQI-tE` | The continents are moving. When will they collide? | 291s | 684 | MC/TF/TF/SA/MC | 5 | 0 | 2,947 | 10,970 | Pass |
| 2 | `TD3XSIE4ymo` | The Water Cycle for Kids | 427s | 822 | MC/SA/TF/SA/TF | 5 | 0 | 1,939 | 9,005 | Pass |
| 3 | `Qqe4thU-os8` | DNA Replication (Updated) | 474s | 1,305 | MC/SA/TF/SA/TF | 5 | 0 | 2,501 | 10,560 | Pass |
| 4 | `_jBpv9fYSU4` | Understanding the Immune System in One Video | 917s | 2,171 | MC/TF/MC/SA/TF | 5 | 0 | 3,173 | 11,225 | Pass |
| 5 | `znnp-Ivj2ek` | What causes antibiotic resistance? | 259s | 626 | MC/SA/TF/TF/SA | 5 | 0 | 2,489 | 10,473 | Pass |
| 6 | `93sK4jTGrss` | Morphology: Crash Course Linguistics #2 | 646s | 2,000 | MC/TF/SA/MC/TF | 5 | 0 | 4,034 | 12,231 | Pass |
| 7 | `d2r7Bk1NlgU` | Introduction to Cognitive Bias | 706s | 2,087 | MC/TF/SA/TF/SA | 5 | 0 | 2,956 | 10,198 | Pass |
| 8 | `np_M42Yi8jY` | Why Prices Won't Stop Rising? | 1,321s | 3,335 | MC/SA/TF/SA/MC | 5 | 0 | 4,306 | 12,903 | Pass |
| 9 | `x-hYzRncxTc` | What Is Opportunity Cost? | 164s | 419 | MC/TF/SA/SA/TF | 5 | 0 | 2,190 | 9,418 | Pass |
| 10 | `NF1pwjL9-DE` | Elliptic Curves | 522s | 1,863 | MC/TF/MC/SA/TF | 5 | 0 | 2,829 | 11,141 | Pass |
| 11 | `mpQZVYPuDGU` | How a DNS Server works | 342s | 824 | MC/SA/TF/SA/TF | 5 | 0 | 2,009 | 9,347 | Pass |
| 12 | `dX9CGRZwD-w` | How are Microchips Made? | 1,668s | 3,777 | MC/TF/SA/SA/TF | 5 | 0 | 5,725 | 12,889 | Pass |
| 13 | `G5McJw4KkG8` | How do Lithium-ion Batteries Work? | 568s | 1,462 | MC/SA/TF/MC/SA | 5 | 0 | 3,448 | 12,134 | Pass |
| 14 | `CWulQ1ZSE3c` | How does an Electric Motor work? | 597s | 1,805 | MC/SA/SA/MC/TF | 5 | 0 | 3,009 | 10,729 | Pass |
| 15 | `B3U1NDUiwSA` | Quantum Computers Explained | 341s | 838 | MC/TF/SA/TF/MC | 5 | 0 | 2,451 | 9,058 | Pass |
| 16 | `hePb00CqvP0` | Periodic Table Trends | 450s | 1,124 | MC/SA/TF/TF/SA | 5 | 0 | 2,085 | 9,198 | Pass |
| 17 | `h24UmH38_LI` | What Are Covalent Bonds? | 342s | 683 | MC/SA/TF/SA/MC | 5 | 0 | 1,941 | 9,494 | Pass |
| 18 | `kKKM8Y-u7ds` | Newton's Laws | 654s | 2,261 | MC/SA/SA/TF/MC | 5 | 0 | 3,708 | 11,266 | Pass |
| 19 | `qV4lR9EWGlY` | Sound: Crash Course Physics #18 | 569s | 1,988 | MC/SA/TF/SA/TF | 5 | 0 | 3,893 | 11,753 | Pass |
| 20 | `PBn7iWzrKoI` | What caused the French Revolution? | 322s | 726 | MC/TF/SA/MC/TF | 5 | 0 | 2,522 | 11,055 | Pass |
| 21 | `PaxVCsnox_4` | Which voting system is the best? | 306s | 722 | MC/SA/SA/TF/MC | 5 | 0 | 2,646 | 11,336 | Pass |
| 22 | `0bf3CwYCxXw` | Separation of Powers and Checks and Balances | 499s | 1,791 | MC/SA/TF/MC/SA | 5 | 0 | 2,906 | 10,460 | Pass |
| 23 | `DX_zkaK5PaI` | Every Kind of Bridge Explained | 1,033s | 2,906 | MC/SA/SA/TF/MC | 5 | 0 | 4,453 | 12,027 | Pass |
| 24 | `Sq-y-wiZduE` | Renewable Energy’s Hidden Infrastructure Problem | 374s | 1,129 | MC/TF/SA/TF/MC | 5 | 0 | 1,947 | 9,836 | Pass |
| 25 | `WNvAic8KLb0` | Earthquakes Explained | 663s | 1,797 | MC/SA/TF/SA/TF | 5 | 0 | 2,549 | 10,378 | Pass |
| 26 | `ZiULxLLP32s` | Coral Reefs 101 | 213s | 410 | MC/TF/SA/SA/TF | 5 | 0 | 2,271 | 10,134 | Pass |
| 27 | `qYNweeDHiyU` | AI, Machine Learning, Deep Learning and Generative AI Explained | 598s | 1,793 | MC/SA/SA/MC/TF | 5 | 0 | 3,055 | 12,087 | Pass |
| 28 | `oefAI2x2CQM` | Protein Synthesis: Transcription and Translation | 512s | 1,398 | MC/TF/MC/TF/SA | 5 | 0 | 2,657 | 11,025 | Pass |
| 29 | `KNLUzqW8IuA` | The Carbon Cycle Process | 176s | 406 | MC/SA/SA/MC/TF | 5 | 0 | 1,868 | 9,710 | Pass |
| 30 | `p4pWafuvdrY` | How do ocean currents work? | 254s | 648 | MC/TF/SA/SA/TF | 5 | 0 | 2,459 | 11,542 | Pass |

## Automated gate evidence

- `npm run format:check`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed (API 152, app 90, extension 133, contracts 23, plus release-script and asset-verifier tests).
- `npm run build`: passed.
- Web asset verifier: 440 references across 30 HTML shells passed.
- Wrangler production configuration dry-run: passed; no deployment occurred.
- Extension ZIP SHA-256: `83696064820f7807b868bb2926e200bb5069cda20cc9bad9b7dacf466264130d`.
- The downloadable app ZIP and extension build ZIP have identical hashes.

## Scope and remaining release boundary

This report proves the local generator and deterministic storage/grading contracts against 30 new transcript inputs. It does not claim that prompt v5.11 is active in production: `QUIZ_V5_11_ROLLOUT` remains disabled, and no commit, push, Cloudflare deployment, Chrome extension replacement, or official-site learner matrix was performed in this task.

