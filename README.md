# Job triage

Personal offline helper to **list → detail → triage** LinkedIn jobs before you apply.

## Flow

1. **Stage 1 — list cards**  
   Dump the Jobs search page (Save Page As or bookmarklet) into `data/dumps/`, parse to JSON.
2. **Stage 2 — descriptions**  
   Guest Playwright browser opens each job URL (not your Chrome profile), saves HTML, extracts description. Pauses if captcha/manual help needed.
3. **Preview**  
   Local SPA merges stage-1 + stage-2 for filtering and bulk-open.

```bash
npm install

# Stage 1: parse list dumps (default folder data/dumps/)
npm run parse
# or: node src/stage1/parse-jobs.mjs data/dumps/one.html
# --csv also writes a CSV for Excel/Sheets (optional; preview uses JSON)

# Stage 2: fetch descriptions for a stage-1 file
npm run fetch-details -- data/stage1/linkedin-jobs-….json --limit 2
# full run:
npm run fetch-details -- data/stage1/linkedin-jobs-….json
# re-parse already-saved detail HTML (no browser):
npm run fetch-details -- data/stage1/….json --reparse-only
# optional proxy for later IP rotation:
npm run fetch-details -- data/stage1/….json --proxy http://127.0.0.1:7890

# Preview UI
npm run preview
# → http://127.0.0.1:4173
```

## Layout

```
data/dumps/           # list HTML dumps (+ details/ for stage-2 HTML)
data/stage1/          # list JSON
data/stage2/          # detail JSON (same basename as stage-1)
src/stage1/           # parse-jobs.mjs
src/stage2/           # fetch-details.mjs, parse-detail.mjs
src/preview/          # triage SPA
src/preview-server.mjs
bookmarklet.html
```

`data/**` dumps and JSON are gitignored (personal).

## Stage 2 notes

- **Headed Chromium** by default so you can solve captchas. Do **not** log into LinkedIn in that window.
- Sessions are **ephemeral** (no profile / storageState); closed when the script exits.
- **Resume:** re-run skips jobs already `status: "ok"` with a description.
- **`--delay`** base wait between jobs (default 4000ms + jitter).
- **`--proxy` / `HTTP_PROXY`:** for VPN/proxy rotation later.

## Bookmarklet (optional)

Open `bookmarklet.html`, drag **Dump LinkedIn Jobs HTML** to the bookmarks bar. Downloads go to your browser Downloads folder — move files into `data/dumps/`. Unique timestamped names; Save Page As can overwrite by tab title.

## Posted times (stage 1)

Relative phrases (`7 hours ago`) become absolute `postedAt` using dump time (bookmarklet marker → file mtime → now). Preview recomputes “ago” when you load a dump.
