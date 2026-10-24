import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, CONFIG } from "../config.mjs";

const USAGE_FILE = path.join(DATA_DIR, "usage_records.json");
const STATS_FILE = path.join(DATA_DIR, "usage_summary.json");

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USAGE_FILE)) fs.writeFileSync(USAGE_FILE, "[]", "utf8");
  if (!fs.existsSync(STATS_FILE)) {
    fs.writeFileSync(STATS_FILE, JSON.stringify({
      totalTokens: 0,
      totalCostUSD: 0,
      totalRequests: 0,
      byProvider: {},
      byModel: {},
      daily: {}
    }, null, 2), "utf8");
  }
}

export function recordUsage({
  provider,
  model,
  inputTokens = 0,
  outputTokens = 0,
  cachedTokens = 0,
  reasoningTokens = 0,
  status = "success",
  confidence = "Verificado"
}) {
  ensureFiles();
  const totalTokens = inputTokens + outputTokens;

  // Cálculo de costo según tabla de precios
  const rate = CONFIG.pricing[model] || { input: 0.15, output: 0.60 };
  const costUSD = ((inputTokens * rate.input) + (outputTokens * rate.output)) / 1_000_000;

  const record = {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    provider,
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    totalTokens,
    costUSD: Number(costUSD.toFixed(6)),
    status,
    confidence
  };

  try {
    const rawRecords = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
    rawRecords.push(record);
    if (rawRecords.length > 500) rawRecords.splice(0, rawRecords.length - 500); // Conservar últimos 500
    fs.writeFileSync(USAGE_FILE, JSON.stringify(rawRecords, null, 2), "utf8");

    // Actualizar resumen
    const summary = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    summary.totalTokens = (summary.totalTokens || 0) + totalTokens;
    summary.totalCostUSD = Number(((summary.totalCostUSD || 0) + costUSD).toFixed(6));
    summary.totalRequests = (summary.totalRequests || 0) + 1;

    // Por proveedor
    summary.byProvider[provider] = summary.byProvider[provider] || { requests: 0, tokens: 0, costUSD: 0 };
    summary.byProvider[provider].requests += 1;
    summary.byProvider[provider].tokens += totalTokens;
    summary.byProvider[provider].costUSD = Number((summary.byProvider[provider].costUSD + costUSD).toFixed(6));

    // Por modelo
    summary.byModel[model] = summary.byModel[model] || { requests: 0, tokens: 0, costUSD: 0 };
    summary.byModel[model].requests += 1;
    summary.byModel[model].tokens += totalTokens;
    summary.byModel[model].costUSD = Number((summary.byModel[model].costUSD + costUSD).toFixed(6));

    // Diario
    const today = new Date().toISOString().slice(0, 10);
    summary.daily[today] = summary.daily[today] || { requests: 0, tokens: 0, costUSD: 0 };
    summary.daily[today].requests += 1;
    summary.daily[today].tokens += totalTokens;
    summary.daily[today].costUSD = Number((summary.daily[today].costUSD + costUSD).toFixed(6));

    fs.writeFileSync(STATS_FILE, JSON.stringify(summary, null, 2), "utf8");
  } catch (e) {
    console.error("[UsageTracker] Error guardando uso:", e.message);
  }

  return record;
}

export function getUsageSummary() {
  ensureFiles();
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  } catch {
    return { totalTokens: 0, totalCostUSD: 0, totalRequests: 0, byProvider: {}, byModel: {}, daily: {} };
  }
}

export function getRecentRecords(limit = 10) {
  ensureFiles();
  try {
    const records = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
    return records.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// Genera el reporte formateado en Markdown para Telegram
export function generateUsageTelegramReport() {
  const summary = getUsageSummary();
  const today = new Date().toISOString().slice(0, 10);
  const todayData = summary.daily[today] || { requests: 0, tokens: 0, costUSD: 0 };

  const provLines = Object.entries(summary.byProvider)
    .map(([p, d]) => `• *${p}:* ${d.tokens.toLocaleString()} tokens | ${d.requests} peticiones | \$${d.costUSD.toFixed(4)}`)
    .join("\n") || "• Sin consumo registrado aún.";

  const modelLines = Object.entries(summary.byModel)
    .map(([m, d]) => `• \`${m}\`: ${d.tokens.toLocaleString()} tok (\$${d.costUSD.toFixed(4)})`)
    .join("\n") || "• Ningún modelo utilizado hoy.";

  return (
    `📊 *Panel Oficial de Telemetría y Consumo de Tokens*\n\n` +
    `📅 *Consumo de Hoy (${today}):*\n` +
    `• *Tokens Totales:* *${todayData.tokens.toLocaleString()}*\n` +
    `• *Peticiones:* *${todayData.requests}*\n` +
    `• *Costo Estimado:* *\$${todayData.costUSD.toFixed(4)} USD*\n\n` +
    `🏛 *Consumo por Proveedor (Histórico):*\n${provLines}\n\n` +
    `🧠 *Desglose por Modelo:*\n${modelLines}\n\n` +
    `💡 *Nota de Verificación:* Datos computados a partir del campo oficial \`usageMetadata\` devuelto en cada respuesta por los proveedores.`
  );
}
