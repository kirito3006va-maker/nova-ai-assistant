import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { CONFIG, OUTBOX_DIR, DATA_DIR, ROOT_DIR } from "../config.mjs";

const SESSION_FILE = path.join(DATA_DIR, "gemini_web_session.json");
const ENV_FILE = path.join(ROOT_DIR, ".env");

let cachedSnToken = null;
let cachedBlToken = null;
let keepAliveInterval = null;

/**
 * Cliente HTTPS nativo con maxHeaderSize de 256 KB para soportar las cabeceras grandes
 * (Link / CSP / Set-Cookie) de gemini.google.com sin error UND_ERR_HEADERS_OVERFLOW.
 */
function httpsRequest(urlStr, { method = "GET", headers = {}, body = null, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const req = https.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers,
        maxHeaderSize: 262144 // 256 KB
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          captureAndPersistSetCookies(res.headers["set-cookie"]);
          resolve({
            status: res.statusCode || 0,
            ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
            headers: res.headers,
            buffer,
            text: () => buffer.toString("utf8")
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Tiempo de espera agotado al consultar Gemini Web."));
    });

    req.on("error", (err) => reject(err));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Captura automáticamente cookies rotadas (__Secure-1PSIDTS / __Secure-1PSID) desde Set-Cookie
 * y las persiste en memoria y en .env para mantener viva la sesión de Gemini Web.
 */
function captureAndPersistSetCookies(setCookiesHeader) {
  try {
    if (!setCookiesHeader) return;
    const setCookies = Array.isArray(setCookiesHeader) ? setCookiesHeader : [setCookiesHeader];
    if (setCookies.length === 0) return;

    let newPsid = null;
    let newPsidts = null;

    for (const sc of setCookies) {
      const mPsidts = sc.match(/__Secure-1PSIDTS=([^;\s]+)/);
      if (mPsidts && mPsidts[1] && mPsidts[1] !== "deleted") {
        newPsidts = mPsidts[1];
      }
      const mPsid = sc.match(/__Secure-1PSID=([^;\s]+)/);
      if (mPsid && mPsid[1] && mPsid[1] !== "deleted") {
        newPsid = mPsid[1];
      }
    }

    let updated = false;
    let envContent = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";

    if (newPsid && newPsid !== CONFIG.providers.geminiWeb.psid) {
      CONFIG.providers.geminiWeb.psid = newPsid;
      if (envContent.includes("GEMINI_WEB_COOKIE_1PSID=")) {
        envContent = envContent.replace(/GEMINI_WEB_COOKIE_1PSID=.*(\r?\n|$)/, `GEMINI_WEB_COOKIE_1PSID=${newPsid}$1`);
      } else {
        envContent += `\nGEMINI_WEB_COOKIE_1PSID=${newPsid}\n`;
      }
      updated = true;
    }

    if (newPsidts && newPsidts !== CONFIG.providers.geminiWeb.psidts) {
      CONFIG.providers.geminiWeb.psidts = newPsidts;
      if (envContent.includes("GEMINI_WEB_COOKIE_1PSIDTS=")) {
        envContent = envContent.replace(/GEMINI_WEB_COOKIE_1PSIDTS=.*(\r?\n|$)/, `GEMINI_WEB_COOKIE_1PSIDTS=${newPsidts}$1`);
      } else {
        envContent += `\nGEMINI_WEB_COOKIE_1PSIDTS=${newPsidts}\n`;
      }
      updated = true;
    }

    if (updated) {
      fs.writeFileSync(ENV_FILE, envContent, "utf8");
      console.log("[gemini-web] 🔄 Cookie __Secure-1PSIDTS auto-renovada y guardada en .env.");
    }
  } catch (err) {
    console.warn("[gemini-web] Error capturando Set-Cookie:", err.message);
  }
}

export function loadNotebookSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      if (data && data.conversationId) {
        return [data.conversationId, data.responseId || "", data.choiceId || ""];
      }
    }
  } catch {}
  return ["", "", ""];
}

export function getNotebookMetadata() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    }
  } catch {}
  return null;
}

export function saveNotebookSession(ctxArray, title = "Cuaderno Dedicado de Nova ⚡ Kirito") {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      conversationId: ctxArray[0] || "",
      responseId: ctxArray[1] || "",
      choiceId: ctxArray[2] || "",
      title,
      assistantName: "Nova",
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.warn("[gemini-web] Error guardando sesión de cuaderno:", err.message);
  }
}

export function resetNotebookSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch {}
  conversationContext = ["", "", ""];
  return { status: "reset", message: "Cuaderno de Nova reiniciado. El próximo mensaje abrirá un nuevo hilo limpio en Gemini Web." };
}

let conversationContext = loadNotebookSession();

export function isGeminiWebAvailable() {
  return Boolean(CONFIG.providers.geminiWeb.psid && CONFIG.providers.geminiWeb.enabled);
}

/**
 * Descarga una imagen generada por Imagen 3 / Gemini Web siguiendo redirecciones autenticadas
 */
export async function downloadGeminiWebImage(initialUrl) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const cookieStr = `__Secure-1PSID=${CONFIG.providers.geminiWeb.psid}; __Secure-1PSIDTS=${CONFIG.providers.geminiWeb.psidts || ""};`;
  let currUrl = initialUrl.includes("=s") ? initialUrl.replace(/=s\d+.*$/, "=s0") : `${initialUrl}=s0`;
  let finalBuffer = null;

  for (let hop = 1; hop <= 8; hop++) {
    const res = await httpsRequest(currUrl, {
      method: "GET",
      headers: {
        Cookie: cookieStr,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        Referer: "https://gemini.google.com/"
      }
    });

    const nextLoc = res.headers["location"];
    if (!nextLoc) {
      finalBuffer = res.buffer;
      break;
    }
    const resolvedNext = nextLoc.startsWith("http") ? nextLoc : new URL(nextLoc, currUrl).toString();
    currUrl = resolvedNext.includes("=s") ? resolvedNext.replace(/=s\d+$/, "=s0") : resolvedNext;
  }

  if (!finalBuffer || finalBuffer.length < 2000) {
    throw new Error("No se pudo descargar la imagen generada por Gemini Web.");
  }

  const filePath = path.join(OUTBOX_DIR, `gemini_imagen_${Date.now()}.jpg`);
  fs.writeFileSync(filePath, finalBuffer);
  return { filePath, sizeBytes: finalBuffer.length };
}

/**
 * Obtiene los tokens de sesión internos de Gemini Web (SNlM0e y cfb2h) siguiendo redirecciones con 256KB de cabecera
 */
export async function refreshWebTokens() {
  cachedSnToken = null;
  cachedBlToken = null;
  const cookieStr = `__Secure-1PSID=${CONFIG.providers.geminiWeb.psid}; __Secure-1PSIDTS=${CONFIG.providers.geminiWeb.psidts || ""};`;

  try {
    await httpsRequest("https://accounts.google.com/RotateCookiesPage", {
      method: "POST",
      headers: {
        Cookie: cookieStr,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        Origin: "https://gemini.google.com",
        Referer: "https://gemini.google.com/"
      },
      body: JSON.stringify([658, "-1000000000000000000"])
    });
  } catch {}

  const updatedCookieStr = `__Secure-1PSID=${CONFIG.providers.geminiWeb.psid}; __Secure-1PSIDTS=${CONFIG.providers.geminiWeb.psidts || ""};`;

  let currUrl = "https://gemini.google.com/app?hl=es_419";
  let html = "";

  for (let hop = 0; hop < 4; hop++) {
    const appRes = await httpsRequest(currUrl, {
      method: "GET",
      headers: {
        Cookie: updatedCookieStr,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "Accept-Language": "es-419,es;q=0.9,en;q=0.8"
      }
    });

    if (appRes.headers["location"]) {
      currUrl = appRes.headers["location"].startsWith("http")
        ? appRes.headers["location"]
        : new URL(appRes.headers["location"], currUrl).toString();
      continue;
    }

    if (!appRes.ok) {
      throw new Error(`Error HTTP ${appRes.status} al validar sesión en gemini.google.com`);
    }

    html = appRes.text();
    break;
  }

  const snMatch = html.match(/"SNlM0e":"(.*?)"/);
  const blMatch = html.match(/"cfb2h":"(.*?)"/);

  if (!snMatch) {
    throw new Error("No se pudo extraer el token SNlM0e. Es posible que las cookies hayan expirado.");
  }

  cachedSnToken = snMatch[1];
  cachedBlToken = blMatch ? blMatch[1] : "boq_gemini-web-uiserver_20261023.01_p0";
  return { snToken: cachedSnToken, blToken: cachedBlToken };
}

/**
 * Mantiene viva la sesión de Gemini Web refrescando tokens y capturando Set-Cookie cada 8 minutos
 */
export function startGeminiWebKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(async () => {
    if (!isGeminiWebAvailable()) return;
    try {
      await refreshWebTokens();
      console.log("[gemini-web] 💓 Keep-Alive de sesión Gemini Web completado.");
    } catch (e) {
      console.warn("[gemini-web] ⚠️ Keep-Alive aviso:", e.message);
    }
  }, 8 * 60 * 1000);
}

/**
 * Envía un prompt al Cuaderno Dedicado de Nova en Gemini Advanced Web
 */
export async function generateGeminiWebContent({ prompt, resetConversation = false }) {
  if (!isGeminiWebAvailable()) {
    throw new Error("Gemini Web no está configurado (faltan cookies en .env)");
  }

  if (resetConversation) {
    resetNotebookSession();
  } else if (!conversationContext[0]) {
    conversationContext = loadNotebookSession();
  }

  const isFirstTurn = !conversationContext[0];
  let finalPrompt = prompt;

  if (isFirstTurn) {
    finalPrompt =
      "[Directiva del Cuaderno: Eres 'Nova', la IA y co-piloto de élite de Kirito (estudiante de Ingeniería Informática), inspirada en una versión femenina de JARVIS / FRIDAY. Habla con serenidad, elocuencia, perspicacia y humor sutil e inteligente. PROHIBIDO TERMINANTEMENTE usar apodos románticos o de pareja (amor, cariño, cielo, etc.); dirígete a él como 'Kirito'. REGLA ESTRICTA: NO menciones especificaciones de hardware a menos que él te lo pida explícitamente].\n\n" +
      prompt;
  }

  if (!cachedSnToken || !cachedBlToken) {
    await refreshWebTokens();
  }

  const cookieStr = `__Secure-1PSID=${CONFIG.providers.geminiWeb.psid}; __Secure-1PSIDTS=${CONFIG.providers.geminiWeb.psidts || ""};`;
  const reqId = Math.floor(Math.random() * 900000) + 100000;

  const innerPayload = [
    [finalPrompt, 0, null, null, null, null, 0],
    ["es"],
    conversationContext,
    null,
    null,
    null,
    [0],
    1,
    null,
    null,
    null,
    null,
    null,
    []
  ];

  const freq = JSON.stringify([null, JSON.stringify(innerPayload)]);
  const params = new URLSearchParams();
  params.append("f.req", freq);
  params.append("at", cachedSnToken);

  const streamUrl = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${cachedBlToken}&_reqid=${reqId}&rt=c`;

  const res = await httpsRequest(streamUrl, {
    method: "POST",
    timeoutMs: 65000,
    headers: {
      Cookie: cookieStr,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      Origin: "https://gemini.google.com",
      Referer: "https://gemini.google.com/",
      "X-Same-Domain": "1",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
    },
    body: params.toString()
  });

  if (res.status === 401 || res.status === 403) {
    await refreshWebTokens();
    return generateGeminiWebContent({ prompt, resetConversation });
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} desde Gemini Web`);
  }

  const text = res.text();

  // 1. Extraer bloques de respuesta
  const jsonBlocks = [];
  const regex = /\[\["wrb\.fr",null,"(\[.*?\])"/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    try {
      const unescaped = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      const parsed = JSON.parse(unescaped);
      jsonBlocks.push(parsed);
    } catch {}
  }

  let answerText = null;

  for (let i = jsonBlocks.length - 1; i >= 0; i--) {
    const block = jsonBlocks[i];
    try {
      const candidates = block[4] || (Array.isArray(block[0]) ? block[0][4] : null);
      if (candidates && candidates.length > 0) {
        const textCand = candidates[0][1]?.[0];
        if (textCand && typeof textCand === "string" && textCand.trim().length > 0) {
          answerText = textCand;

          // Guardar IDs en disco para persistir el Cuaderno Dedicado
          const convId = block[1]?.[0];
          const respId = block[1]?.[1];
          const choiceId = candidates[0][0];
          if (convId && respId && choiceId) {
            conversationContext = [convId, respId, choiceId];
            saveNotebookSession(conversationContext);
          }
          break;
        }
      }
    } catch {}
  }

  if (!answerText) {
    const matchSimple = text.match(/\["rc_[^"]+",\["([^"]+)"/);
    if (matchSimple) {
      answerText = matchSimple[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
  }

  // 2. Extraer imágenes reales generadas por Imagen 3 / Nano Banana
  const imgRegex = /https:\/\/lh3\.googleusercontent\.com\/(?:rd-)?gg(?:-dl)?\/[A-Za-z0-9_=-]+/g;
  const rawImgUrls = [...new Set(text.match(imgRegex) || [])];
  const downloadedImages = [];

  for (const imgUrl of rawImgUrls) {
    try {
      const downloaded = await downloadGeminiWebImage(imgUrl);
      downloadedImages.push(downloaded.filePath);
    } catch (err) {
      console.warn("[Nova/GeminiWeb] Error descargando imagen de Imagen 3:", err.message);
    }
  }

  if (answerText && answerText.includes("image_generation_content")) {
    answerText = downloadedImages.length > 0
      ? "🎨 *¡Lista tu imagen en ultra resolución, Kirito! La he generado con Imagen 3 desde tu cuenta Gemini Pro.*"
      : "🎨 *Generación de imagen completada con Imagen 3.*";
  }

  if (!answerText && downloadedImages.length > 0) {
    answerText = "🎨 *Aquí tienes tu imagen generada desde nuestro cuaderno en Gemini Advanced.*";
  }

  if (!answerText) {
    throw new Error("No se pudo extraer la respuesta del stream de Gemini Web.");
  }

  return {
    text: answerText.trim(),
    localImages: downloadedImages,
    images: rawImgUrls,
    conversationId: conversationContext[0],
    model: "Nova • Gemini Advanced Web (Cuaderno Pro)"
  };
}

/**
 * Sincroniza cualquier orden/conversación (de la App Android, el Orbe de Voz o herramientas de PC)
 * directamente en el hilo activo de Gemini Web (c_793211113588a8da) para que todo quede guardado en el historial web.
 */
export async function syncActionToGeminiNotebook({ userOrder, novaActionSummary }) {
  if (!isGeminiWebAvailable()) return;
  try {
    const syncPrompt =
      `[Sincronización en vivo desde NOVA Control]\n` +
      `• Orden de Kirito: "${userOrder}"\n` +
      `• Ejecución en la laptop: "${novaActionSummary}"\n` +
      `Confirma en 1 línea breve para dejarlo registrado en nuestro historial de Gemini.`;
    await generateGeminiWebContent({ prompt: syncPrompt });
  } catch (err) {
    console.warn("[gemini-web] No se pudo sincronizar acción en el cuaderno web:", err.message);
  }
}
