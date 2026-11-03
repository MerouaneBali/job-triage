# Job triage (LinkedIn dumps → JSON/CSV + preview SPA)

Personal offline helper: dump the Jobs results page, parse stable fields, then triage in a local preview app (select rows, bulk-open links).

## Workflow

1. LinkedIn search + filters + scroll until cards load  
2. **Save Page As** (Webpage, HTML Only) **or** the optional bookmarklet  
3. Put the file in `dumps/`  
4. Parse → open the preview SPA  

```bash
cd ~/Work/job-triage

node parse-jobs.mjs                 # all .html in dumps/
node parse-jobs.mjs dumps/one.html  # one file
node parse-jobs.mjs other-folder    # all .html in that folder
node parse-jobs.mjs --csv           # also write CSV for Excel/Sheets (optional)

# Triage UI (reads out/*.json — edit the SPA once, not per dump)
node preview-server.mjs
# → http://127.0.0.1:4173
```

Each parse always writes `out/….json` (what the preview SPA reads).  
`--csv` is optional: it also writes `out/….csv` if you want to open the same jobs in Excel or Google Sheets. You do not need it for the preview.

## Preview SPA

One light vanilla app in `preview/`, served by `preview-server.mjs` (no npm deps):

- Dropdown of every JSON dump in `out/`  
- Company column shows logo (when present) + name  
- Filter by text, Easy Apply, has salary  
- Select all / deselect visible rows  
- **Open selected** (staggered tabs; allow popups if blocked)  
- Posted “ago” labels recomputed from `postedAt` when you load a dump  

Change the UI in `preview/` once — all dumps pick it up after refresh.

## Save Page As vs bookmarklet

Both can work. Save Page As lets you pick a folder; the bookmarklet always downloads to your browser’s Downloads folder (browsers block bookmarklets from choosing `dumps/`), then you move the file.

| | Save Page As | Bookmarklet |
|---|---|---|
| Folder | You choose | Downloads only |
| Filename | Tab title (can overwrite) | `linkedin-jobs-{UTC-stamp}.html` (unique) |
| Dump stamp | File modified time | Embeds `<!-- job-triage-dumped-at: … -->` |

The bookmarklet is optional convenience: one click, live DOM, unique name. It only reads the current tab’s HTML and downloads it — no LinkedIn API calls. It runs on whatever page you’re on when you click it.

Setup: open `bookmarklet.html`, drag **Dump LinkedIn Jobs HTML** to the bookmarks bar.

## Posted times

LinkedIn cards show relative text (`7 hours ago`). At parse time we:

1. Resolve `dumpedAt` (bookmarklet marker → file mtime → now)  
2. Convert each phrase to absolute `postedAt`  
3. Keep `postedRaw` as seen on the card  
4. Recompute a fresh `posted` label from `postedAt`

The preview also recomputes “X ago” when you load a dump, so ages stay honest without re-parsing.

## What gets extracted

| Field | Source |
|---|---|
| `id` / `url` | `componentkey="job-card-component-ref-{id}"` |
| `title` | `aria-label="Dismiss … job"` |
| `company`, `location`, `salary` | Text heuristics inside each card |
| `postedRaw` / `postedAt` / `posted` | Relative phrase → absolute → fresh label |
| `easyApply`, `earlyApplicant`, `verified` | Phrase / badge detection |
| `dumpedAt`, `parsedAt`, `source` | Dump/parse metadata |

Parser intentionally **ignores hashed CSS classes** so LinkedIn style renames don’t break it. If `componentkey` or dismiss labels disappear, the script exits with a clear error instead of inventing junk.
