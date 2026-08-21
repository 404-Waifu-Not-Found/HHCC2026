from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path("/Users/unoxyrich/Documents/GitHub/ClipQuest")
OUT = ROOT / "output/pdf/clipquest-retry-remediation-report-2026-08-19.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

GREEN = colors.HexColor("#173b2d")
MID = colors.HexColor("#587267")
PALE = colors.HexColor("#e4f1e8")
LINE = colors.HexColor("#bcd2c2")
AMBER = colors.HexColor("#fff3d6")
RED = colors.HexColor("#f8dfdd")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CQTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=21, leading=26, alignment=TA_CENTER, textColor=GREEN, spaceAfter=10))
styles.add(ParagraphStyle(name="CQSub", parent=styles["Normal"], fontSize=9, leading=13, alignment=TA_CENTER, textColor=MID, spaceAfter=16))
styles.add(ParagraphStyle(name="CQH2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=GREEN, spaceBefore=9, spaceAfter=6))
styles.add(ParagraphStyle(name="CQBody", parent=styles["BodyText"], fontSize=9, leading=13, spaceAfter=6))
styles.add(ParagraphStyle(name="CQSmall", parent=styles["BodyText"], fontSize=7.2, leading=9.4, spaceAfter=3))
styles.add(ParagraphStyle(name="CQCode", parent=styles["BodyText"], fontName="Courier", fontSize=7.1, leading=9, textColor=GREEN, spaceAfter=4))


def para(value, style="CQBody"):
    value = str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(value, styles[style])


def bullet(value):
    return para("- " + value)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MID)
    canvas.drawString(0.55 * inch, 0.32 * inch, "ClipQuest remediation QA - no captions, keys, or private data included")
    canvas.drawRightString(7.95 * inch, 0.32 * inch, f"Page {doc.page}")
    canvas.restoreState()


story = [
    Spacer(1, 0.25 * inch),
    para("ClipQuest retry and grading remediation", "CQTitle"),
    para("19 August 2026 - plan, implementation, automated verification, production release, and platform boundaries", "CQSub"),
    para("Executive result", "CQH2"),
    para("The retry loop and learner-feedback defects were repaired and shipped. Recovery is now bounded, short-answer grading is reason-first DeepSeek tool grading, and missing AI reasoning or cheat-sheet fields fails closed instead of being replaced with canned or context-derived prose. The exact pushed main revision is live on Cloudflare. Automated checks, the web build, the extension build, and the latest iOS simulator build are green.", "CQBody"),
]

summary_rows = [
    [para("Area", "CQSmall"), para("Evidence", "CQSmall"), para("Result", "CQSmall")],
    [para("Source", "CQSmall"), para("main and origin/main at 3912ee4 (3912ee45ffaa2e880f84b6f92f661d5efd1b6c5c)", "CQSmall"), para("PASS", "CQSmall")],
    [para("Cloudflare", "CQSmall"), para("Worker 3df3d995-ead1-4d8d-87e5-d05d4ac30cc6; tag 3912ee45ffaa2e880f84b6f92f661d5efd1b6c5c; 100% traffic", "CQSmall"), para("PASS", "CQSmall")],
    [para("Production health", "CQSmall"), para("/health ok=true; DeepSeek v4 flash; extension/native generation enabled; version affinity present", "CQSmall"), para("PASS", "CQSmall")],
    [para("Propagation", "CQSmall"), para("9 shells and 9 entry bundles passed at +0, +120, +300, and +600 seconds", "CQSmall"), para("PASS", "CQSmall")],
    [para("Automated checks", "CQSmall"), para("Root tests green; API 178 tests plus 8 release checks; app 141 tests plus 2 asset checks; extension 233; contracts 25; local engine 11; typecheck and lint green", "CQSmall"), para("PASS", "CQSmall")],
    [para("Extension artifact", "CQSmall"), para("ClipQuest Local AI 0.8.22; ZIP SHA-256 71fca993f3c767f8856e297cf55648e42e96c7af54cb7aa765a263a60f710cbc", "CQSmall"), para("BUILT", "CQSmall")],
    [para("iOS", "CQSmall"), para("iPhone 17 Pro simulator rebuilt and launched; 0 compiler errors and 0 warnings", "CQSmall"), para("PASS", "CQSmall")],
    [para("Android", "CQSmall"), para("adb devices returned no attached devices; emulator CLI unavailable", "CQSmall"), para("BLOCKED", "CQSmall")],
    [para("Chrome acceptance", "CQSmall"), para("Existing profile still has the old extension; loading 0.8.22 requires an action-time browser confirmation", "CQSmall"), para("PENDING", "CQSmall")],
]
table = Table(summary_rows, colWidths=[1.25 * inch, 4.9 * inch, 1.15 * inch], repeatRows=1)
table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), PALE),
    ("GRID", (0, 0), (-1, -1), 0.3, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ("BACKGROUND", (2, 8), (2, 8), RED),
    ("BACKGROUND", (2, 9), (2, 9), AMBER),
]))
story += [table, PageBreak(), para("Implementation plan and repairs", "CQH2")]
for item in [
    "Trace the progressive continuation path, extension dispatch watchdog, server call-event budget, and native recovery state. The observed stall was a long retry chain with 45-60 second idle/dispatch waits and high per-ordinal/global limits.",
    "Set one primary request plus at most two automatic repairs per failed ordinal. Set three automatic retries globally, three recovery cycles, and a five-minute active recovery ceiling. Cap cooldowns at 2, 4, and 8 seconds instead of exponential multi-minute waits.",
    "Shorten the extension-to-app dispatch and idle watchdogs to 20 and 30 seconds. A stalled handoff now fails into a visible retry/action-required state rather than holding the learner indefinitely.",
    "Make authoritative short-answer grading call DeepSeek with question, learner response, and validated rubric. The assistant must write one reason first, then call grade_answer with is_correct. The tool decision is authoritative.",
    "Remove synthetic rubric-derived sample answers. Missing reference answers are omitted from the payload; the AI grader must reason from the question and rubric without invented prose.",
    "Remove generic local grading reasons and context-built cheat-sheet output. Missing AI reason or AI title/source/summary is an error; no hardcoded learner-facing explanation is substituted.",
    "Keep completion PDF export usable while private sync is pending by exporting the locally rendered AI artifact directly; server download failures become an explicit failed/retry state.",
]:
    story.append(bullet(item))

story += [para("Files changed", "CQH2")]
for item in [
    "apps/api/src/lib/ai-services.ts and apps/api/src/routes/quizzes.ts - reason-first server tool grading and no synthetic sample answer.",
    "packages/local-quiz-engine/src/local-generator.js - reduced retry policy, fail-closed AI reason, and strict AI cheat-sheet fields.",
    "apps/app/src/generation/automatic-recovery-policy.ts and progressive-continuation.ts - aligned client recovery budgets and cooldowns.",
    "apps/app/app/quiz/[attemptId].tsx - outcome-specific reason presentation and direct local PDF export.",
    "apps/app/src/lib/cheat-sheet.ts - removed context-derived fallback document builder.",
    "apps/extension/manifest.json and package.json - released 0.8.22 with the shared engine changes.",
]:
    story.append(bullet(item))

story += [PageBreak(), para("Verification evidence", "CQH2")]
for item in [
    "npm run typecheck passed contracts, API, app, and generated Worker bindings.",
    "npm test passed every workspace. New regression coverage verifies bounded retries, reason-first tool grading, missing AI reason rejection, missing AI cheat-sheet field rejection, and the existing progressive protocol suites.",
    "npm run lint passed with zero warnings after aligning grounded and compatibility retry constants.",
    "npm run build passed web export, 470 asset references across 32 HTML shells, and the Wrangler dry run.",
    "The extension ZIP is reproducible and contains manifest version 0.8.22. The public copy is apps/app/public/clipquest-captions-extension.zip.",
    "Cloudflare release-production.mjs promoted the exact pushed revision after clean-tree validation and four long-tail asset probes.",
    "curl https://clipquest.ccwu.cc/health reports worker version 3df3d995-ead1-4d8d-87e5-d05d4ac30cc6 and tag 3912ee45ffaa2e880f84b6f92f661d5efd1b6c5c.",
]:
    story.append(bullet(item))

story += [para("Commands used", "CQH2")]
for command in [
    "npm run typecheck",
    "npm test",
    "npm run lint",
    "npm run build -w @clipquest/extension",
    "npm run build",
    "npm run cf:deploy",
    "curl -fsSL https://clipquest.ccwu.cc/health",
    "npx expo run:ios --device 'iPhone 17 Pro'",
]:
    story.append(para(command, "CQCode"))

story += [PageBreak(), para("Real-device and browser boundaries", "CQH2")]
for item in [
    "Chrome evidence before this release used the signed-in real browser UI and completed an existing 10-question quiz with multiple choice, true/false, and short answer. Two fresh YouTube imports stalled at 4/15 and 3/5 before the repair.",
    "The new 0.8.22 extension is built and published in the app ZIP, but it is not claimed as installed in the user's Chrome profile. Extension install/reload changes browser state and require action-time confirmation. Therefore the same ten-link live run has not been falsely marked as passed after the fix.",
    "The ten previously discovered links were APCSP U1 L1 through L7, L9, L10, and L11: dEFtrYG9P40, ZwnL06lfK_0, STWIAcZfyK0, IETP-QEBhKw, NytVSSjPEgA, xWGMp4nyQtA, _TVkBfFDUwA, KqxEtj5VvZs, K5DwJ1HeYJc, and Wp7xBG6QlY8. The first two were imported before the old stall; the remaining eight were not represented as completed.",
    "iOS was rebuilt from the final source and launched on iPhone 17 Pro with zero build errors and zero warnings. This confirms native packaging and launch, but not a full fresh 10-video generation run.",
    "Android was not available: adb showed no connected devices and the emulator command was not installed. No Android result is fabricated.",
    "The existing release QA PDF remains useful for the pre-fix reproduction evidence, but this report is the post-fix implementation and release record.",
]:
    story.append(bullet(item))

story += [para("Release decision", "CQH2"), para("The retry, grading-polarity, and no-fallback defects are repaired in source, covered by tests, pushed to main, and deployed to Cloudflare. The remaining acceptance gap is operational: load extension 0.8.22 in Chrome with confirmation, repeat the ten real links, and attach an Android emulator for the equivalent run. Until those actions occur, the release is verified but not claimed perfect for every requested surface.", "CQBody")]

doc = SimpleDocTemplate(str(OUT), pagesize=letter, rightMargin=0.55 * inch, leftMargin=0.55 * inch, topMargin=0.55 * inch, bottomMargin=0.55 * inch, title="ClipQuest retry and grading remediation report")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
