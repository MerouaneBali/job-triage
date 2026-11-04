import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { dataPaths } from "@/lib/paths";
import { startParse } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeUploadName(name: string): string | null {
  const base = basename(name);
  if (!base || base.includes("..") || !/\.html?$/i.test(base)) return null;
  // Normalize to .html
  const stem = base.replace(/\.html?$/i, "");
  if (!/^[a-zA-Z0-9._-]+$/.test(stem)) return null;
  return `${stem}.html`;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const alsoParse = form.get("parse") !== "false";

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const rawName = file.name || "upload.html";
    const htmlName = safeUploadName(rawName);
    if (!htmlName) {
      return NextResponse.json(
        { error: "Invalid filename (use a simple .html name)" },
        { status: 400 }
      );
    }

    const { dumps } = dataPaths();
    mkdirSync(dumps, { recursive: true });
    const dest = join(dumps, htmlName);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length < 100) {
      return NextResponse.json({ error: "File too small" }, { status: 400 });
    }
    if (buf.length > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 25MB)" }, { status: 400 });
    }

    const overwritten = existsSync(dest);
    writeFileSync(dest, buf);
    const result: {
      htmlName: string;
      path: string;
      bytes: number;
      overwritten: boolean;
      job?: ReturnType<typeof startParse>;
    } = {
      htmlName,
      path: dest,
      bytes: buf.length,
      overwritten,
    };

    if (alsoParse) {
      result.job = startParse(htmlName);
    }

    return NextResponse.json(result);
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: Number.isFinite(status) ? status : 500 }
    );
  }
}
