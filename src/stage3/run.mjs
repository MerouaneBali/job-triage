#!/usr/bin/env node
/**
 * Stage 3 CLI: merge → qualify → evaluate (Claude) → generate (Claude).
 *
 *   npm run stage3 -- data/stage1/foo.json
 *   npm run stage3 -- data/stage1/foo.json --limit 3 --skip-generate
 *   npm run stage3 -- data/stage1/foo.json --qualify-only
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { mergeStageFiles } from "./merge.mjs";
import { qualifyAll } from "./qualify.mjs";
import { openCache } from "./cache.mjs";
import { createClaudeClient } from "./claude.mjs";
import { evaluateJob } from "./evaluate.mjs";
import { generateForJob } from "./generate.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
loadEnv({ path: join(root, ".env") });

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  console.log(`Usage: node src/stage3/run.mjs <stage1.json> [options]

Options:
  --limit N          Evaluate at most N jobs that pass qualify
  --skip-generate    Do not call Claude for cover letters / outreach
  --qualify-only     Merge + qualify only (no API)
  --force            Ignore SQLite cache
  --stage2 PATH      Override stage-2 JSON path
`);
  process.exit(args.includes("--help") ? 0 : 1);
}

const stage1Path = resolve(args.find((a) => !a.startsWith("--")));
const stage2Idx = args.indexOf("--stage2");
const stage2Path =
  stage2Idx >= 0 ? resolve(args[stage2Idx + 1]) : undefined;
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const skipGenerate = args.includes("--skip-generate");
const qualifyOnly = args.includes("--qualify-only");
const force = args.includes("--force");

const profileDir = join(root, "data", "profile");
const stage3Dir = join(root, "data", "stage3");
const canonicalPath = join(profileDir, "canonical.json");
const prefsPath = join(profileDir, "preferences.md");
const dbPath = join(stage3Dir, "job-triage.sqlite");
const outPath = join(stage3Dir, basename(stage1Path));

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

console.log(`Merge ${basename(stage1Path)} …`);
const merged = mergeStageFiles(stage1Path, stage2Path);
const qualified = qualifyAll(merged.jobs, prefs);

const failCount = qualified.filter((j) => j.qualify.eligibility === "fail")
  .length;
const passCount = qualified.length - failCount;
console.log(
  `Merged ${qualified.length} jobs · qualify pass ${passCount} · fail ${failCount}`
);

mkdirSync(stage3Dir, { recursive: true });

/** @type {object[]} */
const results = [];

for (const job of qualified) {
  if (job.qualify.eligibility === "fail") {
    results.push({
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
      skipReason: "qualify_fail",
    });
  }
}

if (qualifyOnly) {
  const doc = {
    stage: 3,
    createdAt: new Date().toISOString(),
    sourceStage1: merged.sourceStage1,
    sourceStage2: merged.sourceStage2,
    profileVersion: canonical.profileVersion,
    jobs: results.concat(
      qualified
        .filter((j) => j.qualify.eligibility === "pass")
        .map((j) => ({
          id: j.id,
          title: j.title,
          company: j.company,
          location: j.location,
          url: j.url,
          decision: null,
          fitScore: null,
          qualify: j.qualify,
          evaluation: null,
          materials: null,
          pendingEvaluate: true,
        }))
    ),
  };
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`Wrote ${outPath} (qualify-only)`);
  process.exit(0);
}

let toEval = qualified.filter((j) => j.qualify.eligibility === "pass");
if (Number.isFinite(limit)) toEval = toEval.slice(0, limit);

const cache = openCache(dbPath);
let claude;
try {
  claude = createClaudeClient(process.env);
} catch (e) {
  cache.close();
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

      results.push({
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
      });
    } catch (e) {
      console.error(`  ERROR ${job.id}:`, e.message || e);
      results.push({
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

// Sort: apply/maybe by score desc, then skips
const rank = { apply: 0, maybe: 1, skip: 2 };
results.sort((a, b) => {
  const da = rank[a.decision] ?? 9;
  const db = rank[b.decision] ?? 9;
  if (da !== db) return da - db;
  return (b.fitScore || 0) - (a.fitScore || 0);
});

const doc = {
  stage: 3,
  createdAt: new Date().toISOString(),
  sourceStage1: merged.sourceStage1,
  sourceStage2: merged.sourceStage2,
  profileVersion: canonical.profileVersion,
  model: claude.model,
  jobs: results,
  summary: {
    total: results.length,
    apply: results.filter((j) => j.decision === "apply").length,
    maybe: results.filter((j) => j.decision === "maybe").length,
    skip: results.filter((j) => j.decision === "skip").length,
  },
};

writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
console.log(`\nWrote ${outPath}`);
console.log(
  `Summary: apply ${doc.summary.apply} · maybe ${doc.summary.maybe} · skip ${doc.summary.skip}`
);
console.log(`Preview: npm run preview → http://127.0.0.1:4173`);
