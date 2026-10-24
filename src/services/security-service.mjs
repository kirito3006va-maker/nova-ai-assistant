import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { InputFile } from "grammy";
import { ROOT_DIR, OUTBOX_DIR } from "../config.mjs";
import { captureRealDesktop } from "./system-service.mjs";

const execAsync = promisify(exec);
const FFMPEG_BIN = path.join(ROOT_DIR, "bin", "ffmpeg.exe");

let isArmed = false;
let watchdogInterval = null;
let baselineState = { mouseX: 0, mouseY: 0, batteryStatus: 2 };

/**
 * Captura una fotografía instantánea con la cámara web integrada de la laptop.
 */
export async function captureWebcamPhoto(outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const cmd = `"${FFMPEG_BIN}" -f dshow -i video="Integrated Camera" -frames:v 1 -y "${outPath}"`;
  await execAsync(cmd, { timeout: 8000 });
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error("No se pudo capturar la foto de la cámara web.");
  }
  return outPath;
}

/**
 * Obtiene la posición actual del cursor y el estado de carga.
 */
async function getCurrentPhysicalState() {
  const psCmd = `
    Add-Type -AssemblyName System.Windows.Forms;
    $pos = [System.Windows.Forms.Cursor]::Position;
    $bat = (Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).BatteryStatus;
    "$($pos.X),$($pos.Y),$($bat)"
  `;
  try {
    const { stdout } = await execAsync(`powershell.exe -NoProfile -Command "${psCmd.replace(/\r?\n/g, ' ')}"`, { timeout: 4000 });
    const parts = (stdout || "").trim().split(",");
    return {
      mouseX: parseInt(parts[0], 10) || 0,
      mouseY: parseInt(parts[1], 10) || 0,
      batteryStatus: parseInt(parts[2], 10) || 2
    };
  } catch {
    return { mouseX: 0, mouseY: 0, batteryStatus: 2 };
  }
}

/**
 * Activa el Modo Guardián Centinela.
 */
export async function armCentinela(bot, ownerId) {
  if (isArmed) {
    return { status: "already_armed", message: "🛡️ El Modo Centinela ya se encuentra activo." };
  }

  baselineState = await getCurrentPhysicalState();
  isArmed = true;

  // Iniciar ciclo de vigilancia cada 1.8 segundos
  watchdogInterval = setInterval(async () => {
    if (!isArmed) return;

    try {
      const current = await getCurrentPhysicalState();
      const deltaX = Math.abs(current.mouseX - baselineState.mouseX);
      const deltaY = Math.abs(current.mouseY - baselineState.mouseY);
      const mouseMoved = (deltaX > 40 || deltaY > 40);
      const chargerUnplugged = (baselineState.batteryStatus === 2 && current.batteryStatus === 1);

      if (mouseMoved || chargerUnplugged) {
        // ¡INTRUSIÓN DETECTADA! Desarmar para no spamear
        isArmed = false;
        clearInterval(watchdogInterval);

        const reason = mouseMoved
          ? `Movimiento físico del cursor detectado (ΔX: ${deltaX}px, ΔY: ${deltaY}px)`
          : `El cargador de la laptop fue desconectado de la corriente`;

        console.log(`[Centinela] ¡DISPARADO! ${reason}`);

        // 1. Bloquear inmediatamente la laptop
        await execAsync("rundll32.exe user32.dll,LockWorkStation").catch(() => {});

        // 2. Tomar foto con webcam y captura de pantalla
        const webcamPath = path.join(OUTBOX_DIR, `centinela_webcam_${Date.now()}.jpg`);
        const screenPath = path.join(OUTBOX_DIR, `centinela_screen_${Date.now()}.jpg`);

        let hasWebcam = false;
        try {
          await captureWebcamPhoto(webcamPath);
          hasWebcam = true;
        } catch (err) {
          console.warn("[Centinela] Error foto webcam:", err.message);
        }

        try {
          await captureRealDesktop(screenPath);
        } catch {}

        // 3. Notificar a Telegram con máxima urgencia
        const alertMsg =
          `🚨 *¡ALERTA CENTINELA ACTIVADA!* 🚨\n\n` +
          `⚠️ *Causa:* ${reason}.\n` +
          `🔒 *Acción de seguridad:* Laptop bloqueada automáticamente.\n` +
          `⏰ *Hora:* \`${new Date().toLocaleTimeString()}\`\n\n` +
          `_Adjunto la fotografía del intruso tomada con la cámara web integrada y la captura del escritorio._`;

        if (hasWebcam && fs.existsSync(webcamPath)) {
          await bot.api.sendPhoto(ownerId, new InputFile(webcamPath), {
            caption: alertMsg,
            parse_mode: "Markdown"
          });
        } else {
          await bot.api.sendMessage(ownerId, alertMsg, { parse_mode: "Markdown" });
        }

        if (fs.existsSync(screenPath)) {
          await bot.api.sendPhoto(ownerId, new InputFile(screenPath), {
            caption: "📸 *Estado de pantalla al momento de la intrusión*",
            parse_mode: "Markdown"
          });
        }
      }
    } catch (e) {
      console.error("[Centinela] Error en vigilancia:", e.message);
    }
  }, 1800);

  return {
    status: "armed",
    message: "🛡️ *Modo Centinela ACTIVADO.*\n\nCualquier movimiento del mouse o desconexión del cargador tomará una foto instantánea con la cámara web, bloqueará la laptop y te avisará aquí de inmediato."
  };
}

/**
 * Desactiva el Modo Guardián Centinela.
 */
export function disarmCentinela() {
  if (!isArmed) {
    return { status: "not_armed", message: "🛡️ El Modo Centinela no estaba activo." };
  }
  isArmed = false;
  if (watchdogInterval) clearInterval(watchdogInterval);
  return { status: "disarmed", message: "🟢 *Modo Centinela DESACTIVADO.* Tu laptop está en modo normal." };
}

export function isCentinelaActive() {
  return isArmed;
}
