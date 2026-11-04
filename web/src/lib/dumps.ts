import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { dataPaths } from "./paths";
import type { DumpDetail, DumpSummary, HtmlDump, JobRow } from "./types";

function stageNameFor(stage1Name: string) {
  return stage1Name;
}

export function safeJsonName(name: string): string | null {
  const base = basename(name);
  if (base !== name || !base.endsWith(".json") || base.includes("..")) {
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

export function listDumps(): DumpSummary[] {
  const { stage1, stage2, stage3 } = dataPaths();
  if (!existsSync(stage1)) return [];

  return readdirSync(stage1)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const full = join(stage1, name);
      const st = statSync(full);
      let jobCount: number | null = null;
      let dumpedAt: string | null = null;
      let source: string | null = null;
      let detailsOk = 0;
      let stage3Apply = 0;
      let stage3Maybe = 0;
      let stage3Skip = 0;

      try {
        const raw = JSON.parse(readFileSync(full, "utf8"));
        if (Array.isArray(raw)) {
          jobCount = raw.length;
        } else if (raw && typeof raw === "object") {
          jobCount = Array.isArray(raw.jobs) ? raw.jobs.length : null;
          dumpedAt = raw.dumpedAt ?? null;
          source = raw.source ?? null;
        }

        const s2Path = join(stage2, stageNameFor(name));
        if (existsSync(s2Path)) {
          const s2 = JSON.parse(readFileSync(s2Path, "utf8"));
          detailsOk = Array.isArray(s2.jobs)
            ? s2.jobs.filter(
                (j: { status?: string; description?: string }) =>
                  j.status === "ok" && j.description
              ).length
            : 0;
        }

        const s3Path = join(stage3, stageNameFor(name));
        if (existsSync(s3Path)) {
          const s3 = JSON.parse(readFileSync(s3Path, "utf8"));
          for (const j of s3.jobs || []) {
            if (j.decision === "apply") stage3Apply += 1;
            else if (j.decision === "maybe") stage3Maybe += 1;
            else if (j.decision === "skip") stage3Skip += 1;
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
        stage3Skip,
      };
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
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

export function mergeDump(stage1Name: string): DumpDetail {
  const { stage1, stage2, stage3 } = dataPaths();
  const s1Path = join(stage1, stage1Name);
  const raw = JSON.parse(readFileSync(s1Path, "utf8"));

  const base: DumpDetail = Array.isArray(raw)
    ? {
        dumpedAt: null,
        parsedAt: null,
        source: stage1Name,
        jobs: raw as JobRow[],
        detailsOk: 0,
        stage3Ok: 0,
      }
    : {
        dumpedAt: raw.dumpedAt ?? null,
        parsedAt: raw.parsedAt ?? null,
        source: raw.source ?? stage1Name,
        jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
        detailsOk: 0,
        stage3Ok: 0,
      };

  const byId = new Map<string, Record<string, unknown>>();
  const s2Path = join(stage2, stageNameFor(stage1Name));
  if (existsSync(s2Path)) {
    try {
      const s2 = JSON.parse(readFileSync(s2Path, "utf8"));
      for (const j of s2.jobs || []) {
        if (j?.id) byId.set(String(j.id), j);
      }
      base.stage2FetchedAt = s2.fetchedAt ?? null;
    } catch {
      // ignore
    }
  }

  const s3ById = new Map<string, Record<string, unknown>>();
  const s3Path = join(stage3, stageNameFor(stage1Name));
  if (existsSync(s3Path)) {
    try {
      const s3 = JSON.parse(readFileSync(s3Path, "utf8"));
      base.stage3CreatedAt = s3.createdAt ?? null;
      base.stage3Summary = s3.summary ?? null;
      for (const j of s3.jobs || []) {
        if (j?.id) s3ById.set(String(j.id), j);
      }
    } catch {
      // ignore
    }
  }

  base.jobs = base.jobs.map((j) => {
    const d = byId.get(String(j.id));
    const s3 = s3ById.get(String(j.id)) as
      | {
          decision?: JobRow["decision"];
          fitScore?: number | null;
          confidence?: number | null;
          evaluation?: JobRow["evaluation"];
          materials?: JobRow["materials"];
          qualify?: JobRow["qualify"];
          error?: string;
        }
      | undefined;

    return {
      ...j,
      description: (d?.description as string | null | undefined) ?? null,
      detailStatus: (d?.status as string | null | undefined) ?? null,
      detailError: (d?.error as string | null | undefined) ?? null,
      decision: s3?.decision ?? null,
      fitScore: s3?.fitScore ?? null,
      confidence: s3?.confidence ?? null,
      recommendation: s3?.evaluation?.recommendation ?? null,
      evaluation: s3?.evaluation ?? null,
      materials: s3?.materials ?? null,
      qualify: s3?.qualify ?? null,
      qualifyReasons: s3?.qualify?.reasons ?? null,
      stage3Error: s3?.error ?? null,
    };
  });

  base.detailsOk = base.jobs.filter((j) => j.description).length;
  base.stage3Ok = base.jobs.filter(
    (j) => j.decision === "apply" || j.decision === "maybe"
  ).length;

  return base;
}
