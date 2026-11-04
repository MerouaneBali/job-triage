# Job triage

Personal offline helper: **list → detail → Claude intelligence → manual apply**.

## Flow

1. **Stage 1 — list cards**  
   Dump Jobs search HTML into `data/dumps/`, parse to `data/stage1/*.json`.
2. **Stage 2 — descriptions**  
   Guest Playwright fetch → `data/stage2/*.json` (+ HTML under `data/dumps/details/`).
3. **Stage 3 — Claude evaluate / generate**  
   Merge + hard qualify, then Anthropic Claude for fit scores and (for apply/maybe) cover letter / outreach. Results in `data/stage3/*.json` (SQLite cache in `data/stage3/job-triage.sqlite`).
4. **Preview + you apply**  
   Local SPA; you open URLs / send messages yourself.

```bash
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY

# Stage 1
npm run parse

# Stage 2
npm run fetch-details -- data/stage1/<file>.json
# or re-parse saved HTML:
npm run fetch-details -- data/stage1/<file>.json --reparse-only

# Stage 3 (Claude)
npm run stage3 -- data/stage1/<file>.json --limit 3
npm run stage3 -- data/stage1/<file>.json --skip-generate
npm run stage3 -- data/stage1/<file>.json --qualify-only   # no API

# Preview
npm run preview
# → http://127.0.0.1:4173
```

`--csv` on stage 1 also writes CSV for Sheets (optional; preview uses JSON).

## Profile

Edit before trusting Stage 3:

| File | Purpose |
|---|---|
| [`data/profile/cv.md`](data/profile/cv.md) | Extracted CV text |
| [`data/profile/canonical.json`](data/profile/canonical.json) | Structured facts + `discrepancies[]` |
| [`data/profile/preferences.md`](data/profile/preferences.md) | Remote/Algeria prefs, avoid-lists |

Resolve discrepancies (employment “Present” vs actual end date; “5+ years” framing) before mass-running evaluate. Bump `profileVersion` in `canonical.json` after edits so the cache refreshes.

## Layout

```
data/dumps/           # list + details HTML
data/stage1/          # list JSON
data/stage2/          # detail JSON
data/stage3/          # AI JSON + sqlite cache
data/profile/         # CV / prefs / canonical
src/stage1|stage2|stage3/
src/preview/
```

Personal dumps, stage JSON, `.env`, and `data/*.pdf` are gitignored.

## Stage 3 notes

- Uses **Anthropic Claude** (`ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`).
- Hard `qualify` skips clearance / obvious geo mismatches without spending tokens.
- Evaluations cached by job id + description hash + profile version + prompt version.
- Never auto-applies or messages recruiters.
