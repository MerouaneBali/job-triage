import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Next `basePath` (e.g. `/job-triage`). Empty string if served at domain root. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a root-relative app path with `basePath` for fetch / EventSource / SW. */
export function withBasePath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!BASE_PATH) return p;
  if (p === BASE_PATH || p.startsWith(`${BASE_PATH}/`)) return p;
  return `${BASE_PATH}${p}`;
}
