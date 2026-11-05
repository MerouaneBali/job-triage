"use client";

import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import { CompanyLogo } from "@/components/company-logo";
import { DecisionBadge } from "@/components/decision-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { JobRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  ChevronDown,
  CircleHelp,
  Copy,
  FileText,
  Lightbulb,
  MessageSquare,
} from "lucide-react";

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

async function copyText(label: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  } catch {
    toast.error("Copy failed");
  }
}

function MaterialSection({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

function ApplyQueueSkeleton() {
  return (
    <ul className="space-y-3" aria-busy="true" aria-label="Loading jobs">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex gap-3">
            <Skeleton className="size-12 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-14" />
              </div>
              <Skeleton className="h-5 w-3/4 max-w-sm" />
              <Skeleton className="h-4 w-1/2 max-w-[200px]" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Skeleton className="h-11 w-36" />
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-28" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ApplyQueue({
  jobs,
  onOpenJob,
  loading = false,
}: {
  jobs: JobRow[];
  onOpenJob: (job: JobRow) => void;
  loading?: boolean;
}) {
  const queue = useMemo(() => {
    const apply = jobs.filter((j) => j.decision === "apply");
    const maybe = jobs.filter((j) => j.decision === "maybe");
    const rank = (a: JobRow, b: JobRow) => (b.fitScore ?? 0) - (a.fitScore ?? 0);
    return [...apply.sort(rank), ...maybe.sort(rank)];
  }, [jobs]);

  const [expanded, setExpanded] = useState<string | null>(null);

  const applyCount = queue.filter((j) => j.decision === "apply").length;
  const maybeCount = queue.filter((j) => j.decision === "maybe").length;

  if (loading) {
    return <ApplyQueueSkeleton />;
  }

  if (!queue.length) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
        No apply/maybe jobs in this dump yet. Run Stage 3 (Pipeline tab), or open
        Triage to browse all jobs.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge
          variant="outline"
          className="gap-1.5 border-transparent bg-emerald-600/15 px-2.5 py-1 text-sm font-medium text-emerald-800 dark:text-emerald-300"
        >
          <Briefcase className="size-3.5" aria-hidden />
          {applyCount} apply
        </Badge>
        <Badge
          variant="outline"
          className="gap-1.5 border-transparent bg-amber-500/15 px-2.5 py-1 text-sm font-medium text-amber-900 dark:text-amber-200"
        >
          <CircleHelp className="size-3.5" aria-hidden />
          {maybeCount} maybe
        </Badge>
      </div>
      <ul className="space-y-3">
        {queue.map((job) => {
          const open = expanded === String(job.id);
          const outreach = job.materials?.outreachMessage?.trim();
          const cover = job.materials?.coverLetter?.trim();
          const recommendation = job.evaluation?.recommendation?.trim();
          return (
            <li
              key={job.id}
              className="rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="flex gap-3">
                <CompanyLogo
                  src={job.logoUrl}
                  company={job.company}
                  className="size-12"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <DecisionBadge decision={job.decision ?? null} />
                    {job.fitScore != null ? (
                      <Badge variant="secondary">Score {job.fitScore}</Badge>
                    ) : null}
                  </div>
                  <h3 className="text-base font-semibold leading-snug">
                    {job.title || "Untitled"}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {[job.company, job.location].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                {job.url ? (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg bg-[#0A66C2] px-3 text-sm font-medium whitespace-nowrap text-white hover:bg-[#004182]"
                  >
                    <LinkedInIcon className="size-4 shrink-0" />
                    <span className="md:hidden">LinkedIn</span>
                    <span className="hidden md:inline">Open LinkedIn</span>
                  </a>
                ) : (
                  <span />
                )}
                <Button
                  variant="outline"
                  className="min-h-11 shrink-0"
                  onClick={() => onOpenJob(job)}
                >
                  Details
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11 shrink-0 gap-1.5 whitespace-nowrap"
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded(open ? null : String(job.id))
                  }
                >
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 transition-transform duration-200",
                      open && "rotate-180"
                    )}
                    aria-hidden
                  />
                  {open ? "Hide" : "Materials"}
                </Button>
              </div>

              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                )}
              >
                <div className="overflow-hidden">
                  <div
                    className={cn(
                      "mt-3 space-y-3 border-t pt-3 transition-opacity duration-200",
                      open ? "opacity-100" : "opacity-0"
                    )}
                  >
                    {outreach ? (
                      <MaterialSection
                        title="Outreach"
                        icon={MessageSquare}
                        action={
                          <Button
                            size="sm"
                            variant="secondary"
                            className="min-h-11"
                            onClick={() => void copyText("outreach", outreach)}
                          >
                            <Copy data-icon="inline-start" />
                            Copy
                          </Button>
                        }
                      >
                        <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                          {outreach}
                        </p>
                      </MaterialSection>
                    ) : null}
                    {cover ? (
                      <MaterialSection
                        title="Cover letter"
                        icon={FileText}
                        action={
                          <Button
                            size="sm"
                            variant="secondary"
                            className="min-h-11"
                            onClick={() => void copyText("cover letter", cover)}
                          >
                            <Copy data-icon="inline-start" />
                            Copy
                          </Button>
                        }
                      >
                        <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                          {cover}
                        </p>
                      </MaterialSection>
                    ) : null}
                    {!outreach && !cover ? (
                      <p className="text-sm text-muted-foreground">
                        No materials yet (skipped generate or not apply/maybe).
                      </p>
                    ) : null}
                    {recommendation ? (
                      <MaterialSection title="Why this decision" icon={Lightbulb}>
                        <p className="rounded-md border border-sky-500/20 bg-sky-50/80 p-3 text-sm leading-relaxed whitespace-pre-wrap dark:bg-sky-950/30">
                          {recommendation}
                        </p>
                      </MaterialSection>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
