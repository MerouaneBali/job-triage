"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApplyQueue } from "@/components/apply-queue";
import { CompanyLogo } from "@/components/company-logo";
import { DecisionBadge } from "@/components/decision-badge";
import { JobDetailSheet } from "@/components/job-detail-sheet";
import { PipelineBar } from "@/components/pipeline-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DumpDetail, DumpSummary, JobRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Briefcase, ListFilter, RefreshCw, Workflow } from "lucide-react";
import { toast } from "sonner";

type SortKey = "fitScore" | "postedAt" | "company" | "title" | "decision";
type AppView = "apply" | "triage" | "pipeline";

function decisionRank(d: JobRow["decision"]) {
  if (d === "apply") return 0;
  if (d === "maybe") return 1;
  if (d === "skip") return 2;
  return 3;
}

export function TriageApp() {
  const [dumps, setDumps] = useState<DumpSummary[]>([]);
  const [dumpName, setDumpName] = useState<string | null>(null);
  const [detail, setDetail] = useState<DumpDetail | null>(null);
  const [dumpsLoading, setDumpsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState<AppView>("apply");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const [hasDescription, setHasDescription] = useState(false);
  const [easyApplyOnly, setEasyApplyOnly] = useState(false);
  const [hasMaterials, setHasMaterials] = useState(false);
  const [minScore, setMinScore] = useState("");
  const [eligibilityFilter, setEligibilityFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("fitScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const loadDumps = useCallback(async () => {
    setDumpsLoading(true);
    try {
      const res = await fetch("/api/dumps");
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `Dumps failed (${res.status})`);
      }
      const data = (await res.json()) as { dumps: DumpSummary[] };
      const list = data.dumps || [];
      setDumps(list);
      setDumpName((prev) => {
        const next = prev || list[0]?.name || null;
        // Avoid empty-state flash between dumps settle and detail fetch.
        if (next) setLoading(true);
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load dumps");
    } finally {
      setDumpsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (name: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dumps/${encodeURIComponent(name)}`);
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || "Failed to load dump");
      }
      const data = (await res.json()) as DumpDetail;
      setDetail(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDumps();
  }, [loadDumps]);

  useEffect(() => {
    if (dumpName) void loadDetail(dumpName);
  }, [dumpName, loadDetail]);

  const refreshAll = useCallback(async () => {
    await loadDumps();
    if (dumpName) await loadDetail(dumpName);
  }, [dumpName, loadDumps, loadDetail]);

  const bootLoading = dumpsLoading || loading;

  const selectedJob = useMemo(
    () => detail?.jobs.find((j) => String(j.id) === selectedId) || null,
    [detail, selectedId]
  );

  const decisionCounts = useMemo(() => {
    const jobs = detail?.jobs || [];
    return {
      all: jobs.length,
      apply: jobs.filter((j) => j.decision === "apply").length,
      maybe: jobs.filter((j) => j.decision === "maybe").length,
      skip: jobs.filter((j) => j.decision === "skip").length,
      none: jobs.filter((j) => !j.decision).length,
    };
  }, [detail]);

  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const j of detail?.jobs || []) {
      if (j.company) set.add(j.company);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [detail]);

  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const j of detail?.jobs || []) {
      if (j.location) set.add(j.location);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [detail]);

  const filtered = useMemo(() => {
    let rows = detail?.jobs ? [...detail.jobs] : [];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((j) => {
        const blob = [
          j.title,
          j.company,
          j.location,
          j.recommendation,
          j.evaluation?.recommendation,
          j.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }
    if (decisionFilter === "none") {
      rows = rows.filter((j) => !j.decision);
    } else if (decisionFilter !== "all") {
      rows = rows.filter((j) => j.decision === decisionFilter);
    }
    if (hasDescription) rows = rows.filter((j) => Boolean(j.description));
    if (easyApplyOnly) rows = rows.filter((j) => Boolean(j.easyApply));
    if (hasMaterials) rows = rows.filter((j) => Boolean(j.materials));
    if (eligibilityFilter !== "all") {
      rows = rows.filter(
        (j) => j.evaluation?.eligibility?.status === eligibilityFilter
      );
    }
    if (companyFilter !== "all") {
      rows = rows.filter((j) => j.company === companyFilter);
    }
    if (locationFilter !== "all") {
      rows = rows.filter((j) => j.location === locationFilter);
    }
    const min = Number(minScore);
    if (Number.isFinite(min) && minScore.trim() !== "") {
      rows = rows.filter((j) => (j.fitScore ?? -1) >= min);
    }

    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "fitScore") {
        cmp = (a.fitScore ?? -1) - (b.fitScore ?? -1);
      } else if (sortKey === "postedAt") {
        cmp = String(a.postedAt || "").localeCompare(String(b.postedAt || ""));
      } else if (sortKey === "company") {
        cmp = String(a.company || "").localeCompare(String(b.company || ""));
      } else if (sortKey === "title") {
        cmp = String(a.title || "").localeCompare(String(b.title || ""));
      } else if (sortKey === "decision") {
        cmp = decisionRank(a.decision) - decisionRank(b.decision);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [
    detail,
    search,
    decisionFilter,
    hasDescription,
    easyApplyOnly,
    hasMaterials,
    eligibilityFilter,
    companyFilter,
    locationFilter,
    minScore,
    sortKey,
    sortDir,
  ]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "company" || key === "title" ? "asc" : "desc");
    }
  }

  function openJob(job: JobRow) {
    setSelectedId(String(job.id));
    setSheetOpen(true);
  }

  const meta = detail
    ? [
        `${detail.jobs.length} jobs`,
        `${detail.detailsOk} with description`,
        detail.stage3Summary
          ? `apply ${detail.stage3Summary.apply ?? 0} · maybe ${detail.stage3Summary.maybe ?? 0} · skip ${detail.stage3Summary.skip ?? 0}`
          : null,
        detail.dumpedAt ? `dumped ${detail.dumpedAt}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 p-4 pb-24 md:p-6 md:pb-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Local triage
          </p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            Job triage
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground hidden sm:block">
            Parse dumps, fetch guest details, run Claude Stage 3, then apply
            from your phone — you still apply manually.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {dumpsLoading ? (
            <Skeleton className="h-11 w-full min-w-0 flex-1 sm:min-w-[280px]" />
          ) : (
            <Select
              key={dumps.map((d) => d.name).join("|") || "empty"}
              value={
                dumpName && dumps.some((d) => d.name === dumpName)
                  ? dumpName
                  : null
              }
              onValueChange={(v) => setDumpName(v)}
            >
              <SelectTrigger className="min-h-11 w-full min-w-0 flex-1 sm:min-w-[280px]">
                <SelectValue placeholder="Select dump…" />
              </SelectTrigger>
              <SelectContent>
                {dumps.map((d) => (
                  <SelectItem key={d.name} value={d.name}>
                    {d.label || d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={() => void refreshAll()}
            aria-label="Refresh"
            disabled={bootLoading}
          >
            <RefreshCw className={cn(bootLoading && "animate-spin")} />
          </Button>
        </div>
      </header>

      {bootLoading && !meta ? (
        <Skeleton className="h-3 w-64 max-w-full" />
      ) : meta ? (
        <p className="text-xs text-muted-foreground">{meta}</p>
      ) : null}

      {/* Desktop top tabs */}
      <div className="hidden gap-2 md:flex">
        {(
          [
            ["apply", "Apply", Briefcase],
            ["triage", "Triage", ListFilter],
            ["pipeline", "Pipeline", Workflow],
          ] as const
        ).map(([key, label, Icon]) => (
          <Button
            key={key}
            variant={view === key ? "default" : "outline"}
            className="min-h-11"
            onClick={() => setView(key)}
          >
            <Icon data-icon="inline-start" />
            {label}
          </Button>
        ))}
      </div>

      {view === "pipeline" ? (
        <PipelineBar
          dumpName={dumpName}
          onJobFinished={() => void refreshAll()}
        />
      ) : null}

      {view === "apply" ? (
        <ApplyQueue
          jobs={detail?.jobs || []}
          onOpenJob={openJob}
          loading={bootLoading}
        />
      ) : null}

      {view === "triage" ? (
      <>
      <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", `All ${decisionCounts.all}`],
              ["apply", `Apply ${decisionCounts.apply}`],
              ["maybe", `Maybe ${decisionCounts.maybe}`],
              ["skip", `Skip ${decisionCounts.skip}`],
              ["none", `Uneval ${decisionCounts.none}`],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              className="min-h-11"
              variant={decisionFilter === key ? "default" : "outline"}
              onClick={() => setDecisionFilter(key)}
            >
              {label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 md:hidden"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            {filtersOpen ? "Hide filters" : "More filters"}
          </Button>
        </div>

        <div
          className={cn(
            "flex flex-wrap items-end gap-3",
            !filtersOpen && "max-md:hidden"
          )}
        >
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label className="text-xs">Search</Label>
            <Input
              className="min-h-11"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Title, company, recommendation…"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Min score</Label>
            <Input
              className="w-20"
              inputMode="numeric"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Eligibility</Label>
            <Select
              value={eligibilityFilter}
              onValueChange={(v) => setEligibilityFilter(v ?? "all")}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pass">Pass</SelectItem>
                <SelectItem value="fail">Fail</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Company</Label>
            <Select
              value={companyFilter}
              onValueChange={(v) => setCompanyFilter(v ?? "all")}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Location</Label>
            <Select
              value={locationFilter}
              onValueChange={(v) => setLocationFilter(v ?? "all")}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              checked={hasDescription}
              onCheckedChange={(v) => setHasDescription(v === true)}
            />
            Has description
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              checked={easyApplyOnly}
              onCheckedChange={(v) => setEasyApplyOnly(v === true)}
            />
            Easy Apply
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              checked={hasMaterials}
              onCheckedChange={(v) => setHasMaterials(v === true)}
            />
            Has materials
          </label>
          <Badge variant="secondary" className="mb-1">
            {filtered.length} shown
          </Badge>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer"
                onClick={() => toggleSort("decision")}
              >
                Decision
              </TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => toggleSort("fitScore")}
              >
                Score
              </TableHead>
              <TableHead>Conf</TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => toggleSort("title")}
              >
                Title
              </TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => toggleSort("company")}
              >
                Company
              </TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Eligibility</TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => toggleSort("postedAt")}
              >
                Posted
              </TableHead>
              <TableHead>EA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bootLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell>
                      <Skeleton className="h-5 w-14" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-8" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-10" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-48 max-w-full" />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Skeleton className="size-8 shrink-0 rounded-md" />
                        <Skeleton className="h-5 w-24" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-14" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-4" />
                    </TableCell>
                  </TableRow>
                ))
              : filtered.map((job) => (
                  <TableRow
                    key={job.id}
                    className={cn(
                      "cursor-pointer",
                      selectedId === String(job.id) && "bg-muted/60"
                    )}
                    onClick={() => openJob(job)}
                  >
                    <TableCell>
                      <DecisionBadge decision={job.decision ?? null} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {job.fitScore == null ? "—" : job.fitScore}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {job.confidence == null
                        ? "—"
                        : `${Math.round(job.confidence * 100)}%`}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate font-medium">
                      {job.title || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[200px] items-center gap-2">
                        <CompanyLogo src={job.logoUrl} company={job.company} />
                        <span className="truncate">{job.company || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-muted-foreground">
                      {job.location || "—"}
                    </TableCell>
                    <TableCell>
                      {job.evaluation?.eligibility?.status ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            job.evaluation.eligibility.status === "pass" &&
                              "border-emerald-600/40 bg-emerald-600/15 text-emerald-900",
                            job.evaluation.eligibility.status === "fail" &&
                              "border-rose-500/40 bg-rose-500/15 text-rose-900",
                            job.evaluation.eligibility.status === "unknown" &&
                              "border-zinc-400/40 bg-zinc-500/10"
                          )}
                        >
                          {job.evaluation.eligibility.status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {job.posted || "—"}
                    </TableCell>
                    <TableCell>{job.easyApply ? "✓" : ""}</TableCell>
                  </TableRow>
                ))}
            {!bootLoading && !filtered.length && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-24 text-center text-muted-foreground"
                >
                  {dumpName
                    ? "No jobs match filters"
                    : "Parse a dump (Stage 1) to begin"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      </>
      ) : null}

      <JobDetailSheet
        job={selectedJob}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-[1600px] grid-cols-3 gap-1 p-2">
          {(
            [
              ["apply", "Apply", Briefcase],
              ["triage", "Triage", ListFilter],
              ["pipeline", "Pipeline", Workflow],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium",
                view === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground"
              )}
              onClick={() => setView(key)}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
