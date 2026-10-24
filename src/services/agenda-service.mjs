import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config.mjs";

const AGENDA_FILE = path.join(DATA_DIR, "nova_agenda.json");

export function loadAgenda() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(AGENDA_FILE)) {
      return JSON.parse(fs.readFileSync(AGENDA_FILE, "utf8"));
    }
  } catch (err) {
    console.warn("[AgendaService] Aviso cargando agenda:", err.message);
  }
  return { reminders: [] };
}

export function saveAgenda(data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AGENDA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[AgendaService] Error guardando agenda:", err.message);
  }
}

export function formatLimaDate(date) {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    dateStyle: "full",
    timeStyle: "short"
  }).format(date);
}

export function addReminder({ title, targetTimestamp, remindMinutesBefore = 0, recurring = null }) {
  const agenda = loadAgenda();
  const reminder = {
    id: `rem_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    title: title.trim(),
    targetTimestamp,
    targetLimaTime: formatLimaDate(new Date(targetTimestamp)),
    remindMinutesBefore: Number(remindMinutesBefore) || 0,
    preNotified: false,
    notified: false,
    recurring,
    createdAt: new Date().toISOString()
  };

  agenda.reminders.push(reminder);
  // Ordenar por fecha objetivo ascendente
  agenda.reminders.sort((a, b) => a.targetTimestamp - b.targetTimestamp);
  saveAgenda(agenda);

  return reminder;
}

export function listReminders() {
  const agenda = loadAgenda();
  const now = Date.now();
  // Mostrar activos o futuros
  return agenda.reminders.filter(r => !r.notified || r.targetTimestamp > now - 3600000);
}

export function deleteReminder(id) {
  const agenda = loadAgenda();
  const initialLen = agenda.reminders.length;
  agenda.reminders = agenda.reminders.filter(r => r.id !== id);
  saveAgenda(agenda);
  return agenda.reminders.length < initialLen;
}

/**
 * Intenta interpretar lenguaje natural para crear un recordatorio
 * Ej: "recuérdame en 20 minutos tomar agua" o "el lunes a las 3:00 pm tengo examen de redes"
 */
export function parseReminderFromPrompt(text) {
  const lower = text.toLowerCase();
  const now = Date.now();

  // 1. Minutos relativos: "en 15 minutos / en media hora / en 1 hora"
  const minMatch = lower.match(/en\s+(\d+)\s*(?:min|minutos)/);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    const target = now + mins * 60 * 1000;
    const cleanTitle = text.replace(/recu[eé]rdame|anota|en\s+\d+\s*minutos?/gi, "").trim() || "Recordatorio importante";
    return { title: cleanTitle, targetTimestamp: target };
  }

  const hourMatch = lower.match(/en\s+(\d+)\s*(?:h|hora|horas)/);
  if (hourMatch) {
    const hrs = parseInt(hourMatch[1], 10);
    const target = now + hrs * 3600 * 1000;
    const cleanTitle = text.replace(/recu[eé]rdame|anota|en\s+\d+\s*horas?/gi, "").trim() || "Recordatorio importante";
    return { title: cleanTitle, targetTimestamp: target };
  }

  // 2. Horas fijas: "a las 4:30 pm", "a las 16:00"
  const timeMatch = lower.match(/(?:a\s+las?|para\s+las?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3];

    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;

    // Calcular para hoy en hora de Lima
    const d = new Date();
    d.setHours(hour, min, 0, 0);
    if (d.getTime() <= now) {
      // Si la hora ya pasó hoy, se asume para mañana
      d.setDate(d.getDate() + 1);
    }

    const cleanTitle = text.replace(/recu[eé]rdame|anota|(?:a\s+las?|para\s+las?)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, "").trim() || "Recordatorio de agenda";
    return { title: cleanTitle, targetTimestamp: d.getTime() };
  }

  return null;
}

/**
 * Planificador proactivo: vigila la agenda y dispara avisos automáticos
 */
let schedulerInterval = null;

export function startAgendaScheduler(bot, ownerId, onBroadcastAlert = null) {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(async () => {
    const agenda = loadAgenda();
    const now = Date.now();
    let updated = false;

    for (const rem of agenda.reminders) {
      if (rem.notified) continue;

      // 1. Pre-aviso si aplica (ej: 30 minutos antes)
      if (rem.remindMinutesBefore > 0 && !rem.preNotified) {
        const preTime = rem.targetTimestamp - rem.remindMinutesBefore * 60 * 1000;
        if (now >= preTime) {
          rem.preNotified = true;
          updated = true;

          const preMsg = `⏳ *Aviso Previo de Agenda (${rem.remindMinutesBefore} min antes):*\n\n📌 *${rem.title}*\n⏱️ *Hora fijada:* ${rem.targetLimaTime}`;
          if (bot && ownerId) {
            await bot.api.sendMessage(ownerId, preMsg, { parse_mode: "Markdown" }).catch(() => {});
          }
          if (onBroadcastAlert) {
            onBroadcastAlert({
              type: "AGENDA_PRE_ALERT",
              title: rem.title,
              time: rem.targetLimaTime,
              speechText: `Kirito, recordatorio previo: en ${rem.remindMinutesBefore} minutos tienes: ${rem.title}.`
            });
          }
        }
      }

      // 2. Alarma exacta
      if (now >= rem.targetTimestamp) {
        rem.notified = true;
        updated = true;

        const alertMsg = `🔔 *¡RECORDATORIO DE NOVA!* ⏰\n\n📌 *${rem.title}*\n⏱️ *Hora actual:* ${formatLimaDate(new Date())}\n\n_¡Es hora, Kirito!_`;
        if (bot && ownerId) {
          await bot.api.sendMessage(ownerId, alertMsg, { parse_mode: "Markdown" }).catch(() => {});
        }
        if (onBroadcastAlert) {
          onBroadcastAlert({
            type: "AGENDA_ALERT",
            title: rem.title,
            time: rem.targetLimaTime,
            speechText: `¡Kirito! Es la hora de tu recordatorio: ${rem.title}.`
          });
        }
      }
    }

    if (updated) {
      saveAgenda(agenda);
    }
  }, 15000);

  console.log("[AgendaService] Planificador de Agenda de Perú (UTC-5) activo.");
}
