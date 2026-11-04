import { NextResponse } from "next/server";
import { safeBasename } from "@/lib/dumps";
import { startFetch } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { dumpName?: string; limit?: number };
    const dumpName = body.dumpName ? safeBasename(body.dumpName) : null;
    if (!dumpName) {
      return NextResponse.json({ error: "Invalid dumpName" }, { status: 400 });
    }
    const job = startFetch(dumpName, body.limit);
    return NextResponse.json({ job });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start fetch" },
      { status: Number.isFinite(status) ? status : 500 }
    );
  }
}
