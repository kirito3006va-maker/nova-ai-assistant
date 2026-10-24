import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
let batteryInterval = null;
let alertedLowBattery = false;

/**
 * Apaga únicamente la pantalla/monitor de la laptop, permitiendo que la música o descargas sigan activas.
 */
export async function turnOffScreen() {
  const psCmd = `
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    public class MonPower {
        [DllImport("user32.dll")]
        public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);
    }
"@
    [MonPower]::SendMessage(0xffff, 0x0112, 0xF170, 2);
  `;
  await execAsync(`powershell.exe -NoProfile -Command "${psCmd.replace(/\r?\n/g, ' ')}"`);
  return { status: "success", message: "Pantalla apagada (la laptop sigue funcionando en segundo plano)." };
}

/**
 * Suspende la laptop inmediatamente.
 */
export async function suspendLaptop() {
  await execAsync("rundll32.exe powrprof.dll,SetSuspendState 0,1,0");
  return { status: "success", message: "Laptop suspendida." };
}

/**
 * Programa el apagado de la laptop en N minutos.
 */
export async function scheduleShutdown(minutes = 30) {
  const seconds = Math.max(10, Math.round(minutes * 60));
  await execAsync(`shutdown.exe /s /t ${seconds}`);
  return {
    status: "scheduled",
    minutes,
    message: `Apagado programado para dentro de ${minutes} minutos. Puedes cancelarlo con el comando de cancelar apagado.`
  };
}

/**
 * Cancela cualquier apagado programado.
 */
export async function cancelShutdown() {
  try {
    await execAsync("shutdown.exe /a");
    return { status: "cancelled", message: "Apagado programado cancelado exitosamente." };
  } catch (e) {
    return { status: "no_shutdown", message: "No había ningún apagado programado activo." };
  }
}

/**
 * Ajusta o consulta el volumen de Windows.
 */
export async function controlVolume(action, value = null) {
  if (action === "mute") {
    await execAsync(`powershell.exe -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`);
    return { status: "success", action: "Mute alternado" };
  }
  if (action === "up") {
    await execAsync(`powershell.exe -NoProfile -Command "for ($i=0; $i -lt 5; $i++) { (New-Object -ComObject WScript.Shell).SendKeys([char]175) }"`);
    return { status: "success", action: "Volumen aumentado (+10%)" };
  }
  if (action === "down") {
    await execAsync(`powershell.exe -NoProfile -Command "for ($i=0; $i -lt 5; $i++) { (New-Object -ComObject WScript.Shell).SendKeys([char]174)"`);
    return { status: "success", action: "Volumen reducido (-10%)" };
  }
  return { status: "ignored" };
}

/**
 * Monitor proactivo de batería: alerta si cae por debajo del 20% en modo batería.
 */
export function startProactiveBatteryMonitor(bot, ownerId) {
  if (batteryInterval) return;

  batteryInterval = setInterval(async () => {
    try {
      const { stdout } = await execAsync(
        `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Battery).EstimatedChargeRemaining, (Get-CimInstance Win32_Battery).BatteryStatus -join ','"`,
        { timeout: 5000 }
      );
      const [pctStr, statusStr] = (stdout || "").trim().split(",");
      const pct = parseInt(pctStr, 10);
      const isDischarging = parseInt(statusStr, 10) === 1;

      if (isDischarging && pct <= 20 && !alertedLowBattery) {
        alertedLowBattery = true;
        await bot.api.sendMessage(
          ownerId,
          `⚠️ *¡AVISO DE BATERÍA BAJA!* 🪫\n\n` +
          `Tu laptop Lenovo LOQ está al *${pct}%* de batería y funcionando desconectada.\n` +
          `Conéctala a la corriente para evitar que se apague.`,
          { parse_mode: "Markdown" }
        );
      } else if (!isDischarging || pct > 25) {
        alertedLowBattery = false;
      }
    } catch {}
  }, 180000); // Cada 3 minutos
}
