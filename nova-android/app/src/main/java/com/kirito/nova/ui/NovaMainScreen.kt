package com.kirito.nova.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kirito.nova.data.ChatMessage
import com.kirito.nova.data.NovaGatewayController
import com.kirito.nova.data.NovaState
import com.kirito.nova.data.TelemetryInfo

// Paleta Ultra-Saturada: Negro Abismal + Rojo Eléctrico + Azul Eléctrico
private val BgDeep = Color(0xFF020205)
private val BgPanel = Color(0xFF070913)
private val CrimsonRed = Color(0xFFFF0033)
private val HotCrimson = Color(0xFFFF2A55)
private val ElectricBlue = Color(0xFF0055FF)
private val LightningBlue = Color(0xFF00C8FF)
private val NeonGreen = Color(0xFF00E676)
private val TextMain = Color(0xFFF8FAFC)
private val TextDim = Color(0xFF8A99AD)

@Composable
fun NovaMainScreen(
    controller: NovaGatewayController,
    onRequestMicPermission: () -> Unit
) {
    val isConnected by controller.isConnected.collectAsState()
    val serverAddress by controller.serverAddress.collectAsState()
    val novaState by controller.novaState.collectAsState()
    val isAwake by controller.isAwake.collectAsState()
    val wakeWordEnabled by controller.wakeWordEnabled.collectAsState()
    val micPermissionGranted by controller.micPermissionGranted.collectAsState()
    val captionText by controller.captionText.collectAsState()
    val limaTime by controller.limaTime.collectAsState()
    val telemetry by controller.telemetry.collectAsState()
    val chatHistory by controller.chatHistory.collectAsState()
    val voiceEnergy by controller.voiceEnergy.collectAsState()

    var inputText by remember { mutableStateOf("") }
    var selectedTab by remember { mutableIntStateOf(0) } // 0: Chat, 1: Telemetría
    var showServerDialog by remember { mutableStateOf(false) }
    var showYouTubeDialog by remember { mutableStateOf(false) }

    val focusManager = LocalFocusManager.current
    val density = LocalDensity.current
    val isKeyboardOpen = WindowInsets.ime.getBottom(density) > 0

    val shortConnectionLabel = remember(serverAddress) {
        if (serverAddress.contains("trycloudflare.com", ignoreCase = true)) {
            "NUBE GLOBAL 4G/5G"
        } else {
            serverAddress
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgDeep)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
    ) {
        // ================= CABECERA COMPACTA HUD (ROJO + AZUL ELÉCTRICO) =================
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(BgPanel)
                .border(0.8.dp, ElectricBlue.copy(alpha = 0.45f))
                .padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(end = 8.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(if (isConnected) NeonGreen else CrimsonRed)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "N.O.V.A.",
                        color = CrimsonRed,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 15.sp,
                        letterSpacing = 1.2.sp
                    )
                    Spacer(modifier = Modifier.width(7.dp))
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(
                                if (isAwake || novaState == NovaState.LISTENING)
                                    CrimsonRed.copy(alpha = 0.22f)
                                else
                                    ElectricBlue.copy(alpha = 0.22f)
                            )
                            .border(
                                1.dp,
                                if (isAwake || novaState == NovaState.LISTENING) CrimsonRed else ElectricBlue,
                                RoundedCornerShape(8.dp)
                            )
                            .padding(horizontal = 7.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = when {
                                !isConnected -> "SIN CONEXIÓN"
                                novaState == NovaState.IDLE && isAwake -> "¿SÍ, KIRITO?"
                                else -> novaState.label
                            },
                            color = if (isAwake || novaState == NovaState.LISTENING) HotCrimson else LightningBlue,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1
                        )
                    }
                }
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = "LOQ • $shortConnectionLabel",
                    color = TextDim,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 9.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "LIMA",
                        color = LightningBlue,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 8.sp
                    )
                    Text(
                        text = limaTime,
                        color = TextMain,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                        maxLines = 1
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(ElectricBlue.copy(alpha = 0.22f))
                        .border(1.dp, ElectricBlue, RoundedCornerShape(8.dp))
                        .clickable { showServerDialog = true }
                        .padding(horizontal = 8.dp, vertical = 5.dp)
                ) {
                    Text(
                        text = "⚙️ RED",
                        color = TextMain,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        // ================= SECCIÓN SUPERIOR COLAPSABLE AL ABRIR EL TECLADO =================
        AnimatedVisibility(visible = !isKeyboardOpen) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp, bottom = 2.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                HolographicOrbCanvas(
                    state = novaState,
                    isAwake = isAwake,
                    voiceEnergy = voiceEnergy,
                    onOrbClick = {
                        if (!micPermissionGranted) {
                            onRequestMicPermission()
                        } else {
                            controller.toggleOrbTap()
                        }
                    },
                    modifier = Modifier.size(172.dp)
                )

                // Barra VU de Nivel de Voz + Interruptor Wake Word
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = if (isAwake) "🎙️ ACTIVO" else "🎙️ MIC",
                            color = if (isAwake) CrimsonRed else LightningBlue,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 10.sp
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Box(
                            modifier = Modifier
                                .width(85.dp)
                                .height(6.dp)
                                .clip(RoundedCornerShape(3.dp))
                                .background(Color.White.copy(alpha = 0.12f))
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxHeight()
                                    .fillMaxWidth(voiceEnergy.coerceIn(0.05f, 1f))
                                    .background(
                                        Brush.horizontalGradient(
                                            listOf(ElectricBlue, LightningBlue, CrimsonRed)
                                        )
                                    )
                            )
                        }
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "Wake \"Nova\"",
                            color = TextMain,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 10.sp
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Switch(
                            checked = wakeWordEnabled,
                            onCheckedChange = { enabled ->
                                if (!micPermissionGranted && enabled) {
                                    onRequestMicPermission()
                                }
                                controller.setWakeWordMode(enabled)
                            },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = Color.White,
                                checkedTrackColor = CrimsonRed,
                                uncheckedThumbColor = TextDim,
                                uncheckedTrackColor = BgPanel
                            )
                        )
                    }
                }

                // Subtítulo Dinámico de Respuesta
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 3.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(BgPanel)
                        .border(1.dp, ElectricBlue.copy(alpha = 0.45f), RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = captionText,
                        color = TextMain,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                // ================= ACCIONES RÁPIDAS PARA CONTROLAR LA LAPTOP =================
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    QuickActionButton("💬 Discord") {
                        controller.sendUserCommand("Abre Discord en mi pantalla")
                    }
                    QuickActionButton("🎬 YouTube") {
                        showYouTubeDialog = true
                    }
                    QuickActionButton("📸 Captura") {
                        controller.sendUserCommand("Mándame una captura de pantalla")
                    }
                    QuickActionButton("🎮 Steam Updates") {
                        controller.sendUserCommand("Revisa y actualiza las descargas de Steam")
                    }
                    QuickActionButton("🚀 Antigravity") {
                        controller.sendUserCommand("Abre Antigravity en mi laptop")
                    }
                    QuickActionButton("📄 Abrir Word") {
                        controller.sendUserCommand("Abre Microsoft Word")
                    }
                    QuickActionButton("🎵 Música") {
                        controller.sendUserCommand("Pon una canción de Bob Marley en YouTube Music")
                    }
                    QuickActionButton("🔊 Vol +") {
                        controller.sendUserCommand("Sube el volumen")
                    }
                    QuickActionButton("🔉 Vol -") {
                        controller.sendUserCommand("Baja el volumen")
                    }
                    QuickActionButton("💻 VS Code") {
                        controller.sendUserCommand("Abre VS Code")
                    }
                    QuickActionButton("🌐 Intranet") {
                        controller.sendUserCommand("Abre la pestaña de intranet y revisa si alguien ha subido notas")
                    }
                    QuickActionButton("🔒 Bloquear PC") {
                        controller.sendUserCommand("Bloquea la pantalla de mi laptop")
                    }
                }
            }
        }

        // ================= PESTAÑAS: CHAT VS TELEMETRÍA =================
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            TabPillButton(
                title = "💬 Chat & Órdenes",
                selected = selectedTab == 0,
                onClick = { selectedTab = 0 },
                modifier = Modifier.weight(1f)
            )
            TabPillButton(
                title = "⚡ Telemetría RTX 4060",
                selected = selectedTab == 1,
                onClick = { selectedTab = 1 },
                modifier = Modifier.weight(1f)
            )
        }

        // ================= CONTENIDO DE PESTAÑA ACTIVA =================
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 2.dp)
        ) {
            if (selectedTab == 0) {
                ChatHistoryPanel(chatHistory = chatHistory)
            } else {
                TelemetryPanel(telemetry = telemetry)
            }
        }

        // ================= BARRA INFERIOR DE TEXTO DIRECTO (FIJA SOBRE EL TECLADO) =================
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(BgPanel)
                .border(0.8.dp, ElectricBlue.copy(alpha = 0.5f))
                .padding(horizontal = 10.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .clip(CircleShape)
                    .background(if (isAwake) CrimsonRed.copy(alpha = 0.3f) else ElectricBlue.copy(alpha = 0.25f))
                    .border(1.5.dp, if (isAwake) CrimsonRed else ElectricBlue, CircleShape)
                    .clickable {
                        if (!micPermissionGranted) {
                            onRequestMicPermission()
                        } else {
                            controller.toggleOrbTap()
                        }
                    },
                contentAlignment = Alignment.Center
            ) {
                Text(text = "🎙️", fontSize = 17.sp)
            }

            Spacer(modifier = Modifier.width(8.dp))

            OutlinedTextField(
                value = inputText,
                onValueChange = { inputText = it },
                placeholder = {
                    Text(
                        text = "Escribe una orden para tu laptop...",
                        color = TextDim,
                        fontSize = 13.sp
                    )
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(
                    onSend = {
                        if (inputText.isNotBlank()) {
                            controller.sendUserCommand(inputText)
                            inputText = ""
                            focusManager.clearFocus()
                        }
                    }
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = TextMain,
                    unfocusedTextColor = TextMain,
                    focusedBorderColor = CrimsonRed,
                    unfocusedBorderColor = ElectricBlue.copy(alpha = 0.65f),
                    cursorColor = CrimsonRed
                ),
                shape = RoundedCornerShape(22.dp),
                modifier = Modifier.weight(1f)
            )

            Spacer(modifier = Modifier.width(8.dp))

            Button(
                onClick = {
                    if (inputText.isNotBlank()) {
                        controller.sendUserCommand(inputText)
                        inputText = ""
                        focusManager.clearFocus()
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = CrimsonRed),
                shape = RoundedCornerShape(20.dp)
            ) {
                Text(
                    text = "Enviar",
                    color = Color.White,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 12.sp
                )
            }
        }
    }

    // ================= MODAL DE CONFIGURACIÓN DE RED / NUBE =================
    if (showServerDialog) {
        var tempAddr by remember { mutableStateOf(serverAddress) }
        AlertDialog(
            onDismissRequest = { showServerDialog = false },
            containerColor = BgPanel,
            titleContentColor = CrimsonRed,
            textContentColor = TextMain,
            title = {
                Text(
                    text = "Conexión Global con tu Lenovo LOQ",
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp
                )
            },
            text = {
                Column {
                    Text(
                        text = "Túnel Global activo o IP local de tu laptop:",
                        color = TextDim,
                        fontSize = 12.sp
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = tempAddr,
                        onValueChange = { tempAddr = it },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextMain,
                            unfocusedTextColor = TextMain,
                            focusedBorderColor = LightningBlue,
                            unfocusedBorderColor = ElectricBlue
                        )
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Button(
                        onClick = {
                            controller.discoverGlobalTunnelAndConnect()
                            showServerDialog = false
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = ElectricBlue)
                    ) {
                        Text(
                            "🌍 Auto-Sincronizar Nube Global (4G/5G/Wi-Fi)",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        controller.updateServerAddress(tempAddr)
                        showServerDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CrimsonRed)
                ) {
                    Text("Guardar y Conectar", color = Color.White, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showServerDialog = false }) {
                    Text("Cancelar", color = TextDim)
                }
            }
        )
    }

    // ================= MODAL RÁPIDO DE YOUTUBE =================
    if (showYouTubeDialog) {
        var ytQuery by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showYouTubeDialog = false },
            containerColor = BgPanel,
            titleContentColor = LightningBlue,
            textContentColor = TextMain,
            title = {
                Text(
                    text = "🎬 Reproducir YouTube en Laptop",
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp
                )
            },
            text = {
                Column {
                    Text(
                        text = "Escribe el nombre del video o pega el enlace de YouTube para abrirlo en la pantalla de tu laptop:",
                        color = TextDim,
                        fontSize = 12.sp
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = ytQuery,
                        onValueChange = { ytQuery = it },
                        placeholder = { Text("Ej: Sword Art Online Opening o link...", color = TextDim, fontSize = 12.sp) },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextMain,
                            unfocusedTextColor = TextMain,
                            focusedBorderColor = CrimsonRed,
                            unfocusedBorderColor = ElectricBlue
                        )
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (ytQuery.isNotBlank()) {
                            val cmd = if (ytQuery.contains("http")) {
                                ytQuery.trim()
                            } else {
                                "Pon el video de ${ytQuery.trim()} en YouTube"
                            }
                            controller.sendUserCommand(cmd)
                        }
                        showYouTubeDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CrimsonRed)
                ) {
                    Text("Reproducir en PC", color = Color.White, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showYouTubeDialog = false }) {
                    Text("Cancelar", color = TextDim)
                }
            }
        )
    }
}

@Composable
private fun QuickActionButton(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(ElectricBlue.copy(alpha = 0.16f))
            .border(1.dp, ElectricBlue.copy(alpha = 0.75f), RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp)
    ) {
        Text(
            text = label,
            color = TextMain,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun TabPillButton(
    title: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) CrimsonRed.copy(alpha = 0.25f) else BgPanel)
            .border(
                width = 1.2.dp,
                color = if (selected) CrimsonRed else ElectricBlue.copy(alpha = 0.45f),
                shape = RoundedCornerShape(10.dp)
            )
            .clickable(onClick = onClick)
            .padding(vertical = 7.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = title,
            color = if (selected) TextMain else TextDim,
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.ExtraBold else FontWeight.Medium
        )
    }
}

@Composable
private fun ChatHistoryPanel(chatHistory: List<ChatMessage>) {
    val listState = rememberLazyListState()
    LaunchedEffect(chatHistory.size) {
        if (chatHistory.isNotEmpty()) {
            listState.animateScrollToItem(chatHistory.size - 1)
        }
    }

    if (chatHistory.isEmpty()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(12.dp))
                .background(BgPanel)
                .border(1.dp, ElectricBlue.copy(alpha = 0.3f), RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "Sin mensajes aún. Di \"Nova, abre Discord\" o toca un botón rápido arriba.",
                color = TextDim,
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(20.dp)
            )
        }
    } else {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(12.dp))
                .background(BgPanel)
                .border(1.dp, ElectricBlue.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
                .padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(chatHistory, key = { it.id }) { msg ->
                val bgColor = if (msg.isNova) CrimsonRed.copy(alpha = 0.16f) else ElectricBlue.copy(alpha = 0.20f)
                val borderCol = if (msg.isNova) CrimsonRed.copy(alpha = 0.75f) else LightningBlue.copy(alpha = 0.75f)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(bgColor)
                        .border(1.dp, borderCol, RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                ) {
                    Text(
                        text = msg.sender,
                        color = if (msg.isNova) HotCrimson else LightningBlue,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 10.sp
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = msg.text,
                        color = TextMain,
                        fontSize = 13.sp,
                        lineHeight = 17.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun TelemetryPanel(telemetry: TelemetryInfo) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            TelemetryCard(
                title = "GPU RTX 4060",
                value = telemetry.gpuTemp,
                sub = telemetry.gpuDetails,
                accent = CrimsonRed,
                modifier = Modifier.weight(1f)
            )
            TelemetryCard(
                title = "CPU RYZEN 7",
                value = telemetry.cpuLoad,
                sub = "7435HS (8C/16T)",
                accent = LightningBlue,
                modifier = Modifier.weight(1f)
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            TelemetryCard(
                title = "RAM DDR5",
                value = telemetry.ramUsed,
                sub = "Uso: ${telemetry.ramPct}",
                accent = ElectricBlue,
                modifier = Modifier.weight(1f)
            )
            TelemetryCard(
                title = "ENERGÍA / BATERÍA",
                value = telemetry.batteryPct,
                sub = telemetry.batteryState,
                accent = NeonGreen,
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun TelemetryCard(
    title: String,
    value: String,
    sub: String,
    accent: Color,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(BgPanel)
            .border(1.2.dp, accent.copy(alpha = 0.65f), RoundedCornerShape(12.dp))
            .padding(12.dp)
    ) {
        Text(
            text = title,
            color = TextDim,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            fontSize = 10.sp
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = value,
            color = accent,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 17.sp
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = sub,
            color = TextDim,
            fontSize = 11.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}
