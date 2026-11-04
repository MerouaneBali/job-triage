import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mergeDump, safeJsonName } from "@/lib/dumps";
import { dataPaths } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { name: raw } = await ctx.params;
  const name = safeJsonName(decodeURIComponent(raw));
  if (!name) {
    return NextResponse.json({ error: "Invalid dump name" }, { status: 400 });
  }
  const full = join(dataPaths().stage1, name);
  if (!existsSync(full)) {
    return NextResponse.json({ error: "Dump not found" }, { status: 404 });
  }
  try {
    return NextResponse.json(mergeDump(name));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Read failed" },
      { status: 500 }
    );
  }
}
