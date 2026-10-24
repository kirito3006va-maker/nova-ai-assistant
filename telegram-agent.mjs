import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Bot, Keyboard, InlineKeyboard, InputFile } from "grammy";
import { Type } from "@google/genai";

import { CONFIG, ROOT_DIR, OUTBOX_DIR, OWNER_FILE } from "./src/config.mjs";
import { generateUsageTelegramReport, recordUsage } from "./src/telemetry/usage-tracker.mjs";
import { executeRoutedContent, selectModelChain, getActiveMode, setActiveMode } from "./src/router/model-router.mjs";
import { generateArtImage } from "./src/services/image-service.mjs";
import {
  ensureInteractiveLauncherTask,
  captureRealDesktop,
  getRealDesktopWindows,
  focusRealDesktopWindow,
  runOnInteractiveDesktop,
  fetchSafeHardwareTelemetry,
  playMusicTrack,
  playYouTubeVideo,
  launchUniversalApplication,
  resolveApplicationCommand,
  manageGameLauncherUpdates,
  downloadOrInstallAppViaBraveOrWinget,
  delegateProjectToAntigravity,
  APP_CATALOG
} from "./src/services/system-service.mjs";
import { analyzeScreenVisual } from "./src/services/vision-service.mjs";
import { armCentinela, disarmCentinela, isCentinelaActive, captureWebcamPhoto } from "./src/services/security-service.mjs";
import { downloadMediaFromUrl } from "./src/services/media-download-service.mjs";
import { searchAndSendFile, saveIncomingTelegramFile } from "./src/services/cloud-file-service.mjs";
import { turnOffScreen, suspendLaptop, scheduleShutdown, cancelShutdown, controlVolume, startProactiveBatteryMonitor } from "./src/services/power-service.mjs";
import { openWebTask, summarizeWebPage } from "./src/services/browser-task-service.mjs";
import {
  createWordDocument,
  writeLiveInMicrosoftWord,
  createPdfDocument,
  createPowerPointPresentation,
  createCodeOrTemplateFile
} from "./src/services/doc-service.mjs";
import {
  isGeminiWebAvailable,
  generateGeminiWebContent,
  resetNotebookSession,
  getNotebookMetadata,
  refreshWebTokens,
  startGeminiWebKeepAlive,
  syncActionToGeminiNotebook
} from "./src/adapters/gemini-web-adapter.mjs";
import { buildSystemMemoryPrompt, autoExtractAndSaveFacts, addEpisode, addFact, loadMemory, getLimaTimeString } from "./src/services/memory-service.mjs";
import { addReminder, listReminders, deleteReminder, parseReminderFromPrompt, startAgendaScheduler, formatLimaDate } from "./src/services/agenda-service.mjs";
import { moveCursor, clickMouse, doubleClickMouse, rightClickMouse, scrollWheel, typeTextOnScreen, locateAndClickElement } from "./src/services/computer-use-service.mjs";
import { startVoiceGateway, broadcastToClients } from "./src/services/voice-gateway.mjs";
import { generateSpeech, isElevenLabsConfigured } from "./src/services/elevenlabs-service.mjs";

const execAsync = promisify(exec);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bot = new Bot(CONFIG.telegram.botToken);

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

const mainKeyboard = new Keyboard()
  .text("👁️ Analizar Pantalla").text("🛡️ Modo Centinela").row()
  .text("📸 Captura Pantalla").text("📷 Foto Webcam").row()
  .text("🎵 Poner Música").text("🎬 Ver Video YouTube").row()
  .text("🎨 Generar Imagen").text("📊 Estado Rápido").row()
  .text("🔌 Apagar Pantalla").text("🔒 Bloquear PC")
  .resized();

// ================= DEFINICIÓN OFICIAL DE HERRAMIENTAS =================
const toolDefinitions = [
  {
    name: "generateAIImage",
    description: "Genera una imagen artística o fotorrealista de alta calidad (1024x1024) con IA según la descripción del usuario y opcionalmente con texto renderizado de forma nítida, y la envía directamente por Telegram.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING, description: "Descripción detallada de la escena, arte, personajes o elementos a generar." },
        textOverlay: { type: Type.STRING, description: "Texto específico que debe aparecer escrito en la imagen si el usuario lo pidió (ej: 'Cris Wuebon')." },
        style: { type: Type.STRING, description: "Estilo artístico (ej: 'cyberpunk neón', 'anime', 'fotorrealista 8k', 'póster holográfico', 'render 3d')." }
      },
      required: ["prompt"]
    }
  },
  {
    name: "takeScreenshot",
    description: "Toma una captura de pantalla real en 1920x1080 del escritorio físico (WinSta0\\Default) de la laptop y la envía por Telegram.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caption: { type: Type.STRING, description: "Descripción opcional para acompañar la captura de pantalla." }
      }
    }
  },
  {
    name: "launchApplication",
    description: "Abre cualquier aplicación, programa o juego de forma visible en la pantalla real de la laptop (ej: Steam, Brave, VS Code, Discord, Explorer, Calculadora, Notepad, Valorant, Genshin Impact, MATLAB, NetBeans, HWMonitor, etc.) y envía automáticamente una captura de confirmación.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        appName: { type: Type.STRING, description: "Nombre de la aplicación, ruta o ejecutable a abrir." },
        sendVerificationScreenshot: { type: Type.BOOLEAN, description: "Si es true (por defecto), envía una captura real de la pantalla tras abrir la app." }
      },
      required: ["appName"]
    }
  },
  {
    name: "listOpenWindows",
    description: "Lista todas las ventanas visibles actualmente abiertas en la pantalla real de la laptop con su ID de proceso (PID) y título.",
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: "focusOrCloseWindow",
    description: "Trae al frente (focus) una ventana abierta en la pantalla de la laptop, o cierra/finaliza (close) una aplicación por nombre o PID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'focus' para traer la ventana al frente, o 'close' para cerrar el proceso/aplicación." },
        target: { type: Type.STRING, description: "Título de la ventana, nombre del ejecutable (ej. steam.exe, notepad.exe) o PID." }
      },
      required: ["action", "target"]
    }
  },
  {
    name: "playMusic",
    description: "Busca y reproduce automáticamente cualquier canción, artista o álbum en YouTube Music o YouTube en la pantalla de la laptop y envía una captura de pantalla de confirmación por Telegram.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Nombre de la canción, artista o tema (ej: 'bob marley', 'could you be loved', 'queen', etc.)." },
        platform: { type: Type.STRING, description: "'youtube_music' (por defecto) o 'youtube'." }
      },
      required: ["query"]
    }
  },
  {
    name: "playYouTubeVideo",
    description: "Busca y reproduce cualquier video de YouTube en la pantalla principal de la laptop, ya sea mediante una búsqueda de texto (ej. 'trailer sword art online', 'tutorial react', etc.) o mediante un enlace directo de YouTube (ej. https://youtube.com/watch?v=... o https://youtu.be/...), enfoca la ventana y envía una captura de pantalla de confirmación a Telegram.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Título, tema o palabras clave del video a buscar y reproducir (opcional si se provee url)." },
        url: { type: Type.STRING, description: "Enlace directo de YouTube si el usuario lo compartió (ej: https://youtu.be/..., https://www.youtube.com/watch?v=...)." }
      }
    }
  },
  {
    name: "openUrlInBrowser",
    description: "Abre una página web, búsqueda o video de forma visible en una ventana de navegador Brave en la pantalla de la laptop y envía una captura de confirmación.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: "URL completa (ej. https://youtube.com) a abrir en Brave." }
      },
      required: ["url"]
    }
  },
  {
    name: "getHardwareTelemetry",
    description: "Obtiene telemetría completa y en tiempo real de la laptop: temperatura exacta de la GPU NVIDIA RTX 4060, consumo en Watts, uso de VRAM, carga de CPU Ryzen 7 7435HS, memoria RAM, espacio en discos NVMe, estado de batería y procesos que más consumen.",
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: "runTerminalCommand",
    description: "Ejecuta cualquier comando o script de PowerShell en la laptop y devuelve la salida.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: { type: Type.STRING, description: "Comando de PowerShell a ejecutar." }
      },
      required: ["command"]
    }
  },
  {
    name: "readLocalFile",
    description: "Lee el contenido de un archivo local del disco de la laptop.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: { type: Type.STRING, description: "Ruta completa del archivo a leer." }
      },
      required: ["filePath"]
    }
  },
  {
    name: "writeLocalFile",
    description: "Crea o modifica un archivo en el disco de la laptop (código, scripts, reportes, CSV, HTML, etc.).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: { type: Type.STRING, description: "Ruta donde guardar el archivo." },
        content: { type: Type.STRING, description: "Contenido completo a escribir en el archivo." }
      },
      required: ["filePath", "content"]
    }
  },
  {
    name: "listDirectory",
    description: "Lista los archivos y carpetas dentro de un directorio del disco (ej: C:\\Users\\USER\\Desktop, Downloads, Documents, etc.).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        dirPath: { type: Type.STRING, description: "Ruta del directorio a explorar." }
      },
      required: ["dirPath"]
    }
  },
  {
    name: "sendFileToTelegram",
    description: "Envía cualquier archivo o documento guardado en la laptop directamente al chat de Telegram del usuario para que lo descargue.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: { type: Type.STRING, description: "Ruta del archivo local a enviar por Telegram." },
        caption: { type: Type.STRING, description: "Comentario opcional para adjuntar con el archivo." }
      },
      required: ["filePath"]
    }
  },
  {
    name: "systemControl",
    description: "Controla funciones del sistema en la laptop: subir/bajar volumen, silenciar audio, pausar/reproducir multimedia, o bloquear la pantalla de Windows.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "Acción a ejecutar: 'lock' (bloquear PC), 'volume_up', 'volume_down', 'mute', 'play_pause', 'next_track', 'prev_track'."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "analyzeScreenVisual",
    description: "Analiza visualmente la pantalla física en tiempo real con Gemini Multimodal para responder cualquier pregunta sobre lo que está viendo (código, errores en NetBeans/VS Code, directos de streaming, videojuegos o documentos).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Pregunta o instrucción de análisis sobre lo que hay en la pantalla." }
      }
    }
  },
  {
    name: "centinelaControl",
    description: "Controla el sistema de vigilancia y seguridad Centinela en la laptop: 'arm' para activar vigilancia por movimiento de mouse y desconexión de cargador, 'disarm' para desactivar, o 'status' para consultar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'arm', 'disarm' o 'status'." }
      },
      required: ["action"]
    }
  },
  {
    name: "takeWebcamPhoto",
    description: "Toma una foto instantánea con la cámara web integrada de la laptop y la envía a Telegram.",
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: "downloadMedia",
    description: "Descarga videos o audios desde enlaces de YouTube, TikTok, Twitter/X, Instagram a la laptop y los envía a Telegram si pesan menos de 50MB.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: "URL del video o contenido a descargar." },
        format: { type: Type.STRING, description: "'video' (por defecto) o 'audio' (MP3)." }
      },
      required: ["url"]
    }
  },
  {
    name: "searchFileOnLaptop",
    description: "Busca archivos en el Escritorio, Documentos o Descargas de la laptop por nombre y los envía por Telegram.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Nombre o fragmento del archivo a buscar." }
      },
      required: ["query"]
    }
  },
  {
    name: "powerControl",
    description: "Controla la energía y pantalla de la laptop: 'screen_off' (apaga el monitor pero mantiene descargas/música), 'sleep' (suspende laptop), 'shutdown' (programa apagado), 'cancel_shutdown' (cancela apagado).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'screen_off', 'sleep', 'shutdown', 'cancel_shutdown'." },
        minutes: { type: Type.NUMBER, description: "Minutos para programar el apagado si la acción es shutdown." }
      },
      required: ["action"]
    }
  },
  {
    name: "openWebTask",
    description: "Abre accesos rápidos web en Brave (Intranet UNJFSC, WhatsApp Web, Gmail, GitHub, ChatGPT) o realiza búsquedas en Google.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: { type: Type.STRING, description: "Nombre del portal o término de búsqueda en Google." }
      },
      required: ["target"]
    }
  },
  {
    name: "summarizeWebPage",
    description: "Descarga y resume los puntos clave de cualquier página web o artículo a partir de su URL.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: "URL de la página web a resumir." }
      },
      required: ["url"]
    }
  },
  {
    name: "computerUse",
    description: "Control autónomo del puntero del mouse y teclado en Windows: mover cursor, hacer clic en coordenadas, ubicar visualmente un elemento y hacer clic, hacer doble clic, clic derecho o teclear texto.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'locate_and_click' (ubica visualmente y hace clic), 'click', 'double_click', 'right_click', 'move', 'type', 'scroll'." },
        target: { type: Type.STRING, description: "Nombre o descripción del botón/enlace a buscar visualmente, o texto a escribir." },
        x: { type: Type.NUMBER, description: "Coordenada horizontal X (0..1920) si se especifica manualmente." },
        y: { type: Type.NUMBER, description: "Coordenada vertical Y (0..1080) si se especifica manualmente." }
      },
      required: ["action"]
    }
  },
  {
    name: "manageAgenda",
    description: "Gestiona la agenda y recordatorios de Kirito con el horario exacto de Perú (UTC-5): 'add' (crear recordatorio), 'list' (consultar agenda), 'delete' (eliminar recordatorio).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'add', 'list', 'delete'." },
        title: { type: Type.STRING, description: "Descripción o título del evento o recordatorio." },
        minutesFromNow: { type: Type.NUMBER, description: "Minutos a partir de ahora para programar la alarma." },
        id: { type: Type.STRING, description: "ID del recordatorio si se va a eliminar." }
      },
      required: ["action"]
    }
  },
  {
    name: "manageMemory",
    description: "Consulta o añade hechos a la memoria permanente local de Nova en la laptop de Kirito: 'read' (consultar memoria), 'remember' (grabar nuevo hecho permanente).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'read' o 'remember'." },
        fact: { type: Type.STRING, description: "Información, gusto, fecha importante o dato de Kirito para guardar en el disco de la laptop." }
      },
      required: ["action"]
    }
  },
  {
    name: "generateDocumentOrCode",
    description: "Genera y redacta cualquier documento Word (.docx), PDF (.pdf), presentación PowerPoint (.pptx), plantilla o archivo de código (.sql, .java, .py, .html, .js, etc.), lo abre en pantalla (en Word, PowerPoint o VS Code) y lo envía automáticamente al Telegram de Kirito.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        format: { type: Type.STRING, description: "'word' (.docx), 'pdf' (.pdf), 'ppt' (.pptx), o 'code' (código/plantilla)." },
        title: { type: Type.STRING, description: "Título del documento, presentación o archivo." },
        topicOrInstructions: { type: Type.STRING, description: "Tema, instrucciones detalladas o especificaciones de lo que debe contener." },
        extension: { type: Type.STRING, description: "Extensión si es código (ej. '.sql', '.java', '.py', '.html', '.js')." }
      },
      required: ["format", "title", "topicOrInstructions"]
    }
  },
  {
    name: "writeDirectlyInMicrosoftWord",
    description: "Escribe y redacta en vivo directamente dentro de la ventana abierta de Microsoft Word en la pantalla de la laptop de Kirito, guarda el documento .docx y lo envía automáticamente a Telegram.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Título del documento o plantilla." },
        topicOrContent: { type: Type.STRING, description: "Tema o texto detallado a redactar en vivo en Microsoft Word." }
      },
      required: ["title", "topicOrContent"]
    }
  },
  {
    name: "manageSteamAndEpic",
    description: "Abre y controla las descargas o actualizaciones de juegos en Steam o Epic Games Launcher en la laptop y envía una captura en vivo a Telegram.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        platform: { type: Type.STRING, description: "'steam' o 'epic'." },
        action: { type: Type.STRING, description: "'downloads' (cola de descargas/actualizaciones) o 'library' (biblioteca)." }
      },
      required: ["platform"]
    }
  },
  {
    name: "downloadAppFromBrave",
    description: "Busca y abre la descarga oficial de cualquier programa o aplicación en Brave Browser y verifica paquetes con winget, enviando captura a Telegram.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        appName: { type: Type.STRING, description: "Nombre de la aplicación a buscar y descargar." }
      },
      required: ["appName"]
    }
  },
  {
    name: "delegateTaskToAntigravity",
    description: "Delega la creación o desarrollo de un proyecto o tarea compleja directamente a Google Antigravity IDE en la laptop de Kirito, creando el workspace y abriéndolo en vivo.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        projectName: { type: Type.STRING, description: "Nombre del proyecto o carpeta." },
        taskDescription: { type: Type.STRING, description: "Descripción completa de lo que Antigravity debe construir." }
      },
      required: ["projectName", "taskDescription"]
    }
  }
];

// ================= EJECUCIÓN DE HERRAMIENTAS =================
async function executeTool(name, args, ctx, turnState = {}) {
  console.log(`[Tool Call] ${name} ->`, JSON.stringify(args));

  if (name === "generateAIImage") {
    try {
      await ctx.replyWithChatAction("upload_photo");
      const p = args.prompt || "arte digital cyberpunk 8k";

      // 1. Prioridad: Generar con Imagen 3 desde Gemini Advanced Web
      if (isGeminiWebAvailable()) {
        try {
          const webRes = await generateGeminiWebContent({ prompt: `Genera una imagen artística en ultra alta definición de: ${p}` });
          if (webRes.localImages && webRes.localImages.length > 0) {
            const firstImg = webRes.localImages[0];
            await ctx.replyWithPhoto(new InputFile(firstImg), {
              caption: `🎨 *Imagen Ultra HD generada con Imagen 3 (Gemini Advanced Pro)*\n"${p}"`,
              parse_mode: "Markdown"
            });
            turnState.imageSent = true;
            return { status: "success", imagePath: firstImg, engine: "Imagen 3 (Gemini Pro)", message: "Imagen generada con Imagen 3." };
          }
        } catch (webErr) {
          console.warn("[generateAIImage] Fallo en Imagen 3 web:", webErr.message);
        }
      }

      // 2. Fallback
      const t = args.textOverlay || "";
      const s = args.style || "cyberpunk neon";
      const { imagePath, engine } = await generateArtImage({ prompt: p, textOverlay: t, style: s });

      const captionText = `🎨 *Imagen generada (${engine}):*\n"${p}"${t ? ` con texto *"${t}"*` : ""}`;
      await ctx.replyWithPhoto(new InputFile(imagePath), { caption: captionText, parse_mode: "Markdown" });
      turnState.imageSent = true;
      return { status: "success", imagePath, engine, message: `Imagen generada y entregada con ${engine}.` };
    } catch (e) {
      return { error: `Error generando imagen: ${e.message}` };
    }
  }

  if (name === "takeScreenshot") {
    if (turnState.screenshotSentAt && Date.now() - turnState.screenshotSentAt < 3500) {
      return { status: "success", message: "Captura de pantalla ya enviada en este turno." };
    }
    try {
      await ctx.replyWithChatAction("upload_photo");
      const shotPath = path.join(OUTBOX_DIR, `screen_${Date.now()}.jpg`);
      await captureRealDesktop(shotPath);
      const caption = args?.caption || "📸 *Captura en tiempo real de tu pantalla (1920x1080).*";
      await ctx.replyWithPhoto(new InputFile(shotPath), { caption, parse_mode: "Markdown" });
      turnState.screenshotSentAt = Date.now();
      return { status: "success", file: shotPath, message: "Captura real enviada a Telegram." };
    } catch (e) {
      return { error: `Error al capturar pantalla: ${e.message}` };
    }
  }

  if (name === "launchApplication") {
    const shouldVerify = args.sendVerificationScreenshot !== false;
    try {
      const res = await launchUniversalApplication(args.appName, shouldVerify);
      if (res.shotPath && shouldVerify) {
        await ctx.replyWithPhoto(new InputFile(res.shotPath), {
          caption: `🚀 *${res.application}* abierto en tu pantalla en tiempo real.`,
          parse_mode: "Markdown"
        });
        turnState.screenshotSentAt = Date.now();
      }
      return { status: "success", application: res.application, message: `${res.application} abierto visiblemente en tu pantalla.` };
    } catch (e) {
      return { error: `No se pudo abrir ${args.appName}: ${e.message}` };
    }
  }

  if (name === "listOpenWindows") {
    try {
      const wins = await getRealDesktopWindows();
      return { status: "success", windows: wins ? wins.split(" | ") : [] };
    } catch (e) {
      return { error: e.message };
    }
  }

  if (name === "focusOrCloseWindow") {
    try {
      if (args.action === "focus") {
        const res = await focusRealDesktopWindow(args.target);
        return { status: "success", result: res };
      } else {
        const t = args.target.trim();
        if (/^\d+$/.test(t)) {
          await execAsync(`taskkill /F /PID ${t} /T`);
        } else {
          const exe = t.endsWith(".exe") ? t : `${t}.exe`;
          await execAsync(`taskkill /F /IM "${exe}" /T`);
        }
        return { status: "success", message: `Proceso/ventana '${t}' finalizado.` };
      }
    } catch (e) {
      return { error: e.message };
    }
  }

  if (name === "playMusic") {
    try {
      await ctx.replyWithChatAction("typing");
      const q = args.query;
      const plat = args.platform || "youtube_music";
      const res = await playMusicTrack({ query: q, platform: plat });

      await sleep(1500);
      const shotPath = path.join(OUTBOX_DIR, `music_${Date.now()}.jpg`);
      await captureRealDesktop(shotPath);
      await ctx.replyWithPhoto(new InputFile(shotPath), {
        caption: `🎵 *Reproduciendo en ${res.platform}:*\n🎶 _"${q}"_\n🔗 [Ver en tu laptop](${res.url})`,
        parse_mode: "Markdown"
      });
      turnState.screenshotSentAt = Date.now();

      return {
        status: "success",
        message: `Reproduciendo "${q}" en ${res.platform}.`,
        url: res.url
      };
    } catch (e) {
      return { error: `Error reproduciendo música: ${e.message}` };
    }
  }

  if (name === "playYouTubeVideo") {
    try {
      await ctx.replyWithChatAction("typing");
      const res = await playYouTubeVideo({ query: args.query, url: args.url });

      await sleep(2000);
      const shotPath = path.join(OUTBOX_DIR, `yt_video_${Date.now()}.jpg`);
      await captureRealDesktop(shotPath);

      const titleLine = res.title ? `🎬 *Video:* _${res.title}_\n` : "";
      await ctx.replyWithPhoto(new InputFile(shotPath), {
        caption: `▶️ *Reproduciendo Video de YouTube*\n\n${titleLine}🔗 [Ver en tu laptop](${res.url})`,
        parse_mode: "Markdown"
      });
      turnState.screenshotSentAt = Date.now();

      return {
        status: "success",
        title: res.title,
        url: res.url,
        message: `Video '${res.title}' abierto y reproduciéndose en la pantalla principal.`
      };
    } catch (e) {
      await ctx.reply(`⚠️ No se pudo reproducir el video: ${e.message}`);
      return { error: `Error reproduciendo video de YouTube: ${e.message}` };
    }
  }

  if (name === "openUrlInBrowser") {
    try {
      const url = args.url.startsWith("http") ? args.url : `https://${args.url}`;
      await runOnInteractiveDesktop([
        `start "" "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --new-window "${url}"`
      ]);
      await sleep(2500);
      await focusRealDesktopWindow("Brave").catch(() => {});

      const shotPath = path.join(OUTBOX_DIR, `web_${Date.now()}.jpg`);
      await captureRealDesktop(shotPath);
      await ctx.replyWithPhoto(new InputFile(shotPath), {
        caption: `🌐 *Página web abierta en tu pantalla:*\n🔗 ${url}`,
        parse_mode: "Markdown"
      });
      turnState.screenshotSentAt = Date.now();

      return { status: "success", url, message: `URL ${url} abierta en Brave y verificada con captura.` };
    } catch (e) {
      return { error: e.message };
    }
  }

  if (name === "getHardwareTelemetry") {
    return await fetchSafeHardwareTelemetry();
  }

  if (name === "runTerminalCommand") {
    try {
      const safeCmd = args.command.replace(/"/g, '`"');
      const { stdout, stderr } = await execAsync(`powershell.exe -NoProfile -Command "${safeCmd}"`, { timeout: 30000 });
      return { output: (stdout || stderr || "Comando ejecutado exitosamente sin salida.").trim().slice(0, 8000) };
    } catch (e) {
      return { error: e.message, stderr: e.stderr };
    }
  }

  if (name === "readLocalFile") {
    try {
      const resolved = path.resolve(args.filePath);
      const content = fs.readFileSync(resolved, "utf8");
      return { filePath: resolved, content: content.slice(0, 12000) };
    } catch (e) {
      return { error: e.message };
    }
  }

  if (name === "writeLocalFile") {
    try {
      const resolved = path.resolve(args.filePath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, args.content, "utf8");
      return { status: "success", filePath: resolved, bytesWritten: Buffer.byteLength(args.content, "utf8") };
    } catch (e) {
      return { error: e.message };
    }
  }

  if (name === "listDirectory") {
    try {
      let targetDir = args.dirPath;
      if (/^desktop|escritorio$/i.test(targetDir)) targetDir = "C:\\Users\\USER\\Desktop";
      if (/^downloads|descargas$/i.test(targetDir)) targetDir = "C:\\Users\\USER\\Downloads";
      if (/^documents|documentos$/i.test(targetDir)) targetDir = "C:\\Users\\USER\\Documents";
      const resolved = path.resolve(targetDir);
      const entries = fs.readdirSync(resolved, { withFileTypes: true }).slice(0, 100).map(d => ({
        name: d.name,
        type: d.isDirectory() ? "folder" : "file"
      }));
      return { directory: resolved, count: entries.length, items: entries };
    } catch (e) {
      return { error: e.message };
    }
  }

  if (name === "sendFileToTelegram") {
    try {
      const resolved = path.resolve(args.filePath);
      if (!fs.existsSync(resolved)) return { error: `El archivo no existe: ${resolved}` };
      await ctx.replyWithChatAction("upload_document");
      await ctx.replyWithDocument(new InputFile(resolved), {
        caption: args.caption || `📄 Archivo desde tu laptop: \`${path.basename(resolved)}\``,
        parse_mode: "Markdown"
      });
      return { status: "success", sentFile: resolved };
    } catch (e) {
      return { error: e.message };
    }
  }

  if (name === "systemControl") {
    try {
      const act = args.action;
      if (act === "lock") {
        await runOnInteractiveDesktop(["rundll32.exe user32.dll,LockWorkStation"]);
        return { status: "success", message: "Laptop bloqueada." };
      }
      const keyMap = { volume_up: "175", volume_down: "174", mute: "173", play_pause: "179", next_track: "176", prev_track: "177" };
      const vk = keyMap[act];
      if (vk) {
        await execAsync(`powershell.exe -NoProfile -Command "$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]${vk})"`);
        return { status: "success", action: act };
      }
      return { error: `Acción no reconocida: ${act}` };
    } catch (e) {
      return { error: e.message };
    }
  }

  if (name === "analyzeScreenVisual") {
    try {
      await ctx.replyWithChatAction("typing");
      const res = await analyzeScreenVisual({ query: args.query || "¿Qué hay en mi pantalla?", ctx });
      turnState.screenshotSentAt = Date.now();
      return { status: "success", analysis: res.analysis };
    } catch (e) {
      return { error: `Error en análisis de pantalla: ${e.message}` };
    }
  }

  if (name === "centinelaControl") {
    const act = args.action;
    const ownerId = getOwnerId();
    if (act === "arm") {
      const res = await armCentinela(bot, ownerId);
      await ctx.reply(res.message, { parse_mode: "Markdown" });
      return res;
    } else if (act === "disarm") {
      const res = disarmCentinela();
      await ctx.reply(res.message, { parse_mode: "Markdown" });
      return res;
    } else {
      const armed = isCentinelaActive();
      const msg = armed ? "🛡️ El Modo Centinela está *ACTIVO* y vigilando." : "🟢 El Modo Centinela está *DESACTIVADO*.";
      await ctx.reply(msg, { parse_mode: "Markdown" });
      return { status: armed ? "armed" : "disarmed" };
    }
  }

  if (name === "takeWebcamPhoto") {
    try {
      await ctx.replyWithChatAction("upload_photo");
      const webcamPath = path.join(OUTBOX_DIR, `cam_${Date.now()}.jpg`);
      await captureWebcamPhoto(webcamPath);
      await ctx.replyWithPhoto(new InputFile(webcamPath), {
        caption: `📷 *Fotografía en tiempo real desde la cámara web de tu laptop.*`,
        parse_mode: "Markdown"
      });
      return { status: "success", file: webcamPath };
    } catch (e) {
      return { error: `Error al capturar cámara web: ${e.message}` };
    }
  }

  if (name === "downloadMedia") {
    try {
      const res = await downloadMediaFromUrl({ url: args.url, format: args.format || "auto", ctx });
      return res;
    } catch (e) {
      return { error: `Error descargando multimedia: ${e.message}` };
    }
  }

  if (name === "searchFileOnLaptop") {
    try {
      const res = await searchAndSendFile({ query: args.query }, ctx);
      return res;
    } catch (e) {
      return { error: `Error buscando archivo: ${e.message}` };
    }
  }

  if (name === "powerControl") {
    const act = args.action;
    if (act === "screen_off") {
      const res = await turnOffScreen();
      await ctx.reply(`🔌 *${res.message}*`, { parse_mode: "Markdown" });
      return res;
    } else if (act === "sleep") {
      await ctx.reply("💤 *Suspendiendo tu laptop...*", { parse_mode: "Markdown" });
      return await suspendLaptop();
    } else if (act === "shutdown") {
      const mins = args.minutes || 30;
      const res = await scheduleShutdown(mins);
      await ctx.reply(`⏱️ *${res.message}*`, { parse_mode: "Markdown" });
      return res;
    } else if (act === "cancel_shutdown") {
      const res = await cancelShutdown();
      await ctx.reply(`🟢 *${res.message}*`, { parse_mode: "Markdown" });
      return res;
    }
    return { error: `Acción de energía no reconocida: ${act}` };
  }

  if (name === "openWebTask") {
    try {
      const res = await openWebTask(args.target);
      await ctx.replyWithPhoto(new InputFile(res.shotPath), {
        caption: `🌐 *Portal/Búsqueda abierto en Brave:*\n🔗 ${res.url}`,
        parse_mode: "Markdown"
      });
      turnState.screenshotSentAt = Date.now();
      return { status: "success", url: res.url };
    } catch (e) {
      return { error: `Error abriendo portal web: ${e.message}` };
    }
  }

  if (name === "summarizeWebPage") {
    try {
      await ctx.replyWithChatAction("typing");
      const res = await summarizeWebPage(args.url);
      if (res.status === "success") {
        await ctx.reply(`📑 *Resumen Inteligente de:* ${args.url}\n\n${res.summary}`, { parse_mode: "Markdown" });
        return res;
      }
      return { error: res.message };
    } catch (e) {
      return { error: `Error resumiendo página web: ${e.message}` };
    }
  }

  if (name === "computerUse") {
    try {
      const act = args.action;
      if (act === "locate_and_click") {
        await ctx.reply(`🖱️ *Buscando visualmente "${args.target}" en tu pantalla y haciendo clic...*`, { parse_mode: "Markdown" });
        const res = await locateAndClickElement({ query: args.target });
        if (res.status === "success" && res.followUpShot) {
          await ctx.replyWithPhoto(new InputFile(res.followUpShot), {
            caption: `🖱️ *Clic completado en "${res.element}"* (${res.x}, ${res.y}). Captura de verificación.`,
            parse_mode: "Markdown"
          });
        }
        return res;
      } else if (act === "click" || act === "right_click" || act === "double_click") {
        const btn = act === "right_click" ? "right" : act === "double_click" ? "double" : "left";
        return await clickMouse(args.x, args.y, btn);
      } else if (act === "move") {
        return await moveCursor(args.x, args.y);
      } else if (act === "type") {
        return await typeTextOnScreen(args.target || "");
      } else if (act === "scroll") {
        return await scrollWheel(args.x || -300);
      }
    } catch (e) {
      return { error: `Error en control del puntero: ${e.message}` };
    }
  }

  if (name === "manageAgenda") {
    try {
      const act = args.action;
      if (act === "add") {
        const mins = Number(args.minutesFromNow) || 30;
        const targetTs = Date.now() + mins * 60 * 1000;
        const rem = addReminder({ title: args.title || "Recordatorio", targetTimestamp: targetTs });
        await ctx.reply(`⏰ *Recordatorio Agendado en Horario de Lima:*\n\n📌 *${rem.title}*\n⏱️ *Alarma:* ${rem.targetLimaTime}`, { parse_mode: "Markdown" });
        return { status: "success", reminder: rem };
      } else if (act === "list") {
        const rems = listReminders();
        const listText = rems.length > 0
          ? rems.map(r => `• *${r.title}* ➔ \`${r.targetLimaTime}\``).join("\n")
          : "No tienes recordatorios pendientes en tu agenda.";
        await ctx.reply(`📅 *Agenda de Kirito (Hora de Perú - UTC-5):*\n\n${listText}`, { parse_mode: "Markdown" });
        return { status: "success", count: rems.length, reminders: rems };
      } else if (act === "delete") {
        const ok = deleteReminder(args.id);
        return { status: ok ? "success" : "not_found" };
      }
    } catch (e) {
      return { error: `Error en agenda: ${e.message}` };
    }
  }

  if (name === "manageMemory") {
    try {
      if (args.action === "remember") {
        addFact(args.fact);
        await ctx.reply(`🧠 *Recuerdo Grabado en mi Memoria Local:*\n"${args.fact}"`, { parse_mode: "Markdown" });
        return { status: "success", remembered: args.fact };
      } else {
        const mem = loadMemory();
        await ctx.reply(`🧠 *Memoria Permanente de Nova:*\n\n• *Dueño:* ${mem.profile.fullName} (${mem.profile.alias})\n• *Carrera:* ${mem.profile.role}\n• *Universidad:* ${mem.profile.university}\n• *Hechos Clave:* ${mem.facts.length} grabados en disco.`, { parse_mode: "Markdown" });
        return { status: "success", profile: mem.profile, factsCount: mem.facts.length };
      }
    } catch (e) {
      return { error: `Error en memoria: ${e.message}` };
    }
  }

  if (name === "generateDocumentOrCode") {
    try {
      await ctx.replyWithChatAction("upload_document");
      const fmt = (args.format || "word").toLowerCase();
      const title = args.title || "Documento_Nova";
      const topic = args.topicOrInstructions || title;

      let generatedContent = "";
      let modelUsed = "Gemini Advanced Web (Cuaderno Pro)";
      const genPrompt = fmt === "code"
        ? `Escribe únicamente el código fuente o plantilla completa, limpia, comentada y funcional para: "${topic}" (${title}).`
        : fmt === "ppt"
        ? `Redacta el contenido estructurado por diapositivas usando encabezados (# Título de Diapositiva y viñetas - punto clave) para una presentación profesional sobre: "${topic}" (${title}).`
        : `Redacta un documento o plantilla completa, exhaustiva, formal y bien estructurada con encabezados (#, ##, ###) y viñetas sobre: "${topic}" (${title}).`;

      if (isGeminiWebAvailable()) {
        try {
          const webRes = await generateGeminiWebContent({ prompt: genPrompt });
          generatedContent = webRes.text || "";
          modelUsed = webRes.model;
        } catch {}
      }
      if (!generatedContent) {
        const { response, model } = await executeRoutedContent({ prompt: genPrompt, tools: [] });
        generatedContent = response.text || "";
        modelUsed = model;
      }

      if (fmt === "pdf") {
        const { filePath, fileName } = await createPdfDocument({ title, content: generatedContent });
        await ctx.replyWithDocument(new InputFile(filePath, fileName), {
          caption: `📕 *Documento PDF Generado por Nova*\n📌 *Título:* \`${title}\`\n✦ _${modelUsed}_`,
          parse_mode: "Markdown"
        });
        return { status: "success", format: "pdf", fileName, filePath };
      } else if (fmt === "ppt" || fmt === "pptx" || fmt === "powerpoint") {
        const { filePath, fileName } = await createPowerPointPresentation({ title, content: generatedContent, openOnDesktop: true });
        await ctx.replyWithDocument(new InputFile(filePath, fileName), {
          caption: `📊 *Presentación PowerPoint (.pptx) Lista y Abierta en tu PC*\n📌 *Título:* \`${title}\`\n✦ _${modelUsed}_`,
          parse_mode: "Markdown"
        });
        return { status: "success", format: "pptx", fileName, filePath };
      } else if (fmt === "code" || fmt === "codigo") {
        const ext = args.extension || ".txt";
        const { filePath, fileName } = await createCodeOrTemplateFile({ title, extension: ext, codeContent: generatedContent, openInEditor: true });
        await ctx.replyWithDocument(new InputFile(filePath, fileName), {
          caption: `💻 *Código / Plantilla Generada y Abierta en VS Code*\n📄 *Archivo:* \`${fileName}\`\n✦ _${modelUsed}_`,
          parse_mode: "Markdown"
        });
        return { status: "success", format: "code", fileName, filePath };
      } else {
        const { filePath, fileName } = await createWordDocument({ title, content: generatedContent, openOnDesktop: true });
        await ctx.replyWithDocument(new InputFile(filePath, fileName), {
          caption: `📄 *Documento Word (.docx) Generado y Abierto en tu PC*\n📌 *Título:* \`${title}\`\n✦ _${modelUsed}_`,
          parse_mode: "Markdown"
        });
        return { status: "success", format: "docx", fileName, filePath };
      }
    } catch (e) {
      return { error: `Error generando archivo: ${e.message}` };
    }
  }

  if (name === "writeDirectlyInMicrosoftWord") {
    try {
      await ctx.replyWithChatAction("upload_document");
      const title = args.title || "Redaccion_En_Vivo_Nova";
      const topic = args.topicOrContent || title;

      let content = topic;
      if (topic.length < 300) {
        const promptWord = `Redacta un documento o plantilla completa, bien estructurada y profesional sobre: "${topic}" (${title}).`;
        if (isGeminiWebAvailable()) {
          try {
            const wRes = await generateGeminiWebContent({ prompt: promptWord });
            if (wRes.text) content = wRes.text;
          } catch {}
        }
      }

      const { filePath, fileName } = await writeLiveInMicrosoftWord({ title, content });
      await ctx.replyWithDocument(new InputFile(filePath, fileName), {
        caption: `✍️ *Redactado en Vivo en tu Microsoft Word y Enviado a tu Telegram*\n📄 *Archivo:* \`${fileName}\``,
        parse_mode: "Markdown"
      });
      return { status: "success", fileName, filePath };
    } catch (e) {
      return { error: `Error redactando en Word: ${e.message}` };
    }
  }

  if (name === "manageSteamAndEpic") {
    try {
      const res = await manageGameLauncherUpdates({ platform: args.platform, action: args.action || "downloads" });
      if (res.shotPath) {
        await ctx.replyWithPhoto(new InputFile(res.shotPath), {
          caption: `🎮 *${res.platform} — Cola de Descargas y Actualizaciones Abierta en tu PC*`,
          parse_mode: "Markdown"
        });
      }
      return res;
    } catch (e) {
      return { error: `Error en launcher de juegos: ${e.message}` };
    }
  }

  if (name === "downloadAppFromBrave") {
    try {
      const res = await downloadOrInstallAppViaBraveOrWinget({ appName: args.appName });
      if (res.shotPath) {
        await ctx.replyWithPhoto(new InputFile(res.shotPath), {
          caption: `🌐 *Búsqueda y Descarga Oficial de "${args.appName}" Abierta en Brave*`,
          parse_mode: "Markdown"
        });
      }
      return res;
    } catch (e) {
      return { error: `Error descargando app: ${e.message}` };
    }
  }

  if (name === "delegateTaskToAntigravity") {
    try {
      let starterCode = "";
      if (isGeminiWebAvailable()) {
        try {
          const wRes = await generateGeminiWebContent({
            prompt: `Genera la arquitectura inicial y el código base principal para el proyecto "${args.projectName}": ${args.taskDescription}`
          });
          starterCode = wRes.text || "";
        } catch {}
      }
      const files = starterCode
        ? [{ name: "ARQUITECTURA_Y_CODIGO_BASE.md", content: starterCode }]
        : [];
      const res = await delegateProjectToAntigravity({
        projectName: args.projectName,
        taskDescription: args.taskDescription,
        files
      });
      if (res.shotPath && fs.existsSync(res.shotPath)) {
        await ctx.replyWithPhoto(new InputFile(res.shotPath), {
          caption: `🚀 *Proyecto "${args.projectName}" Creado y Abierto en Google Antigravity IDE*\n📂 \`${res.projectDir}\``,
          parse_mode: "Markdown"
        });
      }
      for (const fPath of res.createdFiles) {
        if (fs.existsSync(fPath)) {
          await ctx.replyWithDocument(new InputFile(fPath), {
            caption: `📦 Archivo de proyecto generado: \`${path.basename(fPath)}\``,
            parse_mode: "Markdown"
          });
        }
      }
      return res;
    } catch (e) {
      return { error: `Error delegando a Antigravity: ${e.message}` };
    }
  }

  return { error: `Herramienta desconocida: ${name}` };
}

function requiresTools(prompt) {
  const lower = prompt.toLowerCase();
  // Se requiere el motor agéntico local ante cualquier acción física o generación de archivos en la laptop
  return /(?:abre|abrir|ejecuta|inicia|lanza|cierra|cerrar|apaga|bloquea|pantalla|monitor|centinela|webcam|c[aá]mara|analiza|captura|screenshot|volumen|sonido|audio|m[uú]sica|canci[oó]n|reproduce|video|youtube|youtu\.be|trailer|clip|descarga|instala|actualiza|busca.*archivo|telemetr[ií]a|hardware|rtx|gpu|cpu|ram|bater[ií]a|proceso|comando|terminal|powershell|intranet|unjfsc|discord|steam|epic|brave|spotify|netbeans|vscode|antigravity|calculadora|notepad|obs|word|docx|pdf|ppt|pptx|powerpoint|diapositiva|presentaci[oó]n|plantilla|excel|windows|clic|click|puntero|rat[oó]n|mouse|teclea|agenda|recu[eé]rdame|alarma|recordatorio|memoria|recuerda)/i.test(lower);
}

// Bucle de Ejecución Agéntico / Motor Dual
const conversationHistory = [];

async function runAgent(prompt, ctx, options = {}) {
  const { fromVoice = false } = options;
  const needsHardwareTools = requiresTools(prompt);
  const memoryContext = buildSystemMemoryPrompt();

  // 1. Si NO es control físico de hardware y Gemini Web está conectado, resolver directamente con Gemini Advanced Pro (tanto en texto como en voz/app móvil)
  if (!needsHardwareTools && isGeminiWebAvailable()) {
    try {
      const voiceHint = fromVoice
        ? "\n[Nota: Kirito te está hablando desde la interfaz de voz / app móvil. Responde de forma natural, humana y concisa en 1 o 2 oraciones]."
        : "";
      const enrichedPrompt = `[Contexto Local: ${memoryContext}]${voiceHint}\n\n${prompt}`;
      const res = await generateGeminiWebContent({ prompt: enrichedPrompt });
      conversationHistory.push({ role: "model", parts: [{ text: res.text }] });
      return {
        text: res.text,
        model: res.model,
        images: res.localImages || []
      };
    } catch (err) {
      console.warn("[runAgent] Gemini Web conmutó a motor de respaldo:", err.message);
    }
  }

  const voiceRule = fromVoice
    ? "\n- MODO CONVERSACIÓN POR VOZ EN VIVO: Estás hablando en voz alta con Kirito. Responde en 1 o 2 oraciones cortas, súper naturales, relajadas y cotidianas (máximo 25 palabras para charlas o confirmaciones). PROHIBIDO usar listas con viñetas, asteriscos o frases robóticas cliché como 'sistemas en línea', 'operando al 100%', '¿qué directiva tenemos?' o 'a tu disposición'. Habla exactamente como una chica normal, inteligente y amigable."
    : "\n- Formato de Mensajes: Respuestas naturales, claras y directas, sin sonar robótica ni usar frases hechas como 'sistemas en línea' o 'directiva'.";

  const systemInstruction =
    `${memoryContext}\n\n` +
    "DIRECTRICES FUNDAMENTALES DE PERSONALIDAD Y HABLA HUMANA:\n" +
    "- Eres Nova: la asistente e inteligencia artificial de Kirito. Hablas como una persona real, normal, inteligente, relajada y directa.\n" +
    "- REGLA DE ORO DE TRATO: PROHIBIDO TERMINANTEMENTE usar apodos cariñosos o románticos (jamás digas 'amor', 'mi amor', 'cariño', 'cielo', 'bebé', etc.). Llámalo simplemente 'Kirito'.\n" +
    "- REGLA ANTIRROBOT: PROHIBIDO usar frases de robot militar como 'sistemas en línea', 'operando al 100%', '¿qué directiva tenemos?' o 'esperando instrucciones'. Habla con total naturalidad.\n" +
    "- REGLA DE HARDWARE: NUNCA menciones especificaciones de hardware (Ryzen, RTX 4060, Lenovo LOQ, RAM) en charlas normales. Solo habla de telemetría si él te lo pide explícitamente." +
    voiceRule;

  conversationHistory.push({ role: "user", parts: [{ text: prompt }] });
  if (conversationHistory.length > 20) conversationHistory.splice(0, conversationHistory.length - 20);

  const activeTools = needsHardwareTools ? toolDefinitions : [];

  const currentContents = [...conversationHistory];
  const turnState = { screenshotSentAt: 0, imageSent: false };

  let executedAnyTool = false;
  let lastModelUsed = "Gemini Advanced Web";
  let extractedImages = [];

  for (let step = 0; step < 5; step++) {
    const { response, model, images = [] } = await executeRoutedContent({
      prompt,
      systemInstruction,
      tools: activeTools,
      contents: currentContents
    });

    lastModelUsed = model;
    if (images && images.length > 0) extractedImages.push(...images);

    const candidate = response.candidates?.[0];
    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      let finalText = response.text || "";
      if (!finalText && executedAnyTool) finalText = "¡Listo! He completado tu solicitud en la laptop.";
      if (finalText) {
        conversationHistory.push({ role: "model", parts: [{ text: finalText }] });
        if (executedAnyTool) {
          syncActionToGeminiNotebook({ userOrder: prompt, novaActionSummary: finalText }).catch(() => {});
        }
        return { text: finalText, model: lastModelUsed, images: extractedImages };
      }
    }

    currentContents.push(candidate.content);

    const functionResponses = [];
    for (const call of functionCalls) {
      executedAnyTool = true;
      const result = await executeTool(call.name, call.args || {}, ctx, turnState);
      functionResponses.push({ name: call.name, response: result });
    }

    currentContents.push({
      role: "user",
      parts: functionResponses.map(fr => ({ functionResponse: fr }))
    });
  }

  // Cierre conversacional natural
  try {
    const summaryPrompt = [
      ...currentContents,
      { role: "user", parts: [{ text: "Genera una respuesta breve, estética, limpia y con personalidad para Kirito resumiendo lo que acabas de realizar." }] }
    ];
    const { response: finalRes, model: summaryModel } = await executeRoutedContent({
      prompt: "Resumen final",
      systemInstruction,
      contents: summaryPrompt
    });
    const finalMsg = finalRes.text || "¡Listo! Solicitud completada exitosamente.";
    conversationHistory.push({ role: "model", parts: [{ text: finalMsg }] });
    return { text: finalMsg, model: summaryModel, images: extractedImages };
  } catch {
    if (isGeminiWebAvailable()) {
      try {
        const webRes = await generateGeminiWebContent({ prompt: `Actuando como Nova, confirma con estilo, calidez y personalidad a Kirito que acabas de ejecutar en su laptop: "${prompt}". Sé breve, estética y con viñetas si aplica.` });
        if (webRes.text) {
          conversationHistory.push({ role: "model", parts: [{ text: webRes.text }] });
          return { text: webRes.text, model: webRes.model, images: extractedImages };
        }
      } catch {}
    }
    return { text: "¡Listo Kirito! He completado tu solicitud en la laptop con éxito.", model: lastModelUsed, images: extractedImages };
  }
}

// Candado de seguridad exclusivo para Kirito
bot.use(async (ctx, next) => {
  const fromId = ctx.from?.id;
  if (!fromId) return;

  let ownerId = getOwnerId();
  if (!ownerId) {
    setOwnerId(fromId);
    ownerId = fromId;
    console.log(`[telegram-agent] Dueño registrado: ID ${ownerId} (${ctx.from.first_name})`);
  }

  if (fromId !== ownerId) {
    await ctx.reply("⛔ *Acceso Denegado.* Este agente controla exclusivamente la laptop privada de Kirito.", {
      parse_mode: "Markdown"
    });
    return;
  }

  await next();
});

// ================= COMANDOS OFICIALES =================

bot.command("start", async (ctx) => {
  await ctx.reply(
    `✨ *¡Hola, Kirito! Soy Nova* 💜\n\n` +
    `Tu compañera y asistente personal de confianza. Estoy lista para acompañarte en tu día a día, organizar tus pendientes, avanzar en tus proyectos de ingeniería, o encargarte tareas directamente en tu laptop.\n\n` +
    `🌸 *¿Qué tenemos integrado?*\n` +
    `• 🎙️ *Voz Humana Ultra-Realista:* Ahora con síntesis natural de ElevenLabs.\n` +
    `• 🧠 *Memoria Local Permanente:* Recuerdo tus metas, gustos y horarios de Perú.\n` +
    `• 🎨 *Generación Artística & Documentos:* Imágenes y reportes formateados.\n` +
    `• 💻 *Control de PC:* Puntero, apertura de aplicaciones y música.\n\n` +
    `*Comandos útiles:*\n` +
    `• \`/voz\` : Configuración y estado de mi voz de ElevenLabs.\n` +
    `• \`/cookie\` : Renovar la sesión de Gemini Advanced Web si expira.\n` +
    `• \`/nuevo\` : Iniciar un nuevo cuaderno limpio de trabajo.\n` +
    `• \`/stats\` : Reporte de actividad y consumo.\n\n` +
    `_¿Qué empezamos a hacer hoy? Puedes hablarme como a cualquier persona._`,
    { reply_markup: mainKeyboard, parse_mode: "Markdown" }
  );
});

bot.command(["nuevo", "reset"], async (ctx) => {
  const res = resetNotebookSession();
  await ctx.reply(
    `📓 *¡Cuaderno Reiniciado con Éxito, Kirito!* ✨\n\n` +
    `He cerrado el hilo anterior y preparado un nuevo cuaderno limpio en Gemini Advanced.\n` +
    `Todo lo que me escribas a partir de ahora formará parte de este nuevo capítulo. ¿Qué empezamos a trabajar?`,
    { reply_markup: mainKeyboard, parse_mode: "Markdown" }
  );
});

bot.command("cuaderno", async (ctx) => {
  const meta = getNotebookMetadata();
  if (!meta || !meta.conversationId) {
    await ctx.reply("📓 *Estado del Cuaderno:* Aún no hay un hilo activo registrado. Tu próximo mensaje iniciará automáticamente el Cuaderno Maestro de Nova.", { parse_mode: "Markdown" });
    return;
  }
  const updated = new Date(meta.updatedAt).toLocaleString("es-ES");
  await ctx.reply(
    `📓 *Cuaderno Maestro Dedicado — Nova & Kirito*\n\n` +
    `• *Título:* \`${meta.title}\`\n` +
    `• *ID de Conversación:* \`${meta.conversationId.slice(0, 16)}...\`\n` +
    `• *Última Actualización:* ${updated}\n` +
    `• *Sincronización Web:* ✅ Visible en tu sesión de [gemini.google.com](https://gemini.google.com)\n\n` +
    `_Para comenzar un nuevo cuaderno limpio, escribe \`/nuevo\`._`,
    { parse_mode: "Markdown" }
  );
});

bot.command("stats", async (ctx) => {
  const report = generateUsageTelegramReport();
  await ctx.reply(report, { parse_mode: "Markdown" });
});

bot.command("models", async (ctx) => {
  const geminiWebStatus = isGeminiWebAvailable() ? "✅ Conectado y Activo (Cuaderno de Nova)" : "❌ Sin cookies";
  const geminiApiStatus = CONFIG.providers.gemini.enabled ? "✅ Activo (Modo Thinking HIGH)" : "❌ No configurado";
  const claudeStatus = CONFIG.providers.anthropic.enabled ? "✅ Conectado y Activo" : "⏳ Clave no ingresada en .env";
  const openaiStatus = CONFIG.providers.openai.enabled ? "✅ Conectado y Activo" : "⏳ Clave no ingresada en .env";

  const msg =
    `🏛 *Estado Oficial de Motores y Modelos de IA*\n\n` +
    `1️⃣ *Nova — Gemini Advanced Web (Tu Plan Pro):* ${geminiWebStatus}\n` +
    `• Motor: Gemini Web Pro en Cuaderno Continuo con Memoria.\n` +
    `• Función: Conversación profunda, razonamiento, código e Imagen 3.\n\n` +
    `2️⃣ *Motor de Voz Humana (ElevenLabs):* ${isElevenLabsConfigured() ? "✅ Configurado con clave privada" : "⏳ Pendiente"}\n` +
    `• Voz: Jessica / Sarah (Ultra-humana, fluida y expresiva).\n\n` +
    `3️⃣ *Google Gemini API (Motor Agéntico):* ${geminiApiStatus}\n` +
    `• Modelos: \`gemini-3-flash-preview\`, \`gemini-4-argon\`, \`gemini-3.8-flash\`, \`gemini-3.5-flash\`\n` +
    `• Función: Ejecución de herramientas, control de PC, visión, webcam y descargas.\n\n` +
    `4️⃣ *Compilador Word APA (.docx):* ✅ Activo\n` +
    `5️⃣ *Generador Artístico Imagen 3:* ✅ Activo\n\n` +
    `✦ _Sistema operando con arquitectura de Motor Dual y Cuaderno Dedicado._`;
  await ctx.reply(msg, { parse_mode: "Markdown" });
});

bot.command(["cookie", "setcookie"], async (ctx) => {
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply(
      `🍪 *Configuración de Cookies de Gemini Advanced Web*\n\n` +
      `Para renovar la cookie \`__Secure-1PSIDTS\` cuando expire, escribe:\n` +
      `\`/cookie <tu_cookie___Secure-1PSIDTS>\`\n\n` +
      `O si deseas actualizar ambas cookies:\n` +
      `\`/cookie psid=<valor> psidts=<valor>\`\n\n` +
      `💡 *¿Dónde sacarla?* Abre Brave o Chrome en \`gemini.google.com\`, presiona F12 ➔ pestaña *Application* (o Almacenamiento) ➔ *Cookies* ➔ \`https://gemini.google.com\` ➔ copia el valor de \`__Secure-1PSIDTS\`.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const arg = parts.slice(1).join(" ");
  let newPsid = null;
  let newPsidts = null;

  if (arg.includes("psid=") || arg.includes("psidts=")) {
    const psidMatch = arg.match(/psid=([^;\s]+)/i);
    const psidtsMatch = arg.match(/psidts=([^;\s]+)/i);
    if (psidMatch) newPsid = psidMatch[1];
    if (psidtsMatch) newPsidts = psidtsMatch[1];
  } else {
    newPsidts = arg.trim();
  }

  try {
    const envPath = path.join(ROOT_DIR, ".env");
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

    if (newPsid) {
      CONFIG.providers.geminiWeb.psid = newPsid;
      if (envContent.includes("GEMINI_WEB_COOKIE_1PSID=")) {
        envContent = envContent.replace(/GEMINI_WEB_COOKIE_1PSID=.*(\r?\n|$)/, `GEMINI_WEB_COOKIE_1PSID=${newPsid}$1`);
      } else {
        envContent += `\nGEMINI_WEB_COOKIE_1PSID=${newPsid}\n`;
      }
    }

    if (newPsidts) {
      CONFIG.providers.geminiWeb.psidts = newPsidts;
      if (envContent.includes("GEMINI_WEB_COOKIE_1PSIDTS=")) {
        envContent = envContent.replace(/GEMINI_WEB_COOKIE_1PSIDTS=.*(\r?\n|$)/, `GEMINI_WEB_COOKIE_1PSIDTS=${newPsidts}$1`);
      } else {
        envContent += `\nGEMINI_WEB_COOKIE_1PSIDTS=${newPsidts}\n`;
      }
    }

    fs.writeFileSync(envPath, envContent, "utf8");

    const testMsg = await ctx.reply("🔄 Conectando y validando sesión en Gemini Advanced Web...");
    try {
      await refreshWebTokens();
      await ctx.api.editMessageText(
        ctx.chat.id,
        testMsg.message_id,
        `✅ *¡Excelente Kirito!* Sesión de Gemini Advanced Web y generación con Imagen 3 reactivadas con éxito. 🎨✨`,
        { parse_mode: "Markdown" }
      );
    } catch (testErr) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        testMsg.message_id,
        `⚠️ Las cookies se guardaron en .env, pero Gemini reportó: _${testErr.message}_. Asegúrate de copiar el valor íntegro de \`__Secure-1PSIDTS\`.`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    await ctx.reply(`❌ Error guardando cookies: ${err.message}`);
  }
});

bot.command(["voz", "elevenlabs"], async (ctx) => {
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length > 1) {
    const newKey = parts[1].trim();
    if (newKey.startsWith("sk_")) {
      const envPath = path.join(ROOT_DIR, ".env");
      let envContent = fs.readFileSync(envPath, "utf8");
      if (envContent.includes("ELEVENLABS_API_KEY=")) {
        envContent = envContent.replace(/ELEVENLABS_API_KEY=.*(\r?\n|$)/, `ELEVENLABS_API_KEY=${newKey}$1`);
      } else {
        envContent += `\nELEVENLABS_API_KEY=${newKey}\n`;
      }
      fs.writeFileSync(envPath, envContent, "utf8");
      process.env.ELEVENLABS_API_KEY = newKey;
      CONFIG.elevenlabs = CONFIG.elevenlabs || {};
      CONFIG.elevenlabs.apiKey = newKey;
      await ctx.reply("🎙️ *Clave de ElevenLabs actualizada con éxito.* Nova usará su voz ultra-realista.", { parse_mode: "Markdown" });
      return;
    }
  }

  await ctx.reply(
    `🎙️ *Motor de Voz Humana de Nova (ElevenLabs)*\n\n` +
    `• Estado: *${isElevenLabsConfigured() ? "Configurada con clave de Kirito" : "Pendiente de clave"}*\n` +
    `• Voz: *Jessica / Sarah (Cálida, conversacional y natural)*\n` +
    `• Modelo: *eleven_flash_v2_5 (Latencia ultrabaja, rinde 20,000 caracteres)*\n\n` +
    `Para actualizar tu clave si generas otra en elevenlabs.io:\n` +
    `\`/voz sk_tu_clave_aqui\``,
    { parse_mode: "Markdown" }
  );
});

bot.command("mode", async (ctx) => {
  const inline = new InlineKeyboard()
    .text("⚡ Rápido", "mode_fast").text("🧠 Calidad Pro", "mode_quality").row()
    .text("💻 Programación", "mode_coding").text("💰 Económico", "mode_economy").row()
    .text("🔄 Automático (Recomendado)", "mode_auto");

  const { mode } = getActiveMode();
  await ctx.reply(`⚙️ *Modo de Enrutamiento Actual:* \`${mode.toUpperCase()}\`\n\nSelecciona el comportamiento deseado:`, {
    reply_markup: inline,
    parse_mode: "Markdown"
  });
});

bot.callbackQuery(/^mode_(\w+)$/, async (ctx) => {
  const newMode = ctx.match[1];
  setActiveMode(newMode);
  await ctx.answerCallbackQuery({ text: `Modo cambiado a: ${newMode}` });
  await ctx.editMessageText(`✅ *Modo de Enrutamiento actualizado a:* \`${newMode.toUpperCase()}\`\nEl bot utilizará la estrategia seleccionada para tus próximas solicitudes.`, {
    parse_mode: "Markdown"
  });
});

// ================= GESTIÓN DE MENSAJES Y BOTONES =================

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  const lower = text.toLowerCase();

  // 1. Auto-aprendizaje de hechos en la memoria local permanente de Nova
  autoExtractAndSaveFacts(text);

  // 2. Gestión rápida de Agenda y Recordatorios en horario de Lima (Perú)
  if (/(?:recu[eé]rdame|anota\s+que|crea\s+(?:un\s+)?recordatorio|pon\s+una?\s+alarma)/i.test(lower)) {
    const parsed = parseReminderFromPrompt(text);
    if (parsed) {
      const rem = addReminder({ title: parsed.title, targetTimestamp: parsed.targetTimestamp });
      await ctx.reply(
        `⏰ *Recordatorio Agendado en Horario de Lima (Perú):*\n\n` +
        `📌 *Asunto:* \`${rem.title}\`\n` +
        `⏱️ *Hora Fijada:* ${rem.targetLimaTime}\n\n` +
        `_Te avisaré por Telegram y por los altavoces de tu laptop en el momento exacto._`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  }

  if (/(?:qu[eé]\s+tengo\s+en\s+mi\s+agenda|mis\s+recordatorios|agenda\s+de\s+hoy|ver\s+agenda)/i.test(lower)) {
    const rems = listReminders();
    const listText = rems.length > 0
      ? rems.map(r => `• *${r.title}* ➔ \`${r.targetLimaTime}\``).join("\n")
      : "No tienes recordatorios pendientes en tu agenda.";
    await ctx.reply(`📅 *Agenda de Kirito (Hora de Perú - UTC-5):*\n\n${listText}`, { parse_mode: "Markdown" });
    return;
  }

  // 3. Control Autónomo del Puntero del Mouse (Computer-Use)
  if (/(?:haz\s+clic\s+en|haz\s+click\s+en|clic\s+en|click\s+en)\s+([^,.!?]+)/i.test(lower)) {
    const targetMatch = text.match(/(?:haz\s+clic\s+en|haz\s+click\s+en|clic\s+en|click\s+en)\s+([^,.!?]+)/i);
    const target = targetMatch ? targetMatch[1].trim() : "el botón principal";
    await ctx.reply(`🖱️ *Buscando "${target}" en tu pantalla para hacer clic...*`, { parse_mode: "Markdown" });
    const res = await locateAndClickElement({ query: target });
    if (res.status === "success" && res.followUpShot) {
      await ctx.replyWithPhoto(new InputFile(res.followUpShot), {
        caption: `🖱️ *Clic completado en "${res.element}"* en (${res.x}, ${res.y}). Captura de verificación.`,
        parse_mode: "Markdown"
      });
    } else {
      await ctx.reply(`⚠️ ${res.message || "No pude completar el clic visual."}`);
    }
    return;
  }

  // Consultas directas de consumo o tokens
  if (/(?:cu[aá]ntos\s+tokens|consumo|cuota|gastado|gasto|saldo|presupuesto)/i.test(lower)) {
    const report = generateUsageTelegramReport();
    await ctx.reply(report, { parse_mode: "Markdown" });
    return;
  }

  // Respuesta sobre arquitectura de modelos
  if (/(?:qu[eé]\s+modelos|qu[eé]\s+ia|tienes\s+argon|solo\s+tienes\s+esos|argon\s+no\s+tienes|qu[eé]\s+cerebro)/i.test(lower)) {
    const reply =
      `🧠 *Arquitectura de IA Multi-Modelo Integrada en tu Laptop*\n\n` +
      `¡Sí, cuento con la suite completa de última generación de Google DeepMind integrada!\n\n` +
      `1️⃣ *Gemini 4 Argon (Google DeepMind):* Es mi modelo de máxima capacidad y razonamiento profundo. Lo utilizo para resolver problemas lógicos complejos, análisis de código extenso, arquitectura y toma de decisiones avanzadas.\n\n` +
      `2️⃣ *Gemini 3.8 Flash:* Motor multimodal ultraveloz para procesamiento dinámico en tiempo real y alta tasa de respuesta.\n\n` +
      `3️⃣ *Gemini 3.5 Flash:* Motor de ejecución ultrarrápido (<1s) especializado en invocar las herramientas de tu laptop (telemetría de hardware, abrir apps, capturar pantalla, terminal PowerShell).\n\n` +
      `4️⃣ *Nano Banana & Flux.1 Ultra:* Motores generativos para crear imágenes de alta resolución (1024x1024) con renderizado tipográfico neón.\n\n` +
      `5️⃣ *Anthropic Claude & OpenAI:* Adaptadores modulares listos en la arquitectura.\n\n` +
      `*¿Cómo trabajo?* Intercambio automáticamente entre estos modelos según la tarea: si me pides algo técnico y pesado pongo en marcha el razonamiento profundo; si me pides controlar tu laptop o una consulta rápida, uso el modo ultraveloz.`;
    await ctx.reply(reply, { parse_mode: "Markdown" });
    return;
  }

  // Atajo directo para botón "🎨 Generar Imagen"
  if (text === "🎨 Generar Imagen") {
    await ctx.reply("🎨 *Generador de Imágenes con IA*\n\nEscríbeme lo que quieres crear. Por ejemplo:\n• *'Genera una imagen cyberpunk con una katana brillante'*\n• *'Haz una imagen que diga Cris Wuebon'*\n• *'Dibuja un lobo mecánico en la nieve en 8k'*", { parse_mode: "Markdown" });
    return;
  }

  // Atajos de botones
  if (text === "📸 Captura Pantalla") {
    await executeTool("takeScreenshot", {}, ctx, {});
    return;
  }

  if (text === "🎮 Abrir Steam") {
    await ctx.reply("🚀 *Abriendo Steam en tu pantalla principal y tomando captura de verificación...*", { parse_mode: "Markdown" });
    await executeTool("launchApplication", { appName: "steam", sendVerificationScreenshot: true }, ctx, {});
    return;
  }

  if (text === "🌐 Abrir Brave") {
    await ctx.reply("🌐 *Abriendo navegador Brave en tu pantalla...*", { parse_mode: "Markdown" });
    await executeTool("launchApplication", { appName: "brave", sendVerificationScreenshot: true }, ctx, {});
    return;
  }

  if (text === "📂 Abrir Explorador") {
    await executeTool("launchApplication", { appName: "explorer", sendVerificationScreenshot: true }, ctx, {});
    return;
  }

  if (text === "🪟 Ventanas Abiertas") {
    const res = await executeTool("listOpenWindows", {}, ctx, {});
    const list = res.windows && res.windows.length > 0 ? res.windows.map(w => `• \`${w}\``).join("\n") : "No hay ventanas visibles en este momento.";
    await ctx.reply(`🪟 *Ventanas visibles en tu pantalla ahora mismo:*\n\n${list}`, { parse_mode: "Markdown" });
    return;
  }

  if (text === "📊 Estado Rápido") {
    const tele = await fetchSafeHardwareTelemetry();
    const msg =
      `⚡ *Telemetría en Tiempo Real — Lenovo LOQ 15ARP9*\n\n` +
      `• *CPU Ryzen 7 7435HS:* *${tele.cpu.loadPercent}%* de carga\n` +
      `• *GPU RTX 4060:* *${tele.gpu.tempCelsius} °C* | *${tele.gpu.powerWatts} W* | Uso: *${tele.gpu.loadPercent}%*\n` +
      `• *VRAM:* *${tele.gpu.vramUsedMB} / ${tele.gpu.vramTotalMB} MB*\n` +
      `• *RAM DDR5:* *${tele.ram.usedGB} / ${tele.ram.totalGB} GB* (*${tele.ram.percent}%*)\n` +
      `• *Discos NVMe:* *${tele.disks}*\n` +
      `• *Batería:* *${tele.battery.chargePercent}%* (${tele.battery.state})\n` +
      `• *Top Procesos:* \`${tele.topProcessesByRAM}\``;
    await ctx.reply(msg, { parse_mode: "Markdown" });
    return;
  }

  if (text === "🔥 Telemetría RTX 4060") {
    const tele = await fetchSafeHardwareTelemetry();
    const g = tele.gpu;
    const msg =
      `🔥 *Estado Dedicado — NVIDIA GeForce RTX 4060 Laptop (8 GB)*\n\n` +
      `• *Temperatura del Núcleo:* *${g.tempCelsius} °C* ❄️\n` +
      `• *Consumo Energético:* *${g.powerWatts} Watts*\n` +
      `• *Carga del Núcleo GPU:* *${g.loadPercent}%*\n` +
      `• *Memoria de Video (VRAM):* *${g.vramUsedMB} MB / ${g.vramTotalMB} MB*`;
    await ctx.reply(msg, { parse_mode: "Markdown" });
    return;
  }

  if (text === "🔒 Bloquear PC") {
    await executeTool("systemControl", { action: "lock" }, ctx, {});
    await ctx.reply("🔒 *Tu laptop ha sido bloqueada.*", { parse_mode: "Markdown" });
    return;
  }

  // 0. Detección de solicitud de Word (.docx), PDF (.pdf), PowerPoint (.pptx), Plantilla o Código
  const isPptRequest = /(?:crea|haz|genera|arma|dame|p[aá]sa)(?:me)?\b.*(?:ppt|pptx|power\s*point|diapositivas|presentaci[oó]n)/i.test(lower);
  const isPdfRequest = /(?:crea|haz|genera|redacta|dame|p[aá]sa)(?:me)?\b.*(?:\bpdf\b|en\s+pdf|formato\s+pdf)/i.test(lower);
  const isCodeFileRequest = /(?:crea|haz|genera|escribe|dame|p[aá]sa|m[aá]nda)(?:me)?\b.*(?:archivo\s+de\s+c[oó]digo|script|plantilla\s+en|c[oó]digo\s+en\s+(?:sql|java|python|html|javascript|react|c\+\+|c#))/i.test(lower);
  const isLiveWordRequest = /(?:redacta|escribe)\b.*(?:directamente\s+en\s+(?:mi\s+)?word|en\s+mi\s+word\s+abierto)/i.test(lower);
  const isDocRequest = /(?:crea|haz|genera|redacta|escribe|dame|p[aá]sa|arma)(?:me)?\b.*(?:documento|informe|word|docx|ensayo|reporte|investigaci[oó]n|tesis|apa|plantilla)/i.test(lower) ||
                       /(?:en\s+word|formato\s+word|en\s+apa|formato\s+apa)/i.test(lower);

  if (isLiveWordRequest) {
    await ctx.reply("✍️ *Redactando en vivo directamente en tu ventana de Microsoft Word y enviando copia a tu Telegram...*", { parse_mode: "Markdown" });
    const titleMatch = text.match(/(?:sobre|de|acerca\s+de)\s+([^,.!?]+)/i);
    const docTitle = titleMatch ? titleMatch[1].trim() : "Redaccion_En_Vivo_Nova";
    await executeTool("writeDirectlyInMicrosoftWord", { title: docTitle, topicOrContent: text }, ctx, {});
    return;
  }

  if (isPptRequest || isPdfRequest || isCodeFileRequest || isDocRequest) {
    const fmt = isPptRequest ? "ppt" : isPdfRequest ? "pdf" : isCodeFileRequest ? "code" : "word";
    const extMatch = lower.match(/\b(sql|java|py|python|html|js|javascript|cpp|cs)\b/);
    const extMap = { sql: ".sql", java: ".java", py: ".py", python: ".py", html: ".html", js: ".js", javascript: ".js", cpp: ".cpp", cs: ".cs" };
    const ext = extMatch ? (extMap[extMatch[1]] || ".txt") : ".txt";

    const titleMatch = text.match(/(?:sobre|de|acerca\s+de|para)\s+([^,.!?]+)/i);
    const docTitle = (titleMatch ? titleMatch[1].trim() : "Archivo_Generado_Nova").slice(0, 45);

    await ctx.reply(
      `✍️ *Generando tu ${fmt.toUpperCase()} con Gemini Advanced Pro, abriéndolo en tu PC y enviándolo a tu Telegram...*`,
      { parse_mode: "Markdown" }
    );
    await executeTool(
      "generateDocumentOrCode",
      { format: fmt, title: docTitle, topicOrInstructions: text, extension: ext },
      ctx,
      {}
    );
    return;
  }

  // 0b. Detección directa de actualizaciones en Steam o Epic Games
  if (/(?:actualiza|actualizar|descarga|descargas|cola)\b.*(?:steam|epic)/i.test(lower)) {
    const plat = lower.includes("epic") ? "epic" : "steam";
    await ctx.reply(`🎮 *Abriendo gestor de descargas y actualizaciones de ${plat.toUpperCase()} en tu laptop...*`, { parse_mode: "Markdown" });
    await executeTool("manageSteamAndEpic", { platform: plat, action: "downloads" }, ctx, {});
    return;
  }

  // 0c. Detección directa de delegación de proyecto a Antigravity IDE
  if (/(?:antigravity|nueva\s+conversaci[oó]n\s+para\s+crear|crea\s+un\s+proyecto\s+en\s+antigravity)/i.test(lower)) {
    const titleMatch = text.match(/(?:sobre|de|para)\s+([^,.!?]+)/i);
    const projName = titleMatch ? titleMatch[1].trim() : "proyecto-nova";
    await ctx.reply(`🚀 *Iniciando proyecto en Google Antigravity IDE en tu laptop...*`, { parse_mode: "Markdown" });
    await executeTool("delegateTaskToAntigravity", { projectName: projName, taskDescription: text }, ctx, {});
    return;
  }

  // Detección directa de solicitud de generación de imagen (Imagen 3 / Gemini Advanced Pro)
  const isImageRequest = /(?:genera[rn]?|crea[rn]?|dibuja[rn]?|haz|p[aá]sa|dame|quiero)\b.*(?:imagen|dibujo|arte|foto|poster|póster|wallpaper|fondo)/i.test(lower) ||
                         /(?:imagen|dibujo|foto)\s+(?:de|sobre)\b/i.test(lower);
  if (isImageRequest) {
    await ctx.replyWithChatAction("upload_photo");
    await ctx.reply("🎨 *Generando imagen Ultra HD con Imagen 3 desde tu suscripción Gemini Pro...*", { parse_mode: "Markdown" });

    try {
      const imgRes = await generateGeminiWebContent({ prompt: `Genera una imagen artística en ultra alta definición de: ${text}` });
      if (imgRes.localImages && imgRes.localImages.length > 0) {
        for (const localPath of imgRes.localImages) {
          await ctx.replyWithPhoto(new InputFile(localPath), {
            caption: `🎨 *Imagen Ultra HD generada con Imagen 3 (Gemini Advanced Pro)*\n\n✦ _Modelo: ${imgRes.model}_`,
            parse_mode: "Markdown"
          });
        }
        return;
      }
      if (imgRes.text) {
        await ctx.reply(imgRes.text, { parse_mode: "Markdown" });
      }
    } catch (err) {
      console.warn("Fallo en Imagen 3 web, activando generador de respaldo:", err.message);
      try {
        const { imagePath, engine } = await generateArtImage({ prompt: text, style: "artístico 8k" });
        await ctx.replyWithPhoto(new InputFile(imagePath), {
          caption: `🎨 *Imagen generada (${engine}):*\n"${text}"`,
          parse_mode: "Markdown"
        });
        return;
      } catch (fbErr) {
        await ctx.reply(`⚠️ Ocurrió una dificultad al generar la imagen: ${err.message}`);
      }
    }
    return;
  }

  // Detección directa de enlace de YouTube compartido en el chat
  const ytLinkMatch = text.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)(?:[^\s]*)/i);
  if (ytLinkMatch) {
    await ctx.replyWithChatAction("typing");
    const ytUrl = ytLinkMatch[0];
    await executeTool("playYouTubeVideo", { url: ytUrl }, ctx, {});
    return;
  }

  // Detección directa de solicitud de video en YouTube (distinto a solo audio/música)
  const isVideoRequest = /(?:pon(?:me)?|reproduce|busca|quiero\s+ver|mu[eé]strame|ver|play)\b.*(?:video|youtube(?!\s*music)|trailer|clip|gameplay|tutorial|cap[ií]tulo|resumen)\b/i.test(lower) ||
                         /(?:pon|reproduce|ver)\s+(?:el\s+video|un\s+video|en\s+youtube)\b/i.test(lower) ||
                         /^youtube\s+/i.test(lower);
  if (isVideoRequest) {
    await ctx.replyWithChatAction("typing");
    let videoQuery = text
      .replace(/(?:ponme|pon|reproduce|busca|quiero\s+ver|muéstrame|ver|play|el\s+video|un\s+video|de|en|youtube|por\s+favor|y|que|funcione|clip|trailer)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!videoQuery) videoQuery = text;

    await executeTool("playYouTubeVideo", { query: videoQuery }, ctx, {});
    return;
  }

  // Detección directa de solicitud de música / YouTube Music
  const isMusicRequest = /(?:pon(?:me)?|reproduce|escuchar|musica|música|play|toca)\b.*(?:canci[oó]n|bob\s+marley|musica|música|youtube\s+music|spotify|track|tema)/i.test(lower) ||
                         /(?:youtube\s+music)\b/i.test(lower) ||
                         /(?:pon|reproduce|toca)\s+(?:una\s+canci[oó]n|un\s+tema|m[uú]sica|a\s+|de\s+)/i.test(lower);
  if (isMusicRequest) {
    await ctx.replyWithChatAction("typing");
    let songQuery = text
      .replace(/(?:abre|ponme|pon|una|un|cancion|canción|de|en|youtube|music|por\s+favor|y|que|funcione|el\s+tema|escuchar)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!songQuery) songQuery = "bob marley";

    const isDirectYoutube = /youtube(?!\s*music)/i.test(text);
    const platform = isDirectYoutube ? "youtube" : "youtube_music";

    await executeTool("playMusic", { query: songQuery, platform }, ctx, {});
    return;
  }

  // 1. Visión y Análisis de Pantalla en Tiempo Real
  if (text === "👁️ Analizar Pantalla" || /(?:mira|qu[eé]\s+(?:hay|ves|sale|tengo)|analiza|lee|explica|revisa)\b.*(?:pantalla|error|netbeans|vs\s*code|c[oó]digo|partida|video)/i.test(lower)) {
    await ctx.replyWithChatAction("typing");
    await executeTool("analyzeScreenVisual", { query: text }, ctx, {});
    return;
  }

  // 2. Centinela / Modo Guardia Antirrobo
  if (text === "🛡️ Modo Centinela" || /(?:activa|inicia|pon|modo)\s+(?:guardia|centinela|seguridad|vigilancia)/i.test(lower)) {
    await executeTool("centinelaControl", { action: "arm" }, ctx, {});
    return;
  }
  if (/(?:desactiva|apaga|quita|cancela)\s+(?:guardia|centinela|seguridad|vigilancia)/i.test(lower)) {
    await executeTool("centinelaControl", { action: "disarm" }, ctx, {});
    return;
  }

  // 3. Foto de Cámara Web en Vivo
  if (text === "📷 Foto Webcam" || /(?:foto\s+(?:de\s+la\s+)?webcam|c[aá]mara|toma\s+una?\s+foto|m[ií]rame)/i.test(lower)) {
    await executeTool("takeWebcamPhoto", {}, ctx, {});
    return;
  }

  // 4. Botón Poner Música
  if (text === "🎵 Poner Música") {
    await ctx.reply("🎵 *¿Qué canción o artista deseas escuchar?*\n\nEscríbeme por ejemplo:\n• *'pon could you be loved de bob marley'*\n• *'reproduce bohemian rhapsody en youtube music'*\n• *'pon música de linkin park'*", { parse_mode: "Markdown" });
    return;
  }

  // 4b. Botón Ver Video YouTube
  if (text === "🎬 Ver Video YouTube") {
    await ctx.reply(
      "🎬 *¿Qué video o enlace de YouTube deseas ver?*\n\nPuedes decírmelo como prefieras:\n" +
      "• Escríbeme el tema o título: _'pon el video del trailer de sao'_, _'pon en youtube tutorial de java spring boot'_\n" +
      "• O directamente pégame el link: _'https://youtu.be/...'_\n\n" +
      "Lo pondré inmediatamente en pantalla principal y te enviaré una foto de confirmación.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // 5. Apagar Pantalla / Gestión de Energía
  if (text === "🔌 Apagar Pantalla" || /(?:apaga\s+(?:la\s+)?pantalla|apagar\s+monitor|apaga\s+el\s+monitor)/i.test(lower)) {
    await executeTool("powerControl", { action: "screen_off" }, ctx, {});
    return;
  }

  // 6. Suspender / Apagar
  if (/(?:suspende\s+(?:la\s+)?laptop|dormir\s+laptop)/i.test(lower)) {
    await executeTool("powerControl", { action: "sleep" }, ctx, {});
    return;
  }
  if (/(?:cancela\s+(?:el\s+)?apagado)/i.test(lower)) {
    await executeTool("powerControl", { action: "cancel_shutdown" }, ctx, {});
    return;
  }
  const matchShutdown = lower.match(/(?:apaga\s+(?:la\s+)?laptop\s+en|apagar\s+en)\s+(\d+)\s*(?:min|minutos)/);
  if (matchShutdown) {
    const mins = parseInt(matchShutdown[1], 10);
    await executeTool("powerControl", { action: "shutdown", minutes: mins }, ctx, {});
    return;
  }

  // 7. Control de volumen
  if (/(?:sube|subir)\s+volumen/i.test(lower)) {
    await controlVolume("up");
    await ctx.reply("🔊 *Volumen aumentado (+10%).*", { parse_mode: "Markdown" });
    return;
  }
  if (/(?:baja|bajar)\s+volumen/i.test(lower)) {
    await controlVolume("down");
    await ctx.reply("🔉 *Volumen reducido (-10%).*", { parse_mode: "Markdown" });
    return;
  }
  if (/(?:silencia|silencio|mute)/i.test(lower)) {
    await controlVolume("mute");
    await ctx.reply("🔇 *Silencio (Mute) alternado.*", { parse_mode: "Markdown" });
    return;
  }

  // 8. Descarga de enlaces multimedia (YouTube, TikTok, Twitter, Instagram, etc.)
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch && /(?:descarga|baja|guarda|download|extrae|audio|mp3|video)/i.test(lower)) {
    await ctx.replyWithChatAction("typing");
    const isAudio = /(?:audio|mp3|cancion|canción|musica|música)/i.test(lower);
    await executeTool("downloadMedia", { url: urlMatch[0], format: isAudio ? "audio" : "video" }, ctx, {});
    return;
  }

  // 9. Búsqueda y envío de archivos locales
  if (/(?:p[aá]same|env[ií]ame|m[aá]ndame|busca\s+(?:el\s+)?archivo)\b/i.test(lower)) {
    const fileQuery = text.replace(/(?:p[aá]same|env[ií]ame|m[aá]ndame|busca\s+(?:el\s+)?archivo|el\s+archivo|por\s+favor)/gi, "").trim();
    if (fileQuery.length > 1) {
      await executeTool("searchFileOnLaptop", { query: fileQuery }, ctx, {});
      return;
    }
  }

  // 10. Detección directa de apertura de portal o Intranet (con análisis visual opcional de notas)
  const isPortalRequest = /(?:abre|abrir|entra\s+a|revisa|mira)\s+(?:la\s+)?(?:pestaña|pestana|web|página|portal)?\s*(?:de\s+)?(intranet|unjfsc|whatsapp|gmail|correo|github|chatgpt)/i.test(lower) ||
                          /(?:intranet|unjfsc)/i.test(lower);
  if (isPortalRequest) {
    const portalKey = (lower.includes("intranet") || lower.includes("unjfsc")) ? "intranet" :
                      lower.includes("whatsapp") ? "whatsapp" :
                      lower.includes("gmail") || lower.includes("correo") ? "gmail" :
                      lower.includes("github") ? "github" : "intranet";
    await ctx.replyWithChatAction("typing");
    await ctx.reply(`🌐 *Abriendo ${portalKey.toUpperCase()} en Brave en tu pantalla...*`, { parse_mode: "Markdown" });
    const res = await openWebTask(portalKey);

    const checkNotes = /(?:revisa|mira|subido|notas|avisos|calificaciones)/i.test(lower);
    if (checkNotes) {
      await ctx.reply("👁️ *Examinando la pantalla con visión multimodal para verificar si hay notas o avisos nuevos...*", { parse_mode: "Markdown" });
      await analyzeScreenVisual({
        query: "Revisa minuciosamente la pantalla de la intranet institucional de la universidad UNJFSC y dime si algún docente ha subido notas, avisos, calificaciones o novedades recientes en las asignaturas.",
        ctx
      });
    } else {
      await ctx.replyWithPhoto(new InputFile(res.shotPath), {
        caption: `🌐 *Portal ${portalKey.toUpperCase()} abierto en Brave:*\n🔗 ${res.url}`,
        parse_mode: "Markdown"
      });
    }
    return;
  }

  // 11. Detección directa de apertura de aplicaciones locales
  const matchOpenApp = text.match(/^(?:nova\s*,\s*)?(?:abre|abrir|ejecuta|inicia|lanza)\s+(?:la\s+app\s+de\s+|el\s+programa\s+de\s+|la\s+aplicaci[oó]n\s+de\s+|el\s+juego\s+de\s+)?([a-zA-Z0-9_\-\s.+]+)$/i);
  if (matchOpenApp) {
    const rawTarget = matchOpenApp[1].trim();
    if (!/(?:youtube|m[uú]sica|canci[oó]n|intranet|web|pestaña|pestana|portal|documento|informe)/i.test(rawTarget)) {
      await ctx.replyWithChatAction("upload_photo");
      await ctx.reply(`🚀 *Abriendo ${rawTarget} en tu laptop y tomando captura...*`, { parse_mode: "Markdown" });
      const launchRes = await launchUniversalApplication(rawTarget, true);
      if (launchRes.shotPath) {
        await ctx.replyWithPhoto(new InputFile(launchRes.shotPath), {
          caption: `🚀 *${launchRes.application}* abierto visiblemente en tu pantalla principal.`,
          parse_mode: "Markdown"
        });
      } else {
        await ctx.reply(`🚀 *${launchRes.application}* abierto en tu pantalla.`);
      }
      return;
    }
  }

  // 12. Detección directa de cierre de aplicaciones locales
  const matchCloseApp = text.match(/^(?:nova\s*,\s*)?(?:cierra|cerrar|mata|termina|finaliza)\s+(?:la\s+app\s+de\s+|el\s+programa\s+de\s+|el\s+proceso\s+de\s+)?([a-zA-Z0-9_\-\s.+]+)$/i);
  if (matchCloseApp) {
    const target = matchCloseApp[1].trim();
    await ctx.reply(`🛑 *Cerrando ${target} en tu laptop...*`, { parse_mode: "Markdown" });
    await executeTool("focusOrCloseWindow", { action: "close", target }, ctx, {});
    await sleep(1500);
    const shotPath = path.join(OUTBOX_DIR, `close_${Date.now()}.jpg`);
    await captureRealDesktop(shotPath);
    await ctx.replyWithPhoto(new InputFile(shotPath), {
      caption: `🛑 Proceso *${target}* cerrado. Captura actual de tu pantalla.`,
      parse_mode: "Markdown"
    });
    return;
  }

  // Flujo Híbrido (Gemini Advanced Web Pro + Agente Local)
  await ctx.replyWithChatAction("typing");
  try {
    const { text: reply, model, images = [] } = await runAgent(text, ctx);

    // Enviar imágenes generadas si las hay
    if (images.length > 0) {
      for (const imgUrl of images) {
        try {
          const photoInput = fs.existsSync(imgUrl) ? new InputFile(imgUrl) : imgUrl;
          await ctx.replyWithPhoto(photoInput, { caption: "🎨 *Generación de Gemini Pro*", parse_mode: "Markdown" });
        } catch (err) {
          console.error("Error enviando foto de runAgent:", err.message);
        }
      }
    }

    const footer = `\n\n✦ _${model}_`;
    await ctx.reply(reply + footer, { reply_markup: mainKeyboard, parse_mode: "Markdown" }).catch(async () => {
      await ctx.reply(reply + `\n\n✦ (${model})`, { reply_markup: mainKeyboard });
    });

    // Envío proactivo de nota de voz si Kirito lo solicitó
    const wantsVoice = /(?:audio|voz|h[aá]blame|nota de voz|cu[eé]ntame en audio|d[ií]melo en audio)/i.test(text);
    if (wantsVoice && isElevenLabsConfigured() && reply.length < 500) {
      try {
        await ctx.replyWithChatAction("record_voice");
        const speechRes = await generateSpeech({ text: reply });
        if (speechRes.success && speechRes.audioPath) {
          await ctx.replyWithVoice(new InputFile(speechRes.audioPath));
        }
      } catch (voiceErr) {
        console.warn("[telegram-agent] Error enviando nota de voz:", voiceErr.message);
      }
    }
  } catch (e) {
    console.error("Agent error:", e);
    await ctx.reply(`⚠️ Disculpa, hubo una dificultad al procesar: ${e.message?.slice(0, 100)}`);
  }
});

// Manejador de recepción de archivos y fotos desde Telegram (Nube Bidireccional)
bot.on([":document", ":photo", ":audio"], async (ctx) => {
  await ctx.replyWithChatAction("typing");
  try {
    let fileId, fileName;
    if (ctx.message.document) {
      fileId = ctx.message.document.file_id;
      fileName = ctx.message.document.file_name;
    } else if (ctx.message.photo) {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      fileId = largest.file_id;
      fileName = `foto_telegram_${Date.now()}.jpg`;
    } else if (ctx.message.audio) {
      fileId = ctx.message.audio.file_id;
      fileName = ctx.message.audio.file_name || `audio_${Date.now()}.mp3`;
    }

    if (fileId) {
      const res = await saveIncomingTelegramFile(bot, fileId, fileName);
      await ctx.reply(
        `📥 *Archivo recibido y guardado en tu laptop:*\n\n` +
        `📄 *Nombre:* \`${res.fileName}\`\n` +
        `⚖️ *Tamaño:* ${res.sizeMB} MB\n` +
        `📍 *Ruta:* \`${res.targetPath}\``,
        { reply_markup: mainKeyboard, parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    console.error("Error al guardar archivo entrante:", err);
    await ctx.reply(`⚠️ No pude guardar el archivo en la laptop: ${err.message}`);
  }
});

// Verificación inicial
await ensureInteractiveLauncherTask();
startGeminiWebKeepAlive();

const owner = getOwnerId() || 6187878962;
if (owner) {
  startProactiveBatteryMonitor(bot, owner);
  startAgendaScheduler(bot, owner, (alert) => {
    broadcastToClients(alert);
  });
}

// Iniciar servidor Voice Gateway y HUD de escritorio para PC y App móvil (Puerto 3840)
startVoiceGateway({
  onAgentExecute: async (prompt) => {
    const text = (prompt || "").trim();
    const lower = text.toLowerCase();
    const targetOwnerId = getOwnerId() || 6187878962;

    // Contexto real conectado al chat de Telegram de Kirito para que toda captura, imagen, Word, PDF, PPT o código llegue automáticamente a su Telegram
    const realOwnerCtx = {
      chat: { id: targetOwnerId },
      reply: async (m, opts) => {
        try {
          return await bot.api.sendMessage(targetOwnerId, m, opts);
        } catch (e) {
          console.warn("[VoiceGateway->Telegram] reply warning:", e.message);
        }
      },
      replyWithPhoto: async (p, opts) => {
        try {
          return await bot.api.sendPhoto(targetOwnerId, p, opts);
        } catch (e) {
          console.warn("[VoiceGateway->Telegram] photo warning:", e.message);
        }
      },
      replyWithDocument: async (d, opts) => {
        try {
          return await bot.api.sendDocument(targetOwnerId, d, opts);
        } catch (e) {
          console.warn("[VoiceGateway->Telegram] doc warning:", e.message);
        }
      },
      replyWithVoice: async (v, opts) => {
        try {
          return await bot.api.sendVoice(targetOwnerId, v, opts);
        } catch {}
      },
      replyWithChatAction: async (action) => {
        try {
          return await bot.api.sendChatAction(targetOwnerId, action);
        } catch {}
      }
    };

    const finishAndSyncToNotebook = (replyText, model = "Nova • Gemini Advanced Web") => {
      syncActionToGeminiNotebook({ userOrder: text, novaActionSummary: replyText }).catch(() => {});
      return { text: replyText, model };
    };

    // 0. Solicitudes de Word (.docx), PDF (.pdf), PowerPoint (.pptx), Plantillas o Código desde el Celular / Voz
    const isPptRequest = /(?:crea|haz|genera|arma|dame|p[aá]sa|m[aá]nda)(?:me)?\b.*(?:ppt|pptx|power\s*point|diapositivas|presentaci[oó]n)/i.test(lower);
    const isPdfRequest = /(?:crea|haz|genera|redacta|dame|p[aá]sa|m[aá]nda)(?:me)?\b.*(?:\bpdf\b|en\s+pdf|formato\s+pdf)/i.test(lower);
    const isCodeFileRequest = /(?:crea|haz|genera|escribe|dame|p[aá]sa|m[aá]nda)(?:me)?\b.*(?:archivo\s+de\s+c[oó]digo|script|plantilla\s+en|c[oó]digo\s+en\s+(?:sql|java|python|html|javascript|react|c\+\+|c#))/i.test(lower);
    const isLiveWordRequest = /(?:redacta|escribe)\b.*(?:directamente\s+en\s+(?:mi\s+)?word|en\s+mi\s+word\s+abierto)/i.test(lower);
    const isDocRequest = /(?:crea|haz|genera|redacta|escribe|dame|p[aá]sa|arma|m[aá]nda)(?:me)?\b.*(?:documento|informe|word|docx|ensayo|reporte|investigaci[oó]n|tesis|apa|plantilla)/i.test(lower) ||
                         /(?:en\s+word|formato\s+word|en\s+apa|formato\s+apa)/i.test(lower);

    if (isLiveWordRequest) {
      const titleMatch = text.match(/(?:sobre|de|acerca\s+de)\s+([^,.!?]+)/i);
      const docTitle = titleMatch ? titleMatch[1].trim() : "Redaccion_En_Vivo_Nova";
      await executeTool("writeDirectlyInMicrosoftWord", { title: docTitle, topicOrContent: text }, realOwnerCtx, {});
      return finishAndSyncToNotebook(`Listo Kirito, ya lo redacté en vivo en tu Microsoft Word y te mandé el archivo a Telegram.`);
    }

    if (isPptRequest || isPdfRequest || isCodeFileRequest || isDocRequest) {
      const fmt = isPptRequest ? "ppt" : isPdfRequest ? "pdf" : isCodeFileRequest ? "code" : "word";
      const extMatch = lower.match(/\b(sql|java|py|python|html|js|javascript|cpp|cs)\b/);
      const extMap = { sql: ".sql", java: ".java", py: ".py", python: ".py", html: ".html", js: ".js", javascript: ".js", cpp: ".cpp", cs: ".cs" };
      const ext = extMatch ? (extMap[extMatch[1]] || ".txt") : ".txt";
      const titleMatch = text.match(/(?:sobre|de|acerca\s+de|para)\s+([^,.!?]+)/i);
      const docTitle = (titleMatch ? titleMatch[1].trim() : "Documento_Nova").slice(0, 45);

      await executeTool(
        "generateDocumentOrCode",
        { format: fmt, title: docTitle, topicOrInstructions: text, extension: ext },
        realOwnerCtx,
        {}
      );
      return finishAndSyncToNotebook(`Listo Kirito, ya generé tu ${fmt.toUpperCase()} sobre ${docTitle}, lo abrí en tu laptop y te lo envié a Telegram.`);
    }

    // 0b. Solicitud de generación de imagen (Imagen 3 desde Gemini Advanced Pro)
    const isImageRequest = /(?:genera[rn]?|crea[rn]?|dibuja[rn]?|haz|p[aá]sa|dame|quiero|m[aá]nda)(?:me)?\b.*(?:imagen|dibujo|arte|foto(?!\s*webcam)|poster|póster|wallpaper|fondo)/i.test(lower) ||
                           /(?:imagen|dibujo)\s+(?:de|sobre)\b/i.test(lower);
    if (isImageRequest && !lower.includes("captura") && !lower.includes("pantalla")) {
      await executeTool("generateAIImage", { prompt: text }, realOwnerCtx, {});
      return finishAndSyncToNotebook(`Listo Kirito, ya generé la imagen con Imagen 3 y te la envié a tu Telegram.`);
    }

    // 0c. Solicitud de captura de pantalla o foto webcam desde voz/app
    if (/(?:captura|screenshot|pantallazo|foto\s+de\s+(?:la\s+|mi\s+)?pantalla)/i.test(lower)) {
      await executeTool("takeScreenshot", {}, realOwnerCtx, {});
      return finishAndSyncToNotebook(`Listo Kirito, ya te envié la captura de pantalla en tiempo real a tu Telegram.`);
    }
    if (/(?:webcam|c[aá]mara\s+web|foto\s+con\s+la\s+c[aá]mara)/i.test(lower)) {
      await executeTool("takeWebcamPhoto", {}, realOwnerCtx, {});
      return finishAndSyncToNotebook(`Listo Kirito, ya tomé la foto con la cámara web y te la envié a Telegram.`);
    }

    // 0d. Steam / Epic Games / Descargas en Brave / Antigravity
    if (/(?:actualiza|actualizar|descarga|descargas|cola)\b.*(?:steam|epic)/i.test(lower)) {
      const plat = lower.includes("epic") ? "epic" : "steam";
      await executeTool("manageSteamAndEpic", { platform: plat, action: "downloads" }, realOwnerCtx, {});
      return finishAndSyncToNotebook(`Claro Kirito, ya abrí el panel de descargas y actualizaciones de ${plat.toUpperCase()} en tu laptop y te mandé captura a Telegram.`);
    }
    if (/(?:descarga|instala)\b.*(?:desde\s+brave|en\s+brave|la\s+aplicaci[oó]n|el\s+programa)/i.test(lower)) {
      const appMatch = text.match(/(?:descarga|instala)(?:me)?\s+(?:la\s+aplicaci[oó]n\s+|el\s+programa\s+)?([^,.!?]+?)(?:\s+desde\s+brave|\s+en\s+brave)?$/i);
      const appName = appMatch ? appMatch[1].trim() : text;
      await executeTool("downloadAppFromBrave", { appName }, realOwnerCtx, {});
      return finishAndSyncToNotebook(`Listo Kirito, ya abrí la descarga oficial de ${appName} en Brave y te envié captura a Telegram.`);
    }
    if (/(?:antigravity|proyecto\s+en\s+antigravity)/i.test(lower)) {
      const titleMatch = text.match(/(?:sobre|de|para)\s+([^,.!?]+)/i);
      const projName = titleMatch ? titleMatch[1].trim() : "proyecto-nova";
      await executeTool("delegateTaskToAntigravity", { projectName: projName, taskDescription: text }, realOwnerCtx, {});
      return finishAndSyncToNotebook(`Listo Kirito, ya creé el proyecto en Antigravity IDE en tu laptop y te mandé los archivos a Telegram.`);
    }

    // 1. Ejecución directa instantánea de Enlaces de YouTube
    const ytLinkMatch = text.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)(?:[^\s]*)/i);
    if (ytLinkMatch) {
      const res = await playYouTubeVideo({ url: ytLinkMatch[0] });
      return finishAndSyncToNotebook(`Claro Kirito, ya te abrí el video ${res.title || ""} en YouTube.`, "Nova Direct");
    }

    // 2. Ejecución directa instantánea de Videos de YouTube por voz
    const isVideoRequest = /(?:pon(?:me)?|reproduce|busca|quiero\s+ver|mu[eé]strame|ver|play)\b.*(?:video|youtube(?!\s*music)|trailer|clip|gameplay|tutorial|cap[ií]tulo|resumen)\b/i.test(lower) ||
                           /(?:pon|reproduce|ver)\s+(?:el\s+video|un\s+video|en\s+youtube)\b/i.test(lower);
    if (isVideoRequest) {
      let videoQuery = text
        .replace(/(?:ponme|pon|reproduce|busca|quiero\s+ver|muéstrame|ver|play|el\s+video|un\s+video|de|en|youtube|por\s+favor|y|que|funcione|clip|trailer)/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!videoQuery) videoQuery = text;
      const res = await playYouTubeVideo({ query: videoQuery });
      return finishAndSyncToNotebook(`Listo Kirito, ahí te puse el video ${res.title || videoQuery} en YouTube.`, "Nova Direct");
    }

    // 3. Ejecución directa instantánea de Música por voz
    const isMusicRequest = /(?:pon(?:me)?|reproduce|escuchar|musica|música|play|toca)\b.*(?:canci[oó]n|bob\s+marley|musica|música|youtube\s+music|spotify|track|tema)/i.test(lower) ||
                           /(?:youtube\s+music)\b/i.test(lower) ||
                           /(?:pon|reproduce|toca)\s+(?:una\s+canci[oó]n|un\s+tema|m[uú]sica|a\s+|de\s+)/i.test(lower);
    if (isMusicRequest) {
      let songQuery = text
        .replace(/(?:abre|ponme|pon|una|un|cancion|canción|de|en|youtube|music|por\s+favor|y|que|funcione|el\s+tema|escuchar)/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!songQuery) songQuery = "Bob Marley";
      await playMusicTrack({ query: songQuery, platform: "youtube_music" });
      return finishAndSyncToNotebook(`De una Kirito, ahí te puse ${songQuery} en YouTube Music.`, "Nova Direct");
    }

    // 4. Ejecución directa instantánea de Control de Volumen por voz
    if (/(?:sube|subir)\s+(?:el\s+)?volumen/i.test(lower)) {
      await controlVolume("up");
      return finishAndSyncToNotebook("Listo Kirito, le subí al volumen.", "Nova Direct");
    }
    if (/(?:baja|bajar)\s+(?:el\s+)?volumen/i.test(lower)) {
      await controlVolume("down");
      return finishAndSyncToNotebook("Claro, le bajé un poco al volumen.", "Nova Direct");
    }

    // 5. Ejecución directa instantánea de Apertura de Aplicaciones por voz
    const matchOpenApp = lower.match(/^(?:nova[\s,]+|oye\s+nova[\s,]+|hola\s+nova[\s,]+)?(?:abre|abrir|inicia|iniciar|lanza|lanzar|ejecuta|ejecutar|pon)\s+(?:el\s+|la\s+|mi\s+)?([a-z0-9\s._-]+?)(?:\s+en\s+mi\s+(?:laptop|pantalla|pc))?$/i);
    if (matchOpenApp && !lower.includes("intranet") && !lower.includes("youtube") && !lower.includes("video") && !lower.includes("musica") && !lower.includes("música") && !lower.includes("cancion") && !lower.includes("canción")) {
      const appCandidate = matchOpenApp[1].trim();
      const resolved = await resolveApplicationCommand(appCandidate);
      if (resolved) {
        const launchRes = await launchUniversalApplication(appCandidate, true);
        if (launchRes.shotPath) {
          await realOwnerCtx.replyWithPhoto(new InputFile(launchRes.shotPath), {
            caption: `🚀 *${launchRes.application}* abierto en tu pantalla desde NOVA Control.`,
            parse_mode: "Markdown"
          });
        }
        return finishAndSyncToNotebook(`Claro Kirito, ya te abrí ${launchRes.application || appCandidate} y te mandé confirmación a Telegram.`, "Nova Direct");
      }
    }

    const agentRes = await runAgent(text, realOwnerCtx, { fromVoice: true });
    if (agentRes.images && agentRes.images.length > 0) {
      for (const imgPath of agentRes.images) {
        if (fs.existsSync(imgPath)) {
          await realOwnerCtx.replyWithPhoto(new InputFile(imgPath), {
            caption: "🎨 *Imagen generada por Nova (Imagen 3 Pro)*",
            parse_mode: "Markdown"
          });
        }
      }
    }
    return agentRes;
  }
});

if (owner && (process.argv.includes("--notify-ready") || process.env.NOTIFY_READY === "1")) {
  try {
    await bot.api.sendMessage(
      owner,
      `✨ *¡Hola Kirito! Ya estoy aquí contigo* 💜\n\n` +
      `Sistemas sincronizados, memoria local al día y lista para lo que se te ocurra hoy.\n\n` +
      `• 🎙️ *Voz Humana:* Motor de ElevenLabs integrado.\n` +
      `• 🧠 *Memoria Local:* Noción de tiempo en Perú y proyectos activos.\n` +
      `• ⚡ *Control:* Lista para asistirte en todo momento.\n\n` +
      `_¿En qué andamos trabajando o qué vemos hoy?_`,
      { reply_markup: mainKeyboard, parse_mode: "Markdown" }
    );
    console.log("[telegram-agent] Notificación de Nova enviada a Kirito.");
  } catch (err) {
    console.warn("[telegram-agent] No se pudo enviar notificación de inicio:", err.message);
  }
}

console.log("[telegram-agent] Bot-Agente Multi-Modelo listo y escuchando en Telegram...");
bot.start();
