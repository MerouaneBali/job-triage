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
  if (!m) return { title: null, company: null, location: null };
  // Strip leading notification count like "(1) Job Title | …"
  let raw = cleanText(m[1]).replace(/^\(\d+\)\s*/, "");
  const isLinkedInPart = (s) => /^linkedin(\s+jobs)?$/i.test(s.trim());

  // Pattern A: "Title at Company — Location | LinkedIn Jobs"
  //   e.g. "Full Stack Engineer at Entefy — United States | LinkedIn Jobs"
  const atPattern = raw.match(
    /^(.+?)\s+at\s+(.+?)\s+[—–-]\s+(.+?)\s*\|\s*LinkedIn/i
  );
  if (atPattern) {
    return {
      title: atPattern[1].trim() || null,
      company: atPattern[2].trim() || null,
      location: atPattern[3].trim() || null,
    };
  }

  // Pattern B: "Title | Company | LinkedIn" or "Title | LinkedIn Jobs"
  const parts = raw.split("|").map((p) => p.trim());
  if (parts.length >= 2 && !isLinkedInPart(parts[0])) {
    return {
      title: parts[0] || null,
      company: parts[1] && !isLinkedInPart(parts[1]) ? parts[1] : null,
      location: null,
    };
  }

  return {
    title: raw.replace(/\s*\|\s*LinkedIn(\s+Jobs)?$/i, "").trim() || null,
    company: null,
    location: null,
  };
}

/** Extract company logo URL from LinkedIn detail page HTML. */
function extractLogoUrl(html) {
  // 1. Any <img src="…media.licdn.com/dms/image/…company-logo…">
  //    This is the most reliable pattern seen in real LinkedIn detail pages.
  //    The URL contains "company-logo" in the path, distinguishing it from
  //    profile photos, icons, etc.
  const companyLogoSrc = html.match(
    /src="(https?:\/\/media\.licdn\.com\/dms\/image\/[^"]*company-logo[^"]*)"/i
  );
  if (companyLogoSrc?.[1]) return decodeHref(companyLogoSrc[1]);

  // 2. artdeco-entity-image with any media.licdn.com src (fallback)
  const artdeco = html.match(
    /class="[^"]*artdeco-entity-image[^"]*"[^>]*src="(https?:\/\/media\.licdn\.com\/[^"]+)"/i
  ) || html.match(
    /src="(https?:\/\/media\.licdn\.com\/[^"]+)"[^>]*class="[^"]*artdeco-entity-image[^"]*"/i
  );
  if (artdeco?.[1] && !artdeco[1].includes("ghost") && !artdeco[1].includes("aero-v1")) {
    return decodeHref(artdeco[1]);
  }

  // 3. JSON: "logoUrls":["https://..."]
  const logoUrls = html.match(/"logoUrls"\s*:\s*\["(https?:\/\/[^"]+)"/i);
  if (logoUrls?.[1]) return logoUrls[1];

  return null;
}

/** Extract job location from LinkedIn detail page HTML. */
function extractLocation(html) {
  // 1. JSON-LD: jobLocation
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
          const isJob = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
          if (!isJob) continue;
          const loc = g.jobLocation;
          if (!loc) continue;
          if (typeof loc === "string" && loc.length > 2) return loc;
          const addr = loc.address || (Array.isArray(loc) && loc[0]?.address);
          if (!addr) continue;
          const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
            .filter(Boolean);
          if (parts.length) return parts.join(", ");
        }
      }
    } catch {}
  }

  // 2. HTML patterns — bullet spans use multi-line capture (content is on separate lines)
  const bulletClasses = [
    "topcard__flavor--bullet",
    "top-card-layout__bullet",
    "jobs-unified-top-card__bullet",
    "job-details-jobs-unified-top-card__primary-description",
  ];
  for (const cls of bulletClasses) {
    const re = new RegExp(
      `class="[^"]*${cls}[^"]*"[^>]*>[\\s\\S]{0,10}?([\\w][^<]{2,100}?)\\s*<`,
      "i"
    );
    const m = html.match(re);
    if (m?.[1]) {
      const loc = cleanText(m[1]).trim();
      if (
        loc.length > 2 &&
        !/^(linkedin|see more|full-time|part-time|contract|hybrid|on-?site|remote|\d+ applicant)/i.test(loc)
      ) {
        return loc;
      }
    }
  }

  // 3. JSON: "formattedLocation":"..."
  const fmtLoc = html.match(/"formattedLocation"\s*:\s*"([^"]{3,120})"/i);
  if (fmtLoc?.[1]) return fmtLoc[1];

  return null;
}

function decodeHref(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/");
}

function isLinkedInHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "linkedin.com" || host.endsWith(".linkedin.com") || host.includes("licdn.com");
  } catch {
    return true;
  }
}

/** Company / ATS apply URL when LinkedIn exposes it (often missing on guest HTML). */
export function extractApplyUrl(html) {
  const patterns = [
    /"(?:externalApplicationUrl|companyApplyUrl|applyUrl|applicationUrl)"\s*:\s*"(https?:\\\/\\\/[^"]+|https?:\/\/[^"]+)"/i,
    /(?:externalApplicationUrl|companyApplyUrl|applyUrl)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const url = decodeHref(m[1].replace(/\\\//g, "/"));
      if (/^https?:\/\//i.test(url) && !isLinkedInHost(url)) return url;
    }
  }
  // Rare: offsite apply <a href="https://company...">
  for (const m of html.matchAll(
    /href=["'](https?:\/\/[^"']+)["'][^>]*(?:offsite|external|company-apply|jobs_apply)/gi
  )) {
    const url = decodeHref(m[1]);
    if (!isLinkedInHost(url)) return url;
  }
  for (const m of html.matchAll(
    /(?:offsite|external|company-apply|jobs_apply)[^>]*href=["'](https?:\/\/[^"']+)["']/gi
  )) {
    const url = decodeHref(m[1]);
    if (!isLinkedInHost(url)) return url;
  }
  return null;
}

/**
 * @param {string} html
 * @returns {{ title: string|null, company: string|null, location: string|null, logoUrl: string|null, description: string|null, applyUrl: string|null, challenged: boolean }}
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
  if (title && /log\s*in or sign up/i.test(title)) title = null;

  // Company: JSON-LD > title-tag > HTML sub-nav anchor > logo alt text
  let company = (fromLd && fromLd.company) || titleBits.company;
  if (!company) {
    // sub-nav-cta__optional-url title attr (most reliable for guest pages)
    const subNav =
      html.match(/class="[^"]*sub-nav-cta__optional-url[^"]*"[^>]*title="([^"]{2,80})"/i) ||
      html.match(/title="([^"]{2,80})"[^>]*class="[^"]*sub-nav-cta__optional-url[^"]*"/i);
    if (subNav?.[1]) company = subNav[1];
  }
  if (!company) {
    // company logo alt attribute on artdeco-entity-image (second-best)
    const logoAlt = html.match(
      /class="[^"]*artdeco-entity-image[^"]*"[^>]*alt="([^"]{2,80})"/i
    ) || html.match(
      /alt="([^"]{2,80})"[^>]*class="[^"]*artdeco-entity-image[^"]*"/i
    );
    if (logoAlt?.[1]) company = logoAlt[1];
  }
  // Reject any LinkedIn brand name that leaked through
  if (company && /^linkedin(\s+jobs)?$/i.test(company.trim())) company = null;

  // Location: try HTML extraction first, fall back to title-tag location
  const location = extractLocation(html) || titleBits.location || null;

  return {
    title,
    company,
    location,
    logoUrl: extractLogoUrl(html),
    description,
    applyUrl: extractApplyUrl(html),
    // Only flag challenge when we lack a usable description
    challenged: !description && (challenged || looksLikeChallenge(html)),
  };
}

export default parseDetailHtml;
