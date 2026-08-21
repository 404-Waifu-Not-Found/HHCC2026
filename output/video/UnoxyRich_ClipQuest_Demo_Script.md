# ClipQuest Demo Video Script

**Target duration:** 4 minutes 30 seconds (hard limit 5:00)
**Required output filename:** `UnoxyRich_ClipQuest_Demo.mp4`
**Presentation type:** Live product demonstration — real Chrome session against the production site, real YouTube lesson, real generated quiz. No mockups.
**Status line for the title card and closing credits:** "Live product demonstration — recorded on the production deployment at clipquest.ccwu.cc."

## Recording plan

- Record at 1920 × 1080, 30 fps, landscape. Light theme for the main flow; show the dark theme once.
- Use a fresh learner account and a public captioned lesson that the team has **not** quizzed before (a TED-Ed or Crash Course video works well; keep a second URL ready).
- The DeepSeek key must already be saved in the extension popup. Never show the popup with the key visible; blur or skip it.
- Keep pointer movement slow. Hide notifications, bookmarks, and unrelated tabs. No e-mail addresses on screen.
- Add English subtitles that match the narration; narration may be English or Chinese.
- Export H.264 MP4, ≤ 500 MB. Confirm the file name before upload.
- Dry-run the complete flow once before recording so the extension is detected and question 1 appears in single-digit seconds.

## Timed script

### 0:00–0:15 — Title and team

**Visual:** ClipQuest lockup on the brand green, the line "Watch → recall → review", the status line above, the team handle **@404-Waifu-Not-Found/cos**, the label **HHCC 2026 · Education track**, and the four members: **UnoxyRich, JimmyfaQwQ, ILikeLayla (Layla), Justin-Yonardo**.

**Narration — UnoxyRich:**
"We are team cos from 404-Waifu-Not-Found, and this is ClipQuest: a working learning tool that turns any public YouTube lesson into a grounded quiz, grades you with reasoning, shows what you missed, and schedules your review."

### 0:15–0:40 — The problem

**Visual:** A learner watching a long lesson; the words "Watched" and "Can I recall it?" side by side; then an empty notes page.

**Narration — ILikeLayla:**
"Video is the easiest way to access an explanation and the easiest way to learn passively. You recognise every idea on replay and still cannot reproduce it tomorrow. Learning science has a clear answer — retrieval practice with immediate feedback, spaced over time — but after a video almost nobody does it, because writing good questions takes longer than watching. ClipQuest makes it the default next step."

### 0:40–1:10 — Paste a link, pick the format

**Visual (live):** clipquest.ccwu.cc Home. Paste the lesson URL. Point at the three question-type toggles (multiple choice, true/false, short answer). Click **Make my quest**. The video preview appears with title, channel, duration, and caption language.

**Narration — JimmyfaQwQ:**
"On the production site I paste a lesson, keep all three question types, and press Make my quest. ClipQuest confirms the video and its captions before any AI call is made — no captions, no quiz; we never download audio or invent questions."

### 1:10–1:40 — Question 1 in seconds, the rest stream in

**Visual (live):** The processing screen with the ready-to-start ETA, then the quiz opens on question 1 while the stream indicator shows "1/10 questions ready", "2/10", … Briefly overlay a simple diagram: captions → extension → DeepSeek (key stays on the device) → validated question → ClipQuest.

**Narration — JimmyfaQwQ:**
"Our extension reads the public captions, strips timestamps, and asks DeepSeek for question one only, with the learner's own key stored on the device. Each question is validated — schema, grounding, duplicates, answer consistency — before it is accepted, and the quiz opens as soon as the first one passes. In our latest live run that took 6.4 seconds. The remaining questions keep streaming while I am already answering."

### 1:40–2:40 — Answer, get reasoning, retry a miss

**Visual (live):** Answer a multiple-choice question correctly → green panel with "Why". Answer a true/false question **wrong on purpose** → red panel shows "Reason", the **correct answer**, and "Marked incorrect". Press Next; a few questions later the same concept returns reworded with the retry badge; answer it correctly. Answer a short-answer question in your own words and show it graded.

**Narration — Justin-Yonardo:**
"Every answer is graded immediately with the reasoning, not just right or wrong. When I miss this one, ClipQuest shows me the correct answer and the why — and brings the concept back later in the session, worded differently, so I get a second retrieval attempt. Short answers are graded deterministically on the server against a rubric, so the learner's text never goes to a second model."

### 2:40–3:20 — Completion: what to review, mastery, cheat sheet

**Visual (live):** Finish the last question. Completion screen: score, mastery tile, question count, **"Right first try 8/10"**, then scroll to **"What to review"** — the missed question with "Your answer", "Correct answer", "Why", and the "Recovered on retry" badge. Click **Download PDF**; open the one-page cheat sheet (Summary, Key concepts, Definitions, Remember this).

**Narration — ILikeLayla:**
"At the end I do not just get a score. I get exactly which ideas I missed, what the right answer was and why, and whether I recovered on the retry — that is the feedback that changes what you study next. The cheat sheet is generated locally from the same validated questions and exported as a one-page PDF I can keep."

### 3:20–3:45 — Library and spaced review

**Visual (live):** Library tab: the lesson card with its score and mastery state; point at a card marked **Due for review**; open it in review mode for two seconds. Show the dark theme briefly.

**Narration — Justin-Yonardo:**
"Every lesson lands in the Library. Scoring 80 percent schedules a review three days later; passing that review marks the video mastered, and a miss pulls the next review to tomorrow. It is simple spacing today, and the recap data we now collect is the basis for per-concept scheduling next."

### 3:45–4:10 — Architecture and proof

**Visual:** One clean diagram: Chrome extension + web + Expo Android/iOS sharing Zod contracts and the local quiz engine; Cloudflare Workers, Hono, D1, Better Auth on the storage side; DeepSeek connected only to the learner's device. Then a quick cut to the GitHub Actions page with a green run and the `qa-results/` folder.

**Narration — UnoxyRich:**
"ClipQuest is a TypeScript monorepo: React web, Expo Android and iOS, a Manifest V3 extension, and a Cloudflare Worker, all sharing one versioned quiz contract. Generation runs on the learner's device; the server stores only validated questions and progress — never captions, prompts, or keys. Seven hundred-plus tests and twenty-four browser journeys run in CI, and every production claim in the repo links to a dated acceptance report."

### 4:10–4:30 — Close

**Visual:** Team card with names and the repository URL `https://github.com/404-Waifu-Not-Found/HHCC2026`, then the ClipQuest lockup.

**Narration — one line each:**
"We want to turn more watching into practice." (UnoxyRich)
"We want AI study material to stay grounded and honest about failure." (JimmyfaQwQ)
"We want feedback that tells you what to do next, not just a score." (ILikeLayla)
"We are team cos. Thank you for watching ClipQuest." (Justin-Yonardo)

## Final export checklist

- Duration ≤ 5:00; target ≈ 4:30.
- Title card shows ClipQuest, team handle, all four members, and the live-demo status line.
- The recording is a real session on clipquest.ccwu.cc with a previously unused public lesson.
- No API key, e-mail address, notification, or unrelated tab appears.
- Subtitles and narration are synchronised and readable.
- Final frame shows `https://github.com/404-Waifu-Not-Found/HHCC2026` and the team page `https://github.com/orgs/404-Waifu-Not-Found/teams/cos`.
- MP4, H.264, ≤ 500 MB, file name exactly `UnoxyRich_ClipQuest_Demo.mp4`.
