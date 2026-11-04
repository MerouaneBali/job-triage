/**
 * Merge stage-1 card fields with stage-2 descriptions by job id.
 * Prefer stage-1 for company/title/salary/location; stage-2 for description.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, join, dirname } from "node:path";

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function stage2PathForStage1(stage1Path) {
  const dir = dirname(stage1Path);
  // data/stage1/foo.json → data/stage2/foo.json
  const stage2Dir = join(dirname(dir), "stage2");
  return join(stage2Dir, basename(stage1Path));
}

/**
 * @param {string} stage1Path
 * @param {string} [stage2Path]
 */
export function mergeStageFiles(stage1Path, stage2Path = stage2PathForStage1(stage1Path)) {
  if (!existsSync(stage1Path)) throw new Error(`Missing stage-1 file: ${stage1Path}`);
  if (!existsSync(stage2Path)) throw new Error(`Missing stage-2 file: ${stage2Path}`);

  const s1 = loadJson(stage1Path);
  const s2 = loadJson(stage2Path);
  const s1Jobs = Array.isArray(s1) ? s1 : s1.jobs || [];
  const s2Jobs = Array.isArray(s2) ? s2 : s2.jobs || [];

  const byId = new Map();
  for (const j of s2Jobs) {
    if (j?.id != null) byId.set(String(j.id), j);
  }

  const jobs = s1Jobs.map((card) => {
    const id = String(card.id);
    const detail = byId.get(id);
    const description =
      detail?.status === "ok" && detail.description ? detail.description : null;
    const companyLooksBad =
      detail?.company &&
      (/^linkedin jobs$/i.test(detail.company) || detail.company === card.company);

    return {
      id,
      title: card.title || detail?.title || null,
      company: card.company || (companyLooksBad ? null : detail?.company) || null,
      location: card.location || null,
      salary: card.salary || null,
      posted: card.posted || null,
      postedAt: card.postedAt || null,
      easyApply: Boolean(card.easyApply),
      earlyApplicant: Boolean(card.earlyApplicant),
      verified: Boolean(card.verified),
      logoUrl: card.logoUrl || null,
      url: card.url || detail?.url || `https://www.linkedin.com/jobs/view/${id}`,
      description,
      detailStatus: detail?.status || (detail ? "unknown" : "missing_stage2"),
      detailError: detail?.error || null,
      htmlPath: detail?.htmlPath || null,
      hasDescription: Boolean(description && description.length >= 60),
    };
  });

  return {
    sourceStage1: basename(stage1Path),
    sourceStage2: basename(stage2Path),
    dumpedAt: s1.dumpedAt || null,
    mergedAt: new Date().toISOString(),
    jobs,
  };
}

export default mergeStageFiles;
