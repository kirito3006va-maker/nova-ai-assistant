import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Bot, Keyboard, InputFile } from "grammy";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OWNER_FILE = path.join(__dirname, "owner.json");
const INBOX_DIR = path.join(__dirname, "inbox");

fs.mkdirSync(INBOX_DIR, { recursive: true });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-3.5-flash-lite";

const bot = new Bot(BOT_TOKEN);

function getOwnerId() {
  try {
    return JSON.parse(fs.readFileSync(OWNER_FILE, "utf8")).ownerId;
  } catch {
    return null;
  }
}

function setOwnerId(id) {
  fs.writeFileSync(OWNER_FILE, JSON.stringify({ ownerId: id }), "utf8");
}

// Teclado interactivo táctil persistente
const mainKeyboard = new Keyboard()
  .text("📊 Estado PC").text("⚡ Ayuda").row()
  .text("💻 Info Hardware").text("🔋 Batería y RAM")
  .resized();

// Quick Hardware Status (< 400ms)
async function getQuickStatus() {
  try {
    const psCmd = `
      $os = Get-CimInstance Win32_OperatingSystem
      $bat = Get-CimInstance Win32_Battery
      $cpu = Get-CimInstance Win32_Processor
      $ramUsed = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/1MB, 1)
      $ramTotal = [math]::Round($os.TotalVisibleMemorySize/1MB, 1)
      $ramPct = [math]::Round(($ramUsed / $ramTotal)*100, 0)
      $uptime = (Get-Date) - $os.LastBootUpTime
      "$($cpu.LoadPercentage)|$ramUsed|$ramTotal|$ramPct|$($bat.EstimatedChargeRemaining)|$($bat.BatteryStatus)|$($uptime.Hours)h $($uptime.Minutes)m"
    `;
    const { stdout } = await execAsync(`powershell.exe -NoProfile -Command "${psCmd.trim()}"`);
    const parts = (stdout || "").trim().split("|");
    if (parts.length >= 7) {
      const [cpuLoad, ramU, ramT, ramP, batPct, batStatus, upt] = parts;
      const isCharging = batStatus === "2" ? "🔌 Conectada (AC)" : "🔋 En batería";
      return `⚡ *Estado Actual de tu Lenovo LOQ*\n\n` +
             `• *CPU:* ${cpuLoad}% de uso\n` +
             `• *RAM:* ${ramU} GB / ${ramT} GB (${ramP}%)\n` +
             `• *Batería:* ${batPct}% (${isCharging})\n` +
             `• *Tiempo encendida:* ${upt}\n\n` +
             `_⚡ Respuesta instantánea desde tu laptop._`;
    }
  } catch (e) {
    console.error("getQuickStatus error:", e);
  }
  return "⚡ Laptop activa y en línea.";
}

// Tier 2: Gemini 3.5 Flash-Lite (1 a 2s)
async function queryGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const systemInstruction = "Eres Antigravity, un asistente de IA avanzado y compañero de programación ejecutándose en la laptop Lenovo LOQ de Kirito (Ryzen 7 7435HS, RTX 4060, 24GB RAM). Responde de forma clara, natural, estructurada y amigable en Markdown de Telegram.";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${systemInstruction}\n\nUsuario: ${prompt}` }] }]
    })
  });

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  return text || "No pude generar una respuesta en este momento.";
}

// Clasificación de intenciones
function classifyIntent(text) {
  const clean = (text || "").trim().toLowerCase();

  // Tier 1: Acciones directas locales
  if (/^(status|pc|📊 estado pc|info pc)\b/i.test(clean)) return { tier: 1, action: "status" };
  if (/^(💻 info hardware|hardware)\b/i.test(clean)) return { tier: 1, action: "hardware" };
  if (/^(🔋 batería y ram|batería|ram)\b/i.test(clean)) return { tier: 1, action: "battery" };
  if (/^(ayuda|help|⚡ ayuda|\/help)\b/i.test(clean)) return { tier: 1, action: "help" };
  if (/^\/cmd\s+/i.test(clean)) return { tier: 1, action: "cmd", command: text.trim().replace(/^\/cmd\s+/i, "") };

  // Tier 3: Tareas complejas de archivos, documentos o compilación
  const heavyKeywords = [
    "crea un archivo", "crea un excel", "hazme un excel", "crea un pdf", "hazme un pdf",
    "powerpoint", "pptx", "word", "docx", "compila", "compilar", "apk", "flutter",
    "reporte profundo", "escaneo profundo", "escribe un script", "programa una", "crea una web"
  ];
  if (heavyKeywords.some(kw => clean.includes(kw))) {
    return { tier: 3, action: "heavy" };
  }

  // Tier 2: Consultas normales de IA
  return { tier: 2, action: "ai" };
}

// Filtro de seguridad por usuario
bot.use(async (ctx, next) => {
  const fromId = ctx.from?.id;
  if (!fromId) return;

  let ownerId = getOwnerId();
  if (!ownerId) {
    setOwnerId(fromId);
    ownerId = fromId;
    console.log(`[telegram-bot] Dueño asignado automáticamente a ID: ${ownerId} (${ctx.from.first_name})`);
  }

  if (fromId !== ownerId) {
    await ctx.reply("⛔ *Acceso no autorizado.*\nEste bot está conectado a la laptop privada de Kirito y solo responde a su dueño.", { parse_mode: "Markdown" });
    return;
  }

  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    `🚀 *¡Bienvenido a tu Antigravity en Telegram!*\n\n` +
    `Tu laptop Lenovo LOQ está conectada como servidor privado. Aquí tienes:\n` +
    `• *Mensajes 100% ilimitados de por vida* (sin límites de 2000).\n` +
    `• *Envío y recepción de archivos de hasta 2 GB*.\n` +
    `• *Respuestas en 1 segundo* con Gemini Flash y botones táctiles abajo.\n\n` +
    `Usa los botones táctiles o escríbeme lo que necesites:`,
    { reply_markup: mainKeyboard, parse_mode: "Markdown" }
  );
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  const intent = classifyIntent(text);

  if (intent.tier === 1) {
    if (intent.action === "status" || intent.action === "battery") {
      const statusText = await getQuickStatus();
      await ctx.reply(statusText, { parse_mode: "Markdown" });
    } else if (intent.action === "hardware") {
      const hwText = `💻 *Especificaciones de tu Laptop:*\n\n` +
                     `• *Modelo:* Lenovo LOQ 15ARP9 (Windows 11 Pro)\n` +
                     `• *Procesador:* AMD Ryzen 7 7435HS (8 núcleos / 16 hilos @ 3.1 GHz)\n` +
                     `• *GPU:* NVIDIA GeForce RTX 4060 Laptop (8 GB GDDR6)\n` +
                     `• *Memoria:* 24 GB DDR5 4800 MHz Dual Channel\n` +
                     `• *Almacenamiento:* 2x SSDs NVMe de 1 TB (Samsung + Intel)\n` +
                     `• *Batería:* Salud 103% (0% desgaste, 62 ciclos)\n` +
                     `• *Pantalla:* 1920x1080 @ 144 Hz`;
      await ctx.reply(hwText, { parse_mode: "Markdown" });
    } else if (intent.action === "help") {
      const help = `⚡ *Guía de Comandos y Atajos:*\n\n` +
                   `🟢 *Nivel 1 (Instantáneo < 1 seg):*\n` +
                   `• Toca *📊 Estado PC* o escribe *status*.\n` +
                   `• Toca *💻 Info Hardware*.\n` +
                   `• Usa \`/cmd <comando>\` para ejecutar un comando en PowerShell (ej. \`/cmd dir\`).\n\n` +
                   `🟡 *Nivel 2 (Gemini Flash en 1-2 seg):*\n` +
                   `• Cualquier pregunta, traducción, consulta o texto.\n\n` +
                   `🔴 *Nivel 3 (Motor Avanzado de Laptop):*\n` +
                   `• *"Crea un Excel con...", "Hazme un PDF...", "Compila el APK..."*`;
      await ctx.reply(help, { parse_mode: "Markdown" });
    } else if (intent.action === "cmd") {
      try {
        const { stdout, stderr } = await execAsync(`powershell.exe -NoProfile -Command "${intent.command.replace(/"/g, '`"')}"`);
        const out = (stdout || stderr || "Comando ejecutado sin salida.").trim();
        await ctx.reply(`💻 *Salida:*\n\`\`\`\n${out.slice(0, 3800)}\n\`\`\``, { parse_mode: "Markdown" });
      } catch (e) {
        await ctx.reply(`❌ *Error:*\n${e.message}`);
      }
    }
  } else if (intent.tier === 2) {
    // Tier 2: Gemini Flash-Lite en 1 a 2s
    const answer = await queryGemini(text);
    await ctx.reply(answer, { parse_mode: "Markdown" }).catch(async () => {
      // Fallback sin markdown si hay caracteres raros
      await ctx.reply(answer);
    });
  } else if (intent.tier === 3) {
    // Tier 3: Tarea compleja de archivos / Antigravity
    await ctx.reply("⚙️ *Tarea avanzada detectada.* Despertando el motor completo de tu laptop para generar tus archivos/compilación...", { parse_mode: "Markdown" });
    console.log("=== HEAVY_TELEGRAM_TASK ===");
    console.log(JSON.stringify({ chatId: ctx.chat.id, text }, null, 2));
    process.exit(0);
  }
});

// Soporte para recepción de archivos/documentos desde Telegram
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  await ctx.reply(`📥 Recibí el archivo *${doc.file_name}* (${Math.round(doc.file_size / 1024)} KB). Descargándolo a tu laptop...`, { parse_mode: "Markdown" });
  try {
    const file = await ctx.getFile();
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(downloadUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    const savePath = path.join(INBOX_DIR, `${Date.now()}_${doc.file_name}`);
    fs.writeFileSync(savePath, buf);
    await ctx.reply(`✅ Archivo guardado localmente en tu disco:\n\`${savePath}\``, { parse_mode: "Markdown" });
  } catch (e) {
    await ctx.reply(`❌ Error al descargar archivo: ${e.message}`);
  }
});

console.log("[telegram-bot] Bot listo e iniciando polling...");
bot.start();
