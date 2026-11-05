import { NextResponse } from "next/server";
import { loadInboxJobs } from "@/lib/dumps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const inbox = loadInboxJobs();
    return NextResponse.json(inbox);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load inbox" },
      { status: 500 }
    );
  }
}
