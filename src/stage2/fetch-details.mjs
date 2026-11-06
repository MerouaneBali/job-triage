#!/usr/bin/env node
/**
 * Stage 2: guest fetch of LinkedIn job detail pages (headed Playwright).
 * Reads/writes job rows in data/job-triage.sqlite; saves HTML under data/dumps/details/.
 *
 * Usage:
 *   node src/stage2/fetch-details.mjs <basename>
 *   node src/stage2/fetch-details.mjs <basename> --limit 2
 *   node src/stage2/fetch-details.mjs <basename> --reparse-only
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { chromium } from "playwright";
import { parseDetailHtml, looksLikeChallenge } from "./parse-detail.mjs";
import {
  openDb,
  basenameFromArg,
  getDumpByBasename,
  listJobsForDump,
  updateJobDetail,
  upsertDump,
  relativeDetailPath,
  nowIso,
  jobRowToApi,
  findJobTwin,
  copyJobDetailFromTwin,
} from "../db.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const detailsHtmlDir = join(root, "data", "dumps", "details");
const stopFile = join(root, "data", ".pipeline-stop");

function stopRequested() {
  return existsSync(stopFile);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  console.log(`Usage: node src/stage2/fetch-details.mjs <basename> [options]

  basename   Dump stem (e.g. linkedin-jobs-2026-11-03T00-01-37-705Z)
             Also accepts a path ending in that stem (.json/.html ignored).

Options:
  --limit N       Only process first N pending jobs
  --delay MS      Base delay between jobs in ms (default 4000; jitter added)
  --proxy URL     HTTP(S) proxy (else HTTP_PROXY / HTTPS_PROXY env)
  --headed        Force headed (default)
  --headless      Headless (harder to solve captchas)
  --no-pause      Never wait for Enter (unattended / Pi); save HTML and continue on failure
  --force         Re-fetch even when detail_status is already ok
  --reparse-only  Re-parse saved data/dumps/details/{id}.html into SQLite (no browser)

Never log into the Playwright window with your LinkedIn account.`);
  process.exit(args.includes("--help") ? 0 : 1);
}

const dumpArg = args.find((a) => !a.startsWith("--"));
const basename = basenameFromArg(dumpArg);
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const delayIdx = args.indexOf("--delay");
const baseDelay = delayIdx >= 0 ? Number(args[delayIdx + 1]) : 4000;
const proxyIdx = args.indexOf("--proxy");
const proxyUrl =
  (proxyIdx >= 0 && args[proxyIdx + 1]) ||
  process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.https_proxy ||
  null;
const headless = args.includes("--headless");
const noPause = args.includes("--no-pause");
const force = args.includes("--force");
const reparseOnly = args.includes("--reparse-only");
const maxAgeIdx2 = args.indexOf("--max-age-days");
const MAX_AGE_DAYS_S2 = maxAgeIdx2 >= 0 ? Number(args[maxAgeIdx2 + 1]) : 30;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForEnter(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    rl.question(`${message}\nPress Enter to continue… `, () => {
      rl.close();
      resolvePromise();
    });
  });
}

async function extractFromPage(page) {
  const html = await page.content();
  return { html, parsed: parseDetailHtml(html) };
}

async function waitForJobContent(page) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  } catch {
    // continue
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

function parseProxy(url) {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const server = `${u.protocol}//${u.host}`;
    const proxy = { server };
    if (u.username) proxy.username = decodeURIComponent(u.username);
    if (u.password) proxy.password = decodeURIComponent(u.password);
    return proxy;
  } catch {
    return { server: url };
  }
}

function saveDetail(db, dumpId, record) {
  updateJobDetail(db, dumpId, record.id, {
    status: record.status,
    description: record.description,
    error: record.error,
    htmlPath: record.htmlPath,
    fetchedAt: record.fetchedAt,
    title: record.title,
    company: record.company,
    applyUrl: record.applyUrl ?? null,
  });
}

const db = openDb();
const dump = getDumpByBasename(db, basename);
if (!dump) {
  console.error(`Unknown dump basename: ${basename}. Run stage1 parse first.`);
  db.close();
  process.exit(1);
}

const cardJobs = listJobsForDump(db, dump.id).map(jobRowToApi);
mkdirSync(detailsHtmlDir, { recursive: true });

if (reparseOnly) {
  let targets = cardJobs.filter((j) => j.id);
  if (Number.isFinite(limit)) targets = targets.slice(0, limit);
  let ok = 0;
  let missing = 0;
  for (const job of targets) {
    const absHtml = join(detailsHtmlDir, `${job.id}.html`);
    const rel = relativeDetailPath(job.id);
    if (!existsSync(absHtml)) {
      saveDetail(db, dump.id, {
        id: job.id,
        status: "missing_html",
        description: null,
        error: "No saved HTML in data/dumps/details",
        htmlPath: null,
        fetchedAt: nowIso(),
        title: job.title,
        company: job.company,
      });
      missing += 1;
      continue;
    }
    const html = readFileSync(absHtml, "utf8");
    const parsed = parseDetailHtml(html);
    if (parsed.description) {
      saveDetail(db, dump.id, {
        id: job.id,
        status: "ok",
        description: parsed.description,
        error: null,
        htmlPath: rel,
        fetchedAt: nowIso(),
        title: parsed.title || job.title,
        company: job.company || parsed.company,
        applyUrl: parsed.applyUrl,
      });
      ok += 1;
      console.log(
        `✓ ${job.id} (${parsed.description.length} chars)${parsed.applyUrl ? " · applyUrl" : ""}`
      );
    } else {
      saveDetail(db, dump.id, {
        id: job.id,
        status: "missing_description",
        description: null,
        error: looksLikeChallenge(html)
          ? "Login wall or challenge page (no job description)"
          : "Could not extract description from saved HTML",
        htmlPath: rel,
        fetchedAt: nowIso(),
        title: job.title || parsed.title,
        company: job.company || parsed.company,
        applyUrl: parsed.applyUrl,
      });
      missing += 1;
      console.log(`✗ ${job.id} — no description`);
    }
  }
  upsertDump(db, { basename, fetched_at: nowIso() });
  db.close();
  console.log(`\nReparsed: ${ok} ok · ${missing} missing → dump ${basename}`);
  process.exit(0);
}

const doneIds = new Set(
  cardJobs.filter((j) => j.detailStatus === "ok" && j.description).map((j) => j.id)
);
let pending = cardJobs.filter(
  (j) => j.id && j.url && (force || !doneIds.has(j.id))
);

// Skip jobs older than MAX_AGE_DAYS_S2 — they're likely already filled
if (Number.isFinite(MAX_AGE_DAYS_S2) && MAX_AGE_DAYS_S2 > 0) {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS_S2 * 86_400_000);
  const beforeAge = pending.length;
  pending = pending.filter((j) => {
    if (!j.postedAt) return true; // no date info — include
    return new Date(j.postedAt) >= cutoff;
  });
  if (pending.length < beforeAge)
    console.log(`Skipping ${beforeAge - pending.length} jobs older than ${MAX_AGE_DAYS_S2} days.`);
}

if (Number.isFinite(limit)) pending = pending.slice(0, limit);

console.log(
  `Dump ${basename}: ${cardJobs.length} jobs · already ok: ${doneIds.size} · to fetch: ${pending.length}${force ? " (force)" : ""}`
);
if (proxyUrl) console.log(`Proxy: ${proxyUrl}`);
if (!pending.length) {
  console.log(
    `Nothing to do — every job already has a description. Use --force (or Pipeline “Force refetch”) to open the browser again.`
  );
  db.close();
  process.exit(0);
}

/** Copy from title/company (or same job_id) twins before launching Chromium. */
const needBrowser = [];
let copied = 0;
if (!force) {
  for (const job of pending) {
    const twin = findJobTwin(db, {
      title: job.title,
      company: job.company,
      jobId: job.id,
      excludeDumpId: dump.id,
      excludeJobId: job.id,
      needDescription: true,
    });
    if (twin) {
      const info = copyJobDetailFromTwin(db, dump.id, job.id, twin);
      copied += 1;
      console.log(
        `→ duplicate ${job.id} (copied from ${info.twinJobId}${
          info.twinDump ? ` @ ${info.twinDump}` : ""
        })`
      );
      continue;
    }
    needBrowser.push(job);
  }
  pending = needBrowser;
  if (copied) {
    upsertDump(db, { basename, fetched_at: nowIso() });
    console.log(`Copied ${copied} from twins · remaining to fetch: ${pending.length}`);
  }
}

if (!pending.length) {
  const refreshedEarly = listJobsForDump(db, dump.id);
  const okEarly = refreshedEarly.filter((j) => j.detail_status === "ok").length;
  db.close();
  console.log(`\nDone. ${okEarly}/${refreshedEarly.length} ok → dump ${basename} (all from twins)`);
  process.exit(0);
}

let browser = null;
let stopping = false;

function requestStop(reason) {
  if (stopping) return;
  stopping = true;
  console.error(`Stop (${reason}): exiting…`);
  // Exit ASAP — do not keep walking the job list after the browser dies.
  try {
    browser?.close().catch(() => {});
  } catch {
    // ignore
  }
  try {
    db.close();
  } catch {
    // ignore
  }
  process.exit(130);
}

process.once("SIGTERM", () => requestStop("SIGTERM"));
process.once("SIGINT", () => requestStop("SIGINT"));

browser = await chromium.launch({
  headless,
  proxy: parseProxy(proxyUrl),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  locale: "en-GB",
});
const page = await context.newPage();

let index = 0;
let consecutiveErrors = 0;
const CONSECUTIVE_ERROR_LIMIT = 5; // stop if N browser/network errors in a row

try {
  for (const job of pending) {
    if (stopping || stopRequested()) {
      requestStop(stopRequested() ? "stop-file" : "flag");
      break;
    }
    index += 1;
    console.log(`\n[${index}/${pending.length}] ${job.id} — ${job.title || "?"}`);
    console.log(job.url);

    // Re-check twin in case an earlier fetch in this run filled one
    if (!force) {
      const twin = findJobTwin(db, {
        title: job.title,
        company: job.company,
        jobId: job.id,
        excludeDumpId: dump.id,
        excludeJobId: job.id,
        needDescription: true,
      });
      if (twin) {
        const info = copyJobDetailFromTwin(db, dump.id, job.id, twin);
        upsertDump(db, { basename, fetched_at: nowIso() });
        console.log(
          `→ duplicate (copied from ${info.twinJobId}${
            info.twinDump ? ` @ ${info.twinDump}` : ""
          })`
        );
        continue;
      }
    }

    let status = "ok";
    let error = null;
    let description = null;
    let title = job.title || null;
    let company = job.company || null;
    let applyUrl = null;
    const absHtml = join(detailsHtmlDir, `${job.id}.html`);
    const rel = relativeDetailPath(job.id);

    try {
      if (index === 1) {
        try {
          await page.goto("https://www.linkedin.com/jobs/", {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          await sleep(1500);
        } catch {
          // continue
        }
      }

      await page.goto(`https://www.linkedin.com/jobs/view/${job.id}/`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await waitForJobContent(page);

      let { html, parsed } = await extractFromPage(page);

      let attempts = 0;
      while (!parsed.description && attempts < 2) {
        attempts += 1;
        console.log(
          looksLikeChallenge(html)
            ? "Login wall / captcha / challenge suspected (no JD extracted yet)."
            : "Description not found yet."
        );
        if (noPause || headless) {
          console.log(
            noPause
              ? "Unattended (--no-pause): skipping interactive wait."
              : "Headless often gets a login shell. Re-run headed without --no-pause to solve checks manually."
          );
          break;
        }
        await waitForEnter(
          "In the Playwright window: pass any check if shown. Prefer closing overlays—do NOT log into your LinkedIn account. When the job description is visible behind/without the modal, continue."
        );
        await waitForJobContent(page);
        ({ html, parsed } = await extractFromPage(page));
      }

      writeFileSync(absHtml, html, "utf8");
      applyUrl = parsed.applyUrl;

      if (parsed.description) {
        description = parsed.description;
        title = parsed.title || title;
        company = parsed.company || company;
        status = "ok";
      } else {
        status = "missing_description";
        error = looksLikeChallenge(html)
          ? "Login wall or challenge page (no job description)"
          : "Could not extract description after wait/pause";
      }
    } catch (e) {
      status = "error";
      error = String(e && e.message ? e.message : e);
      console.error("Fetch error:", error);
      // Browser was killed by Stop — don't grind through the rest of the dump.
      if (
        stopping ||
        /has been closed|Target closed|browser has been closed/i.test(error)
      ) {
        requestStop("browser-closed");
      }
      consecutiveErrors += 1;
      if (consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT) {
        console.error(
          `\n⚠ ${consecutiveErrors} consecutive browser/network errors — aborting batch.\n` +
          `  Last error: ${error}\n` +
          `  Remaining jobs (${pending.length - index}) will be retried on next run.`
        );
        // Save current job's error record before aborting
        saveDetail(db, dump.id, { id: job.id, status, description: null, error, htmlPath: null, fetchedAt: nowIso(), title, company, applyUrl });
        upsertDump(db, { basename, fetched_at: nowIso() });
        db.close();
        process.exit(1);
      }
    }

    if (stopping) break;

    saveDetail(db, dump.id, {
      id: job.id,
      status,
      description,
      error,
      htmlPath: existsSync(absHtml) ? rel : null,
      fetchedAt: nowIso(),
      title,
      company,
      applyUrl,
    });
    upsertDump(db, { basename, fetched_at: nowIso() });
    console.log(
      `→ ${status}${description ? ` (${description.length} chars)` : ""}${applyUrl ? " · applyUrl" : ""}`
    );
    // Reset consecutive error counter on any non-error result
    if (status !== "error") consecutiveErrors = 0;

    if (index < pending.length) {
      const jitter = Math.floor(Math.random() * 2000);
      const wait = Math.max(1000, baseDelay + jitter);
      console.log(`Waiting ${wait}ms…`);
      await sleep(wait);
      if (stopping) break;
    }
  }
} finally {
  if (!stopping) {
    try {
      await context.close();
    } catch {
      // ignore
    }
    try {
      await browser?.close();
    } catch {
      // ignore
    }
  }
}

if (stopping) {
  try {
    db.close();
  } catch {
    // ignore
  }
  process.exit(130);
}

const refreshed = listJobsForDump(db, dump.id);
const ok = refreshed.filter((j) => j.detail_status === "ok").length;
db.close();
console.log(`\nDone. ${ok}/${refreshed.length} ok → dump ${basename}`);
