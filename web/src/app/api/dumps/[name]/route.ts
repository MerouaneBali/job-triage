import { NextResponse } from "next/server";
import { mergeDump, safeBasename } from "@/lib/dumps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { name: raw } = await ctx.params;
  const name = safeBasename(decodeURIComponent(raw));
  if (!name) {
    return NextResponse.json({ error: "Invalid dump name" }, { status: 400 });
  }
  try {
    return NextResponse.json(mergeDump(name));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Read failed";
    const status = /not found/i.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
