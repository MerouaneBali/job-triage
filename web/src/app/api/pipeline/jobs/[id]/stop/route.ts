import { NextResponse } from "next/server";
import { cancelJob } from "@/lib/pipeline";
import type { PipelineStopMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      mode?: string;
    };
    const mode = body.mode === "force" ? "force" : "safe";
    const job = cancelJob(id, mode as PipelineStopMode);
    return NextResponse.json({ job, mode });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to stop job" },
      { status: Number.isFinite(status) ? status : 500 }
    );
  }
}
