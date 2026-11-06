import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { dataPaths } from "@/lib/paths";
import { startParse } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── MHT/MHTML extraction ────────────────────────────────────────────────────

/** Decode quoted-printable encoding (used by Chrome MHT exports). */
function decodeQP(str: string): string {
  return str
    .replace(/=\r\n/g, "")   // CRLF soft line break
    .replace(/=\n/g, "")      // LF soft line break
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

/**
 * Extract the first text/html part from an MHT/MHTML buffer.
 * Returns the HTML as a Buffer ready to be saved as .html.
 */
function extractHtmlFromMht(buf: Buffer): Buffer {
  const raw = buf.toString("binary"); // preserve byte values during MIME parse

  // Find multipart boundary
  const boundaryM = raw.match(/boundary=(?:"([^"]+)"|([^\r\n;]+))/i);
  if (!boundaryM) throw new Error("MHT: no multipart boundary found");
  const boundary = (boundaryM[1] ?? boundaryM[2]).trim();

  // Split into MIME parts
  const parts = raw.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?`));

  for (const part of parts) {
    if (!/content-type:\s*text\/html/i.test(part)) continue;

    // Find blank line separating headers from body
    const sep = part.indexOf("\r\n\r\n");
    const sep2 = part.indexOf("\n\n");
    if (sep < 0 && sep2 < 0) continue;
    const headerEnd = sep >= 0 ? sep + 4 : sep2 + 2;

    const headers = part.slice(0, headerEnd);
    const body = part.slice(headerEnd).replace(/\r\n$/, "").replace(/\n$/, "");

    const encM = headers.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = encM?.[1]?.toLowerCase() ?? "7bit";

    if (encoding === "base64") {
      return Buffer.from(body.replace(/\s+/g, ""), "base64");
    } else if (encoding === "quoted-printable") {
      // QP was parsed in binary mode; decode byte by byte
      return Buffer.from(decodeQP(body), "binary");
    } else {
      return Buffer.from(body, "binary");
    }
  }

  throw new Error("MHT: no text/html part found — make sure you saved the full page");
}

// ── filename helpers ─────────────────────────────────────────────────────────

const ACCEPTED_EXTS = /\.(html?|mht(ml?)?)$/i;

function safeUploadName(name: string): string | null {
  const base = basename(name);
  if (!base || base.includes("..") || !ACCEPTED_EXTS.test(base)) return null;
  // Strip extension, sanitize stem: replace any run of non-alphanumeric chars with a hyphen
  const rawStem = base.replace(ACCEPTED_EXTS, "");
  const stem = rawStem
    .replace(/[^a-zA-Z0-9._-]+/g, "-") // spaces, parens, etc → hyphen
    .replace(/^-+|-+$/g, "")            // trim leading/trailing hyphens
    .slice(0, 120)                       // cap length
    || "upload";                         // fallback if stem collapses entirely
  return `${stem}.html`;
}

function isMht(name: string): boolean {
  return /\.mht(ml?)?$/i.test(name);
}

// ── route ────────────────────────────────────────────────────────────────────

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
        { error: `Unsupported file type. Upload an .html, .htm, .mht, or .mhtml file.` },
        { status: 400 }
      );
    }

    const { dumps } = dataPaths();
    mkdirSync(dumps, { recursive: true });
    const dest = join(dumps, htmlName);

    let buf: Buffer = Buffer.from(await file.arrayBuffer());
    if (buf.length < 100) {
      return NextResponse.json({ error: "File too small" }, { status: 400 });
    }
    if (buf.length > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 400 });
    }

    // Extract HTML from MHT/MHTML container
    if (isMht(rawName)) {
      try {
        buf = extractHtmlFromMht(buf);
      } catch (e) {
        return NextResponse.json(
          { error: `MHT extraction failed: ${e instanceof Error ? e.message : e}` },
          { status: 400 }
        );
      }
    }

    const overwritten = existsSync(dest);
    writeFileSync(dest, buf);

    const result: {
      htmlName: string;
      path: string;
      bytes: number;
      overwritten: boolean;
      convertedFromMht?: boolean;
      job?: ReturnType<typeof startParse>;
    } = {
      htmlName,
      path: dest,
      bytes: buf.length,
      overwritten,
      convertedFromMht: isMht(rawName),
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
