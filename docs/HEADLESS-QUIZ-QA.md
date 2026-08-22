# Headless quiz QA

The headless runner exercises ClipQuest's production local DeepSeek generator,
validators, retry policy, and reason-first answer grader.

## Credential

Provide the local DeepSeek key through the process environment. The runner does
not read browser extension storage, and it never prints the
key.

```bash
export CLIPQUEST_DEEPSEEK_API_KEY="your-key"
```

`DEEPSEEK_API_KEY` is also accepted. The root command loads an ignored local
`.env` file when it exists, so an existing development key can be reused
without placing it on the command line.

## One video

```bash
npm run qa:quiz -- \
  --url "https://www.youtube.com/watch?v=JoscDcbAjbY" \
  --count 10 \
  --types all \
  --transport stream \
  --answer-and-grade
```

Use `--transport stream` for the browser response path.

## Automatic recovery

This command injects one DeepSeek network interruption after two accepted
questions. The same run must recover to the requested bank size without user
input.

```bash
npm run qa:quiz -- \
  --url "https://www.youtube.com/watch?v=JoscDcbAjbY" \
  --count 10 \
  --interrupt-after 2
```

## Batch run

Create a UTF-8 text file containing one YouTube URL per line. Empty lines and
lines beginning with `#` are ignored.

```bash
npm run qa:quiz -- \
  --file qa-videos.txt \
  --count 10 \
  --types all \
  --transport both \
  --answer-and-grade
```

Runs are sequential so their output stays readable and normal DeepSeek rate
limits are respected. A batch continues after an individual failure and exits
nonzero when any run fails.

## Evidence and artifacts

For every generated question, the runner requires matching DeepSeek call-start
and successful call-completion events. A question without that provenance is
rejected; the runner never creates or accepts fallback questions.

By default, each run writes three files under `output/headless/`:

- A human-readable `.txt` transcript.
- A normalized `.json` result.
- A chronological `.jsonl` event stream.

Use `--no-artifacts` for terminal-only output. The API key and authorization
headers are never included in reporter events or artifacts.
