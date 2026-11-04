#!/usr/bin/env node
/**
 * One-shot: import data/stage{1,2,3}/*.json into data/job-triage.sqlite
 * then delete those JSON files (HTML dumps are kept).
 */

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDb,
  defaultDbPath,
  upsertDump,
  upsertJobCard,
  updateJobDetail,
  updateJobTriage,
  refreshDumpSummaries,
  relativeDetailPath,
  nowIso,
} from "../src/db.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stage1Dir = join(root, "data", "stage1");
const stage2Dir = join(root, "data", "stage2");
const stage3Dir = join(root, "data", "stage3");

const BASENAMES = [
  "linkedin-jobs-2026-11-03T00-01-37-705Z",
  "linkedin-jobs-2026-11-03T19-25-53-129Z",
];

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeHtmlPath(jobId, htmlPath) {
  if (!htmlPath && !jobId) return null;
  const expected = join(root, "data", "dumps", "details", `${jobId}.html`);
  if (existsSync(expected)) return relativeDetailPath(jobId);
  if (htmlPath && existsSync(htmlPath)) return relativeDetailPath(jobId);
  return relativeDetailPath(jobId);
}

const db = openDb(defaultDbPath());
const deleteAfter = !process.argv.includes("--keep-json");

console.log(`DB: ${defaultDbPath()}`);

for (const stem of BASENAMES) {
  const s1Path = join(stage1Dir, `${stem}.json`);
  if (!existsSync(s1Path)) {
    console.warn(`Skip ${stem}: missing stage1`);
    continue;
  }
  const s1 = loadJson(s1Path);
  const s1Jobs = Array.isArray(s1) ? s1 : s1.jobs || [];
  const dumpId = upsertDump(db, {
    basename: stem,
    source_html: s1.source || `${stem}.html`,
    dumped_at: s1.dumpedAt || null,
    parsed_at: s1.parsedAt || null,
    updated_at: nowIso(),
  });

  for (const j of s1Jobs) {
    upsertJobCard(db, dumpId, j);
  }
  console.log(`  ${stem}: ${s1Jobs.length} cards`);

  const s2Path = join(stage2Dir, `${stem}.json`);
  if (existsSync(s2Path)) {
    const s2 = loadJson(s2Path);
    upsertDump(db, {
      basename: stem,
      fetched_at: s2.fetchedAt || null,
    });
    for (const j of s2.jobs || []) {
      updateJobDetail(db, dumpId, j.id, {
        status: j.status || null,
        description: j.description || null,
        error: j.error || null,
        htmlPath: normalizeHtmlPath(j.id, j.htmlPath),
        fetchedAt: j.fetchedAt || s2.fetchedAt || null,
        title: j.title || null,
        company: j.company || null,
      });
    }
    console.log(`  ${stem}: stage2 overlay ${s2.jobs?.length || 0}`);
  }

  const s3Path = join(stage3Dir, `${stem}.json`);
  if (existsSync(s3Path)) {
    const s3 = loadJson(s3Path);
    upsertDump(db, {
      basename: stem,
      stage3_at: s3.createdAt || null,
      profile_version: s3.profileVersion || null,
      model: s3.model || null,
      summary_apply: s3.summary?.apply ?? 0,
      summary_maybe: s3.summary?.maybe ?? 0,
      summary_skip: s3.summary?.skip ?? 0,
    });
    for (const j of s3.jobs || []) {
      updateJobTriage(db, dumpId, j.id, {
        decision: j.decision ?? null,
        fitScore: j.fitScore ?? null,
        confidence: j.confidence ?? null,
        qualify: j.qualify ?? null,
        evaluation: j.evaluation ?? null,
        materials: j.materials ?? null,
        error: j.error ?? null,
      });
    }
    console.log(`  ${stem}: stage3 overlay ${s3.jobs?.length || 0}`);
  }

  refreshDumpSummaries(db, dumpId);
}

// Verify
for (const stem of BASENAMES) {
  const dump = db.prepare(`SELECT * FROM dumps WHERE basename = ?`).get(stem);
  if (!dump) continue;
  const n = db
    .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE dump_id = ?`)
    .get(dump.id).n;
  const withDesc = db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs WHERE dump_id = ? AND description IS NOT NULL`
    )
    .get(dump.id).n;
  const withDec = db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs WHERE dump_id = ? AND decision IS NOT NULL`
    )
    .get(dump.id).n;
  console.log(
    `Verify ${stem}: jobs=${n} desc=${withDesc} decisions=${withDec} A/M/S=${dump.summary_apply}/${dump.summary_maybe}/${dump.summary_skip}`
  );
}

if (deleteAfter) {
  const toDelete = [];
  for (const stem of BASENAMES) {
    for (const dir of [stage1Dir, stage2Dir, stage3Dir]) {
      const p = join(dir, `${stem}.json`);
      if (existsSync(p)) toDelete.push(p);
    }
  }
  for (const p of toDelete) {
    unlinkSync(p);
    console.log(`Deleted ${basename(p)} (${p.includes("stage3") ? "stage3" : p.includes("stage2") ? "stage2" : "stage1"})`);
  }
} else {
  console.log("Kept JSON (--keep-json)");
}

db.close();
console.log("Migration done.");
