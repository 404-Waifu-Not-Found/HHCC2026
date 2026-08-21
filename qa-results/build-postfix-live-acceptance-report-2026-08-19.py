from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, TableStyle


ROOT = Path("/Users/unoxyrich/Documents/GitHub/ClipQuest")
OUT = ROOT / "output/pdf/clipquest-postfix-live-acceptance-report-2026-08-19.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

GREEN = colors.HexColor("#173b2d")
MID = colors.HexColor("#587267")
PALE = colors.HexColor("#e4f1e8")
LINE = colors.HexColor("#bcd2c2")
AMBER = colors.HexColor("#fff3d6")
RED = colors.HexColor("#f8dfdd")
BLUE = colors.HexColor("#e4eff8")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CQTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=20, leading=24, alignment=TA_CENTER, textColor=GREEN, spaceAfter=9))
styles.add(ParagraphStyle(name="CQSub", parent=styles["Normal"], fontSize=8.5, leading=12, alignment=TA_CENTER, textColor=MID, spaceAfter=13))
styles.add(ParagraphStyle(name="CQH2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13.5, leading=17, textColor=GREEN, spaceBefore=8, spaceAfter=5))
styles.add(ParagraphStyle(name="CQH3", parent=styles["Heading3"], fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=GREEN, spaceBefore=6, spaceAfter=4))
styles.add(ParagraphStyle(name="CQBody", parent=styles["BodyText"], fontSize=8.6, leading=12, spaceAfter=5))
styles.add(ParagraphStyle(name="CQSmall", parent=styles["BodyText"], fontSize=6.5, leading=8.2, spaceAfter=1))
styles.add(ParagraphStyle(name="CQTiny", parent=styles["BodyText"], fontSize=5.8, leading=7.2, spaceAfter=0))


def para(value, style="CQBody"):
    value = str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(value, styles[style])


def bullet(value):
    return para("- " + value)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 6.5)
    canvas.setFillColor(MID)
    canvas.drawString(0.5 * inch, 0.28 * inch, "ClipQuest post-fix live QA - AI-only generation/grading boundary")
    canvas.drawRightString(8.0 * inch, 0.28 * inch, f"Page {doc.page}")
    canvas.restoreState()


def table(rows, widths, tiny=True, header_color=PALE):
    style = "CQTiny" if tiny else "CQSmall"
    data = [[para(c, style) if not isinstance(c, Paragraph) else c for c in row] for row in rows]
    result = LongTable(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), header_color),
        ("GRID", (0, 0), (-1, -1), 0.25, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3.5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return result


story = [
    Spacer(1, 0.18 * inch),
    para("ClipQuest post-fix live acceptance report", "CQTitle"),
    para("19 August 2026 - ten-link Chrome evidence, native Android live interaction, iOS baseline, AI quiz generation, answer flows, grading, question quality, and cheat-sheet export", "CQSub"),
    para("Executive result", "CQH2"),
    para("The current release is deployed and the AI-only boundary is intact: quiz generation is local through the updated Chrome extension or native DeepSeek configuration, while the Worker stores metadata and artifacts. The post-fix Chrome pass produced several complete five-question quizzes with reasoned grading and ready cheat sheets. A fresh Android run reached real questions and reason-first grading, but its tenth local generation call was interrupted. The iOS evidence available in this turn is a ten-link baseline from the previous native binary, not acceptance evidence for commit 2456fa0. Therefore the requested ten videos on every platform are not green yet.", "CQBody"),
]

overview = [
    ["Surface", "Coverage", "Best verified result", "Current blocker", "Decision"],
    ["Chrome web", "10 distinct YouTube IDs; updated extension 0.8.22", "5 best-run banks reached 5/5; MC/TF/short answers completed; AI reasons visible; completion state and Export notes enabled", "Several concurrent tabs still show network interruptions, one invalid generation event, and an automated browser download-capture gap", "AMBER - repeat after cleanup"],
    ["Android emulator", "1 fresh signed-in QA account; IETP source exercised", "q1 correct; q2 incorrect with a soft reason; 9/10 generation calls accepted", "final call abandoned as network_interrupted; quiz remained on retrying and never reached completion/export", "RED - P0 transport/recovery"],
    ["iPhone 17 Pro simulator", "10-link native baseline exists, but not rebuilt/re-run against 2456fa0", "historical baseline reached imported videos and some graded questions", "old binary showed partial banks, protocol mismatch, short-answer failures, and no native Library export action", "BLOCKED - fresh current-build run required"],
]
story += [table(overview, [1.0 * inch, 1.3 * inch, 2.55 * inch, 2.05 * inch, 0.9 * inch], tiny=True), Spacer(1, 0.1 * inch)]

story += [para("Release evidence", "CQH2")]
for item in [
    "Source: main and origin/main at 2456fa0. The patch adds an active local-generation lease guard so fresh DeepSeek calls are not incorrectly abandoned by automatic recovery.",
    "Cloudflare: Worker version c5fe540f-2649-4fb2-be83-c96fdbd249d9, tag 2456fa0, promoted to 100%. Health returned ok=true, prompt quiz-local-json-stream-v5.12, validator v5.3, storage-only/local-extension generation, and request-key affinity.",
    "Extension: ClipQuest Local AI 0.8.22, unpacked build reloaded in Chrome; ZIP SHA-256 8e4f240d100439ec7c8f44828091f8ef5ace75369f9d5968d6b907444a0635d8.",
    "Automated verification: root typecheck, full API suite (27 files / 179 tests), app tests (34 files / 141 tests), extension tests (111/111), full build, and web asset verification passed before live QA.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Chrome: ten-link live matrix", "CQH2"), para("The runner used production ClipQuest, all three question types, Yes, quiz me, and Short - 5. Rows report the best verified post-fix run for each link; lingering tabs also generated separate telemetry, so a single noisy tab is not presented as the product average.", "CQBody")]
chrome = [
    ["#", "YouTube ID", "Best generation result", "Answer / grading evidence", "Cheat sheet"],
    ["1", "dEFtrYG9P40", "2/5 in latest tab; an earlier run reached q2", "MC correct; short answer accepted in one run with an AI reason", "Not fresh-ready in latest tab"],
    ["2", "ZwnL06lfK_0", "5/5; D1 bank 36b9bd06... passed; retryCount 0", "MC, TF, and short-answer path completed with stored reasons", "Ready metadata observed"],
    ["3", "STWIAcZfyK0", "5/5", "All five completed; MC, TF, and short answer correct; AI/server reasons visible", "Ready; sheet 3666bfb3-7aef-4887-8861-314a9211c711"],
    ["4", "IETP-QEBhKw", "5/5", "MC, TF, short answer, TF, MC; all answered correctly with reasons", "Ready; D1 calls 0-4 complete"],
    ["5", "NytVSSjPEgA", "5/5; D1 bank fdc1679b... passed; retryCount 0", "q4 short answer accepted: “Round-off error, also called rounding error.” with AI reason; math rendered", "Ready; sheet 2631e259-6fc0-4d11-b390-422652e44140"],
    ["6", "xWGMp4nyQtA", "1/5 latest; an earlier run completed with retry", "MC correct; later run hit network_interrupted on call 1", "Not fresh-ready in latest tab"],
    ["7", "_TVkBfFDUwA", "5/5; D1 bank e9842810... passed; retryCount 0", "Mixed types answered; completion state reached", "Ready metadata observed"],
    ["8", "KqxEtj5VvZs", "0/5; creation stopped", "No question; invalid generation call event surfaced", "Unavailable"],
    ["9", "K5DwJ1HeYJc", "1/5 latest; call 1 network_interrupted", "q1 MC correct; generation did not finish", "Unavailable"],
    ["10", "Wp7xBG6QlY8", "3/5 latest; call 3 network_interrupted", "q1/q2 correct; q3 short answer was initially rejected with a reason, retry was accepted", "Unavailable in latest tab"],
]
story.append(table(chrome, [0.23 * inch, 1.1 * inch, 1.6 * inch, 2.75 * inch, 1.72 * inch], tiny=True))
story += [Spacer(1, 0.08 * inch), para("Chrome export check", "CQH3"), para("The fresh Nyt completion screen exposed an active Export notes button and a ready private cheat-sheet record. A browser download event was not captured by the automation harness, so this is UI/server readiness evidence rather than a filesystem proof for that fresh run. Separately, an existing completed Library artifact at /Users/unoxyrich/Downloads/APCSP-U1-L8-Color-Images-cheat-sheet.pdf was inspected: 2,043 bytes, one Letter page, and legible after Poppler rendering. The web export path is therefore operational, but its automated download assertion needs a stronger wait/filename check.", "CQBody")]

story += [PageBreak(), para("Android: native live interaction", "CQH2"), para("A fresh account qaandroid819@example.com was created and verified for this run. The Android emulator was booted, the debug build ran with Metro, and the DeepSeek key was configured in Settings → Local AI without exposing the key in logs or this report. The source was IETP-QEBhKw and the native default session length was ten questions.", "CQBody")]
android_rows = [
    ["Stage", "Observed result", "Evidence / impact"],
    ["Setup", "Home, Settings, Local AI, import, and Video ready all worked", "Native UI rendered; key status changed to Configured on this device"],
    ["Question 1", "Multiple choice selected and checked correct", "Visible feedback: Nice! That’s right."],
    ["Question 2", "True/false selected True and checked incorrect", "Soft reason-first feedback explained that 100 patterns are 0 through 99, not 1 through 100; no harsh fallback text"],
    ["Background generation", "Calls 0-7 completed, accepted_count 1 each", "D1 telemetry: nine of ten question slots were accepted"],
    ["Final call", "Call 8 abandoned as network_interrupted after approximately 120 seconds", "Quiz remained at q2 retrying; no completion score or export action was reachable"],
]
story.append(table(android_rows, [1.2 * inch, 2.0 * inch, 4.2 * inch], tiny=False))
story += [para("Android defect assessment", "CQH3"), bullet("The native key and question renderer are functional; the failure is in transport/recovery at the last local-generation call, not a missing AI key."), bullet("The learner could answer while generation continued, satisfying the non-blocking design up to the point where the current question needed the missing suffix."), bullet("The retrying state needs a bounded, visible recovery action and must never strand a learner indefinitely after the final call is abandoned."), para("iOS boundary", "CQH2"), para("The available ten-link iOS evidence is the prior native binary, not the 2456fa0 build. That baseline showed partial generation, a protocol-version union error on KqxEtj5VvZs, repeated short-answer no-reason decisions, and no Export notes action in Library. It is included as a known-problem inventory, not as a current-release pass. A fresh iOS build/run is still required before claiming cross-platform acceptance.", "CQBody")]

story += [PageBreak(), para("Confirmed problems to fix", "CQH2")]
issues = [
    ["ID", "Priority", "Confirmed live problem", "Fix / acceptance test"],
    ["P0-1", "P0", "Generation suffix calls can be abandoned as network_interrupted on Chrome and Android; learner stays in Preparing/Retrying and cannot complete.", "Trace dispatch, stream activity, completion, and abort per ordinal. Keep the active-call lease through the actual DeepSeek timeout; add one bounded reconnect and an explicit Retry generation action. Acceptance: ten fresh links complete the selected bank or show an actionable terminal error, never an unbounded spinner."],
    ["P0-2", "P0", "KqxEtj5VvZs produced an invalid generation call event instead of a repaired question.", "Share one v5 request/event schema between extension, native clients, and API. Validate at the bridge and log a redacted schema error. Acceptance: malformed event is rejected and only the missing suffix is retried."],
    ["P0-3", "P0", "Short-answer grading sometimes lacks the required AI reasoned decision.", "Require DeepSeek tool output {is_correct, reason}; bounded retries for malformed output; preserve quiz completion but expose retry/configuration state. Acceptance: exact, paraphrased, incomplete, and fragment answers each receive a reason before correct/incorrect."],
    ["P1-1", "P1", "True/false grading can infer an unstated absolute claim (for example “can” treated as “always”) or flip polarity after retry.", "Grade the literal proposition and preserve polarity. Add qualifiers/polarity lint plus adversarial tests for can/may/only/always, negation, and zero-based ranges."],
    ["P1-2", "P1", "Some math prompts omit assumptions such as whether symbols may repeat; a 90-pattern item became ambiguous.", "Require order/repetition assumptions in the question and validate the numeric explanation against the answer key before accepting the item."],
    ["P1-3", "P1", "One live short-answer prompt drifted from Black and White Images into package-tracking frequency.", "Run concept-overlap/source-grounding validation against primer and quiz context; regenerate only the offending item."],
    ["P1-4", "P1", "Native Library did not expose Export notes in the baseline iOS UI; fresh iOS parity remains unverified.", "Add ready/preparing/retry/disabled actions to native VideoCard and completion screen; test private download and expo-sharing on both native platforms."],
    ["P2-1", "P2", "Fresh Chrome Export notes was active and server-ready, but the browser harness did not observe a download event.", "Wait for the actual download path, assert safe filename and file bytes, then render the PDF in CI/QA. Keep the server artifact check separate from the filesystem assertion."],
    ["P2-2", "P2", "Chrome has multiple lingering tabs producing concurrent telemetry and making latest-tab results noisy.", "Close each isolated tab after capture, persist one run ledger per video, and label best-run versus latest-run data in the report."],
]
story.append(table(issues, [0.5 * inch, 0.42 * inch, 2.65 * inch, 4.0 * inch], tiny=True))
story += [para("Question-quality observations", "CQH2")]
for item in [
    "Positive: completed post-fix banks mixed multiple choice, true/false, and short answer; accepted short answers included concise paraphrases and complete fragments, and the grader supplied a reason before the decision.",
    "Positive: the Android q2 response demonstrates softer grading language (“Almost—try this concept another way”) while still explaining the zero-based correction.",
    "Risk: duplicate concepts are tolerable only when the prompt and answer target differ. Exact repeat detection still belongs in the question-bank validator.",
    "Risk: incomplete banks must never receive a completion score or cheat-sheet export. The live partial runs correctly remained unexportable, but the learner-facing recovery needs to be more decisive.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Retest plan and release decision", "CQH2")]
for item in [
    "1. Fix the v5 bridge envelope and network-interruption recovery first. Run one clean browser tab and one clean native session; prove every ordinal has a completed lifecycle event.",
    "2. Exercise the AI grader with exact, paraphrased, incomplete, fragmentary, unsupported-absolute, negated, and true/false polarity cases. Assert reason-first output and a softer but stable decision.",
    "3. Add source-grounding, assumption, and duplicate-target validators. Reject only the bad item and regenerate the missing suffix; do not restart a good prefix.",
    "4. Rebuild the iOS binary from 2456fa0 or later, then run the same ten-link ledger. Verify Android with the repaired emulator path, including completion and share/export.",
    "5. Rerun Chrome, iOS, and Android independently with all three question types, answer every question, capture D1 generation events, download each ready PDF, and render-check the bytes. Only then call the release green.",
]:
    story.append(bullet(item))
story += [para("Final decision", "CQH2"), para("Not green for the requested scope. The current deployment and AI-only architecture are healthy enough for focused repair, and Chrome has credible post-fix full-run evidence. The remaining P0 generation/transport and grading-envelope failures still prevent a reliable ten-video, three-platform learner journey. This report intentionally records the blocked platform coverage rather than inventing completions or PDF exports.", "CQBody")]

doc = SimpleDocTemplate(str(OUT), pagesize=letter, rightMargin=0.5 * inch, leftMargin=0.5 * inch, topMargin=0.5 * inch, bottomMargin=0.5 * inch, title="ClipQuest post-fix live acceptance report")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
