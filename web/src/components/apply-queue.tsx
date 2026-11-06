"use client";

import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import { CompanyLogo } from "@/components/company-logo";
import { DecisionBadge } from "@/components/decision-badge";
import { TRACK_STATUS_META } from "@/components/track-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ALL_DUMPS,
  type ApplyChannel,
  type JobRow,
  type TrackStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  ChevronDown,
  CircleHelp,
  Copy,
  ExternalLink,
  FileText,
  Lightbulb,
  MessageSquare,
  UserRound,
} from "lucide-react";

/* LinkedIn glyph — used by the commented LinkedIn CTA below; keep for restore.
function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}
*/

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

const TRACK_FILTERS = (Object.keys(TRACK_STATUS_META) as TrackStatus[]).map(
  (key) => ({
    key,
    label: TRACK_STATUS_META[key].label,
    icon: TRACK_STATUS_META[key].icon,
  }),
);

const STATUS_OPTIONS = (Object.keys(TRACK_STATUS_META) as TrackStatus[]).map(
  (value) => ({
    value,
    label: TRACK_STATUS_META[value].label,
    icon: TRACK_STATUS_META[value].icon,
  }),
);

const CHANNEL_OPTIONS: { value: ApplyChannel; label: string }[] = [
  { value: "easy_apply", label: "Easy Apply" },
  { value: "external", label: "External site" },
  { value: "message", label: "Message / DM" },
];

function effectiveTrack(job: JobRow): TrackStatus {
  return job.trackStatus || "todo";
}

export function ApplyQueue({
  jobs,
  dumpName,
  onOpenJob,
  onJobUpdated,
  loading = false,
}: {
  jobs: JobRow[];
  dumpName: string | null;
  onOpenJob: (job: JobRow) => void;
  onJobUpdated: (job: JobRow) => void;
  loading?: boolean;
}) {
  const triageQueue = useMemo(() => {
    const apply = jobs.filter((j) => j.decision === "apply");
    const maybe = jobs.filter((j) => j.decision === "maybe");
    const rank = (a: JobRow, b: JobRow) =>
      (b.fitScore ?? 0) - (a.fitScore ?? 0);
    return [...apply.sort(rank), ...maybe.sort(rank)];
  }, [jobs]);

  const [filter, setFilter] = useState<TrackStatus>("todo");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const counts = useMemo(() => {
    const c = { todo: 0, applied: 0, waiting: 0, closed: 0 };
    for (const j of triageQueue) {
      c[effectiveTrack(j)] += 1;
    }
    return c;
  }, [triageQueue]);

  const visible = useMemo(
    () => triageQueue.filter((j) => effectiveTrack(j) === filter),
    [triageQueue, filter],
  );

  async function patchTrack(
    job: JobRow,
    patch: {
      trackStatus?: TrackStatus | null;
      applyChannel?: ApplyChannel | null;
      trackNote?: string | null;
    },
  ) {
    const targetDump =
      dumpName && dumpName !== ALL_DUMPS
        ? dumpName
        : job.dumpName || null;
    if (!targetDump) {
      toast.error("Select a dump first");
      return;
    }
    setSavingId(String(job.id));
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(String(job.id))}/track`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dumpName: targetDump, ...patch }),
        },
      );
      const data = (await res.json()) as { job?: JobRow; error?: string };
      if (!res.ok || !data.job) {
        throw new Error(data.error || "Update failed");
      }
      onJobUpdated(data.job);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <ApplyQueueSkeleton />;
  }

  if (!triageQueue.length) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
        No apply/maybe jobs in this dump yet. Run Stage 3 (Pipeline tab), or
        open Triage to browse all jobs.
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
          {triageQueue.filter((j) => j.decision === "apply").length} apply
        </Badge>
        <Badge
          variant="outline"
          className="gap-1.5 border-transparent bg-amber-500/15 px-2.5 py-1 text-sm font-medium text-amber-900 dark:text-amber-200"
        >
          <CircleHelp className="size-3.5" aria-hidden />
          {triageQueue.filter((j) => j.decision === "maybe").length} maybe
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {TRACK_FILTERS.map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={filter === key ? "default" : "outline"}
            className="min-h-11 gap-1.5"
            onClick={() => setFilter(key)}
          >
            <Icon className="size-3.5" aria-hidden />
            {label} {counts[key]}
          </Button>
        ))}
      </div>

      {!visible.length ? (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
          No {filter} jobs in this dump.
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((job) => {
            const open = expanded === String(job.id);
            const outreach = job.materials?.outreachMessage?.trim();
            const cover = job.materials?.coverLetter?.trim();
            const recommendation = job.evaluation?.recommendation?.trim();
            const track = effectiveTrack(job);
            const noteValue =
              noteDrafts[String(job.id)] !== undefined
                ? noteDrafts[String(job.id)]
                : job.trackNote || "";
            const busy = savingId === String(job.id);

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
                      <Badge variant="outline" className="font-normal">
                        {job.easyApply ? (
                          <span className="inline-flex items-center gap-1">
                            <Briefcase className="size-3" aria-hidden />
                            Likely Easy Apply
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <ExternalLink className="size-3" aria-hidden />
                            Likely external site
                          </span>
                        )}
                      </Badge>
                    </div>
                    <h3 className="text-base font-semibold leading-snug">
                      {job.title || "Untitled"}
                    </h3>
                    <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                      <span>{[job.company, job.location].filter(Boolean).join(" · ")}</span>
                      {job.posterType === "agency" ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                          title="Posted by a recruitment agency — the actual employer may not be named"
                        >
                          <UserRound className="size-2.5" />
                          Agency
                        </span>
                      ) : null}
                    </p>
                    {job.dumpName ? (
                      <p className="truncate font-mono text-[10px] text-muted-foreground/80">
                        {job.dumpName}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        Your status
                      </p>
                      <Select
                        value={track}
                        disabled={busy}
                        onValueChange={(v) => {
                          if (!v) return;
                          const next = v as TrackStatus;
                          void patchTrack(job, {
                            trackStatus: next,
                            applyChannel:
                              next === "applied" && !job.applyChannel
                                ? job.easyApply
                                  ? "easy_apply"
                                  : "external"
                                : job.applyChannel,
                          });
                        }}
                      >
                        <SelectTrigger
                          className={cn(
                            "min-h-11 w-full border-transparent font-medium",
                            TRACK_STATUS_META[track].className,
                          )}
                        >
                          <SelectValue>
                            {(value) => {
                              const status = (value as TrackStatus) || track;
                              const meta = TRACK_STATUS_META[status];
                              const Icon = meta.icon;
                              return (
                                <span className="inline-flex items-center gap-2">
                                  <Icon
                                    className="size-3.5 shrink-0"
                                    aria-hidden
                                  />
                                  {meta.label}
                                </span>
                              );
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((opt) => {
                            const Icon = opt.icon;
                            return (
                              <SelectItem key={opt.value} value={opt.value}>
                                <span className="inline-flex items-center gap-2">
                                  <Icon
                                    className="size-3.5 shrink-0"
                                    aria-hidden
                                  />
                                  {opt.label}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    {(track === "applied" ||
                      track === "waiting" ||
                      job.applyChannel) && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          Channel
                        </p>
                        <Select
                          value={job.applyChannel ?? null}
                          disabled={busy}
                          onValueChange={(v) => {
                            if (!v) return;
                            void patchTrack(job, {
                              applyChannel: v as ApplyChannel,
                            });
                          }}
                        >
                          <SelectTrigger className="min-h-11 w-full font-medium">
                            <SelectValue placeholder="How you applied…">
                              {(value) => {
                                const ch = value as ApplyChannel | null;
                                const opt = CHANNEL_OPTIONS.find(
                                  (o) => o.value === ch,
                                );
                                if (!opt) {
                                  return (
                                    <span className="text-muted-foreground">
                                      How you applied…
                                    </span>
                                  );
                                }
                                return (
                                  <span className="inline-flex items-center gap-2">
                                    {opt.value === "easy_apply" ? (
                                      <Briefcase
                                        className="size-3.5 shrink-0"
                                        aria-hidden
                                      />
                                    ) : opt.value === "external" ? (
                                      <ExternalLink
                                        className="size-3.5 shrink-0"
                                        aria-hidden
                                      />
                                    ) : (
                                      <MessageSquare
                                        className="size-3.5 shrink-0"
                                        aria-hidden
                                      />
                                    )}
                                    {opt.label}
                                  </span>
                                );
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {CHANNEL_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                <span className="inline-flex items-center gap-2">
                                  {opt.value === "easy_apply" ? (
                                    <Briefcase
                                      className="size-3.5 shrink-0"
                                      aria-hidden
                                    />
                                  ) : opt.value === "external" ? (
                                    <ExternalLink
                                      className="size-3.5 shrink-0"
                                      aria-hidden
                                    />
                                  ) : (
                                    <MessageSquare
                                      className="size-3.5 shrink-0"
                                      aria-hidden
                                    />
                                  )}
                                  {opt.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <Input
                    className="min-h-11"
                    placeholder="Note (optional)"
                    value={noteValue}
                    disabled={busy}
                    onChange={(e) =>
                      setNoteDrafts((d) => ({
                        ...d,
                        [String(job.id)]: e.target.value,
                      }))
                    }
                    onBlur={() => {
                      const next = noteValue.trim();
                      const prev = (job.trackNote || "").trim();
                      if (next !== prev) {
                        void patchTrack(job, { trackNote: next || null });
                      }
                    }}
                  />
                </div>

                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                  {(() => {
                    // Prefer company/ATS URL when Stage 2 found one; else LinkedIn job page.
                    const href = job.applyUrl || job.url || null;
                    if (!href) return <span />;
                    const easy = Boolean(job.easyApply);
                    const onSite = Boolean(job.applyUrl) && !easy;
                    const label = easy
                      ? "Easy Apply"
                      : onSite
                        ? "Apply on site"
                        : "Open job";
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg bg-foreground px-3 text-sm font-medium whitespace-nowrap text-background hover:opacity-90"
                      >
                        {easy ? (
                          <Briefcase className="size-4 shrink-0" aria-hidden />
                        ) : (
                          <ExternalLink className="size-4 shrink-0" aria-hidden />
                        )}
                        {label}
                      </a>
                    );
                  })()}
                  {/* Blue LinkedIn CTA — kept for easy restore if we want a dedicated LI button again.
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
                  */}
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
                    onClick={() => setExpanded(open ? null : String(job.id))}
                  >
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 transition-transform duration-200",
                        open && "rotate-180",
                      )}
                      aria-hidden
                    />
                    {open ? "Hide" : "Materials"}
                  </Button>
                </div>

                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-out",
                    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    <div
                      className={cn(
                        "mt-3 space-y-3 border-t pt-3 transition-opacity duration-200",
                        open ? "opacity-100" : "opacity-0",
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
                              onClick={() =>
                                void copyText("outreach", outreach)
                              }
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
                              onClick={() =>
                                void copyText("cover letter", cover)
                              }
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
                          No materials yet (skipped generate or not
                          apply/maybe).
                        </p>
                      ) : null}
                      {recommendation ? (
                        <MaterialSection
                          title="Why this decision"
                          icon={Lightbulb}
                        >
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
      )}
    </div>
  );
}
