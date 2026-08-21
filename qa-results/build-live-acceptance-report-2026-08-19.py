from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, TableStyle


ROOT = Path("/Users/unoxyrich/Documents/GitHub/ClipQuest")
OUT = ROOT / "output/pdf/clipquest-live-acceptance-report-2026-08-19.pdf"
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
styles.add(ParagraphStyle(name="CQCode", parent=styles["BodyText"], fontName="Courier", fontSize=6.7, leading=8.3, textColor=GREEN, spaceAfter=3))


def para(value, style="CQBody"):
    value = str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(value, styles[style])


def bullet(value):
    return para("- " + value)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 6.5)
    canvas.setFillColor(MID)
    canvas.drawString(0.5 * inch, 0.28 * inch, "ClipQuest live acceptance QA - no captions, keys, or private data included")
    canvas.drawRightString(8.0 * inch, 0.28 * inch, f"Page {doc.page}")
    canvas.restoreState()


def status_table(rows, widths, tiny=False):
    style = "CQTiny" if tiny else "CQSmall"
    data = [[para(c, style) if not isinstance(c, Paragraph) else c for c in row] for row in rows]
    table = LongTable(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PALE),
        ("GRID", (0, 0), (-1, -1), 0.25, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3.5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


story = [
    Spacer(1, 0.18 * inch),
    para("ClipQuest live ten-video acceptance report", "CQTitle"),
    para("19 August 2026 - Chrome web, iPhone 17 Pro simulator, Android availability, quiz generation, answering, grading, question quality, and PDF export", "CQSub"),
    para("Executive result", "CQH2"),
    para("The live run was completed against ten distinct APCSP YouTube links on Chrome and ten on the iPhone 17 Pro simulator. Captions imported and the quiz UI rendered on almost every run, and multiple-choice feedback generally included a useful AI reason. The requested end-to-end acceptance did not pass: no fresh run reached a completed, exportable quiz, short-answer grading failed repeatedly with no reasoned decision, two true/false items had polarity/wording defects, one Chrome run emitted an invalid generation call event, and one iOS run emitted a protocol-version union error. Android could not be exercised because no device or emulator was attached.", "CQBody"),
]

overview = [
    ["Surface", "Live attempts", "Quiz completion", "Answer/grading", "PDF export", "Decision"],
    ["Chrome web", "10 distinct links; all captions reached Video ready", "0/10 complete; visible banks stopped at 1-4/5 or invalid event", "MC reasons mostly pass; short-answer reasoned decision failed repeatedly; TF polarity defects", "1 existing completed Library card exported a 1-page PDF to Downloads", "FAIL - repair required"],
    ["iPhone 17 Pro", "10 distinct links; captions reached Video ready", "0/10 complete; one v5 protocol-union stop", "MC reasons pass; short-answer reasoned decision failed repeatedly; TF possibility treated as certainty", "Library accessibility tree exposed no Export notes action", "FAIL - native gap"],
    ["Android", "0; adb list empty and emulator CLI unavailable", "Not testable", "Not testable", "Not testable", "BLOCKED"],
]
story += [status_table(overview, [0.9 * inch, 1.25 * inch, 1.25 * inch, 1.55 * inch, 1.35 * inch, 1.0 * inch], tiny=True), Spacer(1, 0.1 * inch)]
story += [para("What passed", "CQH2")]
for item in [
    "YouTube caption acquisition reached a real Video ready screen for all ten Chrome links and all ten iOS links, with visible titles and complete-source-caption copy.",
    "The quiz screens rendered all three requested question types when generated: multiple choice, true/false, and short answer. MC and many TF answers showed an explicit Correct/Incorrect heading plus a reason.",
    "Math content was rendered as readable expressions in Chrome (for example 2 x 2 x 2 = 8, 10 x 10 = 100, and binary place values).",
    "A real Chrome Library Export notes action produced /Users/unoxyrich/Downloads/APCSP-U1-L8-Color-Images-cheat-sheet.pdf. pdfinfo reported one Letter page, 2,043 bytes, pdf-lib creator; the rendered page was legible with no clipping.",
    "The deployed Worker health endpoint was healthy and reported the intended storage-only/local-AI boundary. Source, deployment, extension artifact, and test evidence are listed later in this report.",
]:
    story.append(bullet(item))
story += [para("What failed", "CQH2")]
for item in [
    "Question generation did not reliably fill a requested Short 5 session. The learner could answer ready questions, then hit Preparing your next question or Generation could not complete; the incomplete quiz could not be scored.",
    "Short-answer grading returned The classification service returned no reasoned grading decision on repeated attempts, including semantically direct answers such as Unicode and one of the first large-scale electromechanical computers.",
    "AI grading can still over-read true/false wording. Statements using can or describing only the rightmost sequence position were treated as false because the explanation inferred a stronger absolute claim than the prompt made.",
    "The Chrome L9 run stopped immediately with The extension returned an invalid generation call event. The iOS L9 run stopped with invalid_union showing a protocolVersion/purpose mismatch against the v5 automatic_recovery contract.",
    "The native iOS Library did not expose Export notes on the visible cards, even though the same product surface exposed export actions in Chrome.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Chrome ten-link matrix", "CQH2"), para("All Chrome runs used the signed-in production tab, all three question-type checkboxes, Yes, quiz me, and Short - 5. Each row records the furthest live state reached; a partial bank is not treated as a pass.", "CQBody")]
chrome_rows = [
    ["#", "Video / link", "Generation", "Learner interaction", "Grading / quality", "PDF"],
    ["1", "APCSP U1 L1 Personal Innovations Virtual\ndEFtrYG9P40", "2/5 ready; stalled at next question", "MC D correct; TF True correct; could not continue", "Reasons present; no completion", "No fresh export"],
    ["2", "APCSP U1 L2 Representing Information\nZwnL06lfK_0", "3/5 ready; incomplete", "MC C correct; short answer entered", "Short answer failed reasoned grading twice", "No fresh export"],
    ["3", "APCSP U1 L3 Circle Square Patterns\nSTWIAcZfyK0", "At least 3/5 reachable", "MC B correct; TF True then retry False", "TF prompt was ambiguous; same concept flipped after retry", "No fresh export"],
    ["4", "APCSP U1 L4 Binary Numbers\nIETP-QEBhKw", "4/5 ready", "MC, TF, MC, TF all answered", "Reasons present; q5 unavailable", "No fresh export"],
    ["5", "APCSP U1 L5 Overflow and Rounding\nNytVSSjPEgA", "3/5 ready", "MC A; TF True; TF False", "Reasons present; incomplete bank", "No fresh export"],
    ["6", "APCSP U1 L6 Representing Text\nxWGMp4nyQtA", "At least 4/5 reachable", "MC A; TF True; TF False; short answer entered", "Short answer failed reasoned grading", "No fresh export"],
    ["7", "APCSP U1 L7 Black and White Images\n_TVkBfFDUwA", "Partial bank; reached q3", "MC D; TF True then retry False; short answer entered", "TF metadata wording questionable; short answer failed; q3 package-tracking topic drift", "No fresh export"],
    ["8", "APCSP U1 L9 Lossless Compression\nKqxEtj5VvZs", "0/5; stopped at creation", "No question available", "Invalid generation call event", "No fresh export"],
    ["9", "APCSP U1 L10 Lossy Compression\nK5DwJ1HeYJc", "4/5 ready", "MC C correct; short answer entered", "Short answer failed reasoned grading twice", "No fresh export"],
    ["10", "APCSP U1 L11 Intellectual Property\nWp7xBG6QlY8", "4/5 ready", "MC B correct; short answer entered", "Short answer failed reasoned grading", "No fresh export"],
]
story.append(status_table(chrome_rows, [0.23 * inch, 1.58 * inch, 1.02 * inch, 1.65 * inch, 1.65 * inch, 0.85 * inch], tiny=True))
story += [Spacer(1, 0.08 * inch), para("Chrome export evidence", "CQH3"), para("After the ten fresh attempts, the Library surface was opened and an existing completed APCSP U1 L8 Color Images card's nested Export notes button was activated. Browser waitForEvent did not surface a download event, but the local filesystem showed a newly modified PDF at 16:36:27. The file was inspected with pdfinfo and rendered with Poppler. This verifies the web download path for an already-ready artifact, not fresh completion-screen export for the ten rows above.", "CQBody")]

story += [PageBreak(), para("iPhone 17 Pro ten-link matrix", "CQH2"), para("The iOS simulator was rebuilt and launched from the final source before this run. Each attempt used all three question types, Yes, quiz me, and Short - 5. Accessibility-state excerpts were captured after import, generation, answer selection, and grading.", "CQBody")]
ios_rows = [
    ["#", "Video / link", "Generation", "Learner interaction", "Grading / quality", "PDF / Library"],
    ["1", "APCSP U1 L1 Personal Innovations Virtual\ndEFtrYG9P40", "2/5 then 3/5 ready", "MC correct; TF True then retry False; short answer entered", "TF can-cause statement graded as false; short answer no reasoned decision", "No completion/export"],
    ["2", "APCSP U1 L2 Representing Information\nZwnL06lfK_0", "3/5 ready", "MC correct; short answer entered", "Short answer no reasoned decision", "No completion/export"],
    ["3", "APCSP U1 L3 Circle Square Patterns\nSTWIAcZfyK0", "3/5 ready", "MC correct with reason", "No completion reached", "No completion/export"],
    ["4", "APCSP U1 L4 Binary Numbers\nIETP-QEBhKw", "1/5 then 4/5 ready", "MC correct; short answer entered", "Short answer no reasoned decision", "No completion/export"],
    ["5", "APCSP U1 L5 Overflow and Rounding\nNytVSSjPEgA", "1/5 ready", "MC correct with reason", "No completion reached", "No completion/export"],
    ["6", "APCSP U1 L6 Representing Text\nxWGMp4nyQtA", "1/5 then 4/5 ready", "MC correct; short answer entered", "Short answer no reasoned decision", "No completion/export"],
    ["7", "APCSP U1 L7 Black and White Images\n_TVkBfFDUwA", "1/5 ready", "MC correct with reason", "No completion reached", "No completion/export"],
    ["8", "APCSP U1 L9 Lossless Compression\nKqxEtj5VvZs", "Stopped after captions", "No question available", "invalid_union: protocolVersion/purpose mismatch; expected v5 automatic_recovery", "No completion/export"],
    ["9", "APCSP U1 L10 Lossy Compression\nK5DwJ1HeYJc", "1/5 ready", "MC correct with reason", "No completion reached", "No completion/export"],
    ["10", "APCSP U1 L11 Intellectual Property\nWp7xBG6QlY8", "2/5 ready", "MC correct with reason", "No completion reached", "No completion/export"],
]
story.append(status_table(ios_rows, [0.23 * inch, 1.58 * inch, 1.02 * inch, 1.65 * inch, 1.65 * inch, 0.85 * inch], tiny=True))
story += [Spacer(1, 0.08 * inch), para("Native Library/export finding", "CQH3"), para("The iOS Library screen was opened after the run. Its accessibility tree exposed the Library heading, search field, due-review cards, and all saved video cards, but no Export notes button or export action on the visible cards. Because no fresh iOS quiz completed, the completion-screen export button was not reachable either. This is a native parity defect even though web export is present.", "CQBody")]

story += [PageBreak(), para("Question-quality and grading defects", "CQH2")]
issues = [
    ["ID", "Priority", "Observed evidence", "Why it matters", "Recommended repair"],
    ["QG-01", "P0", "Chrome L9 stopped with invalid generation call event; iOS L9 stopped with invalid_union expected protocolVersion 5 and purpose automatic_recovery.", "A protocol mismatch prevents any question from being created and makes retries noisy rather than useful.", "Log the exact request/response envelope at the bridge boundary; enforce one shared protocol schema/version at build time; reject and repair only the missing suffix with the same v5 envelope."],
    ["QG-02", "P0", "Chrome and iOS short answers repeatedly displayed The classification service returned no reasoned grading decision, even for Unicode and direct concept answers.", "Learners cannot finish a quiz or receive trustworthy feedback; completion and export are blocked.", "Make the authoritative DeepSeek tool call return {is_correct, reason}; treat malformed/missing reason as a bounded retriable transport error, then expose a clear Retry grading state instead of trapping the question."],
    ["QG-03", "P0", "Fresh banks stopped at 1/5, 2/5, 3/5, or 4/5; the learner reached Preparing your next question and the quiz became unscorable.", "The product promises a selected session length but cannot finish or score it.", "Instrument per-ordinal generation and extension dispatch; use one primary plus two bounded repairs; surface a Retry generation action with the failed ordinal and reason; never leave a permanent spinner without an action."],
    ["QG-04", "P1", "Chrome L3 true statement about incrementing the rightmost sequence position graded false, then false graded correct on retry.", "The grader inferred an omitted absolute claim and changed polarity, undermining trust.", "Normalize polarity and test the exact proposition, not an expanded paraphrase; add a prompt lint rule for omitted conditions and an adversarial TF test set."],
    ["QG-05", "P1", "Chrome L7 metadata statement was marked false although type/format is commonly metadata; iOS L1 can-cause statement was marked false because the explanation treated can as guaranteed.", "Questions are answerable to a knowledgeable learner but the grading rubric is overstrict and semantically unstable.", "Require explicit qualifiers (may, can, always, only) in generated statements and grade the literal claim. Add soft, reason-first disagreement feedback without silently flipping the stored answer key."],
    ["QG-06", "P1", "Chrome L7 Black and White Images produced a short-answer prompt about package location-update frequency.", "This is visible topic drift and damages learner confidence even when the grammar is clean.", "Add source-grounding checks for concept overlap and reject prompts whose key terms are absent from the quiz primer/context; regenerate only the bad item."],
    ["QG-07", "P1", "Chrome L4 90-pattern question required an unstated assumption about whether symbols may repeat.", "A mathematically correct response can be marked wrong when the combinatorial model is not specified.", "Require generated math questions to state repetition/order assumptions and validate numeric answers against the explanation."],
    ["QG-08", "P1", "iOS Library exposed no Export notes action while Chrome exposed it.", "Native users cannot export synced notes even if an artifact is ready on another device.", "Add the same ready/preparing/retry/disabled action row to the native VideoCard and completion screen; test download/share handoff on iOS and Android."],
    ["QG-09", "P2", "Chrome extension artifact 0.8.22 with SHA-256 71fca... is present, but the installed profile version could not be verified through the browser control policy.", "The live invalid-event result cannot be attributed confidently to the exact installed extension build.", "Expose a non-sensitive version/capability badge in the app diagnostics surface and include it in generation error telemetry; do not rely on chrome://extensions inspection for release acceptance."],
]
story.append(status_table(issues, [0.42 * inch, 0.42 * inch, 2.1 * inch, 1.75 * inch, 2.6 * inch], tiny=True))
story += [para("Retest order", "CQH2")]
for item in [
    "1. Fix and unit-test the v5 bridge envelope and invalid-event repair path; prove the same event schema in Chrome, iOS, and Android.",
    "2. Fix short-answer tool-call parsing and reason-first retries; run a matrix of exact, paraphrased, incomplete, and unsupported-absolute answers.",
    "3. Add generation-completeness telemetry and a learner-visible retry action; require a full requested bank before scoring or export.",
    "4. Add TF polarity/qualifier and source-grounding lint tests using the exact live failure prompts above.",
    "5. Add native Export notes parity, then rerun all ten links on Chrome, iOS, and Android with the same answer ledger and PDF-byte/render checks.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Release and artifact evidence", "CQH2")]
evidence = [
    ["Evidence", "Observed value"],
    ["Source revision", "main and origin/main at 3912ee45ffaa2e880f84b6f92f661d5efd1b6c5c (commit 3912ee4)."],
    ["Cloudflare Worker", "Version 3df3d995-ead1-4d8d-87e5-d05d4ac30cc6, tag 3912ee45ffaa2e880f84b6f92f661d5efd1b6c5c, promoted to 100%."],
    ["Production health", "https://clipquest.ccwu.cc/health returned ok=true, deepseek-v4-flash, quiz-local-json-stream-v5.12, validator-minimal-gradeability-v5.3, local/extension generation enabled, request key affinity present."],
    ["Extension artifact", "ClipQuest Local AI manifest 0.8.22. Public ZIP and Downloads copy SHA-256: 71fca993f3c767f8856e297cf55648e42e96c7af54cb7aa765a263a60f710cbc."],
    ["Automated suites", "Prior release verification passed root tests, typecheck, lint, and build. This live report intentionally does not convert those green checks into live acceptance."],
    ["iOS build", "iPhone 17 Pro simulator rebuilt/launched from final source with 0 compiler errors and 0 warnings before this run."],
    ["Android boundary", "adb devices -l listed no attached devices; emulator command was unavailable. No Android result was fabricated."],
    ["Export artifact", "/Users/unoxyrich/Downloads/APCSP-U1-L8-Color-Images-cheat-sheet.pdf; one Letter page, 2,043 bytes, rendered and visually checked."],
]
story.append(status_table(evidence, [1.3 * inch, 6.1 * inch], tiny=False))
story += [para("Useful live diagnostics", "CQH2")]
for item in [
    "Chrome console logs showed caption acquisition completion events with source segment counts for the ten links. Some runs also logged an extension failure followed by a browser-text completion fallback; the user requirement for AI-only quiz generation means this fallback must remain a diagnostic failure, not a hidden success.",
    "The production health response reports effectiveDefaultProfile prompt_first_auto_v5_11 while supportedPromptVersion is quiz-local-json-stream-v5.12. This should be reconciled or explicitly documented so the live profile cannot drift from the intended release.",
    "The downloaded PDF contains AI-generated title, summary, concepts, definitions, and memory bullets. Its Formulas / math section is empty for that artifact, which is acceptable for this source but should remain visible rather than inventing formulas.",
]:
    story.append(bullet(item))
story += [para("Final release decision", "CQH2"), para("Do not call this ten-video acceptance pass green. The deploy and web export path are operational, but the learner contract is not: incomplete generation, malformed bridge events, reasonless short-answer grading, ambiguous true/false semantics, topic drift, and missing native export parity remain. The next useful action is to fix the P0 items in the order above and rerun the same deterministic ten-link ledger on all three platforms with an attached Android emulator.", "CQBody")]

doc = SimpleDocTemplate(str(OUT), pagesize=letter, rightMargin=0.5 * inch, leftMargin=0.5 * inch, topMargin=0.5 * inch, bottomMargin=0.5 * inch, title="ClipQuest live ten-video acceptance report")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
