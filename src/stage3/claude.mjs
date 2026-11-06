/**
 * Anthropic Claude client with retries and usage logging.
 *
 * Sonnet 5.5 rejects forced tool_choice ("tool" / "any"). Use auto + strict
 * tools and prompt the model to call the tool (see Anthropic migration guide).
 */

import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-5-5";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createClaudeClient(env = process.env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Copy .env.example to .env and set your key."
    );
  }
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

  // Accumulated usage since last drainUsage() call
  let accum = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };

  /** Return accumulated usage since last drain and reset the counter. */
  function drainUsage() {
    const snap = { ...accum };
    accum = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
    return snap;
  }

  /**
   * Call Claude with a strict tool and return validated tool input.
   * Relies on prompt instructions (not forced tool_choice) to invoke the tool.
   */
  async function toolCall({
    system,
    user,
    tool,
    maxTokens = 4096,
    retries = 3,
  }) {
    const strictTool = { ...tool, strict: true };
    const userWithToolHint = `${user}

Respond by calling the ${tool.name} tool with your complete result. Do not reply with plain text.`;

    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          tools: [strictTool],
          tool_choice: { type: "auto" },
          messages: [{ role: "user", content: userWithToolHint }],
        });

        const usage = res.usage || {};
        console.log(
          `  Claude ${model}: in=${usage.input_tokens ?? "?"} out=${usage.output_tokens ?? "?"} stop=${res.stop_reason}`
        );

        // Accumulate for drainUsage()
        accum.input_tokens += usage.input_tokens || 0;
        accum.output_tokens += usage.output_tokens || 0;
        accum.cache_read_tokens += usage.cache_read_input_tokens || 0;
        accum.cache_write_tokens += usage.cache_creation_input_tokens || 0;

        const block = (res.content || []).find(
          (b) => b.type === "tool_use" && b.name === tool.name
        );
        if (!block) {
          throw new Error(
            `No tool_use block for ${tool.name} (stop=${res.stop_reason})`
          );
        }
        return { input: block.input, usage, model, raw: res };
      } catch (e) {
        lastErr = e;
        const status = e?.status || e?.statusCode;
        const retryable =
          status === 429 ||
          status === 500 ||
          status === 529 ||
          status === 503 ||
          /No tool_use block/.test(String(e?.message || e));
        console.warn(
          `  Claude attempt ${attempt}/${retries} failed: ${e.message || e}`
        );
        if (!retryable || attempt === retries) break;
        await sleep(1000 * attempt * attempt);
      }
    }
    throw lastErr;
  }

  return { model, toolCall, drainUsage };
}

export default createClaudeClient;
