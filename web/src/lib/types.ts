export type Decision = "apply" | "maybe" | "skip" | null;

export type TrackStatus = "todo" | "applied" | "waiting" | "closed";
export type ApplyChannel = "easy_apply" | "external" | "message";

export type TaggedItem = {
  item: string;
  tag: "match" | "partial_match" | "gap" | "unknown";
  evidence?: string | null;
};

export type Evaluation = {
  jobId?: string;
  decision?: Decision;
  fitScore?: number | null;
  confidence?: number | null;
  eligibility?: {
    status: "pass" | "fail" | "unknown";
    locationNotes: string;
    internationalHiring: "likely" | "unlikely" | "unknown";
  };
  employmentType?: string | null;
  compensation?: string | null;
  strengths?: TaggedItem[];
  gaps?: TaggedItem[];
  partialMatches?: TaggedItem[];
  unknowns?: string[];
  recommendation?: string;
};

export type Materials = {
  jobId?: string;
  strategy?: string;
  coverLetter?: string | null;
  outreachMessage?: string | null;
  questionsToAsk?: string[];
  cvTailoringSuggestions?: string[];
};

export type Qualify = {
  eligibility?: string;
  decision?: string;
  reasons?: string[];
  signals?: Record<string, unknown>;
};

export type JobRow = {
  id: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  salary?: string | null;
  posted?: string | null;
  postedAt?: string | null;
  easyApply?: boolean;
  url?: string | null;
  logoUrl?: string | null;
  description?: string | null;
  detailStatus?: string | null;
  detailError?: string | null;
  decision?: Decision;
  fitScore?: number | null;
  confidence?: number | null;
  recommendation?: string | null;
  evaluation?: Evaluation | null;
  materials?: Materials | null;
  qualify?: Qualify | null;
  qualifyReasons?: string[] | null;
  stage3Error?: string | null;
  trackStatus?: TrackStatus | null;
  applyChannel?: ApplyChannel | null;
  trackNote?: string | null;
  trackedAt?: string | null;
  appliedAt?: string | null;
  source?: string | null;
  /** Company/ATS apply URL when known; else fall back to LinkedIn `url`. */
  applyUrl?: string | null;
  /** Dump stem when loaded from All-dumps inbox. */
  dumpName?: string | null;
  /** Whether the job was posted by a recruitment agency ('agency') or direct employer ('direct'). Null = unknown. */
  posterType?: "agency" | "direct" | null;
};

export const ALL_DUMPS = "__all__";
/** All jobs across dumps (no decision filter — includes unevaluated). */
export const ALL_DUMPS_ALL = "__all_browse__";

export type DumpSummary = {
  name: string;
  label?: string;
  mtime: string;
  jobCount: number | null;
  dumpedAt: string | null;
  source: string | null;
  detailsOk: number;
  /** Jobs with detail_status error / missing_description after a fetch attempt. */
  detailsFailed: number;
  stage3Apply: number;
  stage3Maybe: number;
  stage3Skip: number;
};

export type DumpDetail = {
  dumpedAt: string | null;
  parsedAt: string | null;
  source: string;
  jobs: JobRow[];
  stage2FetchedAt?: string | null;
  stage3CreatedAt?: string | null;
  stage3Summary?: {
    total?: number;
    apply?: number;
    maybe?: number;
    skip?: number;
  } | null;
  detailsOk: number;
  stage3Ok: number;
};

export type HtmlDump = {
  name: string;
  mtime: string;
  size: number;
};

export type PipelineKind =
  | "parse"
  | "fetch"
  | "stage3"
  | "parse-batch"
  | "fetch-batch"
  | "stage3-batch";

export type PipelineStopMode = "safe" | "force";

export type PipelineJob = {
  id: string;
  kind: PipelineKind;
  startedAt: string;
  status: "running" | "done" | "error" | "stopped";
  exitCode: number | null;
  error: string | null;
  logs: string[];
  phase: string;
};

/** Exit code used when the user stops a pipeline job. */
export const PIPELINE_STOPPED_EXIT = 130;

export type PipelineEvent =
  | { type: "log"; line: string; stream: "stdout" | "stderr" }
  | { type: "phase"; phase: string }
  | { type: "done"; exitCode: number }
  | { type: "error"; message: string };
