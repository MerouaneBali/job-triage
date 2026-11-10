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
import type { ApplyChannel, ChatMessage, Decision, JobRow, TrackStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check, Copy, Loader2, RefreshCw, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";

// ─── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

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
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const ELIGIBILITY_STYLES = {
  pass: "border-emerald-600/40 bg-emerald-600/15 text-emerald-900",
  fail: "border-rose-500/40 bg-rose-500/15 text-rose-900",
  unknown: "border-zinc-400/40 bg-zinc-500/10 text-zinc-800",
} as const;

// Copy button that floats above-right of an assistant bubble (has its own copied state)
function AssistantCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy"
      className={cn(
        "absolute -top-2.5 right-0 flex items-center gap-0.5 rounded-full border bg-background px-1.5 py-0.5 text-[10px] shadow-sm transition-opacity",
        "opacity-0 group-hover:opacity-100",
        copied ? "text-emerald-600" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {copied ? <Check className="size-2.5" /> : <Copy className="size-2.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── Job Chat Panel ──────────────────────────────────────────────────────────

function JobChatPanel({ job }: { job: JobRow }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [streamingText, setStreamingText] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Load history when job changes
  React.useEffect(() => {
    if (!job?.id || !job.dumpName) return;
    setMessages([]);
    setLoadingHistory(true);
    fetch(
      `/api/jobs/${encodeURIComponent(String(job.id))}/chat?dumpName=${encodeURIComponent(job.dumpName)}`
    )
      .then((r) => r.json())
      .then((data: { messages?: ChatMessage[] }) => setMessages(data.messages ?? []))
      .catch(() => undefined)
      .finally(() => setLoadingHistory(false));
  }, [job?.id, job?.dumpName]);

  // Auto-scroll to bottom on new content
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  async function handleSend() {
    if (!input.trim() || streaming || !job?.dumpName) return;
    const text = input.trim();
    setInput("");

    // Optimistically add user message
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), role: "user", content: text, created_at: new Date().toISOString() },
    ]);
    setStreaming(true);
    setStreamingText("");

    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(String(job.id))}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dumpName: job.dumpName, message: text }),
        }
      );

      if (!res.ok || !res.body) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const json = JSON.parse(payload) as { text?: string; error?: string };
            if (json.error) throw new Error(json.error);
            if (json.text) {
              assistantText += json.text;
              setStreamingText(assistantText);
            }
          } catch {
            /* ignore parse errors for partial chunks */
          }
        }
      }

      if (assistantText) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: "assistant",
            content: assistantText,
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chat failed");
    } finally {
      setStreaming(false);
      setStreamingText("");
    }
  }

  async function handleClear() {
    if (!job?.dumpName || streaming) return;
    await fetch(
      `/api/jobs/${encodeURIComponent(String(job.id))}/chat?dumpName=${encodeURIComponent(job.dumpName)}`,
      { method: "DELETE" }
    );
    setMessages([]);
  }

  const canChat = !!job?.dumpName;

  return (
    <div className="flex flex-col gap-3">

      {/* Clear chat — top right, well away from Send */}
      {messages.length > 0 && !streaming ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleClear()}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
          >
            <X className="size-3" />
            Clear chat
          </button>
        </div>
      ) : null}

      {/* Messages — flow naturally, outer ScrollArea handles scrolling */}
      <div className="space-y-2">
        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 && !streaming ? (
          <p className="text-center text-xs text-muted-foreground py-8 leading-relaxed">
            Ask anything about this job. Claude has the full context — description, evaluation, your profile, and all materials.
          </p>
        ) : null}

        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              className={cn("flex flex-col gap-0.5", isUser ? "items-end" : "items-start")}
            >
              <span className="px-1 text-[10px] text-muted-foreground">
                {isUser ? "You" : "AI"}
              </span>
              {/* group on the bubble wrapper so copy button can react to hover */}
              <div className="group relative">
                <div
                  className={cn(
                    "max-w-[88vw] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap sm:max-w-xs",
                    isUser
                      ? "rounded-tr-sm bg-primary text-primary-foreground"
                      : "rounded-tl-sm border bg-muted/50"
                  )}
                >
                  {msg.content}
                </div>
                {/* Copy button — floats above-right of the bubble, hover-only */}
                {!isUser && (
                  <AssistantCopyButton text={msg.content} />
                )}
              </div>
            </div>
          );
        })}

        {streaming && (
          <div className="flex flex-col items-start gap-0.5">
            <span className="px-1 text-[10px] text-muted-foreground">AI</span>
            <div className="max-w-[88vw] rounded-2xl rounded-tl-sm border bg-muted/50 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap sm:max-w-xs">
              {streamingText ? (
                <>
                  {streamingText}
                  <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current opacity-60" />
                </>
              ) : (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <Separator />

      {/* Input row */}
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={
            canChat
              ? "Ask a question… (Enter to send, Shift+Enter for new line)"
              : "Open a saved job to chat"
          }
          rows={2}
          disabled={!canChat || streaming}
          className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        <Button
          size="sm"
          onClick={() => void handleSend()}
          disabled={!input.trim() || !canChat || streaming}
          className="h-auto self-stretch px-4"
        >
          {streaming ? <Loader2 className="size-3.5 animate-spin" /> : "Send"}
        </Button>
      </div>
    </div>
  );
}

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

  // Reset evaluating flags when switching jobs so spinner doesn't bleed onto other jobs
  React.useEffect(() => {
    setEvaluating(false);
    setPendingRefresh(false);
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

  async function generate(what: string[], force = false) {
    if (!job?.id || generating) return;
    setGenerating(what.join(","));
    try {
      const res = await fetch(`/api/jobs/${job.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dumpBasename: job.dumpName, what, force }),
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
            {/* ═══════════════ HEADER ═══════════════ */}
            <SheetHeader className="shrink-0 gap-0 border-b p-0">

              {/* ── Identity ─────────────────────────── */}
              <div className="flex items-start gap-3 p-4 pb-3 pr-10">
                <div className="size-11 shrink-0 overflow-hidden rounded-lg border bg-muted">
                  <CompanyLogo
                    src={job.logoUrl}
                    company={job.company}
                    className="size-full"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-base leading-snug sm:text-lg">
                    {job.title || "Untitled role"}
                  </SheetTitle>
                  <SheetDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium text-foreground/80">
                      {[job.company, job.location].filter(Boolean).join(" · ") || "No company / location"}
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
                </div>
              </div>

              {/* ── Interactive controls (selects) ───── */}
              <div className="flex flex-wrap items-center gap-2 border-y bg-muted/40 px-4 py-2.5">
                {/* Decision */}
                <Select
                  value={job.decision ?? "none"}
                  disabled={saving || !job.dumpName}
                  onValueChange={(v) =>
                    void patchJob({ decision: v === "none" ? null : (v as Decision) })
                  }
                >
                  <SelectTrigger className={cn(
                    "h-8 w-auto shrink-0 rounded-lg border px-3 text-xs font-semibold shadow-sm focus:ring-0 focus:ring-offset-0",
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
                      "h-8 w-auto shrink-0 rounded-lg border px-3 text-xs font-semibold shadow-sm focus:ring-0 focus:ring-offset-0",
                      TRACK_STATUS_META[job.trackStatus ?? "todo"].className,
                    )}>
                      <SelectValue>
                        {(value) => {
                          const s = (value as TrackStatus) ?? "todo";
                          const meta = TRACK_STATUS_META[s];
                          const Icon = meta?.icon;
                          return Icon ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Icon className="size-3.5 shrink-0" aria-hidden />
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

                {/* Apply channel — only when relevant */}
                {job.dumpName && (job.trackStatus === "applied" || job.trackStatus === "waiting" || job.applyChannel) ? (
                  <Select
                    value={job.applyChannel ?? ""}
                    disabled={saving}
                    onValueChange={(v) => void patchJob({ applyChannel: v as ApplyChannel })}
                  >
                    <SelectTrigger className="h-8 w-auto shrink-0 rounded-lg border px-3 text-xs font-semibold shadow-sm focus:ring-0 focus:ring-offset-0">
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

                {saving ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
              </div>

              {/* ── Read-only info chips ──────────────── */}
              {(job.fitScore != null || job.confidence != null || elig || job.easyApply) ? (
                <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/40 px-4 py-2.5">
                  {job.fitScore != null ? (
                    <span className="inline-flex h-7 items-center rounded-full border bg-background px-3 text-xs font-medium tabular-nums text-muted-foreground">
                      Score {job.fitScore}
                    </span>
                  ) : null}
                  {job.confidence != null ? (
                    <span className="inline-flex h-7 items-center rounded-full border bg-background px-3 text-xs font-medium tabular-nums text-muted-foreground">
                      {(job.confidence * 100).toFixed(0)}% conf
                    </span>
                  ) : null}
                  {elig ? (
                    <span className={cn(
                      "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium capitalize",
                      ELIGIBILITY_STYLES[elig],
                    )}>
                      Eligibility {elig}
                    </span>
                  ) : null}
                  {job.easyApply ? (
                    <span className="inline-flex h-7 items-center rounded-full border bg-background px-3 text-xs font-medium text-muted-foreground">
                      Easy Apply
                    </span>
                  ) : null}
                </div>
              ) : null}

              {/* ── Action buttons ────────────────────── */}
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                {job.url ? (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0A66C2] px-3 text-xs font-semibold whitespace-nowrap text-white shadow-sm hover:bg-[#004182] active:bg-[#003177]"
                  >
                    <LinkedInIcon className="size-3.5 shrink-0" />
                    LinkedIn
                  </a>
                ) : null}
                {job.dumpName ? (
                  <button
                    type="button"
                    onClick={() => void handleEvaluate()}
                    disabled={evaluating || pendingRefresh || !!generating}
                    title={job.evaluation ? "Re-run AI evaluation for this job" : "Run AI evaluation for this job"}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 text-xs font-semibold text-violet-700 shadow-sm hover:bg-violet-100 active:bg-violet-200 disabled:opacity-50 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-400 dark:hover:bg-violet-950/60"
                  >
                    {evaluating || pendingRefresh ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {evaluating ? "Starting…" : pendingRefresh ? "Evaluating…" : job.evaluation ? "Re-evaluate" : "Evaluate"}
                  </button>
                ) : null}
                {job.dumpName ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                    title="Delete this job"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-600 shadow-sm hover:bg-rose-50 active:bg-rose-100 disabled:opacity-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
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
                    <TabsTrigger value="chat" className="flex-1">
                      Chat
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
                        <Section
                          title="Cover letter"
                          action={materials?.coverLetter ? (
                            <span className="flex items-center gap-2">
                              <CopyButton text={materials.coverLetter} />
                              <button
                                type="button"
                                disabled={!!generating}
                                onClick={() => void generate(["coverLetter"], true)}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                              >
                                {generating === "coverLetter" ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                                Retry
                              </button>
                            </span>
                          ) : undefined}
                        >
                          {materials?.coverLetter ? (
                            <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                              {materials.coverLetter}
                            </p>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={!!generating}
                              onClick={() => void generate(["coverLetter"])}
                            >
                              {generating === "coverLetter" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                              Generate cover letter
                            </Button>
                          )}
                        </Section>

                        {/* Outreach */}
                        <Section
                          title="Outreach message"
                          action={materials?.outreachMessage ? (
                            <span className="flex items-center gap-2">
                              <CopyButton text={materials.outreachMessage} />
                              <button
                                type="button"
                                disabled={!!generating}
                                onClick={() => void generate(["outreach"], true)}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                              >
                                {generating === "outreach" ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                                Retry
                              </button>
                            </span>
                          ) : undefined}
                        >
                          {materials?.outreachMessage ? (
                            <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                              {materials.outreachMessage}
                            </p>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={!!generating}
                              onClick={() => void generate(["outreach"])}
                            >
                              {generating === "outreach" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                              Generate outreach
                            </Button>
                          )}
                        </Section>

                        {/* Strategy */}
                        <Section
                          title="Strategy"
                          action={materials?.strategy ? (
                            <span className="flex items-center gap-2">
                              <CopyButton text={materials.strategy} />
                              <button
                                type="button"
                                disabled={!!generating}
                                onClick={() => void generate(["strategy"], true)}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                              >
                                {generating === "strategy" ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                                Retry
                              </button>
                            </span>
                          ) : undefined}
                        >
                          {materials?.strategy ? (
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">
                              {materials.strategy}
                            </p>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={!!generating}
                              onClick={() => void generate(["strategy"])}
                            >
                              {generating === "strategy" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                              Generate strategy
                            </Button>
                          )}
                        </Section>

                        {/* Questions */}
                        <Section
                          title="Questions to ask"
                          action={materials?.questionsToAsk?.length ? (
                            <span className="flex items-center gap-2">
                              <CopyButton text={materials.questionsToAsk.map((q, i) => `${i + 1}. ${q}`).join("\n")} label="Copy all" />
                              <button
                                type="button"
                                disabled={!!generating}
                                onClick={() => void generate(["questions"], true)}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                              >
                                {generating?.includes("questions") ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                                Retry
                              </button>
                            </span>
                          ) : undefined}
                        >
                          {materials?.questionsToAsk?.length ? (
                            <ul className="list-disc space-y-1 pl-4 text-sm">
                              {materials.questionsToAsk.map((q) => (
                                <li key={q}>{q}</li>
                              ))}
                            </ul>
                          ) : !materials ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={!!generating}
                              onClick={() => void generate(["questions", "cv"])}
                            >
                              {generating?.includes("questions") ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                              Generate questions &amp; CV tips
                            </Button>
                          ) : null}
                        </Section>

                        {/* CV tailoring */}
                        <Section
                          title="CV tailoring"
                          action={materials?.cvTailoringSuggestions?.length ? (
                            <span className="flex items-center gap-2">
                              <CopyButton text={materials.cvTailoringSuggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")} label="Copy all" />
                              <button
                                type="button"
                                disabled={!!generating}
                                onClick={() => void generate(["cv"], true)}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                              >
                                {generating === "cv" ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                                Retry
                              </button>
                            </span>
                          ) : undefined}
                        >
                          {materials?.cvTailoringSuggestions?.length ? (
                            <ul className="list-disc space-y-1 pl-4 text-sm">
                              {materials.cvTailoringSuggestions.map((s) => (
                                <li key={s}>{s}</li>
                              ))}
                            </ul>
                          ) : null}
                        </Section>

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

                  <TabsContent value="chat" className="mt-4">
                    <JobChatPanel job={job} />
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
