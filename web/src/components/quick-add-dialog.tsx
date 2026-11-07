"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  /** Called when the fetch pipeline has started (not necessarily completed). */
  onStarted?: () => void;
}

export function QuickAddDialog({ onStarted }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const res = await fetch("/api/jobs/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, stage3: false }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(
        "Job added — the terminal will pop up automatically as it fetches. Open the job afterwards to run AI evaluation.",
        { duration: 7000 }
      );
      setOpen(false);
      setUrl("");
      onStarted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start quick-add");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5" />
        }
      >
        <Plus className="size-4" />
        Add job
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a job from LinkedIn</DialogTitle>
          <DialogDescription>
            Paste any LinkedIn job URL. The page will be fetched via Playwright
            and the job will appear in your triage list. You can then open it
            and run AI evaluation on demand.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="job-url">LinkedIn job URL</Label>
            <Input
              id="job-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.linkedin.com/jobs/view/4234567890/"
              autoFocus
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              Supports <code className="text-xs">/jobs/view/…</code> and{" "}
              <code className="text-xs">?currentJobId=…</code> share links.
            </p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading || !url.trim()}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  Add job
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
