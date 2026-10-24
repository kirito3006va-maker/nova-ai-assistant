import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ROOT_DIR, OUTBOX_DIR } from "../config.mjs";
import { captureRealDesktop } from "./system-service.mjs";
import { ai } from "../adapters/gemini-adapter.mjs";

const execAsync = promisify(exec);
const DESKTOP_HELPER = path.join(ROOT_DIR, "desktop-helper.ps1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function moveCursor(x, y) {
  const safeX = Math.round(Number(x) || 0);
  const safeY = Math.round(Number(y) || 0);
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${DESKTOP_HELPER}" move ${safeX} ${safeY}`;
  await execAsync(cmd, { timeout: 6000 });
  return { status: "success", action: "move", x: safeX, y: safeY };
}

export async function clickMouse(x, y, button = "left") {
  const safeX = Math.round(Number(x) || 0);
  const safeY = Math.round(Number(y) || 0);
  const actionType = button === "right" ? "rightclick" : button === "double" ? "doubleclick" : "click";
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${DESKTOP_HELPER}" ${actionType} ${safeX} ${safeY}`;
  await execAsync(cmd, { timeout: 8000 });
  return { status: "success", action: actionType, x: safeX, y: safeY };
}

export async function doubleClickMouse(x, y) {
  return await clickMouse(x, y, "double");
}

export async function rightClickMouse(x, y) {
  return await clickMouse(x, y, "right");
}

export async function scrollWheel(amount = -300) {
  const safeAmt = Math.round(Number(amount) || -300);
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${DESKTOP_HELPER}" scroll ${safeAmt}`;
  await execAsync(cmd, { timeout: 6000 });
  return { status: "success", action: "scroll", amount: safeAmt };
}

export async function typeTextOnScreen(text) {
  const safeText = text.replace(/[{}[\]()^%+~]/g, "{$&}");
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${DESKTOP_HELPER}" type "${safeText}"`;
  await execAsync(cmd, { timeout: 8000 });
  return { status: "success", action: "type", text };
}

/**
 * Control visual autónomo del puntero (Visual Grounding + Click):
 * Ubica visualmente el elemento pedido en la pantalla 1080p y hace clic sobre él.
 */
export async function locateAndClickElement({ query, button = "left" }) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const initialShot = path.join(OUTBOX_DIR, `grounding_before_${Date.now()}.jpg`);
  const followUpShot = path.join(OUTBOX_DIR, `grounding_after_${Date.now()}.jpg`);

  // 1. Capturar estado actual de la pantalla
  await captureRealDesktop(initialShot);
  const imgBuffer = fs.readFileSync(initialShot);
  const base64Data = imgBuffer.toString("base64");

  // 2. Consultar a Gemini Multimodal para extraer coordenadas X, Y exactas en píxeles
  const prompt =
    `Eres el sistema de control de puntero de Nova en la laptop Lenovo LOQ con resolución de pantalla física 1920x1080.\n` +
    `Kirito te pide hacer clic en el siguiente elemento visual: "${query}".\n\n` +
    `INSTRUCCIONES DE VISUAL GROUNDING:\n` +
    `- Localiza con extrema precisión el centro del botón, pestaña, enlace, campo de texto o icono solicitado.\n` +
    `- La resolución total de la imagen es 1920 de ancho (X) por 1080 de alto (Y).\n` +
    `- Devuelve las coordenadas en formato JSON estricto con las claves: "x", "y", "label", "elementFound".\n` +
    `- Ejemplo: {"x": 1250, "y": 480, "label": "Botón Iniciar Sesión", "elementFound": true}\n` +
    `- Si no encuentras el elemento solicitado, devuelve: {"elementFound": false, "reason": "descripción de por qué no se ve"}.\n` +
    `RESPONDE ÚNICAMENTE EL OBJETO JSON, sin texto antes ni después.`;

  try {
    const res = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Data } }
          ]
        }
      ]
    });

    const rawReply = (res.text || "").trim();
    const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Respuesta de visión no interpretable: ${rawReply.slice(0, 100)}`);
    }

    const data = JSON.parse(jsonMatch[0]);
    if (!data.elementFound || typeof data.x !== "number" || typeof data.y !== "number") {
      return {
        status: "not_found",
        message: data.reason || `No localicé "${query}" visible en la pantalla actual.`,
        initialShot
      };
    }

    // 3. Mover y hacer clic
    const clickX = Math.max(0, Math.min(1920, Math.round(data.x)));
    const clickY = Math.max(0, Math.min(1080, Math.round(data.y)));

    await clickMouse(clickX, clickY, button);
    await sleep(1500);

    // 4. Captura de verificación
    await captureRealDesktop(followUpShot);

    return {
      status: "success",
      element: data.label || query,
      x: clickX,
      y: clickY,
      initialShot,
      followUpShot,
      message: `Clic realizado en "${data.label || query}" en coordenadas (${clickX}, ${clickY}).`
    };
  } catch (err) {
    return {
      status: "error",
      message: `Error al interactuar con el puntero: ${err.message}`,
      initialShot
    };
  }
}
