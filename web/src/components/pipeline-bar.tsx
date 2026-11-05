"use client";

import { useEffect, useRef, useState } from "react";
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
import { Bot, FileSearch, Loader2, Sparkles, Upload } from "lucide-react";

type Props = {
  dumps: DumpSummary[];
  dumpName: string | null;
  onDumpChange: (name: string) => void;
  onJobFinished: () => void;
  /** After Stage 1 parse succeeds, select this dump for Stage 2/3. */
  onDumpReady?: (basename: string) => void;
};

function stemFromHtmlName(htmlName: string) {
  return htmlName.replace(/\.html?$/i, "");
}

export function PipelineBar({
  dumps,
  dumpName,
  onDumpChange,
  onJobFinished,
  onDumpReady,
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
  const logEndRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logsRef = useRef<string[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/html-dumps");
      const data = (await res.json()) as { dumps: HtmlDump[] };
      setHtmlDumps(data.dumps || []);
      setHtmlName((prev) => prev || data.dumps?.[0]?.name || "");
    })();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  function attachStream(jobId: string) {
    setBusy(true);
    setLogs([]);
    logsRef.current = [];
    const es = new EventSource(`/api/pipeline/jobs/${jobId}/stream`);
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
            onJobFinished();
            void refreshHtml();
          } else {
            const joined = logsRef.current.join("\n");
            if (/playwright install/i.test(joined)) {
              toast.error("Playwright Chromium missing — run npx playwright install chromium");
            } else {
              toast.error(`Pipeline failed (exit ${data.exitCode})`);
            }
          }
        }
        if (data.type === "error") {
          es.close();
          setBusy(false);
          toast.error(data.message || "Pipeline error");
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      es.close();
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
      toast.message(`Started ${label}`);
      if (opts?.selectDumpAfter) {
        // Select as soon as parse starts so Fetch/Stage3 target the new dump
        // once parse finishes (onJobFinished refreshes).
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
        attachStream(data.job.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="min-w-0 space-y-3 overflow-hidden rounded-xl border bg-card p-3 shadow-sm sm:p-4">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <p className="shrink-0 text-xs font-medium text-muted-foreground">
          Dump for Stage 2 / 3
        </p>
        <Select
          key={dumps.map((d) => d.name).join("|") || "empty"}
          value={
            dumpName && dumps.some((d) => d.name === dumpName) ? dumpName : null
          }
          onValueChange={(v) => {
            if (v) onDumpChange(v);
          }}
        >
          <SelectTrigger className="min-h-11 w-full min-w-0 sm:max-w-md">
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
              <SelectItem
                key={d.name}
                value={d.name}
                label={d.label || d.name}
              >
                {d.label || d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-3">
        {/* Stage 1 */}
        <div className="min-w-0 space-y-3 rounded-lg border border-dashed p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileSearch className="size-4 shrink-0 text-sky-700" />
            <span className="min-w-0 leading-snug">Stage 1 — Parse list HTML</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Upload a Jobs search HTML dump (phone-friendly) or parse one already
            on disk.
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
        </div>

        {/* Stage 2 */}
        <div className="min-w-0 space-y-3 rounded-lg border border-dashed p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 shrink-0 text-amber-700" />
            <span className="min-w-0 leading-snug">
              Stage 2 — Fetch descriptions
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Chromium runs on this machine. Skips jobs that already have
            descriptions unless you force refetch.
          </p>
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-xs text-muted-foreground" htmlFor="fetch-limit">
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
        </div>

        {/* Stage 3 */}
        <div className="min-w-0 space-y-3 rounded-lg border border-dashed p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot className="size-4 shrink-0 text-emerald-700" />
            <span className="min-w-0 leading-snug">Stage 3 — Claude evaluate</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Score fit, decide apply/maybe/skip, optionally draft outreach.
          </p>
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-xs text-muted-foreground" htmlFor="stage3-limit">
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
        </div>
      </div>

      {busy ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {job?.phase || "running"}…
        </div>
      ) : null}

      {(logs.length > 0 || job) && (
        <div className="min-w-0 rounded-lg border bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100">
          <div className="mb-2 flex items-center justify-between gap-2 text-zinc-400">
            <span className="min-w-0 truncate">
              {job
                ? `${job.kind} · ${job.status}${
                    job.exitCode != null ? ` · exit ${job.exitCode}` : ""
                  }`
                : "logs"}
            </span>
            <button
              type="button"
              className="min-h-11 shrink-0 px-2 hover:text-white"
              onClick={() => {
                setLogs([]);
                logsRef.current = [];
              }}
            >
              Clear
            </button>
          </div>
          <div className="max-h-48 overflow-auto break-all whitespace-pre-wrap sm:break-normal">
            {logs.join("\n")}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
