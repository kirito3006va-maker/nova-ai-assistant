import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { ROOT_DIR, OUTBOX_DIR } from "../config.mjs";
import { fetchSafeHardwareTelemetry } from "./system-service.mjs";
import { loadMemory, getLimaTimeString } from "./memory-service.mjs";
import { listReminders } from "./agenda-service.mjs";
import { generateSpeech, isElevenLabsConfigured, transcribeSpeechBuffer } from "./elevenlabs-service.mjs";
import { startGlobalTunnel, getActiveTunnelUrl } from "./tunnel-service.mjs";

const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const PORT = 3840;

let wss = null;
let httpServer = null;
let agentExecutorCallback = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".apk": "application/vnd.android.package-archive"
};

export function broadcastToClients(payload) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

export function startVoiceGateway({ onAgentExecute }) {
  if (httpServer) return { port: PORT };
  agentExecutorCallback = onAgentExecute;

  httpServer = http.createServer(async (req, res) => {
    let reqPath = req.url.split("?")[0];
    if (reqPath === "/") reqPath = "/index.html";

    if (reqPath === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        limaTime: getLimaTimeString(),
        tunnelUrl: getActiveTunnelUrl()
      }));
      return;
    }

    // Endpoint directo para TTS de ElevenLabs
    if (reqPath === "/api/tts") {
      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      const text = urlObj.searchParams.get("text");
      if (!text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Parámetro 'text' requerido." }));
        return;
      }
      try {
        const speechRes = await generateSpeech({ text });
        if (speechRes.success && speechRes.audioBuffer) {
          res.writeHead(200, {
            "Content-Type": "audio/mpeg",
            "Content-Length": speechRes.audioBuffer.length,
            "Cache-Control": "public, max-age=86400"
          });
          res.end(speechRes.audioBuffer);
        } else {
          res.writeHead(speechRes.status || 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: speechRes.error || "No se pudo generar audio" }));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Servir archivos de audio generados en outbox
    if (reqPath.startsWith("/outbox/")) {
      const filename = path.basename(reqPath);
      const filePath = path.join(OUTBOX_DIR, filename);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = ext === ".mp3" ? "audio/mpeg" : (MIME_TYPES[ext] || "application/octet-stream");
        res.writeHead(200, { "Content-Type": contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    const safePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
    if (!safePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const stat = fs.statSync(safePath);
      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": stat.size
      });
      fs.createReadStream(safePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  let isTurnActive = false;
  let turnCooldownUntil = 0;

  wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    console.log("[VoiceGateway] Cliente conectado a la interfaz de Nova (PC / Móvil).");

    // Enviar datos iniciales al cliente
    ws.send(JSON.stringify({
      type: "INIT_STATE",
      limaTime: getLimaTimeString(),
      memory: loadMemory().profile,
      agenda: listReminders().slice(0, 5)
    }));

    async function processUserPrompt(userPrompt) {
      const cleanPrompt = (userPrompt || "").trim();
      if (!cleanPrompt) return;

      const now = Date.now();
      if (isTurnActive || now < turnCooldownUntil) {
        console.log(`[VoiceGateway] Descartando prompt superpuesto (${now < turnCooldownUntil ? 'enfriando eco' : 'turno ocupado'}): "${cleanPrompt}"`);
        return;
      }

      isTurnActive = true;
      broadcastToClients({ type: "STATE_CHANGE", state: "THINKING" });

      if (agentExecutorCallback) {
        try {
          const result = await agentExecutorCallback(cleanPrompt);
          const replyText = result.text || "Listo Kirito.";

          let audioUrl = null;
          if (isElevenLabsConfigured()) {
            try {
              const speechRes = await generateSpeech({ text: replyText.slice(0, 450) });
              if (speechRes.success && speechRes.audioPath) {
                audioUrl = `/outbox/${path.basename(speechRes.audioPath)}`;
              }
            } catch (ttsErr) {
              console.warn("[VoiceGateway] Aviso al generar audio ElevenLabs:", ttsErr.message);
            }
          }

          broadcastToClients({
            type: "ASSISTANT_REPLY",
            text: replyText,
            audioUrl,
            model: result.model || "Nova",
            images: result.images || [],
            documents: result.documents || []
          });

          if (audioUrl) {
            broadcastToClients({ type: "STATE_CHANGE", state: "SPEAKING" });
            // isTurnActive permanece true hasta que el cliente reporte CLIENT_SPEECH_FINISHED
          } else {
            isTurnActive = false;
            turnCooldownUntil = Date.now() + 1000;
            broadcastToClients({ type: "STATE_CHANGE", state: "IDLE" });
          }
        } catch (err) {
          isTurnActive = false;
          turnCooldownUntil = Date.now() + 1000;
          broadcastToClients({
            type: "ASSISTANT_REPLY",
            text: `Disculpa Kirito, hubo un inconveniente: ${err.message}`,
            model: "Error",
            images: []
          });
          broadcastToClients({ type: "STATE_CHANGE", state: "IDLE" });
        }
      } else {
        isTurnActive = false;
      }
    }

    ws.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === "USER_SPEECH" || data.type === "USER_MESSAGE") {
          await processUserPrompt(data.text);
        }

        if (data.type === "USER_AUDIO" && data.audioBase64) {
          const now = Date.now();
          if (isTurnActive || now < turnCooldownUntil) {
            console.log("[VoiceGateway] Descartando audio recibido mientras Nova habla o enfría eco.");
            return;
          }

          const audioBuffer = Buffer.from(data.audioBase64, "base64");
          const sttRes = await transcribeSpeechBuffer({
            audioBuffer,
            mimeType: data.mimeType || "audio/webm"
          });

          if (sttRes.success && sttRes.text && sttRes.text.length > 1) {
            console.log(`[VoiceGateway] Voz captada: "${sttRes.text}"`);
            broadcastToClients({
              type: "USER_TRANSCRIPT",
              text: sttRes.text
            });
            await processUserPrompt(sttRes.text);
          } else {
            broadcastToClients({ type: "STATE_CHANGE", state: "IDLE" });
          }
        }

        if (data.type === "CLIENT_SPEECH_FINISHED") {
          isTurnActive = false;
          turnCooldownUntil = Date.now() + 1400; // 1.4s de silencio obligatorio para evitar acople de eco
          broadcastToClients({ type: "STATE_CHANGE", state: "IDLE" });
        }
      } catch (e) {
        console.error("[VoiceGateway] Error procesando mensaje de WebSocket:", e.message);
      }
    });

    ws.on("close", () => {
      console.log("[VoiceGateway] Cliente desconectado.");
    });
  });

  // Emisión periódica de telemetría cada 3 segundos
  setInterval(async () => {
    if (!wss || wss.clients.size === 0) return;
    try {
      const tele = await fetchSafeHardwareTelemetry();
      broadcastToClients({
        type: "TELEMETRY_UPDATE",
        telemetry: tele,
        limaTime: getLimaTimeString()
      });
    } catch {}
  }, 3000);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[VoiceGateway] Servidor HUD y Voz de Nova activo en http://0.0.0.0:${PORT} (PC: http://127.0.0.1:${PORT} | Red Wi-Fi: http://192.168.0.106:${PORT})`);
    startGlobalTunnel(PORT);
  });

  return { port: PORT };
}
