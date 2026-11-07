import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { jobFingerprint } from "@/lib/job-fingerprint";
import Database from "better-sqlite3";
import { dataPaths } from "./paths";
import type { DumpDetail, DumpSummary, HtmlDump, JobRow } from "./types";

function ensureJobsTrackColumns(db: Database.Database) {
  const cols = new Set(
    (
      db.prepare(`PRAGMA table_info(jobs)`).all() as Array<{ name: string }>
    ).map((r) => r.name)
  );
  const add = (name: string, ddl: string) => {
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
  db.exec(`
    UPDATE jobs SET source = 'linkedin_job' WHERE source IS NULL OR source = '';
    UPDATE jobs
    SET track_status = 'todo',
        tracked_at = COALESCE(tracked_at, datetime('now'))
    WHERE decision IN ('apply', 'maybe')
      AND (track_status IS NULL OR track_status = '');
  `);
}

export function openAppDb() {
  const path = dataPaths().db;
  const db = new Database(path, { readonly: false, fileMustExist: false });
  try {
    ensureJobsTrackColumns(db);
  } catch {
    // table may not exist yet
  }
  return db;
}

export function safeBasename(name: string): string | null {
  const base = basename(name)
    .replace(/\.json$/i, "")
    .replace(/\.html?$/i, "");
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) {
    return null;
  }
  return base;
}

export function safeHtmlName(name: string): string | null {
  const base = basename(name);
  if (base !== name || !base.endsWith(".html") || base.includes("..")) {
    return null;
  }
  return base;
}

function formatDumpLabel(d: {
  basename: string;
  dumped_at: string | null;
  parsed_at: string | null;
  job_count: number;
  summary_apply: number;
  summary_maybe: number;
  summary_skip: number;
  details_ok: number;
}): string {
  const when = d.parsed_at || d.dumped_at;
  const dateBit = when
    ? new Date(when).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : d.basename;
  const triage =
    d.summary_apply || d.summary_maybe || d.summary_skip
      ? ` · A${d.summary_apply}/M${d.summary_maybe}/S${d.summary_skip}`
      : "";
  return `${dateBit} · ${d.job_count} jobs · ${d.details_ok} desc${triage}`;
}

export function listDumps(): DumpSummary[] {
  const { db: dbPath } = dataPaths();
  if (!existsSync(dbPath)) return [];
  const db = openAppDb();
  try {
    const rows = db
      .prepare(
        `
      SELECT
        d.*,
        (SELECT COUNT(*) FROM jobs j WHERE j.dump_id = d.id) AS job_count,
        (SELECT COUNT(*) FROM jobs j WHERE j.dump_id = d.id AND j.description IS NOT NULL AND length(j.description) > 0) AS details_ok,
        (SELECT COUNT(*) FROM jobs j WHERE j.dump_id = d.id AND j.detail_status IN ('error', 'missing_description')) AS details_failed
      FROM dumps d
      ORDER BY COALESCE(d.updated_at, d.parsed_at, d.dumped_at) DESC
    `
      )
      .all() as Array<{
      basename: string;
      dumped_at: string | null;
      parsed_at: string | null;
      source_html: string | null;
      updated_at: string;
      summary_apply: number;
      summary_maybe: number;
      summary_skip: number;
      job_count: number;
      details_ok: number;
      details_failed: number;
    }>;

    return rows.map((d) => ({
      name: d.basename,
      label: formatDumpLabel(d),
      mtime: d.updated_at || d.parsed_at || d.dumped_at || new Date(0).toISOString(),
      jobCount: d.job_count ?? null,
      dumpedAt: d.dumped_at,
      source: d.source_html,
      detailsOk: d.details_ok ?? 0,
      detailsFailed: d.details_failed ?? 0,
      stage3Apply: d.summary_apply ?? 0,
      stage3Maybe: d.summary_maybe ?? 0,
      stage3Skip: d.summary_skip ?? 0,
    }));
  } finally {
    db.close();
  }
}

export function listHtmlDumps(): HtmlDump[] {
  const { dumps } = dataPaths();
  if (!existsSync(dumps)) return [];

  return readdirSync(dumps)
    .filter((name) => name.endsWith(".html"))
    .map((name) => {
      const full = join(dumps, name);
      const st = statSync(full);
      return {
        name,
        mtime: st.mtime.toISOString(),
        size: st.size,
      };
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

function parseJsonCol(s: string | null) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function rowToJob(row: Record<string, unknown>): JobRow {
  const evaluation = parseJsonCol(row.evaluation_json as string | null) as
    | JobRow["evaluation"]
    | null;
  const qualify = parseJsonCol(row.qualify_json as string | null) as
    | JobRow["qualify"]
    | null;
  return {
    id: String(row.job_id),
    title: (row.title as string) ?? null,
    company: (row.company as string) ?? null,
    location: (row.location as string) ?? null,
    salary: (row.salary as string) ?? null,
    posted: (row.posted as string) ?? null,
    postedAt: (row.posted_at as string) ?? null,
    easyApply: Boolean(row.easy_apply),
    logoUrl: (row.logo_url as string) ?? null,
    url: (row.url as string) ?? null,
    description: (row.description as string) ?? null,
    detailStatus: (row.detail_status as string) ?? null,
    detailError: (row.detail_error as string) ?? null,
    decision: (row.decision as JobRow["decision"]) ?? null,
    fitScore: (row.fit_score as number) ?? null,
    confidence: (row.confidence as number) ?? null,
    evaluation,
    materials: parseJsonCol(row.materials_json as string | null) as JobRow["materials"],
    qualify,
    qualifyReasons: qualify?.reasons ?? null,
    recommendation: evaluation?.recommendation ?? null,
    stage3Error: (row.stage3_error as string) ?? null,
    trackStatus: (row.track_status as JobRow["trackStatus"]) ?? null,
    applyChannel: (row.apply_channel as JobRow["applyChannel"]) ?? null,
    trackNote: (row.track_note as string) ?? null,
    trackedAt: (row.tracked_at as string) ?? null,
    appliedAt: (row.applied_at as string) ?? null,
    source: (row.source as string) ?? "linkedin_job",
    posterType: (row.poster_type as "agency" | "direct" | null) ?? null,
    applyUrl: (row.apply_url as string) ?? null,
  };
}

/** Delete a single job from a named dump. Returns true if a row was deleted. */
export function deleteJob(dumpName: string, jobId: string): boolean {
  const stem = safeBasename(dumpName);
  if (!stem) throw Object.assign(new Error("Invalid dump name"), { status: 400 });
  const db = openAppDb();
  try {
    const dump = db
      .prepare("SELECT id FROM dumps WHERE basename = ?")
      .get(stem) as { id: number } | undefined;
    if (!dump) throw Object.assign(new Error("Dump not found"), { status: 404 });
    const result = db
      .prepare("DELETE FROM jobs WHERE dump_id = ? AND job_id = ?")
      .run(dump.id, jobId);
    return result.changes > 0;
  } finally {
    db.close();
  }
}

const TRACK_STATUSES = new Set(["todo", "applied", "waiting", "closed"]);
const APPLY_CHANNELS = new Set(["easy_apply", "external", "message"]);

export function updateJobTrackFields(
  dumpName: string,
  jobId: string,
  patch: {
    trackStatus?: JobRow["trackStatus"] | null;
    applyChannel?: JobRow["applyChannel"] | null;
    trackNote?: string | null;
  }
): JobRow {
  const stem = safeBasename(dumpName);
  if (!stem) throw Object.assign(new Error("Invalid dump name"), { status: 400 });
  const db = openAppDb();
  try {
    const dump = db
      .prepare(`SELECT id FROM dumps WHERE basename = ?`)
      .get(stem) as { id: number } | undefined;
    if (!dump) throw Object.assign(new Error("Dump not found"), { status: 404 });

    const row = db
      .prepare(`SELECT * FROM jobs WHERE dump_id = ? AND job_id = ?`)
      .get(dump.id, String(jobId)) as Record<string, unknown> | undefined;
    if (!row) throw Object.assign(new Error("Job not found"), { status: 404 });

    let trackStatus =
      patch.trackStatus !== undefined
        ? patch.trackStatus
        : (row.track_status as string | null);
    if (
      trackStatus != null &&
      trackStatus !== "" &&
      !TRACK_STATUSES.has(trackStatus)
    ) {
      throw Object.assign(new Error(`Invalid trackStatus`), { status: 400 });
    }

    let applyChannel =
      patch.applyChannel !== undefined
        ? patch.applyChannel
        : (row.apply_channel as string | null);
    if (
      applyChannel != null &&
      applyChannel !== "" &&
      !APPLY_CHANNELS.has(applyChannel)
    ) {
      throw Object.assign(new Error(`Invalid applyChannel`), { status: 400 });
    }

    const trackNote =
      patch.trackNote !== undefined ? patch.trackNote : (row.track_note as string | null);

    const stamp = new Date().toISOString();
    let appliedAt = (row.applied_at as string | null) ?? null;
    if (trackStatus === "applied" && row.track_status !== "applied") {
      appliedAt = stamp;
    }
    let trackedAt = (row.tracked_at as string | null) || stamp;
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
      dump_id: dump.id,
      job_id: String(jobId),
      track_status: trackStatus ?? null,
      apply_channel: applyChannel ?? null,
      track_note: trackNote ?? null,
      tracked_at: trackedAt,
      applied_at: appliedAt,
    });

    const updated = db
      .prepare(`SELECT * FROM jobs WHERE dump_id = ? AND job_id = ?`)
      .get(dump.id, String(jobId)) as Record<string, unknown>;
    return rowToJob(updated);
  } finally {
    db.close();
  }
}

function trackProgress(status: JobRow["trackStatus"]): number {
  if (status === "closed") return 4;
  if (status === "waiting") return 3;
  if (status === "applied") return 2;
  if (status === "todo") return 1;
  return 0;
}

function preferInboxJob(a: JobRow, b: JobRow): JobRow {
  const tp = trackProgress(a.trackStatus) - trackProgress(b.trackStatus);
  if (tp !== 0) return tp > 0 ? a : b;
  const fs = (a.fitScore ?? 0) - (b.fitScore ?? 0);
  if (fs !== 0) return fs > 0 ? a : b;
  const ta = a.trackedAt || a.appliedAt || "";
  const tb = b.trackedAt || b.appliedAt || "";
  if (ta !== tb) return ta > tb ? a : b;
  return a;
}

/** Apply/maybe jobs across all dumps, deduped by job_id then title+company. */
export function loadInboxJobs(): {
  jobs: JobRow[];
  totalRaw: number;
  dumpsTouched: number;
} {
  const { db: dbPath } = dataPaths();
  if (!existsSync(dbPath)) return { jobs: [], totalRaw: 0, dumpsTouched: 0 };
  const db = openAppDb();
  try {
    const rows = db
      .prepare(
        `
      SELECT j.*, d.basename AS dump_basename
      FROM jobs j
      JOIN dumps d ON d.id = j.dump_id
      WHERE j.decision IN ('apply', 'maybe')
      ORDER BY COALESCE(d.updated_at, d.parsed_at, d.dumped_at) DESC
    `
      )
      .all() as Array<Record<string, unknown>>;

    const mapped: JobRow[] = rows.map((row) => ({
      ...rowToJob(row),
      dumpName: (row.dump_basename as string) || null,
    }));

    const byId = new Map<string, JobRow>();
    for (const job of mapped) {
      const id = String(job.id);
      const prev = byId.get(id);
      byId.set(id, prev ? preferInboxJob(prev, job) : job);
    }

    const byFp = new Map<string, JobRow>();
    const noFp: JobRow[] = [];
    for (const job of byId.values()) {
      const fp = jobFingerprint(job.title, job.company);
      if (!fp) {
        noFp.push(job);
        continue;
      }
      const prev = byFp.get(fp);
      byFp.set(fp, prev ? preferInboxJob(prev, job) : job);
    }

    const jobs = [...byFp.values(), ...noFp].sort(
      (a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0)
    );
    const dumpsTouched = new Set(
      mapped.map((j) => j.dumpName).filter(Boolean)
    ).size;
    return { jobs, totalRaw: mapped.length, dumpsTouched };
  } finally {
    db.close();
  }
}

/** All jobs across all dumps, deduped — no decision filter (includes unevaluated). */
export function loadAllJobs(): {
  jobs: JobRow[];
  totalRaw: number;
  dumpsTouched: number;
} {
  const { db: dbPath } = dataPaths();
  if (!existsSync(dbPath)) return { jobs: [], totalRaw: 0, dumpsTouched: 0 };
  const db = openAppDb();
  try {
    const rows = db
      .prepare(
        `
      SELECT j.*, d.basename AS dump_basename
      FROM jobs j
      JOIN dumps d ON d.id = j.dump_id
      ORDER BY COALESCE(d.updated_at, d.parsed_at, d.dumped_at) DESC
    `
      )
      .all() as Array<Record<string, unknown>>;

    const mapped: JobRow[] = rows.map((row) => ({
      ...rowToJob(row),
      dumpName: (row.dump_basename as string) || null,
    }));

    const byId = new Map<string, JobRow>();
    for (const job of mapped) {
      const id = String(job.id);
      const prev = byId.get(id);
      byId.set(id, prev ? preferInboxJob(prev, job) : job);
    }

    const byFp = new Map<string, JobRow>();
    const noFp: JobRow[] = [];
    for (const job of byId.values()) {
      const fp = jobFingerprint(job.title, job.company);
      if (!fp) {
        noFp.push(job);
        continue;
      }
      const prev = byFp.get(fp);
      byFp.set(fp, prev ? preferInboxJob(prev, job) : job);
    }

    const jobs = [...byFp.values(), ...noFp].sort(
      (a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0)
    );
    const dumpsTouched = new Set(
      mapped.map((j) => j.dumpName).filter(Boolean)
    ).size;
    return { jobs, totalRaw: mapped.length, dumpsTouched };
  } finally {
    db.close();
  }
}

export function mergeDump(stage1Name: string): DumpDetail {
  const stem = safeBasename(stage1Name);
  if (!stem) throw new Error("Invalid dump name");
  const { db: dbPath } = dataPaths();
  if (!existsSync(dbPath)) throw new Error("Database not found");
  const db = openAppDb();
  try {
    const dump = db
      .prepare(`SELECT * FROM dumps WHERE basename = ?`)
      .get(stem) as Record<string, unknown> | undefined;
    if (!dump) throw new Error("Dump not found");
    const jobRows = db
      .prepare(`SELECT * FROM jobs WHERE dump_id = ? ORDER BY job_id`)
      .all(dump.id) as Array<Record<string, unknown>>;
    const jobs = jobRows.map(rowToJob);
    const apply = Number(dump.summary_apply) || 0;
    const maybe = Number(dump.summary_maybe) || 0;
    const skip = Number(dump.summary_skip) || 0;
    return {
      dumpedAt: (dump.dumped_at as string) ?? null,
      parsedAt: (dump.parsed_at as string) ?? null,
      source: (dump.source_html as string) || stem,
      jobs,
      stage2FetchedAt: (dump.fetched_at as string) ?? null,
      stage3CreatedAt: (dump.stage3_at as string) ?? null,
      stage3Summary: { total: apply + maybe + skip, apply, maybe, skip },
      detailsOk: jobs.filter((j) => j.description).length,
      stage3Ok: jobs.filter(
        (j) => j.decision === "apply" || j.decision === "maybe"
      ).length,
    };
  } finally {
    db.close();
  }
}
