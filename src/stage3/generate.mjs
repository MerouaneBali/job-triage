import { GENERATE_TOOL, generateSchema } from "./schemas.mjs";
import { hashText } from "./cache.mjs";

export const GENERATE_PROMPT_VERSION = "generate-v5";

function buildSystem(what) {
  const skip = [];
  if (!what.includes("coverLetter")) skip.push("coverLetter");
  if (!what.includes("outreach")) skip.push("outreachMessage");
  if (!what.includes("strategy")) skip.push("strategy");
  const skipNote =
    skip.length > 0
      ? `\n- Set ${skip.join(", ")} to null -- not requested for this run.`
      : "";
  return `You write application materials for a personal job-search tool. The candidate is a full-stack engineer with roughly five years of experience, based in Algeria, working remotely on long-term contracts with European companies.

Accuracy rules:
- Use ONLY the candidate profile, preferences, job description, and evaluation provided.
- Never invent employers, dates, metrics, degrees, or skills not in the profile.
- If something is unknown, omit it or phrase carefully. Never fabricate.
- CV tailoring suggestions may only reorder or re-emphasize existing experience, never add invented bullets.

Writing style -- apply to every word you write:
- Write like a human, not a job application template.
- Never use an em dash. Use a comma, a period, or rewrite the sentence.
- Forbidden phrases: "I am writing to express my interest", "I would be a great asset", "leverage my expertise", "I am passionate about", "dynamic team", "fast-paced environment", "results-driven", "highly motivated", "team player", "I look forward to hearing from you".
- Do not open two consecutive sentences with "I".
- Short, direct sentences. One idea per sentence.
- Confident, not desperate. Proposing a match, not asking for a favor.

Outreach message rules:
- Open with exactly: Hi [Name],
- Leave [Name] as a literal placeholder. The candidate fills it in manually.
- Total length: three to five sentences. Hard limit. This is not a cover letter.
- Close with one line: "Happy to chat if you are open to it." Nothing longer.

How to open (this is the hardest part -- get it right):
- After "Hi [Name]," add one short warm line before the pitch. Something like "Hope you are doing well." or "Hope things are going well on your end." Keep it short and natural. Do not skip this line and jump straight into the pitch.
- Then: pick ONE specific thing from the job that actually resonates. Could be the product, the problem they are solving, the technical setup, or what the role involves day to day.
- React to it in plain human language. Something like: "I came across your posting for [role] and [one thing] caught my eye."
- Do NOT rephrase or summarize the job description back at them. That is the most robotic thing you can do. If the job says "frontend depth and written reasoning", do not write "the mix of frontend depth and written reasoning stands out". Pick ONE real detail and react to it naturally.
- Do not start with complimenting the company in a vague way. No "I am impressed by what you are building at X."

How to state fit -- THIS IS THE MOST IMPORTANT RULE:
- The fit sentence MUST follow directly from the hook. If you said "the code review simulation caught my eye", the next sentence must say why you would be good at that kind of work -- not pivot to an unrelated fact from the profile.
- Think of the outreach as a single connected thought, not three separate buckets to fill with profile information.
- One clear sentence that connects to what you just said. For example: if the hook is about code review, say something like "I have been doing frontend contract work for a few years and code review is a big part of what I do." If the hook is about a specific product type, say you have built something similar.
- Do NOT jump to unrelated profile facts. If the hook is about code review and you then write "Most of my recent work is Next.js and React for a Spain-based telecom company including a customer portal that replaced a Flutter web build" -- that is exactly wrong. That Flutter portal has nothing to do with code review and nothing to do with what you just said.
- If you mention technologies, fold them into a clause, not a list. "building e-commerce platforms in React and Next.js" not "React, Next.js, TypeScript, used on three different platforms."
- One concrete detail that shows real experience, not just tool familiarity.

Remote and location:
- If the job has a location restriction but is remote: one casual sentence, then move on. Keep it brief and natural. Example: "Five years working remotely for UK and Spain-based companies, all compliance on my side." Do not ask if they are open to international candidates.
- Only include this if location is actually a potential concern for this job. Do not force it in if it is not relevant.

Bad outreach examples (do not write anything like these):
- Hook about code review, then: "Most of my recent work is Next.js and React for a Spain-based telecom company, including a customer portal that replaced a Flutter web build." -- the Flutter migration has nothing to do with code review. This is the pivot-to-random-facts failure.
- "The mix of frontend depth and written reasoning in this role stands out, especially the focus on explaining architectural choices." -- this is the job posting rephrased back at them
- "My day-to-day stack is React, Next.js and TypeScript, used on a white-label telecom platform, a Shopify subscription storefront and a React Native delivery app." -- this is a resume dump, not a sentence
- "I am reaching out to express my interest in the [X] role at [Y]." -- template filler
- Sentences that are just facts with no connection to what came before: "Long-term remote contracts with UK and Spain-based companies, all tax and compliance handled on my side." dropped in mid-message with no setup is confusing and cold.

Cover letter rules:
- Slightly more formal than outreach but still human. Not stiff.
- Opening paragraph: hook with something specific about the role or the company's work. Not "I am applying for the X position."
- Body: two to three short paragraphs max. Specific evidence from the profile tied directly to what the job needs.
- If location could be a concern: one sentence stating the remote work history as a fact. Do not make it the focus.
- Closing: brief and confident. No "I look forward to discussing this opportunity with you."
- Do not use a formal letter header. Start directly with the content.${skipNote}

Return results ONLY via the record_application_materials tool.`;
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
