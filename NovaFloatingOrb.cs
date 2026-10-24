using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Globalization;
using System.Net.WebSockets;
using System.Speech.Recognition;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Shapes;

namespace NovaNativeApp {
    public class FloatingOrbWindow : Window {
        private Ellipse orbitRing;
        private Ellipse orbCore;
        private Border badgeBorder;
        private TextBlock txtStatus;
        private RotateTransform ringRotate;
        private ScaleTransform coreScale;
        private Storyboard spinStory;
        private DoubleAnimation spinAnim;

        private ClientWebSocket wsClient;
        private CancellationTokenSource cts = new CancellationTokenSource();
        private MediaPlayer mediaPlayer = new MediaPlayer();
        private SpeechRecognitionEngine speechEngine;

        private bool isAwake = false;
        private bool isSpeaking = false;
        private System.Windows.Threading.DispatcherTimer awakeTimer;

        public FloatingOrbWindow() {
            InitializeWindow();
            InitializeWebSocket();
            InitializeSpeechEngine();
        }

        private void InitializeWindow() {
            Title = "Nova Floating Orb";
            Width = 160;
            Height = 175;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            Topmost = true;
            ShowInTaskbar = false;
            WindowStartupLocation = WindowStartupLocation.Manual;

            Rect workArea = SystemParameters.WorkArea;
            Left = workArea.Right - 170;
            Top = workArea.Bottom - 185;

            Grid rootGrid = new Grid {
                Background = Brushes.Transparent,
                Cursor = Cursors.Hand
            };

            // Resplandor exterior (Aura)
            Ellipse glowAura = new Ellipse {
                Width = 130,
                Height = 130,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 5, 0, 0),
                Fill = new RadialGradientBrush {
                    GradientStops = new GradientStopCollection {
                        new GradientStop(Color.FromArgb(0x55, 0xEC, 0x48, 0x99), 0.0),
                        new GradientStop(Color.FromArgb(0x22, 0xA8, 0x55, 0xF7), 0.55),
                        new GradientStop(Color.FromArgb(0x00, 0x00, 0x00, 0x00), 0.85)
                    }
                }
            };
            rootGrid.Children.Add(glowAura);

            // Anillo orbital giratorio con guiones
            ringRotate = new RotateTransform(0, 48, 48);
            orbitRing = new Ellipse {
                Width = 96,
                Height = 96,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 22, 0, 0),
                Stroke = new SolidColorBrush(Color.FromRgb(0xA8, 0x55, 0xF7)),
                StrokeThickness = 1.6,
                StrokeDashArray = new DoubleCollection { 3, 5 },
                RenderTransform = ringRotate,
                Effect = new DropShadowEffect {
                    Color = Color.FromRgb(0xEC, 0x48, 0x99),
                    BlurRadius = 14,
                    ShadowDepth = 0,
                    Opacity = 0.85
                }
            };
            rootGrid.Children.Add(orbitRing);

            // Núcleo del orbe neón
            coreScale = new ScaleTransform(1.0, 1.0, 28, 28);
            orbCore = new Ellipse {
                Width = 56,
                Height = 56,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 42, 0, 0),
                Fill = new RadialGradientBrush {
                    Center = new Point(0.4, 0.4),
                    GradientOrigin = new Point(0.4, 0.4),
                    GradientStops = new GradientStopCollection {
                        new GradientStop(Colors.White, 0.0),
                        new GradientStop(Color.FromRgb(0xEC, 0x48, 0x99), 0.35),
                        new GradientStop(Color.FromRgb(0xA8, 0x55, 0xF7), 0.75),
                        new GradientStop(Color.FromRgb(0x4A, 0x0E, 0x4E), 1.0)
                    }
                },
                RenderTransform = coreScale,
                Effect = new DropShadowEffect {
                    Color = Color.FromRgb(0xEC, 0x48, 0x99),
                    BlurRadius = 24,
                    ShadowDepth = 0,
                    Opacity = 0.95
                }
            };
            rootGrid.Children.Add(orbCore);

            // Icono sutil del micrófono
            System.Windows.Shapes.Path micPath = new System.Windows.Shapes.Path {
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 60, 0, 0),
                Fill = Brushes.White,
                Opacity = 0.9,
                Data = Geometry.Parse("M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm5 9a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21H9v2h6v-2h-2v-2.08A7 7 0 0 0 19 11h-2Z"),
                RenderTransform = new ScaleTransform(0.72, 0.72)
            };
            rootGrid.Children.Add(micPath);

            // Etiqueta flotante inferior
            txtStatus = new TextBlock {
                Text = "NOVA • DI 'NOVA'",
                FontFamily = new FontFamily("Segoe UI"),
                FontSize = 9.5,
                FontWeight = FontWeights.Bold,
                Foreground = Brushes.White,
                HorizontalAlignment = HorizontalAlignment.Center
            };

            badgeBorder = new Border {
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(0, 0, 0, 8),
                Background = new SolidColorBrush(Color.FromArgb(0xEE, 0x0D, 0x0D, 0x1A)),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(8, 2, 8, 2),
                BorderBrush = new SolidColorBrush(Color.FromArgb(0x66, 0xA8, 0x55, 0xF7)),
                BorderThickness = new Thickness(1),
                Effect = new DropShadowEffect {
                    Color = Colors.Black,
                    BlurRadius = 8,
                    ShadowDepth = 2,
                    Opacity = 0.8
                },
                Child = txtStatus
            };
            rootGrid.Children.Add(badgeBorder);

            // Configurar animaciones de giro y pulso
            spinAnim = new DoubleAnimation {
                From = 0,
                To = 360,
                Duration = TimeSpan.FromSeconds(8),
                RepeatBehavior = RepeatBehavior.Forever
            };
            spinStory = new Storyboard();
            spinStory.Children.Add(spinAnim);
            Storyboard.SetTarget(spinAnim, ringRotate);
            Storyboard.SetTargetProperty(spinAnim, new PropertyPath("Angle"));
            spinStory.Begin();

            DoubleAnimation pulseAnim = new DoubleAnimation {
                From = 0.94,
                To = 1.08,
                Duration = TimeSpan.FromSeconds(1.6),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };
            coreScale.BeginAnimation(ScaleTransform.ScaleXProperty, pulseAnim);
            coreScale.BeginAnimation(ScaleTransform.ScaleYProperty, pulseAnim);

            // Interacción de ratón
            rootGrid.MouseLeftButtonDown += (s, e) => {
                if (e.ClickCount == 1) {
                    DragMove();
                }
            };

            orbCore.MouseLeftButtonDown += (s, e) => {
                e.Handled = true;
                if (isSpeaking) {
                    StopAudioPlayback();
                    return;
                }
                if (isAwake) {
                    ReturnToStandby();
                } else {
                    TriggerWake();
                }
            };

            // Menú contextual clic derecho
            ContextMenu menu = new ContextMenu();
            MenuItem mReset = new MenuItem { Header = "Restablecer posición en esquina" };
            mReset.Click += (s, e) => {
                Rect wa = SystemParameters.WorkArea;
                Left = wa.Right - 170;
                Top = wa.Bottom - 185;
            };
            MenuItem mPanel = new MenuItem { Header = "Abrir Panel Holográfico Completo" };
            mPanel.Click += (s, e) => {
                try { System.Diagnostics.Process.Start("http://127.0.0.1:3840"); } catch {}
            };
            MenuItem mClose = new MenuItem { Header = "Cerrar Orbe" };
            mClose.Click += (s, e) => Close();

            menu.Items.Add(mReset);
            menu.Items.Add(mPanel);
            menu.Items.Add(new Separator());
            menu.Items.Add(mClose);
            rootGrid.ContextMenu = menu;

            Content = rootGrid;

            awakeTimer = new System.Windows.Threading.DispatcherTimer();
            awakeTimer.Interval = TimeSpan.FromSeconds(8.5);
            awakeTimer.Tick += (s, e) => {
                awakeTimer.Stop();
                if (isAwake && !isSpeaking) {
                    ReturnToStandby();
                }
            };

            mediaPlayer.MediaEnded += (s, e) => {
                Task.Delay(1300).ContinueWith(_ => {
                    Dispatcher.Invoke(() => {
                        isSpeaking = false;
                        ReturnToStandby();
                        try {
                            byte[] finBytes = Encoding.UTF8.GetBytes("{\"type\":\"CLIENT_SPEECH_FINISHED\"}");
                            wsClient.SendAsync(new ArraySegment<byte>(finBytes), WebSocketMessageType.Text, true, CancellationToken.None);
                        } catch {}
                    });
                });
            };
        }

        private void SetVisualState(string state, string label) {
            Dispatcher.Invoke(() => {
                txtStatus.Text = label;
                if (state == "IDLE") {
                    badgeBorder.BorderBrush = new SolidColorBrush(Color.FromArgb(0x66, 0xA8, 0x55, 0xF7));
                    txtStatus.Foreground = Brushes.White;
                    orbitRing.Stroke = new SolidColorBrush(Color.FromRgb(0xA8, 0x55, 0xF7));
                    spinAnim.Duration = TimeSpan.FromSeconds(8);
                    spinStory.Begin();
                } else if (state == "LISTENING") {
                    badgeBorder.BorderBrush = new SolidColorBrush(Color.FromRgb(0xF4, 0x3F, 0x5E));
                    txtStatus.Foreground = new SolidColorBrush(Color.FromRgb(0xF4, 0x3F, 0x5E));
                    orbitRing.Stroke = new SolidColorBrush(Color.FromRgb(0xF4, 0x3F, 0x5E));
                    spinAnim.Duration = TimeSpan.FromSeconds(4);
                    spinStory.Begin();
                } else if (state == "THINKING") {
                    badgeBorder.BorderBrush = new SolidColorBrush(Color.FromRgb(0x06, 0xB6, 0xD4));
                    txtStatus.Foreground = new SolidColorBrush(Color.FromRgb(0x06, 0xB6, 0xD4));
                    orbitRing.Stroke = new SolidColorBrush(Color.FromRgb(0x06, 0xB6, 0xD4));
                    spinAnim.Duration = TimeSpan.FromSeconds(1.8);
                    spinStory.Begin();
                } else if (state == "SPEAKING") {
                    badgeBorder.BorderBrush = new SolidColorBrush(Color.FromRgb(0xEC, 0x48, 0x99));
                    txtStatus.Foreground = new SolidColorBrush(Color.FromRgb(0xEC, 0x48, 0x99));
                    orbitRing.Stroke = new SolidColorBrush(Color.FromRgb(0xEC, 0x48, 0x99));
                    spinAnim.Duration = TimeSpan.FromSeconds(3);
                    spinStory.Begin();
                }
            });
        }

        private void TriggerWake() {
            if (isSpeaking) return;
            isAwake = true;
            PlayChime();
            SetVisualState("LISTENING", "¿SÍ, KIRITO?");
            awakeTimer.Stop();
            awakeTimer.Start();
        }

        private void ReturnToStandby() {
            isAwake = false;
            awakeTimer.Stop();
            SetVisualState("IDLE", "NOVA • DI 'NOVA'");
        }

        private void PlayChime() {
            Task.Run(() => {
                try {
                    Console.Beep(659, 110);
                    Console.Beep(880, 160);
                } catch {}
            });
        }

        private void StopAudioPlayback() {
            try {
                mediaPlayer.Stop();
                mediaPlayer.Close();
            } catch {}
            isSpeaking = false;
            ReturnToStandby();
        }

        private void SendCommand(string text) {
            if (string.IsNullOrWhiteSpace(text)) return;
            SetVisualState("THINKING", "EJECUTANDO...");
            Task.Run(async () => {
                try {
                    string json = "{\"type\":\"USER_SPEECH\",\"text\":\"" + text.Replace("\"", "\\\"") + "\"}";
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    if (wsClient != null && wsClient.State == WebSocketState.Open) {
                        await wsClient.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                    }
                } catch (Exception ex) {
                    Console.WriteLine("Error enviando orden: " + ex.Message);
                }
            });
        }

        private void InitializeWebSocket() {
            Task.Run(async () => {
                while (!cts.IsCancellationRequested) {
                    try {
                        wsClient = new ClientWebSocket();
                        await wsClient.ConnectAsync(new Uri("ws://127.0.0.1:3840"), cts.Token);
                        Console.WriteLine("[FloatingOrb] Conectado a Nova Gateway en 3840.");

                        byte[] buffer = new byte[8192];
                        while (wsClient.State == WebSocketState.Open) {
                            var result = await wsClient.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token);
                            if (result.MessageType == WebSocketMessageType.Text) {
                                string msg = Encoding.UTF8.GetString(buffer, 0, result.Count);
                                HandleGatewayMessage(msg);
                            }
                        }
                    } catch {
                        Thread.Sleep(3000);
                    }
                }
            });
        }

        private void HandleGatewayMessage(string json) {
            try {
                if (json.Contains("\"type\":\"STATE_CHANGE\"")) {
                    if (json.Contains("\"state\":\"THINKING\"")) {
                        SetVisualState("THINKING", "EJECUTANDO...");
                    } else if (json.Contains("\"state\":\"SPEAKING\"")) {
                        SetVisualState("SPEAKING", "HABLANDO...");
                    } else if (json.Contains("\"state\":\"IDLE\"") && !isSpeaking) {
                        ReturnToStandby();
                    }
                }

                if (json.Contains("\"type\":\"ASSISTANT_REPLY\"")) {
                    int audioIdx = json.IndexOf("\"audioUrl\":\"");
                    if (audioIdx > 0) {
                        int start = audioIdx + 12;
                        int end = json.IndexOf("\"", start);
                        if (end > start) {
                            string audioRel = json.Substring(start, end - start).Replace("\\/", "/");
                            string fullUrl = "http://127.0.0.1:3840" + audioRel;
                            Dispatcher.Invoke(() => {
                                isSpeaking = true;
                                SetVisualState("SPEAKING", "HABLANDO...");
                                mediaPlayer.Open(new Uri(fullUrl));
                                mediaPlayer.Play();
                            });
                        }
                    }
                }
            } catch {}
        }

        private void InitializeSpeechEngine() {
            Task.Run(() => {
                try {
                    speechEngine = new SpeechRecognitionEngine("MS-3082-80-DESK");
                    speechEngine.SetInputToDefaultAudioDevice();

                    Choices choices = new Choices();
                    choices.Add(new string[] {
                        "nova", "oye nova", "hola nova",
                        "nova abre discord", "abre discord", "inicia discord",
                        "nova pon musica", "pon musica", "pon una cancion", "pon musica de bob marley",
                        "nova pon un video", "pon un video", "abre youtube", "reproduce youtube",
                        "nova abre netbeans", "abre netbeans", "inicia netbeans",
                        "nova abre vs code", "abre vs code", "abre visual studio code",
                        "nova abre word", "abre word", "abre excel", "abre la calculadora",
                        "nova sube el volumen", "sube el volumen",
                        "nova baja el volumen", "baja el volumen",
                        "nova que hora es", "que hora es",
                        "nova como esta la gpu", "dame la telemetria",
                        "nova bloquea la laptop", "bloquea la laptop"
                    });

                    GrammarBuilder gb = new GrammarBuilder();
                    gb.Culture = speechEngine.RecognizerInfo.Culture;
                    gb.Append(choices);

                    Grammar grammar = new Grammar(gb);
                    speechEngine.LoadGrammar(grammar);

                    speechEngine.SpeechRecognized += (s, e) => {
                        if (isSpeaking) return; // Supresión de eco estricta
                        string text = (e.Result.Text ?? "").Trim().ToLower();
                        if (e.Result.Confidence >= 0.50) {
                            if (text == "nova" || text == "oye nova" || text == "hola nova") {
                                TriggerWake();
                            } else {
                                PlayChime();
                                string clean = text;
                                if (clean.StartsWith("nova ")) clean = clean.Substring(5).Trim();
                                else if (clean.StartsWith("oye nova ")) clean = clean.Substring(9).Trim();
                                else if (clean.StartsWith("hola nova ")) clean = clean.Substring(10).Trim();
                                SendCommand(clean);
                            }
                        }
                    };

                    speechEngine.RecognizeAsync(RecognizeMode.Multiple);
                    Console.WriteLine("[FloatingOrb] Reconocedor de voz nativo en segundo plano activo.");
                } catch (Exception ex) {
                    Console.WriteLine("[FloatingOrb] Aviso inicializando SpeechEngine: " + ex.Message);
                }
            });
        }

        protected override void OnClosed(EventArgs e) {
            cts.Cancel();
            try { if (speechEngine != null) speechEngine.RecognizeAsyncStop(); } catch {}
            try { if (wsClient != null) wsClient.Dispose(); } catch {}
            try { if (mediaPlayer != null) mediaPlayer.Close(); } catch {}
            base.OnClosed(e);
        }

        [STAThread]
        public static void Main() {
            Application app = new Application();
            FloatingOrbWindow win = new FloatingOrbWindow();
            app.Run(win);
        }
    }
}
