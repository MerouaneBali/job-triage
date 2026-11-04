/**
 * Load merged job cards + descriptions from SQLite for Stage 3.
 */

import { loadMergedJobs, openDb, defaultDbPath } from "../db.mjs";

/**
 * @param {string} basename Dump stem
 * @param {import('better-sqlite3').Database} [db]
 */
export function mergeFromDb(basename, db) {
  const owned = !db;
  const conn = db || openDb(defaultDbPath());
  try {
    const { dump, jobs } = loadMergedJobs(conn, basename);
    return {
      dump,
      basename: dump.basename,
      sourceStage1: dump.source_html || `${dump.basename}.html`,
      dumpedAt: dump.dumped_at || null,
      mergedAt: new Date().toISOString(),
      jobs,
    };
  } finally {
    if (owned) conn.close();
  }
}

/** @deprecated Use mergeFromDb — kept name for clarity in run.mjs */
export function mergeStageFiles(basenameOrPath) {
  const stem = String(basenameOrPath)
    .split(/[/\\]/)
    .pop()
    .replace(/\.(json|html|htm)$/i, "");
  return mergeFromDb(stem);
}

export default mergeFromDb;
