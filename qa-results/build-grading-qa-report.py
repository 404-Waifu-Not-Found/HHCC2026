from pathlib import Path
import json
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

root = Path('/Users/unoxyrich/Documents/GitHub/ClipQuest')
data = json.loads(Path('/tmp/clipquest-headless10-report.json').read_text())
out = root / 'output/pdf/clipquest-answer-grading-qa-report-2026-08-18.pdf'
out.parent.mkdir(parents=True, exist_ok=True)

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleCQ', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=22, leading=27, alignment=TA_CENTER, textColor=colors.HexColor('#153b2e'), spaceAfter=12))
styles.add(ParagraphStyle(name='SubCQ', parent=styles['Normal'], fontSize=10, leading=14, alignment=TA_CENTER, textColor=colors.HexColor('#557064'), spaceAfter=18))
styles.add(ParagraphStyle(name='H2CQ', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=colors.HexColor('#153b2e'), spaceBefore=10, spaceAfter=7))
styles.add(ParagraphStyle(name='BodyCQ', parent=styles['BodyText'], fontSize=9, leading=13, spaceAfter=6))
styles.add(ParagraphStyle(name='SmallCQ', parent=styles['BodyText'], fontSize=7.5, leading=10, spaceAfter=3))
styles.add(ParagraphStyle(name='TinyCQ', parent=styles['BodyText'], fontSize=6.5, leading=8))

def p(text, style='BodyCQ'):
    return Paragraph(str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'), styles[style])

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(colors.HexColor('#6b7e74'))
    canvas.drawString(0.55*inch, 0.35*inch, 'ClipQuest • local DeepSeek question QA • captions/transcripts excluded from this report')
    canvas.drawRightString(7.95*inch, 0.35*inch, f'Page {doc.page}')
    canvas.restoreState()

totals = data['totals']
passed = [r for r in data['results'] if r['status'] == 'passed']
failed = [r for r in data['results'] if r['status'] != 'passed']
story = [
    Spacer(1, 0.35*inch),
    p('ClipQuest answer grading & question quality', 'TitleCQ'),
    p('Release QA report • 18 August 2026 • build 6674041e • Worker 8072a257', 'SubCQ'),
    p('Outcome', 'H2CQ'),
    p(f"The repaired validator completed {totals['passed']} of {totals['sources']} cached YouTube sources, generating {totals['questions']} questions. Every accepted learner answer graded correct, every negative-control answer was rejected, and all {totals['shortAnswers']} short-answer canonical responses passed. Two sources were deliberately blocked by the quality gates instead of allowing a repeated objective or an incomplete placeholder answer into a quiz.") ,
    Spacer(1, 8),
]

summary_rows = [
    [p('Metric','SmallCQ'), p('Observed','SmallCQ'), p('Interpretation','SmallCQ')],
    [p('Sources tested','SmallCQ'), p(f"{totals['sources']} ({totals['passed']} pass / {totals['failed']} blocked)",'SmallCQ'), p('Blocked output is safer than shipping malformed content.','SmallCQ')],
    [p('Questions accepted','SmallCQ'), p(totals['questions'],'SmallCQ'), p('MC, true/false, and short answer were exercised.','SmallCQ')],
    [p('Positive controls','SmallCQ'), p(totals['acceptedAnswers'],'SmallCQ'), p('Canonical answers graded correct.','SmallCQ')],
    [p('Negative controls','SmallCQ'), p(totals['rejectedNegativeControls'],'SmallCQ'), p('Wrong MC/TF and “I do not know” short answers rejected.','SmallCQ')],
    [p('Short answers','SmallCQ'), p(f"{totals['shortAnswers']} / {totals['shortAnswersCorrect']} correct",'SmallCQ'), p('Accepted-answer alternatives were also checked where present.','SmallCQ')],
    [p('Local DeepSeek calls','SmallCQ'), p(totals['aiCalls'],'SmallCQ'), p('Generation stayed local; no captions were sent to ClipQuest Worker AI.','SmallCQ')],
    [p('Automatic retries','SmallCQ'), p(totals['retries'],'SmallCQ'), p('Bounded recovery ran without weakening quality validation.','SmallCQ')],
]
t = Table(summary_rows, colWidths=[1.45*inch, 1.25*inch, 4.5*inch], repeatRows=1)
t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#d9eee2')),('TEXTCOLOR',(0,0),(-1,0),colors.HexColor('#153b2e')),('GRID',(0,0),(-1,-1),0.35,colors.HexColor('#bfd5c8')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
story += [t, PageBreak(), p('What changed', 'H2CQ')]
fixes = [
    ('Reason-first local grading', 'Added a shared LocalAnswerGrade contract and a DeepSeek function tool. The model receives only the learner-facing question, the human response, type, and options; it writes a short reason first, then calls grade_answer with correct/wrong, confidence, and matched ideas.'),
    ('Softer semantic feedback', 'Natural paraphrases, concise fragments, and meaning-equivalent short answers are accepted by the local grader. The API score remains authoritative for persistence so a modified browser cannot rewrite mastery.'),
    ('True/false polarity', 'Kept locally assigned polarity authoritative and rejected false items that simply repeat the supported true claim. This prevents a polarity label from contradicting the statement.'),
    ('Exact-stem protection', 'Repeated concepts remain allowed, but prompt-first generation now blocks an exactly repeated learner-facing stem against accepted questions. Near-identical grading targets are still retried.'),
    ('Answer-to-prompt consistency', 'Added checks for condition prompts that lack a condition, why/how prompts that only name a term, and short-answer targets that are not complete responses.'),
    ('Fragment and absolute wording gates', 'Rejects dangling conjunctions and placeholders such as “another effect” or “a third consequence”; rejects unsupported “always/never/all/none/every/must” claims while allowing source-supported absolutes.'),
    ('Cross-platform bridge', 'Added answer-grading-v1 to the Chrome extension, web bridge, iOS, and Android local clients. Extension and app bundle rebuilt as 0.8.20.'),
]
for title, detail in fixes:
    story += [KeepTogether([p(title, 'H2CQ'), p(detail)])]

story += [PageBreak(), p('Ten-source grading matrix', 'H2CQ'), p('The matrix below is generated from the post-fix local DeepSeek run. It records counts and validation outcomes only; it intentionally omits transcript text and API credentials.', 'BodyCQ')]
rows = [[p('Video ID','TinyCQ'), p('Status','TinyCQ'), p('Questions','TinyCQ'), p('Types (MC / TF / short)','TinyCQ'), p('Positives','TinyCQ'), p('Negatives rejected','TinyCQ'), p('Short answers','TinyCQ'), p('Retries','TinyCQ')]]
for r in data['results']:
    rows.append([p(r['id'],'TinyCQ'), p(r['status'],'TinyCQ'), p(r.get('questions') and len(r['questions']) or 0,'TinyCQ'), p('/'.join(str(r.get('typeCounts',{}).get(k,0)) for k in ('multiple_choice','true_false','short_answer')),'TinyCQ'), p(r.get('correctCount',0),'TinyCQ'), p(r.get('negativeRejectCount',0),'TinyCQ'), p(f"{r.get('shortAnswerCorrect',0)}/{r.get('shortAnswerCount',0)}",'TinyCQ'), p(r.get('metrics',{}).get('retryCount',0),'TinyCQ')])
t2=Table(rows, colWidths=[1.05*inch,.62*inch,.55*inch,1.35*inch,.65*inch,.8*inch,.72*inch,.55*inch], repeatRows=1)
t2.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#d9eee2')),('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#bfd5c8')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
story += [t2, Spacer(1,10), p('Blocked-source diagnostics', 'H2CQ')]
for r in failed:
    story += [p(f"{r['id']}: {r.get('reason','quality gate')}", 'SmallCQ')]
story += [p('These are quality failures, not accepted quiz defects. The correct behavior is to retry with a different grounded objective or show recovery/configuration guidance; shipping the malformed candidate would violate the requested “not exactly the same,” prompt/answer consistency, and incomplete-answer rules.', 'BodyCQ')]

story += [PageBreak(), p('Live Chrome and Cloudflare evidence', 'H2CQ')]
live = [
    'Chrome production tab: https://clipquest.ccwu.cc/ (signed-in session).',
    'Live DOM showed completed cards with enabled “Export notes” and incomplete cards with disabled “Notes not ready.”',
    'Clicked the enabled export action for “The History of Femboys”; a PDF was downloaded as “The-History-of-Femboys-cheat-sheet (2).pdf”.',
    'Cloudflare Worker version 8072a257-adaf-4706-afd7-fce6587c4bdc was promoted to 100% traffic with tag 6674041e4959185b51311d13dfe3810391a01d83.',
    'Production asset probe at +0s passed: 9 HTML shells and 9 entry bundles, with version affinity present.',
    'Previous release long-tail probes also passed at +0s, +120s, +300s, and +600s for the first deployment.',
]
for item in live: story.append(p('• '+item))
story += [p('Chrome extension note', 'H2CQ'), p('The existing Chrome profile had an older loaded extension during the live tab check, so the new answer-grading-v1 capability was verified in source/tests and in the published 0.8.20 ZIP, but not claimed as loaded into that profile. Installing/reloading a browser extension is a separate browser-side action requiring an action-time confirmation; the live export path itself was verified successfully.')]

story += [PageBreak(), p('Remaining issues and next actions', 'H2CQ')]
remaining = [
    'Two of ten cached sources remain blocked after bounded retries: one repeats an accepted objective and one emits an incomplete placeholder answer. They are not silently accepted.',
    'The local DeepSeek reason is learner-facing feedback; persisted correctness/mastery still comes from the authenticated API decision. This preserves integrity while making feedback softer.',
    'Reload the published 0.8.20 extension ZIP in Chrome, then repeat the ten-link browser flow to verify answer-grading-v1 dispatch in the installed profile.',
    'For production release confidence, keep the blocked-source fixtures in the regression set and require a replacement grounded objective rather than relaxing the quality gates.',
]
for item in remaining: story.append(p('• '+item))
story += [Spacer(1, 12), p('Release decision: code and deployment checks pass; question-quality QA is safer and more honest, with 8/10 sources accepted and 2/10 blocked for repair instead of shipping defects.', 'BodyCQ')]

doc = SimpleDocTemplate(str(out), pagesize=letter, rightMargin=.55*inch, leftMargin=.55*inch, topMargin=.55*inch, bottomMargin=.55*inch, title='ClipQuest answer grading QA report')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(out)
