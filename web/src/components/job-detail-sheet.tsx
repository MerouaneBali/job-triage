"use client";

import { DecisionBadge } from "@/components/decision-badge";
import { TagList } from "@/components/tag-list";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
import { ExternalLink } from "lucide-react";

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

export function JobDetailSheet({
  job,
  open,
  onOpenChange,
}: {
  job: JobRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const evaln = job?.evaluation;
  const materials = job?.materials;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-xl"
        showCloseButton
      >
        {job ? (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="min-w-0 space-y-1">
                  <SheetTitle className="text-lg leading-snug">
                    {job.title || "Untitled role"}
                  </SheetTitle>
                  <SheetDescription className="text-sm">
                    {[job.company, job.location].filter(Boolean).join(" · ") ||
                      "No company / location"}
                  </SheetDescription>
                </div>
                <DecisionBadge decision={job.decision ?? null} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {job.fitScore != null ? (
                  <Badge variant="secondary">Score {job.fitScore}</Badge>
                ) : null}
                {job.confidence != null ? (
                  <Badge variant="secondary">
                    Conf {(job.confidence * 100).toFixed(0)}%
                  </Badge>
                ) : null}
                {evaln?.eligibility?.status ? (
                  <Badge variant="outline">
                    Eligibility {evaln.eligibility.status}
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
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Open on LinkedIn
                    <ExternalLink data-icon="inline-end" />
                  </a>
                ) : null}
              </div>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="space-y-5 p-4">
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
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {evaln?.recommendation || job.recommendation}
                        </p>
                      </Section>
                    )}

                    {evaln?.eligibility && (
                      <Section title="Eligibility">
                        <p className="text-sm leading-relaxed">
                          {evaln.eligibility.locationNotes}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          International hiring:{" "}
                          {evaln.eligibility.internationalHiring}
                        </p>
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
                    {materials?.strategy && (
                      <Section title="Strategy">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {materials.strategy}
                        </p>
                      </Section>
                    )}
                    {materials?.outreachMessage && (
                      <Section title="Outreach">
                        <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                          {materials.outreachMessage}
                        </p>
                      </Section>
                    )}
                    {materials?.coverLetter && (
                      <Section title="Cover letter">
                        <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                          {materials.coverLetter}
                        </p>
                      </Section>
                    )}
                    {!!materials?.questionsToAsk?.length && (
                      <Section title="Questions to ask">
                        <ul className="list-disc space-y-1 pl-4 text-sm">
                          {materials.questionsToAsk.map((q) => (
                            <li key={q}>{q}</li>
                          ))}
                        </ul>
                      </Section>
                    )}
                    {!!materials?.cvTailoringSuggestions?.length && (
                      <Section title="CV tailoring">
                        <ul className="list-disc space-y-1 pl-4 text-sm">
                          {materials.cvTailoringSuggestions.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </Section>
                    )}
                    {!materials && (
                      <p className="text-sm text-muted-foreground">
                        No materials generated (skipped roles or
                        --skip-generate).
                      </p>
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
                          No description — run fetch details.
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
