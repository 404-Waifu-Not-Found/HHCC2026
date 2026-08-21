from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path('/Users/unoxyrich/Documents/GitHub/ClipQuest')
OUT = ROOT / 'output/pdf/clipquest-release-qa-report-2026-08-19.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)

GREEN = colors.HexColor('#173b2d')
MID = colors.HexColor('#587267')
PALE = colors.HexColor('#e4f1e8')
LINE = colors.HexColor('#bcd2c2')
AMBER = colors.HexColor('#fff3d6')
RED = colors.HexColor('#f8dfdd')

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='CQTitle', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=21, leading=26, alignment=TA_CENTER, textColor=GREEN, spaceAfter=10))
styles.add(ParagraphStyle(name='CQSub', parent=styles['Normal'], fontSize=9, leading=13, alignment=TA_CENTER, textColor=MID, spaceAfter=16))
styles.add(ParagraphStyle(name='CQH2', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=GREEN, spaceBefore=9, spaceAfter=6))
styles.add(ParagraphStyle(name='CQBody', parent=styles['BodyText'], fontSize=9, leading=13, spaceAfter=6))
styles.add(ParagraphStyle(name='CQSmall', parent=styles['BodyText'], fontSize=7.2, leading=9.4, spaceAfter=3))
styles.add(ParagraphStyle(name='CQTiny', parent=styles['BodyText'], fontSize=6.2, leading=8, spaceAfter=1))
styles.add(ParagraphStyle(name='CQCode', parent=styles['BodyText'], fontName='Courier', fontSize=7.1, leading=9, textColor=GREEN, spaceAfter=4))


def para(value, style='CQBody'):
    value = str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return Paragraph(value, styles[style])


def bullet(value):
    return para('• ' + value)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(MID)
    canvas.drawString(0.55 * inch, 0.32 * inch, 'ClipQuest release QA • captions, transcripts, and API keys intentionally excluded')
    canvas.drawRightString(7.95 * inch, 0.32 * inch, f'Page {doc.page}')
    canvas.restoreState()


links = [
    ('dEFtrYG9P40', 'APCSP U1 L1 Personal Innovations Virtual', 'Imported in Chrome; 4/15 ready, 4 questions answered; then stayed on "Preparing your next question".'),
    ('ZwnL06lfK_0', 'APCSP U1 L2 Representing Information', 'Imported in Chrome; 3/5 ready, 3 questions answered; then stayed on "Preparing your next question".'),
    ('STWIAcZfyK0', 'APCSP U1 L3 Circle Square Patterns', 'Discovered in the YouTube playlist; not imported after the same live stall blocked the controlled ten-link run.'),
    ('IETP-QEBhKw', 'APCSP U1 L4 Binary Numbers', 'Discovered in the YouTube playlist; not imported in this run.'),
    ('NytVSSjPEgA', 'APCSP U1 L5 Overflow and Rounding', 'Discovered in the YouTube playlist; not imported in this run.'),
    ('xWGMp4nyQtA', 'APCSP U1 L6 Representing Text', 'Discovered in the YouTube playlist; not imported in this run.'),
    ('_TVkBfFDUwA', 'APCSP U1 L7 Black and White Images', 'Discovered in the YouTube playlist; not imported in this run.'),
    ('KqxEtj5VvZs', 'APCSP U1 L9 Lossless Compression', 'Discovered in the YouTube playlist; not imported in this run.'),
    ('K5DwJ1HeYJc', 'APCSP U1 L10 Lossy Compression', 'Discovered in the YouTube playlist; not imported in this run.'),
    ('Wp7xBG6QlY8', 'APCSP U1 L11 Intellectual Property', 'Discovered in the YouTube playlist; not imported in this run.'),
]

story = [
    Spacer(1, 0.25 * inch),
    para('ClipQuest release, Chrome, and simulator QA', 'CQTitle'),
    para('19 August 2026 • pulled main, deployed Cloudflare, exercised the real Chrome UI, and recorded simulator limits', 'CQSub'),
    para('Executive outcome', 'CQH2'),
    para('The repository was fast-forwarded to the remote main revision, a production compatibility fix was committed and pushed, and that exact pushed revision was promoted to Cloudflare. API and type checks are green. Real Chrome automation completed an existing ten-question quiz and began two fresh YouTube quizzes, but both fresh quizzes stopped receiving the next question after 3–4 generated questions. That is a release-blocking learner-flow defect, so the remaining eight links are listed as discovered but not falsely marked as completed.', 'CQBody'),
]

summary_rows = [
    [para('Area', 'CQSmall'), para('Evidence', 'CQSmall'), para('Result', 'CQSmall')],
    [para('Remote sync', 'CQSmall'), para('main at d51de30; origin/main matches', 'CQSmall'), para('PASS', 'CQSmall')],
    [para('Cloudflare', 'CQSmall'), para('Worker 9348fbcb-8867-4be2-9dc8-66a96671b9f9; tag d51de30f96382032a3620b09292f705c5ddff32a', 'CQSmall'), para('PASS', 'CQSmall')],
    [para('Production health', 'CQSmall'), para('health ok; DeepSeek v4 flash; local extension/native generation enabled; version affinity present', 'CQSmall'), para('PASS', 'CQSmall')],
    [para('Assets', 'CQSmall'), para('9 shells and 9 entry bundles passed at +0, +120, +300, +600 seconds', 'CQSmall'), para('PASS', 'CQSmall')],
    [para('Automated tests', 'CQSmall'), para('27 API files; 177 tests; script tests 8/8; typecheck all workspaces', 'CQSmall'), para('PASS', 'CQSmall')],
    [para('Chrome extension', 'CQSmall'), para('ClipQuest Local AI v0.8.20 enabled; key already configured; key not read or retyped', 'CQSmall'), para('READY / reload confirmation pending', 'CQSmall')],
    [para('Fresh video generation', 'CQSmall'), para('2 imported links; both stalled before full requested length', 'CQSmall'), para('BLOCKED'),
    ],
    [para('iOS simulator', 'CQSmall'), para('iPhone 17 Pro booted; app opened; short-answer entry/check/retry visible', 'CQSmall'), para('PARTIAL'),
    ],
    [para('Android simulator', 'CQSmall'), para('adb devices returned no attached devices; emulator CLI unavailable', 'CQSmall'), para('BLOCKED'),
    ],
]
summary_table = Table(summary_rows, colWidths=[1.25 * inch, 4.9 * inch, 1.15 * inch], repeatRows=1)
summary_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), PALE),
    ('GRID', (0, 0), (-1, -1), 0.3, LINE),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('LEFTPADDING', (0, 0), (-1, -1), 5),
    ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('BACKGROUND', (2, 7), (2, 7), RED),
    ('BACKGROUND', (2, 9), (2, 9), AMBER),
    ('BACKGROUND', (2, 10), (2, 10), RED),
]))
story += [summary_table, PageBreak()]

story += [para('Source sync and deployment evidence', 'CQH2')]
for item in [
    'Fetched origin/prune and fast-forwarded main from 6674041 to a147c14 without discarding the pre-existing README and QA artifacts.',
    'The remote update exposed one stale source-guard test. It was updated to match the new gradeShortAnswerWithAi path.',
    'A live Chrome quiz exposed a second defect: legacy short-answer questions can have no correct_answer_json. The API now falls back to the validated rubric requiredIdeas instead of throwing “short-answer sample answer is missing.”',
    'Commit d51de30 (“Keep legacy short answers gradeable”) was pushed directly to origin/main as requested.',
    'The exact pushed revision was deployed with the repository release script. Cloudflare promoted Worker 9348fbcb-8867-4be2-9dc8-66a96671b9f9 to 100% traffic.',
    'curl https://clipquest.ccwu.cc/health returned ok=true, prompt quiz-local-json-stream-v5.12, validator validator-minimal-gradeability-v5.3, and requestKeyPresent=true.',
    'Long-tail production asset probes passed at +0, +120, +300, and +600 seconds: every one checked 9 HTML shells and 9 Expo entry bundles.',
]:
    story.append(bullet(item))

story += [para('Commands and checks', 'CQH2')]
for cmd in [
    'git fetch origin --prune; git log --oneline --decorate -3',
    'npm test -w @clipquest/api  # 27 files, 177 tests; 8 release-script tests',
    'npm run typecheck           # contracts, API, app, and worker types',
    'npm run cf:deploy           # pushed-ref release with four asset probes',
    'curl -fsSL https://clipquest.ccwu.cc/health | jq .',
]:
    story.append(para(cmd, 'CQCode'))

story += [PageBreak(), para('Real Chrome workflow', 'CQH2')]
for item in [
    'The signed-in Chrome profile was inspected through the real browser UI. The unpacked ClipQuest Local AI extension was enabled at version 0.8.20 and reported that a DeepSeek key is configured. The credential was not exposed, read, or retyped.',
    'Extension removal/reinstall/reload is an action-time browser confirmation. The request was acknowledged in the UI, but no confirmation was received before this run, so no destructive remove/reinstall action was taken.',
    'An existing production quiz (AP CSP U1 L8 Color Images) was completed through the UI: all 10 questions were answered, including multiple choice, true/false, and short answer. Final screen showed “Quest complete!”, score 100%, 10 questions, and an Export notes action.',
    'The same completed quiz exposed a feedback defect: an incorrect true/false answer and an incorrect short answer displayed the static phrase “Your answer matches the core idea.” The icon showed an error, but the explanation copy was not outcome-specific. This needs a follow-up fix.',
    'The export button was visible on completion, but this run did not produce a newly modified Downloads PDF for that quiz. An older existing cheat-sheet PDF was present, so export success is not claimed for this exact click.',
    'Fresh link dEFtrYG9P40 was imported with a 15-question quiz. Four questions became ready and were answered in sequence; after the fourth Next action the UI stayed at 4/15 and “Preparing your next question” for more than a minute.',
    'Fresh link ZwnL06lfK_0 was imported with a 5-question quiz. Three questions became ready and were answered; after the third Next action the UI stayed at 3/5 and “Preparing your next question” for more than 25 seconds.',
    'The extension service-worker DevTools console was inspected after the stall and showed 0 console messages. That rules out a visible console exception but does not prove the generation handoff is healthy.',
]:
    story.append(bullet(item))

story += [PageBreak(), para('Ten new YouTube links and honest coverage', 'CQH2'), para('All ten links below were found by navigating the YouTube “AP CSP Unit 1 Digital Information” playlist in Chrome and reading the visible video links/titles. Only the first two were imported before the identical live stall made further “complete all questions” claims unsafe.', 'CQBody')]
link_rows = [[para('No.', 'CQTiny'), para('Video', 'CQTiny'), para('URL', 'CQTiny'), para('Observed status', 'CQTiny')]]
for index, (video_id, title, status) in enumerate(links, 1):
    link_rows.append([
        para(index, 'CQTiny'),
        para(title, 'CQTiny'),
        para('https://www.youtube.com/watch?v=' + video_id, 'CQTiny'),
        para(status, 'CQTiny'),
    ])
link_table = Table(link_rows, colWidths=[0.28 * inch, 1.65 * inch, 2.15 * inch, 3.22 * inch], repeatRows=1)
link_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), PALE),
    ('GRID', (0, 0), (-1, -1), 0.25, LINE),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('LEFTPADDING', (0, 0), (-1, -1), 3),
    ('RIGHTPADDING', (0, 0), (-1, -1), 3),
    ('TOPPADDING', (0, 0), (-1, -1), 3),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ('BACKGROUND', (3, 1), (3, 2), AMBER),
]))
story.append(link_table)

story += [PageBreak(), para('iOS and Android simulator evidence', 'CQH2')]
for item in [
    'iOS: iPhone 17 Pro (iOS 26.2) was already booted. Computer Use opened the app and navigated into an existing quiz at 2/10. A short-answer response was entered, the Check answer button became “In progress,” and the app returned learner-facing feedback (“Almost—try this concept another way.”). Selecting Next triggered a visible “Retrying this concept” state, which remained visible after seven seconds. This is a usable but not complete native generation run.',
    'The iOS simulator therefore confirms launch, navigation, text entry, grading request, feedback, and retry UI. It also reproduces a potential generation/retry wait that should be investigated alongside the Chrome stall.',
    'Android: xcrun showed only the iPhone 17 Pro booted. adb devices returned no attached Android devices, and the emulator CLI was not available in PATH. No Android UI action was fabricated or claimed.',
    'A DeepSeek key was not entered into iOS or Chrome because the Chrome profile already reported a configured key and credentials must not be copied into a report or typed without an action-time confirmation.',
]:
    story.append(bullet(item))

story += [para('Defects found and recommended repair order', 'CQH2')]
for item in [
    'P0: Progressive local generation stalls after a small prefix (4/15 and 3/5 in real Chrome; “Retrying this concept” in iOS). Trace request IDs and lifecycle events from the browser handoff through extension service worker and progressive import. Add a visible bounded timeout/retry action that cannot leave the learner indefinitely waiting.',
    'P1: Feedback copy is not tied to grade outcome. The UI can show an error icon while the explanation says the answer matches the core idea. Render reason-first AI feedback with explicit Correct/Wrong polarity and an outcome-specific fallback.',
    'P1: Completion export needs an observable success/failure state. After clicking Export notes, show download/share confirmation and surface a retry if no artifact is produced; verify the file by name and fresh modification time in E2E.',
    'P2: Finish extension reinstall/reload only after explicit confirmation, then repeat the same ten links with the freshly loaded 0.8.20 artifact and record extension request/response lifecycle logs.',
    'P2: Attach an Android emulator or install the Android SDK emulator command, then rerun the same first-question, short-answer, true/false, completion, and export checks on Android.',
]:
    story.append(bullet(item))

story += [Spacer(1, 10), para('Release decision', 'CQH2'), para('The deployed compatibility fix is live and automated checks are green. The release is not “perfect” for the requested end-to-end acceptance because fresh progressive quiz generation does not reliably produce the full quiz, Chrome reinstall confirmation is pending, Android coverage is unavailable, and completion export did not yield a newly observed artifact in this run. Those are explicit, reproducible follow-up items rather than hidden failures.', 'CQBody')]

doc = SimpleDocTemplate(
    str(OUT), pagesize=letter, rightMargin=0.55 * inch, leftMargin=0.55 * inch,
    topMargin=0.55 * inch, bottomMargin=0.55 * inch,
    title='ClipQuest release and simulator QA report',
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
