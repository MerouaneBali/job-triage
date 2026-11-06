import { NextResponse } from "next/server";
import { safeBasename } from "@/lib/dumps";
import { startBatchStage3 } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      dumpNames?: string[];
      limit?: number;
      force?: boolean;
      skipGenerate?: boolean;
      generateMaybe?: boolean;
      generateCoverLetter?: boolean;
      generateOutreach?: boolean;
      generateStrategy?: boolean;
      descMaxChars?: number;
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
    const job = startBatchStage3(dumpNames, {
      limit: body.limit,
      force: Boolean(body.force),
      skipGenerate: Boolean(body.skipGenerate),
      generateMaybe: Boolean(body.generateMaybe),
      generateCoverLetter: body.generateCoverLetter !== false,
      generateOutreach: Boolean(body.generateOutreach),
      generateStrategy: Boolean(body.generateStrategy),
      descMaxChars: body.descMaxChars,
    });
    return NextResponse.json({ job });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 500;
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Failed to start batch stage3",
      },
      { status: Number.isFinite(status) ? status : 500 }
    );
  }
}