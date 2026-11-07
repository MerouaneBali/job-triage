"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApplyQueue } from "@/components/apply-queue";
import { CompanyLogo } from "@/components/company-logo";
import { DecisionBadge } from "@/components/decision-badge";
import { JobDetailSheet } from "@/components/job-detail-sheet";
import { PipelineBar } from "@/components/pipeline-bar";
import { TrackStatusBadge } from "@/components/track-status-badge";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DumpHealthMark,
  dumpFetchHint,
} from "@/components/dump-health";
import { ALL_DUMPS, ALL_DUMPS_ALL, type DumpDetail, type DumpSummary, type JobRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Briefcase, Check, Columns3, LayoutDashboard, ListFilter, RefreshCw, SlidersHorizontal, UserRound, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Dashboard } from "@/components/dashboard";

type SortKey = "fitScore" | "postedAt" | "company" | "title" | "decision";
type AppView = "apply" | "triage" | "pipeline" | "dashboard";

const ALL_COLS = ["status", "score", "conf", "eligibility", "posted", "ea", "location"] as const;
type ColKey = (typeof ALL_COLS)[number];
const COL_LABELS: Record<ColKey, string> = {
  status: "Status",
  score: "Score",
  conf: "Conf",
  eligibility: "Eligibility",
  posted: "Posted",
  ea: "EA",
  location: "Location",
};

function readSavedCols(): Set<ColKey> {
  if (typeof window === "undefined") return new Set(ALL_COLS);
  try {
    const saved = localStorage.getItem("triage.columns");
    if (saved) {
      const arr = JSON.parse(saved) as string[];
      return new Set(arr.filter((c) => (ALL_COLS as readonly string[]).includes(c)) as ColKey[]);
    }
  } catch {}
  return new Set(ALL_COLS);
}

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

  const [search, setSearch] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const [hasDescription, setHasDescription] = useState(false);
  const [easyApplyOnly, setEasyApplyOnly] = useState(false);
  const [hasMaterials, setHasMaterials] = useState(false);
  const [minScore, setMinScore] = useState("");
  const [eligibilityFilter, setEligibilityFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [postedWithin, setPostedWithin] = useState<string>("all");
  const [addedWithin, setAddedWithin] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("fitScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(readSavedCols);

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
        let next: string | null;
        if (prev === ALL_DUMPS || prev === ALL_DUMPS_ALL) next = prev;
        else if (prev && list.some((d) => d.name === prev)) next = prev;
        else next = list.length ? ALL_DUMPS : null;
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
      if (name === ALL_DUMPS || name === ALL_DUMPS_ALL) {
        const url = name === ALL_DUMPS ? "/api/inbox" : "/api/inbox/all";
        const res = await fetch(url);
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error || "Failed to load inbox");
        }
        const data = (await res.json()) as {
          jobs: JobRow[];
          totalRaw: number;
          dumpsTouched: number;
        };
        setDetail({
          dumpedAt: null,
          parsedAt: null,
          source: name === ALL_DUMPS ? "all-dumps" : "all-browse",
          jobs: data.jobs || [],
          detailsOk: (data.jobs || []).filter((j) => j.description).length,
          stage3Ok: (data.jobs || []).length,
          stage3Summary: {
            apply: (data.jobs || []).filter((j) => j.decision === "apply")
              .length,
            maybe: (data.jobs || []).filter((j) => j.decision === "maybe")
              .length,
            skip: (data.jobs || []).filter((j) => j.decision === "skip")
              .length,
            total: data.totalRaw ?? (data.jobs || []).length,
          },
        });
        return;
      }
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
    if (postedWithin !== "all") {
      const days = Number(postedWithin);
      const cutoff = new Date(Date.now() - days * 86_400_000);
      rows = rows.filter((j) => j.postedAt && new Date(j.postedAt) >= cutoff);
    }
    if (addedWithin !== "all") {
      const days = Number(addedWithin);
      const cutoff = new Date(Date.now() - days * 86_400_000);
      rows = rows.filter((j) => {
        const ts = j.trackedAt || j.postedAt;
        return ts && new Date(ts) >= cutoff;
      });
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
    postedWithin,
    addedWithin,
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

  const isAllMode = dumpName === ALL_DUMPS || dumpName === ALL_DUMPS_ALL;
  const meta = detail
    ? [
        isAllMode
          ? `${detail.jobs.length} jobs (deduped)`
          : `${detail.jobs.length} jobs`,
        isAllMode ? null : `${detail.detailsOk} with description`,
        detail.stage3Summary
          ? `apply ${detail.stage3Summary.apply ?? 0} · maybe ${detail.stage3Summary.maybe ?? 0}${
              isAllMode ? "" : ` · skip ${detail.stage3Summary.skip ?? 0}`
            }`
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
        {view !== "pipeline" && view !== "dashboard" ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {dumpsLoading ? (
              <Skeleton className="h-11 w-full min-w-0 flex-1 sm:min-w-[280px]" />
            ) : (
              <Select
                key={dumps.map((d) => d.name).join("|") || "empty"}
                value={
                  dumpName === ALL_DUMPS || dumpName === ALL_DUMPS_ALL
                    ? dumpName
                    : dumpName && dumps.some((d) => d.name === dumpName)
                      ? dumpName
                      : null
                }
                onValueChange={(v) => {
                  if (v) setDumpName(v);
                }}
              >
                <SelectTrigger className="min-h-11 w-full min-w-0 flex-1 sm:min-w-[280px]">
                  <SelectValue placeholder="Select dump…">
                    {(value) => {
                      if (value === ALL_DUMPS) {
                        return (
                          <span className="truncate">All dumps — Apply inbox</span>
                        );
                      }
                      if (value === ALL_DUMPS_ALL) {
                        return (
                          <span className="truncate">All dumps — Browse all</span>
                        );
                      }
                      const d = dumps.find((x) => x.name === value);
                      if (!d) {
                        return (
                          <span className="truncate">{String(value ?? "")}</span>
                        );
                      }
                      return (
                        <span className="flex min-w-0 items-center gap-2">
                          <DumpHealthMark dump={d} />
                          <span className="truncate">{d.label || d.name}</span>
                        </span>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_DUMPS} label="All dumps — Apply inbox">
                    All dumps — Apply inbox
                  </SelectItem>
                  <SelectItem value={ALL_DUMPS_ALL} label="All dumps — Browse all">
                    All dumps — Browse all
                  </SelectItem>
                  {dumps.map((d) => (
                    <SelectItem
                      key={d.name}
                      value={d.name}
                      label={`${d.label || d.name} · ${dumpFetchHint(d)}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <DumpHealthMark dump={d} />
                        <span className="min-w-0 truncate">
                          {d.label || d.name}
                        </span>
                        {(d.detailsFailed ?? 0) > 0 ||
                        (d.jobCount ?? 0) > (d.detailsOk ?? 0) ? (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {dumpFetchHint(d)}
                          </span>
                        ) : null}
                      </span>
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
        ) : null}
      </header>

      {view !== "pipeline" && view !== "dashboard" ? (
        bootLoading && !meta ? (
          <Skeleton className="h-3 w-64 max-w-full" />
        ) : meta ? (
          <p className="text-xs text-muted-foreground">{meta}</p>
        ) : null
      ) : null}


      {/* Desktop top tabs */}
      <div className="hidden gap-2 md:flex">
        {(
          [
            ["apply", "Apply", Briefcase],
            ["triage", "Triage", ListFilter],
            ["pipeline", "Pipeline", Workflow],
            ["dashboard", "Dashboard", LayoutDashboard],
          ] as const
        ).map(([key, label, Icon]) => (
          <Button
            key={key}
            variant={view === key ? "default" : "outline"}
            className="min-h-11"
            onClick={() => {
              setView(key);
            }}
          >
            <Icon data-icon="inline-start" />
            {label}
          </Button>
        ))}
      </div>

      {/* PipelineBar always rendered — its terminal overlay must be visible on all views */}
      <PipelineBar
        dumps={dumps}
        dumpName={isAllMode ? dumps[0]?.name ?? null : dumpName}
        onDumpChange={setDumpName}
        showStages={view === "pipeline"}
        onJobFinished={() => void refreshAll()}
        onDumpReady={(name) => {
          // Only switch dump when the user is on the pipeline view —
          // avoid overwriting the Apply inbox or Browse-all selection.
          if (view === "pipeline") setDumpName(name);
          void refreshAll();
        }}
      />

      {view === "apply" ? (
        <ApplyQueue
          jobs={detail?.jobs || []}
          dumpName={dumpName}
          onOpenJob={openJob}
          onJobUpdated={(job) => {
            setDetail((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                jobs: prev.jobs.map((j) =>
                  String(j.id) === String(job.id)
                    ? { ...j, ...job, dumpName: job.dumpName ?? j.dumpName }
                    : j
                ),
              };
            });
          }}
          loading={bootLoading}
        />
      ) : null}

      {view === "triage" ? (
      <>
      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card px-3 py-2.5 shadow-sm">
        {/* Row 1: search */}
        <div className="mb-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, company, recommendation…"
            className="h-9"
          />
        </div>

        {/* Row 2: decision chips + tool buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["all", `All ${decisionCounts.all}`],
              ["apply", `Apply ${decisionCounts.apply}`],
              ["maybe", `Maybe ${decisionCounts.maybe}`],
              ["skip", `Skip ${decisionCounts.skip}`],
              ["none", `Uneval ${decisionCounts.none}`],
            ] as const
          ).map(([key, label]) => {
            const active = decisionFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDecisionFilter(key)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {active && <Check className="size-2.5" />}
                {label}
              </button>
            );
          })}

          <div className="flex-1" />

          {/* Filters popover */}
          {(() => {
            const activeCount = [
              minScore.trim() !== "",
              eligibilityFilter !== "all",
              companyFilter !== "all",
              locationFilter !== "all",
              hasDescription,
              easyApplyOnly,
              hasMaterials,
              postedWithin !== "all",
              addedWithin !== "all",
            ].filter(Boolean).length;
            return (
              <Popover>
                <PopoverTrigger
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    activeCount > 0
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <SlidersHorizontal className="size-3" />
                  Filters{activeCount > 0 ? ` (${activeCount})` : ""}
                </PopoverTrigger>
                <PopoverContent className="w-80 p-4" align="end">
                  <div className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Filters</p>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Min score</Label>
                      <Input
                        className="h-8"
                        inputMode="numeric"
                        value={minScore}
                        onChange={(e) => setMinScore(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Eligibility</Label>
                      <Select value={eligibilityFilter} onValueChange={(v) => setEligibilityFilter(v ?? "all")}>
                        <SelectTrigger className="h-8">
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
                      <Select value={companyFilter} onValueChange={(v) => setCompanyFilter(v ?? "all")}>
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All companies</SelectItem>
                          {companies.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Location</Label>
                      <Select value={locationFilter} onValueChange={(v) => setLocationFilter(v ?? "all")}>
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All locations</SelectItem>
                          {locations.map((l) => (
                            <SelectItem key={l} value={l}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Posted within</Label>
                      <Select value={postedWithin} onValueChange={(v) => setPostedWithin(v ?? "all")}>
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Any time</SelectItem>
                          <SelectItem value="7">Last 7 days</SelectItem>
                          <SelectItem value="14">Last 14 days</SelectItem>
                          <SelectItem value="30">Last 30 days</SelectItem>
                          <SelectItem value="60">Last 60 days</SelectItem>
                          <SelectItem value="90">Last 90 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Added within</Label>
                      <Select value={addedWithin} onValueChange={(v) => setAddedWithin(v ?? "all")}>
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Any time</SelectItem>
                          <SelectItem value="7">Last 7 days</SelectItem>
                          <SelectItem value="14">Last 14 days</SelectItem>
                          <SelectItem value="30">Last 30 days</SelectItem>
                          <SelectItem value="60">Last 60 days</SelectItem>
                          <SelectItem value="90">Last 90 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 pt-1">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox checked={hasDescription} onCheckedChange={(v) => setHasDescription(v === true)} />
                        Has description
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox checked={easyApplyOnly} onCheckedChange={(v) => setEasyApplyOnly(v === true)} />
                        Easy Apply only
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox checked={hasMaterials} onCheckedChange={(v) => setHasMaterials(v === true)} />
                        Has materials
                      </label>
                    </div>
                    {activeCount > 0 && (
                      <button
                        type="button"
                        className="w-full rounded-md border border-dashed py-1.5 text-xs text-muted-foreground hover:bg-muted"
                        onClick={() => {
                          setMinScore("");
                          setEligibilityFilter("all");
                          setCompanyFilter("all");
                          setLocationFilter("all");
                          setPostedWithin("all");
                          setAddedWithin("all");
                          setHasDescription(false);
                          setEasyApplyOnly(false);
                          setHasMaterials(false);
                        }}
                      >
                        Clear all filters
                      </button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            );
          })()}

          {/* Columns popover */}
          <Popover>
            <PopoverTrigger
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Columns3 className="size-3" />
              Columns
            </PopoverTrigger>
            <PopoverContent className="w-48 p-3" align="end">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Columns</p>
              <div className="space-y-2">
                {ALL_COLS.map((col) => (
                  <label key={col} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={visibleCols.has(col)}
                      onCheckedChange={(v) => {
                        setVisibleCols((prev) => {
                          const next = new Set(prev);
                          if (v === true) next.add(col);
                          else next.delete(col);
                          try { localStorage.setItem("triage.columns", JSON.stringify([...next])); } catch {}
                          return next;
                        });
                      }}
                    />
                    {COL_LABELS[col]}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <span className="shrink-0 text-xs text-muted-foreground">{filtered.length} shown</span>
        </div>
      </div>

      {/* ── Triage table ───────────────────────────────────────────────────── */}
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
              {visibleCols.has("status") && <TableHead>Status</TableHead>}
              {visibleCols.has("score") && (
                <TableHead className="cursor-pointer" onClick={() => toggleSort("fitScore")}>
                  Score
                </TableHead>
              )}
              {visibleCols.has("conf") && <TableHead>Conf</TableHead>}
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
              {visibleCols.has("location") && <TableHead>Location</TableHead>}
              {visibleCols.has("eligibility") && <TableHead>Eligibility</TableHead>}
              {visibleCols.has("posted") && (
                <TableHead className="cursor-pointer" onClick={() => toggleSort("postedAt")}>
                  Posted
                </TableHead>
              )}
              {visibleCols.has("ea") && <TableHead>EA</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {bootLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell><Skeleton className="h-5 w-14" /></TableCell>
                    {visibleCols.has("status") && <TableCell><Skeleton className="h-5 w-16" /></TableCell>}
                    {visibleCols.has("score") && <TableCell><Skeleton className="h-5 w-8" /></TableCell>}
                    {visibleCols.has("conf") && <TableCell><Skeleton className="h-5 w-10" /></TableCell>}
                    <TableCell><Skeleton className="h-5 w-48 max-w-full" /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Skeleton className="size-8 shrink-0 rounded-md" />
                        <Skeleton className="h-5 w-24" />
                      </div>
                    </TableCell>
                    {visibleCols.has("location") && <TableCell><Skeleton className="h-5 w-28" /></TableCell>}
                    {visibleCols.has("eligibility") && <TableCell><Skeleton className="h-5 w-14" /></TableCell>}
                    {visibleCols.has("posted") && <TableCell><Skeleton className="h-5 w-16" /></TableCell>}
                    {visibleCols.has("ea") && <TableCell><Skeleton className="h-5 w-4" /></TableCell>}
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
                    {visibleCols.has("status") && (
                      <TableCell>
                        <TrackStatusBadge
                          status={
                            job.decision === "apply" || job.decision === "maybe"
                              ? job.trackStatus || "todo"
                              : job.trackStatus
                          }
                        />
                      </TableCell>
                    )}
                    {visibleCols.has("score") && (
                      <TableCell className="tabular-nums">
                        {job.fitScore == null ? "—" : job.fitScore}
                      </TableCell>
                    )}
                    {visibleCols.has("conf") && (
                      <TableCell className="tabular-nums text-muted-foreground">
                        {job.confidence == null
                          ? "—"
                          : `${Math.round(job.confidence * 100)}%`}
                      </TableCell>
                    )}
                    <TableCell className="max-w-[280px] truncate font-medium">
                      {job.title || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[200px] flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <div className="size-7 shrink-0 overflow-hidden rounded-md">
                            <CompanyLogo src={job.logoUrl} company={job.company} />
                          </div>
                          <span className="truncate">{job.company || "—"}</span>
                        </div>
                        {job.posterType === "agency" ? (
                          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                            <UserRound className="size-2.5" />
                            Agency
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    {visibleCols.has("location") && (
                      <TableCell className="max-w-[160px] truncate text-muted-foreground">
                        {job.location || "—"}
                      </TableCell>
                    )}
                    {visibleCols.has("eligibility") && (
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
                    )}
                    {visibleCols.has("posted") && (
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {job.posted || "—"}
                      </TableCell>
                    )}
                    {visibleCols.has("ea") && (
                      <TableCell>{job.easyApply ? "✓" : ""}</TableCell>
                    )}
                  </TableRow>
                ))}
            {!bootLoading && !filtered.length && (
              <TableRow>
                <TableCell
                  colSpan={
                    2 + // decision + title + company
                    [...visibleCols].length
                  }
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
        onJobUpdated={(patch) => {
          setDetail((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              jobs: prev.jobs.map((j) =>
                String(j.id) === String(patch.id ?? selectedId)
                  ? { ...j, ...patch }
                  : j
              ),
            };
          });
        }}
      />

      {view === "dashboard" ? <Dashboard /> : null}

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-[1600px] grid-cols-4 gap-1 p-2">
          {(
            [
              ["apply", "Apply", Briefcase],
              ["triage", "Triage", ListFilter],
              ["pipeline", "Pipeline", Workflow],
              ["dashboard", "Stats", LayoutDashboard],
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
              onClick={() => {
                setView(key);
              }}
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
