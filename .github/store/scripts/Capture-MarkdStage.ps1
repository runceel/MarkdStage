param(
    [string]$OutFile,
    [string]$TitleLike = 'MarkdStage*',
    [string]$ProcessLike = '*MarkdStage*',
    [int]$X = 100,
    [int]$Y = -1300,
    [int]$Width = 1920,
    [int]$Height = 1080,
    [string[]]$Keys = @(),
    [string[]]$Clicks = @(),
    [switch]$NoCapture,
    [int]$SettleMs = 1500,
    [switch]$ListOnly
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class Win {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool repaint);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, IntPtr extra);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

    public delegate bool EnumProc(IntPtr h, IntPtr p);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

try {
    # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
    if (-not [Win]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [Win]::SetProcessDPIAware() | Out-Null }
} catch {
    [Win]::SetProcessDPIAware() | Out-Null
}

function Get-AppWindows {
    $list = New-Object System.Collections.ArrayList
    $cb = [Win+EnumProc] {
        param($h, $p)
        if ([Win]::IsWindowVisible($h)) {
            $len = [Win]::GetWindowTextLength($h)
            if ($len -gt 0) {
                $sb = New-Object System.Text.StringBuilder ($len + 1)
                [Win]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
                $procId = 0
                [Win]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
                $proc = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
                if ($proc -like $ProcessLike) {
                    $null = $list.Add([pscustomobject]@{ Handle = $h; Title = $sb.ToString(); ProcId = $procId; Process = $proc })
                }
            }
        }
        return $true
    }
    [Win]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
    return $list
}

$windows = Get-AppWindows
if ($ListOnly) { $windows | Format-Table -AutoSize; return }

$target = $windows | Where-Object { $_.Title -like $TitleLike } | Select-Object -First 1
if (-not $target) {
    Write-Error "No window matching '$TitleLike'. Found: $($windows.Title -join ' | ')"
    exit 1
}

$h = $target.Handle
[Win]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE
[Win]::BringWindowToTop($h) | Out-Null
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400

# Size so that the DWM visible frame is exactly Width x Height
[Win]::MoveWindow($h, $X, $Y, $Width, $Height, $true) | Out-Null
Start-Sleep -Milliseconds 500
$outer = New-Object Win+RECT
$dwm = New-Object Win+RECT
[Win]::GetWindowRect($h, [ref]$outer) | Out-Null
[Win]::DwmGetWindowAttribute($h, 9, [ref]$dwm, 16) | Out-Null
$padW = ($outer.Right - $outer.Left) - ($dwm.Right - $dwm.Left)
$padH = ($outer.Bottom - $outer.Top) - ($dwm.Bottom - $dwm.Top)
$offX = $dwm.Left - $outer.Left
$offY = $dwm.Top - $outer.Top
[Win]::MoveWindow($h, ($X - $offX), ($Y - $offY), ($Width + $padW), ($Height + $padH), $true) | Out-Null
Start-Sleep -Milliseconds 600

[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 300

foreach ($k in $Keys) {
    [System.Windows.Forms.SendKeys]::SendWait($k)
    Start-Sleep -Milliseconds 450
}

Start-Sleep -Milliseconds $SettleMs

[Win]::DwmGetWindowAttribute($h, 9, [ref]$dwm, 16) | Out-Null

foreach ($c in $Clicks) {
    $parts = $c -split ','
    $cx = $dwm.Left + [int]$parts[0]
    $cy = $dwm.Top + [int]$parts[1]
    [Win]::SetCursorPos($cx, $cy) | Out-Null
    Start-Sleep -Milliseconds 250
    [Win]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # LEFTDOWN
    Start-Sleep -Milliseconds 80
    [Win]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # LEFTUP
    Start-Sleep -Milliseconds 1200
    "CLICKED $cx,$cy"
}

if ($Clicks.Count -gt 0) { Start-Sleep -Milliseconds $SettleMs }
if ($NoCapture) { return }

[Win]::DwmGetWindowAttribute($h, 9, [ref]$dwm, 16) | Out-Null
$w = $dwm.Right - $dwm.Left
$t = $dwm.Bottom - $dwm.Top

$bmp = New-Object System.Drawing.Bitmap $w, $t, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($dwm.Left, $dwm.Top, 0, 0, (New-Object System.Drawing.Size $w, $t), [System.Drawing.CopyPixelOperation]::SourceCopy)
$g.Dispose()

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

"CAPTURED '$($target.Title)' -> $OutFile ($w x $t)"
