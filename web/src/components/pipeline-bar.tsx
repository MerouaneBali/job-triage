"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { HtmlDump, PipelineJob } from "@/lib/types";
import { Loader2 } from "lucide-react";

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
  const [job, setJob] = useState<PipelineJob | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

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
          job?: PipelineJob;
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
        // ignore malformed
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

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Parse HTML dump</Label>
          <div className="flex gap-2">
            <Select
              key={htmlDumps.map((d) => d.name).join("|") || "empty"}
              value={
                htmlName && htmlDumps.some((d) => d.name === htmlName)
                  ? htmlName
                  : null
              }
              onValueChange={(v) => setHtmlName(v ?? "")}
            >
              <SelectTrigger className="min-w-[220px]">
                <SelectValue placeholder="Select HTML…" />
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
              disabled={busy || !htmlName}
              onClick={() =>
                start("/api/pipeline/parse", { htmlName }, "parse")
              }
            >
              Parse
            </Button>
          </div>
        </div>

        <Separator orientation="vertical" className="hidden h-10 sm:block" />

        <div className="space-y-1.5">
          <Label className="text-xs">Fetch details (headed Chromium)</Label>
          <div className="flex gap-2">
            <Input
              className="w-20"
              inputMode="numeric"
              value={fetchLimit}
              onChange={(e) => setFetchLimit(e.target.value)}
              placeholder="limit"
              aria-label="Fetch limit"
            />
            <Button
              variant="secondary"
              disabled={busy || !dumpName}
              onClick={() =>
                start(
                  "/api/pipeline/fetch",
                  {
                    dumpName,
                    limit: Number(fetchLimit) || undefined,
                  },
                  "fetch"
                )
              }
            >
              Fetch
            </Button>
          </div>
        </div>

        <Separator orientation="vertical" className="hidden h-10 sm:block" />

        <div className="space-y-1.5">
          <Label className="text-xs">Stage 3 (Claude)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-20"
              inputMode="numeric"
              value={stage3Limit}
              onChange={(e) => setStage3Limit(e.target.value)}
              placeholder="limit"
              aria-label="Stage 3 limit"
            />
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={force}
                onCheckedChange={(v) => setForce(v === true)}
              />
              Force
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={skipGenerate}
                onCheckedChange={(v) => setSkipGenerate(v === true)}
              />
              Skip generate
            </label>
            <Button
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
                  "stage3"
                )
              }
            >
              Run Stage 3
            </Button>
          </div>
        </div>

        {busy ? (
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {job?.phase || "running"}…
          </div>
        ) : null}
      </div>

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
              className="hover:text-white"
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
