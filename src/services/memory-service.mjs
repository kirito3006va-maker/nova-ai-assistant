import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config.mjs";

const MEMORY_FILE = path.join(DATA_DIR, "nova_memory.json");

const DEFAULT_MEMORY = {
  version: "1.0",
  profile: {
    alias: "Kirito",
    fullName: "Kazuto Kirigaya",
    role: "Estudiante de Ingeniería Informática",
    university: "UNJFSC (Universidad Nacional José Faustino Sánchez Carrión, Huacho, Perú)",
    timezone: "America/Lima (Perú, UTC-5)",
    hardware: {
      model: "Lenovo LOQ 15ARP9",
      cpu: "AMD Ryzen 7 7435HS (8 núcleos / 16 hilos)",
      gpu: "NVIDIA GeForce RTX 4060 Laptop GPU (8GB GDDR6)",
      ram: "24GB DDR5",
      storage: "1TB SSD NVMe",
      os: "Windows 11 Pro"
    },
    preferences: {
      colorTheme: "Púrpura y Magenta Neón Cyberpunk con partículas",
      music: ["Bob Marley", "Reggae", "Rock", "Linkin Park"],
      programming: ["Java", "Apache NetBeans", "VS Code", "Python", "Node.js", "C++", "PowerShell"],
      tone: "Cómplice, ingenioso, técnico, afectuoso, leal y de élite"
    }
  },
  knowledge: {
    universityTopics: [
      "Algoritmos y Estructuras de Datos",
      "Sistemas Operativos",
      "Bases de Datos",
      "Redes y Telecomunicaciones",
      "Arquitectura de Computadoras",
      "Ingeniería de Software"
    ],
    activeProjects: [
      "Proyecto NOVA: Asistente personal de élite con control de hardware, voz, Telegram y visión multimodal",
      "Investigaciones académicas en formato APA",
      "Desarrollo de App Android nativa con Jetpack Compose"
    ]
  },
  facts: [
    "Kirito es estudiante de Ingeniería Informática y el dueño exclusivo de la Lenovo LOQ.",
    "Nova fue creada para ser su mano derecha técnica y de vida, con voz propia y presencia visual.",
    "Kirito prefiere respuestas estéticas, con viñetas elegantes y formato impecable.",
    "La zona horaria es de Perú (UTC-5, hora exacta de Lima)."
  ],
  episodes: [],
  lastUpdated: new Date().toISOString()
};

export function loadMemory() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(MEMORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
      return { ...DEFAULT_MEMORY, ...parsed };
    }
  } catch (err) {
    console.warn("[MemoryService] Aviso cargando memoria:", err.message);
  }
  saveMemory(DEFAULT_MEMORY);
  return DEFAULT_MEMORY;
}

export function saveMemory(data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[MemoryService] Error guardando memoria:", err.message);
  }
}

export function addFact(fact) {
  if (!fact || typeof fact !== "string") return;
  const mem = loadMemory();
  const trimmed = fact.trim();
  if (!mem.facts.includes(trimmed)) {
    mem.facts.push(trimmed);
    if (mem.facts.length > 50) mem.facts.shift();
    saveMemory(mem);
    console.log(`[MemoryService] Nuevo hecho memorizado: "${trimmed}"`);
  }
}

export function addEpisode(type, description) {
  if (!description) return;
  const mem = loadMemory();
  mem.episodes.unshift({
    id: Date.now(),
    type,
    description,
    timestamp: new Date().toISOString(),
    limaTime: getLimaTimeString()
  });
  if (mem.episodes.length > 30) mem.episodes.pop();
  saveMemory(mem);
}

export function getLimaTimeString() {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    dateStyle: "full",
    timeStyle: "medium"
  }).format(new Date());
}

export function buildSystemMemoryPrompt() {
  const mem = loadMemory();
  const p = mem.profile;
  const limaNow = getLimaTimeString();

  return (
    `[MEMORIA LOCAL PERMANENTE DE NOVA]:\n` +
    `• Fecha y Hora Actual en Perú (UTC-5): ${limaNow}\n` +
    `• Usuario Principal: ${p.alias} (${p.fullName}), ${p.role} en ${p.university}.\n` +
    `• Proyectos Activos de Kirito: ${mem.knowledge.activeProjects.join(" | ")}.\n` +
    `• Gustos y Preferencias: Música (${p.preferences.music.join(", ")}), Lenguajes (${p.preferences.programming.join(", ")}).\n` +
    `• Hechos y Aprendizajes Recordados:\n${mem.facts.slice(-10).map(f => `  - ${f}`).join("\n")}\n` +
    `• DIRECTIVAS DE PERSONALIDAD Y HABLA HUMANA NORMAL:\n` +
    `  1. Habla como una persona real, normal, inteligente, relajada y directa (como una compañera o asistente brillante de la vida real). NO hables como un robot militar ni uses frases cliché como "sistemas en línea", "operando al 100%", "¿qué directiva tenemos?" o "a tu disposición".\n` +
    `  2. PROHIBICIÓN ABSOLUTA: JAMÁS uses apodos románticos o de pareja (prohibido decir "amor", "mi amor", "cariño", "cielo", "bebé", etc.). Llámalo simplemente "Kirito".\n` +
    `  3. PROHIBICIÓN DE HARDWARE: NUNCA menciones especificaciones de hardware (Ryzen, RTX 4060, Lenovo LOQ, RAM) en charlas normales. Solo habla de eso si Kirito te pregunta explícitamente por la temperatura o el sistema.\n` +
    `  4. Sé breve, natural y fluida: responde directo al grano, con el tono cotidiano y fresco de una mujer joven e inteligente.`
  );
}

export function autoExtractAndSaveFacts(userMessage) {
  const text = (userMessage || "").trim();
  const lower = text.toLowerCase();

  // Detección de gustos o preferencias
  const prefMatch = text.match(/(?:me gusta|mi favorito es|prefiero|suelo escuchar|juego a|uso)\s+([^,.!?]+)/i);
  if (prefMatch && prefMatch[1].length > 3) {
    addFact(`A Kirito le gusta: ${prefMatch[1].trim()}`);
  }

  // Detección de cursos o universidad
  const courseMatch = text.match(/(?:curso de|materia de|profesor de|examen de|laboratorio de)\s+([^,.!?]+)/i);
  if (courseMatch && courseMatch[1].length > 3) {
    addFact(`Relacionado con sus estudios: ${courseMatch[0].trim()}`);
  }

  // Detección de proyectos
  const projectMatch = text.match(/(?:mi proyecto es|estoy programando|estoy haciendo)\s+([^,.!?]+)/i);
  if (projectMatch && projectMatch[1].length > 3) {
    addFact(`Proyecto de Kirito: ${projectMatch[1].trim()}`);
  }
}
