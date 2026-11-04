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
import type { HtmlDump, PipelineJob } from "@/lib/types";
import { Bot, FileSearch, Loader2, Sparkles, Upload } from "lucide-react";

type Props = {
  dumpName: string | null;
  onJobFinished: () => void;
};

export function PipelineBar({ dumpName, onJobFinished }: Props) {
  const [htmlDumps, setHtmlDumps] = useState<HtmlDump[]>([]);
  const [htmlName, setHtmlName] = useState<string>("");
  const [fetchLimit, setFetchLimit] = useState("5");
  const [stage3Limit, setStage3Limit] = useState("3");
  const [force, setForce] = useState(false);
  const [skipGenerate, setSkipGenerate] = useState(false);
  const [noPause, setNoPause] = useState(true);
  const [headless, setHeadless] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [job, setJob] = useState<PipelineJob | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
          setLogs((prev) => [...prev, data.line!]);
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
            toast.success("Pipeline finished");
            onJobFinished();
            void refreshHtml();
          } else {
            toast.error(`Pipeline failed (exit ${data.exitCode})`);
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
    label: string
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
      if (data.htmlName) setHtmlName(data.htmlName);
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
    <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileSearch className="size-4 shrink-0 text-sky-700" />
            Stage 1 — Parse list HTML
          </div>
          <p className="text-xs text-muted-foreground">
            Upload a Jobs search HTML dump (phone-friendly) or parse one already
            on disk.
          </p>
          <div className="flex flex-wrap gap-2">
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
              className="min-h-11"
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
              <SelectTrigger className="min-h-11 min-w-[160px] flex-1">
                <SelectValue placeholder="On disk…" />
              </SelectTrigger>
              <SelectContent>
                {htmlDumps.map((d) => (
                  <SelectItem key={d.name} value={d.name}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="min-h-11"
              disabled={busy || !htmlName}
              onClick={() =>
                start("/api/pipeline/parse", { htmlName }, "Stage 1 parse")
              }
            >
              <FileSearch data-icon="inline-start" />
              Parse
            </Button>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 shrink-0 text-amber-700" />
            Stage 2 — Fetch descriptions
          </div>
          <p className="text-xs text-muted-foreground">
            Chromium pulls guest job details. Unattended skips Enter waits (Pi /
            phone-friendly).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="min-h-11 w-20"
              inputMode="numeric"
              value={fetchLimit}
              onChange={(e) => setFetchLimit(e.target.value)}
              placeholder="limit"
              aria-label="Fetch limit"
            />
            <label className="flex min-h-11 items-center gap-1.5 text-xs">
              <Checkbox
                checked={noPause}
                onCheckedChange={(v) => setNoPause(v === true)}
              />
              Unattended
            </label>
            <label className="flex min-h-11 items-center gap-1.5 text-xs">
              <Checkbox
                checked={headless}
                onCheckedChange={(v) => setHeadless(v === true)}
              />
              Headless
            </label>
            <Button
              variant="secondary"
              className="min-h-11"
              disabled={busy || !dumpName}
              onClick={() =>
                start(
                  "/api/pipeline/fetch",
                  {
                    dumpName,
                    limit: Number(fetchLimit) || undefined,
                    noPause,
                    headless,
                  },
                  "Stage 2 fetch"
                )
              }
            >
              <Sparkles data-icon="inline-start" />
              Fetch
            </Button>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot className="size-4 shrink-0 text-emerald-700" />
            Stage 3 — Claude evaluate
          </div>
          <p className="text-xs text-muted-foreground">
            Score fit, decide apply/maybe/skip, optionally draft outreach.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="min-h-11 w-20"
              inputMode="numeric"
              value={stage3Limit}
              onChange={(e) => setStage3Limit(e.target.value)}
              placeholder="limit"
              aria-label="Stage 3 limit"
            />
            <label className="flex min-h-11 items-center gap-1.5 text-xs">
              <Checkbox
                checked={force}
                onCheckedChange={(v) => setForce(v === true)}
              />
              Force
            </label>
            <label className="flex min-h-11 items-center gap-1.5 text-xs">
              <Checkbox
                checked={skipGenerate}
                onCheckedChange={(v) => setSkipGenerate(v === true)}
              />
              Skip generate
            </label>
            <Button
              className="min-h-11"
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
      </div>

      {busy ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {job?.phase || "running"}…
        </div>
      ) : null}

      {(logs.length > 0 || job) && (
        <div className="rounded-lg border bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100">
          <div className="mb-2 flex items-center justify-between text-zinc-400">
            <span>
              {job
                ? `${job.kind} · ${job.status}${
                    job.exitCode != null ? ` · exit ${job.exitCode}` : ""
                  }`
                : "logs"}
            </span>
            <button
              type="button"
              className="min-h-11 px-2 hover:text-white"
              onClick={() => setLogs([])}
            >
              Clear
            </button>
          </div>
          <div className="max-h-40 overflow-auto whitespace-pre-wrap">
            {logs.join("\n")}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
