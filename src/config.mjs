import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const OUTBOX_DIR = path.join(ROOT_DIR, "outbox");
export const INBOX_DIR = path.join(ROOT_DIR, "inbox");
export const OWNER_FILE = path.join(ROOT_DIR, "owner.json");

export const CONFIG = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || ""
  },
  providers: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || "",
      enabled: Boolean(process.env.GEMINI_API_KEY)
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      enabled: Boolean(process.env.ANTHROPIC_API_KEY)
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || "",
      enabled: Boolean(process.env.OPENAI_API_KEY)
    },
    geminiWeb: {
      psid: process.env.GEMINI_WEB_COOKIE_1PSID || "",
      psidts: process.env.GEMINI_WEB_COOKIE_1PSIDTS || "",
      enabled: Boolean(process.env.GEMINI_WEB_COOKIE_1PSID)
    },
    elevenlabs: {
      apiKey: process.env.ELEVENLABS_API_KEY || "",
      voiceId: process.env.ELEVENLABS_VOICE_ID || "cgSgspJ2msm6clMCkdW9",
      enabled: Boolean(process.env.ELEVENLABS_API_KEY)
    }
  },
  // Tabla de Precios Oficiales (USD por 1M tokens) para cálculo de telemetría y costos
  pricing: {
    "gemini-3.5-flash": { input: 0.15, output: 0.60 },
    "gemini-3-flash-preview": { input: 0.15, output: 0.60 },
    "gemini-3.5-flash-lite": { input: 0.075, output: 0.30 },
    "gemini-3.8-flash": { input: 0.20, output: 0.80 },
    "gemini-4-argon": { input: 1.25, output: 5.00 },
    "gemini-3.1-pro-preview": { input: 1.25, output: 5.00 },
    "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00 },
    "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00 },
    "gpt-4o": { input: 2.50, output: 10.00 },
    "gpt-4o-mini": { input: 0.15, output: 0.60 },
    "o1-preview": { input: 15.00, output: 60.00 }
  }
};
