#!/usr/bin/env node
/**
 * Stage 3 CLI: load dump from SQLite → qualify → evaluate (Claude) → generate.
 *
 *   npm run stage3 -- <basename>
 *   npm run stage3 -- <basename> --limit 3 --skip-generate
 *   npm run stage3 -- <basename> --qualify-only
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { mergeFromDb } from "./merge.mjs";
import { qualifyAll } from "./qualify.mjs";
import { openCache } from "./cache.mjs";
import { createClaudeClient } from "./claude.mjs";
import { evaluateJob } from "./evaluate.mjs";
import { generateForJob } from "./generate.mjs";
import {
  basenameFromArg,
  openDb,
  defaultDbPath,
  updateJobTriage,
  upsertDump,
  refreshDumpSummaries,
  nowIso,
  findJobTwin,
  copyJobTriageFromTwin,
} from "../db.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
loadEnv({ path: join(root, ".env") });

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  console.log(`Usage: node src/stage3/run.mjs <basename> [options]

  basename   Dump stem in SQLite (e.g. linkedin-jobs-2026-11-03T00-01-37-705Z)

Options:
  --limit N          Evaluate at most N jobs that pass qualify
  --skip-generate    Do not call Claude for cover letters / outreach
  --qualify-only     Qualify only (no API); writes skip/pending into DB
  --force            Ignore SQLite Claude cache
`);
  process.exit(args.includes("--help") ? 0 : 1);
}

const basename = basenameFromArg(args.find((a) => !a.startsWith("--")));
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const skipGenerate = args.includes("--skip-generate");
const qualifyOnly = args.includes("--qualify-only");
const force = args.includes("--force");

const profileDir = join(root, "data", "profile");
const canonicalPath = join(profileDir, "canonical.json");
const prefsPath = join(profileDir, "preferences.md");

if (!existsSync(canonicalPath)) {
  console.error(`Missing ${canonicalPath}`);
  process.exit(1);
}

const canonical = JSON.parse(readFileSync(canonicalPath, "utf8"));
const preferencesMd = existsSync(prefsPath)
  ? readFileSync(prefsPath, "utf8")
  : "";

const prefs = {
  blockClearance: true,
  blockAgencies: false,
};

const db = openDb(defaultDbPath());

console.log(`Load dump ${basename} …`);
let merged;
try {
  merged = mergeFromDb(basename, db);
} catch (e) {
  console.error(e.message || e);
  db.close();
  process.exit(1);
}

const dumpId = merged.dump.id;
const qualified = qualifyAll(merged.jobs, prefs);

const failCount = qualified.filter((j) => j.qualify.eligibility === "fail")
  .length;
const passCount = qualified.length - failCount;
console.log(
  `Loaded ${qualified.length} jobs · qualify pass ${passCount} · fail ${failCount}`
);

/** @type {object[]} */
const results = [];

function persistResult(row) {
  updateJobTriage(db, dumpId, row.id, row);
  results.push(row);
}

for (const job of qualified) {
  if (job.qualify.eligibility === "fail") {
    persistResult({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      decision: "skip",
      fitScore: 0,
      confidence: 1,
      qualify: job.qualify,
      evaluation: null,
      materials: null,
      error: null,
      skipReason: "qualify_fail",
    });
  }
}

if (qualifyOnly) {
  // Failures already persisted as skip above. For pass jobs, only refresh qualify_json
  // without wiping existing evaluations / materials.
  const updQualify = db.prepare(`
    UPDATE jobs SET qualify_json = @qualify_json
    WHERE dump_id = @dump_id AND job_id = @job_id
  `);
  for (const j of qualified.filter((x) => x.qualify.eligibility === "pass")) {
    updQualify.run({
      dump_id: dumpId,
      job_id: String(j.id),
      qualify_json: JSON.stringify(j.qualify),
    });
  }
  upsertDump(db, {
    basename,
    stage3_at: nowIso(),
    profile_version: canonical.profileVersion,
  });
  refreshDumpSummaries(db, dumpId);
  db.close();
  console.log(`Wrote qualify-only results to SQLite dump ${basename}`);
  process.exit(0);
}

let toEval = qualified.filter((j) => j.qualify.eligibility === "pass");
if (Number.isFinite(limit)) toEval = toEval.slice(0, limit);

const cache = openCache(defaultDbPath());
let claude;
try {
  claude = createClaudeClient(process.env);
} catch (e) {
  cache.close();
  db.close();
  console.error(e.message);
  process.exit(1);
}

console.log(`Evaluating ${toEval.length} jobs with ${claude.model} …`);

try {
  for (let i = 0; i < toEval.length; i++) {
    const job = toEval[i];
    console.log(
      `\n[${i + 1}/${toEval.length}] ${job.id} — ${job.title} @ ${job.company}`
    );
    try {
      if (!force) {
        const twin = findJobTwin(db, {
          title: job.title,
          company: job.company,
          jobId: job.id,
          excludeDumpId: dumpId,
          excludeJobId: job.id,
          needDecision: true,
        });
        if (twin) {
          const info = copyJobTriageFromTwin(db, dumpId, job.id, twin);
          console.log(
            `→ duplicate (reused eval from ${info.twinJobId}${
              info.twinDump ? ` @ ${info.twinDump}` : ""
            } · ${info.decision})`
          );
          results.push({
            id: job.id,
            title: job.title,
            company: job.company,
            decision: twin.decision,
            fitScore: twin.fit_score,
            confidence: twin.confidence,
            qualify: job.qualify,
            evaluation: null,
            materials: null,
            error: `duplicate_of:${twin.job_id}`,
            skipReason: "duplicate",
          });
          continue;
        }
      }

      const evaluation = await evaluateJob({
        claude,
        cache,
        canonical,
        preferencesMd,
        job,
        force,
      });

      let materials = null;
      const decision = evaluation.decision;
      if (
        !skipGenerate &&
        (decision === "apply" || decision === "maybe")
      ) {
        console.log(`  generating materials (${decision})…`);
        materials = await generateForJob({
          claude,
          cache,
          canonical,
          preferencesMd,
          job,
          evaluation,
          force,
        });
      }

      persistResult({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        url: job.url,
        easyApply: job.easyApply,
        decision,
        fitScore: evaluation.fitScore,
        confidence: evaluation.confidence,
        qualify: job.qualify,
        evaluation,
        materials,
        error: null,
      });
    } catch (e) {
      console.error(`  ERROR ${job.id}:`, e.message || e);
      persistResult({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        decision: "skip",
        fitScore: null,
        confidence: null,
        qualify: job.qualify,
        evaluation: null,
        materials: null,
        error: String(e.message || e),
      });
    }
  }
} finally {
  cache.close();
}

upsertDump(db, {
  basename,
  stage3_at: nowIso(),
  profile_version: canonical.profileVersion,
  model: claude.model,
});
refreshDumpSummaries(db, dumpId);

const summary = {
  total: results.length,
  apply: results.filter((j) => j.decision === "apply").length,
  maybe: results.filter((j) => j.decision === "maybe").length,
  skip: results.filter((j) => j.decision === "skip").length,
};

db.close();
console.log(`\nWrote Stage 3 results to SQLite dump ${basename}`);
console.log(
  `Summary: apply ${summary.apply} · maybe ${summary.maybe} · skip ${summary.skip}`
);
console.log(`Preview: npm run preview → http://127.0.0.1:4173`);
