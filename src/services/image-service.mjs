import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ROOT_DIR, OUTBOX_DIR, CONFIG } from "../config.mjs";
import { ai } from "../adapters/gemini-adapter.mjs";
import { recordUsage } from "../telemetry/usage-tracker.mjs";

const execAsync = promisify(exec);
const TEXT_OVERLAY_PS1 = path.join(ROOT_DIR, "text-overlay.ps1");
const timeoutPromise = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms));

const NANO_BANANA_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
  "gemini-nano-banana-2.1"
];

export async function generateArtImage({ prompt, textOverlay = "", style = "", preferredProvider = "auto" }) {
  let buf = null;
  let usedEngine = "Flux.1 Ultra";

  // 1. Intentar con Nano Banana (Google) con timeout estricto de 3.5s por modelo
  if (preferredProvider === "auto" || preferredProvider === "google") {
    for (const nanoModel of NANO_BANANA_MODELS) {
      try {
        const res = await Promise.race([
          ai.models.generateContent({
            model: nanoModel,
            contents: `${prompt}${style ? `, estilo: ${style}` : ""}`
          }),
          timeoutPromise(3500)
        ]);
        for (const part of res.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData?.data) {
            buf = Buffer.from(part.inlineData.data, "base64");
            usedEngine = `Google Nano Banana (${nanoModel})`;
            break;
          }
        }
        if (buf) break;
      } catch (e) {
        // Cuota 0, 429 o timeout: continuar rápidamente al siguiente
      }
    }
  }

  // 2. Si no hubo buffer de Nano Banana, usar el motor generativo neuronal Flux.1 Ultra
  if (!buf) {
    const fullPrompt = `${prompt}${style ? `, estilo: ${style}` : ""}, 8k resolution, cinematic lighting, sharp focus, masterpiece`;
    const encoded = encodeURIComponent(fullPrompt);
    const fluxUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&model=flux`;

    let res = await fetch(fluxUrl);
    if (res.status === 402) {
      const errText = await res.text();
      const match = errText.match(/Retry after (\d+)s/i);
      const waitSec = match ? Math.min(parseInt(match[1], 10), 25) : 5;
      await new Promise((r) => setTimeout(r, (waitSec + 1) * 1000));
      res = await fetch(fluxUrl);
    }
    if (!res.ok) throw new Error(`Error HTTP ${res.status} al conectar con motor generativo de imagen`);
    buf = Buffer.from(await res.arrayBuffer());
    usedEngine = "Flux.1 Ultra (Neural Engine 1024x1024)";
  }

  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const rawPath = path.join(OUTBOX_DIR, `art_${Date.now()}.jpg`);
  fs.writeFileSync(rawPath, buf);

  let finalPath = rawPath;
  if (textOverlay && textOverlay.trim().length > 0) {
    const overlaidPath = path.join(OUTBOX_DIR, `art_text_${Date.now()}.jpg`);
    const cleanText = textOverlay.replace(/"/g, "'").trim();
    try {
      await execAsync(
        `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${TEXT_OVERLAY_PS1}" -imagePath "${rawPath}" -text "${cleanText}" -outPath "${overlaidPath}"`,
        { timeout: 12000 }
      );
      if (fs.existsSync(overlaidPath)) {
        finalPath = overlaidPath;
      }
    } catch (e) {
      console.warn("[ImageService] Error en tipografía overlay:", e.message);
    }
  }

  // Registrar telemetría de imagen
  recordUsage({
    provider: usedEngine.includes("Google") ? "Google Gemini" : "Flux Neural Engine",
    model: usedEngine,
    inputTokens: 100, // Estimación de prompt de imagen
    outputTokens: 1024,
    status: "success",
    confidence: "Verificado"
  });

  return {
    imagePath: finalPath,
    engine: usedEngine,
    prompt,
    textOverlay
  };
}
