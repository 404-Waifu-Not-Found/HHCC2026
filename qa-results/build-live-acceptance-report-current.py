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
styles.add(ParagraphStyle(name="CQSmall", parent=styles["BodyText"], fontSize=6.8, leading=8.5, spaceAfter=1))
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
    para("20 August 2026 - current production web, updated Chrome extension, iOS simulator, Android emulator, AI quiz generation, learner answering, grading, question quality, and PDF export", "CQSub"),
    para("Executive result", "CQH2"),
    para("This report is intentionally not a green-release certificate. The requested ten completed videos on each of Chrome, iOS, and Android were not completed, so they are not claimed. The most important native contract fix is now verified: the rebuilt Android app configured its device-scoped DeepSeek key, generated a 10-question AI bank, completed all 10 questions, exercised multiple-choice, short-answer, and true/false grading, handled wrong-answer retries, reached 100%, and opened the native share sheet for a cheat-sheet PDF after the final export callback fix. The iOS simulator completed a fresh five-question all-type run. Chrome completed six unique fresh links plus a fresh 10-question rerun, but exposed several real generation failures and a missing server cheat-sheet artifact on export. The completion Export notes control was visible on all tested completion screens. The final app callback fix now propagates Library/Home export failures into the learner-facing alert instead of dropping the Promise rejection.", "CQBody"),
]

overview = [
    ["Surface", "Live interaction evidence", "Status", "What remains open"],
    ["Chrome web / updated extension", "6 unique fresh links completed; a fresh 10-question rerun also completed all questions with MC, TF, short-answer, retries, and reason-first feedback. A ready Library card exported a verified 1-page PDF download. Six additional fresh attempts failed before completion (extension timeout, captionless/too-long source, 1/5 or 3/5 partial banks).", "AMBER", "Ten unique completed fresh videos, completion-time artifact readiness, duplicate source-acquisition lifecycle, and partial-bank root cause."],
    ["iPhone 17 Pro simulator", "Fresh 5-question all-type run completed at 100%. One wrong true/false answer returned a reason-first soft correction, then the retry was accepted. Completion screen exposed Export notes.", "AMBER", "Native share/PDF artifact was not available in the simulator; ten-video matrix not run."],
    ["Android API 36 emulator", "Rebuilt app with Android Keystore key generated and completed a 10-question AI bank. MC, short answer, true/false, wrong-answer retry, reason-first grading, 100% completion, Export notes, and the native share sheet with a named PDF were observed.", "AMBER", "The share sheet is a simulator/emulator handoff, not proof of a real human save/share destination; ten-video matrix not run."],
    ["Production Worker / GitHub", "Commit aab982c is pushed to origin/main. Cloudflare Worker 7c01e0a3-6dcf-4724-8e8c-2bb8f54b7f9d was deployed at 100%; guarded asset probes passed at +0, +120, +300, and +600 seconds.", "GREEN", "Only app behavior remains open; the current release is not a full QA acceptance."],
]
story += [table(overview, [1.25 * inch, 2.85 * inch, 0.55 * inch, 2.85 * inch], tiny=True), Spacer(1, 0.1 * inch)]

story += [para("What was fixed before this run", "CQH2")]
for item in [
    "Protocol v10 now accepts the answer-repair outcomes answer_fragment_invalid and unsupported_absolute_claim, optional retryKind, and failure outcomes in the generation call event union. This removed the native fatal AI-unavailable path observed before the run.",
    "iOS and Android use a bounded non-streaming DeepSeek JSON envelope because the native fetch bridge can leave an SSE response open without delivering the first chunk. This is still AI-only; it is not a deterministic question fallback.",
    "Background local grading now uses AbortController with a 30-second timeout rather than a Promise.race that left the underlying request alive for minutes.",
    "Native app generation and answer grading remain device-local to DeepSeek. No caption, raw transcript, or DeepSeek key was sent to the Worker by the tested native path.",
    "The a121d85 app fix makes missing native share targets visible to the learner. It writes the cache PDF, then throws an explicit Native sharing is unavailable on this device error rather than silently returning. The follow-up aab982c fix returns export Promises from Library/Home wrappers so VideoCard can surface that error; the rebuilt Android emulator then opened the native share sheet with a named cheat-sheet PDF.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Chrome live ledger", "CQH2"), para("The current Chrome matrix used distinct public YouTube IDs. A run is counted as completed only when the learner reached the completion screen; partial banks and source-contract failures remain failures. These are the actually observed fresh runs in this acceptance loop:", "CQBody")]
chrome_rows = [
    ["Video ID", "Outcome", "Learner / grading evidence", "PDF / quality notes"],
    ["aircAruvnKk\nNeural network chapter", "PASS - 5/5, then fresh 10/10 rerun", "The fresh rerun answered all 10 questions through the visible UI. It exercised MC, TF, short answer, incomplete-answer retry, true/false polarity retry, and reason-first feedback. Completion showed 100% and Export notes.", "Export click on the fresh completion surfaced alert: Cheat sheet not found. No browser download event or PDF bytes were captured. Dev logs also showed extension completed, extension failed, and browser_text completed for the same import."],
    ["0RRVV4Diomg\nPeriodic Table", "PASS - completed", "Mixed-type bank completed. Observed multiple bounded retries while questions were generated; all checked feedback included Reason:.", "Export control visible and clicked; no artifact exposed by the browser harness."],
    ["7qNE_B0r4z4\nAP Calculus derivatives", "PASS - completed", "MC/TF/short-answer path completed; reason-first feedback observed.", "Export control visible and clicked; no artifact exposed by the browser harness."],
    ["x4PPZCLnVkA\nNervous System", "PASS - completed", "Mixed-type bank completed with reason-first feedback.", "Export control visible and clicked; no artifact exposed by the browser harness."],
    ["OmJ-4B-mS-Y\nMap of Mathematics", "PASS - completed", "Mixed-type bank completed with reason-first feedback.", "Export control visible and clicked; no artifact exposed by the browser harness."],
    ["6tw_JVz_IEc\nCRISPR gene editing", "PASS - completed", "Mixed-type bank completed at 100%; reason-first feedback observed for the checked answers.", "Export control visible and clicked; no artifact exposed by the browser harness."],
    ["rfscVS0vtbw", "FAIL - local generation unavailable", "Generation stalled near Q1 and reported extension stopped responding.", "No learner bank or export."],
    ["8mAITcNt710", "FAIL - strict source limit", "The UI correctly refused a captionless/too-long source: trustworthy on-device transcription is limited to 90 minutes.", "No fallback question content was accepted."],
    ["Yocja_N5s1I", "FAIL - partial bank", "Reached 1/5 ready, then Generation could not complete. One retry remained incomplete.", "No score or export; telemetry also reported a stale Quiz not found warning."],
    ["PbITFIGLciI", "FAIL - partial bank", "Reached 3/5 ready, then Generation could not complete. Retry remained incomplete.", "No score or export."],
    ["kqtD5dpn9C8", "FAIL - partial bank", "Reached 1/5 ready, then Generation could not complete. Retry remained incomplete.", "No score or export."],
    ["lZ3bPUKo5zc", "FAIL - extension timeout", "Extension stopped responding before Q1.", "No learner bank or export."],
]
story.append(table(chrome_rows, [1.15 * inch, 1.1 * inch, 2.8 * inch, 2.35 * inch], tiny=True))
story += [para("Chrome-specific problems", "CQH2")]
for item in [
    "The extension acquisition lifecycle is not single-owner: successful extension completion is followed by extension failure and browser_text completion in the same live import. This looks like a duplicate/fallback race. Because the user prohibited fallback content, this needs strict source ownership and deduplicated telemetry before it can be called clean.",
    "Several long or noisy real videos stop at a partial accepted prefix (1/5 or 3/5). The UI correctly refuses to score or export those banks, but the root cause is not fixed and the learner must retry.",
    "The extension-stopped-responding failure remains a genuine live defect. The new bounded recovery stops the old infinite wait; it does not yet make the long suffix reliable.",
    "The browser-client harness did not expose a download event after clicking an enabled Export notes control. This is evidence of an unverified artifact, not evidence that a PDF was successfully downloaded.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("iOS and Android live runs", "CQH2")]
native_rows = [
    ["Platform", "Flow", "Observed result", "Defects / limits"],
    ["iOS / iPhone 17 Pro", "Fresh 5-question run with MC, TF, and short answer", "Completed at 100%. Q2 was intentionally answered with the wrong TF polarity, showed Almost—try this concept another way. with a concrete Reason:, then the retry was accepted. Short answer and MC also returned reason-first feedback. Completion showed score, mastery, Questions, Export notes, and Return to library.", "Tapping Export notes produced no share sheet and no PDF under the simulator app container. This is a simulator capability limitation or export wiring issue; it was not treated as a pass."],
    ["Android / API 36", "Rebuilt debug app; configured the DeepSeek key through Settings > Local AI; imported aircAruvnKk; generated 10 questions; answered all 10; rebuilt again after aab982c", "Full completion at 100%. Q1 MC correct; Q2 short answer wrong then retry with a reason-first correction; Q3 TF True wrong then False correct; Q4 short, Q5 MC, Q6 short, Q7 TF, Q8 TF, Q9 MC, Q10 short. Completion exposed Export notes. Library Export notes then opened the native share sheet with But-what-is-a-neural-network-Deep-learning-chapter-1-cheat-sheet.pdf.", "This proves the export handoff and filename in the emulator. It does not prove a human destination accepted the share, and ten-video coverage is still open."],
]
story.append(table(native_rows, [1.05 * inch, 1.85 * inch, 3.25 * inch, 1.95 * inch], tiny=True))
story += [para("Android question-quality observations", "CQH2")]
for item in [
    "The generated bank contained all requested types and varied response sizes. MC questions had four choices, TF questions had literal polarity, and short answers were answerable with natural paraphrases.",
    "One short-answer prompt used awkward wording: What does the structure of a neural network aim to provide when it is described as motivated? The AI grader still supplied a coherent target and accepted the corrected paraphrase, but the stem should be regenerated or normalized before release-quality acceptance.",
    "One short-answer prompt about parsing speech appeared in the neural-network video bank. It was answerable and graded correctly, but it is a topic-drift candidate that should be checked against the assigned evidence window.",
    "The user-facing retry behavior is now comprehensible: the learner sees a soft reason-first correction and can answer the same ordinal again. The retry does not fabricate content or score a shortened bank.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Grading and question-quality audit", "CQH2")]
grade_rows = [
    ["Check", "Evidence", "Result"],
    ["Reason-first answer grading", "Chrome, iOS, and Android feedback regions visibly put a natural-language Reason: before the final Nice! That’s right. or Almost—try this concept another way. decision.", "PASS on observed answers"],
    ["Soft grading", "Paraphrased short answers were accepted when they communicated the central concept; wrong or incomplete answers received a non-punitive Almost message and a retry path.", "PASS on observed answers"],
    ["True/false polarity", "Android deliberately answered a bias multiplication statement True; the grader explained that biases are added, not multiplied, then accepted False on retry. iOS also exercised a wrong TF polarity and recovery.", "PASS on observed polarity"],
    ["MC answer consistency", "Android selected neural-network options and received reasons that named the selected concept. Chrome completed MC items through the UI.", "PASS on observed answers"],
    ["Fragmentary/incomplete responses", "Android short-answer attempt with an incomplete answer was rejected with a reason; the corrected, complete paraphrase was accepted.", "PASS on observed path"],
    ["Duplicate concepts", "The Android q2 retry reused the same ordinal by design after a wrong answer. The live bank did not prove a repeated accepted question; however, the awkward q2 stem and speech topic drift require evidence-level review.", "AMBER"],
    ["Unsupported absolutes", "No observed answer was accepted solely because it contained an absolute. The validator and protocol tests cover unsupported_absolute_claim; a fresh adversarial live matrix is still required.", "AMBER - unit coverage, not ten-video live coverage"],
]
story.append(table(grade_rows, [1.55 * inch, 4.8 * inch, 1.0 * inch], tiny=True))
story += [para("PDF/export audit", "CQH2")]
for item in [
    "Completion screens on Chrome, iOS, and Android visibly exposed Export notes. This confirms the UI affordance and completion-state wiring.",
    "Chrome automation did not expose a browser-client download event for the fresh completion and that rerun surfaced Cheat sheet not found. After reloading the deployed Library, a ready card exported /Users/unoxyrich/Downloads/But-what-is-a-neural-network-Deep-learning-chapter-1-cheat-sheet.pdf; pdfinfo verified 1 page and 1,928 bytes, and pdftotext verified the title, summary, key concepts, definitions, formulas/memory sections. Ready-artifact web export passes; completion-time artifact readiness remains open.",
    "The iOS simulator showed no share sheet and no PDF in its app container. Android, after the final rebuild, opened the native share sheet and exposed a named PDF. iOS remains unverified; Android is accepted only as a share-handoff check, not as proof of a human save destination.",
    "The PDF linked with this report is the QA report itself, generated locally with ReportLab and rendered/inspected as a report artifact. It is not a fabricated AI cheat sheet and is not being presented as one.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Problems to fix next", "CQH2")]
issues = [
    ["ID", "Priority", "Problem", "Fix / acceptance test"],
    ["GEN-01", "P0", "Chrome extension can complete then fail and invoke browser_text for the same source; long calls can stop responding.", "Make one acquisition owner authoritative per import, cancel superseded providers, and emit one terminal source status. Trace extension port, first dispatch, heartbeat, fetch start, stream activity, and abort separately. Acceptance: ten fresh links show one source and no duplicate provider terminal events."],
    ["GEN-02", "P0", "Real sources can stop at 1/5 or 3/5 accepted questions.", "Preserve accepted prefix, classify the exact failed ordinal, and expose Retry only for the missing suffix. Add telemetry for DeepSeek HTTP status, timeout, stream idle, and schema outcome. Acceptance: no silent suffix loss and no score/export until the requested count is ready."],
    ["QUAL-01", "P1", "The neural-network bank included an awkward stem containing described as motivated and a possible speech topic drift.", "Tighten learner-visible phrase checks and compare every prompt/target to its assigned evidence window. Regenerate only the rejected singleton. Acceptance: no presentation scaffolding, no vague quoted wording, and no topic-drift item."],
    ["PDF-01", "P1", "A just-completed web quiz can return Cheat sheet not found before its server artifact is ready; iOS simulator has no share target.", "Keep the explicit native error and returned Promise callbacks. On web, gate Export on ready metadata or poll the upload status, then assert filename and non-zero bytes. On iOS, add a test share target or an explicit save-to-files path. Acceptance: ready-card export remains byte-verified and completion export waits or shows actionable progress."],
    ["NATIVE-01", "P1", "Android dev-client startup previously showed blank/ANR behavior and a valid watch?v= ID was rejected during an earlier attempt.", "Rebuild a release-like binary, test cold start three times, and test both watch and youtu.be URLs. Acceptance: no ANR/blank screen and both URL forms parse to the same 11-character ID."],
    ["QA-01", "P1", "The requested ten-video-per-platform matrix is incomplete.", "Run one clean account and one clean tab/device per link, answer every question, verify reason-first grading, and verify PDF bytes/share. Report failures as failures; do not count fallback or partial banks."],
]
story.append(table(issues, [0.52 * inch, 0.42 * inch, 2.45 * inch, 4.1 * inch], tiny=True))
story += [para("Release decision", "CQH2"), para("Not green for the requested scope. GitHub main, Cloudflare production, automated tests, the repaired Android full quiz path, the Android share handoff, a byte-verified ready-card web PDF export, the iOS completion path, and reason-first AI grading are verified. The release still has live Chrome generation reliability defects, duplicate source-provider telemetry, completion-time web artifact readiness, an iOS share-target gap, and incomplete ten-video coverage. No fallback questions, deterministic answer decisions, or synthetic cheat sheets were substituted.", "CQBody")]

doc = SimpleDocTemplate(str(OUT), pagesize=letter, rightMargin=0.5 * inch, leftMargin=0.5 * inch, topMargin=0.5 * inch, bottomMargin=0.5 * inch, title="ClipQuest live acceptance report 2026-08-20")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
