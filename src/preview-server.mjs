#!/usr/bin/env node
/**
 * Tiny static + API server for the job triage preview SPA.
 *
 *   npm run preview
 *   → http://127.0.0.1:4173
 *
 * Serves src/preview/ and lists JSON from data/stage1/ (+ matching data/stage2/).
 */

import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const previewDir = join(root, "src", "preview");
const stage1Dir = join(root, "data", "stage1");
const stage2Dir = join(root, "data", "stage2");
const stage3Dir = join(root, "data", "stage3");
const host = "127.0.0.1";
const port = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  const payload =
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body);
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function stage2NameFor(stage1Name) {
  return stage1Name;
}

function listDumps() {
  if (!existsSync(stage1Dir)) return [];
  return readdirSync(stage1Dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const full = join(stage1Dir, name);
      const st = statSync(full);
      let jobCount = null;
      let dumpedAt = null;
      let source = null;
      let detailsOk = 0;
      let stage3Apply = 0;
      let stage3Maybe = 0;
      try {
        const raw = JSON.parse(readFileSync(full, "utf8"));
        if (Array.isArray(raw)) {
          jobCount = raw.length;
        } else if (raw && typeof raw === "object") {
          jobCount = Array.isArray(raw.jobs) ? raw.jobs.length : null;
          dumpedAt = raw.dumpedAt ?? null;
          source = raw.source ?? null;
        }
        const s2Path = join(stage2Dir, stage2NameFor(name));
        if (existsSync(s2Path)) {
          const s2 = JSON.parse(readFileSync(s2Path, "utf8"));
          detailsOk = Array.isArray(s2.jobs)
            ? s2.jobs.filter((j) => j.status === "ok" && j.description).length
            : 0;
        }
        const s3Path = join(stage3Dir, stage2NameFor(name));
        if (existsSync(s3Path)) {
          const s3 = JSON.parse(readFileSync(s3Path, "utf8"));
          for (const j of s3.jobs || []) {
            if (j.decision === "apply") stage3Apply += 1;
            if (j.decision === "maybe") stage3Maybe += 1;
          }
        }
      } catch {
        // still list the file
      }
      return {
        name,
        mtime: st.mtime.toISOString(),
        jobCount,
        dumpedAt,
        source,
        detailsOk,
        stage3Apply,
        stage3Maybe,
      };
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

function safeDumpName(name) {
  const base = basename(name);
  if (base !== name || !base.endsWith(".json") || base.includes("..")) {
    return null;
  }
  return base;
}

function mergeStage1WithStage2(stage1Name) {
  const s1Path = join(stage1Dir, stage1Name);
  const raw = JSON.parse(readFileSync(s1Path, "utf8"));
  const base = Array.isArray(raw)
    ? { dumpedAt: null, parsedAt: null, source: stage1Name, jobs: raw }
    : {
        dumpedAt: raw.dumpedAt ?? null,
        parsedAt: raw.parsedAt ?? null,
        source: raw.source ?? stage1Name,
        jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
      };

  const s2Path = join(stage2Dir, stage2NameFor(stage1Name));
  const byId = new Map();
  if (existsSync(s2Path)) {
    try {
      const s2 = JSON.parse(readFileSync(s2Path, "utf8"));
      for (const j of s2.jobs || []) {
        if (j && j.id) byId.set(String(j.id), j);
      }
      base.stage2FetchedAt = s2.fetchedAt ?? null;
    } catch {
      // ignore
    }
  }

  const s3ById = new Map();
  const s3Path = join(stage3Dir, stage2NameFor(stage1Name));
  if (existsSync(s3Path)) {
    try {
      const s3 = JSON.parse(readFileSync(s3Path, "utf8"));
      base.stage3CreatedAt = s3.createdAt ?? null;
      base.stage3Summary = s3.summary ?? null;
      for (const j of s3.jobs || []) {
        if (j && j.id) s3ById.set(String(j.id), j);
      }
    } catch {
      // ignore
    }
  }

  base.jobs = base.jobs.map((j) => {
    const d = byId.get(String(j.id));
    const s3 = s3ById.get(String(j.id));
    const row = {
      ...j,
      description: d?.description ?? null,
      detailStatus: d?.status ?? null,
      detailError: d?.error ?? null,
      decision: s3?.decision ?? null,
      fitScore: s3?.fitScore ?? null,
      confidence: s3?.confidence ?? null,
      recommendation: s3?.evaluation?.recommendation ?? null,
      materials: s3?.materials ?? null,
      qualifyReasons: s3?.qualify?.reasons ?? null,
      stage3Error: s3?.error ?? null,
    };
    return row;
  });
  base.detailsOk = base.jobs.filter((j) => j.description).length;
  base.stage3Ok = base.jobs.filter(
    (j) => j.decision === "apply" || j.decision === "maybe"
  ).length;
  return base;
}

function serveStatic(reqPath, res) {
  let rel = reqPath === "/" ? "/index.html" : reqPath;
  rel = decodeURIComponent(rel.split("?")[0]);
  if (rel.includes("..")) {
    send(res, 400, "Bad path");
    return;
  }
  const filePath = join(previewDir, rel);
  if (!filePath.startsWith(previewDir) || !existsSync(filePath)) {
    send(res, 404, "Not found");
    return;
  }
  const ext = extname(filePath).toLowerCase();
  try {
    const data = readFileSync(filePath);
    send(res, 200, data, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
  } catch {
    send(res, 500, "Read failed");
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/dumps") {
    send(res, 200, { dumps: listDumps() }, {
      "Content-Type": "application/json; charset=utf-8",
    });
    return;
  }

  const dumpMatch = pathname.match(/^\/api\/dumps\/([^/]+)$/);
  if (req.method === "GET" && dumpMatch) {
    const name = safeDumpName(decodeURIComponent(dumpMatch[1]));
    if (!name) {
      send(res, 400, { error: "Invalid dump name" }, {
        "Content-Type": "application/json; charset=utf-8",
      });
      return;
    }
    const full = join(stage1Dir, name);
    if (!existsSync(full)) {
      send(res, 404, { error: "Dump not found" }, {
        "Content-Type": "application/json; charset=utf-8",
      });
      return;
    }
    try {
      const merged = mergeStage1WithStage2(name);
      send(res, 200, merged, {
        "Content-Type": "application/json; charset=utf-8",
      });
    } catch {
      send(res, 500, { error: "Read failed" }, {
        "Content-Type": "application/json; charset=utf-8",
      });
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(pathname, res);
    return;
  }

  send(res, 405, "Method not allowed");
});

server.listen(port, host, () => {
  console.log(`Job triage preview → http://${host}:${port}`);
  console.log(`Stage-1 JSON: ${stage1Dir}`);
  console.log(`Stage-2 JSON: ${stage2Dir}`);
  console.log(`Stage-3 JSON: ${stage3Dir}`);
});
