import path from "node:path";
import { runOnInteractiveDesktop, focusRealDesktopWindow, captureRealDesktop } from "./system-service.mjs";
import { ai } from "../adapters/gemini-adapter.mjs";
import { OUTBOX_DIR } from "../config.mjs";

const PORTALS = {
  intranet: "https://intranet.unjfsc.edu.pe",
  unjfsc: "https://intranet.unjfsc.edu.pe",
  whatsapp: "https://web.whatsapp.com",
  gmail: "https://mail.google.com",
  github: "https://github.com",
  gemini: "https://gemini.google.com",
  chatgpt: "https://chatgpt.com",
  youtube: "https://www.youtube.com"
};

/**
 * Abre un portal web conocido o una búsqueda en Google en Brave.
 */
export async function openWebTask(target) {
  const clean = (target || "").toLowerCase().trim();
  let finalUrl = PORTALS[clean];

  if (!finalUrl) {
    if (clean.startsWith("http://") || clean.startsWith("https://")) {
      finalUrl = target;
    } else {
      finalUrl = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    }
  }

  await runOnInteractiveDesktop([
    `start "" "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --new-window "${finalUrl}"`
  ]);

  const shotPath = path.join(OUTBOX_DIR, `browse_${Date.now()}.jpg`);
  await new Promise(r => setTimeout(r, 2500));
  await focusRealDesktopWindow("Brave").catch(() => {});
  await captureRealDesktop(shotPath);

  return {
    url: finalUrl,
    shotPath
  };
}

/**
 * Descarga y resume el contenido de una página web usando Gemini.
 */
export async function summarizeWebPage(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const html = await res.text();
    // Limpieza básica de HTML
    const textOnly = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 15000);

    const prompt = `Resume los puntos más importantes y las conclusiones clave del siguiente texto web extraído de ${url}:\n\n${textOnly}`;
    const aiRes = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt
    });

    return {
      status: "success",
      url,
      summary: aiRes.text || "No se pudo generar el resumen."
    };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}
