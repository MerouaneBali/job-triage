/**
 * SQLite cache for Stage 3 evaluations / generations.
 * Uses the app DB (data/job-triage.sqlite).
 */

import { createHash } from "node:crypto";
import { defaultDbPath, openDb } from "../db.mjs";

export function hashText(s) {
  return createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

export function openCache(dbPath = defaultDbPath()) {
  const db = openDb(dbPath);

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
