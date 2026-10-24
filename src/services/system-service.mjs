import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ROOT_DIR, OUTBOX_DIR } from "../config.mjs";

const execAsync = promisify(exec);
const DESKTOP_HELPER = path.join(ROOT_DIR, "desktop-helper.ps1");
const TELEMETRY_PS1 = path.join(ROOT_DIR, "telemetry.ps1");
const RUN_GUI_CMD = path.join(ROOT_DIR, "run-gui.cmd");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ensureInteractiveLauncherTask() {
  try {
    if (!fs.existsSync(RUN_GUI_CMD)) {
      fs.writeFileSync(RUN_GUI_CMD, "@echo off\r\n", "utf8");
    }
    const psScript = `
      $null = schtasks.exe /Query /TN 'AntigravityLauncher' 2>&1
      if ($LASTEXITCODE -ne 0) {
        schtasks.exe /Create /TN 'AntigravityLauncher' /TR '"${RUN_GUI_CMD}"' /SC ONCE /ST 00:00 /IT /F
      }
      $xml = schtasks.exe /Query /TN 'AntigravityLauncher' /XML
      if ($xml -match '<DisallowStartIfOnBatteries>true</DisallowStartIfOnBatteries>') {
        $xml = $xml -replace '<DisallowStartIfOnBatteries>true</DisallowStartIfOnBatteries>', '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>'
        $xml = $xml -replace '<StopIfGoingOnBatteries>true</StopIfGoingOnBatteries>', '<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'
        $xml = $xml -replace '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>', '<MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>'
        $xmlFile = "$env:TEMP\\AntigravityLauncher.xml"
        [System.IO.File]::WriteAllText($xmlFile, $xml, [System.Text.Encoding]::Unicode)
        schtasks.exe /Create /TN 'AntigravityLauncher' /XML $xmlFile /F
        Remove-Item $xmlFile -ErrorAction SilentlyContinue
      }
    `;
    const tmpPs = path.join(process.env.TEMP || "C:\\Windows\\Temp", "patch_launcher.ps1");
    fs.writeFileSync(tmpPs, psScript, "utf8");
    await execAsync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`);
    try { fs.unlinkSync(tmpPs); } catch {}
  } catch (e) {
    console.error("[SystemService] Aviso verificando AntigravityLauncher:", e.message);
  }
}

export async function searchYouTubeTrack(query) {
  try {
    const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const html = await res.text();
    const match = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (match) {
      return match[1];
    }
  } catch (e) {
    console.warn("[Music] Error buscando video en YouTube:", e.message);
  }
  return null;
}

export async function playMusicTrack({ query, platform = "youtube_music" }) {
  const videoId = await searchYouTubeTrack(query);
  let targetUrl = "";
  let serviceName = "YouTube Music";

  if (platform.includes("youtube") && !platform.includes("music")) {
    targetUrl = videoId
      ? `https://www.youtube.com/watch?v=${videoId}&autoplay=1`
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    serviceName = "YouTube";
  } else {
    targetUrl = videoId
      ? `https://music.youtube.com/watch?v=${videoId}`
      : `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
    serviceName = "YouTube Music";
  }

  await runOnInteractiveDesktop([
    `start "" "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --new-window "${targetUrl}"`
  ]);
  await sleep(2500);
  await focusRealDesktopWindow(serviceName).catch(() => {});

  return {
    status: "success",
    platform: serviceName,
    query,
    videoId,
    url: targetUrl
  };
}

export async function playYouTubeVideo({ query, url }) {
  let targetUrl = (url || "").trim();
  let videoTitle = "";
  let videoId = "";
  const ytDlpPath = path.join(ROOT_DIR, "bin", "yt-dlp.exe");

  // 1. Si el usuario proporcionó un enlace directo (youtube.com o youtu.be)
  if (targetUrl && /(?:youtube\.com|youtu\.be)/i.test(targetUrl)) {
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    if (fs.existsSync(ytDlpPath)) {
      try {
        const { stdout } = await execAsync(`"${ytDlpPath}" --no-warnings --print "%(title)s" "${targetUrl}"`, { timeout: 7000 });
        if (stdout && stdout.trim()) {
          videoTitle = stdout.trim();
        }
      } catch {}
    }
  } else if (query && query.trim()) {
    const cleanQuery = query.trim();

    // 2. Si el usuario buscó por texto, obtener el video #1 exacto con yt-dlp
    let resolved = false;
    if (fs.existsSync(ytDlpPath)) {
      try {
        const { stdout } = await execAsync(
          `"${ytDlpPath}" --no-warnings --print "%(id)s|||%(title)s" "ytsearch1:${cleanQuery.replace(/"/g, '')}"`,
          { timeout: 8000 }
        );
        if (stdout && stdout.includes("|||")) {
          const parts = stdout.trim().split("|||");
          const id = (parts[0] || "").trim();
          const title = (parts[1] || "").trim();
          if (id && id.length === 11) {
            videoId = id;
            videoTitle = title;
            targetUrl = `https://www.youtube.com/watch?v=${videoId}&autoplay=1`;
            resolved = true;
          }
        }
      } catch (err) {
        console.warn("[YouTube] Aviso buscando con yt-dlp:", err.message);
      }
    }

    // Fallback rápido usando scraping HTML si yt-dlp no resolvió
    if (!resolved) {
      videoId = await searchYouTubeTrack(cleanQuery);
      if (videoId) {
        targetUrl = `https://www.youtube.com/watch?v=${videoId}&autoplay=1`;
      } else {
        targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
      }
    }
  } else {
    throw new Error("Se requiere una consulta o un enlace de YouTube.");
  }

  // 3. Abrir en pantalla interactiva usando Brave
  await runOnInteractiveDesktop([
    `start "" "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --new-window "${targetUrl}"`
  ]);

  await sleep(2500);
  await focusRealDesktopWindow("YouTube").catch(() => {});

  return {
    status: "success",
    title: videoTitle || query || "Video de YouTube",
    url: targetUrl,
    videoId: videoId || null
  };
}

export async function captureRealDesktop(shotPath) {
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${DESKTOP_HELPER}" screenshot "${shotPath}"`;
  const { stdout } = await execAsync(cmd, { timeout: 15000 });
  if (!fs.existsSync(shotPath)) {
    throw new Error(`No se generó el archivo de captura (${stdout.trim()})`);
  }
  return stdout.trim();
}

export async function getRealDesktopWindows() {
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${DESKTOP_HELPER}" windows`;
  const { stdout } = await execAsync(cmd, { timeout: 10000 });
  return (stdout || "").trim();
}

export async function focusRealDesktopWindow(titleQuery) {
  const safeQuery = titleQuery.replace(/"/g, "");
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${DESKTOP_HELPER}" focus "${safeQuery}"`;
  const { stdout } = await execAsync(cmd, { timeout: 10000 });
  return (stdout || "").trim();
}

export async function runOnInteractiveDesktop(batchLines) {
  const content = ["@echo off", ...batchLines].join("\r\n") + "\r\n";
  fs.writeFileSync(RUN_GUI_CMD, content, "utf8");
  await execAsync(`schtasks.exe /Run /TN "AntigravityLauncher"`);
}

export async function fetchSafeHardwareTelemetry() {
  let gpuInfo = {
    name: "NVIDIA GeForce RTX 4060 Laptop GPU",
    tempCelsius: 0,
    loadPercent: 0,
    vramUsedMB: 0,
    vramTotalMB: 8188,
    powerWatts: 0
  };

  try {
    const { stdout: gpuOut } = await execAsync(
      "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw --format=csv,noheader,nounits",
      { timeout: 5000 }
    );
    const [name, temp, util, vramUsed, vramTotal, power] = (gpuOut || "").trim().split(",").map(s => s.trim());
    if (name) gpuInfo.name = name;
    if (temp) gpuInfo.tempCelsius = parseFloat(temp) || 0;
    if (util) gpuInfo.loadPercent = parseFloat(util) || 0;
    if (vramUsed) gpuInfo.vramUsedMB = parseInt(vramUsed, 10) || 0;
    if (vramTotal) gpuInfo.vramTotalMB = parseInt(vramTotal, 10) || 8188;
    if (power) gpuInfo.powerWatts = parseFloat(power) || 0;
  } catch (e) {
    console.warn("[Telemetry] nvidia-smi no disponible:", e.message);
  }

  let sys = {
    cpuLoad: 0,
    ramUsedGB: 0,
    ramTotalGB: 24,
    batteryPercent: 100,
    batteryStatus: 2,
    disks: [{ id: "C:", freeGB: 0, totalGB: 1000 }],
    topProcesses: []
  };

  try {
    const { stdout: psOut } = await execAsync(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${TELEMETRY_PS1}"`,
      { timeout: 8000 }
    );
    const parsed = JSON.parse(psOut.trim());
    sys = { ...sys, ...parsed };
  } catch (e) {
    console.warn("[Telemetry] telemetry.ps1 falló:", e.message);
  }

  const disksStr = Array.isArray(sys.disks)
    ? sys.disks.map(d => `${d.id} ${d.freeGB} GB libres / ${d.totalGB} GB`).join(", ")
    : "C: 1 TB SSD NVMe";

  const topProcsStr = Array.isArray(sys.topProcesses)
    ? sys.topProcesses.map(p => `${p.name} (${p.memMB} MB)`).join(", ")
    : "Sin procesos detectados";

  const ramUsed = Number(sys.ramUsedGB) || 0;
  const ramTotal = Number(sys.ramTotalGB) || 24;
  const ramPct = ramTotal > 0 ? Math.round((ramUsed / ramTotal) * 100) : 0;

  return {
    laptop: "Lenovo LOQ 15ARP9",
    cpu: {
      model: "AMD Ryzen 7 7435HS",
      loadPercent: Number(sys.cpuLoad) || 0
    },
    gpu: gpuInfo,
    ram: {
      usedGB: ramUsed,
      totalGB: ramTotal,
      percent: ramPct
    },
    disks: disksStr,
    topProcessesByRAM: topProcsStr,
    battery: {
      chargePercent: Number(sys.batteryPercent) || 100,
      state: sys.batteryStatus === 2 ? "Conectada a corriente (AC) ⚡" : "En batería 🔋"
    }
  };
}

export const APP_CATALOG = [
  { keys: ["steam"], name: "Steam", focusHint: "Steam", cmd: `"C:\\Program Files (x86)\\Steam\\steam.exe" steam://open/main` },
  { keys: ["brave", "navegador"], name: "Brave Browser", focusHint: "Brave", cmd: `"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"` },
  { keys: ["vscode", "vs code", "code", "visual studio code"], name: "VS Code", focusHint: "Visual Studio Code", cmd: `"C:\\Users\\USER\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"` },
  { keys: ["discord"], name: "Discord", focusHint: "Discord", cmd: `start discord://` },
  { keys: ["netbeans", "apache netbeans"], name: "Apache NetBeans", focusHint: "NetBeans", cmd: `"C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Apache NetBeans.lnk"` },
  { keys: ["obs", "obs studio"], name: "OBS Studio", focusHint: "OBS", cmd: `"C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\OBS Studio.lnk"` },
  { keys: ["word", "microsoft word", "winword"], name: "Microsoft Word", focusHint: "Word", cmd: `"C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Word.lnk"` },
  { keys: ["excel", "microsoft excel"], name: "Microsoft Excel", focusHint: "Excel", cmd: `"C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Excel.lnk"` },
  { keys: ["powerpoint", "ppt", "power point"], name: "PowerPoint", focusHint: "PowerPoint", cmd: `"C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\PowerPoint.lnk"` },
  { keys: ["explorer", "explorador"], name: "Explorador de Archivos", focusHint: "Explorador", cmd: "explorer.exe" },
  { keys: ["calc", "calculadora"], name: "Calculadora", focusHint: "Calculadora", cmd: "calc.exe" },
  { keys: ["notepad++"], name: "Notepad++", focusHint: "Notepad++", cmd: `"C:\\Users\\Public\\Desktop\\Notepad++.lnk"` },
  { keys: ["notepad", "bloc"], name: "Bloc de Notas", focusHint: "Bloc de notas", cmd: "notepad.exe" },
  { keys: ["taskmgr", "administrador de tareas"], name: "Administrador de Tareas", focusHint: "Administrador de tareas", cmd: "taskmgr.exe" },
  { keys: ["paint", "mspaint"], name: "Paint", focusHint: "Paint", cmd: "mspaint.exe" },
  { keys: ["terminal", "wt", "windows terminal"], name: "Windows Terminal", focusHint: "Terminal", cmd: "wt.exe" },
  { keys: ["epic", "epic games"], name: "Epic Games Launcher", focusHint: "Epic Games", cmd: `"C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Epic Games Launcher.lnk"` },
  { keys: ["valorant"], name: "VALORANT", focusHint: "VALORANT", cmd: `"C:\\Users\\USER\\Desktop\\VALORANT.lnk"` },
  { keys: ["genshin"], name: "Genshin Impact", focusHint: "Genshin", cmd: `"C:\\Users\\USER\\Desktop\\Genshin Impact.lnk"` },
  { keys: ["matlab"], name: "MATLAB", focusHint: "MATLAB", cmd: `"C:\\Users\\Public\\Desktop\\MATLAB R2026a.lnk"` },
  { keys: ["antigravity", "agy"], name: "Google Antigravity IDE", focusHint: "Antigravity", cmd: `"C:\\Users\\USER\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe"` }
];

/**
 * Resuelve la ruta o comando exacto de cualquier aplicación instalada en Windows
 */
export async function resolveApplicationCommand(appName) {
  const raw = (appName || "").toLowerCase().trim();
  const matched = APP_CATALOG.find(item => item.keys.some(k => raw === k || raw.includes(k) || k.includes(raw)));
  if (matched) {
    return { name: matched.name, focusHint: matched.focusHint, cmd: matched.cmd };
  }

  const sysTools = {
    cmd: { name: "Símbolo del Sistema", focusHint: "cmd", cmd: "cmd.exe" },
    powershell: { name: "PowerShell", focusHint: "PowerShell", cmd: "powershell.exe" },
    regedit: { name: "Editor del Registro", focusHint: "Registro", cmd: "regedit.exe" },
    control: { name: "Panel de Control", focusHint: "Panel de control", cmd: "control.exe" }
  };
  if (sysTools[raw]) return sysTools[raw];

  try {
    const safe = raw.replace(/[^a-zA-Z0-9_\-\s]/g, "");
    const script = `
      $dirs = @('C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs', 'C:\\Users\\USER\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs', 'C:\\Users\\USER\\Desktop', 'C:\\Users\\Public\\Desktop', 'C:\\Users\\USER\\AppData\\Local\\Programs')
      $m = Get-ChildItem -Path $dirs -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -ilike '*${safe}*' } | Select-Object -First 1
      if ($m) { Write-Output ($m.BaseName + ':::' + $m.FullName) }
    `;
    const b64 = Buffer.from(script, "utf16le").toString("base64");
    const { stdout } = await execAsync(`powershell.exe -NoProfile -EncodedCommand ${b64}`, { timeout: 6000 });
    const line = (stdout || "").trim();
    if (line.includes(":::")) {
      const [bName, fPath] = line.split(":::");
      return {
        name: bName.trim(),
        focusHint: bName.trim(),
        cmd: `"${fPath.trim()}"`
      };
    }
  } catch {}

  return {
    name: appName,
    focusHint: appName,
    cmd: `"${appName}"`
  };
}

/**
 * Lanza visiblemente cualquier aplicación en el escritorio físico real y devuelve una captura
 */
export async function launchUniversalApplication(appName, sendVerificationScreenshot = true) {
  const resolved = await resolveApplicationCommand(appName);
  const displayName = resolved.name;
  const focusHint = resolved.focusHint;
  const launchCmd = resolved.cmd.startsWith("start ") ? resolved.cmd : `start "" ${resolved.cmd}`;

  if (displayName.toLowerCase().includes("steam")) {
    const currentWins = await getRealDesktopWindows();
    await runOnInteractiveDesktop([launchCmd]);
    await sleep(2200);
    let focusRes = await focusRealDesktopWindow("Steam");
    if (focusRes === "NOT_FOUND" && !currentWins.toLowerCase().includes("steam")) {
      await execAsync("taskkill /F /IM steam.exe /T").catch(() => {});
      await sleep(1000);
      await runOnInteractiveDesktop([launchCmd]);
      await sleep(4500);
      await focusRealDesktopWindow("Steam");
    }
  } else if (displayName.toLowerCase().includes("discord")) {
    await runOnInteractiveDesktop([launchCmd]);
    await sleep(3000);
    await focusRealDesktopWindow("Discord").catch(() => {});
  } else {
    await runOnInteractiveDesktop([launchCmd]);
    await sleep(2200);
    if (focusHint) {
      await focusRealDesktopWindow(focusHint).catch(() => {});
    }
  }

  let shotPath = null;
  if (sendVerificationScreenshot) {
    await sleep(600);
    shotPath = path.join(OUTBOX_DIR, `launch_${Date.now()}.jpg`);
    await captureRealDesktop(shotPath);
  }

  return {
    status: "success",
    application: displayName,
    shotPath,
    message: `${displayName} abierto visiblemente en tu pantalla.`
  };
}

/**
 * Abre y gestiona la cola de descargas y actualizaciones de Steam o Epic Games en la laptop
 */
export async function manageGameLauncherUpdates({ platform = "steam", action = "downloads" }) {
  const plat = (platform || "steam").toLowerCase();
  if (plat.includes("epic")) {
    await runOnInteractiveDesktop([
      `start "" "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Epic Games Launcher.lnk"`,
      `start com.epicgames.launcher://store`
    ]);
    await sleep(3000);
    await focusRealDesktopWindow("Epic Games").catch(() => {});
  } else {
    const steamUri = action === "library" ? "steam://open/games" : "steam://open/downloads";
    await runOnInteractiveDesktop([
      `start "" "C:\\Program Files (x86)\\Steam\\steam.exe" ${steamUri}`
    ]);
    await sleep(2800);
    await focusRealDesktopWindow("Steam").catch(() => {});
  }

  const shotPath = path.join(OUTBOX_DIR, `launcher_${Date.now()}.jpg`);
  await captureRealDesktop(shotPath);
  return {
    status: "success",
    platform: plat.includes("epic") ? "Epic Games" : "Steam",
    shotPath,
    message: `Panel de descargas/actualizaciones de ${plat.includes("epic") ? "Epic Games" : "Steam"} abierto en pantalla.`
  };
}

/**
 * Descarga o instala una aplicación buscándola en Brave y/o ejecutando winget en segundo plano
 */
export async function downloadOrInstallAppViaBraveOrWinget({ appName }) {
  const cleanName = (appName || "").trim();
  const searchUrl = `https://www.google.com/search?q=descargar+${encodeURIComponent(cleanName)}+oficial+windows`;

  await runOnInteractiveDesktop([
    `start "" "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --new-window "${searchUrl}"`
  ]);

  let wingetInfo = "";
  try {
    const { stdout } = await execAsync(`winget search "${cleanName.replace(/"/g, "")}" --accept-source-agreements`, { timeout: 10000 });
    wingetInfo = (stdout || "").trim().slice(0, 600);
  } catch {}

  await sleep(2500);
  await focusRealDesktopWindow("Brave").catch(() => {});
  const shotPath = path.join(OUTBOX_DIR, `download_app_${Date.now()}.jpg`);
  await captureRealDesktop(shotPath);

  return {
    status: "success",
    appName: cleanName,
    url: searchUrl,
    wingetCandidates: wingetInfo,
    shotPath
  };
}

/**
 * Crea un workspace de proyecto en Antigravity, escribe los archivos iniciales y la misión,
 * y lo abre directamente en Google Antigravity IDE en la pantalla de Kirito.
 */
export async function delegateProjectToAntigravity({ projectName, taskDescription, files = [] }) {
  const safeSlug = (projectName || "nova-project")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40) || `nova-task-${Date.now()}`;

  const projectDir = path.join("C:\\Users\\USER\\.gemini\\antigravity\\scratch", safeSlug);
  fs.mkdirSync(projectDir, { recursive: true });

  const missionFile = path.join(projectDir, "MISION_NOVA_ANTIGRAVITY.md");
  fs.writeFileSync(
    missionFile,
    `# 🚀 Misión Delegada por Kirito vía NOVA Control\n\n` +
      `- **Fecha:** ${new Date().toLocaleString("es-PE")}\n` +
      `- **Proyecto:** \`${safeSlug}\`\n\n` +
      `## Instrucciones Detalladas\n${taskDescription}\n`,
    "utf8"
  );

  const createdFiles = [missionFile];
  for (const f of files) {
    if (f && f.name && f.content) {
      const targetPath = path.join(projectDir, f.name);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, f.content, "utf8");
      createdFiles.push(targetPath);
    }
  }

  await runOnInteractiveDesktop([
    `start "" "C:\\Users\\USER\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe" "${projectDir}"`
  ]);
  await sleep(2500);
  await focusRealDesktopWindow("Antigravity").catch(() => {});

  const shotPath = path.join(OUTBOX_DIR, `antigravity_task_${Date.now()}.jpg`);
  await captureRealDesktop(shotPath).catch(() => {});

  return {
    status: "success",
    projectDir,
    createdFiles,
    shotPath
  };
}
