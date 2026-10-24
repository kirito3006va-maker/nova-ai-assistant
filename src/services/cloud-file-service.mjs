import fs from "node:fs";
import path from "node:path";
import { InputFile } from "grammy";
import { CONFIG } from "../config.mjs";

const USER_HOME = process.env.USERPROFILE || "C:\\Users\\USER";
const KEY_FOLDERS = [
  path.join(USER_HOME, "Desktop"),
  path.join(USER_HOME, "Documents"),
  path.join(USER_HOME, "Downloads"),
  path.join(USER_HOME, "Videos"),
  path.join(USER_HOME, "Music")
];

/**
 * Busca archivos en el disco de la laptop y envía el mejor resultado por Telegram.
 */
export async function searchAndSendFile({ query, folderHint = "all" }, ctx) {
  const cleanQ = query.toLowerCase().trim();
  const searchDirs = folderHint !== "all" && fs.existsSync(folderHint)
    ? [folderHint]
    : KEY_FOLDERS;

  const matches = [];

  for (const baseDir of searchDirs) {
    if (!fs.existsSync(baseDir)) continue;
    try {
      const items = fs.readdirSync(baseDir);
      for (const item of items) {
        const full = path.join(baseDir, item);
        try {
          const stat = fs.statSync(full);
          if (stat.isFile() && item.toLowerCase().includes(cleanQ)) {
            matches.push({ name: item, full, size: stat.size, mtime: stat.mtimeMs });
          }
        } catch {}
      }
    } catch {}
  }

  if (matches.length === 0) {
    if (ctx) await ctx.reply(`🔍 No encontré ningún archivo que coincida con *"${query}"* en tu Escritorio, Documentos o Descargas.`, { parse_mode: "Markdown" });
    return { status: "not_found", query };
  }

  // Ordenar por el más reciente
  matches.sort((a, b) => b.mtime - a.mtime);
  const best = matches[0];
  const sizeMB = (best.size / (1024 * 1024)).toFixed(2);

  if (best.size > 48 * 1024 * 1024) {
    if (ctx) {
      await ctx.reply(
        `📁 *Archivo Encontrado:* \`${best.name}\` (${sizeMB} MB)\n` +
        `⚠️ El archivo supera los 50 MB para enviarlo por Telegram.\n` +
        `📍 *Ruta en tu laptop:* \`${best.full}\``,
        { parse_mode: "Markdown" }
      );
    }
    return { status: "too_large", file: best };
  }

  if (ctx) {
    await ctx.replyWithChatAction("upload_document");
    await ctx.replyWithDocument(new InputFile(best.full), {
      caption: `📄 *Archivo desde tu laptop:* \`${best.name}\` (${sizeMB} MB)\n📍 Ubicación: \`${best.full}\``,
      parse_mode: "Markdown"
    });
  }

  return { status: "success", file: best.full, sizeMB };
}

/**
 * Guarda un archivo recibido por Telegram en el disco de la laptop.
 */
export async function saveIncomingTelegramFile(bot, fileId, fileName, customFolder = null) {
  const destDir = customFolder && fs.existsSync(customFolder)
    ? customFolder
    : path.join(USER_HOME, "Downloads");

  fs.mkdirSync(destDir, { recursive: true });
  const fileInfo = await bot.api.getFile(fileId);
  const downloadUrl = `https://api.telegram.org/file/bot${CONFIG.telegram.botToken}/${fileInfo.file_path}`;

  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar archivo desde Telegram`);

  const buf = Buffer.from(await res.arrayBuffer());
  const safeName = fileName || path.basename(fileInfo.file_path) || `archivo_${Date.now()}`;
  const targetPath = path.join(destDir, safeName);

  fs.writeFileSync(targetPath, buf);
  const sizeMB = (buf.length / (1024 * 1024)).toFixed(2);

  return {
    status: "saved",
    targetPath,
    fileName: safeName,
    sizeMB
  };
}
