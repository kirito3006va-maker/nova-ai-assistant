using System;
using System.Windows;
using System.Windows.Media;

public class App {
    [STAThread]
    public static void Main() {
        var app = new Application();
        var win = new Window {
            Title = "NovaTest",
            Width = 100,
            Height = 100,
            WindowStyle = WindowStyle.None,
            AllowsTransparency = true,
            Background = Brushes.Transparent,
            Topmost = true
        };
        Console.WriteLine("COMPILED_AND_READY");
    }
}
