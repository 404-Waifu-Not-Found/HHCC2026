from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, TableStyle


ROOT = Path("/Users/unoxyrich/Documents/GitHub/ClipQuest")
OUT = ROOT / "output/pdf/clipquest-live-acceptance-report-2026-08-20.pdf"
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
styles.add(ParagraphStyle(name="CQSmall", parent=styles["BodyText"], fontSize=6.7, leading=8.5, spaceAfter=1))
styles.add(ParagraphStyle(name="CQTiny", parent=styles["BodyText"], fontSize=5.9, leading=7.3, spaceAfter=0))


def para(value, style="CQBody"):
    value = str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(value, styles[style])


def bullet(value):
    return para("- " + value)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 6.5)
    canvas.setFillColor(MID)
    canvas.drawString(0.5 * inch, 0.28 * inch, "ClipQuest live acceptance QA - AI-only generation and grading boundary")
    canvas.drawRightString(8.0 * inch, 0.28 * inch, f"Page {doc.page}")
    canvas.restoreState()


def table(rows, widths, tiny=True, header_color=PALE):
    style = "CQTiny" if tiny else "CQSmall"
    data = [[para(cell, style) if not isinstance(cell, Paragraph) else cell for cell in row] for row in rows]
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
    para("ClipQuest live acceptance report", "CQTitle"),
    para("20 August 2026 - updated Chrome extension, production web, ten fresh YouTube links, AI quiz generation, answering, grading, question quality, PDF export, and native-platform coverage", "CQSub"),
    para("Executive result", "CQH2"),
    para("This is an honest partial acceptance report, not a green release certificate. Commit ff59c10 is pushed to main and the Cloudflare Worker is deployed at 100 percent as 846010ca. The release guard passed the 0/120/300/600-second asset probes. A fresh Chrome run completed a five-question CRISPR quiz across multiple choice, true/false, and short answer; every checked answer showed reason-first AI feedback, and the completion screen exposed Export notes. The Android repair was also exercised live: the app-scoped build generated a ten-question AI bank, opened the quiz, and accepted MC, short-answer, and true/false answers with reason-first feedback. The requested ten completed videos on each of Chrome, iOS, and Android are still not claimed: iOS reached a live question but entered bounded retry at 3/5, Android completion/export was not reached, and the fresh Chrome export click did not produce a captured download event.", "CQBody"),
]

overview = [
    ["Surface", "Current evidence", "Passes", "Blocking defects", "Decision"],
    ["Chrome web", "Post-deploy CRISPR run completed 5/5; the ten-link ledger remains partial", "MC, TF, short answer, reason-first grading, completion score, and Export notes control observed", "Fresh export download event was not captured; ten-link matrix is not fully rerun after the fix", "AMBER - repeat ten-link export check"],
    ["iOS simulator", "Fresh iPhone 17 Pro run reached Q1 and accepted an answer, then bounded retry at 3/5", "Native UI, MC interaction, soft wrong-answer feedback, and Retry action observed", "Completion, short-answer grading, PDF/share parity, and ten-link completion remain unverified", "RED - fix native generation transport"],
    ["Android emulator", "App-scoped rebuild generated a 10-question bank and opened the quiz", "MC, short answer, true/false, reason-first grading, and AI-only transport were observed", "Full-bank completion, Library/completion Export notes, and native share bytes remain unverified", "AMBER - complete/export retest"],
]
story += [table(overview, [0.85 * inch, 1.8 * inch, 1.7 * inch, 2.45 * inch, 0.8 * inch], tiny=True), Spacer(1, 0.1 * inch)]

story += [para("Release evidence", "CQH2")]
for item in [
    "Git: main and origin/main are at ff59c10. The earlier telemetry repair keeps learner question ingestion authoritative while call/progress telemetry is diagnostic-only; this release adds the Android create-navigation and bounded JSON transport repair. The user README and prior QA/PDF artifacts were preserved and restored after the guarded deploy.",
    "Cloudflare: Worker version 846010ca-7f97-420b-b507-166336fc128b, tag ff59c1029f05844485170799169b4b5e99f56fb4, promoted to 100 percent by the guarded npx wrangler release script. Required asset probes passed at 0, 120, 300, and 600 seconds.",
    "Production health: /health?probe=ff59c1029f05844485170799169b4b5e99f56fb4 returned ok=true, deepseek-v4-flash, quiz-local-json-stream-v5.12, validator-minimal-gradeability-v5.3, prompt_first_auto_v5_12, extension-required local generation, required extension version 0.8.17, and worker version 846010ca-7f97-420b-b507-166336fc128b.",
    "Extension: the reconnect-capable build was copied to /Users/unoxyrich/Downloads/clipquest-captions-extension and its DeepSeek host permission remains present. Browser automation policy blocked direct chrome://extensions navigation, so the artifact is verified but a running service-worker reload is not claimed. The extension endpoint probe returned HTTP 200 without exposing the API key.",
    "Automated verification: app passed 34 files / 145 tests plus web asset verifier 2/2; extension passed 234/234; local engine passed 12/12; typecheck and release build passed. Native Android debug rebuild/install passed, and the repaired live run generated a 10-question bank and opened Question 1.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Fresh ten-link Chrome ledger", "CQH2"), para("The requested new-link set was: kqtD5dpn9C8, rfscVS0vtbw, RBSGKlAvoiM, eIrMbAQSU34, 8mAITcNt710, WUvTyaaNkzM, Z1Yd7upQsXY, HfACrKJ_Y2w, PkZNo7MFNFg, and M7lc1UVf-VE. All are public YouTube URLs and were checked for HTTP reachability before use. The table distinguishes actually observed runs from links not reached after the live blocker surfaced.", "CQBody")]

chrome_rows = [
    ["#", "YouTube ID and title", "Caption evidence", "Generation / learner evidence", "Grading and quality", "PDF"],
    ["1", "kqtD5dpn9C8\nPython for Beginners - Learn Coding with Python in 1 Hour", "Web import completed; Android’s cached copy had no duration/segments and surfaced the truthful YouTube-source error", "Prior Chrome run reached Q1-Q8 and terminated cleanly at 8/10. The repaired Android path was verified on the cached Binary Numbers card instead; this Python card was not counted as a completed Android run.", "Chrome MC, TF, and short-answer questions rendered; Q4 wrong answer received a softer “Almost” reason and a corrected paraphrase was accepted. No completed export.", "No completed export"],
    ["1A", "6tw_JVz_IEc\nHow CRISPR lets you edit DNA - Andrea M. Henle", "Fresh post-deploy Chrome import reached Video ready with complete captions", "Five-question bank completed and reached Quest complete at 100%.", "MC, TF, and short answer all answered correctly. Each feedback region showed the reason before “Nice! That’s right.”", "Export notes control visible; download event not captured"],
    ["2", "rfscVS0vtbw\nLearn Python - Full Course for Beginners", "2,935 segments; 259,401 chars; complete in prior ledger", "Not re-run to completion after the deployment; retained as a fresh-link ledger entry only.", "No current learner grading evidence.", "Not reached"],
    ["3", "RBSGKlAvoiM\nData Structures Easy to Advanced Course", "4,040 segments; 352,090 chars; complete in prior ledger", "Prior live run reached model preparation, then reported extension stopped responding.", "No learner question reached.", "Not reached"],
    ["4", "eIrMbAQSU34\nJava Full Course for Beginners", "1,748 segments; 130,531 chars; complete in prior ledger", "Prior run reached Opening your quiz at 99 percent, then extension stopped responding.", "No learner question reached.", "Not reached"],
    ["5", "8mAITcNt710\nHarvard CS50 - Full Computer Science University Course", "Extension and browser text paths logged ZodError; the page then showed speech model manifest unavailable.", "No valid complete source was accepted for the local path. This is a truthful source-contract failure, not a fallback success.", "No question reached.", "Not reached"],
    ["6", "WUvTyaaNkzM\nLinear algebra lesson", "URL checked; no current interaction completed after the blocker.", "Not reached in this loop.", "Not tested.", "Not reached"],
    ["7", "Z1Yd7upQsXY\nProbability lesson", "URL checked; no current interaction completed after the blocker.", "Not reached in this loop.", "Not tested.", "Not reached"],
    ["8", "HfACrKJ_Y2w\nGit lesson", "URL checked; no current interaction completed after the blocker.", "Not reached in this loop.", "Not tested.", "Not reached"],
    ["9", "PkZNo7MFNFg\nLearn JavaScript - Full Course for Beginners", "2,996 segments; 155,021 chars; complete in prior ledger", "Prior run reached 99 percent opening state; after approximately 110 seconds the page reported extension stopped responding.", "No learner question reached in the monitored run.", "Not reached"],
    ["10", "M7lc1UVf-VE\nYouTube demo video", "URL checked; no current interaction completed after the blocker.", "Not reached in this loop.", "Not tested.", "Not reached"],
]
story.append(table(chrome_rows, [0.2 * inch, 1.65 * inch, 1.32 * inch, 2.2 * inch, 1.5 * inch, 0.72 * inch], tiny=True))
story += [para("Live question, answer, and grading evidence", "CQH2")]
for item in [
    "The fresh CRISPR run was observed against the release generation profile: DeepSeek produced standalone MC, TF, and short-answer questions from the private transcript, and the learner received a reason before each correctness decision. No deterministic question or grading fallback was used.",
    "The repaired Android run reached a 10-question bank after complete caption acquisition, then opened Question 1. A correct MC answer, two concise natural-language short answers, and a false true/false polarity answer all returned “Nice! That’s right.” with a reason-first explanation. The previous Video ready spinner was not reproduced once the app-scoped Metro bundle was used.",
    "The short-answer path was exercised with both an intentionally incomplete/wrong response and a paraphrased correct response. The wrong response produced a softer “Almost” explanation; the retry produced “Nice! That’s right.” with a concrete reason.",
    "The repaired automatic-recovery latch worked: after 8/10 ready, the UI reported one terminal generation failure and stayed there for an additional 25 seconds instead of cycling through cooldown/reclaim indefinitely. This fixes the loop but does not solve the underlying extension suffix failure.",
    "The fresh CRISPR completion screen exposed an enabled Export notes button. The automation harness did not observe a download event, so the UI path is confirmed but a fresh filesystem PDF is not claimed. The PDF in this report is a QA report artifact, not a cheat sheet generated from an uncompleted quiz.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Confirmed problems and repair plan", "CQH2")]
issues = [
    ["ID", "Priority", "Observed problem", "Repair and acceptance test"],
    ["LIFE-01", "P0", "Local DeepSeek generation can end with The ClipQuest extension stopped responding after a long quiet period, including complete 130k-155k character captions.", "Trace port connect, first dispatch, page heartbeat, worker heartbeat, fetch start, stream activity, and abort separately. Keep one active-call lease through the actual request timeout, then return a structured error instead of a raw port disconnect. Acceptance: one clean tab completes five questions or presents an actionable terminal retry, never a dead spinner."],
    ["LIFE-02", "P0", "The post-deploy Chrome run now stops cleanly at 8/10 instead of looping, but the underlying long/quiet DeepSeek suffix still fails and the explicit Retry did not recover it.", "Trace port connect, first dispatch, page heartbeat, worker heartbeat, fetch start, stream activity, abort, and retry button dispatch separately. Add a delayed 3-minute integration harness and keep one active-call lease through the request timeout. If MV3 still terminates the worker, move the long AI call into a dedicated extension page/offscreen document."],
    ["SRC-01", "P0", "The CS50 full-course source failed strict extraction validation with ZodError and surfaced speech model manifest unavailable.", "Preserve the no-fallback rule. Surface the exact invalid field and source-contract reason, offer a retry only after a new complete source is available, and never treat browser text or a partial transcript as a successful AI quiz source."],
    ["PROTO-01", "P0", "Previous native/web runs recorded invalid generation call events and protocol union mismatches for v5 automatic recovery.", "Generate one shared protocol schema from packages/contracts and validate it at the extension bridge, iOS, Android, and API boundaries. Acceptance: malformed events are rejected with a structured diagnostic and only the missing ordinal is retried."],
    ["GRADE-01", "P0", "Short-answer grading must be DeepSeek tool-call plus reason-first, but live runs have historically surfaced no reasoned decision for valid paraphrases.", "Require {is_correct, reason} from DeepSeek, retry malformed/blank tool output at most three times, then expose Retry grading. Never use a deterministic fallback verdict."],
    ["GRADE-02", "P1", "True/false can over-read can, may, or sequence wording as an absolute claim and reverse polarity.", "Grade the literal proposition supplied by the learner and source. Add tests for can/may/always/only, negation, zero-based ranges, and role reversals. The reason must identify the exact proposition before the softer decision."],
    ["QUALITY-01", "P1", "Long banks can stop before the requested count; incomplete banks remain unscorable and unexportable.", "Persist accepted prefix, show the failed ordinal and retry action, and require exactly 5/10/15 validated questions before completion or export. Never restart a good prefix."],
    ["QUALITY-02", "P1", "A live source can produce a topic-drifted question or an under-specified math assumption.", "Validate concept overlap against the grounded evidence, require order/repetition assumptions for combinatorics, and regenerate only the rejected singleton."],
    ["NATIVE-01", "P0", "Before ff59c10, Android could strand the learner on Video ready while the native local-client probe waited, and Android SSE could remain at 7-8% without a first question. The repaired build now navigates and completes generation, while iOS still reaches Q1 but enters bounded retry at 3/5. Completion/export parity is unverified and the iOS home carousel shows a partial next-card sliver.", "Keep the Android create button independent from diagnostic credential probing and use the bounded non-streaming DeepSeek envelope already shipped. Then run current iOS and Android through a completed quiz and assert Library/completion Export notes plus native share bytes."],
    ["QA-01", "P2", "A browser download event was not captured in the automation harness for a historical ready artifact.", "Wait on the actual browser download, assert filename and non-zero bytes, and render the PDF with Poppler. Keep server readiness and filesystem download as separate assertions."],
]
story.append(table(issues, [0.5 * inch, 0.42 * inch, 2.45 * inch, 4.05 * inch], tiny=True))
story += [para("Why no fallback was used", "CQH2"), para("The user explicitly prohibited fallback content. All failed runs above remain failed: no deterministic quiz questions, fabricated grading decisions, incomplete-bank scores, or synthetic PDF artifacts were substituted. The only successful question shown in this report was actually generated by the configured local DeepSeek path and validated before it was shown to the learner.", "CQBody")]

story += [PageBreak(), para("Platform retest plan", "CQH2")]
for item in [
    "1. Chrome: use one clean tab per video, reload the current extension once, and run the ten-link ledger again. Complete every MC, TF, and short-answer item. Record per-ordinal generation call events and do not score an incomplete bank.",
    "2. Grading: for each short answer, test exact, paraphrased, incomplete, fragmentary, and unsupported-absolute responses. Confirm DeepSeek gives a reason first and then a softer correct/incorrect decision. For TF, test both polarities and literal qualifier semantics.",
    "3. PDF: after a completed quiz, click Export notes from completion and Library. Assert a browser download, safe filename, non-zero bytes, required sections, long-title wrapping, formula fallback, and rendered page legibility.",
    "4. iOS: rebuild from ff59c10 or later, launch the iPhone 17 Pro simulator, and run the same ten links. Verify current extension-free native DeepSeek configuration, all question types, grading reasons, Library Export notes, and native share handoff.",
    "5. Android: keep the current emulator and rerun the same ten links on ff59c10 or later. The create/navigation and native transport repairs are now live-tested, but no Android pass can be claimed until a full bank reaches completion and export.",
    "6. Repeat only after each P0 repair. The release is green only when all requested platforms complete the selected bank, the AI grader returns reason-first decisions, and at least one fresh PDF export is downloaded and rendered per platform.",
]:
    story.append(bullet(item))
story += [para("Final decision", "CQH2"), para("Not green for the requested scope. The repository, GitHub main branch, Cloudflare deployment, extension artifact, and automated suites are verified. One fresh Chrome bank and one repaired Android bank now reach learner interaction with reason-first AI grading, but the ten-link rerun, fresh PDF filesystem assertion, Android completion/export, and iOS completion/export remain open. The next acceptance loop should focus on full-bank completion and deterministic PDF download/share assertions; only then should the ten-link, three-platform loop be called green.", "CQBody")]

doc = SimpleDocTemplate(str(OUT), pagesize=letter, rightMargin=0.5 * inch, leftMargin=0.5 * inch, topMargin=0.5 * inch, bottomMargin=0.5 * inch, title="ClipQuest live acceptance report 2026-08-20")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
