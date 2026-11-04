import { NextResponse } from "next/server";
import { safeJsonName } from "@/lib/dumps";
import { startStage3 } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      dumpName?: string;
      limit?: number;
      force?: boolean;
      skipGenerate?: boolean;
    };
    const dumpName = body.dumpName ? safeJsonName(body.dumpName) : null;
    if (!dumpName) {
      return NextResponse.json({ error: "Invalid dumpName" }, { status: 400 });
    }
    const job = startStage3(dumpName, {
      limit: body.limit,
      force: Boolean(body.force),
      skipGenerate: Boolean(body.skipGenerate),
    });
    return NextResponse.json({ job });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start stage3" },
      { status: Number.isFinite(status) ? status : 500 }
    );
  }
}
