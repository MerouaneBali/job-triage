# Job triage

Personal offline helper: **list HTML → SQLite jobs → Claude intelligence → manual apply**.

## Flow

1. **Stage 1 — Parse list HTML**  
   Save Jobs search HTML into `data/dumps/`. Parse upserts job cards into `data/job-triage.sqlite`.
2. **Stage 2 — Fetch descriptions**  
   Guest Playwright fetch updates job rows (+ HTML under `data/dumps/details/`).
3. **Stage 3 — Claude evaluate / generate**  
   Qualify + Anthropic Claude; decisions / materials written to the same SQLite DB (Claude responses also cached there).
4. **Preview + you apply**  
   Next.js UI reads SQLite; run stages from the page; open LinkedIn yourself.

```bash
# Node 22+ recommended (see .nvmrc)
nvm use
npm install
npm install --prefix web
cp .env.example .env   # set ANTHROPIC_API_KEY

# Preview UI (also drives the pipeline)
npm run preview
# → http://127.0.0.1:4173

# Or CLI:
npm run parse -- data/dumps/<file>.html
npm run fetch-details -- <basename> --limit 5
npm run stage3 -- <basename> --limit 3
```

`<basename>` is the dump stem, e.g. `linkedin-jobs-2026-11-03T00-01-37-705Z` (no `.json`).

## Profile

Edit before trusting Stage 3:

| File | Purpose |
|---|---|
| [`data/profile/cv.md`](data/profile/cv.md) | Extracted CV text |
| [`data/profile/canonical.json`](data/profile/canonical.json) | Structured facts + `discrepancies[]` |
| [`data/profile/preferences.md`](data/profile/preferences.md) | Remote/Algeria prefs, avoid-lists |

Bump `profileVersion` in `canonical.json` after edits so the Claude cache refreshes.

## Layout

```
data/dumps/              # list HTML + details/{id}.html
data/job-triage.sqlite   # dumps, jobs, Claude cache
data/profile/            # CV / prefs / canonical
src/db.mjs               # shared SQLite schema + helpers
src/stage1|stage2|stage3/
web/                     # Next.js + shadcn preview UI
```

Personal dumps, SQLite, `.env`, and `data/*.pdf` are gitignored.

## Stage 3 notes

- Uses **Anthropic Claude** (`ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`).
- Hard `qualify` skips clearance / obvious geo mismatches without spending tokens.
- Evaluations cached by job id + description hash + profile version + prompt version.
- Never auto-applies or messages recruiters.
