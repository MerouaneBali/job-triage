import Anthropic from "@anthropic-ai/sdk";
import { config as loadDotenv } from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import {
  appendChatMessage,
  clearJobChat,
  getJobChatMessages,
  getJobRowForChat,
} from "@/lib/dumps";
import { dataPaths } from "@/lib/paths";
import type { Materials } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Load ANTHROPIC_API_KEY from root .env if not already in env
loadDotenv({ path: dataPaths().envFile, override: false });

type Ctx = { params: Promise<{ id: string }> };

// ─── GET: fetch chat history ─────────────────────────────────────────────────

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const dumpName = searchParams.get("dumpName");
  if (!dumpName) {
    return NextResponse.json({ error: "dumpName query param required" }, { status: 400 });
  }
  const messages = getJobChatMessages(dumpName, id);
  return NextResponse.json({ messages });
}

// ─── DELETE: clear chat history ──────────────────────────────────────────────

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const dumpName = searchParams.get("dumpName");
  if (!dumpName) {
    return NextResponse.json({ error: "dumpName query param required" }, { status: 400 });
  }
  clearJobChat(dumpName, id);
  return NextResponse.json({ ok: true });
}

// ─── POST: send a message, stream the reply ──────────────────────────────────

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  const body = (await req.json()) as { dumpName?: string; message?: string };
  const { dumpName, message } = body;

  if (!dumpName || !message?.trim()) {
    return NextResponse.json(
      { error: "dumpName and message are required" },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  // Load the job
  const job = getJobRowForChat(dumpName, id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Load candidate profile from disk
  const { root } = dataPaths();
  const profileDir = join(root, "data", "profile");
  const canonicalPath = join(profileDir, "canonical.json");
  const prefsPath = join(profileDir, "preferences.md");
  const canonical = existsSync(canonicalPath)
    ? JSON.parse(readFileSync(canonicalPath, "utf-8"))
    : {};
  const preferences = existsSync(prefsPath)
    ? readFileSync(prefsPath, "utf-8")
    : "";

  // Load existing conversation history
  const history = getJobChatMessages(dumpName, id);

  // Save the user message now (before streaming, so it's persisted even if client disconnects)
  const trimmed = message.trim();
  appendChatMessage(dumpName, id, "user", trimmed);

  // Build Anthropic messages array from history + new message
  const anthropicMessages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: trimmed },
  ];

  const system = buildChatSystem(job, canonical, preferences);
  const anthropic = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  // Stream the response
  const readable = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        const stream = anthropic.messages.stream({
          model: "claude-opus-4-5",
          max_tokens: 1500,
          system,
          messages: anthropicMessages,
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const text = event.delta.text;
            fullText += text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
            );
          }
        }

        // Persist the assistant reply
        if (fullText) {
          appendChatMessage(dumpName, id, "assistant", fullText);
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── System prompt ───────────────────────────────────────────────────────────

function buildChatSystem(
  job: ReturnType<typeof getJobRowForChat> & object,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canonical: any,
  preferences: string
): string {
  const materials = job.materials as Materials | null;

  const materialsBlock = materials
    ? [
        materials.coverLetter ? `Cover letter:\n${materials.coverLetter}` : null,
        materials.outreachMessage
          ? `Outreach message:\n${materials.outreachMessage}`
          : null,
        materials.strategy ? `Strategy:\n${materials.strategy}` : null,
        materials.questionsToAsk?.length
          ? `Questions to ask:\n${materials.questionsToAsk.map((q) => `- ${q}`).join("\n")}`
          : null,
        materials.cvTailoringSuggestions?.length
          ? `CV tailoring suggestions:\n${materials.cvTailoringSuggestions.map((s) => `- ${s}`).join("\n")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n")
    : "None generated yet.";

  const evalBlock = job.evaluation
    ? JSON.stringify(job.evaluation, null, 2)
    : "Not evaluated yet.";

  return `You are a job application assistant for a specific candidate. Your job is to help with this particular job application in any way that is useful — answering questions, writing custom responses to application form questions, refining materials, thinking through negotiation, suggesting talking points, preparing interview answers, flagging concerns, or anything else.

You have full context. Use it. Do not ask the candidate for information you already have.

--- CANDIDATE PROFILE ---
${JSON.stringify(canonical, null, 2)}

--- PREFERENCES & WRITING GUIDELINES ---
${preferences}

--- JOB ---
Title: ${job.title ?? "Unknown"}
Company: ${job.company ?? "Unknown"}
Location: ${job.location ?? "Unknown"}
Salary: ${job.salary ?? "Not listed"}
URL: ${job.url ?? ""}
Description:
${job.description ?? "No description available."}

--- EVALUATION ---
${evalBlock}

--- MATERIALS GENERATED SO FAR ---
${materialsBlock}

--- INSTRUCTIONS ---
- Be direct and practical. No filler.
- Match the candidate's writing style from the preferences: no em dashes, no AI clichés, no forbidden phrases.
- When writing something (a form answer, a custom note, etc.) keep it human and brief unless length is specifically requested.
- If the candidate asks you to draft something, draft it — don't just describe what it should say.
- You can carry on a multi-turn conversation. Reference earlier messages in this thread when relevant.`;
}
