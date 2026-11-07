import { deleteJob } from "@/lib/dumps";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!id || id.includes("..")) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    }
    const { searchParams } = new URL(req.url);
    const dumpName = searchParams.get("dumpName");
    if (!dumpName) {
      return NextResponse.json({ error: "dumpName query param required" }, { status: 400 });
    }
    const deleted = deleteJob(dumpName, id);
    if (!deleted) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message ?? "Unknown error" },
      { status: err.status ?? 500 }
    );
  }
}
