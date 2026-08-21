from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, TableStyle


ROOT = Path("/Users/unoxyrich/Documents/GitHub/ClipQuest")
OUT = ROOT / "output/pdf/clipquest-live-qa-report-2026-08-20.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

GREEN = colors.HexColor("#173b2d")
MID = colors.HexColor("#587267")
PALE = colors.HexColor("#e4f1e8")
LINE = colors.HexColor("#bcd2c2")
RED = colors.HexColor("#f8dfdd")
AMBER = colors.HexColor("#fff3d6")
BLUE = colors.HexColor("#e4eff8")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CQTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=19, leading=23, alignment=TA_CENTER, textColor=GREEN, spaceAfter=8))
styles.add(ParagraphStyle(name="CQSub", parent=styles["Normal"], fontSize=8.2, leading=11, alignment=TA_CENTER, textColor=MID, spaceAfter=12))
styles.add(ParagraphStyle(name="CQH2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=GREEN, spaceBefore=8, spaceAfter=5))
styles.add(ParagraphStyle(name="CQH3", parent=styles["Heading3"], fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=GREEN, spaceBefore=6, spaceAfter=3))
styles.add(ParagraphStyle(name="CQBody", parent=styles["BodyText"], fontSize=8.5, leading=11.5, spaceAfter=5))
styles.add(ParagraphStyle(name="CQSmall", parent=styles["BodyText"], fontSize=7, leading=8.8, spaceAfter=1))
styles.add(ParagraphStyle(name="CQTiny", parent=styles["BodyText"], fontSize=6.1, leading=7.4, spaceAfter=0))


def para(value, style="CQBody"):
    value = str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(value, styles[style])


def bullet(value):
    return para("- " + value)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 6.3)
    canvas.setFillColor(MID)
    canvas.drawString(0.48 * inch, 0.27 * inch, "ClipQuest live QA - AI-only generation, grading, and export")
    canvas.drawRightString(8.02 * inch, 0.27 * inch, f"Page {doc.page}")
    canvas.restoreState()


def table(rows, widths, header_color=PALE, style="CQTiny"):
    data = [[para(cell, style) if not isinstance(cell, Paragraph) else cell for cell in row] for row in rows]
    result = LongTable(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), header_color),
        ("GRID", (0, 0), (-1, -1), 0.25, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3.2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3.2),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return result


story = [
    Spacer(1, 0.14 * inch),
    para("ClipQuest live interaction QA report", "CQTitle"),
    para("20 August 2026 - Chrome web, updated extension, iOS simulator, Android emulator, AI quiz generation, answering, grading, question quality, and cheat-sheet PDF export", "CQSub"),
    para("Executive verdict", "CQH2"),
    para("The requested ten completed videos on each platform were not achieved, so this report does not claim that result. Chrome completed ten fresh links end to end at 100% in the prior verified pass, with a PDF artifact found for each, plus a follow-up anesthesia rerun against the then-current 47497 production that again reached completion, exercised the five-question answer/grading path, and exported a PDF. After the 9e3a6e7 promotion, a separate Library Export notes download was verified, and the public extension ZIP was checked for the new cheat-sheet wording guard. A fresh post-fix Biology run (Introduction to Biology: Crash Course Biology #1) admitted Question 1, graded two visible answers correctly with reason-first feedback, then stopped at 6/10. After cd40d81, an explicit visible Retry was exercised; the attempt correctly remained unscorable at 6/10 because no fallback suffix was generated, and the Retry action disappeared instead of looping. iOS has three completed five-question runs (earthquakes, organic chemistry, and batteries) with visible MC/TF/short-answer grading and completion export; the latest simulator pass also exercised a true/false answer, showed a reason-first result, and verified that unavailable notes are announced as text rather than a no-op button. The captionless routing source still fails before Question 1 because the Worker logs show upstream YouTube audio HTTP 403 mapped to the app's HTTP 503. Android has three completed native runs (one ten-question and two fresh five-question runs), all reaching 100% and the native share sheet, plus a separate fresh run that stopped at 8/10 on a rejected DeepSeek key. Chrome tab control was recovered for a fresh agent-created tab after the earlier handshake timeout; it is not evidence of ten new links, but the fresh Biology run is counted separately below. The failures are real acceptance findings, not hidden by fallback questions or deterministic replacement grading.", "CQBody"),
    para("What changed and was verified", "CQH2"),
    table([
        ["Area", "Change / evidence", "Status"],
        ["Question quality", "Added true/false explanation-polarity validation, a mutation-grounded rewrite for false items, and a direct-mechanism guard for metaphorical stems such as chemical barricade, alongside the existing inverted catenation guard. Local engine suite passes 16/16; extension suite passes 237/237.", "FIXED + deployed"],
        ["Cheat-sheet quality", "The local AI generator now explicitly requests direct mechanism wording and rejects the chemical/electrical barricade, wall, or shield family. The shared CheatSheetDocument contract rejects the same wording before R2 upload; contract suite passes 26/26.", "FIXED + deployed"],
        ["Answer grading", "DeepSeek tool-call prompts now accept the central relationship plus one relevant supporting fact for prose propositions; lists, counts, and formulas remain strict. Worker and local tests pass.", "FIXED + deployed"],
        ["Speech model", "Prepared pinned Whisper web/native files and uploaded manifest plus 13 web files and native ggml model to private R2. Remote manifest read-back matched revision ff4177021cc41f7db950912b73ea4fdf7d01d8e7.", "FIXED in storage; native retest open"],
        ["Cloudflare", "Latest Worker version 1a0a6ca6-acce-4a01-ae08-3aecb90da20a, tag cd40d81dc9c7ee9635c83a8eb89fe67690a4fc82. It is promoted to 100%; public /health identifies this exact version and the +0, +120, +300, and +600 asset probes passed with 9 shells / 9 bundles and version affinity. The preceding dc7343b release also passed its full convergence probes.", "VERIFIED"],
        ["Extension", "Public ZIP SHA-256 132a529a49f97170bc570e3deb5fcea025dd404252e6ccca6c860c8c3971c56c, version 0.8.22, matching the clean 9e3a6e7 release build and containing the direct-wording guard.", "VERIFIED"],
    ], [1.05 * inch, 5.3 * inch, 1.15 * inch]),
]

story += [PageBreak(), para("Chrome: ten fresh links completed", "CQH2"), para("Every row below was imported through the production site, generated by the updated Chrome local-AI extension, answered through visible quiz controls, and completed. Short-answer retries were intentionally used on several rows to exercise reason-first grading. Every completion exposed Export notes, and a one-page Letter PDF was found in Downloads for every row. A post-deploy rerun of the anesthesia row was then completed in a newly controlled Chrome tab: 5/5, a paraphrased short answer accepted with a reason, one deliberate true/false retry, and another real PDF download. A later Biology run was intentionally retained as a failure case: 6/10 ready, two visible answers graded correctly, then a genuine AI suffix-generation failure. After cd40d81, a visible Retry was clicked; the attempt stayed at 6/10 (correctly unscorable without fallback questions) and the Retry action disappeared, proving that the source-unavailable boundary no longer offers a no-op loop.", "CQBody")]
story.append(table([
    ["#", "YouTube link / title", "Quiz result", "Answer / quality observation", "PDF"],
    ["1", "jhRuUoTnA6g - Why are earthquakes so hard to predict?", "5/5, 100%", "Vague short answer rejected with a concrete reason, then corrected.", "1 page; verified"],
    ["2", "PmvLB5dIEp8 - What Is Organic Chemistry?", "5/5, 100%", "Short-answer retry; live bank also exposed the malformed catenation definition later guarded in source.", "1 page; verified"],
    ["3", "CGmTvukObOw - Routing Tables - CCNA Explained", "5/5, 100%", "Vague routing answer rejected, reason shown, corrected answer accepted.", "1 page; verified"],
    ["4", "kppxoA3gWco - How to Clean Sewage with Gravity", "5/5, 100%", "Reasonable short answer missing electrical charge rejected; corrected answer passed. This is the strictness finding that motivated the softer prompt.", "1 page; verified"],
    ["5", "B_tTymvDWXk - How does anesthesia work?", "5/5, 100%", "Follow-up rerun on 47497: MC + TF + MC + paraphrased short answer accepted with a reason; one intentionally wrong TF stem retried and corrected. The old bank/PDF still contained a chemical-barricade metaphor; 9e3a6e7 now guards both new questions and new notes/artifacts.", "1 page; verified"],
    ["6", "PBn7iWzrKoI - What caused the French Revolution?", "5/5, 100%", "All visible interactions completed; reason-first feedback observed.", "1 page; verified"],
    ["7", "7jbwX1Uvd18 - Introduction to plate tectonics", "5/5, 100%", "Two true/false stems had polarity/wording ambiguity and contradictory retry explanations.", "1 page; verified"],
    ["8", "9OVtk6G2TnQ - How batteries work", "5/5, 100%", "All visible interactions completed; reason-first feedback observed.", "1 page; verified"],
    ["9", "PSRJfaAYkW4 - How does your immune system work?", "5/5, 100%", "Materially correct short answer missing one mechanism rejected; corrected answer passed.", "1 page; verified"],
    ["10", "x0tcRqf7ciY - How one design flaw almost toppled a skyscraper", "5/5, 100%", "Wrong short answer and wrong TF month were each explained and corrected on retry.", "1 page; verified"],
], [0.25 * inch, 2.48 * inch, 0.72 * inch, 2.9 * inch, 0.8 * inch]))
story += [para("Post-fix failure and retry retest", "CQH2")]
for item in [
    "Fresh link: https://www.youtube.com/watch?v=tZE_fQFK8EY - Introduction to Biology: Crash Course Biology #1. The production UI admitted Question 1 before the full bank was ready; Q1 and Q2 were answered through visible controls and each returned a correct reason-first result. The AI stream then stopped at 6/10 with the explicit message that the incomplete bank cannot be scored. No fallback question or grade was substituted.",
    "Defect found and fixed: Retry remained visible and the first live post-fix click did not produce a new question within the observation window. Fixes 3fc5954, 58972bc, 7037854, b98c4ac, dc7343b, and cd40d81 now expose retryAvailable from the API, hide cooldown/terminal no-op actions, let an explicit retry replace stale tab-local recovery work, surface cross-tab lease contention, and map media/transcript recovery failures to terminal source_unavailable state. The final live cd40d81 retest stayed at 6/10 without inventing questions and removed Retry; the remaining quality improvement is to ensure the most specific source-unavailable explanation is always propagated into the rendered reason text.",
]:
    story.append(bullet(item))

story += [para("PDF artifact verification", "CQH2")]
for item in [
    "The ten expected filenames were present in /Users/unoxyrich/Downloads. pdfinfo reported one Letter page for each; pdftotext found Summary, Key concepts, Definitions, Formulas / math, and Remember this in every file. The post-deploy Chrome rerun, the 9e3a6e7 Library export, and both fresh Android runs also produced named PDFs; the iOS batteries completion share sheet showed a 2 KB named PDF preview.",
    "The browser waitForEvent(download) helper timed out even when files appeared. This is a harness limitation; filesystem presence and PDF inspection were used as the artifact evidence.",
    "In this follow-up, Chrome diagnostics confirmed the browser is running, ClipQuest's browser extension is installed/enabled, and the native-host manifest is correct. The initial tab-control handshake timed out twice, but opening a fresh Chrome window recovered control; the anesthesia rerun and Biology failure/retry retest are counted as real post-deploy evidence. The prior ten-link matrix remains the authoritative ten-link Chrome evidence.",
    "The completion-time web export path now retries private-sheet readiness up to three times and retries artifact sync up to three times before surfacing failure. A ready Library card exported successfully after the latest deploy; a cold completion race still needs a dedicated ten-run timing matrix.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Native platform runs", "CQH2"), para("Native coverage is reported as separate runs, not inflated with web results. The two latest Android runs used the actual app and completed with AI-generated questions, grading, retries, and native PDF share. A separate earlier batteries run used the same QA account and stopped during suffix recovery because its configured DeepSeek key was rejected. No fallback generation was used.", "CQBody")]
story.append(table([
    ["Platform / source", "Observed flow", "Result", "Open problem"],
    ["iOS / jhRuUoTnA6g", "iPhone 17 Pro simulator; fresh five-question run; MC, TF, short answer; wrong short-answer attempt corrected; completion Export notes tapped.", "5/5, 100%; native share sheet appeared in the earlier build.", "The 9e3a6e7 web/native source retains unavailable notes as accessible text with an actionable hint, rather than a no-op button. A live true/false check also showed the reason-first feedback panel."],
    ["iOS / PmvLB5dIEp8", "Rebuilt iOS app; captions ready; five-question run; completion Export notes tapped.", "5/5, 100%; native share sheet appeared with a named PDF.", "Generated malformed statement: catenation was defined as bonding to hydrogen. The source guard is now fixed and deployed, but this native bank predates that guard and needs a clean retest."],
    ["iOS / CGmTvukObOw", "Rebuilt app; no usable captions; local transcription path requested the speech model. R2 manifest/model were uploaded, then the fresh retest reached on-device verification.", "Blocked before Question 1: Wrangler tail for Worker 891deea9 shows two upstream Innertube HTTP 403 attempts (ANDROID progressive and IOS audio), mapped to ExpoFileSystem HTTP 503. Earlier pre-rebuild attempt stopped at 4/5 with local_state_conflict.", "This is an upstream YouTube signed-audio/IP restriction, not a missing model. Keep the explicit failure and trace a supported acquisition route; do not substitute captions or generated questions."],
    ["Android / aircAruvnKk", "Earlier Android emulator run; ten questions; wrong MC/TF/short retries; completion Export notes; Library export.", "10/10, 100%; native share sheet opened with But-what-is-a-neural-network-Deep-learning-chapter-1-cheat-sheet.pdf.", "This is one completed Android link, not ten."],
    ["Android / 9OVtk6G2TnQ", "Fresh emulator run; captions ready; Q1 MC, Q2 short answer, Q3 short answer and later questions were answered through the visible UI. One wrong TF answer showed a reason and a concept retry, then the corrected answer passed.", "5/5, 100%; completion Export notes opened Android's native share sheet with a named PDF.", "This run confirms the AI-only answer/retry/PDF path on Android. The separate earlier batteries run remains the credential_required 8/10 failure and is retained as a blocker."],
    ["Android / PmvLB5dIEp8", "Fresh emulator run with complete captions; MC, short answer, TF, short answer, and MC were answered. One substantively related but incomplete short response was rejected, then the retry was corrected.", "5/5, 100%; completion Export notes opened Android's native share sheet with What-Is-Organic-Chemistry-Crash-Course-Organic-Chemistry-1-cheat-sheet.pdf.", "The first response omitted the bank's key purpose (counting carbon atoms), exposing a grading-softness opportunity; the corrected response passed."],
], [0.85 * inch, 2.0 * inch, 1.8 * inch, 2.8 * inch]))
story += [para("Native UI observations", "CQH2")]
for item in [
    "Android Library exposes a separate Export notes button beside the card action, and the native bottom bar is present without the earlier export Promise being swallowed. The two fresh Android runs both handed off a named PDF through the OS share sheet.",
    "After a forced Metro reload, iOS exposes a separate Export notes button for ready cards and a Notes not ready status text with an actionable hint for incomplete cards; the action row is no longer nested inside the card navigation control. This removes the prior confusing no-op accessibility button.",
    "On the 47497 iOS simulator build, a live battery true/false answer was checked through the UI; the resulting feedback exposed a visible Reason: sentence before the correct result. The FeedbackPanel detail carries an assertive accessibility live region in source and the app presentation test covers that contract; the simulator tree surfaces the reason text even though Apple's AX dump labels it as text rather than alert.",
    "Android card thumbnails are very tall on the 1080x2400 emulator and the home Library carousel shows a partially off-screen second card. This is a visual hierarchy/spacing defect worth fixing even though accessibility labels are present.",
    "The iPhone simulator screenshot still shows Metro's `Open debugger to view warnings` overlay at the bottom. That is a development-build warning surface rather than shipped UI, but it occludes the lower edge and prevents a clean visual sign-off; repeat the visual pass with a release-like build and zero surfaced warnings.",
    "The iOS completion screen presents score, mastery, question count, Export notes, and Return to library. The fresh batteries run visually opened the share sheet with a named PDF preview; the organic run did the same in the prior native pass.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Question quality and grading audit", "CQH2")]
story.append(table([
    ["Check", "Observed evidence", "Assessment"],
    ["Reason-first AI grading", "Chrome, iOS, and Android feedback displayed a natural-language reason before the final correct/incorrect result. The local and Worker paths require DeepSeek tool calls; missing tool decisions fail closed and retry.", "PASS on observed paths"],
    ["Softer short answers", "Three Chrome answers that communicated the main concept but omitted a secondary detail were rejected before the prompt change. The new prompt explicitly accepts the central relationship plus one relevant supporting fact for prose propositions.", "FIX deployed; needs fresh live retest"],
    ["True/false polarity", "The earlier plate-tectonics run produced contradictory rationale around pre-Pangaea landmasses and asthenosphere strength. a25 now rejects polarity-mismatched explanations and rewrites false explanations from the exact local mutation; the old bank still needs a fresh live regeneration.", "Guard fixed + deployed; fresh matrix open"],
    ["Fragments and unsupported absolutes", "Concise fragments were accepted when meaningful; unrelated/empty answers were not. Unsupported-absolute validation is covered by source/unit guards but was not exhaustively adversarially tested in all ten links.", "PASS path; broader matrix open"],
    ["Duplicate concepts", "Retries correctly reuse the same ordinal after an incorrect answer; this is not duplicate question generation. No two accepted questions were exactly identical in the ten-link set.", "PASS for observed scope"],
    ["Topic grounding", "Organic chemistry generated an inverted catenation definition; the anesthesia rerun exposed a persisted chemical barricade metaphor in an older bank/PDF even though the underlying concept is electrical ion-channel blocking.", "Catenation + metaphor guards fixed for new generation; old artifacts need regeneration"],
    ["Mechanism wording", "The anesthesia retry accepted the corrected electrical interpretation, while the old PDF still contained the chemical-barricade phrase. The new source pattern rejects chemical/electrical barricade, wall, and shield metaphors before storage; the unit and extension suites pass.", "Guard deployed; regenerate old sheet"],
], [1.35 * inch, 4.8 * inch, 1.2 * inch]))
story += [para("Exact code/test evidence", "CQH2")]
for item in [
    "packages/local-quiz-engine: 16/16 tests passed, including the inverted catenation guard, polarity-mismatch rejection, reason-first/tool-call grading contract, and cheat-sheet metaphor rejection. packages/contracts: 26/26 tests passed, including server-side artifact rejection.",
    "apps/extension: 237/237 tests passed, including false/true explanation-polarity regressions. apps/app: 156 tests plus 2 web-asset tests passed; app typecheck and prettier checks passed. apps/api: 184 Vitest tests plus 8 script tests passed.",
    "The latest source changes were pushed directly to main as cd40d81 (on top of dc7343b, b98c4ac, 7037854, 58972bc, 3fc5954, 9e3a6e7, 8c54f2b, 47497c9, a25f17d, and the earlier quality/retry fixes). README.md and untracked QA artifacts remain user-owned and were not included in the feature commits.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Problems to fix next", "CQH2")]
story.append(table([
    ["Priority", "Problem", "Concrete fix and acceptance test"],
    ["P0", "Native captionless quiz path initially lacked the R2 speech-model manifest; after storage repair, iOS still fails because YouTube's Innertube player requests return HTTP 403 from Cloudflare egress and the app surfaces HTTP 503. Current Android suffix recovery can also stop on a rejected DeepSeek key.", "Keep the newly uploaded pinned manifest/model. Trace an allowed, supported YouTube acquisition route for the exact source/IP; configure a valid user-owned key on each native QA account. Cold-start iOS and Android and complete one captionless link each. No fallback captions/questions. Test manifest fetch, model download, integrity check, transcription, and full quiz completion."],
    ["P1", "Strict short-answer grading can reject a substantively correct paraphrase that omits a secondary detail.", "The AI-only prompt is softened in 1ea29ee. Run ten adversarial short answers per platform and verify central relationship + one supporting fact passes while unrelated, reversed, empty, list-incomplete, and formula-wrong answers still fail."],
    ["P1", "Older persisted banks and PDFs can retain a metaphorical mechanism stem (chemical barricade) even after source validation is fixed.", "9e3a6e7 rejects chemical/electrical barricade/wall/shield metaphors in new questions and cheat sheets, and the upload contract rejects the artifact before R2. Regenerate the affected anesthesia bank/artifact and run ten adversarial mechanism stems per platform; do not silently rewrite the already-synced PDF."],
    ["P1", "The old true/false bank had ambiguous polarity and contradictory retry reasons.", "a25 adds a polarity gate that rejects explanations labeling a false statement true (or a true statement false), and rewrites false explanations from the exact mutation. Regenerate the old plate-tectonics bank and run ten adversarial true/false items per platform; keep any remaining ambiguity as an explicit failure."],
    ["P1", "Completion export can race server artifact creation; iOS simulator share handoff is not independently stable.", "Expose preparing status until notes metadata is ready, poll the owned sheet, and test web byte download plus iOS Files/share destination. Keep explicit errors; never synthesize a PDF."],
    ["P1", "A fresh Biology run stopped at 6/10; a retry could not recover because the source/transcript context was unavailable.", "cd40d81 now classifies media/transcript recovery failure as terminal source_unavailable, removes Retry after the visible click, and preserves the no-fallback rule. Keep the specific source-unavailable explanation visible and trace claim -> extension dispatch -> stopGeneration so future source failures are diagnosable without reoffering a dead action."],
    ["P1", "Chrome source acquisition has duplicate provider terminal events and partial suffix failures on long/noisy videos.", "Trace one acquisition owner, cancel superseded providers, log DeepSeek status/timeout/stream-idle/schema outcomes, and run a clean ten-link matrix where every failed bank remains a failure."],
    ["P2", "Android Library card rhythm is uneven: tall thumbnails and partially clipped carousel cards.", "Use compact card height on native widths, keep action rows wrapping cleanly, and inspect at 320, 390, 430, and 1080px widths with accessibility labels. The 47497 pass also corrected zero-valued completion totals and removed the no-op Notes not ready button; the thumbnail/carousel visual check still needs a surfaced Android window."],
    ["P2", "The iOS simulator dev build surfaces an `Open debugger to view warnings` overlay over the bottom of the home screen.", "Run the same layout audit against a release-like build with Metro warnings cleared; the overlay must be absent before calling the mobile UI visually clean."],
], [0.45 * inch, 2.2 * inch, 4.75 * inch]))
story += [para("Release decision", "CQH2"), para("Not green for the requested all-platform ten-video scope. The current production Worker (cd40d81 / 1a0a6ca6-acce-4a01-ae08-3aecb90da20a) is promoted to 100%; its +0/+120/+300/+600 asset probes passed and public /health reports version affinity. The AI-only grading softness, chemistry guard, cheat-sheet metaphor guard, true/false polarity guard, export readiness retries, zero-valued completion-stat fix, native separate-control/status semantics, and retry-state fixes are in the deployed source. Chrome has strong prior ten-link end-to-end evidence plus a follow-up completion/export rerun; the fresh Biology failure now terminates honestly without a no-op Retry, but native ten-video coverage is incomplete and the captionless/key blockers remain observable. The correct next move is to keep the source-unavailable copy specific, configure a valid test key, rerun native captionless and full-length matrices, regenerate older banks/PDFs, and repeat the ten-link grading/PDF checks until the listed P0/P1 findings are closed. No fallback questions, deterministic replacement grades, or fabricated cheat-sheet content were used.", "CQBody")]

doc = SimpleDocTemplate(str(OUT), pagesize=letter, rightMargin=0.48 * inch, leftMargin=0.48 * inch, topMargin=0.48 * inch, bottomMargin=0.48 * inch, title="ClipQuest live QA report 2026-08-20")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
