package com.kirito.nova.data

enum class NovaState(val label: String) {
    IDLE("ESPERANDO 'NOVA'"),
    LISTENING("ESCUCHANDO"),
    THINKING("EJECUTANDO"),
    SPEAKING("HABLANDO")
}

data class TelemetryInfo(
    val gpuTemp: String = "-- °C",
    val gpuDetails: String = "-- W | VRAM: --",
    val cpuLoad: String = "-- %",
    val ramUsed: String = "-- / 24 GB",
    val ramPct: String = "-- %",
    val batteryPct: String = "-- %",
    val batteryState: String = "Sincronizando..."
)

data class ChatMessage(
    val id: Long = System.currentTimeMillis(),
    val sender: String,
    val text: String,
    val isNova: Boolean
)

data class ReminderItem(
    val title: String,
    val targetTime: String
)
