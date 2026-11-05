import { NextResponse } from "next/server";
import { updateJobTrackFields } from "@/lib/dumps";
import type { ApplyChannel, TrackStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!id || id.includes("..")) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    }
    const body = (await req.json()) as {
      dumpName?: string;
      trackStatus?: TrackStatus | null;
      applyChannel?: ApplyChannel | null;
      trackNote?: string | null;
    };
    if (!body.dumpName) {
      return NextResponse.json({ error: "dumpName required" }, { status: 400 });
    }
    const job = updateJobTrackFields(body.dumpName, id, {
      trackStatus: body.trackStatus,
      applyChannel: body.applyChannel,
      trackNote: body.trackNote,
    });
    return NextResponse.json({ job });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: Number.isFinite(status) ? status : 500 }
    );
  }
}
