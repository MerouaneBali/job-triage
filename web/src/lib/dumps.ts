import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import { dataPaths } from "./paths";
import type { DumpDetail, DumpSummary, HtmlDump, JobRow } from "./types";

function openAppDb() {
  const path = dataPaths().db;
  return new Database(path, { readonly: false, fileMustExist: false });
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
        (SELECT COUNT(*) FROM jobs j WHERE j.dump_id = d.id AND j.description IS NOT NULL AND length(j.description) > 0) AS details_ok
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
    }>;

    return rows.map((d) => ({
      name: d.basename,
      label: formatDumpLabel(d),
      mtime: d.updated_at || d.parsed_at || d.dumped_at || new Date(0).toISOString(),
      jobCount: d.job_count ?? null,
      dumpedAt: d.dumped_at,
      source: d.source_html,
      detailsOk: d.details_ok ?? 0,
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
  };
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
