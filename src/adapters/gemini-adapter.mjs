import { GoogleGenAI } from "@google/genai";
import { CONFIG } from "../config.mjs";
import { recordUsage } from "../telemetry/usage-tracker.mjs";

const ai = new GoogleGenAI({ apiKey: CONFIG.providers.gemini.apiKey });

export async function generateGeminiContent({ model, contents, config = {} }) {
  const startTime = Date.now();
  
  // Activar razonamiento en HIGH por defecto para modelos compatibles
  const enrichedConfig = { ...config };
  if (!enrichedConfig.thinkingConfig && (model.includes("flash") || model.includes("pro") || model.includes("argon"))) {
    enrichedConfig.thinkingConfig = { thinkingLevel: "HIGH" };
  }

  const response = await ai.models.generateContent({
    model,
    contents,
    config: enrichedConfig
  });

  // Extraer telemetría oficial de tokens
  const usage = response.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
  const cachedTokens = usage.cachedContentTokenCount || 0;

  recordUsage({
    provider: "Google Gemini",
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    status: "success",
    confidence: "Verificado"
  });

  return {
    response,
    model,
    provider: "Google Gemini",
    usage: {
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs: Date.now() - startTime
    }
  };
}

export { ai };
