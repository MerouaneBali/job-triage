#!/usr/bin/env node
/**
 * Generate (or regenerate) materials for a single job.
 *
 * Usage:
 *   node src/stage3/generate-one.mjs <job_id> [options]
 *
 * Options:
 *   --dump <basename>   Restrict to a specific dump (default: most recent with evaluation)
 *   --what <list>       Comma-separated items: coverLetter,outreach,questions,cv (default: all)
 *   --force             Ignore cache
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { openDb, defaultDbPath, parseJsonCol } from "../db.mjs";
import { openCache } from "./cache.mjs";
import { createClaudeClient } from "./claude.mjs";
import { generateForJob } from "./generate.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
loadEnv({ path: join(root, ".env") });

const args = process.argv.slice(2);
const jobId = args.find((a) => !a.startsWith("--"));
if (!jobId) {
  console.error("Usage: node src/stage3/generate-one.mjs <job_id> [--dump <basename>] [--what coverLetter,outreach,questions,cv] [--force]");
  process.exit(1);
}

const dumpIdx = args.indexOf("--dump");
const dumpBasename = dumpIdx >= 0 ? args[dumpIdx + 1] : null;
const whatIdx = args.indexOf("--what");
const whatRaw = whatIdx >= 0 ? args[whatIdx + 1] : "coverLetter,outreach,questions,cv,strategy";
const what = whatRaw.split(",").map((s) => s.trim()).filter(Boolean);
const force = args.includes("--force");

const db = openDb(defaultDbPath());

// Find the job row — prefer the dump with an evaluation_json set
let row;
if (dumpBasename) {
  const dump = db.prepare("SELECT id FROM dumps WHERE basename = ?").get(dumpBasename);
  if (!dump) {
    console.error(`Dump not found: ${dumpBasename}`);
    db.close();
    process.exit(1);
  }
  row = db.prepare("SELECT * FROM jobs WHERE dump_id = ? AND job_id = ?").get(dump.id, String(jobId));
} else {
  // Pick the most recent dump row that has an evaluation and description
  row = db
    .prepare(`
      SELECT j.* FROM jobs j
      JOIN dumps d ON d.id = j.dump_id
      WHERE j.job_id = ?
        AND j.description IS NOT NULL
      ORDER BY
        CASE WHEN j.evaluation_json IS NOT NULL THEN 0 ELSE 1 END,
        d.dumped_at DESC
      LIMIT 1
    `)
    .get(String(jobId));
}

if (!row) {
  console.error(`Job ${jobId} not found (or has no description)`);
  db.close();
  process.exit(1);
}

const evaluation = parseJsonCol(row.evaluation_json);
if (!evaluation) {
  console.error(`Job ${jobId} has no evaluation yet — run Stage 3 first`);
  db.close();
  process.exit(1);
}

// Load profile
const profileDir = join(root, "data", "profile");
const canonicalPath = join(profileDir, "canonical.json");
const prefsPath = join(profileDir, "preferences.md");
if (!existsSync(canonicalPath)) {
  console.error(`Missing ${canonicalPath}`);
  db.close();
  process.exit(1);
}
const canonical = JSON.parse(readFileSync(canonicalPath, "utf8"));
const preferencesMd = existsSync(prefsPath) ? readFileSync(prefsPath, "utf8") : "";

const job = {
  id: row.job_id,
  title: row.title,
  company: row.company,
  location: row.location,
  salary: row.salary,
  url: row.url,
  description: row.description,
  easyApply: Boolean(row.easy_apply),
};

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

try {
  console.error(`Generating [${what.join(",")}] for job ${jobId}…`);
  const materials = await generateForJob({
    claude,
    cache,
    canonical,
    preferencesMd,
    job,
    evaluation,
    force,
    what,
  });

  // Merge with existing materials (only overwrite requested fields)
  const existing = parseJsonCol(row.materials_json) ?? {};
  const merged = { ...existing };
  if (what.includes("coverLetter"))  merged.coverLetter   = materials.coverLetter ?? null;
  if (what.includes("outreach"))     merged.outreachMessage = materials.outreachMessage ?? null;
  if (what.includes("questions"))    merged.questionsToAsk = materials.questionsToAsk ?? [];
  if (what.includes("cv"))           merged.cvTailoringSuggestions = materials.cvTailoringSuggestions ?? [];
  if (what.includes("strategy"))     merged.strategy = materials.strategy ?? null;

  db.prepare(
    "UPDATE jobs SET materials_json = ? WHERE dump_id = ? AND job_id = ?"
  ).run(JSON.stringify(merged), row.dump_id, String(jobId));

  // Output the merged materials as JSON to stdout for the caller
  console.log(JSON.stringify({ ok: true, materials: merged, jobId, dumpId: row.dump_id }));
} catch (e) {
  console.error(`Generate error: ${e.message || e}`);
  process.exit(1);
} finally {
  cache.close();
  db.close();
}
