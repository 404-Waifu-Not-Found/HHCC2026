# Direct DeepSeek v5.12 No-Thinking Fresh-Video Audit

Date: 2026-08-15  
Execution boundary: current local ClipQuest generator -> DeepSeek API  
Chrome/extension UI/Worker involvement: none  
Repository state: local `main` working tree at `1cf12b7`; this report does not claim that the uncommitted candidate is deployed

`DEEPSEEK_API_KEY` was read from the local `.env`, was not printed, and was sent only to DeepSeek. Raw request/response and caption captures remain in `/tmp`; this report contains only safe source metadata and learner-visible audit conclusions.

## Candidate actually exercised

| Field              | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Extension package  | `0.8.17`                                                           |
| Model              | `deepseek-v4-flash`                                                |
| Protocol           | `10`                                                               |
| Prompt             | `quiz-local-json-stream-v5.12`                                     |
| Prompt fingerprint | `94641a9a9e993b73504b16d82bbdcb85acfdeb493d60b879ad8fb6347e3aa668` |
| Validator          | `validator-minimal-gradeability-v5.3`                              |
| Profile            | `prompt_first_auto_v5_12`                                          |
| Thinking           | `thinking: { type: "disabled" }` on every request                  |
| `reasoning_effort` | absent on every request                                            |
| `top_p`            | absent on every request                                            |
| Temperature        | `0.2` on every request                                             |
| Response mode      | streamed JSON on every request                                     |

The SHA-256 hash of the system message exported by the current generator, the system message actually captured in all DeepSeek request bodies, and the reported prompt fingerprint were identical. Usage reported zero reasoning tokens on every call.

## Ten fresh sources and final full-matrix results

The ten video IDs were absent from the repository's prior QA source ledgers. No previous AP-math course was reused. Every source had a usable human-authored English caption track.

| Run | Category               | Source                                                                                         | Words | Duration |      Q1 | Full bank | Calls | Retries | Result |
| --: | ---------------------- | ---------------------------------------------------------------------------------------------- | ----: | -------: | ------: | --------: | ----: | ------: | ------ |
|   1 | Geology                | [Why are earthquakes so hard to predict?](https://www.youtube.com/watch?v=jhRuUoTnA6g)         |   655 |    294 s | 3.134 s |  13.408 s |     5 |       0 | 5/5    |
|   2 | Organic chemistry      | [What Is Organic Chemistry?](https://www.youtube.com/watch?v=PmvLB5dIEp8)                      | 1,866 |    615 s | 5.002 s |  13.875 s |     5 |       0 | 5/5    |
|   3 | Network routing        | [Routing Tables - CCNA Explained](https://www.youtube.com/watch?v=CGmTvukObOw)                 | 1,862 |    793 s | 3.996 s |  13.119 s |     5 |       0 | 5/5    |
|   4 | Civil engineering      | [How to Clean Sewage with Gravity](https://www.youtube.com/watch?v=kppxoA3gWco)                | 2,091 |    710 s | 4.565 s |  14.122 s |     5 |       0 | 5/5    |
|   5 | Medicine               | [How does anesthesia work?](https://www.youtube.com/watch?v=B_tTymvDWXk)                       |   639 |    296 s | 2.283 s |  10.875 s |     5 |       0 | 5/5    |
|   6 | History                | [What caused the French Revolution?](https://www.youtube.com/watch?v=PBn7iWzrKoI)              |   726 |    339 s | 2.574 s |  11.885 s |     5 |       0 | 5/5    |
|   7 | Earth science          | [Introduction to plate tectonics](https://www.youtube.com/watch?v=7jbwX1Uvd18)                 |   808 |    275 s | 2.493 s |  11.229 s |     5 |       0 | 5/5    |
|   8 | Electrochemistry       | [How batteries work](https://www.youtube.com/watch?v=9OVtk6G2TnQ)                              |   586 |    259 s | 2.445 s |  11.390 s |     5 |       0 | 5/5    |
|   9 | Immunology             | [How does your immune system work?](https://www.youtube.com/watch?v=PSRJfaAYkW4)               |   722 |    323 s | 2.396 s |  12.250 s |     5 |       0 | 5/5    |
|  10 | Structural engineering | [How one design flaw almost toppled a skyscraper](https://www.youtube.com/watch?v=x0tcRqf7ciY) |   659 |    316 s | 2.743 s |  12.602 s |     5 |       0 | 5/5    |

Totals for the exact-fingerprint full matrix:

- Completed banks: **10/10**
- Accepted questions: **50/50**
- DeepSeek calls: **50**, all primary
- Automatic retries: **0**
- Content-repair requests: **0**
- Reasoning tokens: **0**
- Q1 median: **2.659 s**
- Q1 p95: **5.002 s**
- Full-bank median: **12.426 s**
- Full-bank p95: **14.122 s**
- Input tokens: **245,146**, including **174,336** reported cache-hit tokens
- Output tokens: **6,609**

## Learner-visible audit

Every question, correct answer, multiple-choice distractor, True/False correction, short-answer target, and explanation was manually reviewed.

The final candidate removed the defects found in preceding iterations:

- No lesson/video/transcript attribution or course logistics was accepted.
- The incidental `1 to 20 centimeters per year` plate-speed item was removed from evidence assignment.
- The hypothetical `imagine if the continents were still connected` presentation line was removed from evidence assignment.
- Dynamic routing now exchanges route information that populates a routing table; it no longer claims that every protocol exchanges whole routing tables.
- The anesthesia enumeration now asks for exactly three additional effects besides unconsciousness: movement, memory formation, and ideally pain perception.
- Activated B-cells produce antibodies that bind specific antigens and help neutralize a threat; the learner copy no longer says antibodies directly attack invading cells.
- Battery evidence assignment separates electron transfer, reduction, surface degradation, recharging, and finite non-rechargeable metal supply.
- Volta/Galvani anecdotal framing is not used as an assessment target.
- Multiple-choice answer order remains locally constructed; all four options were unique and the canonical answer mapping was coherent.
- True/False corrections were factually aligned with the stored boolean.
- Atomic short answers such as `Reduction` and `Antibodies` remained concise and gradeable.

The exact-fingerprint full matrix revealed one last battery True/False wording problem: changing `prevent` to `promote` while retaining the consequence `no electrons ... battery dies` made the false alternative internally inconsistent. The type-specific prompt was narrowed to one relationship, and the same source was replayed with the same system fingerprint:

> False: Metal-surface imperfections caused by repeated cycling promote proper oxidation.  
> Correction: Metal-surface imperfections caused by repeated cycling prevent proper oxidation.

That post-fix battery replay completed **5/5** in **5 primary calls**, with **0 retries**, **0 reasoning tokens**, Q1 in **4.036 s**, and the full bank in **14.846 s**. The change affects only the battery-surface True/False suffix; the stable system-message fingerprint and the other nine full-matrix request contracts are unchanged.

Two candidate sources were intentionally rejected before the final matrix:

- An RSA source did not provide enough independent clean caption windows for five prompt-only objectives.
- A modem/router source contained an oversimplified switching statement and produced an ambiguous modem distractor.

They were replaced rather than counted as successful banks.

## Code and test outcomes

The benchmark led to prompt/input-layer changes only; it did not add a runtime editorial rejection loop. The retained runtime validation remains structural and grading-oriented.

Implemented corrections include:

- Stronger no-thinking v5.12 system instructions for direct concepts, exact roles, True/False coherence, routing terminology, anesthesia cardinality, and antibody wording.
- Evidence clustering for battery degradation, recharging, external-circuit flow, and repeated continental/sedimentation objectives.
- Removal of narrative, sponsor, historical-presentation, vague-hypothetical, and incidental-rate spans before per-ordinal evidence assignment.
- Local v5.11/v5.12 fallback for a model response that supplies only a supported True statement for a planned False slot, avoiding a needless retry while preserving a coherent grade.

Verification:

- Extension tests: **158/158 passed**.
- Formatting: passed.
- Lint: passed.
- Workspace typecheck: passed.
- DeepSeek request/body reconciliation: passed; captured HTTP calls equal reported calls.
- Secret boundary: passed; no API key was printed or written to this report.

## Verdict and boundary

**Good direct-generation result.** The current local generator completed all ten fresh banks with one primary call per question, zero automatic retries, zero reasoning tokens, fast Q1 latency, and no critical factual or grading defect in the post-fix audit.

This is not a production deployment or official-site acceptance claim. Chrome, the installed extension artifact, the page bridge, Worker persistence, learner answering, scoring, Library, resume, and production rollout were outside this direct-local benchmark. No commit, push, deployment, extension installation, or production data change was performed.
