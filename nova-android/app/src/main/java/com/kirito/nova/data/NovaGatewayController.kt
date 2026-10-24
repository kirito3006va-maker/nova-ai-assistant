package com.kirito.nova.data

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.TimeUnit

class NovaGatewayController(private val context: Context) {

    private val prefs = context.getSharedPreferences("nova_prefs", Context.MODE_PRIVATE)
    private val mainHandler = Handler(Looper.getMainLooper())

    private val okHttpClient = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var mediaPlayer: MediaPlayer? = null
    private var tts: TextToSpeech? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private val toneGen = try {
        ToneGenerator(AudioManager.STREAM_NOTIFICATION, 75)
    } catch (_: Exception) {
        null
    }

    private val _serverAddress = MutableStateFlow(
        prefs.getString("server_address", "192.168.0.106:3840") ?: "192.168.0.106:3840"
    )
    val serverAddress: StateFlow<String> = _serverAddress.asStateFlow()

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _novaState = MutableStateFlow(NovaState.IDLE)
    val novaState: StateFlow<NovaState> = _novaState.asStateFlow()

    private val _isAwake = MutableStateFlow(false)
    val isAwake: StateFlow<Boolean> = _isAwake.asStateFlow()

    private val _wakeWordEnabled = MutableStateFlow(true)
    val wakeWordEnabled: StateFlow<Boolean> = _wakeWordEnabled.asStateFlow()

    private val _micPermissionGranted = MutableStateFlow(false)
    val micPermissionGranted: StateFlow<Boolean> = _micPermissionGranted.asStateFlow()

    private val _captionText = MutableStateFlow("En reposo. Di \"Nova\" o toca la esfera para hablar.")
    val captionText: StateFlow<String> = _captionText.asStateFlow()

    private val _limaTime = MutableStateFlow("--:--:--")
    val limaTime: StateFlow<String> = _limaTime.asStateFlow()

    private val _telemetry = MutableStateFlow(TelemetryInfo())
    val telemetry: StateFlow<TelemetryInfo> = _telemetry.asStateFlow()

    private val _chatHistory = MutableStateFlow<List<ChatMessage>>(emptyList())
    val chatHistory: StateFlow<List<ChatMessage>> = _chatHistory.asStateFlow()

    private val _reminders = MutableStateFlow<List<ReminderItem>>(emptyList())
    val reminders: StateFlow<List<ReminderItem>> = _reminders.asStateFlow()

    private val _voiceEnergy = MutableStateFlow(0f)
    val voiceEnergy: StateFlow<Float> = _voiceEnergy.asStateFlow()

    private var isMutedDueToSpeaking = false
    private var lastSpokeEndedAt = 0L
    private var isDestroyed = false
    private var pendingCommandJson: String? = null

    private val awakeTimeoutRunnable = Runnable {
        if (_isAwake.value && _novaState.value != NovaState.SPEAKING && _novaState.value != NovaState.THINKING) {
            returnToStandby()
        }
    }

    private val cloudDiscoveryUrl: String
        get() {
            val token = prefs.getString("bot_token", "YOUR_TELEGRAM_BOT_TOKEN") ?: "YOUR_TELEGRAM_BOT_TOKEN"
            return "https://api.telegram.org/bot$token/getMyShortDescription"
        }

    private val reconnectRunnable = Runnable {
        if (!isDestroyed && !_isConnected.value) {
            discoverGlobalTunnelAndConnect()
        }
    }

    init {
        initTextToSpeech()
        discoverGlobalTunnelAndConnect()
    }

    fun discoverGlobalTunnelAndConnect() {
        val req = Request.Builder().url(cloudDiscoveryUrl).build()
        okHttpClient.newCall(req).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                mainHandler.post { connectWebSocket() }
            }

            override fun onResponse(call: okhttp3.Call, response: Response) {
                try {
                    val bodyStr = response.body?.string().orEmpty()
                    val json = JSONObject(bodyStr)
                    val shortDesc = json.optJSONObject("result")?.optString("short_description").orEmpty()
                    // Formato: NOVA_TUNNEL|https://xxx.trycloudflare.com|192.168.0.106:3840
                    if (shortDesc.startsWith("NOVA_TUNNEL|")) {
                        val parts = shortDesc.split("|")
                        if (parts.size >= 2) {
                            val tunnelHost = parts[1].trim()
                                .removePrefix("https://")
                                .removePrefix("http://")
                                .trimEnd('/')
                            if (tunnelHost.isNotEmpty()) {
                                mainHandler.post {
                                    _serverAddress.value = tunnelHost
                                    prefs.edit().putString("server_address", tunnelHost).apply()
                                    connectWebSocket()
                                }
                                return
                            }
                        }
                    }
                } catch (_: Exception) {}
                mainHandler.post { connectWebSocket() }
            }
        })
    }

    private fun isSecureCloudHost(addr: String): Boolean {
        return addr.contains(".trycloudflare.com", ignoreCase = true) ||
            addr.contains(".ngrok", ignoreCase = true) ||
            addr.startsWith("https://", ignoreCase = true) ||
            addr.startsWith("wss://", ignoreCase = true)
    }

    private fun buildWsUrl(addr: String): String {
        val clean = addr.trim()
            .removePrefix("https://")
            .removePrefix("http://")
            .removePrefix("wss://")
            .removePrefix("ws://")
            .trimEnd('/')
        return if (isSecureCloudHost(addr)) "wss://$clean" else "ws://$clean"
    }

    private fun buildHttpBaseUrl(addr: String): String {
        val clean = addr.trim()
            .removePrefix("https://")
            .removePrefix("http://")
            .removePrefix("wss://")
            .removePrefix("ws://")
            .trimEnd('/')
        return if (isSecureCloudHost(addr)) "https://$clean" else "http://$clean"
    }

    fun onMicPermissionResult(granted: Boolean) {
        _micPermissionGranted.value = granted
        if (granted) {
            mainHandler.post {
                initSpeechRecognizer()
                startListeningLoop()
            }
        } else {
            _captionText.value = "Permiso de micrófono requerido para comandos por voz."
        }
    }

    fun updateServerAddress(newAddress: String) {
        val cleaned = newAddress.trim()
            .removePrefix("http://")
            .removePrefix("https://")
            .removePrefix("ws://")
            .removePrefix("wss://")
            .trimEnd('/')
        if (cleaned.isNotEmpty()) {
            _serverAddress.value = cleaned
            prefs.edit().putString("server_address", cleaned).apply()
            connectWebSocket()
        }
    }

    fun setWakeWordMode(enabled: Boolean) {
        _wakeWordEnabled.value = enabled
        if (enabled) {
            returnToStandby()
            startListeningLoop()
        } else {
            _isAwake.value = false
            _novaState.value = NovaState.IDLE
            _captionText.value = "Modo manual: toca la esfera cuando quieras hablar."
            stopListeningRecognizer()
        }
    }

    fun connectWebSocket() {
        try {
            webSocket?.cancel()
        } catch (_: Exception) {}

        val addr = _serverAddress.value
        val wsUrl = buildWsUrl(addr)

        val request = try {
            Request.Builder().url(wsUrl).build()
        } catch (e: Exception) {
            _captionText.value = "Dirección IP inválida: $addr"
            return
        }

        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                mainHandler.post {
                    _isConnected.value = true
                    val pending = pendingCommandJson
                    if (pending != null) {
                        pendingCommandJson = null
                        webSocket.send(pending)
                    } else if (_novaState.value == NovaState.IDLE) {
                        val label = if (addr.contains("trycloudflare.com")) "Nube Global 4G/5G" else addr
                        _captionText.value = "Conectada a tu Lenovo LOQ ($label). Di \"Nova\" o toca la esfera."
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                mainHandler.post {
                    handleIncomingGatewayJson(text)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                mainHandler.post {
                    _isConnected.value = false
                    mainHandler.removeCallbacks(reconnectRunnable)
                    mainHandler.postDelayed(reconnectRunnable, 3500)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                mainHandler.post {
                    _isConnected.value = false
                    mainHandler.removeCallbacks(reconnectRunnable)
                    mainHandler.postDelayed(reconnectRunnable, 3500)
                }
            }
        })
    }

    private fun handleIncomingGatewayJson(rawJson: String) {
        try {
            val obj = JSONObject(rawJson)
            when (obj.optString("type")) {
                "INIT_STATE" -> {
                    val lt = obj.optString("limaTime", "")
                    if (lt.isNotEmpty()) {
                        _limaTime.value = lt.substringAfterLast(",").trim()
                    }
                    val agArr = obj.optJSONArray("agenda")
                    if (agArr != null) {
                        val list = mutableListOf<ReminderItem>()
                        for (i in 0 until agArr.length()) {
                            val item = agArr.getJSONObject(i)
                            list.add(
                                ReminderItem(
                                    title = item.optString("title", "Recordatorio"),
                                    targetTime = item.optString("targetLimaTime", "")
                                )
                            )
                        }
                        _reminders.value = list
                    }
                }

                "STATE_CHANGE" -> {
                    when (obj.optString("state")) {
                        "THINKING" -> _novaState.value = NovaState.THINKING
                        "SPEAKING" -> _novaState.value = NovaState.SPEAKING
                        "LISTENING" -> _novaState.value = NovaState.LISTENING
                        "IDLE" -> if (!isMutedDueToSpeaking) _novaState.value = NovaState.IDLE
                    }
                }

                "TELEMETRY_UPDATE" -> {
                    val lt = obj.optString("limaTime", "")
                    if (lt.isNotEmpty()) {
                        _limaTime.value = lt.substringAfterLast(",").trim()
                    }
                    val tele = obj.optJSONObject("telemetry")
                    if (tele != null) {
                        val gpu = tele.optJSONObject("gpu")
                        val cpu = tele.optJSONObject("cpu")
                        val ram = tele.optJSONObject("ram")
                        val bat = tele.optJSONObject("battery")

                        _telemetry.value = TelemetryInfo(
                            gpuTemp = "${gpu?.optInt("tempCelsius", 0) ?: 0} °C",
                            gpuDetails = "${gpu?.optDouble("powerWatts", 0.0) ?: 0.0} W | VRAM: ${gpu?.optInt("vramUsedMB", 0) ?: 0} MB",
                            cpuLoad = "${cpu?.optInt("loadPercent", 0) ?: 0} %",
                            ramUsed = "${ram?.optDouble("usedGB", 0.0) ?: 0.0} / ${ram?.optInt("totalGB", 24) ?: 24} GB",
                            ramPct = "${ram?.optInt("percent", 0) ?: 0} %",
                            batteryPct = "${bat?.optInt("chargePercent", 100) ?: 100} %",
                            batteryState = bat?.optString("state", "AC") ?: "AC"
                        )
                    }
                }

                "ASSISTANT_REPLY" -> {
                    val replyText = obj.optString("text", "")
                    val audioUrl = obj.optString("audioUrl", "")
                    if (replyText.isNotEmpty()) {
                        _captionText.value = replyText
                        appendChatMessage("NOVA", replyText, isNova = true)
                    }
                    playAssistantVoice(replyText, audioUrl)
                }

                "AGENDA_ALERT", "AGENDA_PRE_ALERT" -> {
                    val speechText = obj.optString("speechText", "")
                    if (speechText.isNotEmpty()) {
                        _captionText.value = speechText
                        appendChatMessage("NOVA", speechText, isNova = true)
                        playAssistantVoice(speechText, "")
                    }
                }
            }
        } catch (_: Exception) {}
    }

    private fun appendChatMessage(sender: String, text: String, isNova: Boolean) {
        val updated = (_chatHistory.value + ChatMessage(sender = sender, text = text, isNova = isNova)).takeLast(40)
        _chatHistory.value = updated
    }

    fun sendUserCommand(rawText: String) {
        val text = rawText.trim()
        if (text.isEmpty()) return

        isMutedDueToSpeaking = true
        mainHandler.removeCallbacks(awakeTimeoutRunnable)
        stopListeningRecognizer()

        appendChatMessage("KIRITO", text, isNova = false)
        _novaState.value = NovaState.THINKING
        _captionText.value = "Ejecutando en tu laptop: \"$text\"..."

        val payload = JSONObject().apply {
            put("type", "USER_SPEECH")
            put("text", text)
        }
        if (_isConnected.value && webSocket != null) {
            webSocket?.send(payload.toString())
        } else {
            pendingCommandJson = payload.toString()
            _captionText.value = "Sincronizando túnel global y enviando: \"$text\"..."
            discoverGlobalTunnelAndConnect()
        }
    }

    fun toggleOrbTap() {
        if (_novaState.value == NovaState.SPEAKING || isMutedDueToSpeaking) {
            stopCurrentAudioPlayback()
            return
        }

        if (_isAwake.value && _novaState.value == NovaState.LISTENING) {
            returnToStandby()
        } else {
            triggerWake("¿Sí, Kirito? Te escucho...")
        }
    }

    private fun triggerWake(prompt: String = "¿Sí, Kirito? Te escucho...") {
        if (isMutedDueToSpeaking) return
        _isAwake.value = true
        _novaState.value = NovaState.LISTENING
        _captionText.value = prompt
        playWakeChime()

        mainHandler.removeCallbacks(awakeTimeoutRunnable)
        mainHandler.postDelayed(awakeTimeoutRunnable, 9000)

        startListeningLoop()
    }

    private fun returnToStandby() {
        _isAwake.value = false
        mainHandler.removeCallbacks(awakeTimeoutRunnable)
        if (_novaState.value == NovaState.LISTENING) {
            _novaState.value = NovaState.IDLE
        }
        _captionText.value = if (_wakeWordEnabled.value) {
            "En reposo. Di \"Nova\" o toca la esfera para darme una orden."
        } else {
            "Toca la esfera central para hablar con Nova."
        }

        if (_wakeWordEnabled.value && !isMutedDueToSpeaking) {
            startListeningLoop()
        }
    }

    private fun playWakeChime() {
        try {
            toneGen?.startTone(ToneGenerator.TONE_PROP_ACK, 160)
        } catch (_: Exception) {}
    }

    // ================= VOZ HUMANA ELEVENLABS + FALLBACK ANDROID TTS =================
    private fun playAssistantVoice(text: String, relativeAudioUrl: String) {
        isMutedDueToSpeaking = true
        stopListeningRecognizer()
        _novaState.value = NovaState.SPEAKING

        if (relativeAudioUrl.isNotBlank() && relativeAudioUrl != "null") {
            val addr = _serverAddress.value
            val fullAudioUrl = if (relativeAudioUrl.startsWith("http")) {
                relativeAudioUrl
            } else {
                "${buildHttpBaseUrl(addr)}$relativeAudioUrl"
            }

            try {
                mediaPlayer?.release()
                mediaPlayer = MediaPlayer().apply {
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    setDataSource(fullAudioUrl)
                    setOnPreparedListener { mp ->
                        mp.start()
                    }
                    setOnCompletionListener {
                        onSpeechPlaybackFinished()
                    }
                    setOnErrorListener { _, _, _ ->
                        speakFallbackTts(text)
                        true
                    }
                    prepareAsync()
                }
                return
            } catch (_: Exception) {
                speakFallbackTts(text)
                return
            }
        }

        speakFallbackTts(text)
    }

    private fun speakFallbackTts(text: String) {
        val engine = tts
        if (engine == null || text.isBlank()) {
            onSpeechPlaybackFinished()
            return
        }
        val cleanText = text.replace(Regex("[*_`#]"), "").take(320)
        engine.speak(cleanText, TextToSpeech.QUEUE_FLUSH, null, "nova_utt_${System.currentTimeMillis()}")
    }

    private fun onSpeechPlaybackFinished() {
        mainHandler.post {
            lastSpokeEndedAt = System.currentTimeMillis()
            val finMsg = JSONObject().apply { put("type", "CLIENT_SPEECH_FINISHED") }
            webSocket?.send(finMsg.toString())

            // Pausa de 1.3s para disipar el eco acústico antes de reactivar el micrófono
            mainHandler.postDelayed({
                isMutedDueToSpeaking = false
                _novaState.value = NovaState.IDLE
                returnToStandby()
            }, 1300)
        }
    }

    private fun stopCurrentAudioPlayback() {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
        } catch (_: Exception) {}
        mediaPlayer = null
        try {
            tts?.stop()
        } catch (_: Exception) {}

        isMutedDueToSpeaking = false
        lastSpokeEndedAt = System.currentTimeMillis()
        val finMsg = JSONObject().apply { put("type", "CLIENT_SPEECH_FINISHED") }
        webSocket?.send(finMsg.toString())
        returnToStandby()
    }

    private fun initTextToSpeech() {
        tts = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale("es", "PE")
                tts?.setSpeechRate(1.03f)
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) {
                        onSpeechPlaybackFinished()
                    }
                    override fun onError(utteranceId: String?) {
                        onSpeechPlaybackFinished()
                    }
                })
            }
        }
    }

    // ================= RECONOCIMIENTO DE VOZ NATIVO ANDROID =================
    private fun initSpeechRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) return
        try {
            speechRecognizer?.destroy()
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {}
                    override fun onBeginningOfSpeech() {}

                    override fun onRmsChanged(rmsdB: Float) {
                        if (isMutedDueToSpeaking || _novaState.value == NovaState.SPEAKING) {
                            _voiceEnergy.value = 0f
                        } else {
                            val normalized = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
                            _voiceEnergy.value = normalized
                        }
                    }

                    override fun onBufferReceived(buffer: ByteArray?) {}

                    override fun onEndOfSpeech() {
                        _voiceEnergy.value = 0f
                    }

                    override fun onError(error: Int) {
                        _voiceEnergy.value = 0f
                        // Reiniciar escucha continua si está en modo Wake Word o si está despierta
                        mainHandler.postDelayed({
                            if (!isDestroyed && !isMutedDueToSpeaking && (_wakeWordEnabled.value || _isAwake.value)) {
                                startListeningLoop()
                            }
                        }, 650)
                    }

                    override fun onResults(results: Bundle?) {
                        _voiceEnergy.value = 0f
                        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val heard = matches?.firstOrNull()?.trim() ?: ""
                        if (heard.isNotEmpty()) {
                            evaluateRecognizedSpeech(heard)
                        } else if (_wakeWordEnabled.value && !isMutedDueToSpeaking) {
                            startListeningLoop()
                        }
                    }

                    override fun onPartialResults(partialResults: Bundle?) {
                        val partial = partialResults
                            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            ?.firstOrNull()?.trim() ?: ""
                        if (partial.isNotEmpty() && _isAwake.value && !isMutedDueToSpeaking) {
                            _captionText.value = "\"$partial...\""
                        }
                    }

                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
            }
        } catch (_: Exception) {}
    }

    private fun evaluateRecognizedSpeech(rawPhrase: String) {
        if (isMutedDueToSpeaking || (System.currentTimeMillis() - lastSpokeEndedAt < 1200)) {
            return
        }

        val text = rawPhrase.trim()
        val lower = text.lowercase(Locale.getDefault())
        val wakeRegex = Regex("\\b(nova|noba|nobba|noga|oye\\s+nova|hola\\s+nova)\\b", RegexOption.IGNORE_CASE)
        val hasWakeWord = wakeRegex.containsMatchIn(lower)

        if (!_isAwake.value && !hasWakeWord) {
            // En reposo y sin decir "Nova": ignorar conversación ambiental y seguir vigilando
            if (_wakeWordEnabled.value) {
                startListeningLoop()
            }
            return
        }

        if (hasWakeWord) {
            val cleaned = text.replace(wakeRegex, "").trim().trim(',', '.', ' ')
            if (cleaned.length < 2) {
                // Solo dijo "Nova" -> despertar y esperar orden
                triggerWake("¿Sí, Kirito? Te escucho...")
                return
            }
            // Dijo "Nova [orden completa]" -> ejecutar de inmediato
            playWakeChime()
            sendUserCommand(cleaned)
            return
        }

        if (_isAwake.value) {
            sendUserCommand(text)
        }
    }

    private fun startListeningLoop() {
        if (!_micPermissionGranted.value || isMutedDueToSpeaking || isDestroyed) return
        if (_novaState.value == NovaState.SPEAKING || _novaState.value == NovaState.THINKING) return

        mainHandler.post {
            try {
                if (speechRecognizer == null) {
                    initSpeechRecognizer()
                }
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-PE")
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                }
                speechRecognizer?.cancel()
                speechRecognizer?.startListening(intent)
            } catch (_: Exception) {}
        }
    }

    private fun stopListeningRecognizer() {
        mainHandler.post {
            try {
                speechRecognizer?.cancel()
            } catch (_: Exception) {}
            _voiceEnergy.value = 0f
        }
    }

    fun destroy() {
        isDestroyed = true
        mainHandler.removeCallbacksAndMessages(null)
        try { webSocket?.cancel() } catch (_: Exception) {}
        try { mediaPlayer?.release() } catch (_: Exception) {}
        try { tts?.shutdown() } catch (_: Exception) {}
        try { speechRecognizer?.destroy() } catch (_: Exception) {}
        try { toneGen?.release() } catch (_: Exception) {}
    }
}
