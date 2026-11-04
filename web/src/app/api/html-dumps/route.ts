import { NextResponse } from "next/server";
import { listHtmlDumps } from "@/lib/dumps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ dumps: listHtmlDumps() });
}
