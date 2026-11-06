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
  --limit N             Evaluate at most N jobs that pass qualify
  --skip-generate       Do not call Claude for cover letters / outreach at all
  --generate-maybe      Also generate materials for 'maybe' decisions (default: apply only)
  --no-cover-letter     Skip cover letter generation (saves tokens)
  --no-outreach         Skip outreach message generation (saves tokens; default for maybe)
  --qualify-only        Qualify only (no API); writes skip/pending into DB
  --force               Ignore SQLite Claude cache
  --max-errors N        Abort batch after N consecutive Claude API errors (default 3)
  --max-desc-chars N    Truncate descriptions at N chars (default 8000, 0 = no cap)
`);
  process.exit(args.includes("--help") ? 0 : 1);
}

const basename = basenameFromArg(args.find((a) => !a.startsWith("--")));
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const skipGenerate = args.includes("--skip-generate");
const generateMaybe = args.includes("--generate-maybe");
const noCoverLetter = args.includes("--no-cover-letter");
const noOutreach = args.includes("--no-outreach");
const generateStrategy = args.includes("--generate-strategy");
const qualifyOnly = args.includes("--qualify-only");
const force = args.includes("--force");
const maxErrorsIdx = args.indexOf("--max-errors");
const maxConsecutiveErrors = maxErrorsIdx >= 0 ? Number(args[maxErrorsIdx + 1]) : 3;
const maxDescIdx = args.indexOf("--max-desc-chars");
const MAX_DESC_CHARS = maxDescIdx >= 0 ? Number(args[maxDescIdx + 1]) : 8_000;

/** Which items to generate (applies when skipGenerate is false). */
function buildWhat(decision) {
  const what = ["questions", "cv"];
  if (!noCoverLetter) what.push("coverLetter");
  if (generateStrategy) what.push("strategy");
  // For maybe: skip outreach by default; for apply: include unless noOutreach
  if (!noOutreach && (decision === "apply" || generateMaybe)) what.push("outreach");
  return what;
}

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

console.log(
  `Evaluating ${toEval.length} jobs with ${claude.model} …` +
  (generateMaybe ? " (materials for apply+maybe)" : " (materials for apply only)")
);
if (MAX_DESC_CHARS < Infinity)
  console.log(`Description cap: ${MAX_DESC_CHARS} chars to save tokens.`);

let consecutiveApiErrors = 0;

try {
  for (let i = 0; i < toEval.length; i++) {
    const job = toEval[i];
    // Truncate very long descriptions to cap token usage
    const truncatedJob =
      job.description && job.description.length > MAX_DESC_CHARS
        ? {
            ...job,
            description:
              job.description.slice(0, MAX_DESC_CHARS) +
              `\n\n[Description truncated at ${MAX_DESC_CHARS} chars to save tokens]`,
          }
        : job;

    console.log(
      `\n[${i + 1}/${toEval.length}] ${job.id} — ${job.title} @ ${job.company}`
    );
    if (truncatedJob.description !== job.description) {
      console.log(
        `  (description truncated: ${job.description.length} → ${MAX_DESC_CHARS} chars)`
      );
    }
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
        job: truncatedJob,
        force,
      });

      // Reset consecutive error counter on successful API call
      consecutiveApiErrors = 0;

      let materials = null;
      const decision = evaluation.decision;
      // By default: generate materials for 'apply' only.
      // Pass --generate-maybe to also generate for 'maybe' (costs ~2x more tokens).
      const shouldGenerate =
        !skipGenerate &&
        (decision === "apply" || (generateMaybe && decision === "maybe"));
      if (shouldGenerate) {
        const what = buildWhat(decision);
        console.log(`  generating materials (${decision} · ${what.join(",")})…`);
        materials = await generateForJob({
          claude,
          cache,
          canonical,
          preferencesMd,
          job: truncatedJob,
          evaluation,
          force,
          what,
        });
        consecutiveApiErrors = 0;
      } else if (decision === "maybe" && !generateMaybe && !skipGenerate) {
        console.log(`  skipping materials for maybe (use --generate-maybe to include)`);
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
      const msg = String(e.message || e);
      console.error(`  ERROR ${job.id}:`, msg);

      // Distinguish Claude API errors (network/rate/server) from job-specific errors
      const isApiError =
        /status (429|500|503|529)|rate.?limit|overloaded|timeout|ECONNRESET|ENOTFOUND/i.test(msg) ||
        e?.status === 429 || e?.status === 500 || e?.status === 503;

      if (isApiError) {
        consecutiveApiErrors += 1;
        if (consecutiveApiErrors >= maxConsecutiveErrors) {
          console.error(
            `\n⚠ ${consecutiveApiErrors} consecutive Claude API errors — aborting batch.\n` +
            `  Last error: ${msg}\n` +
            `  Processed ${i + 1}/${toEval.length} jobs. Re-run to continue from where you left off.`
          );
          // Save current job's error record before aborting
          persistResult({
            id: job.id, title: job.title, company: job.company,
            location: job.location, url: job.url,
            decision: "skip", fitScore: null, confidence: null,
            qualify: job.qualify, evaluation: null, materials: null,
            error: `api_abort: ${msg}`,
          });
          break; // exit the loop — finally block will close cache
        }
      } else {
        // Job-specific error (bad description, schema mismatch, etc.) — don't count toward API error threshold
        consecutiveApiErrors = 0;
      }

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
        error: msg,
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
