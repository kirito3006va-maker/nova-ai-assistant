import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "../config.mjs";
import { recordUsage } from "../telemetry/usage-tracker.mjs";

let client = null;
if (CONFIG.providers.anthropic.apiKey) {
  client = new Anthropic({ apiKey: CONFIG.providers.anthropic.apiKey });
}

export function isClaudeAvailable() {
  return Boolean(CONFIG.providers.anthropic.apiKey);
}

export async function generateClaudeContent({ model = "claude-3-5-sonnet-20241022", prompt, system = "", maxTokens = 4096 }) {
  if (!isClaudeAvailable()) {
    throw new Error("Anthropic Claude no tiene API key configurada en .env (ANTHROPIC_API_KEY).");
  }

  const startTime = Date.now();
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: system || undefined,
    messages: [{ role: "user", content: prompt }]
  });

  const inputTokens = message.usage?.input_tokens || 0;
  const outputTokens = message.usage?.output_tokens || 0;

  recordUsage({
    provider: "Anthropic Claude",
    model,
    inputTokens,
    outputTokens,
    status: "success",
    confidence: "Verificado"
  });

  const text = message.content
    .filter(c => c.type === "text")
    .map(c => c.text)
    .join("\n");

  return {
    text,
    model,
    provider: "Anthropic Claude",
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs: Date.now() - startTime
    }
  };
}
