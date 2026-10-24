# 🌌 NOVA — Ecosistema de Asistente IA Multimodal, Control Total de PC & App Nativa Android

**NOVA** es un ecosistema completo de inteligencia artificial personal y control remoto total para Windows (optimizado para **Lenovo LOQ — Ryzen 7 7435HS + NVIDIA RTX 4060**), conectado en tiempo real a **Gemini Web Pro (`gemini.google.com`)**, **Telegram**, un **Orbe Holográfico Flotante Nativo en Windows (C# WPF)** y una **Aplicación Móvil Nativa para Android en Kotlin + Jetpack Compose** con conexión global 4G/5G.

---

## ✨ Características Principales

### 1. 🧠 Conexión Directa a Gemini Web Pro (`gemini.google.com/app`)
- **Sincronización en Vivo con tu Cuaderno de Gemini Web**: Todas las conversaciones y acciones (desde voz en PC, app Android o Telegram) se sincronizan y guardan en tu historial oficial de Gemini Web.
- **Generación de Imágenes con Imagen 3 + Fallback Inteligente**: Crea arte e ilustraciones directamente desde tu cuenta Pro o motores de respaldo de alta resolución, enviándolas automáticamente a tu Telegram.
- **Auto-Renovación de Cookies (`Set-Cookie` Capture + Keep-Alive)**: Captura automáticamente las rotaciones de `__Secure-1PSIDTS` y mantiene viva la sesión cada 8 minutos sin requerir pegar cookies manualmente.

### 2. 📄 Fábrica Automática de Documentos y Código (Entrega Directa a Telegram)
- **Microsoft Word (`.docx`) y Redacción en Vivo (COM)**: Genera documentos estructurados y también abre Microsoft Word en tu pantalla escribiendo párrafo por párrafo en tiempo real (`writeLiveInMicrosoftWord`).
- **Documentos PDF (`.pdf`) y Presentaciones PowerPoint (`.pptx`)**: Creación instantánea con diseño profesional y envío directo a tu chat de Telegram.
- **Plantillas y Código Fuente (`.sql`, `.java`, `.py`, `.html`, `.js`)**: Genera scripts listos para usar y los entrega como archivos adjuntos en Telegram.

### 3. 💻 Control Total del PC (Windows 11 + Antigravity IDE)
- **Delegación Autónoma a Antigravity IDE**: Pídele a NOVA desde tu celular o por voz que programe o modifique un proyecto; NOVA abrirá Antigravity y despachará la orden automáticamente.
- **Descarga e Instalación de Apps (Brave + Winget)**: Instala programas silenciosamente con `winget` o abre el buscador de descargas en **Brave Browser**.
- **Actualización de Juegos (Steam & Epic Games)**: Lanza y gestiona actualizaciones de tu biblioteca en Steam y Epic Games Launcher.
- **Telemetría Hardware en Tiempo Real**: Monitoreo de CPU, GPU RTX 4060 (VRAM y temperatura), RAM y capturas de pantalla reales en 1080p.

### 4. 📱 NOVA Mobile Control — App Nativa Android (Kotlin + Jetpack Compose)
- **Estética Cyber-Luxury (v1.3)**: Paleta saturada en **Negro Abismal (`#020205`)**, **Rojo Eléctrico (`#FF0033`)** y **Azul Eléctrico (`#0055FF` / `#00C8FF`)**.
- **Orbe Holográfico 3D a 60 FPS**: Renderizado nativo en `Canvas` con anillos de energía reactivos a la voz y partículas orbitales.
- **Conexión Global 4G/5G sin depender del mismo Wi-Fi**: Túnel seguro Cloudflare (`trycloudflare.com`) con auto-descubrimiento instantáneo para controlar tu laptop desde cualquier lugar del mundo.
- **Teclado Inteligente (`adjustResize`) y Wake-Word `"Nova"`**: Modo de escucha continua manos libres o chat táctil fluido.

### 5. 🔮 Orbe Flotante Nativo para Windows (`NovaFloatingOrb.cs`)
- Widget nativo transparente en C# WPF sin bordes ni fondo que flota sobre tu escritorio y reacciona por voz al comando **"Nova"**.

---

## 🏗️ Arquitectura del Repositorio

```text
nova-ai-assistant/
├── telegram-agent.mjs             # Servidor central, Gateway WebSocket/HTTP, Bot de Telegram y Orquestador
├── NovaFloatingOrb.cs             # Orbe Holográfico Flotante Nativo para Windows (C# WPF)
├── launch-nova-floating-orb.cmd   # Lanzador del Orbe Nativo en PC
├── desktop-helper.ps1             # Capturador de pantalla física y control de ventanas Win32
├── telemetry.ps1                  # Telemetría en vivo (Ryzen 7 + RTX 4060)
├── src/
│   ├── config.mjs                 # Configuración centralizada y variables de entorno
│   ├── adapters/
│   │   ├── gemini-web-adapter.mjs # Cliente nativo Gemini Web Pro + Imagen 3 + Auto-Rotation Cookies
│   │   ├── gemini-adapter.mjs     # Adaptador oficial Google GenAI SDK
│   │   ├── claude-adapter.mjs     # Adaptador Anthropic Claude
│   │   └── openai-adapter.mjs     # Adaptador OpenAI
│   ├── router/
│   │   └── model-router.mjs       # Enrutador inteligente multi-modelo
│   └── services/
│       ├── doc-service.mjs        # Generador de Word (.docx + COM en vivo), PDF, PPTX y Código
│       ├── system-service.mjs     # Control de PC, Antigravity IDE, Brave, Winget, Steam y Epic
│       ├── image-service.mjs      # Motor híbrido de generación de imágenes
│       ├── tunnel-service.mjs     # Túnel Global Cloudflare (4G/5G auto-discovery)
│       └── tts-service.mjs        # Síntesis de voz neuronal
└── nova-android/                  # Proyecto Android Nativo (Kotlin + Jetpack Compose)
    ├── app/build.gradle.kts
    └── app/src/main/
        ├── AndroidManifest.xml
        └── java/com/kirito/nova/
            ├── MainActivity.kt
            ├── data/NovaGatewayController.kt
            ├── ui/HolographicOrbCanvas.kt
            └── ui/NovaMainScreen.kt
```

---

## 🚀 Instalación y Puesta en Marcha

### 1. Backend PC & Gateway (`telegram-bridge`)
```powershell
git clone https://github.com/kirito3006va-maker/nova-ai-assistant.git
cd nova-ai-assistant
npm install
copy .env.example .env
# Edita .env con tus credenciales de Telegram y Gemini
npm start
```

### 2. Orbe Flotante de Escritorio (Windows)
```powershell
.\launch-nova-floating-orb.cmd
```

### 3. Compilar la App Android (`nova-android`)
```powershell
cd nova-android
.\gradlew.bat assembleDebug
```
El archivo `.apk` compilado se generará en `nova-android/app/build/outputs/apk/debug/app-debug.apk`.
