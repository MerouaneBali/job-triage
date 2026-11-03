#!/usr/bin/env node
/**
 * Stage 1: parse LinkedIn Jobs list dumps → data/stage1/*.json
 *
 * Usage:
 *   node src/stage1/parse-jobs.mjs
 *   node src/stage1/parse-jobs.mjs data/dumps/jobs.html
 *   node src/stage1/parse-jobs.mjs --csv
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultDumpsDir = join(root, "data", "dumps");
const defaultStage1Dir = join(root, "data", "stage1");

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(`Usage: node src/stage1/parse-jobs.mjs [path] [--csv] [--out path]

Parses LinkedIn Jobs search dumps (Save Page As or bookmarklet).

  path   Optional. File or folder to parse.
         Default: data/dumps/ (all .html / .htm files)

Writes JSON to data/stage1/ for the preview SPA and stage-2 fetch.
With --csv, also writes a CSV alongside.
--out applies when parsing a single file.`);
  process.exit(0);
}

const wantCsv = args.includes("--csv");
const outArgIdx = args.indexOf("--out");
const explicitOut =
  outArgIdx >= 0 ? resolve(args[outArgIdx + 1]).replace(/\.(json|csv)$/i, "") : null;
const targetArg = args.find((a) => !a.startsWith("--"));
const targetPath = resolve(targetArg || defaultDumpsDir);

/** Decode common HTML entities in attribute/text snippets. */
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

function cleanText(s) {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dump time: bookmarklet marker → file mtime → parse time. */
function resolveDumpedAt(htmlText, filePath, fallback) {
  const marker = htmlText.match(
    /<!--\s*job-triage-dumped-at:\s*([^\s>]+)\s*-->/i
  );
  if (marker) {
    const d = new Date(marker[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }
  try {
    return statSync(filePath).mtime;
  } catch {
    return fallback;
  }
}

const MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/**
 * Parse LinkedIn relative phrases into an absolute Date.
 * Supports: just now, N minute(s)|hour(s)|day(s)|week(s)|month(s) ago
 */
function relativeToDate(raw, dumpedAt) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^Posted\s+/i, "");
  if (/^just\s+now$/i.test(s)) return new Date(dumpedAt);

  const m = s.match(
    /^(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months)\s+ago$/i
  );
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase().replace(/s$/, "");
  const ms = MS[unit];
  if (!ms || !Number.isFinite(n)) return null;
  return new Date(dumpedAt.getTime() - n * ms);
}

/** Fresh relative label from an absolute postedAt (for CSV/re-parse). */
function formatAgo(postedAt, now = new Date()) {
  if (!postedAt) return null;
  const t = postedAt instanceof Date ? postedAt : new Date(postedAt);
  if (Number.isNaN(t.getTime())) return null;
  const diff = Math.max(0, now.getTime() - t.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  if (diff < minute) return "just now";
  if (diff < hour) {
    const n = Math.floor(diff / minute);
    return `${n} minute${n === 1 ? "" : "s"} ago`;
  }
  if (diff < day) {
    const n = Math.floor(diff / hour);
    return `${n} hour${n === 1 ? "" : "s"} ago`;
  }
  if (diff < week) {
    const n = Math.floor(diff / day);
    return `${n} day${n === 1 ? "" : "s"} ago`;
  }
  if (diff < month) {
    const n = Math.floor(diff / week);
    return `${n} week${n === 1 ? "" : "s"} ago`;
  }
  const n = Math.floor(diff / month);
  return `${n} month${n === 1 ? "" : "s"} ago`;
}

const SALARY_RE =
  /(\d[\d.,]*\s*K?\s*(?:GBP|USD|EUR|£|\$|€)\s*(?:\/\s*(?:yr|year|mo|month|day|hr|hour))?|\d[\d.,]*\s*(?:GBP|USD|EUR|£|\$|€)\s*(?:\/\s*(?:yr|year|mo|month|day|hr|hour))?|\d[\d.,]*K\s*(?:GBP|USD|EUR)(?:\/yr)?(?:\s*-\s*\d[\d.,]*K?\s*(?:GBP|USD|EUR)(?:\/yr)?)?)/i;

/** Strong location signals only — avoid treating company names like "PEXA UK" as locations. */
const LOCATION_HINT =
  /\((?:Remote|Hybrid|On-?site)\)|United Kingdom|\b(?:London|Manchester|Birmingham|Edinburgh|Glasgow|Bristol|Leeds|Preston|Cambridge|Oxford|Reading|Remote)\b/i;

function collectInputs(path) {
  if (!existsSync(path)) {
    console.error(`Path not found: ${path}`);
    process.exit(1);
  }
  const st = statSync(path);
  if (st.isDirectory()) {
    const files = readdirSync(path)
      .filter((name) => /\.html?$/i.test(name))
      .map((name) => join(path, name))
      .sort();
    if (files.length === 0) {
      console.error(`No .html dumps found in ${path}`);
      process.exit(1);
    }
    return files;
  }
  return [path];
}

function parseDumpFile(inputPath, { wantCsv, outBaseOverride }) {
  const html = readFileSync(inputPath, "utf8");
  const parsedAt = new Date();
  const dumpedAt = resolveDumpedAt(html, inputPath, parsedAt);

  const outBase =
    outBaseOverride ||
    join(defaultStage1Dir, basename(inputPath).replace(/\.(html?|txt)$/i, ""));
  const jsonPath = `${outBase}.json`;
  const csvPath = `${outBase}.csv`;

  const idMatches = [
    ...html.matchAll(/componentkey="job-card-component-ref-(\d+)"/g),
  ];
  const ids = [...new Set(idMatches.map((m) => m[1]))];

  if (ids.length === 0) {
    console.error(`No job cards found in ${inputPath}.

Likely causes:
  - Empty LinkedIn shell (rare with Save Page As; try bookmarklet)
  - Wrong page (not Jobs search results)
  - LinkedIn renamed componentkey (parser needs updating)

Tip: use bookmarklet.html on the Jobs results page after scrolling.`);
    return { ok: false, inputPath };
  }

  function cardWindow(id, nextId) {
    const marker = `job-card-component-ref-${id}`;
    const start = html.indexOf(marker);
    if (start < 0) return "";
    let end = html.length;
    if (nextId) {
      const nextMarker = `job-card-component-ref-${nextId}`;
      const nextPos = html.indexOf(nextMarker, start + marker.length);
      if (nextPos >= 0) end = nextPos;
    }
    return html.slice(start, end);
  }

  function parseCard(id, nextId) {
    const chunk = cardWindow(id, nextId);

    let title = null;
    const dismiss = chunk.match(
      /aria-label="Dismiss\s+((?:[^"]|\\")+?)\s+job"/i
    );
    if (dismiss) title = cleanText(dismiss[1]);

    if (!title) {
      const verified = chunk.match(
        />([^<]+?)\s*\(Verified job\)<\/span>/i
      );
      if (verified) title = cleanText(verified[1]);
    }

    const paragraphs = [...chunk.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => cleanText(m[1]))
      .filter((t) => t && t !== "·" && t.length < 200);

    let company = null;
    let location = null;
    let salary = null;
    let postedRaw = null;

    for (const p of paragraphs) {
      if (/^Posted\b/i.test(p) || /^\d+\s+(minute|hour|day|week|month)/i.test(p)) {
        postedRaw = p.replace(/^Posted\s+/i, "");
        continue;
      }
      if (/^Be an early applicant$/i.test(p) || /^Easy Apply$/i.test(p)) {
        continue;
      }
      if (SALARY_RE.test(p) && /(?:GBP|USD|EUR|£|\$|€|\/yr|\/day|K\b)/i.test(p)) {
        salary = p;
        continue;
      }
      if (title && (p === title || p.startsWith(title) || title.startsWith(p))) {
        continue;
      }
      if (!company && p.length >= 2 && !LOCATION_HINT.test(p) && !/Verified job/i.test(p)) {
        if (!/^\d/.test(p) && p.split(" ").length <= 12) {
          company = p;
          continue;
        }
      }
      if (!location && (LOCATION_HINT.test(p) || /\(.*(?:Remote|Hybrid|On-?site).*\)/i.test(p))) {
        location = p;
        continue;
      }
    }

    if (!salary) {
      const salSpan = chunk.match(
        /<span[^>]*>\s*([^<]*(?:GBP|USD|EUR|£|\$|€)[^<]*)\s*<\/span/i
      );
      if (salSpan) {
        const candidate = cleanText(salSpan[1]);
        if (
          candidate &&
          !/Verified job/i.test(candidate) &&
          (!title || candidate !== title) &&
          SALARY_RE.test(candidate)
        ) {
          salary = candidate;
        }
      }
    }

    const postedMatch = chunk.match(/>Posted\s+([^<]+)/i);
    if (postedMatch) {
      postedRaw = cleanText(postedMatch[1]);
    } else if (postedRaw) {
      postedRaw = postedRaw
        .replace(/^Posted\s+/i, "")
        .replace(/\b(\d+\s+\w+\s+ago)\s+\1\b/i, "$1");
    }

    const postedAtDate = relativeToDate(postedRaw, dumpedAt);
    const postedAt = postedAtDate ? postedAtDate.toISOString() : null;
    const posted = formatAgo(postedAtDate, parsedAt);

    const easyApply = /Easy Apply/i.test(chunk);
    const earlyApplicant = /Be an early applicant/i.test(chunk);
    const verified =
      /Verified job/i.test(chunk) || /id="verified-small"/i.test(chunk);

    // Prefer company-logo CDN URLs; allow src= with either quote style
    const logoMatch =
      chunk.match(
        /src=["'](https:\/\/media\.licdn\.com\/[^"']*company-logo[^"']*)["']/i
      ) ||
      chunk.match(
        /(https:\/\/media\.licdn\.com\/[^\s"'<>]*company-logo[^\s"'<>]*)/i
      );
    const logoUrl = logoMatch ? decodeEntities(logoMatch[1]) : null;

    return {
      id,
      title,
      company,
      location,
      salary,
      posted,
      postedRaw,
      postedAt,
      easyApply,
      earlyApplicant,
      verified,
      logoUrl,
      url: `https://www.linkedin.com/jobs/view/${id}`,
    };
  }

  const jobs = ids.map((id, i) => parseCard(id, ids[i + 1]));
  const meta = {
    dumpedAt: dumpedAt.toISOString(),
    parsedAt: parsedAt.toISOString(),
    source: basename(inputPath),
  };

  const missingTitle = jobs.filter((j) => !j.title).length;
  const missingCompany = jobs.filter((j) => !j.company).length;
  if (missingTitle > jobs.length * 0.3) {
    console.warn(
      `Warning: ${missingTitle}/${jobs.length} cards missing title in ${basename(inputPath)}`
    );
  }
  if (missingCompany > jobs.length * 0.5) {
    console.warn(
      `Warning: ${missingCompany}/${jobs.length} cards missing company in ${basename(inputPath)}`
    );
  }

  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(
    jsonPath,
    JSON.stringify({ ...meta, jobs }, null, 2) + "\n",
    "utf8"
  );

  if (wantCsv) {
    const cols = [
      "id",
      "title",
      "company",
      "location",
      "salary",
      "posted",
      "postedRaw",
      "postedAt",
      "dumpedAt",
      "easyApply",
      "earlyApplicant",
      "verified",
      "logoUrl",
      "url",
    ];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      cols.join(","),
      ...jobs.map((j) =>
        cols
          .map((c) => esc(c === "dumpedAt" ? meta.dumpedAt : j[c]))
          .join(",")
      ),
    ];
    writeFileSync(csvPath, lines.join("\n") + "\n", "utf8");
  }

  console.log(`Parsed ${jobs.length} jobs from ${basename(inputPath)}`);
  console.log(`Wrote ${jsonPath}`);
  if (wantCsv) console.log(`Wrote ${csvPath}`);
  console.log(
    `dumpedAt ${meta.dumpedAt} · logos: ${
      jobs.filter((j) => j.logoUrl).length
    } · postedAt: ${jobs.filter((j) => j.postedAt).length}`
  );
  console.log(
    `Easy Apply: ${jobs.filter((j) => j.easyApply).length} · Verified: ${
      jobs.filter((j) => j.verified).length
    } · With salary: ${jobs.filter((j) => j.salary).length}`
  );

  return { ok: true, inputPath, jobs, jsonPath };
}

const inputs = collectInputs(targetPath);
const singleFile = inputs.length === 1 && !statSync(targetPath).isDirectory();
let failures = 0;

for (const file of inputs) {
  const result = parseDumpFile(file, {
    wantCsv,
    outBaseOverride: singleFile && explicitOut ? explicitOut : null,
  });
  if (!result.ok) failures += 1;
  if (inputs.length > 1) console.log("");
}

console.log(`Preview: npm run preview → http://127.0.0.1:4173`);
console.log(`Details: npm run fetch-details -- data/stage1/<file>.json`);
if (failures > 0) process.exit(2);
