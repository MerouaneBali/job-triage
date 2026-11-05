"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DumpSummary, HtmlDump, PipelineJob } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Bot,
  ChevronDown,
  FileSearch,
  Loader2,
  Sparkles,
  Terminal,
  Upload,
  X,
} from "lucide-react";

type Props = {
  dumps: DumpSummary[];
  dumpName: string | null;
  onDumpChange: (name: string) => void;
  onJobFinished: () => void;
  /** After Stage 1 parse succeeds, select this dump for Stage 2/3. */
  onDumpReady?: (basename: string) => void;
  /** When false, only the floating log stays visible (tab switch). */
  showStages?: boolean;
};

type StageKey = "1" | "2" | "3";

const STAGE_OPEN_KEY = "jt-pipeline-stages-open";

function stemFromHtmlName(htmlName: string) {
  return htmlName.replace(/\.html?$/i, "");
}

function readStageOpen(): Record<StageKey, boolean> {
  const defaults: Record<StageKey, boolean> = { "1": true, "2": true, "3": true };
  try {
    const raw = sessionStorage.getItem(STAGE_OPEN_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<StageKey, boolean>>;
    return {
      "1": parsed["1"] ?? true,
      "2": parsed["2"] ?? true,
      "3": parsed["3"] ?? true,
    };
  } catch {
    return defaults;
  }
}

function DumpSelect({
  dumps,
  dumpName,
  onDumpChange,
}: {
  dumps: DumpSummary[];
  dumpName: string | null;
  onDumpChange: (name: string) => void;
}) {
  return (
    <Select
      key={dumps.map((d) => d.name).join("|") || "empty"}
      value={
        dumpName && dumps.some((d) => d.name === dumpName) ? dumpName : null
      }
      onValueChange={(v) => {
        if (v) onDumpChange(v);
      }}
    >
      <SelectTrigger className="min-h-11 w-full min-w-0">
        <SelectValue placeholder="Parsed dump…">
          {(value) => {
            const d = dumps.find((x) => x.name === value);
            return (
              <span className="truncate">
                {d?.label || d?.name || String(value ?? "")}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {dumps.map((d) => (
          <SelectItem key={d.name} value={d.name} label={d.label || d.name}>
            {d.label || d.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StageCard({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3 shadow-sm">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-medium"
        aria-expanded={open}
        onClick={onToggle}
      >
        {icon}
        <span className="min-w-0 flex-1 leading-snug">{title}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>
      {open ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}

function kindLabel(kind: PipelineJob["kind"] | undefined) {
  if (kind === "parse") return "Stage 1";
  if (kind === "fetch") return "Stage 2";
  if (kind === "stage3") return "Stage 3";
  return "Pipeline";
}

export function PipelineBar({
  dumps,
  dumpName,
  onDumpChange,
  onJobFinished,
  onDumpReady,
  showStages = true,
}: Props) {
  const [htmlDumps, setHtmlDumps] = useState<HtmlDump[]>([]);
  const [htmlName, setHtmlName] = useState<string>("");
  const [fetchLimit, setFetchLimit] = useState("5");
  const [stage3Limit, setStage3Limit] = useState("3");
  const [force, setForce] = useState(false);
  const [skipGenerate, setSkipGenerate] = useState(false);
  const [noPause, setNoPause] = useState(true);
  const [headless, setHeadless] = useState(false);
  const [forceFetch, setForceFetch] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [job, setJob] = useState<PipelineJob | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState<Record<StageKey, boolean>>({
    "1": true,
    "2": true,
    "3": true,
  });
  const logScrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logsRef = useRef<string[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const finishedRef = useRef(onJobFinished);
  finishedRef.current = onJobFinished;

  useEffect(() => {
    setStageOpen(readStageOpen());
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/html-dumps");
      const data = (await res.json()) as { dumps: HtmlDump[] };
      setHtmlDumps(data.dumps || []);
      setHtmlName((prev) => prev || data.dumps?.[0]?.name || "");
    })();
  }, []);

  // Reconnect to an in-flight job after refresh / remount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/pipeline/active");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { job: PipelineJob | null };
        if (cancelled || !data.job || data.job.status !== "running") return;
        setJob(data.job);
        setLogOpen(true);
        attachStream(data.job.id);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only reconnect
  }, []);

  useEffect(() => {
    const el = logScrollRef.current;
    if (!el || !logOpen) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, logOpen]);

  function toggleStage(key: StageKey) {
    setStageOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        sessionStorage.setItem(STAGE_OPEN_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function attachStream(jobId: string) {
    esRef.current?.close();
    setBusy(true);
    setLogs([]);
    logsRef.current = [];
    const es = new EventSource(`/api/pipeline/jobs/${jobId}/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as {
          type: string;
          line?: string;
          phase?: string;
          exitCode?: number;
          message?: string;
        };
        if (data.type === "log" && data.line) {
          logsRef.current = [...logsRef.current, data.line];
          setLogs(logsRef.current);
        }
        if (data.type === "phase" && data.phase) {
          setJob((j) => (j ? { ...j, phase: data.phase! } : j));
        }
        if (data.type === "done") {
          es.close();
          if (esRef.current === es) esRef.current = null;
          setBusy(false);
          setJob((j) =>
            j
              ? {
                  ...j,
                  status: data.exitCode === 0 ? "done" : "error",
                  exitCode: data.exitCode ?? 1,
                }
              : j
          );
          if (data.exitCode === 0) {
            const joined = logsRef.current.join("\n");
            if (/Nothing to do/i.test(joined)) {
              toast.message("Nothing to fetch — jobs already have descriptions", {
                description: "Enable Force refetch to open Chromium again.",
              });
            } else if (/playwright install/i.test(joined)) {
              toast.error("Playwright Chromium missing", {
                description: "Run: npx playwright install chromium",
              });
            } else {
              toast.success("Pipeline finished");
            }
            finishedRef.current();
            void refreshHtml();
          } else {
            const joined = logsRef.current.join("\n");
            if (/playwright install/i.test(joined)) {
              toast.error(
                "Playwright Chromium missing — run npx playwright install chromium"
              );
            } else {
              toast.error(`Pipeline failed (exit ${data.exitCode})`);
            }
          }
        }
        if (data.type === "error") {
          es.close();
          if (esRef.current === es) esRef.current = null;
          setBusy(false);
          toast.error(data.message || "Pipeline error");
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      es.close();
      if (esRef.current === es) esRef.current = null;
      setBusy(false);
    };
  }

  async function refreshHtml() {
    const res = await fetch("/api/html-dumps");
    const data = (await res.json()) as { dumps: HtmlDump[] };
    setHtmlDumps(data.dumps || []);
  }

  async function start(
    path: string,
    body: Record<string, unknown>,
    label: string,
    opts?: { selectDumpAfter?: string }
  ) {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { job?: PipelineJob; error?: string };
      if (!res.ok) {
        toast.error(data.error || `Failed to start ${label}`);
        return;
      }
      if (!data.job) return;
      setJob(data.job);
      setLogOpen(true);
      toast.message(`Started ${label}`);
      if (opts?.selectDumpAfter) {
        onDumpReady?.(opts.selectDumpAfter);
      }
      attachStream(data.job.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    }
  }

  async function onUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("parse", "true");
      const res = await fetch("/api/dumps/upload", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as {
        htmlName?: string;
        job?: PipelineJob;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error || "Upload failed");
        return;
      }
      toast.success(`Uploaded ${data.htmlName}`);
      await refreshHtml();
      if (data.htmlName) {
        setHtmlName(data.htmlName);
        onDumpReady?.(stemFromHtmlName(data.htmlName));
      }
      if (data.job) {
        setJob(data.job);
        setLogOpen(true);
        attachStream(data.job.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const showLogChrome = busy || logs.length > 0 || Boolean(job);
  const fabLabel = busy
    ? `${kindLabel(job?.kind)} · ${job?.phase || "running"}`
    : job
      ? `${kindLabel(job.kind)} · ${job.status}${
          job.exitCode != null ? ` · ${job.exitCode}` : ""
        }`
      : "Pipeline log";

  return (
    <>
      {showStages ? (
        <div className="grid min-w-0 gap-3 lg:grid-cols-3">
          <StageCard
            title="Stage 1 — Parse list HTML"
            icon={<FileSearch className="size-4 shrink-0 text-sky-700" />}
            open={stageOpen["1"]}
            onToggle={() => toggleStage("1")}
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Upload a Jobs search HTML dump (phone-friendly) or parse one
              already on disk.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".html,.htm,text/html"
              className="sr-only"
              onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full"
              disabled={busy || uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Upload data-icon="inline-start" />
              {uploading ? "Uploading…" : "Upload HTML"}
            </Button>
            <Select
              key={htmlDumps.map((d) => d.name).join("|") || "empty"}
              value={
                htmlName && htmlDumps.some((d) => d.name === htmlName)
                  ? htmlName
                  : null
              }
              onValueChange={(v) => setHtmlName(v ?? "")}
            >
              <SelectTrigger className="min-h-11 w-full min-w-0">
                <SelectValue placeholder="HTML on disk…">
                  {(value) => (
                    <span className="truncate">
                      {stemFromHtmlName(String(value ?? "")) || "HTML on disk…"}
                    </span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {htmlDumps.map((d) => (
                  <SelectItem
                    key={d.name}
                    value={d.name}
                    label={stemFromHtmlName(d.name)}
                  >
                    <span className="truncate">{stemFromHtmlName(d.name)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="min-h-11 w-full"
              disabled={busy || !htmlName}
              onClick={() =>
                start("/api/pipeline/parse", { htmlName }, "Stage 1 parse", {
                  selectDumpAfter: stemFromHtmlName(htmlName),
                })
              }
            >
              <FileSearch data-icon="inline-start" />
              Parse
            </Button>
          </StageCard>

          <StageCard
            title="Stage 2 — Fetch descriptions"
            icon={<Sparkles className="size-4 shrink-0 text-amber-700" />}
            open={stageOpen["2"]}
            onToggle={() => toggleStage("2")}
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Chromium runs on this machine. Skips jobs that already have
              descriptions unless you force refetch.
            </p>
            <DumpSelect
              dumps={dumps}
              dumpName={dumpName}
              onDumpChange={onDumpChange}
            />
            <div className="flex items-center gap-2">
              <label
                className="shrink-0 text-xs text-muted-foreground"
                htmlFor="fetch-limit"
              >
                Limit
              </label>
              <Input
                id="fetch-limit"
                className="min-h-11 w-20"
                inputMode="numeric"
                value={fetchLimit}
                onChange={(e) => setFetchLimit(e.target.value)}
                placeholder="limit"
                aria-label="Fetch limit"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  checked={noPause}
                  onCheckedChange={(v) => setNoPause(v === true)}
                />
                Unattended
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  checked={headless}
                  onCheckedChange={(v) => setHeadless(v === true)}
                />
                Headless
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  checked={forceFetch}
                  onCheckedChange={(v) => setForceFetch(v === true)}
                />
                Force refetch
              </label>
            </div>
            <Button
              variant="secondary"
              className="min-h-11 w-full"
              disabled={busy || !dumpName}
              onClick={() =>
                start(
                  "/api/pipeline/fetch",
                  {
                    dumpName,
                    limit: Number(fetchLimit) || undefined,
                    noPause,
                    headless,
                    force: forceFetch,
                  },
                  "Stage 2 fetch"
                )
              }
            >
              <Sparkles data-icon="inline-start" />
              Fetch
            </Button>
          </StageCard>

          <StageCard
            title="Stage 3 — Claude evaluate"
            icon={<Bot className="size-4 shrink-0 text-emerald-700" />}
            open={stageOpen["3"]}
            onToggle={() => toggleStage("3")}
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Score fit, decide apply/maybe/skip, optionally draft outreach.
            </p>
            <DumpSelect
              dumps={dumps}
              dumpName={dumpName}
              onDumpChange={onDumpChange}
            />
            <div className="flex items-center gap-2">
              <label
                className="shrink-0 text-xs text-muted-foreground"
                htmlFor="stage3-limit"
              >
                Limit
              </label>
              <Input
                id="stage3-limit"
                className="min-h-11 w-20"
                inputMode="numeric"
                value={stage3Limit}
                onChange={(e) => setStage3Limit(e.target.value)}
                placeholder="limit"
                aria-label="Stage 3 limit"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  checked={force}
                  onCheckedChange={(v) => setForce(v === true)}
                />
                Force
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  checked={skipGenerate}
                  onCheckedChange={(v) => setSkipGenerate(v === true)}
                />
                Skip generate
              </label>
            </div>
            <Button
              className="min-h-11 w-full"
              disabled={busy || !dumpName}
              onClick={() =>
                start(
                  "/api/pipeline/stage3",
                  {
                    dumpName,
                    limit: Number(stage3Limit) || undefined,
                    force,
                    skipGenerate,
                  },
                  "Stage 3"
                )
              }
            >
              <Bot data-icon="inline-start" />
              Run
            </Button>
          </StageCard>
        </div>
      ) : null}

      {showLogChrome ? (
        logOpen ? (
          <div
            className="fixed inset-x-3 z-50 flex max-h-[50vh] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-xl bottom-24 md:inset-x-auto md:bottom-4 md:right-4 md:w-[min(28rem,calc(100vw-2rem))]"
            role="dialog"
            aria-label="Pipeline log"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2 text-zinc-300">
              {busy ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-amber-400" />
              ) : (
                <Terminal className="size-4 shrink-0 text-zinc-400" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                {fabLabel}
              </span>
              <button
                type="button"
                className="min-h-11 shrink-0 px-2 text-[11px] text-zinc-400 hover:text-white"
                onClick={() => {
                  setLogs([]);
                  logsRef.current = [];
                  if (!busy) {
                    setJob(null);
                    setLogOpen(false);
                  }
                }}
              >
                Clear
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11 shrink-0 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                aria-label="Collapse log"
                onClick={() => setLogOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div
              ref={logScrollRef}
              className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-zinc-100 sm:break-normal"
            >
              {logs.length ? logs.join("\n") : busy ? "Waiting for output…" : ""}
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="fixed z-50 flex max-w-[min(18rem,calc(100vw-1.5rem))] items-center gap-2 rounded-full border bg-card px-4 py-3 text-sm shadow-lg bottom-24 right-3 md:bottom-4 md:right-4"
            onClick={() => setLogOpen(true)}
            aria-label="Open pipeline log"
          >
            {busy ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-amber-600" />
            ) : (
              <Terminal className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate">{fabLabel}</span>
          </button>
        )
      ) : null}
    </>
  );
}
