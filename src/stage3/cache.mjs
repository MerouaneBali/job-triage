/**
 * SQLite cache for Stage 3 evaluations / generations.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

export function hashText(s) {
  return createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

export function openCache(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      cache_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      job_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_stage1 TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      meta TEXT
    );
    CREATE TABLE IF NOT EXISTS prompt_versions (
      name TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const getStmt = db.prepare(`SELECT payload FROM cache WHERE cache_key = ?`);
  const setStmt = db.prepare(`
    INSERT INTO cache (cache_key, kind, job_id, payload, created_at)
    VALUES (@cache_key, @kind, @job_id, @payload, @created_at)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload = excluded.payload,
      created_at = excluded.created_at
  `);

  return {
    db,
    get(cacheKey) {
      const row = getStmt.get(cacheKey);
      if (!row) return null;
      try {
        return JSON.parse(row.payload);
      } catch {
        return null;
      }
    },
    set(cacheKey, kind, jobId, payload) {
      setStmt.run({
        cache_key: cacheKey,
        kind,
        job_id: String(jobId),
        payload: JSON.stringify(payload),
        created_at: new Date().toISOString(),
      });
    },
    makeKey({ kind, jobId, descriptionHash, profileVersion, promptVersion }) {
      return [kind, jobId, descriptionHash, profileVersion, promptVersion].join(
        "|"
      );
    },
    close() {
      db.close();
    },
  };
}

export default openCache;
