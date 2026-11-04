import { EVALUATE_TOOL, evaluateSchema } from "./schemas.mjs";
import { hashText } from "./cache.mjs";

export const EVALUATE_PROMPT_VERSION = "evaluate-v1";

const SYSTEM = `You are a careful job-fit evaluator for a personal job-search tool.
Rules:
- Use ONLY the candidate profile and job text provided. Never invent skills, dates, employers, metrics, or eligibility.
- Separate hard geographic/authorization eligibility from technical fit.
- Candidate is based in Constantine, Algeria and seeks remote/international-friendly roles.
- If the employer clearly requires UK/US local right-to-work or on-site presence without international remote, eligibility should fail or decision should be skip — even if skills match.
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
