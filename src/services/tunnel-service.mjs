import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ROOT_DIR, DATA_DIR, CONFIG } from "../config.mjs";

const CLOUDFLARED_BIN = path.join(ROOT_DIR, "bin", "cloudflared.exe");
const TUNNEL_STATE_FILE = path.join(DATA_DIR, "tunnel.json");

let activeTunnelUrl = null;
let tunnelProcess = null;

function getLocalLanIp() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === "IPv4" && !net.internal && net.address.startsWith("192.168.")) {
          return net.address;
        }
      }
    }
  } catch {}
  return "192.168.0.106";
}

async function publishTunnelToCloudRegistry(tunnelUrl, port = 3840) {
  const lanIp = getLocalLanIp();
  const shortDesc = `NOVA_TUNNEL|${tunnelUrl}|${lanIp}:${port}`;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      TUNNEL_STATE_FILE,
      JSON.stringify({
        tunnelUrl,
        lanEndpoint: `${lanIp}:${port}`,
        updatedAt: new Date().toISOString()
      }, null, 2),
      "utf-8"
    );
  } catch {}

  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.botToken}/setMyShortDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ short_description: shortDesc })
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`[GlobalTunnel] 🌍 URL Global publicada en registro Cloud para Android: ${tunnelUrl}`);
    } else {
      console.warn("[GlobalTunnel] Error publicando short_description:", data.description);
    }
  } catch (err) {
    console.warn("[GlobalTunnel] No se pudo publicar URL en Cloud Registry:", err.message);
  }
}

export function getActiveTunnelUrl() {
  return activeTunnelUrl;
}

export function startGlobalTunnel(port = 3840) {
  if (!fs.existsSync(CLOUDFLARED_BIN)) {
    console.warn(`[GlobalTunnel] No se encontró ${CLOUDFLARED_BIN}. El acceso global no estará disponible.`);
    return;
  }
  if (tunnelProcess) return;

  console.log("[GlobalTunnel] Iniciando túnel global cifrado (Cloudflare Edge)...");
  tunnelProcess = spawn(
    CLOUDFLARED_BIN,
    ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  const handleOutput = (chunk) => {
    const text = chunk.toString("utf-8");
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match && match[0] && match[0] !== activeTunnelUrl) {
      activeTunnelUrl = match[0];
      console.log(`[GlobalTunnel] ✅ Túnel Global Activo: ${activeTunnelUrl}`);
      publishTunnelToCloudRegistry(activeTunnelUrl, port);
    }
  };

  tunnelProcess.stdout.on("data", handleOutput);
  tunnelProcess.stderr.on("data", handleOutput);

  tunnelProcess.on("exit", (code) => {
    console.warn(`[GlobalTunnel] Proceso cloudflared terminó (código ${code}). Reiniciando en 4s...`);
    tunnelProcess = null;
    activeTunnelUrl = null;
    setTimeout(() => startGlobalTunnel(port), 4000);
  });
}
