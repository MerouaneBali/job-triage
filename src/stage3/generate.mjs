import { GENERATE_TOOL, generateSchema } from "./schemas.mjs";
import { hashText } from "./cache.mjs";

export const GENERATE_PROMPT_VERSION = "generate-v1";

function buildSystem(what) {
  const skip = [];
  if (!what.includes("coverLetter")) skip.push("coverLetter");
  if (!what.includes("outreach")) skip.push("outreachMessage");
  if (!what.includes("strategy")) skip.push("strategy");
  const skipNote =
    skip.length > 0
      ? `\n- Set ${skip.join(", ")} to null — not requested for this run.`
      : "";
  return `You write grounded application materials for a personal job-search tool.
Rules:
- Use ONLY the candidate profile, preferences, job description, and evaluation provided.
- Never invent employers, dates, metrics, degrees, or skills.
- If something is unknown, omit it or phrase carefully without fabricating.
- Cover letter and outreach must be concise, specific, and honest.
- CV tailoring suggestions may only reorder/emphasize existing experience — never fabricate bullets.
- Return results ONLY via the record_application_materials tool.${skipNote}`;
}

export function buildGenerateUserPayload({
  canonical,
  preferencesMd,
  job,
  evaluation,
}) {
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
        url: job.url,
        description: job.description,
      },
      evaluation,
    },
    null,
    2
  );
}

/**
 * @param {object} opts
 * @param {string[]} [opts.what]  items to generate: 'coverLetter' | 'outreach' | 'questions' | 'cv'
 *                                Default: all items.
 */
export async function generateForJob({
  claude,
  cache,
  canonical,
  preferencesMd,
  job,
  evaluation,
  force = false,
  what = ["coverLetter", "outreach", "questions", "cv", "strategy"],
}) {
  const descriptionHash = hashText(job.description);
  const profileVersion = canonical.profileVersion || "unknown";
  // Include 'what' in cache key so different subsets are cached separately
  const whatKey = [...what].sort().join(",");
  const cacheKey = cache.makeKey({
    kind: "generate",
    jobId: job.id,
    descriptionHash,
    profileVersion,
    promptVersion: GENERATE_PROMPT_VERSION + (whatKey !== "coverLetter,cv,outreach,questions" ? `:${whatKey}` : ""),
  });

  if (!force) {
    const hit = cache.get(cacheKey);
    if (hit) {
      console.log(`  cache hit generate ${job.id}`);
      return { ...hit, _cached: true };
    }
  }

  const { input } = await claude.toolCall({
    system: buildSystem(what),
    user: buildGenerateUserPayload({
      canonical,
      preferencesMd,
      job,
      evaluation,
    }),
    tool: GENERATE_TOOL,
    maxTokens: 4096,
  });

  input.jobId = String(job.id);
  const parsed = generateSchema.parse(input);
  cache.set(cacheKey, "generate", job.id, parsed);
  return { ...parsed, _cached: false };
}

export default generateForJob;
