/**
 * NOVA MINI WIDGET DESKTOP CLIENT
 * Cyberpunk Floating Widget • Turn-Taking Half-Duplex • Wake Word: "NOVA"
 */

const CONFIG = {
  particleCount: 260,
  baseRadius: 46,
  coreRadius: 22,
  wsUrl: `ws://${window.location.hostname || "127.0.0.1"}:3840`,
  colors: {
    purple: "#a855f7",
    magenta: "#ec4899",
    rose: "#f43f5e",
    cyan: "#06b6d4"
  }
};

let currentState = "IDLE";
let audioIntensity = 0;
let micActive = true;
let isAwake = false;
let awakeTimer = null;
let isMutedDueToSpeaking = false;
let lastSpokeEndedAt = 0;

let ws = null;
let synth = window.speechSynthesis;
let currentAudio = null;
let audioContext = null;
let analyser = null;
let dataArray = null;
let micStream = null;

let speechRecognition = null;
let hasWorkingNativeSpeech = false;
let accumulatedSpeech = "";
let speechSilenceDebounceTimer = null;

let mediaRecorder = null;
let recordedChunks = [];
let isRecordingVoice = false;
let recordingStartTime = 0;
let lastVoiceActivityTime = 0;
let peakVoiceEnergy = 0;
let ambientNoiseFloor = 4;

// ================= RENDERIZADOR 3D COMPACTO =================
const canvas = document.getElementById("orbCanvas");
const ctx = canvas.getContext("2d");
let width = 140, height = 140, cx = 70, cy = 70;
const particles = [];

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  width = 140;
  height = 140;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = width / 2;
  cy = height / 2;
}

for (let i = 0; i < CONFIG.particleCount; i++) {
  const phi = Math.acos(1 - 2 * (i + 0.5) / CONFIG.particleCount);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  particles.push({
    origX: Math.cos(theta) * Math.sin(phi),
    origY: Math.sin(theta) * Math.sin(phi),
    origZ: Math.cos(phi),
    size: Math.random() * 1.8 + 0.6,
    colorType: Math.random() > 0.45 ? "magenta" : (Math.random() > 0.3 ? "purple" : "cyan"),
    pulseOffset: Math.random() * Math.PI * 2
  });
}

let rotX = 0, rotY = 0, time = 0;

function renderOrb() {
  time += 0.02;
  ctx.clearRect(0, 0, width, height);

  let speedMultiplier = 1;
  let targetRadius = CONFIG.baseRadius;

  if (currentState === "IDLE") {
    speedMultiplier = isAwake ? 1.2 : 0.8;
    targetRadius = CONFIG.baseRadius + Math.sin(time * 1.5) * 2 + (audioIntensity * 6);
  } else if (currentState === "LISTENING") {
    speedMultiplier = 1.65;
    targetRadius = CONFIG.baseRadius + 8 + (audioIntensity * 16);
  } else if (currentState === "THINKING") {
    speedMultiplier = 3.2;
    targetRadius = CONFIG.baseRadius - 5 + Math.sin(time * 6) * 5;
  } else if (currentState === "SPEAKING") {
    speedMultiplier = 1.8;
    targetRadius = CONFIG.baseRadius + 7 + Math.sin(time * 4.5) * 8;
  }

  rotX += 0.004 * speedMultiplier;
  rotY += 0.007 * speedMultiplier;

  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  const projected = [];

  for (let p of particles) {
    let x1 = p.origX * cosY - p.origZ * sinY;
    let z1 = p.origZ * cosY + p.origX * sinY;
    let y1 = p.origY * cosX - z1 * sinX;
    let z2 = z1 * cosX + p.origY * sinX;

    const wave = Math.sin(time * 3 + p.pulseOffset) * 0.06;
    const currentR = targetRadius * (1 + wave);
    const scale = 180 / (180 + z2 * currentR);
    const px = cx + x1 * currentR * scale;
    const py = cy + y1 * currentR * scale;
    const alpha = Math.max(0.18, Math.min(1, (z2 + 1.2) / 2.2));

    projected.push({ x: px, y: py, z: z2, scale, alpha, colorType: p.colorType, size: p.size });
  }

  projected.sort((a, b) => a.z - b.z);

  for (let p of projected) {
    let col = CONFIG.colors.magenta;
    if (p.colorType === "purple") col = CONFIG.colors.purple;
    if (p.colorType === "cyan") col = CONFIG.colors.cyan;
    if (currentState === "THINKING") col = Math.random() > 0.5 ? CONFIG.colors.cyan : CONFIG.colors.magenta;
    if (currentState === "LISTENING" || isAwake) col = Math.random() > 0.3 ? CONFIG.colors.rose : CONFIG.colors.magenta;

    ctx.fillStyle = col;
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  requestAnimationFrame(renderOrb);
}

// ================= TONO SUAVE (WAKE CHIME) =================
function playWakeChime() {
  try {
    const actx = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume().catch(() => {});
    const now = actx.currentTime;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.12);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch (e) {}
}

// ================= GESTIÓN DE TURNOS Y WAKE WORD =================
function triggerWake(promptText = "¿Sí, Kirito? Te escucho...") {
  if (currentState === "SPEAKING" || currentState === "THINKING" || isMutedDueToSpeaking) return;

  isAwake = true;
  playWakeChime();
  setAssistantState("LISTENING");

  const status = document.getElementById("widgetStatus");
  const caption = document.getElementById("captionText");
  if (status) status.innerText = "¿SÍ?";
  if (caption) caption.innerText = promptText;

  if (awakeTimer) clearTimeout(awakeTimer);
  awakeTimer = setTimeout(() => {
    if (currentState === "LISTENING" || isAwake) {
      returnToStandby();
    }
  }, 9000);
}

function returnToStandby() {
  isAwake = false;
  if (awakeTimer) clearTimeout(awakeTimer);
  if (speechSilenceDebounceTimer) clearTimeout(speechSilenceDebounceTimer);
  accumulatedSpeech = "";

  const status = document.getElementById("widgetStatus");
  const caption = document.getElementById("captionText");
  if (status) status.innerText = "REPOSO";
  if (caption && currentState !== "SPEAKING" && currentState !== "THINKING") {
    caption.innerText = 'Di "Nova" para darme una orden...';
  }

  if (currentState === "LISTENING") {
    setAssistantState("IDLE");
  }
}

function evaluateFinalUserPhrase(rawPhrase) {
  const text = (rawPhrase || "").trim();
  if (!text) return;

  const lower = text.toLowerCase();
  const hasWakeWord = /\b(?:nova|noba|nobba|noga|oye\s+nova|hola\s+nova)\b/i.test(lower);

  if (!isAwake && !hasWakeWord) return;

  if (hasWakeWord) {
    let cleaned = text.replace(/\b(?:oye\s+nova|hola\s+nova|nova)\b/gi, "").trim();
    cleaned = cleaned.replace(/^[,.\s]+|[,.\s]+$/g, "");

    if (!cleaned || cleaned.length < 2) {
      triggerWake("¿Sí, Kirito? Te escucho...");
      return;
    }

    playWakeChime();
    sendUserMessage(cleaned);
    return;
  }

  if (isAwake) {
    sendUserMessage(text);
  }
}

function sendUserMessage(rawText) {
  const text = (rawText || "").trim();
  if (!text) return;

  isMutedDueToSpeaking = true;
  if (awakeTimer) clearTimeout(awakeTimer);
  if (speechSilenceDebounceTimer) clearTimeout(speechSilenceDebounceTimer);
  accumulatedSpeech = "";

  const inputElem = document.getElementById("widgetInputText");
  if (inputElem) inputElem.value = "";

  setAssistantState("THINKING");
  document.getElementById("captionText").innerText = `Procesando: "${text}"...`;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "USER_SPEECH", text }));
  }
}

// ================= ANÁLISIS DE AUDIO & RECONOCIMIENTO =================
async function setupAudioAnalysis() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(micStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.45;
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});

    const unlockAudio = () => {
      if (audioContext && audioContext.state === "suspended") audioContext.resume().catch(() => {});
    };
    ["click", "keydown", "focus", "mousemove"].forEach(evt => window.addEventListener(evt, unlockAudio, { passive: true }));

    setupNativeSpeechRecognition();

    const vuFill = document.getElementById("widgetVuFill");

    function monitorVoiceActivity() {
      if (analyser && micActive) {
        if (audioContext && audioContext.state === "suspended") audioContext.resume().catch(() => {});
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 2; i < Math.min(28, dataArray.length); i++) sum += dataArray[i];
        const avgEnergy = sum / 26;
        audioIntensity = Math.min(1, avgEnergy / 80);

        if (vuFill) {
          if (currentState === "SPEAKING" || currentState === "THINKING" || isMutedDueToSpeaking) {
            vuFill.style.width = "0%";
          } else {
            const pct = Math.min(100, Math.round((avgEnergy / 40) * 100));
            vuFill.style.width = `${pct}%`;
          }
        }

        const now = Date.now();
        const canListenNow = currentState !== "SPEAKING" && currentState !== "THINKING" && !isMutedDueToSpeaking && (now - lastSpokeEndedAt > 1400);

        if (!hasWorkingNativeSpeech && canListenNow) {
          if (!isRecordingVoice) {
            ambientNoiseFloor = (ambientNoiseFloor * 0.95) + (avgEnergy * 0.05);
            if (avgEnergy > Math.max(7.0, ambientNoiseFloor + 5.5)) {
              startVoiceCapture();
            }
          } else if (isRecordingVoice) {
            if (avgEnergy > peakVoiceEnergy) peakVoiceEnergy = avgEnergy;
            if (avgEnergy > Math.max(5.5, ambientNoiseFloor + 3.0)) lastVoiceActivityTime = now;
            if (now - lastVoiceActivityTime > 1200 || now - recordingStartTime > 11000) stopVoiceCapture();
          }
        }
      } else {
        audioIntensity = 0;
        if (vuFill) vuFill.style.width = "0%";
      }
      requestAnimationFrame(monitorVoiceActivity);
    }
    monitorVoiceActivity();
  } catch (err) {
    console.warn("[Widget] Error micrófono:", err.message);
  }
}

function setupNativeSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    hasWorkingNativeSpeech = false;
    return;
  }

  try {
    speechRecognition = new SpeechRec();
    speechRecognition.lang = "es-PE";
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;

    speechRecognition.onstart = () => { hasWorkingNativeSpeech = true; };

    speechRecognition.onresult = (event) => {
      const now = Date.now();
      if (currentState === "SPEAKING" || currentState === "THINKING" || isMutedDueToSpeaking || (now - lastSpokeEndedAt < 1400)) {
        accumulatedSpeech = "";
        return;
      }

      let currentTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        currentTranscript += event.results[i][0].transcript;
      }

      const heard = currentTranscript.trim();
      if (!heard) return;
      accumulatedSpeech = heard;

      const cap = document.getElementById("captionText");
      if (cap && currentState !== "SPEAKING" && currentState !== "THINKING") {
        cap.innerText = `"${accumulatedSpeech}..."`;
      }

      if (speechSilenceDebounceTimer) clearTimeout(speechSilenceDebounceTimer);
      speechSilenceDebounceTimer = setTimeout(() => {
        if (accumulatedSpeech && currentState !== "SPEAKING" && currentState !== "THINKING" && !isMutedDueToSpeaking) {
          const phrase = accumulatedSpeech;
          accumulatedSpeech = "";
          evaluateFinalUserPhrase(phrase);
        }
      }, 1200);
    };

    speechRecognition.onerror = (e) => {
      if (e.error === "network") hasWorkingNativeSpeech = false;
    };

    speechRecognition.onend = () => {
      if (micActive && !isMutedDueToSpeaking && currentState !== "SPEAKING" && currentState !== "THINKING") {
        try { speechRecognition.start(); } catch {}
      }
    };

    speechRecognition.start();
  } catch (err) {
    hasWorkingNativeSpeech = false;
  }
}

function startVoiceCapture() {
  if (!micStream || isRecordingVoice || isMutedDueToSpeaking) return;
  try {
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(micStream);
    isRecordingVoice = true;
    recordingStartTime = Date.now();
    lastVoiceActivityTime = Date.now();
    peakVoiceEnergy = 0;

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      isRecordingVoice = false;
      const blob = new Blob(recordedChunks, { type: "audio/webm" });
      if (Date.now() - recordingStartTime < 400 || blob.size < 1500) return;

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = String(reader.result || "").split(",")[1];
        if (base64data && ws && ws.readyState === WebSocket.OPEN && !isMutedDueToSpeaking) {
          ws.send(JSON.stringify({ type: "USER_AUDIO", audioBase64: base64data, mimeType: "audio/webm" }));
        }
      };
      reader.readAsDataURL(blob);
    };
    mediaRecorder.start(100);
  } catch (err) { isRecordingVoice = false; }
}

function stopVoiceCapture() {
  if (mediaRecorder && isRecordingVoice && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch {}
  }
  isRecordingVoice = false;
}

// ================= REPRODUCCIÓN DE VOZ ELEVENLABS =================
function playAudioVoice(audioUrl, fallbackText) {
  isMutedDueToSpeaking = true;
  if (speechRecognition) try { speechRecognition.abort(); } catch {}
  if (synth) synth.cancel();
  if (currentAudio) { try { currentAudio.pause(); } catch {} currentAudio = null; }

  const audio = new Audio(audioUrl);
  currentAudio = audio;
  setAssistantState("SPEAKING");

  audio.onended = () => {
    currentAudio = null;
    lastSpokeEndedAt = Date.now();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "CLIENT_SPEECH_FINISHED" }));
    }
    returnToStandby();
    setTimeout(() => {
      isMutedDueToSpeaking = false;
      if (speechRecognition) try { speechRecognition.start(); } catch {}
    }, 1400);
  };

  audio.onerror = () => {
    currentAudio = null;
    speakTextFallback(fallbackText);
  };

  audio.play().catch(() => speakTextFallback(fallbackText));
}

function speakTextFallback(text) {
  isMutedDueToSpeaking = true;
  if (speechRecognition) try { speechRecognition.abort(); } catch {}
  if (!synth) {
    lastSpokeEndedAt = Date.now();
    returnToStandby();
    setTimeout(() => { isMutedDueToSpeaking = false; }, 1400);
    return;
  }
  synth.cancel();

  const clean = (text || "").replace(/[*_`#]/g, "").slice(0, 320);
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "es-PE";
  utterance.rate = 1.02;

  const voices = synth.getVoices();
  const v = voices.find(vox => vox.lang.startsWith("es"));
  if (v) utterance.voice = v;

  utterance.onstart = () => setAssistantState("SPEAKING");
  utterance.onend = () => {
    lastSpokeEndedAt = Date.now();
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CLIENT_SPEECH_FINISHED" }));
    returnToStandby();
    setTimeout(() => { isMutedDueToSpeaking = false; }, 1400);
  };
  utterance.onerror = () => {
    lastSpokeEndedAt = Date.now();
    returnToStandby();
    setTimeout(() => { isMutedDueToSpeaking = false; }, 1400);
  };

  synth.speak(utterance);
}

// ================= WEBSOCKET =================
function connectWebSocket() {
  ws = new WebSocket(CONFIG.wsUrl);
  ws.onopen = () => returnToStandby();
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "STATE_CHANGE") setAssistantState(data.state);
      if (data.type === "USER_TRANSCRIPT") {
        if (!isMutedDueToSpeaking && currentState !== "SPEAKING" && currentState !== "THINKING") {
          evaluateFinalUserPhrase(data.text);
        }
      }
      if (data.type === "ASSISTANT_REPLY") {
        const text = data.text || "";
        document.getElementById("captionText").innerText = text;
        if (data.audioUrl) playAudioVoice(data.audioUrl, text);
        else speakTextFallback(text);
      }
    } catch (e) {}
  };
  ws.onclose = () => setTimeout(connectWebSocket, 3000);
}

function setAssistantState(state) {
  currentState = state;
  const status = document.getElementById("widgetStatus");
  const card = document.getElementById("widgetCard");
  if (!status || !card) return;

  if (state === "IDLE") {
    status.innerText = isAwake ? "¿SÍ?" : "REPOSO";
    card.style.borderColor = "rgba(168, 85, 247, 0.35)";
    card.style.boxShadow = "0 0 25px rgba(0, 0, 0, 0.8), 0 0 15px rgba(236, 72, 153, 0.25)";
  } else if (state === "LISTENING") {
    status.innerText = "ESCUCHANDO";
    card.style.borderColor = "rgba(244, 63, 94, 0.7)";
    card.style.boxShadow = "0 0 30px rgba(244, 63, 94, 0.4)";
  } else if (state === "THINKING") {
    status.innerText = "PROCESANDO";
    card.style.borderColor = "rgba(6, 182, 212, 0.7)";
    card.style.boxShadow = "0 0 30px rgba(6, 182, 212, 0.4)";
  } else if (state === "SPEAKING") {
    status.innerText = "HABLANDO";
    card.style.borderColor = "rgba(236, 72, 153, 0.8)";
    card.style.boxShadow = "0 0 35px rgba(236, 72, 153, 0.5)";
  }
}

// ================= INICIALIZACIÓN =================
document.addEventListener("DOMContentLoaded", () => {
  resizeCanvas();
  renderOrb();
  setupAudioAnalysis();
  connectWebSocket();

  // Tocar orbe para despertar o interrumpir
  document.getElementById("orbTouchArea")?.addEventListener("click", () => {
    if (currentState === "SPEAKING" && currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio = null;
      if (synth) synth.cancel();
      isMutedDueToSpeaking = false;
      lastSpokeEndedAt = Date.now();
      returnToStandby();
      return;
    }
    if (isAwake) returnToStandby();
    else triggerWake("¿Sí, Kirito? Te escucho...");
  });

  // Toggle teclado mini
  document.getElementById("btnToggleInput")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const drawer = document.getElementById("widgetInputDrawer");
    drawer?.classList.toggle("open");
    if (drawer?.classList.contains("open")) {
      document.getElementById("widgetInputText")?.focus();
    }
  });

  // Enviar texto mini
  const inputEl = document.getElementById("widgetInputText");
  const sendBtn = document.getElementById("btnWidgetSend");

  inputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendUserMessage(inputEl.value);
    }
  });
  sendBtn?.addEventListener("click", () => sendUserMessage(inputEl.value));

  // Pin Topmost indicador
  document.getElementById("btnTogglePin")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const btn = document.getElementById("btnTogglePin");
    btn?.classList.toggle("active");
  });
});
