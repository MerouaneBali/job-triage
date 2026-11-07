import { startEvaluateJob } from "@/lib/pipeline";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id: jobId } = await ctx.params;
    if (!jobId || jobId.includes("..")) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      dumpName?: string;
      coverLetter?: boolean;
      outreach?: boolean;
      strategy?: boolean;
      force?: boolean;
    };
    const { dumpName, ...opts } = body;
    if (!dumpName) {
      return NextResponse.json({ error: "dumpName required" }, { status: 400 });
    }

    const job = startEvaluateJob(dumpName, jobId, opts);
    return NextResponse.json({ ok: true, pipelineJobId: job.id });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message ?? "Unknown error" },
      { status: err.status ?? 500 }
    );
  }
}
