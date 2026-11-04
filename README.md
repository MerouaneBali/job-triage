# Job triage

Personal helper: **list HTML → SQLite jobs → Claude intelligence → manual apply** (laptop, phone, or Raspberry Pi).

## Flow

1. **Stage 1 — Parse list HTML**  
   Save or **upload** Jobs search HTML into `data/dumps/`. Parse upserts job cards into `data/job-triage.sqlite`.
2. **Stage 2 — Fetch descriptions**  
   Guest Playwright fetch updates job rows (+ HTML under `data/dumps/details/`). Use **`--no-pause`** / UI “Unattended” on a Pi.
3. **Stage 3 — Claude evaluate / generate**  
   Qualify + Anthropic Claude; decisions / materials in SQLite.
4. **Apply**  
   Phone-friendly **Apply** tab: open LinkedIn, copy outreach/cover. You still apply yourself.

```bash
# Node 22+ (see .nvmrc)
nvm use
npm install
npm install --prefix web
cp .env.example .env   # set ANTHROPIC_API_KEY

# Preview (listens on 0.0.0.0:4173 by default — phone on same Wi‑Fi works)
npm run preview
# → http://<this-machine-ip>:4173
# Localhost only: HOST=127.0.0.1 npm run preview

# CLI:
npm run parse -- data/dumps/<file>.html
npm run fetch-details -- <basename> --limit 5 --no-pause
npm run stage3 -- <basename> --limit 3
```

`<basename>` is the dump stem, e.g. `linkedin-jobs-2026-11-03T00-01-37-705Z`.

## Phone + Raspberry Pi

- **Laptop:** develop and test; open preview from your phone on Wi‑Fi or Tailscale.
- **Pi (production):** always-on UI + DB + stages behind Tailscale (no modem port-forward).

Full steps: **[`docs/pi-setup.md`](docs/pi-setup.md)** (Node 22, Tailscale, Playwright, systemd, update workflow).

## Profile

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
docs/pi-setup.md         # Pi + Tailscale deploy
src/db.mjs
src/stage1|stage2|stage3/
web/                     # Next.js + shadcn UI
```

Personal dumps, SQLite, `.env`, and `data/*.pdf` are gitignored.

## Stage 3 notes

- Uses **Anthropic Claude** (`ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`).
- Hard `qualify` skips clearance / obvious geo mismatches without spending tokens.
- Never auto-applies or messages recruiters.
