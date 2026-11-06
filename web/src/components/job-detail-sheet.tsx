"use client";

import React from "react";
import { CompanyLogo } from "@/components/company-logo";
import { DecisionBadge } from "@/components/decision-badge";
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
import type { JobRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Loader2, Sparkles, UserRound } from "lucide-react";

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
}: {
  job: JobRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobUpdated?: (patch: Partial<JobRow>) => void;
}) {
  const [localMaterials, setLocalMaterials] = React.useState<JobRow["materials"]>(null);
  const [generating, setGenerating] = React.useState<string | null>(null); // which item is generating

  // Sync local materials when job changes
  React.useEffect(() => {
    setLocalMaterials(null);
  }, [job?.id]);

  const evaln = job?.evaluation;
  const materials = localMaterials ?? job?.materials;
  const elig = evaln?.eligibility?.status;

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
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <SheetTitle className="text-base leading-snug sm:text-lg">
                        {job.title || "Untitled role"}
                      </SheetTitle>
                      <div className="hidden shrink-0 sm:block">
                        <DecisionBadge decision={job.decision ?? null} />
                      </div>
                    </div>
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
                    <div className="flex flex-wrap items-center gap-2 sm:hidden">
                      <DecisionBadge decision={job.decision ?? null} />
                      {job.fitScore != null ? (
                        <Badge variant="secondary">Score {job.fitScore}</Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {job.fitScore != null ? (
                  <Badge variant="secondary" className="max-sm:hidden">
                    Score {job.fitScore}
                  </Badge>
                ) : null}
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
