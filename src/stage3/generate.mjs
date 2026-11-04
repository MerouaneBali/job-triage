import { GENERATE_TOOL, generateSchema } from "./schemas.mjs";
import { hashText } from "./cache.mjs";

export const GENERATE_PROMPT_VERSION = "generate-v1";

const SYSTEM = `You write grounded application materials for a personal job-search tool.
Rules:
- Use ONLY the candidate profile, preferences, job description, and evaluation provided.
- Never invent employers, dates, metrics, degrees, or skills.
- If something is unknown, omit it or phrase carefully without fabricating.
- Cover letter and outreach must be concise, specific, and honest.
- CV tailoring suggestions may only reorder/emphasize existing experience — never fabricate bullets.
- Return results ONLY via the record_application_materials tool.`;

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

export async function generateForJob({
  claude,
  cache,
  canonical,
  preferencesMd,
  job,
  evaluation,
  force = false,
}) {
  const descriptionHash = hashText(job.description);
  const profileVersion = canonical.profileVersion || "unknown";
  const cacheKey = cache.makeKey({
    kind: "generate",
    jobId: job.id,
    descriptionHash,
    profileVersion,
    promptVersion: GENERATE_PROMPT_VERSION,
  });

  if (!force) {
    const hit = cache.get(cacheKey);
    if (hit) {
      console.log(`  cache hit generate ${job.id}`);
      return { ...hit, _cached: true };
    }
  }

  const { input } = await claude.toolCall({
    system: SYSTEM,
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
