import { startQuickAdd } from "@/lib/pipeline";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      url?: string;
      headless?: boolean;
    };

    const url = body.url?.trim();
    if (!url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    const job = startQuickAdd(url, {
      headless: body.headless ?? false,
    });

    return NextResponse.json({ jobId: job.id, kind: job.kind });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message ?? "Unknown error" },
      { status: err.status ?? 500 }
    );
  }
}
