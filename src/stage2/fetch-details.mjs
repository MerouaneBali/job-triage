#!/usr/bin/env node
/**
 * Stage 2: guest fetch of LinkedIn job detail pages (headed Playwright).
 *
 * Usage:
 *   node src/stage2/fetch-details.mjs data/stage1/jobs.json
 *   node src/stage2/fetch-details.mjs data/stage1/jobs.json --limit 2
 *   node src/stage2/fetch-details.mjs data/stage1/jobs.json --proxy http://127.0.0.1:7890
 *
 * Uses a clean ephemeral browser context (not your Chrome profile).
 * On captcha / missing description: pauses for Enter after you solve it manually.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { chromium } from "playwright";
import { parseDetailHtml, looksLikeChallenge } from "./parse-detail.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const detailsHtmlDir = join(root, "data", "dumps", "details");
const stage2Dir = join(root, "data", "stage2");

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  console.log(`Usage: node src/stage2/fetch-details.mjs <stage1.json> [options]

Options:
  --limit N       Only process first N pending jobs
  --delay MS      Base delay between jobs in ms (default 4000; jitter added)
  --proxy URL     HTTP(S) proxy (else HTTP_PROXY / HTTPS_PROXY env)
  --headed        Force headed (default)
  --headless      Headless (harder to solve captchas)
  --reparse-only  Re-parse saved data/dumps/details/{id}.html into stage-2 JSON (no browser)

Never log into the Playwright window with your LinkedIn account.`);
  process.exit(args.includes("--help") ? 0 : 1);
}

const stage1Path = resolve(args.find((a) => !a.startsWith("--")));
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
const reparseOnly = args.includes("--reparse-only");

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

function loadStage1(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const jobs = Array.isArray(raw) ? raw : raw.jobs;
  if (!Array.isArray(jobs)) throw new Error("Stage-1 JSON missing jobs[]");
  return { meta: Array.isArray(raw) ? {} : raw, jobs };
}

function stage2PathFor(stage1File) {
  const base = basename(stage1File).replace(/\.json$/i, "");
  return join(stage2Dir, `${base}.json`);
}

function loadStage2(path) {
  if (!existsSync(path)) {
    return {
      fetchedAt: null,
      sourceStage1: basename(stage1Path),
      jobs: [],
    };
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveStage2(path, doc) {
  mkdirSync(dirnameSafe(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

function dirnameSafe(p) {
  return resolve(p, "..");
}

function upsertJob(doc, record) {
  const i = doc.jobs.findIndex((j) => j.id === record.id);
  if (i >= 0) doc.jobs[i] = { ...doc.jobs[i], ...record };
  else doc.jobs.push(record);
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
  // Guest / logged-in variants
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

const { jobs: stage1Jobs } = loadStage1(stage1Path);
const outPath = stage2PathFor(stage1Path);
const stage2 = loadStage2(outPath);
stage2.sourceStage1 = basename(stage1Path);

const doneIds = new Set(
  stage2.jobs.filter((j) => j.status === "ok" && j.description).map((j) => j.id)
);

mkdirSync(detailsHtmlDir, { recursive: true });
mkdirSync(stage2Dir, { recursive: true });

if (reparseOnly) {
  let targets = stage1Jobs.filter((j) => j.id);
  if (Number.isFinite(limit)) targets = targets.slice(0, limit);
  let ok = 0;
  let missing = 0;
  for (const job of targets) {
    const htmlPath = join(detailsHtmlDir, `${job.id}.html`);
    if (!existsSync(htmlPath)) {
      upsertJob(stage2, {
        id: job.id,
        url: job.url,
        title: job.title || null,
        company: job.company || null,
        status: "missing_html",
        description: null,
        error: "No saved HTML in data/dumps/details",
        htmlPath: null,
        fetchedAt: new Date().toISOString(),
      });
      missing += 1;
      continue;
    }
    const html = readFileSync(htmlPath, "utf8");
    const parsed = parseDetailHtml(html);
    if (parsed.description) {
      upsertJob(stage2, {
        id: job.id,
        url: job.url,
        title: parsed.title || job.title || null,
        company: job.company || parsed.company || null,
        status: "ok",
        description: parsed.description,
        error: null,
        htmlPath,
        fetchedAt: new Date().toISOString(),
      });
      ok += 1;
      console.log(`✓ ${job.id} (${parsed.description.length} chars)`);
    } else {
      upsertJob(stage2, {
        id: job.id,
        url: job.url,
        title: job.title || parsed.title || null,
        company: job.company || parsed.company || null,
        status: "missing_description",
        description: null,
        error: looksLikeChallenge(html)
          ? "Login wall or challenge page (no job description)"
          : "Could not extract description from saved HTML",
        htmlPath,
        fetchedAt: new Date().toISOString(),
      });
      missing += 1;
      console.log(`✗ ${job.id} — no description`);
    }
  }
  stage2.fetchedAt = new Date().toISOString();
  saveStage2(outPath, stage2);
  console.log(`\nReparsed: ${ok} ok · ${missing} missing → ${outPath}`);
  process.exit(0);
}

let pending = stage1Jobs.filter((j) => j.id && j.url && !doneIds.has(j.id));
if (Number.isFinite(limit)) pending = pending.slice(0, limit);

console.log(
  `Stage-1 jobs: ${stage1Jobs.length} · already ok: ${doneIds.size} · to fetch: ${pending.length}`
);
if (proxyUrl) console.log(`Proxy: ${proxyUrl}`);
if (!pending.length) {
  console.log(`Nothing to do. Stage-2 file: ${outPath}`);
  process.exit(0);
}

const launchOpts = {
  headless,
  proxy: parseProxy(proxyUrl),
};

const browser = await chromium.launch(launchOpts);
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  locale: "en-GB",
});
// Explicitly no storageState — ephemeral guest session
const page = await context.newPage();

let index = 0;
try {
  for (const job of pending) {
    index += 1;
    console.log(`\n[${index}/${pending.length}] ${job.id} — ${job.title || "?"}`);
    console.log(job.url);

    let status = "ok";
    let error = null;
    let description = null;
    let title = job.title || null;
    let company = job.company || null;
    let htmlPath = join(detailsHtmlDir, `${job.id}.html`);

    try {
      // Warm guest jar lightly once per process (first job)
      if (index === 1) {
        try {
          await page.goto("https://www.linkedin.com/jobs/", {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          await sleep(1500);
        } catch {
          // continue to job URL anyway
        }
      }

      const viewUrl = `https://www.linkedin.com/jobs/view/${job.id}/`;
      await page.goto(viewUrl, {
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
        if (headless) {
          console.log(
            "Headless often gets a login shell. Re-run without --headless and solve any check in the window."
          );
          break;
        }
        await waitForEnter(
          "In the Playwright window: pass any check if shown. Prefer closing overlays—do NOT log into your LinkedIn account. When the job description is visible behind/without the modal, continue."
        );
        await waitForJobContent(page);
        ({ html, parsed } = await extractFromPage(page));
      }

      writeFileSync(htmlPath, html, "utf8");

      // Prefer extracted description; challenge heuristics must not discard a real JD
      // (LinkedIn HTML often contains "recaptcha" config strings on successful pages).
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
    }

    upsertJob(stage2, {
      id: job.id,
      url: job.url,
      title,
      company,
      status,
      description,
      error,
      htmlPath: existsSync(htmlPath) ? htmlPath : null,
      fetchedAt: new Date().toISOString(),
    });
    stage2.fetchedAt = new Date().toISOString();
    saveStage2(outPath, stage2);
    console.log(`→ ${status}${description ? ` (${description.length} chars)` : ""}`);

    if (index < pending.length) {
      const jitter = Math.floor(Math.random() * 2000);
      const wait = Math.max(1000, baseDelay + jitter);
      console.log(`Waiting ${wait}ms…`);
      await sleep(wait);
    }
  }
} finally {
  await context.close();
  await browser.close();
}

const ok = stage2.jobs.filter((j) => j.status === "ok").length;
console.log(`\nDone. ${ok}/${stage2.jobs.length} ok → ${outPath}`);
