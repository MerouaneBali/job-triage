import { EVALUATE_TOOL, evaluateSchema } from "./schemas.mjs";
import { hashText } from "./cache.mjs";

export const EVALUATE_PROMPT_VERSION = "evaluate-v2";

const SYSTEM = `You are a careful job-fit evaluator for a personal job-search tool.

Rules:
- Use ONLY the candidate profile and job text provided. Never invent skills, dates, employers, metrics, or eligibility.
- Separate hard geographic/authorization eligibility from technical fit.
- Candidate is based in Constantine, Algeria and seeks remote roles. They have roughly five years of remote work on long-term contracts with European companies (UK and Spain) and handle all tax/legal compliance independently.
- Location policy -- read carefully:
  - Clearly on-site or hybrid roles in a specific city without any remote option: eligibility fail, decision skip.
  - Roles that require physical presence or local right-to-work AND show no remote language at all: eligibility fail, decision skip.
  - Remote roles with a geographic preference or soft restriction (e.g. "EU only", "UK-based preferred", "must be authorized to work in US" alongside "fully remote"): do NOT auto-skip. Set eligibility to "unknown", note the restriction in locationNotes, and base the decision on technical fit. The candidate has a track record that addresses this in outreach.
  - If the job is fully remote and the location restriction is only implied or mild, lean toward "maybe" or "apply" if skills match well. Do not skip on location alone when remote is clearly offered.
- Tag requirement assessments with match | partial_match | gap | unknown.
- Unknown must never be treated as confirmed positive or negative.
- Respect profile discrepancies: do not silently pick a side; mention unresolved discrepancies when relevant.
- Return results ONLY via the record_job_evaluation tool.`;

export function buildEvaluateUserPayload({ canonical, preferencesMd, job }) {
  return JSON.stringify(
    {
      candidateProfile: canonical,
      preferencesMarkdown: preferencesMd,
      job: {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        easyApply: job.easyApply,
        url: job.url,
        description: job.description,
        qualifySignals: job.qualify || null,
      },
    },
    null,
    2
  );
}

/**
 * @returns {Promise<object>} validated evaluation
 */
export async function evaluateJob({
  claude,
  cache,
  canonical,
  preferencesMd,
  job,
  force = false,
}) {
  const descriptionHash = hashText(job.description);
  const profileVersion = canonical.profileVersion || "unknown";
  const cacheKey = cache.makeKey({
    kind: "evaluate",
    jobId: job.id,
    descriptionHash,
    profileVersion,
    promptVersion: EVALUATE_PROMPT_VERSION,
  });

  if (!force) {
    const hit = cache.get(cacheKey);
    if (hit) {
      console.log(`  cache hit evaluate ${job.id}`);
      return { ...hit, _cached: true };
    }
  }

  const { input } = await claude.toolCall({
    system: SYSTEM,
    user: buildEvaluateUserPayload({ canonical, preferencesMd, job }),
    tool: EVALUATE_TOOL,
    maxTokens: 4096,
  });

  // Ensure jobId matches
  input.jobId = String(job.id);
  const parsed = evaluateSchema.parse(input);
  cache.set(cacheKey, "evaluate", job.id, parsed);
  return { ...parsed, _cached: false };
}

export default evaluateJob;
