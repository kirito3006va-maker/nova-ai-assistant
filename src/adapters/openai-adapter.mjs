import OpenAI from "openai";
import { CONFIG } from "../config.mjs";
import { recordUsage } from "../telemetry/usage-tracker.mjs";

let client = null;
if (CONFIG.providers.openai.apiKey) {
  client = new OpenAI({ apiKey: CONFIG.providers.openai.apiKey });
}

export function isOpenAIAvailable() {
  return Boolean(CONFIG.providers.openai.apiKey);
}

export async function generateOpenAIContent({ model = "gpt-4o", prompt, system = "" }) {
  if (!isOpenAIAvailable()) {
    throw new Error("OpenAI ChatGPT no tiene API key configurada en .env (OPENAI_API_KEY).");
  }

  const startTime = Date.now();
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const completion = await client.chat.completions.create({
    model,
    messages
  });

  const usage = completion.usage || {};
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;

  recordUsage({
    provider: "OpenAI ChatGPT",
    model,
    inputTokens,
    outputTokens,
    reasoningTokens,
    status: "success",
    confidence: "Verificado"
  });

  const text = completion.choices?.[0]?.message?.content || "";

  return {
    text,
    model,
    provider: "OpenAI ChatGPT",
    usage: {
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs: Date.now() - startTime
    }
  };
}
