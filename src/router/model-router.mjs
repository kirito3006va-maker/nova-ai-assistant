import { generateGeminiContent } from "../adapters/gemini-adapter.mjs";
import { generateGeminiWebContent, isGeminiWebAvailable } from "../adapters/gemini-web-adapter.mjs";
import { generateClaudeContent, isClaudeAvailable } from "../adapters/claude-adapter.mjs";
import { generateOpenAIContent, isOpenAIAvailable } from "../adapters/openai-adapter.mjs";

let currentMode = "auto"; // "auto" | "quality" | "fast" | "economy" | "coding" | "manual"
let manualModel = null;
const modelCooldowns = new Map(); // key: "provider:model" -> timestamp until cooldown expires

export function clearModelCooldowns() {
  modelCooldowns.clear();
}

export function getActiveMode() {
  return { mode: currentMode, manualModel };
}

export function setActiveMode(mode, model = null) {
  currentMode = mode;
  manualModel = model;
}

export function selectModelChain(prompt, requestedMode = null, hasTools = false) {
  const mode = requestedMode || currentMode;
  const lower = prompt.toLowerCase();
  const chain = [];

  // 1. Si NO requiere herramientas de hardware y Gemini Web está conectado, usar la suscripción Pro
  if (!hasTools && isGeminiWebAvailable()) {
    chain.push({ provider: "gemini_web", model: "Gemini Advanced Web (Plan Pro)" });
  }

  if (mode === "manual" && manualModel) {
    return [{ provider: manualModel.startsWith("claude") ? "anthropic" : manualModel.startsWith("gpt") ? "openai" : "gemini", model: manualModel }];
  }

  if (mode === "fast" || mode === "economy") {
    chain.push(
      { provider: "gemini", model: "gemini-3.5-flash" },
      { provider: "gemini", model: "gemini-3-flash-preview" },
      { provider: "gemini", model: "gemini-3.5-flash-lite" }
    );
    return chain;
  }

  if (mode === "coding") {
    if (isClaudeAvailable()) chain.push({ provider: "anthropic", model: "claude-3-5-sonnet-20241022" });
    if (isOpenAIAvailable()) chain.push({ provider: "openai", model: "gpt-4o" });
    chain.push({ provider: "gemini", model: "gemini-4-argon" });
    chain.push({ provider: "gemini", model: "gemini-3-flash-preview" });
    chain.push({ provider: "gemini", model: "gemini-3.5-flash" });
    return chain;
  }

  if (mode === "quality") {
    chain.push({ provider: "gemini", model: "gemini-4-argon" });
    if (isClaudeAvailable()) chain.push({ provider: "anthropic", model: "claude-3-5-sonnet-20241022" });
    if (isOpenAIAvailable()) chain.push({ provider: "openai", model: "gpt-4o" });
    chain.push({ provider: "gemini", model: "gemini-3.8-flash" });
    chain.push({ provider: "gemini", model: "gemini-3-flash-preview" });
    chain.push({ provider: "gemini", model: "gemini-3.5-flash" });
    return chain;
  }

  // Modo AUTO: Análisis inteligente de requerimiento
  const isHeavy = prompt.length > 350 || /(?:analiza|arquitectura|diseña|algoritmo|explica a fondo|refactoriza|audita)/i.test(lower);
  const isCoding = /(?:c[oó]digo|script|funci[oó]n|programar|powershell|sql|python|javascript|typescript|bug|error)/i.test(lower);

  if (isHeavy || isCoding) {
    if (isClaudeAvailable() && isCoding) {
      chain.push({ provider: "anthropic", model: "claude-3-5-sonnet-20241022" });
    }
    chain.push({ provider: "gemini", model: "gemini-4-argon" });
    if (isOpenAIAvailable()) chain.push({ provider: "openai", model: "gpt-4o" });
    chain.push({ provider: "gemini", model: "gemini-3.8-flash" });
  }

  // Modelos de respaldo de alta velocidad y disponibilidad garantizada
  chain.push({ provider: "gemini", model: "gemini-3-flash-preview" });
  chain.push({ provider: "gemini", model: "gemini-3.5-flash" });
  chain.push({ provider: "gemini", model: "gemini-3.5-flash-lite" });

  return chain;
}

// Ejecución con reintento y conmutación automática entre proveedores
export async function executeRoutedContent({ prompt, systemInstruction = "", tools = [], contents = null }) {
  const hasTools = tools && tools.length > 0;
  const chain = selectModelChain(prompt, null, hasTools);
  let lastError = null;

  for (const target of chain) {
    const key = `${target.provider}:${target.model}`;
    const cooldownUntil = modelCooldowns.get(key) || 0;
    if (Date.now() < cooldownUntil) {
      continue;
    }

    try {
      if (target.provider === "gemini_web") {
        const webRes = await generateGeminiWebContent({ prompt });
        return {
          response: { text: webRes.text, candidates: [{ content: { parts: [{ text: webRes.text }] } }] },
          model: webRes.model,
          provider: webRes.provider,
          images: webRes.images || [],
          usedChain: target,
          usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, latencyMs: 0 }
        };
      }

      if (target.provider === "gemini") {
        const geminiContents = contents || [{ role: "user", parts: [{ text: prompt }] }];
        const result = await generateGeminiContent({
          model: target.model,
          contents: geminiContents,
          config: {
            systemInstruction: systemInstruction || undefined,
            tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined
          }
        });
        return { ...result, usedChain: target };
      }

      if (target.provider === "anthropic" && isClaudeAvailable()) {
        const result = await generateClaudeContent({
          model: target.model,
          prompt,
          system: systemInstruction
        });
        return {
          response: { text: result.text, candidates: [{ content: { parts: [{ text: result.text }] } }] },
          model: target.model,
          provider: "Anthropic Claude",
          usedChain: target,
          usage: result.usage
        };
      }

      if (target.provider === "openai" && isOpenAIAvailable()) {
        const result = await generateOpenAIContent({
          model: target.model,
          prompt,
          system: systemInstruction
        });
        return {
          response: { text: result.text, candidates: [{ content: { parts: [{ text: result.text }] } }] },
          model: target.model,
          provider: "OpenAI ChatGPT",
          usedChain: target,
          usage: result.usage
        };
      }
    } catch (err) {
      const msg = err.message || "";
      if (err.status === 429 || msg.includes("429") || msg.includes("SNlM0e") || msg.includes("RESOURCE_EXHAUSTED")) {
        modelCooldowns.set(key, Date.now() + 5 * 60 * 1000); // 5 min cooldown
      }
      console.warn(`[ModelRouter] Fallo en ${target.provider}:${target.model} (${err.status || msg.slice(0, 45)}). Conmutando...`);
      lastError = err;
    }
  }

  throw lastError || new Error("Todos los modelos configurados fallaron o no están disponibles.");
}
