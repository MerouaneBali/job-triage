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
  Copy,
  ExternalLink,
  FileText,
  Info,
  Lightbulb,
  MessageSquare,
  PenLine,
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
  const [noteOpen, setNoteOpen] = useState<Set<string>>(() => new Set());

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

  const applyCount = triageQueue.filter((j) => j.decision === "apply").length;
  const maybeCount = triageQueue.filter((j) => j.decision === "maybe").length;

  return (
    <div className="space-y-3">
      {/* Summary line */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{triageQueue.length}</span>
        <span>jobs</span>
        <span className="text-muted-foreground/30">·</span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="font-medium text-emerald-700 dark:text-emerald-400">{applyCount} apply</span>
        </span>
        <span className="text-muted-foreground/30">·</span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-amber-500" />
          <span className="font-medium text-amber-700 dark:text-amber-400">{maybeCount} maybe</span>
        </span>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {TRACK_FILTERS.map(({ key, label, icon: Icon }) => {
          const active = filter === key;
          const count = counts[key];
          const meta = TRACK_STATUS_META[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
                active
                  ? cn(meta.className, "shadow-sm")
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                count === 0 && !active && "opacity-40",
              )}
            >
              <Icon className="size-3 shrink-0" aria-hidden />
              {label}
              <span
                className={cn(
                  "min-w-[14px] text-center tabular-nums text-[10px] font-semibold",
                  active ? "opacity-70" : "",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
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

            // Prefer company/ATS URL when Stage 2 found one; else LinkedIn job page.
            const jobHref = job.applyUrl || job.url || null;
            const isEasyApply = Boolean(job.easyApply);
            const noteIsOpen = noteOpen.has(String(job.id));

            return (
              <li
                key={job.id}
                className="overflow-hidden rounded-xl border bg-card shadow-sm"
              >
                {/* ── HEADER ─────────────────────────────────── */}
                <div className="flex gap-3 p-4 pb-3">
                  {/* Logo — fixed square, cover-fit so all logos look uniform */}
                  <div className="size-11 shrink-0 overflow-hidden rounded-lg bg-muted">
                    <CompanyLogo
                      src={job.logoUrl}
                      company={job.company}
                      className="size-11"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Title + open-job button (top-right, primary CTA) */}
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold leading-snug">
                        {job.title || "Untitled"}
                      </h3>
                      {jobHref ? (
                        <a
                          href={jobHref}
                          target="_blank"
                          rel="noreferrer"
                          title={isEasyApply ? "Easy Apply" : "Open job posting"}
                          className="inline-flex shrink-0 items-center justify-center rounded-full bg-foreground p-1.5 text-background transition-opacity hover:opacity-75"
                        >
                          {isEasyApply ? (
                            <Briefcase className="size-3" aria-hidden />
                          ) : (
                            <ExternalLink className="size-3" aria-hidden />
                          )}
                        </a>
                      ) : null}
                    </div>

                    {/* Company · Location + dump info icon */}
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate">
                        {[job.company, job.location].filter(Boolean).join(" · ")}
                      </span>
                      {job.dumpName ? (
                        <span
                          className="shrink-0 cursor-default text-muted-foreground/40 hover:text-muted-foreground"
                          title={`From: ${job.dumpName}`}
                        >
                          <Info className="size-3" aria-hidden />
                        </span>
                      ) : null}
                    </p>

                    {/* Badges row */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <DecisionBadge decision={job.decision ?? null} />
                      {job.fitScore != null ? (
                        <Badge variant="secondary" className="text-[11px]">
                          {job.fitScore}
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="text-[11px] font-normal">
                        {isEasyApply ? (
                          <span className="inline-flex items-center gap-1">
                            <Briefcase className="size-2.5" aria-hidden />
                            Easy Apply
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <ExternalLink className="size-2.5" aria-hidden />
                            External
                          </span>
                        )}
                      </Badge>
                      {job.posterType === "agency" ? (
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-50 text-[11px] font-normal text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                          title="Posted by a recruitment agency"
                        >
                          <UserRound className="size-2.5" aria-hidden />
                          Agency
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* ── FOOTER ROW ─────────────────────────────── */}
                <div className="flex items-center gap-1 border-t px-3 py-1.5">
                  {/* Status select */}
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
                        "h-6 w-auto shrink-0 rounded-full border-transparent px-2.5 text-[11px] font-medium",
                        TRACK_STATUS_META[track].className,
                      )}
                    >
                      <SelectValue>
                        {(value) => {
                          const status = (value as TrackStatus) || track;
                          const meta = TRACK_STATUS_META[status];
                          const Icon = meta.icon;
                          return (
                            <span className="inline-flex items-center gap-1">
                              <Icon className="size-3 shrink-0" aria-hidden />
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
                              <Icon className="size-3.5 shrink-0" aria-hidden />
                              {opt.label}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>

                  {/* Channel select — only when relevant */}
                  {(track === "applied" || track === "waiting" || job.applyChannel) ? (
                    <Select
                      value={job.applyChannel ?? null}
                      disabled={busy}
                      onValueChange={(v) => {
                        if (!v) return;
                        void patchTrack(job, { applyChannel: v as ApplyChannel });
                      }}
                    >
                      <SelectTrigger className="h-6 w-auto shrink-0 rounded-full px-2.5 text-[11px] font-medium">
                        <SelectValue placeholder="Channel…">
                          {(value) => {
                            const ch = value as ApplyChannel | null;
                            const opt = CHANNEL_OPTIONS.find((o) => o.value === ch);
                            if (!opt) return <span className="text-muted-foreground">Channel…</span>;
                            return (
                              <span className="inline-flex items-center gap-1">
                                {opt.value === "easy_apply" ? (
                                  <Briefcase className="size-2.5 shrink-0" aria-hidden />
                                ) : opt.value === "external" ? (
                                  <ExternalLink className="size-2.5 shrink-0" aria-hidden />
                                ) : (
                                  <MessageSquare className="size-2.5 shrink-0" aria-hidden />
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
                                <Briefcase className="size-3.5 shrink-0" aria-hidden />
                              ) : opt.value === "external" ? (
                                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                              ) : (
                                <MessageSquare className="size-3.5 shrink-0" aria-hidden />
                              )}
                              {opt.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  {/* Note toggle */}
                  <button
                    type="button"
                    title={noteValue ? `Note: ${noteValue}` : "Add note"}
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted",
                      noteIsOpen
                        ? "bg-muted text-foreground"
                        : noteValue
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    )}
                    onClick={() =>
                      setNoteOpen((prev) => {
                        const next = new Set(prev);
                        next.has(String(job.id)) ? next.delete(String(job.id)) : next.add(String(job.id));
                        return next;
                      })
                    }
                  >
                    <PenLine className="size-3" aria-hidden />
                  </button>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Details */}
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => onOpenJob(job)}
                  >
                    Details
                  </button>

                  {/* Materials toggle — fixed label, only chevron rotates */}
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : String(job.id))}
                  >
                    Materials
                    <ChevronDown
                      className={cn(
                        "size-3 shrink-0 transition-transform duration-200",
                        open && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                </div>

                {/* ── NOTE EXPAND ────────────────────────────── */}
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-150 ease-out",
                    noteIsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="border-t px-3 py-2">
                      <Input
                        className="h-8 text-xs"
                        placeholder="Note (optional)"
                        value={noteValue}
                        disabled={busy}
                        autoFocus={noteIsOpen}
                        onChange={(e) =>
                          setNoteDrafts((d) => ({ ...d, [String(job.id)]: e.target.value }))
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
                  </div>
                </div>

                {/* ── MATERIALS EXPAND ───────────────────────── */}
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-out",
                    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    <div
                      className={cn(
                        "space-y-3 border-t px-4 pb-4 pt-3 transition-opacity duration-200",
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
                          No materials yet — open Details to generate them.
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
