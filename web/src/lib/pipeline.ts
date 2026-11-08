import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { dataPaths, getRepoRoot } from "./paths";
import type {
  PipelineEvent,
  PipelineJob,
  PipelineKind,
  PipelineStopMode,
} from "./types";
import { PIPELINE_STOPPED_EXIT } from "./types";

export type { PipelineJob };
export { PIPELINE_STOPPED_EXIT };

type Listener = (event: PipelineEvent) => void;

type InternalJob = PipelineJob & {
  child: ChildProcess | null;
  /** Numeric pid — survives stale ChildProcess handles after HMR. */
  childPid: number | null;
  listeners: Set<Listener>;
  abortRequested: boolean;
  abortMode: PipelineStopMode | null;
  /** True when this job runs multiple sequential children. */
  isBatch: boolean;
};

/** Survive Next.js route / HMR reloads so POST + SSE share the same Map. */
const g = globalThis as typeof globalThis & {
  __jobTriagePipeline?: {
    jobs: Map<string, InternalJob>;
    activeId: string | null;
    /** Job ids the user asked to stop — checked even if object identity drifts. */
    abortedIds: Set<string>;
  };
};
if (!g.__jobTriagePipeline) {
  g.__jobTriagePipeline = {
    jobs: new Map(),
    activeId: null,
    abortedIds: new Set(),
  };
} else if (!g.__jobTriagePipeline.abortedIds) {
  g.__jobTriagePipeline.abortedIds = new Set();
}
const jobs = g.__jobTriagePipeline.jobs;
const abortedIds = g.__jobTriagePipeline.abortedIds;

function getActiveId() {
  return g.__jobTriagePipeline!.activeId;
}
function setActiveId(id: string | null) {
  g.__jobTriagePipeline!.activeId = id;
}

function isAborted(job: InternalJob): boolean {
  return job.abortRequested || abortedIds.has(job.id) || stopFilePresent();
}

function stopFilePath() {
  return join(dataPaths().root, "data", ".pipeline-stop");
}

function stopFilePresent() {
  try {
    return existsSync(stopFilePath());
  } catch {
    return false;
  }
}

function writeStopFile(jobId: string, mode: PipelineStopMode) {
  try {
    writeFileSync(
      stopFilePath(),
      `${jobId}\n${mode}\n${new Date().toISOString()}\n`,
      "utf8"
    );
  } catch {
    // ignore
  }
}

function clearStopFile() {
  try {
    unlinkSync(stopFilePath());
  } catch {
    // ignore
  }
}

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
    if (
      event.exitCode === PIPELINE_STOPPED_EXIT ||
      isAborted(job)
    ) {
      job.status = "stopped";
      job.exitCode = PIPELINE_STOPPED_EXIT;
      job.error =
        job.abortMode === "force" ? "Force stopped" : "Stopped (safe)";
      abortedIds.add(job.id);
    } else {
      job.status = event.exitCode === 0 ? "done" : "error";
      job.exitCode = event.exitCode;
      if (event.exitCode !== 0 && !job.error) {
        job.error = `Process exited with code ${event.exitCode}`;
      }
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
  if (getActiveId() === jobId) setActiveId(null);
  // Stop file is only meaningful while a job is active.
  if (!getActiveId()) clearStopFile();
}

export function getActiveJob(): PipelineJob | null {
  const activeId = getActiveId();
  if (!activeId) return null;
  const job = jobs.get(activeId);
  return job ? publicJob(job) : null;
}

export function getJob(id: string): PipelineJob | null {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

function publicJob(job: InternalJob): PipelineJob {
  const {
    child: _c,
    childPid: _p,
    listeners: _l,
    abortRequested: _a,
    abortMode: _m,
    isBatch: _b,
    ...rest
  } = job;
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
  if (job.status === "done" || job.status === "stopped") {
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

function playwrightEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (
    env.PLAYWRIGHT_BROWSERS_PATH &&
    /cursor-sandbox-cache|Cursor\/AgentStores/i.test(env.PLAYWRIGHT_BROWSERS_PATH)
  ) {
    delete env.PLAYWRIGHT_BROWSERS_PATH;
  }
  return env;
}

function spawnNodeChild(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string
): ChildProcess {
  // Own process group on Unix so we can SIGTERM/SIGKILL Node + Playwright Chromium together.
  return spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

/** Kill Node + Playwright Chromium descendants. */
function killPidTree(pid: number, signal: "SIGTERM" | "SIGKILL") {
  if (process.platform === "win32") {
    execFile(
      "taskkill",
      ["/pid", String(pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
      () => {}
    );
    return;
  }
  // Children first (Playwright's Chromium), then the node process / process group.
  execFile(
    "pkill",
    [signal === "SIGKILL" ? "-KILL" : "-TERM", "-P", String(pid)],
    () => {}
  );
  try {
    process.kill(-pid, signal);
  } catch {
    // not a group leader (spawned before detached:true)
  }
  try {
    process.kill(pid, signal);
  } catch {
    // already dead
  }
}

function killJobProcess(job: InternalJob, mode: PipelineStopMode) {
  const pid = job.childPid ?? job.child?.pid ?? null;
  if (pid == null) return;

  if (mode === "force") {
    killPidTree(pid, "SIGKILL");
    return;
  }

  // Safe: SIGTERM so fetch-details can exit(130); hard-kill tree if still alive.
  killPidTree(pid, "SIGTERM");
  const child = job.child;
  const escalateAt = setTimeout(() => {
    if (child && (child.exitCode != null || child.signalCode != null)) return;
    try {
      killPidTree(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }, 1500);
  child?.once("exit", () => clearTimeout(escalateAt));
}

/** Belt-and-suspenders: kill any pipeline CLI the ChildProcess handle missed. */
function pkillPipelineChildren(mode: PipelineStopMode) {
  if (process.platform === "win32") return;
  const sig = mode === "force" ? "-KILL" : "-TERM";
  for (const pat of [
    "src/stage2/fetch-details.mjs",
    "src/stage3/run.mjs",
    "src/stage1/parse-jobs.mjs",
  ]) {
    execFile("pkill", [sig, "-f", pat], () => {});
  }
  if (mode === "safe") {
    setTimeout(() => {
      for (const pat of [
        "src/stage2/fetch-details.mjs",
        "src/stage3/run.mjs",
        "src/stage1/parse-jobs.mjs",
      ]) {
        execFile("pkill", ["-KILL", "-f", pat], () => {});
      }
    }, 1500);
  }
}

/**
 * Stop a running pipeline job.
 * Safe = SIGTERM + skip remaining batch items. Force = SIGKILL + same.
 * Finished SQLite writes are kept; the current dump may be partial.
 */
export function cancelJob(
  id: string,
  mode: PipelineStopMode
): PipelineJob {
  const job = jobs.get(id);
  if (!job) {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
  if (job.status !== "running") {
    throw Object.assign(new Error("Job is not running"), { status: 409 });
  }

  job.abortRequested = true;
  job.abortMode = mode;
  abortedIds.add(id);
  writeStopFile(id, mode);
  // Mark every running job — HMR can leave the batch loop holding a stale view.
  for (const j of jobs.values()) {
    if (j.status === "running") {
      j.abortRequested = true;
      j.abortMode = mode;
      abortedIds.add(j.id);
    }
  }

  emit(job, {
    type: "log",
    line:
      mode === "force"
        ? "Force stop requested — killing process tree…"
        : "Safe stop requested — stopping current fetch (SIGTERM, then SIGKILL if needed)…",
    stream: "stderr",
  });
  emit(job, {
    type: "log",
    line:
      "Partial progress is kept in SQLite. Remaining batch dumps are skipped. Re-run to continue pending jobs.",
    stream: "stderr",
  });

  if (job.child || job.childPid != null) {
    killJobProcess(job, mode);
  } else if (!job.isBatch) {
    // No child and not a batch — mark stopped immediately
    emit(job, { type: "done", exitCode: PIPELINE_STOPPED_EXIT });
    finishActive(id);
  }

  // Last resort: kill any Stage 2/3 CLI still alive (covers stale ChildProcess handles).
  pkillPipelineChildren(mode);

  // If the child never signals close (or batch ignores abort), finish after a beat.
  setTimeout(() => {
    const current = jobs.get(id);
    if (!current || current.status !== "running") return;
    if (!isAborted(current)) return;
    emit(current, {
      type: "log",
      line: "Stop watchdog: forcing batch done (child did not report stop).",
      stream: "stderr",
    });
    emit(current, { type: "done", exitCode: PIPELINE_STOPPED_EXIT });
    finishActive(id);
  }, mode === "force" ? 800 : 2500);

  return publicJob(job);
}

function startChild(
  kind: PipelineKind,
  args: string[],
  phase: string
): PipelineJob {
  const currentActive = getActiveId();
  if (currentActive) {
    const active = jobs.get(currentActive);
    if (active?.status === "running") {
      const err = new Error("A pipeline job is already running");
      (err as Error & { status: number }).status = 409;
      throw err;
    }
  }

  loadRepoEnv();
  const root = getRepoRoot();
  const id = randomUUID();
  abortedIds.delete(id);
  clearStopFile();
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
    childPid: null,
    listeners: new Set(),
    abortRequested: false,
    abortMode: null,
    isBatch: false,
  };
  jobs.set(id, job);
  setActiveId(id);

  const child = spawnNodeChild(args, playwrightEnv(), root);
  job.child = child;
  job.childPid = child.pid ?? null;
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
  child.stdout?.on("data", onChunk("stdout"));
  child.stderr?.on("data", onChunk("stderr"));

  child.on("error", (err) => {
    job.child = null;
    job.childPid = null;
    if (isAborted(job)) {
      emit(job, { type: "done", exitCode: PIPELINE_STOPPED_EXIT });
    } else {
      emit(job, { type: "error", message: err.message });
    }
    finishActive(id);
  });

  child.on("close", (code) => {
    job.child = null;
    job.childPid = null;
    if (isAborted(job)) {
      emit(job, { type: "done", exitCode: PIPELINE_STOPPED_EXIT });
    } else {
      emit(job, { type: "done", exitCode: code ?? 1 });
    }
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

export function startFetch(
  dumpName: string,
  opts: {
    limit?: number;
    noPause?: boolean;
    headless?: boolean;
    force?: boolean;
    maxAgeDays?: number;
  } = {}
): PipelineJob {
  const stem = dumpName.replace(/\.json$/i, "");
  if (!stem) {
    throw Object.assign(new Error("Invalid dump basename"), { status: 400 });
  }
  const args = [join("src", "stage2", "fetch-details.mjs"), stem];
  if (opts.limit != null && Number.isFinite(opts.limit) && opts.limit > 0) {
    args.push("--limit", String(Math.floor(opts.limit)));
  }
  if (opts.noPause !== false) args.push("--no-pause");
  if (opts.headless) args.push("--headless");
  if (opts.force) args.push("--force");
  if (opts.maxAgeDays != null) args.push("--max-age-days", String(opts.maxAgeDays));
  return startChild("fetch", args, "fetch-details");
}

/** Save uploaded HTML into data/dumps/ then run Stage 1 parse. */
export function startParseUpload(savedHtmlName: string): PipelineJob {
  return startParse(savedHtmlName);
}

function extractLinkedInJobId(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/jobs\/view\/(\d+)/);
    if (m) return m[1];
    const cjid = u.searchParams.get("currentJobId");
    if (cjid && /^\d+$/.test(cjid)) return cjid;
  } catch {}
  const m = url.match(/\/jobs\/view\/(\d+)/);
  if (m) return m[1];
  const m2 = url.match(/currentJobId=(\d+)/);
  if (m2) return m2[1];
  return null;
}

/** Fetch a single LinkedIn job page and save it to the "manual" dump. */
export function startQuickAdd(
  url: string,
  opts: { headless?: boolean; stage3?: boolean } = {}
): PipelineJob {
  if (!extractLinkedInJobId(url)) {
    throw Object.assign(
      new Error(
        "Could not extract a LinkedIn job ID from the URL. Supported formats:\n" +
          "  https://www.linkedin.com/jobs/view/1234567890/\n" +
          "  https://www.linkedin.com/jobs/collections/recommended/?currentJobId=1234567890"
      ),
      { status: 400 }
    );
  }
  const fetchArgs = [join("src", "quick-add.mjs"), url, "--no-pause"];
  if (opts.headless) fetchArgs.push("--headless");
  return startChild("quick-add", fetchArgs, "quick-add");
}

type Stage3Opts = {
  limit?: number;
  force?: boolean;
  skipGenerate?: boolean;
  generateMaybe?: boolean;
  generateCoverLetter?: boolean;
  generateOutreach?: boolean;
  generateStrategy?: boolean;
  descMaxChars?: number;
  maxAgeDays?: number;
};

function buildStage3Args(stem: string, opts: Stage3Opts): string[] {
  const args = [join("src", "stage3", "run.mjs"), stem];
  if (opts.limit != null && Number.isFinite(opts.limit) && opts.limit > 0) {
    args.push("--limit", String(Math.floor(opts.limit)));
  }
  if (opts.force) args.push("--force");
  if (opts.skipGenerate) args.push("--skip-generate");
  if (opts.generateMaybe) args.push("--generate-maybe");
  if (opts.generateCoverLetter === false) args.push("--no-cover-letter");
  if (!opts.generateOutreach) args.push("--no-outreach");
  if (opts.generateStrategy) args.push("--generate-strategy");
  if (opts.descMaxChars != null && opts.descMaxChars >= 0) {
    args.push("--max-desc-chars", String(opts.descMaxChars));
  }
  if (opts.maxAgeDays != null) {
    args.push("--max-age-days", String(opts.maxAgeDays));
  }
  return args;
}

/**
 * Run Stage 3 targeting a single job in a named dump.
 * Bypasses qualify filter and age filter so manually-triggered evaluations always run.
 */
export function startEvaluateJob(
  dumpName: string,
  jobId: string,
  opts: {
    coverLetter?: boolean;
    outreach?: boolean;
    strategy?: boolean;
    force?: boolean;
  } = {}
): PipelineJob {
  const stem = dumpName.replace(/\.json$/i, "");
  if (!stem) throw Object.assign(new Error("Invalid dump name"), { status: 400 });
  if (!jobId) throw Object.assign(new Error("jobId required"), { status: 400 });

  const args = buildStage3Args(stem, {
    force: opts.force !== false, // force by default for manual evaluation
    maxAgeDays: 3650,            // bypass age filter
    generateCoverLetter: opts.coverLetter,
    generateOutreach: opts.outreach,
    generateStrategy: opts.strategy,
  });
  args.push("--job-ids", jobId);

  return startChild("stage3", args, `evaluate ${jobId}`);
}

export function startStage3(dumpName: string, opts: Stage3Opts = {}): PipelineJob {
  const stem = dumpName.replace(/\.json$/i, "");
  if (!stem) {
    throw Object.assign(new Error("Invalid dump basename"), { status: 400 });
  }
  return startChild("stage3", buildStage3Args(stem, opts), "stage3");
}

type BatchItem = { label: string; args: string[] };

function assertIdle() {
  const currentActive = getActiveId();
  if (currentActive) {
    const active = jobs.get(currentActive);
    if (active?.status === "running") {
      const err = new Error("A pipeline job is already running");
      (err as Error & { status: number }).status = 409;
      throw err;
    }
  }
}

function spawnLogged(
  job: InternalJob,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number> {
  const root = getRepoRoot();
  return new Promise((resolvePromise) => {
    if (isAborted(job)) {
      resolvePromise(PIPELINE_STOPPED_EXIT);
      return;
    }
    const child = spawnNodeChild(args, env, root);
    job.child = child;
    job.childPid = child.pid ?? null;
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
    child.stdout?.on("data", onChunk("stdout"));
    child.stderr?.on("data", onChunk("stderr"));
    child.on("error", (err) => {
      job.child = null;
      job.childPid = null;
      emit(job, {
        type: "log",
        line: `spawn error: ${err.message}`,
        stream: "stderr",
      });
      resolvePromise(isAborted(job) ? PIPELINE_STOPPED_EXIT : 1);
    });
    child.on("close", (code) => {
      job.child = null;
      job.childPid = null;
      // Re-read abort from global set — object flag can drift across HMR.
      resolvePromise(isAborted(job) ? PIPELINE_STOPPED_EXIT : (code ?? 1));
    });
  });
}

/** Run several CLI invocations sequentially under one PipelineJob / SSE stream. */
function startBatch(
  kind: PipelineKind,
  phase: string,
  items: BatchItem[]
): PipelineJob {
  assertIdle();
  if (!items.length) {
    throw Object.assign(new Error("Nothing to batch"), { status: 400 });
  }

  loadRepoEnv();
  const id = randomUUID();
  abortedIds.delete(id);
  clearStopFile();
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
    childPid: null,
    listeners: new Set(),
    abortRequested: false,
    abortMode: null,
    isBatch: true,
  };
  jobs.set(id, job);
  setActiveId(id);

  const env = playwrightEnv();

  emit(job, { type: "phase", phase });
  emit(job, {
    type: "log",
    line: `Batch ${phase}: ${items.length} item(s)`,
    stream: "stdout",
  });

  void (async () => {
    let failures = 0;
    let stopped = false;
    for (let i = 0; i < items.length; i++) {
      if (isAborted(job)) {
        stopped = true;
        emit(job, {
          type: "log",
          line: `Batch aborted before item ${i + 1}/${items.length}`,
          stream: "stderr",
        });
        break;
      }
      const item = items[i]!;
      emit(job, {
        type: "phase",
        phase: `${phase} ${i + 1}/${items.length}`,
      });
      emit(job, {
        type: "log",
        line: `\n=== ${item.label} (${i + 1}/${items.length}) ===`,
        stream: "stdout",
      });
      const code = await spawnLogged(job, item.args, env);
      if (isAborted(job) || code === PIPELINE_STOPPED_EXIT) {
        stopped = true;
        emit(job, {
          type: "log",
          line: `Stopped during ${item.label} (${i + 1}/${items.length}). Later items skipped.`,
          stream: "stderr",
        });
        break;
      }
      if (code !== 0) {
        failures += 1;
        emit(job, {
          type: "log",
          line: `… exited ${code} (continuing batch)`,
          stream: "stderr",
        });
      }
    }
    if (stopped || isAborted(job)) {
      emit(job, { type: "done", exitCode: PIPELINE_STOPPED_EXIT });
    } else {
      const exitCode = failures === 0 ? 0 : failures === items.length ? 1 : 0;
      if (failures && exitCode === 0) {
        emit(job, {
          type: "log",
          line: `Batch finished: ${items.length - failures}/${items.length} dumps exited 0; ${failures} exited non-zero (batch still overall ok — check dump health marks for partial/failed jobs)`,
          stream: "stderr",
        });
      }
      emit(job, { type: "done", exitCode });
    }
    finishActive(id);
  })();

  return publicJob(job);
}

export function startBatchParse(htmlNames: string[]): PipelineJob {
  const { dumps } = dataPaths();
  const items: BatchItem[] = [];
  for (const name of htmlNames) {
    const htmlPath = join(dumps, name);
    if (!existsSync(htmlPath)) {
      throw Object.assign(new Error(`HTML dump not found: ${name}`), {
        status: 404,
      });
    }
    items.push({
      label: name,
      args: [join("src", "stage1", "parse-jobs.mjs"), htmlPath],
    });
  }
  return startBatch("parse-batch", "batch-parse", items);
}

export function startBatchFetch(
  dumpNames: string[],
  opts: {
    limit?: number;
    noPause?: boolean;
    headless?: boolean;
    force?: boolean;
  } = {}
): PipelineJob {
  const items: BatchItem[] = [];
  for (const dumpName of dumpNames) {
    const stem = dumpName.replace(/\.json$/i, "");
    if (!stem) continue;
    const args = [join("src", "stage2", "fetch-details.mjs"), stem];
    if (opts.limit != null && Number.isFinite(opts.limit) && opts.limit > 0) {
      args.push("--limit", String(Math.floor(opts.limit)));
    }
    if (opts.noPause !== false) args.push("--no-pause");
    if (opts.headless) args.push("--headless");
    if (opts.force) args.push("--force");
    items.push({ label: stem, args });
  }
  return startBatch("fetch-batch", "batch-fetch", items);
}

export function startBatchStage3(dumpNames: string[], opts: Stage3Opts = {}): PipelineJob {
  const items: BatchItem[] = [];
  for (const dumpName of dumpNames) {
    const stem = dumpName.replace(/\.json$/i, "");
    if (!stem) continue;
    items.push({ label: stem, args: buildStage3Args(stem, opts) });
  }
  return startBatch("stage3-batch", "batch-stage3", items);
}
