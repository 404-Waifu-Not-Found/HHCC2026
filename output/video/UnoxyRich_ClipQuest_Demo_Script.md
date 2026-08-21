# ClipQuest Demo Video Script

**Target duration:** 4 minutes 25 seconds  
**Required output filename:** `UnoxyRich_ClipQuest_Demo.mp4`  
**Presentation type:** Concept demonstration using interface mockups, diagrams, and repository pages  
**Important disclosure:** Display "Concept demonstration - implementation is planned; no application code has been written yet" on the opening title card and in the closing credits.

## Recording plan

- Record at 1920 x 1080, 30 fps, landscape orientation.
- Keep the pointer movements slow and intentional. Hide notifications and unrelated browser tabs.
- Use clean mockups or slides for every product interaction. Do not present a mockup as a working application.
- Add English subtitles matching the narration. Commentary may be recorded in English or translated into Chinese.
- Export as H.264 MP4 and keep the final file below 500 MB.

## Timed script

### 0:00-0:15 - Project and team title

**Visual:** Fade in to the ClipQuest name, the line "From passive watching to active recall," and the status label "Concept demonstration." Show the exact GitHub team handle **@404-Waifu-Not-Found/cos**, the label **HHCC2026 Team**, and the four members: **UnoxyRich, JimmyfaQwQ, ILikeLayla (Layla), and Justin-Yonardo**.

**Narration - UnoxyRich:**  
"We are the HHCC2026 team at @404-Waifu-Not-Found/cos, and this is ClipQuest, our planned learning tool for turning public YouTube lessons into interactive quizzes. This video demonstrates our intended experience through concept mockups. Application development has not started yet."

### 0:15-0:42 - The problem

**Visual:** Show a learner watching a long educational video. Place the words "Watched" and "Can I recall it?" side by side, then show an empty notes page.

**Narration - ILikeLayla:**  
"Educational videos make knowledge easy to access, but watching can remain passive. A learner may finish a lesson and recognize its ideas without being able to recall or apply them. Creating practice questions manually takes more time and breaks the learning flow. We want to make active recall the natural next step after watching."

### 0:42-1:12 - Starting the planned workflow

**Visual:** Show a YouTube lesson mockup, click a clearly labeled ClipQuest extension mockup, and display a small panel with the lesson title, caption status, question types, and a "Create my quiz" button. Add a visible "Mockup" label.

**Narration - JimmyfaQwQ:**  
"The planned workflow begins on a public, captioned YouTube lesson. The learner will open the ClipQuest extension, confirm the lesson, choose a quiz length, and start generation. The extension will use the lesson captions as its source instead of asking the learner to copy notes into another tool."

### 1:12-1:45 - Local AI key and generation

**Visual:** Animate a simple flow: YouTube captions to local extension to DeepSeek. Show the API key remaining inside a device outline. Then show "Validating question 1" followed by "Question 1 ready."

**Narration - JimmyfaQwQ:**  
"The learner will provide a DeepSeek API key, which we plan to keep in local device storage. It will not be stored by our backend. Captions will be divided into concept segments, and generated questions will pass schema, grounding, duplication, and answer-consistency checks. Our goal is to admit the learner as soon as the first complete question is valid while the remaining questions continue generating."

### 1:45-2:38 - Core quiz interaction

**Visual:** Demonstrate three labeled mockups in sequence: a multiple-choice question, a true/false question, and a short-answer question. Select an answer, show reasoned feedback, advance the progress indicator, and display a recovery message for one intentionally invalid question.

**Narration - Justin-Yonardo:**  
"ClipQuest will support multiple-choice, true/false, and short-answer questions. The learner will answer one question at a time and receive a clear explanation connected to the lesson. Progress will stay visible without distracting from the current task. If a question is invalid or generation is interrupted, ClipQuest will retain accepted questions and retry only the missing part. It will never score a shortened quiz as though it were complete."

### 2:38-3:08 - Completion, library, and review

**Visual:** Show a completed-quiz screen with score, concepts to review, and a "Save lesson" action. Move to a library mockup containing saved lessons and a recent-attempt card.

**Narration - ILikeLayla:**  
"After every required question is answered, the learner will see a completion summary and concepts worth reviewing. Saved lessons and previous attempts will appear in a personal library. Over time, this can help students return to difficult material instead of treating each video as a one-time experience."

### 3:08-3:42 - Planned architecture

**Visual:** Show a clean architecture diagram: Chrome extension, React web app, and Expo mobile apps connected through shared TypeScript and Zod contracts; Cloudflare Workers, Hono, D1, and Better Auth on the storage side. Keep DeepSeek connected directly to the learner device.

**Narration - UnoxyRich:**  
"We plan to build ClipQuest as a TypeScript monorepo. React will support the web experience, React Native with Expo will support Android and iOS, and shared Zod contracts will keep quiz data consistent. Cloudflare Workers, Hono, D1, and Better Auth will handle authentication and learner-owned progress. Vitest, Playwright, real-browser checks, and device testing will verify the complete journey."

### 3:42-4:08 - Roadmap and impact

**Visual:** Show a four-step roadmap: shared contracts, one complete Chrome flow, storage and review, then mobile applications. Finish with multilingual learning, spaced repetition, and teacher sharing as future ideas.

**Narration - Justin-Yonardo:**  
"Our first milestone will be one complete Chrome journey: a public captioned lesson becomes a validated quiz, the learner answers every question, receives coherent feedback, and saves the completed attempt. Later, we hope to add multilingual support, spaced-repetition review, accessibility personalization, teacher-curated sharing, and caption-linked question citations."

### 4:08-4:25 - Team close

**Visual:** Show the four team members together on camera if possible. Otherwise, use a final team card with names, GitHub avatars used with permission, the repository URL, and "Thank you." End on the ClipQuest logo.

**Narration - all members, one line each:**  
"We want to turn more watching into meaningful practice."  
"We want AI-generated study material to remain grounded and recoverable."  
"We want learning tools to respect privacy and work across devices."  
"We are the HHCC2026 team at @404-Waifu-Not-Found/cos. Thank you for watching ClipQuest."

## Final export checklist

- Duration is 5:00 or less; target is approximately 4:25.
- Opening includes ClipQuest, team name, all four members, and concept-status disclosure.
- Every interface image is labeled as a mockup or concept.
- Narration and subtitles are synchronized and readable.
- No private API keys, email addresses, notifications, or unrelated tabs appear.
- Final frame includes the public repository: `https://github.com/404-Waifu-Not-Found/HHCC2026`.
- Final credits include the confirmed team page: `https://github.com/orgs/404-Waifu-Not-Found/teams/cos`.
- Export is MP4, H.264, and no more than 500 MB.
- Final filename is exactly `UnoxyRich_ClipQuest_Demo.mp4`.
