/**
 * App SQLite: dumps + jobs (+ Stage 3 Claude cache).
 * Path: data/job-triage.sqlite
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jobFingerprint, normalizeJobText } from "./job-fingerprint.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export { jobFingerprint, normalizeJobText };

export function defaultDbPath() {
  return join(root, "data", "job-triage.sqlite");
}

export function legacyCachePath() {
  return join(root, "data", "stage3", "job-triage.sqlite");
}

function migrateSchema(db) {
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
    CREATE TABLE IF NOT EXISTS dumps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      basename TEXT NOT NULL UNIQUE,
      source_html TEXT,
      dumped_at TEXT,
      parsed_at TEXT,
      fetched_at TEXT,
      stage3_at TEXT,
      profile_version TEXT,
      model TEXT,
      summary_apply INTEGER NOT NULL DEFAULT 0,
      summary_maybe INTEGER NOT NULL DEFAULT 0,
      summary_skip INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      dump_id INTEGER NOT NULL,
      job_id TEXT NOT NULL,
      title TEXT,
      company TEXT,
      location TEXT,
      salary TEXT,
      posted TEXT,
      posted_raw TEXT,
      posted_at TEXT,
      easy_apply INTEGER NOT NULL DEFAULT 0,
      early_applicant INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      logo_url TEXT,
      url TEXT,
      detail_status TEXT,
      description TEXT,
      detail_error TEXT,
      html_path TEXT,
      detail_fetched_at TEXT,
      decision TEXT,
      fit_score REAL,
      confidence REAL,
      qualify_json TEXT,
      evaluation_json TEXT,
      materials_json TEXT,
      stage3_error TEXT,
      PRIMARY KEY (dump_id, job_id),
      FOREIGN KEY (dump_id) REFERENCES dumps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_decision ON jobs(decision);
    CREATE INDEX IF NOT EXISTS idx_dumps_updated ON dumps(updated_at);
  `);

  ensureJobsTrackColumns(db);
}

/** Additive columns for application tracking (safe on existing DBs). */
export function ensureJobsTrackColumns(db) {
  const cols = new Set(
    db.prepare(`PRAGMA table_info(jobs)`).all().map((r) => r.name)
  );
  const add = (name, ddl) => {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${ddl}`);
      cols.add(name);
    }
  };
  add("track_status", "TEXT");
  add("apply_channel", "TEXT");
  add("track_note", "TEXT");
  add("tracked_at", "TEXT");
  add("applied_at", "TEXT");
  add("source", "TEXT");
  add("apply_url", "TEXT");
  add("poster_type", "TEXT"); // 'direct' | 'agency' | null

  db.exec(`
    UPDATE jobs SET source = 'linkedin_job' WHERE source IS NULL OR source = '';
    UPDATE jobs
    SET
      track_status = 'todo',
      tracked_at = COALESCE(tracked_at, '${nowIso()}')
    WHERE decision IN ('apply', 'maybe')
      AND (track_status IS NULL OR track_status = '');
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_jobs_track_status ON jobs(track_status)`
  );
}

/** Copy Claude cache rows from legacy path if new DB is empty of cache. */
function importLegacyCache(db) {
  const legacy = legacyCachePath();
  if (!existsSync(legacy)) return;
  const count = db.prepare(`SELECT COUNT(*) AS n FROM cache`).get().n;
  if (count > 0) return;
  try {
    const old = new Database(legacy, { readonly: true });
    const rows = old.prepare(`SELECT cache_key, kind, job_id, payload, created_at FROM cache`).all();
    old.close();
    if (!rows.length) return;
    const ins = db.prepare(`
      INSERT OR IGNORE INTO cache (cache_key, kind, job_id, payload, created_at)
      VALUES (@cache_key, @kind, @job_id, @payload, @created_at)
    `);
    const tx = db.transaction((list) => {
      for (const r of list) ins.run(r);
    });
    tx(rows);
    console.log(`Imported ${rows.length} cache rows from legacy SQLite`);
  } catch (e) {
    console.warn(`Legacy cache import skipped: ${e.message || e}`);
  }
}

export function openDb(dbPath = defaultDbPath()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrateSchema(db);
  importLegacyCache(db);
  return db;
}

export function nowIso() {
  return new Date().toISOString();
}

export function basenameFromHtml(htmlName) {
  return String(htmlName).replace(/\.html?$/i, "");
}

export function basenameFromArg(arg) {
  const base = String(arg).split(/[/\\]/).pop() || String(arg);
  return base.replace(/\.(json|html|htm)$/i, "");
}

export function relativeDetailPath(jobId) {
  return `dumps/details/${jobId}.html`;
}

export function upsertDump(db, fields) {
  const updatedAt = fields.updated_at || nowIso();
  const existing = db
    .prepare(`SELECT id FROM dumps WHERE basename = ?`)
    .get(fields.basename);
  if (existing) {
    db.prepare(`
      UPDATE dumps SET
        source_html = COALESCE(@source_html, source_html),
        dumped_at = COALESCE(@dumped_at, dumped_at),
        parsed_at = COALESCE(@parsed_at, parsed_at),
        fetched_at = COALESCE(@fetched_at, fetched_at),
        stage3_at = COALESCE(@stage3_at, stage3_at),
        profile_version = COALESCE(@profile_version, profile_version),
        model = COALESCE(@model, model),
        summary_apply = COALESCE(@summary_apply, summary_apply),
        summary_maybe = COALESCE(@summary_maybe, summary_maybe),
        summary_skip = COALESCE(@summary_skip, summary_skip),
        updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: existing.id,
      source_html: fields.source_html ?? null,
      dumped_at: fields.dumped_at ?? null,
      parsed_at: fields.parsed_at ?? null,
      fetched_at: fields.fetched_at ?? null,
      stage3_at: fields.stage3_at ?? null,
      profile_version: fields.profile_version ?? null,
      model: fields.model ?? null,
      summary_apply: fields.summary_apply ?? null,
      summary_maybe: fields.summary_maybe ?? null,
      summary_skip: fields.summary_skip ?? null,
      updated_at: updatedAt,
    });
    return existing.id;
  }
  const info = db
    .prepare(`
      INSERT INTO dumps (
        basename, source_html, dumped_at, parsed_at, fetched_at, stage3_at,
        profile_version, model, summary_apply, summary_maybe, summary_skip, updated_at
      ) VALUES (
        @basename, @source_html, @dumped_at, @parsed_at, @fetched_at, @stage3_at,
        @profile_version, @model, @summary_apply, @summary_maybe, @summary_skip, @updated_at
      )
    `)
    .run({
      basename: fields.basename,
      source_html: fields.source_html ?? null,
      dumped_at: fields.dumped_at ?? null,
      parsed_at: fields.parsed_at ?? null,
      fetched_at: fields.fetched_at ?? null,
      stage3_at: fields.stage3_at ?? null,
      profile_version: fields.profile_version ?? null,
      model: fields.model ?? null,
      summary_apply: fields.summary_apply ?? 0,
      summary_maybe: fields.summary_maybe ?? 0,
      summary_skip: fields.summary_skip ?? 0,
      updated_at: updatedAt,
    });
  return Number(info.lastInsertRowid);
}

export function getDumpByBasename(db, basename) {
  return db.prepare(`SELECT * FROM dumps WHERE basename = ?`).get(basename) || null;
}

export function getDumpById(db, id) {
  return db.prepare(`SELECT * FROM dumps WHERE id = ?`).get(id) || null;
}

export function upsertJobCard(db, dumpId, job) {
  db.prepare(`
    INSERT INTO jobs (
      dump_id, job_id, title, company, location, salary, posted, posted_raw, posted_at,
      easy_apply, early_applicant, verified, logo_url, url, source, poster_type
    ) VALUES (
      @dump_id, @job_id, @title, @company, @location, @salary, @posted, @posted_raw, @posted_at,
      @easy_apply, @early_applicant, @verified, @logo_url, @url, @source, @poster_type
    )
    ON CONFLICT(dump_id, job_id) DO UPDATE SET
      title = excluded.title,
      company = excluded.company,
      location = excluded.location,
      salary = excluded.salary,
      posted = excluded.posted,
      posted_raw = excluded.posted_raw,
      posted_at = excluded.posted_at,
      easy_apply = excluded.easy_apply,
      early_applicant = excluded.early_applicant,
      verified = excluded.verified,
      logo_url = excluded.logo_url,
      url = excluded.url,
      source = COALESCE(jobs.source, excluded.source),
      poster_type = COALESCE(excluded.poster_type, jobs.poster_type)
  `).run({
    dump_id: dumpId,
    job_id: String(job.id),
    title: job.title ?? null,
    company: job.company ?? null,
    location: job.location ?? null,
    salary: job.salary ?? null,
    posted: job.posted ?? null,
    posted_raw: job.postedRaw ?? null,
    posted_at: job.postedAt ?? null,
    easy_apply: job.easyApply ? 1 : 0,
    early_applicant: job.earlyApplicant ? 1 : 0,
    verified: job.verified ? 1 : 0,
    logo_url: job.logoUrl ?? null,
    url: job.url ?? null,
    source: job.source ?? "linkedin_job",
    poster_type: job.posterType ?? null,
  });
}

export function updateJobDetail(db, dumpId, jobId, detail) {
  db.prepare(`
    UPDATE jobs SET
      detail_status = @detail_status,
      description = @description,
      detail_error = @detail_error,
      html_path = @html_path,
      detail_fetched_at = @detail_fetched_at,
      title = COALESCE(@title, title),
      company = COALESCE(@company, company),
      apply_url = COALESCE(@apply_url, apply_url)
    WHERE dump_id = @dump_id AND job_id = @job_id
  `).run({
    dump_id: dumpId,
    job_id: String(jobId),
    detail_status: detail.status ?? null,
    description: detail.description ?? null,
    detail_error: detail.error ?? null,
    html_path: detail.htmlPath ?? null,
    detail_fetched_at: detail.fetchedAt ?? null,
    title: detail.title ?? null,
    company: detail.company ?? null,
    apply_url: detail.applyUrl ?? null,
  });
}

export function updateJobTriage(db, dumpId, jobId, triage) {
  const decision = triage.decision ?? null;
  const stamp = nowIso();
  // Derive poster_type from qualify signals if not already set
  const agencyFromSignals =
    triage.qualify?.signals?.agency === true ? "agency" : null;
  db.prepare(`
    UPDATE jobs SET
      decision = @decision,
      fit_score = @fit_score,
      confidence = @confidence,
      qualify_json = @qualify_json,
      evaluation_json = @evaluation_json,
      materials_json = @materials_json,
      stage3_error = @stage3_error,
      poster_type = COALESCE(jobs.poster_type, @poster_type),
      track_status = CASE
        WHEN @decision IN ('apply', 'maybe') AND (track_status IS NULL OR track_status = '')
          THEN 'todo'
        ELSE track_status
      END,
      tracked_at = CASE
        WHEN @decision IN ('apply', 'maybe') AND (track_status IS NULL OR track_status = '')
          THEN @stamp
        ELSE tracked_at
      END
    WHERE dump_id = @dump_id AND job_id = @job_id
  `).run({
    dump_id: dumpId,
    job_id: String(jobId),
    decision,
    fit_score: triage.fitScore ?? null,
    confidence: triage.confidence ?? null,
    qualify_json: triage.qualify ? JSON.stringify(triage.qualify) : null,
    evaluation_json: triage.evaluation
      ? JSON.stringify(triage.evaluation)
      : null,
    materials_json: triage.materials ? JSON.stringify(triage.materials) : null,
    stage3_error: triage.error ?? triage.stage3Error ?? null,
    poster_type: agencyFromSignals,
    stamp,
  });
}

/**
 * Find another job row that is the same posting (same job_id or title+company twin)
 * with usable detail or triage data.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ title?: string|null, company?: string|null, jobId?: string|null, excludeDumpId: number, excludeJobId: string, needDescription?: boolean, needDecision?: boolean }} opts
 * @returns {Record<string, unknown>|null}
 */
export function findJobTwin(db, opts) {
  const excludeDumpId = opts.excludeDumpId;
  const excludeJobId = String(opts.excludeJobId);
  const needDescription = Boolean(opts.needDescription);
  const needDecision = Boolean(opts.needDecision);
  const fp = jobFingerprint(opts.title, opts.company);
  const jobId = opts.jobId != null ? String(opts.jobId) : excludeJobId;

  const rows = db
    .prepare(
      `
    SELECT j.*, d.basename AS dump_basename, d.parsed_at AS dump_parsed_at
    FROM jobs j
    JOIN dumps d ON d.id = j.dump_id
    WHERE NOT (j.dump_id = @exclude_dump AND j.job_id = @exclude_job)
    ORDER BY
      COALESCE(j.detail_fetched_at, j.tracked_at, d.parsed_at, d.dumped_at) ASC
  `
    )
    .all({ exclude_dump: excludeDumpId, exclude_job: excludeJobId });

  for (const row of rows) {
    const sameId = String(row.job_id) === jobId;
    const twinFp = jobFingerprint(row.title, row.company);
    const sameFp = Boolean(fp && twinFp && fp === twinFp);
    if (!sameId && !sameFp) continue;

    if (needDescription) {
      const desc = row.description;
      if (!(typeof desc === "string" && desc.trim().length > 0)) continue;
    }
    if (needDecision) {
      if (!row.decision) continue;
    }
    return row;
  }
  return null;
}

/** Copy description / apply_url / paths from twin onto target job. */
export function copyJobDetailFromTwin(db, dumpId, jobId, twinRow) {
  const stamp = nowIso();
  updateJobDetail(db, dumpId, jobId, {
    status: "ok",
    description: twinRow.description ?? null,
    error: null,
    htmlPath: twinRow.html_path ?? null,
    fetchedAt: twinRow.detail_fetched_at || stamp,
    title: twinRow.title ?? null,
    company: twinRow.company ?? null,
    applyUrl: twinRow.apply_url ?? null,
  });
  return {
    twinJobId: String(twinRow.job_id),
    twinDump: twinRow.dump_basename ?? null,
  };
}

/** Copy Stage 3 triage fields from twin onto target job. */
export function copyJobTriageFromTwin(db, dumpId, jobId, twinRow) {
  const marker = `duplicate_of:${twinRow.job_id}`;
  updateJobTriage(db, dumpId, jobId, {
    decision: twinRow.decision ?? null,
    fitScore: twinRow.fit_score ?? null,
    confidence: twinRow.confidence ?? null,
    qualify: parseJsonCol(twinRow.qualify_json),
    evaluation: parseJsonCol(twinRow.evaluation_json),
    materials: parseJsonCol(twinRow.materials_json),
    error: marker,
  });
  return {
    twinJobId: String(twinRow.job_id),
    twinDump: twinRow.dump_basename ?? null,
    decision: twinRow.decision ?? null,
  };
}

const TRACK_STATUSES = new Set(["todo", "applied", "waiting", "closed"]);
const APPLY_CHANNELS = new Set(["easy_apply", "external", "message"]);

/**
 * Update user application tracking for a job within a dump.
 * @returns {object|null} updated API job row
 */
export function updateJobTrack(db, dumpId, jobId, patch) {
  const row = db
    .prepare(`SELECT * FROM jobs WHERE dump_id = ? AND job_id = ?`)
    .get(dumpId, String(jobId));
  if (!row) return null;

  let trackStatus =
    patch.trackStatus !== undefined ? patch.trackStatus : row.track_status;
  if (trackStatus != null && trackStatus !== "" && !TRACK_STATUSES.has(trackStatus)) {
    throw Object.assign(new Error(`Invalid trackStatus: ${trackStatus}`), {
      status: 400,
    });
  }
  if (trackStatus === "") trackStatus = null;

  let applyChannel =
    patch.applyChannel !== undefined ? patch.applyChannel : row.apply_channel;
  if (
    applyChannel != null &&
    applyChannel !== "" &&
    !APPLY_CHANNELS.has(applyChannel)
  ) {
    throw Object.assign(new Error(`Invalid applyChannel: ${applyChannel}`), {
      status: 400,
    });
  }
  if (applyChannel === "") applyChannel = null;

  const trackNote =
    patch.trackNote !== undefined ? patch.trackNote : row.track_note;

  const stamp = nowIso();
  let appliedAt = row.applied_at;
  if (trackStatus === "applied" && row.track_status !== "applied") {
    appliedAt = stamp;
  }
  if (patch.appliedAt !== undefined) appliedAt = patch.appliedAt;

  let trackedAt = row.tracked_at || stamp;
  if (trackStatus && trackStatus !== row.track_status) {
    trackedAt = stamp;
  }

  db.prepare(`
    UPDATE jobs SET
      track_status = @track_status,
      apply_channel = @apply_channel,
      track_note = @track_note,
      tracked_at = @tracked_at,
      applied_at = @applied_at
    WHERE dump_id = @dump_id AND job_id = @job_id
  `).run({
    dump_id: dumpId,
    job_id: String(jobId),
    track_status: trackStatus,
    apply_channel: applyChannel,
    track_note: trackNote ?? null,
    tracked_at: trackedAt,
    applied_at: appliedAt,
  });

  const updated = db
    .prepare(`SELECT * FROM jobs WHERE dump_id = ? AND job_id = ?`)
    .get(dumpId, String(jobId));
  return jobRowToApi(updated);
}

export function listJobsForDump(db, dumpId) {
  return db
    .prepare(`SELECT * FROM jobs WHERE dump_id = ? ORDER BY job_id`)
    .all(dumpId);
}

export function listDumpsSummary(db) {
  return db
    .prepare(
      `
    SELECT
      d.*,
      (SELECT COUNT(*) FROM jobs j WHERE j.dump_id = d.id) AS job_count,
      (SELECT COUNT(*) FROM jobs j WHERE j.dump_id = d.id AND j.description IS NOT NULL AND length(j.description) > 0) AS details_ok
    FROM dumps d
    ORDER BY COALESCE(d.updated_at, d.parsed_at, d.dumped_at) DESC
  `
    )
    .all();
}

function parseJsonCol(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function jobRowToApi(row) {
  return {
    id: String(row.job_id),
    title: row.title,
    company: row.company,
    location: row.location,
    salary: row.salary,
    posted: row.posted,
    postedRaw: row.posted_raw,
    postedAt: row.posted_at,
    easyApply: Boolean(row.easy_apply),
    earlyApplicant: Boolean(row.early_applicant),
    verified: Boolean(row.verified),
    logoUrl: row.logo_url,
    url: row.url,
    description: row.description,
    detailStatus: row.detail_status,
    detailError: row.detail_error,
    htmlPath: row.html_path,
    hasDescription: Boolean(row.description && row.description.length >= 60),
    decision: row.decision,
    fitScore: row.fit_score,
    confidence: row.confidence,
    qualify: parseJsonCol(row.qualify_json),
    evaluation: parseJsonCol(row.evaluation_json),
    materials: parseJsonCol(row.materials_json),
    qualifyReasons: parseJsonCol(row.qualify_json)?.reasons ?? null,
    recommendation: parseJsonCol(row.evaluation_json)?.recommendation ?? null,
    stage3Error: row.stage3_error,
    trackStatus: row.track_status ?? null,
    applyChannel: row.apply_channel ?? null,
    trackNote: row.track_note ?? null,
    trackedAt: row.tracked_at ?? null,
    appliedAt: row.applied_at ?? null,
    source: row.source ?? "linkedin_job",
    applyUrl: row.apply_url ?? null,
  };
}

export function getDumpDetail(db, basename) {
  const dump = getDumpByBasename(db, basename);
  if (!dump) return null;
  const jobs = listJobsForDump(db, dump.id).map(jobRowToApi);
  return {
    basename: dump.basename,
    dumpedAt: dump.dumped_at,
    parsedAt: dump.parsed_at,
    source: dump.source_html,
    stage2FetchedAt: dump.fetched_at,
    stage3CreatedAt: dump.stage3_at,
    stage3Summary: {
      total: dump.summary_apply + dump.summary_maybe + dump.summary_skip,
      apply: dump.summary_apply,
      maybe: dump.summary_maybe,
      skip: dump.summary_skip,
    },
    profileVersion: dump.profile_version,
    model: dump.model,
    jobs,
    detailsOk: jobs.filter((j) => j.description).length,
    stage3Ok: jobs.filter(
      (j) => j.decision === "apply" || j.decision === "maybe"
    ).length,
  };
}

/** Jobs shaped for stage3 qualify/evaluate (merged card + description). */
export function loadMergedJobs(db, basename) {
  const dump = getDumpByBasename(db, basename);
  if (!dump) throw new Error(`Unknown dump basename: ${basename}`);
  const jobs = listJobsForDump(db, dump.id).map((row) => {
    const api = jobRowToApi(row);
    return {
      id: api.id,
      title: api.title,
      company: api.company,
      location: api.location,
      salary: api.salary,
      posted: api.posted,
      postedAt: api.postedAt,
      easyApply: api.easyApply,
      earlyApplicant: api.earlyApplicant,
      verified: api.verified,
      logoUrl: api.logoUrl,
      url: api.url,
      description: api.description,
      detailStatus: api.detailStatus || "missing_stage2",
      detailError: api.detailError,
      htmlPath: api.htmlPath,
      hasDescription: api.hasDescription,
    };
  });
  return { dump, jobs };
}

export function refreshDumpSummaries(db, dumpId) {
  const counts = db
    .prepare(
      `
    SELECT
      SUM(CASE WHEN decision = 'apply' THEN 1 ELSE 0 END) AS apply,
      SUM(CASE WHEN decision = 'maybe' THEN 1 ELSE 0 END) AS maybe,
      SUM(CASE WHEN decision = 'skip' THEN 1 ELSE 0 END) AS skip
    FROM jobs WHERE dump_id = ?
  `
    )
    .get(dumpId);
  db.prepare(
    `
    UPDATE dumps SET
      summary_apply = @apply,
      summary_maybe = @maybe,
      summary_skip = @skip,
      updated_at = @updated_at
    WHERE id = @id
  `
  ).run({
    id: dumpId,
    apply: counts.apply || 0,
    maybe: counts.maybe || 0,
    skip: counts.skip || 0,
    updated_at: nowIso(),
  });
}

/** One-time helper: seed new empty DB file from legacy by copying then migrating. */
export function ensureAppDb() {
  const path = defaultDbPath();
  if (!existsSync(path) && existsSync(legacyCachePath())) {
    mkdirSync(dirname(path), { recursive: true });
    try {
      copyFileSync(legacyCachePath(), path);
    } catch {
      // fall through to fresh open
    }
  }
  return openDb(path);
}

export default openDb;
