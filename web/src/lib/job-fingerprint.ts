/** Mirror of src/job-fingerprint.mjs for the web app. */

export function normalizeJobText(value: unknown): string {
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

export function jobFingerprint(
  title: unknown,
  company: unknown
): string | null {
  const t = normalizeJobText(title);
  const c = normalizeJobText(company);
  if (!t || !c) return null;
  return `${t}::${c}`;
}
