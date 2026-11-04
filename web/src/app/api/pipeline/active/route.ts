import { NextResponse } from "next/server";
import { getActiveJob } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ job: getActiveJob() });
}
