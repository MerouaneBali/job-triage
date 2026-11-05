/**
 * Normalize job title/company for duplicate detection across dumps / reposts.
 */

export function normalizeJobText(value) {
  if (value == null) return "";
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Stable fingerprint: normalized title + company. Empty parts → null. */
export function jobFingerprint(title, company) {
  const t = normalizeJobText(title);
  const c = normalizeJobText(company);
  if (!t || !c) return null;
  return `${t}::${c}`;
}

export default jobFingerprint;
