import { execFile } from "node:child_process";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Claude can take up to 30s — allow generous timeout
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!id || id.includes("..") || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const body = (await req.json()) as {
    dumpBasename?: string;
    what?: string[]; // 'coverLetter' | 'outreach' | 'questions' | 'cv'
    force?: boolean;
  };

  const what = Array.isArray(body.what) && body.what.length > 0
    ? body.what.filter((w) =>
        ["coverLetter", "outreach", "questions", "cv", "strategy"].includes(w)
      )
    : ["coverLetter", "outreach", "questions", "cv", "strategy"];

  if (what.length === 0) {
    return NextResponse.json({ error: "No valid items in 'what'" }, { status: 400 });
  }

  const root = process.cwd().endsWith("/web")
    ? join(process.cwd(), "..")
    : process.cwd();

  const scriptArgs = [
    join(root, "src", "stage3", "generate-one.mjs"),
    id,
    "--what",
    what.join(","),
  ];
  if (body.dumpBasename) scriptArgs.push("--dump", body.dumpBasename);
  if (body.force) scriptArgs.push("--force");

  return new Promise<NextResponse>((resolve) => {
    execFile(
      process.execPath,
      scriptArgs,
      {
        cwd: root,
        timeout: 110_000,
        env: { ...process.env },
      },
      (err, stdout, stderr) => {
        if (stderr) {
          // stderr is for progress logs — log to server console
          process.stderr.write(stderr);
        }
        if (err) {
          resolve(
            NextResponse.json(
              { error: stderr.trim() || err.message || "Generate failed" },
              { status: 500 }
            )
          );
          return;
        }
        // Find the JSON line in stdout (the script may print progress before it)
        const lines = stdout.trim().split("\n");
        const jsonLine = lines.findLast((l) => l.startsWith("{"));
        if (!jsonLine) {
          resolve(
            NextResponse.json(
              { error: "No JSON output from generate script" },
              { status: 500 }
            )
          );
          return;
        }
        try {
          const result = JSON.parse(jsonLine) as { ok: boolean; materials: unknown };
          resolve(NextResponse.json(result));
        } catch {
          resolve(
            NextResponse.json({ error: "Failed to parse script output" }, { status: 500 })
          );
        }
      }
    );
  });
}
