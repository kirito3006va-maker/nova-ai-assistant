/**
 * NOVA HOLOGRAPHIC DESKTOP ORB & HALF-DUPLEX VOICE CLIENT
 * Cyberpunk Particle Orb (Purple/Magenta Neon) • Lenovo LOQ 15ARP9
 * Turn-Taking Estricto (Escucha primero -> Ejecuta detenidamente -> Responde sin cruzarse)
 * Wake Word: "NOVA"
 */

const CONFIG = {
  particleCount: 480,
  baseRadius: 105,
  coreRadius: 44,
  wsUrl: `ws://${window.location.hostname || "127.0.0.1"}:3840`,
  colors: {
    purple: "#a855f7",
    magenta: "#ec4899",
    rose: "#f43f5e",
    cyan: "#06b6d4",
    white: "#ffffff"
  }
};

// Estados de la Asistente: IDLE | LISTENING | THINKING | SPEAKING
let currentState = "IDLE";
let audioIntensity = 0;
let micActive = true;
let isAwake = false; // ¿Nova está esperando orden tras escuchar "Nova"?
let awakeTimer = null;
let isMutedDueToSpeaking = false; // Silenciamiento total mientras Nova habla (cero ecos)
let lastSpokeEndedAt = 0;

let ws = null;
let synth = window.speechSynthesis;
let currentAudio = null;
let audioContext = null;
let analyser = null;
let dataArray = null;
let micStream = null;

// Motor de Reconocimiento Nativo en Streaming (Edge / Chrome)
let speechRecognition = null;
let hasWorkingNativeSpeech = false;
let accumulatedSpeech = "";
let speechSilenceDebounceTimer = null;

// Grabador VAD de Respaldo (Brave / Navegadores sin Web Speech API)
let mediaRecorder = null;
let recordedChunks = [];
let isRecordingVoice = false;
let recordingStartTime = 0;
let lastVoiceActivityTime = 0;
let consecutiveVoiceFrames = 0;
let peakVoiceEnergy = 0;
let ambientNoiseFloor = 4;

// ================= RENDERIZADOR DE ESFERA 3D =================
const canvas = document.getElementById("orbCanvas");
const ctx = canvas.getContext("2d");

let width, height, cx, cy;
const particles = [];

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  width = rect.width || 280;
  height = rect.height || 280;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = width / 2;
  cy = height / 2;
  CONFIG.baseRadius = Math.min(width, height) * 0.34;
  CONFIG.coreRadius = CONFIG.baseRadius * 0.42;
}

window.addEventListener("resize", resizeCanvas);

for (let i = 0; i < CONFIG.particleCount; i++) {
  const phi = Math.acos(1 - 2 * (i + 0.5) / CONFIG.particleCount);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  particles.push({
    origX: Math.cos(theta) * Math.sin(phi),
    origY: Math.sin(theta) * Math.sin(phi),
    origZ: Math.cos(phi),
    x: 0, y: 0, z: 0,
    size: Math.random() * 2.0 + 0.7,
    speed: Math.random() * 0.004 + 0.002,
    colorType: Math.random() > 0.45 ? "magenta" : (Math.random() > 0.3 ? "purple" : "cyan"),
    pulseOffset: Math.random() * Math.PI * 2
  });
}

let rotX = 0;
let rotY = 0;
let time = 0;

function renderOrb() {
  time += 0.02;
  ctx.clearRect(0, 0, width, height);

  let speedMultiplier = 1;
  let targetRadius = CONFIG.baseRadius;

  if (currentState === "IDLE") {
    speedMultiplier = isAwake ? 1.2 : 0.8;
    targetRadius = CONFIG.baseRadius + Math.sin(time * 1.5) * 4 + (audioIntensity * 12);
  } else if (currentState === "LISTENING") {
    speedMultiplier = 1.65;
    targetRadius = CONFIG.baseRadius + 18 + (audioIntensity * 32);
  } else if (currentState === "THINKING") {
    speedMultiplier = 3.2;
    targetRadius = CONFIG.baseRadius - 10 + Math.sin(time * 6) * 9;
  } else if (currentState === "SPEAKING") {
    speedMultiplier = 1.8;
    targetRadius = CONFIG.baseRadius + 16 + Math.sin(time * 4.5) * 14;
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

    const wave = Math.sin(time * 3 + p.pulseOffset) * 0.07;
    const currentR = targetRadius * (1 + wave + (currentState === "LISTENING" ? audioIntensity * 0.22 : 0));

    const scale = 340 / (340 + z2 * currentR);
    const px = cx + x1 * currentR * scale;
    const py = cy + y1 * currentR * scale;
    const alpha = Math.max(0.15, Math.min(1, (z2 + 1.2) / 2.2));

    projected.push({ x: px, y: py, z: z2, scale, alpha, colorType: p.colorType, size: p.size });
  }

  projected.sort((a, b) => a.z - b.z);

  ctx.lineWidth = 0.45;
  for (let i = 0; i < projected.length; i += 7) {
    for (let j = i + 1; j < projected.length; j += 7) {
      const p1 = projected[i];
      const p2 = projected[j];
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 36) {
        ctx.strokeStyle = `rgba(168, 85, 247, ${0.17 * (1 - dist / 36) * p1.alpha})`;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  }

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

    if (p.z > 0.3) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = col;
    } else {
      ctx.shadowBlur = 0;
    }
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  requestAnimationFrame(renderOrb);
}

// ================= TONO SUAVE DE ACTIVACIÓN (WAKE CHIME) =================
function playWakeChime() {
  try {
    const actx = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume().catch(() => {});
    const now = actx.currentTime;

    const osc = actx.createOscillator();
    const gain = actx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now); // Re (D5)
    osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.12); // La (A5)

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(actx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  } catch (e) {}
}

// ================= GESTIÓN DE TURNOS Y WAKE WORD =================
function triggerWake(promptText = "¿Sí, Kirito? Te escucho...") {
  if (currentState === "SPEAKING" || currentState === "THINKING" || isMutedDueToSpeaking) {
    return;
  }

  isAwake = true;
  playWakeChime();
  setAssistantState("LISTENING");

  const micBtn = document.getElementById("btnPushToTalk");
  const micStatus = document.getElementById("micStatusText");
  const caption = document.getElementById("captionText");

  micBtn?.classList.add("listening");
  if (micStatus) micStatus.innerText = "¿SÍ, KIRITO?";
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

  const micBtn = document.getElementById("btnPushToTalk");
  const micStatus = document.getElementById("micStatusText");
  const caption = document.getElementById("captionText");

  micBtn?.classList.remove("listening");
  if (micStatus) micStatus.innerText = "ESPERANDO 'NOVA'";
  if (caption && currentState !== "SPEAKING" && currentState !== "THINKING") {
    caption.innerText = "En reposo. Di 'Nova' para darme una orden...";
  }

  if (currentState === "LISTENING") {
    setAssistantState("IDLE");
  }
}

// Procesar el texto final solo cuando Kirito haya terminado completamente de hablar (1.2s de silencio)
function evaluateFinalUserPhrase(rawPhrase) {
  const text = (rawPhrase || "").trim();
  if (!text) return;

  const lower = text.toLowerCase();
  const hasWakeWord = /\b(?:nova|noba|nobba|noga|oye\s+nova|hola\s+nova)\b/i.test(lower);

  // Si Nova estaba en reposo y nadie dijo "Nova", ignorar conversación del cuarto
  if (!isAwake && !hasWakeWord) {
    console.log(`[WakeWord] Voz del entorno ignorada (sin 'Nova'): "${text}"`);
    return;
  }

  if (hasWakeWord) {
    let cleaned = text.replace(/\b(?:oye\s+nova|hola\s+nova|nova)\b/gi, "").trim();
    cleaned = cleaned.replace(/^[,.\s]+|[,.\s]+$/g, "");

    if (!cleaned || cleaned.length < 2) {
      // Solo llamó a "Nova" -> Despertar y escuchar la orden
      triggerWake("¿Sí, Kirito? Te escucho...");
      return;
    }

    // Dijo "Nova [orden completa]"
    playWakeChime();
    sendUserMessage(cleaned);
    return;
  }

  if (isAwake) {
    // Nova estaba despierta esperando la orden de Kirito
    sendUserMessage(text);
  }
}

function sendUserMessage(rawText) {
  const text = (rawText || "").trim();
  if (!text) return;

  // Mutear el micrófono para no escuchar su propio procesamiento
  isMutedDueToSpeaking = true;
  if (awakeTimer) clearTimeout(awakeTimer);
  if (speechSilenceDebounceTimer) clearTimeout(speechSilenceDebounceTimer);
  accumulatedSpeech = "";

  const inputElem = document.getElementById("hudInputText");
  if (inputElem) inputElem.value = "";

  addChatMessage("user", text);
  setAssistantState("THINKING");
  document.getElementById("captionText").innerText = `Procesando detenidamente: "${text}"...`;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "USER_SPEECH", text }));
  }
}

// ================= ANÁLISIS DE AUDIO & DETECCIÓN =================
async function setupAudioAnalysis() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(micStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.45;
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    const unlockAudio = () => {
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
    };
    ["click", "keydown", "focus", "mousemove", "touchstart"].forEach(evt => {
      window.addEventListener(evt, unlockAudio, { passive: true });
    });

    setupNativeSpeechRecognition();

    const vuFill = document.getElementById("micLiveVuFill");

    function monitorVoiceActivity() {
      if (analyser && micActive) {
        if (audioContext && audioContext.state === "suspended") {
          audioContext.resume().catch(() => {});
        }

        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        const startBin = 2;
        const endBin = Math.min(28, dataArray.length);
        for (let i = startBin; i < endBin; i++) {
          sum += dataArray[i];
        }
        const avgEnergy = sum / (endBin - startBin);
        audioIntensity = Math.min(1, avgEnergy / 85);

        // Medidor VU visible solo cuando Kirito puede hablar
        if (vuFill) {
          if (currentState === "SPEAKING" || currentState === "THINKING" || isMutedDueToSpeaking) {
            vuFill.style.width = "0%";
          } else {
            const pct = Math.min(100, Math.round((avgEnergy / 45) * 100));
            vuFill.style.width = `${pct}%`;
          }
        }

        const now = Date.now();
        const canListenNow = currentState !== "SPEAKING" &&
                             currentState !== "THINKING" &&
                             !isMutedDueToSpeaking &&
                             (now - lastSpokeEndedAt > 1400);

        // VAD de respaldo si no hay Web Speech API
        if (!hasWorkingNativeSpeech && canListenNow) {
          if (!isRecordingVoice) {
            ambientNoiseFloor = (ambientNoiseFloor * 0.95) + (avgEnergy * 0.05);
            const speechThreshold = Math.max(7.0, ambientNoiseFloor + 5.5);

            if (avgEnergy > speechThreshold) {
              consecutiveVoiceFrames++;
              if (consecutiveVoiceFrames >= 3) {
                startVoiceCapture();
              }
            } else {
              consecutiveVoiceFrames = Math.max(0, consecutiveVoiceFrames - 1);
            }
          } else if (isRecordingVoice) {
            if (avgEnergy > peakVoiceEnergy) peakVoiceEnergy = avgEnergy;

            const voiceActivityFloor = Math.max(5.5, ambientNoiseFloor + 3.0);
            if (avgEnergy > voiceActivityFloor) {
              lastVoiceActivityTime = now;
            }

            const silenceDuration = now - lastVoiceActivityTime;
            const totalDuration = now - recordingStartTime;

            // Cortar solo tras 1.2 segundos de silencio real
            if (silenceDuration > 1200 || totalDuration > 11000) {
              stopVoiceCapture();
            }
          }
        }
      } else {
        audioIntensity = 0;
        if (vuFill) vuFill.style.width = "0%";
      }

      requestAnimationFrame(monitorVoiceActivity);
    }

    monitorVoiceActivity();
    console.log("[VAD] Monitor de audio con half-duplex turn-taking activo.");
  } catch (err) {
    console.warn("[Audio] Error accediendo al micrófono:", err.message);
    const micStatus = document.getElementById("micStatusText");
    if (micStatus) micStatus.innerText = "MIC BLOQUEADO";
    const cap = document.getElementById("captionText");
    if (cap) {
      cap.innerHTML = `⚠️ <span style="color:#f43f5e; cursor:pointer;" onclick="setupAudioAnalysis()">Haz clic aquí para conceder permiso de micrófono</span>`;
    }
  }
}

// ================= RECONOCIMIENTO NATIVO CON DEBOUNCE (EDGE / CHROME) =================
function setupNativeSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    console.log("[NativeSpeech] Web Speech API no soportada. Usando VAD + Scribe.");
    hasWorkingNativeSpeech = false;
    return;
  }

  try {
    speechRecognition = new SpeechRec();
    speechRecognition.lang = "es-PE";
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;

    speechRecognition.onstart = () => {
      hasWorkingNativeSpeech = true;
      console.log("[NativeSpeech] Reconocimiento en streaming activo.");
    };

    speechRecognition.onresult = (event) => {
      const now = Date.now();
      // Silenciamiento estricto: SI NOVA ESTÁ HABLANDO O ENFRIANDO ECO, DESCARTAR TODO
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

      // Mostrar en pantalla lo que Kirito va diciendo mientras habla
      const cap = document.getElementById("captionText");
      if (cap && currentState !== "SPEAKING" && currentState !== "THINKING") {
        cap.innerText = `"${accumulatedSpeech}..."`;
      }

      // Reiniciar temporizador de silencio (1.2 segundos). Solo cuando Kirito termine de hablar por completo se ejecuta
      if (speechSilenceDebounceTimer) clearTimeout(speechSilenceDebounceTimer);
      speechSilenceDebounceTimer = setTimeout(() => {
        if (accumulatedSpeech && currentState !== "SPEAKING" && currentState !== "THINKING" && !isMutedDueToSpeaking) {
          const phraseToProcess = accumulatedSpeech;
          accumulatedSpeech = "";
          evaluateFinalUserPhrase(phraseToProcess);
        }
      }, 1200);
    };

    speechRecognition.onerror = (e) => {
      if (e.error === "network") {
        console.warn("[NativeSpeech] Red restringida en este navegador. Pasando a VAD + ElevenLabs.");
        hasWorkingNativeSpeech = false;
      }
    };

    speechRecognition.onend = () => {
      if (micActive && !isMutedDueToSpeaking && currentState !== "SPEAKING" && currentState !== "THINKING") {
        try { speechRecognition.start(); } catch {}
      }
    };

    speechRecognition.start();
  } catch (err) {
    console.warn("[NativeSpeech] Error al iniciar Web Speech:", err);
    hasWorkingNativeSpeech = false;
  }
}

function restartSpeechRecognitionSafely() {
  if (speechRecognition && micActive) {
    try { speechRecognition.abort(); } catch {}
    setTimeout(() => {
      try { speechRecognition.start(); } catch {}
    }, 200);
  }
}

// ================= VAD DE RESPALDO (MEDIARECORDER + ELEVENLABS SCRIBE) =================
function startVoiceCapture() {
  if (!micStream || isRecordingVoice || isMutedDueToSpeaking || currentState === "SPEAKING" || currentState === "THINKING") {
    return;
  }
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  try {
    recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    mediaRecorder = new MediaRecorder(micStream, { mimeType });
    isRecordingVoice = true;
    recordingStartTime = Date.now();
    lastVoiceActivityTime = Date.now();
    peakVoiceEnergy = 0;
    consecutiveVoiceFrames = 0;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      isRecordingVoice = false;
      const durationMs = Date.now() - recordingStartTime;
      const blob = new Blob(recordedChunks, { type: mimeType });

      if (durationMs < 400 || blob.size < 1500) return;

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = String(reader.result || "").split(",")[1];
        if (base64data && ws && ws.readyState === WebSocket.OPEN && !isMutedDueToSpeaking && currentState !== "SPEAKING") {
          ws.send(JSON.stringify({
            type: "USER_AUDIO",
            audioBase64: base64data,
            mimeType: "audio/webm"
          }));
        }
      };
      reader.readAsDataURL(blob);
    };

    mediaRecorder.start(100);
  } catch (err) {
    console.error("[VAD] Error iniciando grabación:", err);
    isRecordingVoice = false;
  }
}

function stopVoiceCapture() {
  if (mediaRecorder && isRecordingVoice && mediaRecorder.state !== "inactive") {
    try {
      mediaRecorder.stop();
    } catch {}
  }
  isRecordingVoice = false;
}

// Pulsar para hablar / interrumpir a Nova manualmente
function togglePushToTalk() {
  if (currentState === "SPEAKING" || currentAudio) {
    // Interrupción manual: corta de inmediato la voz de Nova
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio = null;
    }
    if (synth) synth.cancel();
    isMutedDueToSpeaking = false;
    lastSpokeEndedAt = Date.now();
    returnToStandby();
    return;
  }

  if (isAwake) {
    returnToStandby();
  } else {
    triggerWake("¿Sí, Kirito? Te escucho...");
  }
}

// ================= REPRODUCCIÓN DE VOZ CON SUPRESIÓN DE ECO =================
function playAudioVoice(audioUrl, fallbackText) {
  // 1. Silenciamiento radical del micrófono antes de emitir cualquier sonido
  isMutedDueToSpeaking = true;
  if (speechRecognition) {
    try { speechRecognition.abort(); } catch {}
  }
  if (mediaRecorder && isRecordingVoice) {
    try { mediaRecorder.stop(); } catch {}
    isRecordingVoice = false;
  }

  if (synth) synth.cancel();
  if (currentAudio) {
    try { currentAudio.pause(); } catch {}
    currentAudio = null;
  }

  const audio = new Audio(audioUrl);
  currentAudio = audio;
  setAssistantState("SPEAKING");

  audio.onended = () => {
    currentAudio = null;
    lastSpokeEndedAt = Date.now();

    // Notificar al backend que terminó la síntesis
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "CLIENT_SPEECH_FINISHED" }));
    }

    // Regresar serenamente a reposo esperando la siguiente orden ("Nova")
    returnToStandby();

    // Esperar 1.4s de silencio total en la habitación antes de volver a armar el micrófono
    setTimeout(() => {
      isMutedDueToSpeaking = false;
      restartSpeechRecognitionSafely();
    }, 1400);
  };

  audio.onerror = (e) => {
    console.warn("[Orb] Error en MP3, usando voz de respaldo:", e);
    currentAudio = null;
    speakTextFallback(fallbackText);
  };

  audio.play().catch(err => {
    console.warn("[Orb] Reproducción bloqueada por navegador:", err);
    speakTextFallback(fallbackText);
  });
}

function speakTextFallback(text) {
  isMutedDueToSpeaking = true;
  if (speechRecognition) {
    try { speechRecognition.abort(); } catch {}
  }

  if (!synth) {
    lastSpokeEndedAt = Date.now();
    returnToStandby();
    setTimeout(() => {
      isMutedDueToSpeaking = false;
      restartSpeechRecognitionSafely();
    }, 1400);
    return;
  }
  synth.cancel();

  const cleanSpeech = (text || "")
    .replace(/[*_`#]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .slice(0, 320);

  const utterance = new SpeechSynthesisUtterance(cleanSpeech);
  utterance.lang = "es-PE";
  utterance.rate = 1.02;
  utterance.pitch = 1.02;

  const voices = synth.getVoices();
  const bestVoice = voices.find(v => v.lang.startsWith("es") && (v.name.includes("Natural") || v.name.includes("Neural") || v.name.includes("Google") || v.name.includes("Sabina") || v.name.includes("Dalia"))) ||
                    voices.find(v => v.lang.startsWith("es"));
  if (bestVoice) utterance.voice = bestVoice;

  utterance.onstart = () => {
    setAssistantState("SPEAKING");
  };

  utterance.onend = () => {
    lastSpokeEndedAt = Date.now();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "CLIENT_SPEECH_FINISHED" }));
    }
    returnToStandby();
    setTimeout(() => {
      isMutedDueToSpeaking = false;
      restartSpeechRecognitionSafely();
    }, 1400);
  };

  utterance.onerror = () => {
    lastSpokeEndedAt = Date.now();
    returnToStandby();
    setTimeout(() => {
      isMutedDueToSpeaking = false;
      restartSpeechRecognitionSafely();
    }, 1400);
  };

  synth.speak(utterance);
}

function speakText(text, audioUrl = null) {
  const mode = document.getElementById("voiceSelect")?.value || "elevenlabs";
  if (audioUrl && mode.startsWith("elevenlabs")) {
    playAudioVoice(audioUrl, text);
  } else {
    speakTextFallback(text);
  }
}

// ================= SINCRONIZACIÓN WEBSOCKET =================
function connectWebSocket() {
  ws = new WebSocket(CONFIG.wsUrl);

  ws.onopen = () => {
    console.log("[WebSocket] Conectado con Nova Gateway.");
    returnToStandby();
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "INIT_STATE") {
        if (data.limaTime) {
          const parts = data.limaTime.split(" ");
          document.getElementById("limaClock").innerText = parts[parts.length - 1];
        }
        if (data.agenda) renderAgenda(data.agenda);
      }

      if (data.type === "STATE_CHANGE") {
        setAssistantState(data.state);
      }

      if (data.type === "USER_TRANSCRIPT") {
        const text = data.text || "";
        if (!isMutedDueToSpeaking && currentState !== "SPEAKING" && currentState !== "THINKING") {
          evaluateFinalUserPhrase(text);
        }
      }

      if (data.type === "ASSISTANT_REPLY") {
        const text = data.text || "";
        document.getElementById("captionText").innerText = text;
        addChatMessage("nova", text);
        speakText(text, data.audioUrl);
      }

      if (data.type === "TELEMETRY_UPDATE") {
        updateTelemetryUI(data.telemetry, data.limaTime);
      }

      if (data.type === "AGENDA_ALERT" || data.type === "AGENDA_PRE_ALERT") {
        if (data.speechText) speakText(data.speechText);
      }
    } catch (e) {
      console.error("[WebSocket] Error en mensaje entrante:", e);
    }
  };

  ws.onclose = () => {
    document.getElementById("statusLabel").innerText = "RECONECTANDO...";
    setTimeout(connectWebSocket, 3000);
  };
}

// ================= CONTROL DE ESTADOS DE LA ESFERA =================
function setAssistantState(state) {
  currentState = state;
  const pill = document.getElementById("statusPill");
  const label = document.getElementById("statusLabel");
  if (!pill || !label) return;

  if (state === "IDLE") {
    pill.style.borderColor = "rgba(168, 85, 247, 0.35)";
    pill.style.boxShadow = "0 0 20px rgba(168, 85, 247, 0.3)";
    label.innerText = isAwake ? "¿SÍ, KIRITO?" : "ESPERANDO 'NOVA'";
  } else if (state === "LISTENING") {
    pill.style.borderColor = "rgba(244, 63, 94, 0.7)";
    pill.style.boxShadow = "0 0 30px rgba(244, 63, 94, 0.6)";
    label.innerText = "ESCUCHANDO";
  } else if (state === "THINKING") {
    pill.style.borderColor = "rgba(6, 182, 212, 0.7)";
    pill.style.boxShadow = "0 0 30px rgba(6, 182, 212, 0.6)";
    label.innerText = "PROCESANDO";
  } else if (state === "SPEAKING") {
    pill.style.borderColor = "rgba(236, 72, 153, 0.8)";
    pill.style.boxShadow = "0 0 35px rgba(236, 72, 153, 0.7)";
    label.innerText = "HABLANDO";
  }
}

// ================= UI UPDATES (TELEMETRÍA, AGENDA Y CHAT) =================
function updateTelemetryUI(tele, limaTime) {
  if (limaTime) {
    const parts = limaTime.split(", ");
    const timeOnly = parts[parts.length - 1];
    document.getElementById("limaClock").innerText = timeOnly;
  }

  if (!tele) return;
  if (tele.gpu) {
    document.getElementById("gpuTemp").innerText = `${tele.gpu.tempCelsius} °C`;
    document.getElementById("gpuWatts").innerText = `${tele.gpu.powerWatts} W | VRAM: ${tele.gpu.vramUsedMB}MB`;
  }
  if (tele.cpu) {
    document.getElementById("cpuLoad").innerText = `${tele.cpu.loadPercent} %`;
  }
  if (tele.ram) {
    document.getElementById("ramUsed").innerText = `${tele.ram.usedGB} / ${tele.ram.totalGB} GB`;
    document.getElementById("ramPct").innerText = `${tele.ram.percent} %`;
  }
  if (tele.battery) {
    document.getElementById("batteryVal").innerText = `${tele.battery.chargePercent} %`;
    document.getElementById("batteryState").innerText = tele.battery.state;
  }
}

function renderAgenda(reminders) {
  const container = document.getElementById("agendaList");
  if (!reminders || reminders.length === 0) {
    container.innerHTML = `<div class="empty-hint">Sin recordatorios pendientes para hoy.</div>`;
    return;
  }
  container.innerHTML = reminders.map(r => `
    <div class="agenda-item">
      <span class="item-title">${r.title}</span>
      <span class="item-time">⏱️ ${r.targetLimaTime}</span>
    </div>
  `).join("");
}

function addChatMessage(role, text) {
  const log = document.getElementById("chatLog");
  if (!log) return;
  const msg = document.createElement("div");
  msg.className = `chat-msg ${role}`;
  msg.innerHTML = `
    <span class="sender">${role === "nova" ? "NOVA" : "KIRITO"}</span>
    <p>${text}</p>
  `;
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
}

// ================= EVENT LISTENERS & INICIO =================
document.addEventListener("DOMContentLoaded", () => {
  resizeCanvas();
  renderOrb();
  setupAudioAnalysis();
  connectWebSocket();

  document.getElementById("btnPushToTalk")?.addEventListener("click", togglePushToTalk);
  document.getElementById("orbTouchArea")?.addEventListener("click", togglePushToTalk);

  const inputElem = document.getElementById("hudInputText");
  const sendBtn = document.getElementById("btnSendHudText");

  inputElem?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage(inputElem.value);
    }
  });

  sendBtn?.addEventListener("click", () => {
    sendUserMessage(inputElem.value);
  });

  document.getElementById("btnToggleMic")?.addEventListener("click", () => {
    micActive = !micActive;
    const btn = document.getElementById("btnToggleMic");
    const txt = document.getElementById("btnMicText");
    const micStatus = document.getElementById("micStatusText");
    if (micActive) {
      btn?.classList.add("active");
      if (txt) txt.innerText = "🟢 Wake Word 'Nova' Activo";
      returnToStandby();
    } else {
      stopVoiceCapture();
      if (speechRecognition) {
        try { speechRecognition.stop(); } catch {}
      }
      btn?.classList.remove("active");
      if (txt) txt.innerText = "🔇 Micrófono Silenciado";
      if (micStatus) micStatus.innerText = "SILENCIADO";
      setAssistantState("IDLE");
    }
  });

  const drawer = document.getElementById("hudDrawer");
  document.getElementById("btnToggleDrawer")?.addEventListener("click", () => {
    drawer?.classList.toggle("open");
  });
  document.getElementById("btnCloseDrawer")?.addEventListener("click", () => {
    drawer?.classList.remove("open");
  });

  // Acciones Rápidas
  document.querySelectorAll(".pill-tool-btn[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const act = btn.getAttribute("data-action");
      if (act === "intranet") {
        sendUserMessage("Abre la pestaña de intranet y revisa si alguien ha subido notas");
      } else if (act === "music") {
        sendUserMessage("Pon una canción de Bob Marley en YouTube Music");
      } else if (act === "video") {
        const query = prompt("¿Qué video o link de YouTube quieres ver?", "Sword Art Online Ordinal Scale Trailer");
        if (query) {
          sendUserMessage(query.includes("http") ? query : `Pon el video de ${query} en YouTube`);
        }
      } else if (act === "discord") {
        sendUserMessage("Abre Discord en mi pantalla");
      } else if (act === "telemetry") {
        sendUserMessage("Muéstrame la telemetría y temperatura del sistema");
      }
    });
  });
});
