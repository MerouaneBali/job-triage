import { NextResponse } from "next/server";
import { safeHtmlName } from "@/lib/dumps";
import { startBatchParse } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { htmlNames?: string[] };
    const htmlNames = (body.htmlNames || [])
      .map((n) => safeHtmlName(n))
      .filter((n): n is string => Boolean(n));
    if (!htmlNames.length) {
      return NextResponse.json(
        { error: "htmlNames required" },
        { status: 400 }
      );
    }
    const job = startBatchParse(htmlNames);
    return NextResponse.json({ job });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start batch parse" },
      { status: Number.isFinite(status) ? status : 500 }
    );
  }
}
