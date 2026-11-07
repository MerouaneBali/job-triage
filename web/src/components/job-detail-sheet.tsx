"use client";

import React from "react";
import { CompanyLogo } from "@/components/company-logo";
import { TagList } from "@/components/tag-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TRACK_STATUS_META } from "@/components/track-status-badge";
import type { ApplyChannel, Decision, JobRow, TrackStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Loader2, Sparkles, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";

const DECISION_OPTIONS: { value: Decision | "none"; label: string; className: string }[] = [
  { value: "apply",  label: "✅ Apply",  className: "text-emerald-700 bg-emerald-50 border-emerald-300 dark:text-emerald-400 dark:bg-emerald-950/30 dark:border-emerald-700" },
  { value: "maybe",  label: "🤔 Maybe",  className: "text-amber-700 bg-amber-50 border-amber-300 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-700" },
  { value: "skip",   label: "⏭ Skip",   className: "text-zinc-500 bg-zinc-100 border-zinc-300 dark:text-zinc-400 dark:bg-zinc-800 dark:border-zinc-600" },
  { value: "none",   label: "— No decision", className: "text-muted-foreground bg-background border-border" },
];

const STATUS_OPTIONS = (Object.keys(TRACK_STATUS_META) as TrackStatus[]).map((value) => ({
  value,
  label: TRACK_STATUS_META[value].label,
  icon: TRACK_STATUS_META[value].icon,
}));

const CHANNEL_OPTIONS: { value: ApplyChannel; label: string }[] = [
  { value: "easy_apply", label: "Easy Apply" },
  { value: "external",   label: "External site" },
  { value: "message",    label: "Message / DM" },
];

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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

const ELIGIBILITY_STYLES = {
  pass: "border-emerald-600/40 bg-emerald-600/15 text-emerald-900",
  fail: "border-rose-500/40 bg-rose-500/15 text-rose-900",
  unknown: "border-zinc-400/40 bg-zinc-500/10 text-zinc-800",
} as const;

export function JobDetailSheet({
  job,
  open,
  onOpenChange,
  onJobUpdated,
  onJobDeleted,
  onPipelineJobStarted,
  onRequestRefresh,
}: {
  job: JobRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobUpdated?: (patch: Partial<JobRow>) => void;
  onJobDeleted?: (jobId: string) => void;
  /** Called immediately when an evaluate pipeline job is started, with its server-side job ID. */
  onPipelineJobStarted?: (pipelineJobId: string) => void;
  /** Called when evaluation finishes and the job data should be refreshed from the server. */
  onRequestRefresh?: (jobId: string | number) => void;
}) {
  const [localMaterials, setLocalMaterials] = React.useState<JobRow["materials"]>(null);
  const [generating, setGenerating] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [evaluating, setEvaluating] = React.useState(false);
  const [pendingRefresh, setPendingRefresh] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Sync local materials when job changes
  React.useEffect(() => {
    setLocalMaterials(null);
  }, [job?.id]);

  const evaln = job?.evaluation;
  const materials = localMaterials ?? job?.materials;
  const elig = evaln?.eligibility?.status;

  async function patchJob(patch: {
    decision?: Decision | null;
    trackStatus?: TrackStatus | null;
    applyChannel?: ApplyChannel | null;
  }) {
    if (!job?.id || !job.dumpName || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(String(job.id))}/track`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dumpName: job.dumpName, ...patch }),
      });
      const data = (await res.json()) as { job?: JobRow; error?: string };
      if (!res.ok || !data.job) throw new Error(data.error ?? "Update failed");
      onJobUpdated?.(data.job);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!job?.id || !job.dumpName || deleting) return;
    if (!confirm(`Delete "${job.title ?? "this job"}" from the ${job.dumpName} dump? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(job.id)}?dumpName=${encodeURIComponent(job.dumpName)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success("Job deleted");
      onOpenChange(false);
      onJobDeleted?.(String(job.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function handleEvaluate() {
    if (!job?.id || !job.dumpName || evaluating) return;
    setEvaluating(true);
    const jobId = job.id;
    const dumpName = job.dumpName;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(String(jobId))}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dumpName, force: true }),
      });
      const data = (await res.json()) as { ok?: boolean; pipelineJobId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("AI evaluation started — the terminal will pop up automatically in a moment.", { duration: 6000 });
      setPendingRefresh(true);
      // Notify parent immediately so it can open the terminal overlay
      if (data.pipelineJobId) onPipelineJobStarted?.(data.pipelineJobId);
      // Poll for pipeline completion, then notify parent to reload job data
      const pipelineId = data.pipelineJobId;
      if (pipelineId) {
        void (async () => {
          // Poll /api/pipeline/active until our job is no longer the active one
          for (let attempts = 0; attempts < 120; attempts++) {
            await new Promise((r) => setTimeout(r, 3000));
            try {
              const sr = await fetch("/api/pipeline/active");
              if (!sr.ok) break;
              const sdata = (await sr.json()) as { job?: { id: string; status: string } | null };
              // Job finished when it's no longer the active running job
              if (!sdata.job || sdata.job.id !== pipelineId || sdata.job.status !== "running") break;
            } catch {
              break;
            }
          }
          setPendingRefresh(false);
          onRequestRefresh?.(jobId);
          toast.success("Evaluation complete — job data refreshed.", { duration: 5000 });
        })();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Evaluate failed");
      setPendingRefresh(false);
    } finally {
      setEvaluating(false);
    }
  }

  async function generate(what: string[]) {
    if (!job?.id || generating) return;
    setGenerating(what.join(","));
    try {
      const res = await fetch(`/api/jobs/${job.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dumpBasename: job.dumpName, what }),
      });
      const data = (await res.json()) as { ok?: boolean; materials?: JobRow["materials"]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed");
      setLocalMaterials(data.materials ?? null);
      onJobUpdated?.({ id: job.id, materials: data.materials ?? null });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGenerating(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full max-h-dvh !w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:!max-w-xl"
        showCloseButton
      >
        {job ? (
          <>
            <SheetHeader className="shrink-0 border-b">
              {/* Mobile: stacked header. Desktop: logo | title+badge side-by-side */}
              <div className="flex flex-col gap-3 pr-8 sm:flex-row sm:items-start">
                <div className="flex items-start gap-3 sm:contents">
                  <CompanyLogo
                    src={job.logoUrl}
                    company={job.company}
                    className="size-10 shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-1.5 sm:space-y-1">
                    <SheetTitle className="text-base leading-snug sm:text-lg">
                      {job.title || "Untitled role"}
                    </SheetTitle>
                    <SheetDescription className="flex flex-wrap items-center gap-2 text-sm">
                      <span>
                        {[job.company, job.location]
                          .filter(Boolean)
                          .join(" · ") || "No company / location"}
                      </span>
                      {job.posterType === "agency" ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                          title="Posted by a recruitment agency — the actual employer may not be named"
                        >
                          <UserRound className="size-2.5" />
                          Agency
                        </span>
                      ) : null}
                    </SheetDescription>
                    {/* Decision + status pickers — always visible */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Decision */}
                      <Select
                        value={job.decision ?? "none"}
                        disabled={saving || !job.dumpName}
                        onValueChange={(v) =>
                          void patchJob({ decision: v === "none" ? null : (v as Decision) })
                        }
                      >
                        <SelectTrigger className={cn(
                          "h-6 w-auto shrink-0 rounded-full border px-2.5 text-[11px] font-medium focus:ring-0",
                          DECISION_OPTIONS.find((o) => o.value === (job.decision ?? "none"))?.className,
                        )}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DECISION_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Track status */}
                      {job.dumpName ? (
                        <Select
                          value={job.trackStatus ?? "todo"}
                          disabled={saving}
                          onValueChange={(v) => {
                            const next = v as TrackStatus;
                            void patchJob({
                              trackStatus: next,
                              applyChannel:
                                next === "applied" && !job.applyChannel
                                  ? job.easyApply ? "easy_apply" : "external"
                                  : job.applyChannel,
                            });
                          }}
                        >
                          <SelectTrigger className={cn(
                            "h-6 w-auto shrink-0 rounded-full border px-2.5 text-[11px] font-medium focus:ring-0",
                            TRACK_STATUS_META[job.trackStatus ?? "todo"].className,
                          )}>
                            <SelectValue>
                              {(value) => {
                                const s = (value as TrackStatus) ?? "todo";
                                const meta = TRACK_STATUS_META[s];
                                const Icon = meta?.icon;
                                return Icon ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Icon className="size-3 shrink-0" aria-hidden />
                                    {meta.label}
                                  </span>
                                ) : null;
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
                      ) : null}
                      {/* Apply channel — when applied/waiting */}
                      {job.dumpName && (job.trackStatus === "applied" || job.trackStatus === "waiting" || job.applyChannel) ? (
                        <Select
                          value={job.applyChannel ?? ""}
                          disabled={saving}
                          onValueChange={(v) => void patchJob({ applyChannel: v as ApplyChannel })}
                        >
                          <SelectTrigger className="h-6 w-auto shrink-0 rounded-full border px-2.5 text-[11px] font-medium focus:ring-0">
                            <SelectValue placeholder="Channel…" />
                          </SelectTrigger>
                          <SelectContent>
                            {CHANNEL_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      {job.fitScore != null ? (
                        <Badge variant="secondary">Score {job.fitScore}</Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {job.confidence != null ? (
                  <Badge variant="secondary">
                    Conf {(job.confidence * 100).toFixed(0)}%
                  </Badge>
                ) : null}
                {elig ? (
                  <Badge
                    variant="outline"
                    className={cn("capitalize", ELIGIBILITY_STYLES[elig])}
                  >
                    Eligibility {elig}
                  </Badge>
                ) : null}
                {job.easyApply ? (
                  <Badge variant="outline">Easy Apply</Badge>
                ) : null}
                {job.url ? (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-[#0A66C2] px-2.5 text-xs font-medium whitespace-nowrap text-white hover:bg-[#004182]"
                  >
                    <LinkedInIcon className="size-3.5 shrink-0" />
                    Open on LinkedIn
                  </a>
                ) : null}
                {job.dumpName ? (
                  <button
                    type="button"
                    onClick={() => void handleEvaluate()}
                    disabled={evaluating || pendingRefresh || !!generating}
                    title={job.evaluation ? "Re-run AI evaluation for this job" : "Run AI evaluation for this job"}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-2.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-400 dark:hover:bg-violet-950/60"
                  >
                    {evaluating || pendingRefresh ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {evaluating ? "Starting…" : pendingRefresh ? "Evaluating…" : job.evaluation ? "Re-evaluate" : "Evaluate with AI"}
                  </button>
                ) : null}
                {job.dumpName ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                    title="Delete this job"
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    {deleting ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                    Delete
                  </button>
                ) : null}
              </div>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-5 p-4 pb-10">
                <Tabs defaultValue="evaluation">
                  <TabsList className="w-full">
                    <TabsTrigger value="evaluation" className="flex-1">
                      Evaluation
                    </TabsTrigger>
                    <TabsTrigger value="materials" className="flex-1">
                      Materials
                    </TabsTrigger>
                    <TabsTrigger value="job" className="flex-1">
                      Job
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="evaluation" className="mt-4 space-y-5">
                    {(evaln?.recommendation || job.recommendation) && (
                      <Section title="Recommendation">
                        <p className="rounded-md border border-sky-500/20 bg-sky-50/80 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                          {evaln?.recommendation || job.recommendation}
                        </p>
                      </Section>
                    )}

                    {evaln?.eligibility && (
                      <Section title="Eligibility">
                        <div
                          className={cn(
                            "rounded-md border p-3",
                            ELIGIBILITY_STYLES[evaln.eligibility.status],
                          )}
                        >
                          <p className="text-sm leading-relaxed">
                            {evaln.eligibility.locationNotes}
                          </p>
                          <p className="mt-1 text-xs opacity-80">
                            International hiring:{" "}
                            {evaln.eligibility.internationalHiring}
                          </p>
                        </div>
                      </Section>
                    )}

                    {(evaln?.employmentType || evaln?.compensation) && (
                      <Section title="Role meta">
                        <p className="text-sm">
                          {[evaln.employmentType, evaln.compensation]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </Section>
                    )}

                    <Section title="Strengths">
                      <TagList items={evaln?.strengths} />
                    </Section>
                    <Section title="Gaps">
                      <TagList items={evaln?.gaps} />
                    </Section>
                    <Section title="Partial matches">
                      <TagList items={evaln?.partialMatches} />
                    </Section>

                    {!!evaln?.unknowns?.length && (
                      <Section title="Unknowns">
                        <ul className="list-disc space-y-1 pl-4 text-sm">
                          {evaln.unknowns.map((u) => (
                            <li key={u}>{u}</li>
                          ))}
                        </ul>
                      </Section>
                    )}

                    {!!job.qualifyReasons?.length && (
                      <Section title="Qualify reasons">
                        <div className="flex flex-wrap gap-1.5">
                          {job.qualifyReasons.map((r) => (
                            <Badge key={r} variant="outline">
                              {r}
                            </Badge>
                          ))}
                        </div>
                      </Section>
                    )}

                    {job.stage3Error && (
                      <Section title="Stage 3 error">
                        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                          {job.stage3Error}
                        </p>
                      </Section>
                    )}

                    {!evaln && !job.stage3Error && (
                      <p className="text-sm text-muted-foreground">
                        No evaluation yet. Run Stage 3 for this dump.
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="materials" className="mt-4 space-y-5">
                    {!job.evaluation ? (
                      <p className="text-sm text-muted-foreground">
                        No evaluation yet — run Stage 3 first.
                      </p>
                    ) : (
                      <>
                        {/* Cover letter */}
                        {materials?.coverLetter ? (
                          <Section title="Cover letter">
                            <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                              {materials.coverLetter}
                            </p>
                          </Section>
                        ) : (
                          <Section title="Cover letter">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={!!generating}
                              onClick={() => void generate(["coverLetter"])}
                            >
                              {generating === "coverLetter" ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="size-3.5" />
                              )}
                              Generate cover letter
                            </Button>
                          </Section>
                        )}

                        {/* Outreach */}
                        {materials?.outreachMessage ? (
                          <Section title="Outreach message">
                            <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                              {materials.outreachMessage}
                            </p>
                          </Section>
                        ) : (
                          <Section title="Outreach message">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={!!generating}
                              onClick={() => void generate(["outreach"])}
                            >
                              {generating === "outreach" ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="size-3.5" />
                              )}
                              Generate outreach
                            </Button>
                          </Section>
                        )}

                        {/* Strategy */}
                        {materials?.strategy ? (
                          <Section title="Strategy">
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">
                              {materials.strategy}
                            </p>
                          </Section>
                        ) : (
                          <Section title="Strategy">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={!!generating}
                              onClick={() => void generate(["strategy"])}
                            >
                              {generating === "strategy" ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="size-3.5" />
                              )}
                              Generate strategy
                            </Button>
                          </Section>
                        )}

                        {/* Questions */}
                        {materials?.questionsToAsk?.length ? (
                          <Section title="Questions to ask">
                            <ul className="list-disc space-y-1 pl-4 text-sm">
                              {materials.questionsToAsk.map((q) => (
                                <li key={q}>{q}</li>
                              ))}
                            </ul>
                          </Section>
                        ) : !materials ? (
                          <Section title="Questions to ask">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={!!generating}
                              onClick={() => void generate(["questions", "cv"])}
                            >
                              {generating?.includes("questions") ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="size-3.5" />
                              )}
                              Generate questions &amp; CV tips
                            </Button>
                          </Section>
                        ) : null}

                        {/* CV tailoring */}
                        {materials?.cvTailoringSuggestions?.length ? (
                          <Section title="CV tailoring">
                            <ul className="list-disc space-y-1 pl-4 text-sm">
                              {materials.cvTailoringSuggestions.map((s) => (
                                <li key={s}>{s}</li>
                              ))}
                            </ul>
                          </Section>
                        ) : null}

                        {/* Generate all at once if nothing exists */}
                        {!materials && (
                          <div className="rounded-md border border-dashed p-3 text-center">
                            <p className="mb-3 text-xs text-muted-foreground">
                              No materials yet — generate what you need
                            </p>
                            <Button
                              size="sm"
                              variant="default"
                              className="gap-1.5"
                              disabled={!!generating}
                              onClick={() =>
                                void generate(["coverLetter", "outreach", "questions", "cv", "strategy"])
                              }
                            >
                              {generating ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="size-3.5" />
                              )}
                              Generate all materials
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </TabsContent>

                  <TabsContent value="job" className="mt-4 space-y-5">
                    <Section title="Details">
                      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
                        <dt className="text-muted-foreground">Salary</dt>
                        <dd>{job.salary || "—"}</dd>
                        <dt className="text-muted-foreground">Posted</dt>
                        <dd>{job.posted || job.postedAt || "—"}</dd>
                        <dt className="text-muted-foreground">Detail</dt>
                        <dd>{job.detailStatus || "—"}</dd>
                      </dl>
                    </Section>
                    <Separator />
                    <Section title="Description">
                      {job.description ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {job.description}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No description — run Stage 2 fetch.
                        </p>
                      )}
                    </Section>
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
