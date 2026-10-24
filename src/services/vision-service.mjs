import fs from "node:fs";
import path from "node:path";
import { InputFile } from "grammy";
import { ROOT_DIR, OUTBOX_DIR } from "../config.mjs";
import { ai } from "../adapters/gemini-adapter.mjs";
import { captureRealDesktop } from "./system-service.mjs";
import { recordUsage } from "../telemetry/usage-tracker.mjs";

/**
 * Captura la pantalla física de la laptop y realiza un análisis visual profundo con Gemini Multimodal.
 */
export async function analyzeScreenVisual({ query = "¿Qué hay en mi pantalla?", ctx = null }) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const shotPath = path.join(OUTBOX_DIR, `vision_${Date.now()}.jpg`);

  // 1. Capturar pantalla real en 1080p
  await captureRealDesktop(shotPath);
  const imgBuffer = fs.readFileSync(shotPath);
  const base64Data = imgBuffer.toString("base64");

  // 2. Invocar Gemini Multimodal
  const promptText =
    `Eres el asistente inteligente Antigravity analizando en tiempo real la pantalla física de la laptop Lenovo LOQ de Kirito.\n` +
    `Kirito te hace la siguiente pregunta sobre lo que está viendo: "${query}".\n\n` +
    `Instrucciones de análisis:\n` +
    `- Sé directo, observador y extremadamente preciso.\n` +
    `- Si hay código o un error en pantalla (ej: NetBeans, VS Code, terminal), léelo y explica la causa y la solución exacta.\n` +
    `- Si hay un video, juego, streaming o chat (ej: YouTube, Worlds, WhatsApp), describe qué está sucediendo, nombres de equipos, jugadores, resultado o mensajes visibles.\n` +
    `- Si hay un documento o página web, sintetiza los puntos clave.\n` +
    `- Formato: Markdown limpio con viñetas cuando sea apropiado.`;

  let analysisText = "";
  let usedModel = "gemini-3.5-flash";

  try {
    const res = await ai.models.generateContent({
      model: usedModel,
      contents: [
        {
          role: "user",
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }
      ]
    });

    analysisText = res.text || "No pude interpretar con certeza los detalles de la pantalla.";

    // Telemetría de tokens
    const meta = res.usageMetadata || {};
    recordUsage({
      provider: "Google Gemini",
      model: usedModel,
      inputTokens: meta.promptTokenCount || 400,
      outputTokens: meta.candidatesTokenCount || 200,
      cachedTokens: meta.cachedContentTokenCount || 0,
      status: "success",
      confidence: "Verificado Multimodal"
    });
  } catch (e) {
    analysisText = `⚠️ Error en análisis de visión: ${e.message}`;
  }

  // 3. Enviar foto y respuesta a Telegram si se dispone de ctx
  if (ctx) {
    try {
      await ctx.replyWithPhoto(new InputFile(shotPath), {
        caption: `👁️ *Análisis Visual de tu Pantalla:*\n\n${analysisText.slice(0, 950)}`,
        parse_mode: "Markdown"
      });
      if (analysisText.length > 950) {
        await ctx.reply(analysisText.slice(950), { parse_mode: "Markdown" });
      }
    } catch {
      await ctx.reply(`👁️ *Análisis Visual:*\n\n${analysisText}`);
    }
  }

  return {
    shotPath,
    analysis: analysisText,
    model: usedModel
  };
}
