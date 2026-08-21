# Direct DeepSeek Prompt-First v5.12 Remediation QA

Date: 2026-08-14  
Execution boundary: local ClipQuest generator -> DeepSeek API  
Browser/Worker involvement: none  
Secret handling: `DEEPSEEK_API_KEY` was read from the local `.env` and was not printed, persisted in this report, or sent to ClipQuest infrastructure.

## Candidate

- Extension: `0.8.17`
- Protocol: `10`
- Capability: `question-stream-v7`
- Prompt: `quiz-local-json-stream-v5.12`
- Validator: `validator-minimal-gradeability-v5.3`
- Progressive import: `extension-progressive-import-v8`
- Profile: `prompt_first_auto_v5_12`
- Pipeline: `9`
- Model: `deepseek-v4-flash`

The candidate keeps the prompt-first/minimal-validation boundary. Runtime editorial classifiers were not restored. The remaining runtime safeguards are structural or grading-integrity operations, and bounded presentation repairs occur locally without another model request.

## Defects reproduced and fixed

1. Punctuation-free auto-caption fragments were promoted as incomplete grading facts and could be reordered around their center fragment.
   - Fixed by preserving chronological neighboring context and assigning the complete bounded window when sentence punctuation is sparse.
2. True/False explanation/correction similarity checks caused avoidable polarity retries.
   - Removed the semantic similarity retry gate.
   - Canonically identical statement/correction pairs, including clause reordering and discourse-only words, now become locally graded True items without another request.
   - v5.12 uses the canonical correction as feedback for both True and False items so feedback cannot contradict the grade.
3. A vague short-answer keyword gate exhausted the AI explainer bank at 4/5.
   - Removed the editorial keyword rejection.
   - The prompt now requires precise preceding-word patterns instead of the caption phrase `certain types`.
4. Worked arithmetic examples could be mistaken for formula objectives.
   - Formula assignment now requires a complete symbolic or verbal formula rather than any equation-like example.
   - Presentation-bound equation windows are deprioritized.
5. Valid formulas with numbered or underscored variables were rejected (`W1`, `m2`, `F_net`, `m_total`).
   - Both extension and backend expression parsers now accept conventional one-letter variables with numeric or underscore subscripts while retaining the prose-identifier penalty.
   - Formula-mode DeepSeek schemas require `formulaTokens`.
   - If the model asks what a symbol means while returning a formula rubric, ClipQuest locally creates a formula-requesting stem and matching formula feedback.
6. Learner-visible presentation remnants appeared as `the passage states`, `private content states`, `described scenario`, `the example illustrates`, and `as shown by`.
   - Added bounded local presentation normalization; it does not reject or regenerate the question.
7. Manual review found an invented temporal relationship and an action-reaction misconception.
   - The prompt now prohibits unsupported before/after/simultaneous/absolute claims.
   - It explicitly preserves equality within an action-reaction pair and attributes motion to additional external forces and object-specific net force.
8. Promotional auto-caption spans such as `learn more ... click here` and `test your knowledge ... click here` could enter candidate windows.
   - These spans are removed during source preparation before DeepSeek is called.

## Final ten-bank direct matrix

All sources are real educational-video transcripts from the fixed v5.11 comparison set, allowing the model/prompt change to be isolated. Every bank requested five mixed-type questions.

| Run | Source | Words | Duration | Q1 interactive | Full bank | Calls | Retries | Result |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | The continents are moving. When will they collide? | 684 | 291 s | 3.469 s | 13.661 s | 5 | 0 | 5/5 |
| 2 | DNA Replication (Updated) | 1,305 | 474 s | 3.449 s | 15.252 s | 5 | 0 | 5/5 |
| 3 | Morphology: Crash Course Linguistics #2 | 2,000 | 646 s | 4.481 s | 13.222 s | 5 | 0 | 5/5 |
| 4 | What Is Opportunity Cost? | 419 | 164 s | 2.582 s | 11.533 s | 5 | 0 | 5/5 |
| 5 | Elliptic Curves - Computerphile | 1,863 | 522 s | 2.579 s | 12.396 s | 5 | 0 | 5/5 |
| 6 | How do Lithium-ion Batteries Work? | 1,462 | 568 s | 3.290 s | 11.715 s | 5 | 0 | 5/5 |
| 7 | Newton's Laws: Crash Course Physics #5 | 2,261 | 654 s | 5.068 s | 17.095 s | 5 | 0 | 5/5 |
| 8 | What caused the French Revolution? | 726 | 322 s | 2.150 s | 10.424 s | 5 | 0 | 5/5 |
| 9 | AI, Machine Learning, Deep Learning and Generative AI Explained | 1,793 | 598 s | 3.191 s | 13.531 s | 5 | 0 | 5/5 |
| 10 | How do ocean currents work? | 648 | 254 s | 2.396 s | 11.571 s | 5 | 0 | 5/5 |

Totals:

- Completed banks: **10/10**
- Accepted questions: **50/50**
- DeepSeek requests: **50**
- Primary calls: **50**
- Automatic retries: **0**
- Q1 median: **3.191 s**
- Q1 p95: **5.068 s**
- Full-bank median: **12.396 s**
- Full-bank p95: **17.095 s**
- Input tokens: **66,212**
- Output tokens: **7,304**
- Reasoning tokens: **0**

The lexical audit marked one AI/cybersecurity answer for manual review because the answer paraphrased the caption with low token overlap. Manual inspection found the answer correct, specific, and gradeable; this was a review signal, not a runtime retry or release defect.

## Targeted post-matrix verification

- Newton all-short formula bank after parser repair: **5/5**, five calls, zero retries.
- Continental drift + Newton + French Revolution + AI defect replay: **20/20**, twenty calls, zero retries.
- French Revolution after canonical True/False feedback normalization: **5/5**, five calls, zero retries; no private-content attribution remained.

Intermediate failed artifacts were preserved under `/tmp` during diagnosis. They are not release evidence and were not substituted for successful banks:

- v5.12 initial run: 9/10; AI q5 exhausted a vague-answer check.
- first remediation rerun: 9/10; Newton q2 exposed numbered-variable formula rejection.
- Newton all-short diagnostic captured only model response bodies locally and proved DeepSeek emitted structurally coherent formulas; no key or authorization data was captured.

## Automated and build gates

- `git diff --check`: pass
- `npm run format:check`: pass
- `npm run lint`: pass
- `npm run typecheck`: pass
- `npm test`: pass
  - API: 153/153
  - App: 90/90
  - Extension: 140/140
  - Contracts: 23/23
  - Release/asset script tests: 10/10
- `npm run build`: pass
- Web shell asset verification: 440 references across 30 HTML shells
- Wrangler production dry-run: pass
- Extension ZIP SHA-256: `a9f5f98477932a38da7224460adf8bd5dd1a25436860743639ad7984b73b8935`
- Public download ZIP and built ZIP hashes match.

## Scope and release status

This QA run validates the local generator, deterministic grading structures, compatibility contracts, builds, and direct DeepSeek behavior. It does **not** claim that v5.12 is active in production: `QUIZ_V5_12_ROLLOUT` remains disabled, and no commit, push, extension installation, database mutation, or Cloudflare deployment was performed in this remediation turn.
