import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { InputFile } from "grammy";
import { ROOT_DIR } from "../config.mjs";

const execAsync = promisify(exec);
const YTDLP_BIN = path.join(ROOT_DIR, "bin", "yt-dlp.exe");
const FFMPEG_BIN = path.join(ROOT_DIR, "bin", "ffmpeg.exe");
const DOWNLOADS_DIR = path.join(process.env.USERPROFILE || "C:\\Users\\USER", "Downloads");

/**
 * Descarga video o audio desde YouTube, TikTok, Twitter/X, Instagram, etc.
 */
export async function downloadMediaFromUrl({ url, format = "auto", ctx = null }) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  const isAudioOnly = format === "audio" || format === "mp3";
  const outputTemplate = path.join(DOWNLOADS_DIR, `media_${Date.now()}_%(title).50s.%(ext)s`);

  let args = [];
  if (isAudioOnly) {
    args = [
      `"${YTDLP_BIN}"`,
      `--ffmpeg-location "${path.dirname(FFMPEG_BIN)}"`,
      `-x`,
      `--audio-format mp3`,
      `--audio-quality 0`,
      `-o "${outputTemplate}"`,
      `--no-playlist`,
      `"${url}"`
    ];
  } else {
    // Video compatible hasta 1080p en MP4
    args = [
      `"${YTDLP_BIN}"`,
      `--ffmpeg-location "${path.dirname(FFMPEG_BIN)}"`,
      `-f "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best"`,
      `--merge-output-format mp4`,
      `-o "${outputTemplate}"`,
      `--no-playlist`,
      `"${url}"`
    ];
  }

  const cmd = args.join(" ");
  console.log(`[MediaDownload] Ejecutando: ${cmd}`);

  if (ctx) {
    await ctx.reply(`⏳ *Descargando ${isAudioOnly ? "audio MP3" : "video"} en tu laptop...*`, {
      parse_mode: "Markdown"
    });
  }

  const { stdout } = await execAsync(cmd, { timeout: 120000 });

  // Buscar el archivo resultante más reciente en Downloads
  const files = fs.readdirSync(DOWNLOADS_DIR).map(f => {
    const full = path.join(DOWNLOADS_DIR, f);
    return { name: f, full, time: fs.statSync(full).mtimeMs, size: fs.statSync(full).size };
  }).sort((a, b) => b.time - a.time);

  const downloaded = files.find(f => f.name.startsWith("media_"));
  if (!downloaded || !fs.existsSync(downloaded.full)) {
    throw new Error("La descarga finalizó pero no se encontró el archivo generado en Descargas.");
  }

  const sizeMB = (downloaded.size / (1024 * 1024)).toFixed(2);
  const isUnderTelegramLimit = downloaded.size <= 48 * 1024 * 1024; // 48 MB

  if (ctx) {
    if (isUnderTelegramLimit) {
      if (isAudioOnly) {
        await ctx.replyWithChatAction("upload_voice");
        await ctx.replyWithAudio(new InputFile(downloaded.full), {
          caption: `🎵 *Audio Descargado:* \`${downloaded.name}\` (${sizeMB} MB)\n💾 Guardado en: \`${downloaded.full}\``,
          parse_mode: "Markdown"
        });
      } else {
        await ctx.replyWithChatAction("upload_video");
        await ctx.replyWithVideo(new InputFile(downloaded.full), {
          caption: `🎬 *Video Descargado:* \`${downloaded.name}\` (${sizeMB} MB)\n💾 Guardado en: \`${downloaded.full}\``,
          parse_mode: "Markdown"
        });
      }
    } else {
      await ctx.reply(
        `✅ *Descarga Completa en tu Laptop*\n\n` +
        `• 📁 *Archivo:* \`${downloaded.name}\`\n` +
        `• 💾 *Tamaño:* *${sizeMB} MB* (Supera el límite de 50MB de Telegram para envío directo)\n` +
        `• 📍 *Ubicación en tu disco:* \`${downloaded.full}\``,
        { parse_mode: "Markdown" }
      );
    }
  }

  return {
    status: "success",
    filePath: downloaded.full,
    fileName: downloaded.name,
    sizeMB,
    sentToTelegram: isUnderTelegramLimit
  };
}
