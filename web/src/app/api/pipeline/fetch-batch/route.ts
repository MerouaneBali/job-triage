import { NextResponse } from "next/server";
import { safeBasename } from "@/lib/dumps";
import { startBatchFetch } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      dumpNames?: string[];
      limit?: number;
      noPause?: boolean;
      headless?: boolean;
      force?: boolean;
    };
    const dumpNames = (body.dumpNames || [])
      .map((n) => safeBasename(n))
      .filter((n): n is string => Boolean(n));
    if (!dumpNames.length) {
      return NextResponse.json(
        { error: "dumpNames required" },
        { status: 400 }
      );
    }
    const job = startBatchFetch(dumpNames, {
      limit: body.limit,
      noPause: body.noPause !== false,
      headless: Boolean(body.headless),
      force: Boolean(body.force),
    });
    return NextResponse.json({ job });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start batch fetch" },
      { status: Number.isFinite(status) ? status : 500 }
    );
  }
}
