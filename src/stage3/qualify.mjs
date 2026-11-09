/**
 * Deterministic hard-eligibility filters (no API).
 * Separates eligibility from later Claude technical fit.
 */

const REMOTE_OK =
  /\b(remote|work from home|wfh|fully remote|worldwide|anywhere|distributed)\b/i;
const INTERNATIONAL_OK =
  /\b(international|worldwide|anywhere in the world|global remote|hire (from )?anywhere|remote[- ]first|contractor|freelance|outside (the )?(uk|us|united states|united kingdom))\b/i;
const ONSITE_OR_HYBRID =
  /\b(on-?site|onsite|in-?office|hybrid|days? (a|per) week in (the )?office|office[- ]based)\b/i;
const UK_ONLY_RTW =
  /\b(must (have|be)|only candidates with).{0,40}(right to work|uk (work )?visa|based in the uk|uk resident)\b/i;
const US_ONLY =
  /\b(must be (located|based) in the (us|united states)|us (citizens?|persons?) only|require.{0,20}us work authorization)\b/i;
const CLEARANCE =
  /\b(sc cleared|security clearance|dv cleared|must hold clearance)\b/i;
const AGENCY_SIGNAL =
  /\b(recruitment agency|recruiting partner|on behalf of (our )?client|our client is|my client (is|seeks|want)|no agencies please)\b/i;

/** Catch recruiter language in company name itself (without needing description). */
const AGENCY_COMPANY_RE =
  /\b(?:recruitment|resourcing|staffing|talent\s*hop|headhunt|hiring\s*partner|consult(?:ing|ancy)|placements?|search\s*firm)\b/i;

/**
 * @param {object} job merged job
 * @param {object} [prefs] optional parsed preference hints
 */
export function qualifyJob(job, prefs = {}) {
  const reasons = [];
  const text = [job.title, job.location, job.salary, job.description]
    .filter(Boolean)
    .join("\n");

  if (!job.hasDescription) {
    return {
      eligibility: "fail",
      decision: "skip",
      reasons: ["missing_description"],
      signals: {},
    };
  }

  const location = job.location || "";
  const remoteInLocation = /\(.*remote.*\)|remote/i.test(location);
  const remoteInText = REMOTE_OK.test(text) || remoteInLocation;
  const international = INTERNATIONAL_OK.test(text);
  const onsiteHybrid = ONSITE_OR_HYBRID.test(text);
  const ukRtw = UK_ONLY_RTW.test(text);
  const usOnly = US_ONLY.test(text);
  const clearance = CLEARANCE.test(text);
  const agency =
    AGENCY_SIGNAL.test(text) || AGENCY_COMPANY_RE.test(job.company || "");

  const signals = {
    remoteInLocation,
    remoteInText,
    international,
    onsiteHybrid,
    ukRtw,
    usOnly,
    clearance,
    agency,
  };

  // Algeria-based candidate: fail hard UK/US local-only without remote/international
  if (prefs.blockClearance !== false && clearance) {
    reasons.push("security_clearance_required");
  }

  // Location-based checks: only hard-fail when the job is NOT remote.
  // If a job is remote but has geographic preferences (e.g. "EU only"), that is
  // a signal the candidate handles in outreach -- not a disqualifier.
  if (usOnly && !international && !remoteInText) {
    reasons.push("us_local_authorization_required");
  } else if (usOnly && remoteInText && !international) {
    // Remote but US-preferred -- flag as a soft warning in signals, not a fail
    signals.locationRiskRemote = true;
  }

  if (ukRtw && !international && !remoteInText) {
    reasons.push("uk_right_to_work_emphasized");
  } else if (ukRtw && remoteInText && !international) {
    signals.locationRiskRemote = true;
  }

  // Hybrid/on-site in UK/US city without remote/international → fail
  const ukUsGeo =
    /\b(united kingdom|england|scotland|wales|london|manchester|leeds|bristol|united states|\bUSA\b|\bUS\b|new york|san francisco|california)\b/i.test(
      text
    );
  if (onsiteHybrid && ukUsGeo && !remoteInText && !international) {
    reasons.push("onsite_or_hybrid_without_remote_international");
  }

  // Location says (On-site) only
  if (/\(.*on-?site.*\)/i.test(location) && !remoteInText && !international) {
    reasons.push("location_marked_onsite");
  }

  if (prefs.blockAgencies && agency && !/no agencies please/i.test(text)) {
    // "no agencies please" is employer saying no agencies — OK
    reasons.push("agency_listing");
  }

  // Title hard mismatches from prefs keywords
  const avoid = prefs.avoidTitlePatterns || [
    /\bhead of finance\b/i,
    /\binvestor relations\b/i,
    /\bcontent creator\b/i,
    /\bsocial media\b/i,
    /\bproject\/?\s*account manager\b/i,
  ];
  for (const re of avoid) {
    if (re.test(job.title || "")) {
      reasons.push(`title_mismatch:${re.source}`);
      break;
    }
  }

  const eligibility = reasons.length ? "fail" : "pass";
  return {
    eligibility,
    decision: eligibility === "fail" ? "skip" : null,
    reasons,
    signals,
  };
}

export function qualifyAll(jobs, prefs = {}) {
  return jobs.map((job) => ({
    ...job,
    qualify: qualifyJob(job, prefs),
  }));
}

export default qualifyJob;
