# Job triage web UI

Next.js App Router + shadcn. Requires **Node 22+** (repo `.nvmrc`).

```bash
nvm use
npm install
npm run dev
# http://127.0.0.1:4173
```

From repo root: `npm run preview`.

API routes spawn `src/stage{1,2,3}` CLIs against `../data`. Repo-root `.env` is loaded for Anthropic.
