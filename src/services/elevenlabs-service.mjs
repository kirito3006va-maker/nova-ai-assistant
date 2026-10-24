import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CONFIG, OUTBOX_DIR, DATA_DIR } from "../config.mjs";

const CACHE_DIR = path.join(DATA_DIR, "tts_cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(OUTBOX_DIR, { recursive: true });

// Voz femenina humana predeterminada para Nova:
// "cgSgspJ2msm6clMCkdW9" (Jessica - Conversacional, cálida, joven y súper natural)
// "EXAVITQu4vr4xnSDxMaL" (Sarah - Confiable, serena y natural)
export const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "cgSgspJ2msm6clMCkdW9";

export function isElevenLabsConfigured() {
  const key = process.env.ELEVENLABS_API_KEY || CONFIG.providers?.elevenlabs?.apiKey || CONFIG.elevenlabs?.apiKey;
  return Boolean(key && key.trim().length > 10);
}

/**
 * Limpia el texto de Markdown, enlaces y emojis para que la voz hablada suene 100% natural
 */
export function sanitizeTextForSpeech(rawText) {
  return (rawText || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Convertir [texto](url) -> texto
    .replace(/https?:\/\/\S+/gi, "") // Quitar URLs crudas
    .replace(/✦.*$/gm, "") // Quitar pie de modelo
    .replace(/[*_#`~>\[\]()•]/g, " ") // Quitar símbolos markdown
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, "") // Quitar emojis
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Genera voz humana ultra-realista con ElevenLabs
 * Retorna { success, audioPath, audioBuffer, cached, cleanText, error }
 */
export async function generateSpeech({ text, voiceId = DEFAULT_VOICE_ID, modelId = "eleven_flash_v2_5" }) {
  const cleanText = sanitizeTextForSpeech(text);
  if (!cleanText) {
    return { success: false, error: "Texto vacío tras limpieza.", cleanText: "" };
  }

  const key = process.env.ELEVENLABS_API_KEY || CONFIG.providers?.elevenlabs?.apiKey || CONFIG.elevenlabs?.apiKey;
  if (!key) {
    return {
      success: false,
      error: "ELEVENLABS_API_KEY no está configurada en .env",
      cleanText
    };
  }

  // 1. Verificar caché local para ahorrar créditos y responder en 0ms
  const textHash = crypto.createHash("md5").update(`${cleanText}_${voiceId}_${modelId}`).digest("hex");
  const cachePath = path.join(CACHE_DIR, `${textHash}.mp3`);
  const outboxCacheCopy = path.join(OUTBOX_DIR, `tts_${textHash}.mp3`);

  if (fs.existsSync(cachePath)) {
    const audioBuffer = fs.readFileSync(cachePath);
    if (!fs.existsSync(outboxCacheCopy)) {
      fs.writeFileSync(outboxCacheCopy, audioBuffer);
    }
    return {
      success: true,
      audioPath: outboxCacheCopy,
      audioBuffer,
      cached: true,
      cleanText
    };
  }

  // 2. Llamada a la API de ElevenLabs con parámetros de conversación humana relajada
  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: modelId,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.78,
          style: 0.25,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsedErr = errText;
      try {
        const errObj = JSON.parse(errText);
        parsedErr = errObj.detail?.message || errText;
      } catch {}

      console.warn(`[ElevenLabs] Error HTTP ${response.status}: ${parsedErr}`);
      return {
        success: false,
        status: response.status,
        error: parsedErr,
        cleanText
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // Guardar en caché y en outbox para servir por HTTP sin fallos
    fs.writeFileSync(cachePath, audioBuffer);
    fs.writeFileSync(outboxCacheCopy, audioBuffer);

    console.log(`[ElevenLabs] Voz generada (${audioBuffer.length} bytes): "${cleanText.slice(0, 50)}..."`);

    return {
      success: true,
      audioPath: outboxCacheCopy,
      audioBuffer,
      cached: false,
      cleanText
    };
  } catch (err) {
    console.error("[ElevenLabs] Error de red al sintetizar voz:", err.message);
    return {
      success: false,
      error: err.message,
      cleanText
    };
  }
}

/**
 * Transcribe audio del micrófono en tiempo real usando ElevenLabs Scribe v1
 * Permite que la escucha activa manos libres funcione en Brave, Chrome o cualquier navegador
 */
export async function transcribeSpeechBuffer({ audioBuffer, mimeType = "audio/webm" }) {
  const key = process.env.ELEVENLABS_API_KEY || CONFIG.providers?.elevenlabs?.apiKey || CONFIG.elevenlabs?.apiKey;
  if (!key || !audioBuffer || audioBuffer.length < 800) {
    return { success: false, text: "" };
  }

  try {
    const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: mimeType }), `mic_input.${ext}`);
    formData.append("model_id", "scribe_v1");
    formData.append("language_code", "spa");

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": key
      },
      body: formData
    });

    if (!res.ok) {
      const errTxt = await res.text();
      console.warn(`[ElevenLabs STT] Error HTTP ${res.status}: ${errTxt.slice(0, 120)}`);
      return { success: false, text: "" };
    }

    const data = await res.json();
    const text = (data.text || "").trim();
    // Filtrar ruidos de fondo o transcripciones entre paréntesis como "(ruido)" o "(música)"
    const cleaned = text.replace(/\([^)]*\)|\[[^\]]*\]/g, "").trim();
    return {
      success: Boolean(cleaned.length > 1),
      text: cleaned
    };
  } catch (err) {
    console.warn("[ElevenLabs STT] Error transcribiendo audio:", err.message);
    return { success: false, text: "" };
  }
}
