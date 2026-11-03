#!/usr/bin/env node
/**
 * Tiny static + API server for the job triage preview SPA.
 *
 *   node preview-server.mjs
 *   → http://127.0.0.1:4173
 *
 * Serves preview/ and lists JSON files from out/.
 */

import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const previewDir = join(root, "preview");
const outDir = join(root, "out");
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
  const payload = typeof body === "string" || Buffer.isBuffer(body)
    ? body
    : JSON.stringify(body);
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function listDumps() {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".preview.json"))
    .map((name) => {
      const full = join(outDir, name);
      const st = statSync(full);
      let jobCount = null;
      let dumpedAt = null;
      let source = null;
      try {
        const raw = JSON.parse(readFileSync(full, "utf8"));
        if (Array.isArray(raw)) {
          jobCount = raw.length;
        } else if (raw && typeof raw === "object") {
          jobCount = Array.isArray(raw.jobs) ? raw.jobs.length : null;
          dumpedAt = raw.dumpedAt ?? null;
          source = raw.source ?? null;
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
    const full = join(outDir, name);
    if (!existsSync(full)) {
      send(res, 404, { error: "Dump not found" }, {
        "Content-Type": "application/json; charset=utf-8",
      });
      return;
    }
    try {
      const data = readFileSync(full);
      send(res, 200, data, {
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
  console.log(`Serving JSON from ${outDir}`);
});
