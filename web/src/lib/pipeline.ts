import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { dataPaths, getRepoRoot } from "./paths";
import type { PipelineEvent, PipelineJob, PipelineKind } from "./types";

export type { PipelineJob };

type Listener = (event: PipelineEvent) => void;

type InternalJob = PipelineJob & {
  child: ChildProcess | null;
  listeners: Set<Listener>;
};

const jobs = new Map<string, InternalJob>();
let activeId: string | null = null;

function loadRepoEnv() {
  const { envFile } = dataPaths();
  if (existsSync(envFile)) {
    loadDotenv({ path: envFile });
  }
}

function emit(job: InternalJob, event: PipelineEvent) {
  if (event.type === "log") {
    job.logs.push(event.line);
    if (job.logs.length > 2000) job.logs.shift();
  }
  if (event.type === "phase") job.phase = event.phase;
  if (event.type === "done") {
    job.status = event.exitCode === 0 ? "done" : "error";
    job.exitCode = event.exitCode;
    if (event.exitCode !== 0 && !job.error) {
      job.error = `Process exited with code ${event.exitCode}`;
    }
  }
  if (event.type === "error") {
    job.status = "error";
    job.error = event.message;
  }
  for (const listener of job.listeners) {
    try {
      listener(event);
    } catch {
      // ignore listener errors
    }
  }
}

function finishActive(jobId: string) {
  if (activeId === jobId) activeId = null;
}

export function getActiveJob(): PipelineJob | null {
  if (!activeId) return null;
  const job = jobs.get(activeId);
  return job ? publicJob(job) : null;
}

export function getJob(id: string): PipelineJob | null {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

function publicJob(job: InternalJob): PipelineJob {
  const { child: _c, listeners: _l, ...rest } = job;
  return rest;
}

export function subscribe(jobId: string, listener: Listener): () => void {
  const job = jobs.get(jobId);
  if (!job) return () => {};
  job.listeners.add(listener);
  // Replay buffered logs
  for (const line of job.logs) {
    listener({ type: "log", line, stream: "stdout" });
  }
  if (job.phase) listener({ type: "phase", phase: job.phase });
  if (job.status === "done") {
    listener({ type: "done", exitCode: job.exitCode ?? 0 });
  } else if (job.status === "error") {
    if (job.exitCode != null) {
      listener({ type: "done", exitCode: job.exitCode });
    } else {
      listener({ type: "error", message: job.error || "Unknown error" });
    }
  }
  return () => {
    job.listeners.delete(listener);
  };
}

function startChild(
  kind: PipelineKind,
  args: string[],
  phase: string
): PipelineJob {
  if (activeId) {
    const active = jobs.get(activeId);
    if (active?.status === "running") {
      const err = new Error("A pipeline job is already running");
      (err as Error & { status: number }).status = 409;
      throw err;
    }
  }

  loadRepoEnv();
  const root = getRepoRoot();
  const id = randomUUID();
  const job: InternalJob = {
    id,
    kind,
    startedAt: new Date().toISOString(),
    status: "running",
    exitCode: null,
    error: null,
    logs: [],
    phase,
    child: null,
    listeners: new Set(),
  };
  jobs.set(id, job);
  activeId = id;

  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;
  emit(job, { type: "phase", phase });
  emit(job, {
    type: "log",
    line: `$ node ${args.join(" ")}`,
    stream: "stdout",
  });

  const onChunk = (stream: "stdout" | "stderr") => (buf: Buffer) => {
    const text = buf.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue;
      emit(job, { type: "log", line, stream });
    }
  };
  child.stdout.on("data", onChunk("stdout"));
  child.stderr.on("data", onChunk("stderr"));

  child.on("error", (err) => {
    emit(job, { type: "error", message: err.message });
    finishActive(id);
  });

  child.on("close", (code) => {
    emit(job, { type: "done", exitCode: code ?? 1 });
    finishActive(id);
  });

  return publicJob(job);
}

export function startParse(htmlName: string): PipelineJob {
  const { dumps } = dataPaths();
  const htmlPath = join(dumps, htmlName);
  if (!existsSync(htmlPath)) {
    throw Object.assign(new Error(`HTML dump not found: ${htmlName}`), {
      status: 404,
    });
  }
  return startChild(
    "parse",
    [join("src", "stage1", "parse-jobs.mjs"), htmlPath],
    "parse"
  );
}

export function startFetch(dumpName: string, limit?: number): PipelineJob {
  const stem = dumpName.replace(/\.json$/i, "");
  if (!stem) {
    throw Object.assign(new Error("Invalid dump basename"), { status: 400 });
  }
  const args = [join("src", "stage2", "fetch-details.mjs"), stem];
  if (limit != null && Number.isFinite(limit) && limit > 0) {
    args.push("--limit", String(Math.floor(limit)));
  }
  return startChild("fetch", args, "fetch-details");
}

export function startStage3(
  dumpName: string,
  opts: { limit?: number; force?: boolean; skipGenerate?: boolean } = {}
): PipelineJob {
  const stem = dumpName.replace(/\.json$/i, "");
  if (!stem) {
    throw Object.assign(new Error("Invalid dump basename"), { status: 400 });
  }
  const args = [join("src", "stage3", "run.mjs"), stem];
  if (opts.limit != null && Number.isFinite(opts.limit) && opts.limit > 0) {
    args.push("--limit", String(Math.floor(opts.limit)));
  }
  if (opts.force) args.push("--force");
  if (opts.skipGenerate) args.push("--skip-generate");
  return startChild("stage3", args, "stage3");
}
