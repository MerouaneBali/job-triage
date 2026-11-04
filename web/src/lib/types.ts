export type Decision = "apply" | "maybe" | "skip" | null;

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
};

export type DumpSummary = {
  name: string;
  label?: string;
  mtime: string;
  jobCount: number | null;
  dumpedAt: string | null;
  source: string | null;
  detailsOk: number;
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

export type PipelineKind = "parse" | "fetch" | "stage3";

export type PipelineJob = {
  id: string;
  kind: PipelineKind;
  startedAt: string;
  status: "running" | "done" | "error";
  exitCode: number | null;
  error: string | null;
  logs: string[];
  phase: string;
};

export type PipelineEvent =
  | { type: "log"; line: string; stream: "stdout" | "stderr" }
  | { type: "phase"; phase: string }
  | { type: "done"; exitCode: number }
  | { type: "error"; message: string };
