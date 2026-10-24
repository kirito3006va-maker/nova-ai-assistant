Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Drawing, System.Speech

[System.Windows.Forms.Application]::EnableVisualStyles()

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Nova Floating Orb"
        Width="160" Height="180"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        Topmost="True"
        ShowInTaskbar="False"
        WindowStartupLocation="Manual">
    <Window.Resources>
        <Storyboard x:Key="SpinRing" RepeatBehavior="Forever">
            <DoubleAnimation Storyboard.TargetName="RingRotate" Storyboard.TargetProperty="Angle"
                             From="0" To="360" Duration="0:0:8" />
        </Storyboard>
        <Storyboard x:Key="PulseCore" RepeatBehavior="Forever" AutoReverse="True">
            <DoubleAnimation Storyboard.TargetName="CoreScale" Storyboard.TargetProperty="ScaleX"
                             From="0.94" To="1.08" Duration="0:0:1.6" />
            <DoubleAnimation Storyboard.TargetName="CoreScale" Storyboard.TargetProperty="ScaleY"
                             From="0.94" To="1.08" Duration="0:0:1.6" />
        </Storyboard>
    </Window.Resources>
    <Grid Name="MainGrid" Cursor="Hand" Background="Transparent">
        <!-- Resplandor Exterior / Aura -->
        <Ellipse Name="GlowAura" Width="130" Height="130" HorizontalAlignment="Center" VerticalAlignment="Top" Margin="0,5,0,0">
            <Ellipse.Fill>
                <RadialGradientBrush>
                    <GradientStop Color="#55EC4899" Offset="0.0" />
                    <GradientStop Color="#22A855F7" Offset="0.55" />
                    <GradientStop Color="#00000000" Offset="0.85" />
                </RadialGradientBrush>
            </Ellipse.Fill>
        </Ellipse>

        <!-- Anillo Orbital Giratorio Neón -->
        <Ellipse Name="OrbitRing" Width="96" Height="96" HorizontalAlignment="Center" VerticalAlignment="Top" Margin="0,22,0,0"
                 Stroke="#A855F7" StrokeThickness="1.5" StrokeDashArray="3 5">
            <Ellipse.RenderTransform>
                <RotateTransform x:Name="RingRotate" CenterX="48" CenterY="48" />
            </Ellipse.RenderTransform>
            <Ellipse.Effect>
                <DropShadowEffect Color="#EC4899" BlurRadius="12" ShadowDepth="0" Opacity="0.85" />
            </Ellipse.Effect>
        </Ellipse>

        <!-- Orbe Central Neón con Núcleo Palpitante -->
        <Ellipse Name="OrbCore" Width="56" Height="56" HorizontalAlignment="Center" VerticalAlignment="Top" Margin="0,42,0,0">
            <Ellipse.Fill>
                <RadialGradientBrush Center="0.4,0.4" GradientOrigin="0.4,0.4">
                    <GradientStop Color="#FFFFFFFF" Offset="0.0" />
                    <GradientStop Color="#FFEC4899" Offset="0.35" />
                    <GradientStop Color="#FFA855F7" Offset="0.75" />
                    <GradientStop Color="#FF4A0E4E" Offset="1.0" />
                </RadialGradientBrush>
            </Ellipse.Fill>
            <Ellipse.Effect>
                <DropShadowEffect Color="#EC4899" BlurRadius="22" ShadowDepth="0" Opacity="0.95" />
            </Ellipse.Effect>
            <Ellipse.RenderTransform>
                <ScaleTransform x:Name="CoreScale" CenterX="28" CenterY="28" />
            </Ellipse.RenderTransform>
        </Ellipse>

        <!-- Icono Central del Micrófono Sutil -->
        <Path HorizontalAlignment="Center" VerticalAlignment="Top" Margin="0,60,0,0"
              Fill="#FFFFFF" Opacity="0.88"
              Data="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm5 9a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21H9v2h6v-2h-2v-2.08A7 7 0 0 0 19 11h-2Z">
            <Path.RenderTransform>
                <ScaleTransform ScaleX="0.75" ScaleY="0.75" />
            </Path.RenderTransform>
        </Path>

        <!-- Etiqueta Flotante de Estado -->
        <Border Name="BadgeBorder" HorizontalAlignment="Center" VerticalAlignment="Bottom" Margin="0,0,0,8"
                Background="#DD0D0D1A" CornerRadius="10" Padding="8,2" BorderBrush="#55A855F7" BorderThickness="1">
            <Border.Effect>
                <DropShadowEffect Color="#000000" BlurRadius="8" ShadowDepth="2" Opacity="0.8" />
            </Border.Effect>
            <TextBlock Name="TxtStatus" Text="NOVA • DI 'NOVA'" FontFamily="Segoe UI" FontSize="9.5" FontWeight="Bold"
                       Foreground="#F8FAFC" HorizontalAlignment="Center" />
        </Border>
    </Grid>
</Window>
"@

$reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
$window = [System.Windows.Markup.XamlReader]::Load($reader)

# Posicionar en la esquina inferior derecha encima de la barra de tareas
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$window.Left = $screen.Right - 170
$window.Top = $screen.Bottom - 190

# Iniciar animaciones de giro y pulso
$spin = $window.Resources["SpinRing"]
$pulse = $window.Resources["PulseCore"]
$spin.Begin($window)
$pulse.Begin($window)

# Elementos UI
$grid = $window.FindName("MainGrid")
$orbCore = $window.FindName("OrbCore")
$orbitRing = $window.FindName("OrbitRing")
$badgeBorder = $window.FindName("BadgeBorder")
$txtStatus = $window.FindName("TxtStatus")

# Arrastre del orbe con clic izquierdo
$grid.Add_MouseLeftButtonDown({
    $window.DragMove()
})

# Menú contextual con clic derecho
$menu = New-Object System.Windows.Controls.ContextMenu
$itemClose = New-Object System.Windows.Controls.MenuItem
$itemClose.Header = "Cerrar Orbe"
$itemClose.Add_Click({ $window.Close() })

$itemReset = New-Object System.Windows.Controls.MenuItem
$itemReset.Header = "Restablecer en Esquina"
$itemReset.Add_Click({
    $s = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $window.Left = $s.Right - 170
    $window.Top = $s.Bottom - 190
})

$itemHud = New-Object System.Windows.Controls.MenuItem
$itemHud.Header = "Abrir Panel Completo de Nova"
$itemHud.Add_Click({
    Start-Process -FilePath "http://127.0.0.1:3840"
})

$menu.Items.Add($itemReset) | Out-Null
$menu.Items.Add($itemHud) | Out-Null
$menu.Items.Add($itemClose) | Out-Null
$grid.ContextMenu = $menu

# Reproductor de audio para respuestas de ElevenLabs
$mediaPlayer = New-Object System.Windows.Media.MediaPlayer

# Conexión WebSocket al servidor local de Nova (Puerto 3840)
$wsClient = New-Object System.Net.WebSockets.ClientWebSocket
$wsUri = [System.Uri]::new("ws://127.0.0.1:3840")
$cts = New-Object System.Threading.CancellationTokenSource

$isListening = $false
$isSpeaking = $false

function Set-OrbVisualState([string]$state, [string]$label) {
    $window.Dispatcher.Invoke([Action]{
        $txtStatus.Text = $label
        if ($state -eq "IDLE") {
            $badgeBorder.BorderBrush = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromArgb(120, 168, 85, 247))
            $txtStatus.Foreground = [System.Windows.Media.Brushes]::White
            $orbitRing.Stroke = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(168, 85, 247))
        } elseif ($state -eq "LISTENING") {
            $badgeBorder.BorderBrush = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(244, 63, 94))
            $txtStatus.Foreground = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(244, 63, 94))
            $orbitRing.Stroke = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(244, 63, 94))
        } elseif ($state -eq "THINKING") {
            $badgeBorder.BorderBrush = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(6, 182, 212))
            $txtStatus.Foreground = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(6, 182, 212))
            $orbitRing.Stroke = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(6, 182, 212))
        } elseif ($state -eq "SPEAKING") {
            $badgeBorder.BorderBrush = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(236, 72, 153))
            $txtStatus.Foreground = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(236, 72, 153))
            $orbitRing.Stroke = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(236, 72, 153))
        }
    })
}

# Tono suave de activación
function Play-Chime() {
    [System.Console]::Beep(659, 120)
    [System.Console]::Beep(880, 180)
}

# Enviar comando de usuario a Nova Gateway
function Send-NovaCommand([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return }
    Set-OrbVisualState "THINKING" "PROCESANDO..."
    try {
        $json = @{ type = "USER_SPEECH"; text = $text } | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $segment = [System.ArraySegment[byte]]::new($bytes)
        $wsClient.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait(2000)
    } catch {
        Write-Warning "Aviso enviando comando: $_"
    }
}

# Escuchar respuestas desde Nova Gateway
$wsTask = [System.Threading.Tasks.Task]::Run([Action]{
    try {
        $wsClient.ConnectAsync($wsUri, $cts.Token).Wait(4000)
        Write-Output "[FloatingOrb] Conectado a Nova en puerto 3840."
    } catch {
        Write-Warning "[FloatingOrb] Servidor 3840 no disponible: $_"
    }

    $buffer = [byte[]]::new(8192)
    while ($wsClient.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        try {
            $seg = [System.ArraySegment[byte]]::new($buffer)
            $res = $wsClient.ReceiveAsync($seg, $cts.Token).Result
            if ($res.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Text) {
                $rawMsg = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $res.Count)
                $data = $rawMsg | ConvertFrom-Json

                if ($data.type -eq "STATE_CHANGE") {
                    if ($data.state -eq "THINKING") {
                        Set-OrbVisualState "THINKING" "PROCESANDO..."
                    } elseif ($data.state -eq "SPEAKING") {
                        Set-OrbVisualState "SPEAKING" "HABLANDO..."
                    } elseif ($data.state -eq "IDLE") {
                        Set-OrbVisualState "IDLE" "NOVA • DI 'NOVA'"
                    }
                }

                if ($data.type -eq "ASSISTANT_REPLY" -and $data.audioUrl) {
                    $audioFullPath = "http://127.0.0.1:3840" + $data.audioUrl
                    $window.Dispatcher.Invoke([Action]{
                        Set-OrbVisualState "SPEAKING" "HABLANDO..."
                        $mediaPlayer.Open([System.Uri]::new($audioFullPath))
                        $mediaPlayer.Play()
                    })
                }
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
})

# Fin de reproducción de audio -> Retorno a reposo
$mediaPlayer.Add_MediaEnded({
    Start-Sleep -Milliseconds 1200
    Set-OrbVisualState "IDLE" "NOVA • DI 'NOVA'"
    # Notificar fin de audio
    try {
        $finJson = '{"type":"CLIENT_SPEECH_FINISHED"}'
        $finBytes = [System.Text.Encoding]::UTF8.GetBytes($finJson)
        $wsClient.SendAsync([System.ArraySegment[byte]]::new($finBytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait(1000)
    } catch {}
})

# Inicializar Reconocedor Nativo de Windows (Wake Word: "Nova")
try {
    $speechEngine = New-Object System.Speech.Recognition.SpeechRecognitionEngine("MS-3082-80-DESK")
    $speechEngine.SetInputToDefaultAudioDevice()

    # Comandos reconocidos directamente
    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add(@(
        "nova", "oye nova", "hola nova",
        "nova abre discord", "abre discord",
        "nova pon musica", "pon musica", "pon una cancion",
        "nova pon un video", "pon un video", "ver video",
        "nova que hora es", "que hora es",
        "nova abre netbeans", "abre netbeans",
        "nova abre vs code", "abre vs code", "abre visual studio code",
        "nova sube el volumen", "sube el volumen",
        "nova baja el volumen", "baja el volumen",
        "nova bloquea la laptop", "bloquea la laptop"
    ))
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    $grammar = New-Object System.Speech.Recognition.Grammar($gb)
    $speechEngine.LoadGrammar($grammar)

    # Evento de detección de voz
    $speechEngine.Add_SpeechRecognized({
        param($s, $e)
        $heard = ($e.Result.Text + "").Trim().ToLower()
        Write-Output "[FloatingOrb Voice] $heard (Confianza: $($e.Result.Confidence))"

        if ($e.Result.Confidence -ge 0.55) {
            if ($heard -eq "nova" -or $heard -eq "oye nova" -or $heard -eq "hola nova") {
                Play-Chime
                Set-OrbVisualState "LISTENING" "¿SÍ, KIRITO?"
            } else {
                Play-Chime
                Set-OrbVisualState "THINKING" "EJECUTANDO..."
                $clean = $heard -replace "^(nova|oye nova|hola nova)\s*", ""
                Send-NovaCommand $clean
            }
        }
    })

    $speechEngine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    Write-Output "[FloatingOrb] Reconocimiento de voz nativo en segundo plano activo."
} catch {
    Write-Warning "[FloatingOrb] No se pudo inicializar System.Speech: $_"
}

# Clic para despertar manualmente
$orbCore.Add_MouseLeftButtonDown({
    Play-Chime
    Set-OrbVisualState "LISTENING" "¿SÍ, KIRITO?"
    # Esperar 6 segundos y volver a reposo si no se habla
    [System.Threading.Tasks.Task]::Delay(6000).ContinueWith([Action[System.Threading.Tasks.Task]]{
        Set-OrbVisualState "IDLE" "NOVA • DI 'NOVA'"
    })
})

# Cerrar conexiones al salir
$window.Add_Closed({
    $cts.Cancel()
    try { $speechEngine.RecognizeAsyncStop() } catch {}
    try { $wsClient.Dispose() } catch {}
})

# Mostrar el orbe flotante en pantalla
$window.ShowDialog() | Out-Null
