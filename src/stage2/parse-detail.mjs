/**
 * Extract job description (and light metadata) from a saved LinkedIn job detail HTML.
 */

/** Decode common HTML entities. */
export function decodeEntities(s) {
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
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTagsKeepBreaks(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const GENERIC_LINKEDIN_BLURB =
  /1 billion members|manage your professional identity/i;

function hasJobBody(html) {
  return (
    /JobPosting/i.test(html) ||
    /description__text/i.test(html) ||
    /show-more-less-html__markup/i.test(html) ||
    />\s*About the job\s*</i.test(html)
  );
}

/**
 * Detect hard login wall / empty guest shell / real bot challenge.
 * Note: LinkedIn pages often mention "recaptcha" in config attributes even on
 * successful job views — that alone is NOT a challenge.
 */
export function looksLikeChallenge(html) {
  const title = (html.match(/<title>([^<]+)<\/title>/i) || [, ""])[1];
  if (/log\s*in or sign up/i.test(title)) return true;

  // Real interstitial / block pages (not routine job HTML)
  if (
    /challenge-form|security check|unusual traffic|\/authwall|cf-challenge|px-captcha/i.test(
      html.slice(0, 120_000)
    )
  ) {
    // Still allow if a full job body is clearly present behind an overlay
    if (!hasJobBody(html)) return true;
  }

  // Login marketing page with no job body
  if (GENERIC_LINKEDIN_BLURB.test(html) && !hasJobBody(html)) {
    return true;
  }

  return false;
}

function isBogusDescription(text) {
  if (!text || text.length < 60) return true;
  if (GENERIC_LINKEDIN_BLURB.test(text) && text.length < 400) return true;
  if (/sign in to view|join linkedin|agree.?&? ?join/i.test(text) && text.length < 400)
    return true;
  return false;
}

function fromJsonLd(html) {
  const blocks = [...html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )];
  for (const m of blocks) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const graph = node["@graph"] || [node];
        for (const g of graph) {
          const type = g["@type"];
          const isJob =
            type === "JobPosting" ||
            (Array.isArray(type) && type.includes("JobPosting"));
          if (!isJob) continue;
          const description = g.description
            ? stripTagsKeepBreaks(String(g.description))
            : null;
          return {
            title: g.title || null,
            company:
              (g.hiringOrganization && g.hiringOrganization.name) || null,
            description,
          };
        }
      }
    } catch {
      // ignore bad JSON-LD
    }
  }
  return null;
}

function fromOgDescription(html) {
  const m = html.match(
    /property=["']og:description["'][^>]*content=["']([^"']+)["']/i
  ) || html.match(
    /content=["']([^"']+)["'][^>]*property=["']og:description["']/i
  );
  if (!m) return null;
  const t = cleanText(m[1]);
  return t.length > 80 ? t : null;
}

function fromAboutTheJob(html) {
  // Classic public job page
  const classic = html.match(
    /class=["'][^"']*description__text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  if (classic) {
    const t = stripTagsKeepBreaks(classic[1]);
    if (t.length > 80) return t;
  }

  const showMore = html.match(
    /class=["'][^"']*show-more-less-html__markup[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  if (showMore) {
    const t = stripTagsKeepBreaks(showMore[1]);
    if (t.length > 80) return t;
  }

  // SDUI / dump style: "About the job" then following content
  const aboutIdx = html.search(/>\s*About the job\s*</i);
  if (aboutIdx >= 0) {
    const slice = html.slice(aboutIdx, aboutIdx + 40_000);
    // Prefer contiguous paragraph-ish blocks after the heading
    const paras = [...slice.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripTagsKeepBreaks(m[1]))
      .filter((t) => t.length > 40);
    if (paras.length) {
      const joined = paras.slice(0, 40).join("\n\n");
      if (joined.length > 80) return joined;
    }
    const texty = stripTagsKeepBreaks(slice).replace(/^About the job\s*/i, "");
    if (texty.length > 120) return texty.slice(0, 20_000);
  }

  return null;
}

function fromTitleTag(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) return { title: null, company: null };
  const raw = cleanText(m[1]);
  // "Title | Company | LinkedIn"
  const parts = raw.split("|").map((p) => p.trim());
  if (parts.length >= 2 && !/^linkedin$/i.test(parts[0])) {
    return {
      title: parts[0] || null,
      company: parts[1] && !/^linkedin$/i.test(parts[1]) ? parts[1] : null,
    };
  }
  return { title: raw.replace(/\s*\|\s*LinkedIn$/i, "") || null, company: null };
}

/**
 * @param {string} html
 * @returns {{ title: string|null, company: string|null, description: string|null, challenged: boolean }}
 */
export function parseDetailHtml(html) {
  const challenged = looksLikeChallenge(html);
  const fromLd = fromJsonLd(html);
  const titleBits = fromTitleTag(html);

  let description =
    (fromLd && fromLd.description) ||
    fromAboutTheJob(html) ||
    fromOgDescription(html) ||
    null;

  if (isBogusDescription(description)) description = null;

  let title = (fromLd && fromLd.title) || titleBits.title;
  let company = (fromLd && fromLd.company) || titleBits.company;
  if (title && /log\s*in or sign up/i.test(title)) title = null;

  return {
    title,
    company,
    description,
    // Only flag challenge when we lack a usable description
    challenged: !description && (challenged || looksLikeChallenge(html)),
  };
}

export default parseDetailHtml;
