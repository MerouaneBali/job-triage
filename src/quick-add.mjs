#!/usr/bin/env node
/**
 * Quick-add a single LinkedIn job by URL.
 * Creates/reuses the persistent "manual" dump, fetches the page via Playwright,
 * parses the description, and persists everything to SQLite.
 *
 * Usage:
 *   node src/quick-add.mjs <linkedin-job-url> [--no-pause] [--headless]
 *
 * Supported URL formats:
 *   https://www.linkedin.com/jobs/view/4234567890/
 *   https://www.linkedin.com/jobs/view/4234567890/?currentJobId=4234567890
 *   https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4234567890
 */

import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { parseDetailHtml, looksLikeChallenge } from "./stage2/parse-detail.mjs";
import {
  openDb,
  defaultDbPath,
  upsertDump,
  upsertJobCard,
  updateJobDetail,
  relativeDetailPath,
  nowIso,
} from "./db.mjs";

export const MANUAL_DUMP = "manual";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const detailsHtmlDir = join(root, "data", "dumps", "details");

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (!args.length || args.includes("--help")) {
  console.log(`Usage: node src/quick-add.mjs <linkedin-job-url> [options]

Options:
  --no-pause    Never wait for Enter (unattended / CI)
  --headless    Run headless (default: headed so you can solve challenges)
  --title TEXT  Override job title
  --company TEXT  Override company name

Supported URL formats:
  https://www.linkedin.com/jobs/view/4234567890/
  https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4234567890
`);
  process.exit(args.includes("--help") ? 0 : 1);
}

// ── URL parsing ───────────────────────────────────────────────────────────────

function extractJobId(urlStr) {
  try {
    const u = new URL(urlStr);
    const viewMatch = u.pathname.match(/\/jobs\/view\/(\d+)/);
    if (viewMatch) return viewMatch[1];
    const cjid = u.searchParams.get("currentJobId");
    if (cjid && /^\d+$/.test(cjid)) return cjid;
  } catch {
    // fall through to regex
  }
  const m = urlStr.match(/\/jobs\/view\/(\d+)/);
  if (m) return m[1];
  const m2 = urlStr.match(/currentJobId=(\d+)/);
  if (m2) return m2[1];
  return null;
}

const rawUrl = args.find((a) => !a.startsWith("--"));
if (!rawUrl) {
  console.error("Error: missing URL argument.");
  process.exit(1);
}

const jobId = extractJobId(rawUrl);
if (!jobId) {
  console.error(`Could not extract a LinkedIn job ID from: ${rawUrl}`);
  console.error(
    "Supported formats:\n" +
      "  https://www.linkedin.com/jobs/view/1234567890/\n" +
      "  https://www.linkedin.com/jobs/collections/recommended/?currentJobId=1234567890"
  );
  process.exit(1);
}

const headless = args.includes("--headless");
const noPause = args.includes("--no-pause");
const canonicalUrl = `https://www.linkedin.com/jobs/view/${jobId}/`;

const titleIdx = args.indexOf("--title");
const manualTitle = titleIdx >= 0 ? args[titleIdx + 1] ?? null : null;
const companyIdx = args.indexOf("--company");
const manualCompany = companyIdx >= 0 ? args[companyIdx + 1] ?? null : null;

// ── DB setup ──────────────────────────────────────────────────────────────────

console.log(`Quick-add job ${jobId}`);
console.log(`URL: ${canonicalUrl}`);
if (manualTitle) console.log(`Title: ${manualTitle}`);
if (manualCompany) console.log(`Company: ${manualCompany}`);

const db = openDb(defaultDbPath());

// Ensure the persistent "manual" dump exists
const dumpId = upsertDump(db, {
  basename: MANUAL_DUMP,
  dumped_at: nowIso(),
  parsed_at: nowIso(),
});

// Insert / update job stub so it's visible in DB even before we fetch
upsertJobCard(db, dumpId, {
  id: jobId,
  url: canonicalUrl,
  title: manualTitle ?? null,
  company: manualCompany ?? null,
  source: "quick_add",
});

console.log(`✓ Job stub saved in "${MANUAL_DUMP}" dump (id: ${dumpId})`);

// ── Playwright fetch ──────────────────────────────────────────────────────────

mkdirSync(detailsHtmlDir, { recursive: true });
const absHtml = join(detailsHtmlDir, `${jobId}.html`);
const rel = relativeDetailPath(jobId);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForEnter(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message}\nPress Enter to continue… `, () => {
      rl.close();
      resolve();
    });
  });
}

async function waitForJobContent(page) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  } catch {
    // ok
  }
  const selectors = [
    ".show-more-less-html__markup",
    ".description__text",
    "text=About the job",
    "[class*='job-details']",
    "main",
  ];
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 8_000 });
      break;
    } catch {
      // try next
    }
  }
  await sleep(1500);
}

let browser = null;
let stopping = false;

function requestStop(reason) {
  if (stopping) return;
  stopping = true;
  console.error(`Stop (${reason}): exiting…`);
  try { browser?.close().catch(() => {}); } catch {}
  try { db.close(); } catch {}
  process.exit(130);
}

process.once("SIGTERM", () => requestStop("SIGTERM"));
process.once("SIGINT", () => requestStop("SIGINT"));

browser = await chromium.launch({ headless });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  locale: "en-GB",
});
const page = await context.newPage();

let status = "ok";
let error = null;
let description = null;
let title = manualTitle ?? null;
let company = manualCompany ?? null;
let location = null;
let logoUrl = null;
let applyUrl = null;

try {
  // Load jobs home first (helps with LinkedIn session detection)
  try {
    await page.goto("https://www.linkedin.com/jobs/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await sleep(1500);
  } catch {
    // ok — continue regardless
  }

  await page.goto(canonicalUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await waitForJobContent(page);

  let html = await page.content();
  let parsed = parseDetailHtml(html);

  let attempts = 0;
  while (!parsed.description && attempts < 2) {
    attempts++;
    console.log(
      looksLikeChallenge(html)
        ? "Login wall / captcha suspected — no job description extracted yet."
        : "Description not found yet."
    );
    if (noPause || headless) {
      console.log(
        noPause
          ? "Unattended (--no-pause): skipping interactive wait."
          : "Headless: cannot solve check interactively. Re-run headed without --no-pause."
      );
      break;
    }
    await waitForEnter(
      "In the Playwright window: pass any challenge. Do NOT log into LinkedIn. When the job description is visible, continue."
    );
    html = await page.content();
    parsed = parseDetailHtml(html);
  }

  // Save HTML regardless so it can be reparsed later
  writeFileSync(absHtml, html, "utf8");
  console.log(`  HTML saved to ${rel}`);

  if (parsed.description) {
    description = parsed.description;
    title = manualTitle ?? parsed.title ?? title;
    company = manualCompany ?? parsed.company ?? company;
    location = parsed.location ?? null;
    logoUrl = parsed.logoUrl ?? null;
    applyUrl = parsed.applyUrl ?? null;
    console.log(`✓ Description extracted (${description.length} chars)`);
    if (parsed.location) console.log(`  Location: ${parsed.location}`);
    if (parsed.logoUrl) console.log(`  Logo URL found`);
    if (applyUrl) console.log(`  Apply URL: ${applyUrl}`);
  } else {
    status = looksLikeChallenge(html) ? "challenge" : "missing_description";
    error = status === "challenge"
      ? "Login wall or challenge page — no description extracted"
      : "Could not extract description from saved HTML";
    console.log(`✗ ${error}`);
  }
} catch (e) {
  status = "error";
  error = e?.message || String(e);
  console.error(`✗ Fetch error: ${error}`);
}

// Update job detail in DB
updateJobDetail(db, dumpId, jobId, {
  status,
  description,
  error,
  htmlPath: rel,
  fetchedAt: nowIso(),
  title,
  company,
  location,
  logoUrl,
  applyUrl,
});
upsertDump(db, { basename: MANUAL_DUMP, fetched_at: nowIso() });
db.close();

await browser.close();

if (status === "ok") {
  console.log(`\n✓ Done — job ${jobId} added to "${MANUAL_DUMP}" dump`);
  process.exit(0);
} else {
  console.error(`\n✗ Finished with status "${status}" — ${error}`);
  process.exit(1);
}
