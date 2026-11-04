import { NextResponse } from "next/server";
import { safeHtmlName } from "@/lib/dumps";
import { startParse } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { htmlName?: string };
    const htmlName = body.htmlName ? safeHtmlName(body.htmlName) : null;
    if (!htmlName) {
      return NextResponse.json({ error: "Invalid htmlName" }, { status: 400 });
    }
    const job = startParse(htmlName);
    return NextResponse.json({ job });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start parse" },
      { status: Number.isFinite(status) ? status : 500 }
    );
  }
}
