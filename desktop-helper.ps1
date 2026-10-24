Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;
using System.Threading;
using System.Runtime.InteropServices;

public class DesktopBridge {
    [DllImport("user32.dll", CharSet=CharSet.Auto, SetLastError=true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);

    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    public static void ClickAt(int x, int y) {
        Cursor.Position = new Point(x, y);
        mouse_event(0x02, 0, 0, 0, 0); // left down
        mouse_event(0x04, 0, 0, 0, 0); // left up
    }

    public static void DoubleClickAt(int x, int y) {
        Cursor.Position = new Point(x, y);
        mouse_event(0x02, 0, 0, 0, 0);
        mouse_event(0x04, 0, 0, 0, 0);
        Thread.Sleep(80);
        mouse_event(0x02, 0, 0, 0, 0);
        mouse_event(0x04, 0, 0, 0, 0);
    }

    public static void RightClickAt(int x, int y) {
        Cursor.Position = new Point(x, y);
        mouse_event(0x08, 0, 0, 0, 0); // right down
        mouse_event(0x10, 0, 0, 0, 0); // right up
    }

    public static void MoveTo(int x, int y) {
        Cursor.Position = new Point(x, y);
    }

    public static void ScrollWheel(int amount) {
        mouse_event(0x0800, 0, 0, (uint)amount, 0);
    }

    public static string CaptureDefaultDesktop(string outPath) {
        string result = "PENDING";
        Thread t = new Thread(() => {
            uint GENERIC_ALL = 0x10000000;
            IntPtr hDesk = OpenDesktop("Default", 0, false, GENERIC_ALL);
            if (hDesk == IntPtr.Zero) {
                result = "OpenDesktop failed: " + Marshal.GetLastWin32Error();
                return;
            }
            if (!SetThreadDesktop(hDesk)) {
                result = "SetThreadDesktop failed: " + Marshal.GetLastWin32Error();
                CloseDesktop(hDesk);
                return;
            }
            try {
                int w = 1920, h = 1080;
                using (Bitmap bmp = new Bitmap(w, h)) {
                    using (Graphics g = Graphics.FromImage(bmp)) {
                        g.CopyFromScreen(0, 0, 0, 0, new Size(w, h));
                    }
                    bmp.Save(outPath, ImageFormat.Jpeg);
                }
                result = "SUCCESS";
            } catch (Exception ex) {
                result = "Exception: " + ex.Message;
            }
            CloseDesktop(hDesk);
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return result;
    }

    public static string ListDefaultDesktopWindows() {
        List<string> wins = new List<string>();
        Thread t = new Thread(() => {
            uint GENERIC_ALL = 0x10000000;
            IntPtr hDesk = OpenDesktop("Default", 0, false, GENERIC_ALL);
            if (hDesk == IntPtr.Zero) return;
            SetThreadDesktop(hDesk);
            EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    int len = GetWindowTextLength(hWnd);
                    if (len > 0) {
                        StringBuilder sb = new StringBuilder(len + 1);
                        GetWindowText(hWnd, sb, sb.Capacity);
                        uint pid = 0;
                        GetWindowThreadProcessId(hWnd, out pid);
                        string title = sb.ToString().Trim();
                        if (!string.IsNullOrEmpty(title) && title != "Program Manager" && title != "Windows Input Experience") {
                            wins.Add("[" + pid + "] " + title);
                        }
                    }
                }
                return true;
            }, IntPtr.Zero);
            CloseDesktop(hDesk);
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return string.Join(" | ", wins);
    }

    public static string FocusWindowOnDefaultDesktop(string query) {
        string found = "NOT_FOUND";
        Thread t = new Thread(() => {
            uint GENERIC_ALL = 0x10000000;
            IntPtr hDesk = OpenDesktop("Default", 0, false, GENERIC_ALL);
            if (hDesk == IntPtr.Zero) return;
            SetThreadDesktop(hDesk);
            EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    int len = GetWindowTextLength(hWnd);
                    if (len > 0) {
                        StringBuilder sb = new StringBuilder(len + 1);
                        GetWindowText(hWnd, sb, sb.Capacity);
                        string title = sb.ToString();
                        if (title.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0) {
                            ShowWindow(hWnd, 9); // SW_RESTORE
                            keybd_event(0x12, 0, 0, UIntPtr.Zero);
                            keybd_event(0x12, 0, 2, UIntPtr.Zero);
                            SwitchToThisWindow(hWnd, true);
                            SetForegroundWindow(hWnd);
                            found = "FOCUSED: " + title;
                            return false;
                        }
                    }
                }
                return true;
            }, IntPtr.Zero);
            CloseDesktop(hDesk);
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return found;
    }
}
"@ -ReferencedAssemblies System.Drawing, System.Windows.Forms

$action = $args[0]
$target = $args[1]

if ($action -eq "screenshot") {
    $res = [DesktopBridge]::CaptureDefaultDesktop($target)
    Write-Output $res
} elseif ($action -eq "windows") {
    $res = [DesktopBridge]::ListDefaultDesktopWindows()
    Write-Output $res
} elseif ($action -eq "focus") {
    $res = [DesktopBridge]::FocusWindowOnDefaultDesktop($target)
    Write-Output $res
} elseif ($action -eq "click") {
    $x = [int]$args[1]
    $y = [int]$args[2]
    [DesktopBridge]::ClickAt($x, $y)
    Write-Output "CLICKED: $x, $y"
} elseif ($action -eq "doubleclick") {
    $x = [int]$args[1]
    $y = [int]$args[2]
    [DesktopBridge]::DoubleClickAt($x, $y)
    Write-Output "DOUBLE_CLICKED: $x, $y"
} elseif ($action -eq "rightclick") {
    $x = [int]$args[1]
    $y = [int]$args[2]
    [DesktopBridge]::RightClickAt($x, $y)
    Write-Output "RIGHT_CLICKED: $x, $y"
} elseif ($action -eq "move") {
    $x = [int]$args[1]
    $y = [int]$args[2]
    [DesktopBridge]::MoveTo($x, $y)
    Write-Output "MOVED: $x, $y"
} elseif ($action -eq "scroll") {
    $amount = [int]$args[1]
    [DesktopBridge]::ScrollWheel($amount)
    Write-Output "SCROLLED: $amount"
} elseif ($action -eq "type") {
    $text = $args[1]
    [System.Windows.Forms.SendKeys]::SendWait($text)
    Write-Output "TYPED: $text"
}
