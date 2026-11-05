import { BadgeCheck, CircleDashed, TriangleAlert } from "lucide-react";
import type { DumpSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Stage 1: HTML already parsed into a dump vs still new. */
export function HtmlParseMark({
  parsed,
  className,
}: {
  parsed: boolean;
  className?: string;
}) {
  const hint = parsed ? "Already parsed" : "Not parsed yet";
  const Icon = parsed ? BadgeCheck : CircleDashed;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center", className)}
      title={hint}
      aria-label={hint}
    >
      <Icon
        className={cn(
          "size-3.5",
          parsed
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-muted-foreground"
        )}
      />
    </span>
  );
}

export type DumpHealth = "ok" | "partial" | "failed" | "empty";

/** Stage-2 style health from description / error counts. */
export function dumpFetchHealth(d: DumpSummary): DumpHealth {
  const total = d.jobCount ?? 0;
  const ok = d.detailsOk ?? 0;
  const failed = d.detailsFailed ?? 0;
  if (total <= 0) return "empty";
  if (failed > 0) return "failed";
  if (ok >= total) return "ok";
  if (ok > 0) return "partial";
  return "empty";
}

export function dumpFetchHint(d: DumpSummary): string {
  const total = d.jobCount ?? 0;
  const ok = d.detailsOk ?? 0;
  const failed = d.detailsFailed ?? 0;
  const pending = Math.max(0, total - ok - failed);
  if (total <= 0) return "No jobs";
  if (failed > 0) {
    return `${ok}/${total} fetched · ${failed} failed`;
  }
  if (ok >= total) return `${ok}/${total} fetched`;
  if (ok > 0) return `${ok}/${total} fetched · ${pending} pending`;
  return `${total} not fetched yet`;
}

/** Compact mark for dump lists (not a select checkbox). */
export function DumpHealthMark({
  dump,
  className,
}: {
  dump: DumpSummary;
  className?: string;
}) {
  const health = dumpFetchHealth(dump);
  const hint = dumpFetchHint(dump);
  const Icon =
    health === "ok"
      ? BadgeCheck
      : health === "failed"
        ? TriangleAlert
        : CircleDashed;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center", className)}
      title={hint}
      aria-label={hint}
    >
      <Icon
        className={cn(
          "size-3.5",
          health === "ok" && "text-emerald-600 dark:text-emerald-400",
          health === "failed" && "text-amber-600 dark:text-amber-400",
          (health === "partial" || health === "empty") &&
            "text-muted-foreground"
        )}
      />
    </span>
  );
}
