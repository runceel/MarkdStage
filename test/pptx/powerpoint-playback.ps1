param(
    [Parameter(Mandatory)][string]$PresentationPath,
    [Parameter(Mandatory)][string]$EvidenceDirectory
)

# Opt-in Windows integration check; only the named test presentation is opened.
$ErrorActionPreference = 'Stop'
$path = (Resolve-Path $PresentationPath).Path
$evidence = (New-Item -ItemType Directory -Path $EvidenceDirectory -Force).FullName
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing
$references = $(if (Test-Path (Join-Path $PSHOME 'ref')) {
    @((Get-ChildItem (Join-Path $PSHOME 'ref') -Filter '*.dll').FullName) +
        [Drawing.Bitmap].Assembly.Location +
        @((Get-ChildItem $PSHOME -Filter 'System.Private.Windows.*.dll').FullName)
} else { @('System.dll', 'System.Drawing.dll') })
Add-Type -ReferencedAssemblies $references @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
public static class PowerPointPlayback {
    public delegate bool Callback(IntPtr h, IntPtr p);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback c, IntPtr p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder t, int n);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    public static IntPtr[] Windows(string file) {
        var result = new List<IntPtr>();
        EnumWindows((h,p) => {
            var title = new StringBuilder(1024);
            GetWindowText(h, title, title.Capacity);
            if (title.ToString().Contains(file)) result.Add(h);
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
    public static Bitmap Capture(IntPtr h) {
        var previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try { return CaptureAware(h); } finally { SetThreadDpiAwarenessContext(previous); }
    }
    static Bitmap CaptureAware(IntPtr h) {
        Rect r;
        if (!GetWindowRect(h, out r)) throw new Exception("Missing dedicated slideshow window");
        var image = new Bitmap(r.Right-r.Left, r.Bottom-r.Top);
        using (var graphics = Graphics.FromImage(image)) {
            var dc = graphics.GetHdc();
            bool ok;
            try { ok = PrintWindow(h, dc, 2); } finally { graphics.ReleaseHdc(dc); }
            if (!ok) { image.Dispose(); throw new Exception("Slideshow capture failed"); }
        }
        return image;
    }
    public static int ChangedPixels(Bitmap a, Bitmap b) {
        if (a.Size != b.Size) throw new Exception("Slideshow window resized during playback");
        // Exclude window chrome, the edge shadow, and navigation overlays.
        var rect = new Rectangle(40, 60, a.Width-80, a.Height-100);
        var left = a.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var right = b.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try {
            var x = new byte[left.Stride*left.Height];
            var y = new byte[right.Stride*right.Height];
            Marshal.Copy(left.Scan0, x, 0, x.Length);
            Marshal.Copy(right.Scan0, y, 0, y.Length);
            int changed = 0;
            for (int i=0; i<x.Length; i+=4)
                if (x[i]!=y[i] || x[i+1]!=y[i+1] || x[i+2]!=y[i+2]) changed++;
            return changed;
        } finally { a.UnlockBits(left); b.UnlockBits(right); }
    }
}
'@

$zip = [IO.Compression.ZipFile]::OpenRead($path)
$plans = @()
$slideCount = 0
try {
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName -notmatch '^ppt/slides/slide(\d+)\.xml$') { continue }
        $slideCount++
        $slideNumber = [int]$Matches[1]
        $reader = [IO.StreamReader]::new($entry.Open())
        try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $ns = [Xml.XmlNamespaceManager]::new($xml.NameTable)
        $ns.AddNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main')
        $effects = @($xml.SelectNodes('//p:cTn[@presetClass="entr"]', $ns))
        if (!$effects.Count) { continue }
        $targets = @($effects | ForEach-Object {
            $target = $_.SelectSingleNode('.//p:spTgt', $ns)
            $paragraph = $target.SelectSingleNode('p:txEl/p:pRg', $ns)
            @{
                shape = [int]$target.spid
                trigger = $(if ($_.nodeType -eq 'clickEffect') { 1 } else { 2 })
                paragraph = $(if ($paragraph) { [int]$paragraph.st + 1 } else { $null })
            }
        })
        $plans += @{ slide = $slideNumber; targets = $targets; clicks = @($targets | Where-Object trigger -eq 1).Count }
    }
} finally { $zip.Dispose() }
if (!$plans.Count) { throw 'The test presentation has no entrance effects' }
$plans = @($plans | Sort-Object slide)

$app = New-Object -ComObject PowerPoint.Application
$presentation = $null
$window = $null
$report = @{ file = [IO.Path]::GetFileName($path); application = 'Microsoft PowerPoint'; version = $app.Version; passes = @() }
try {
    # Save and reopen to detect timing discarded on application load/persistence.
    foreach ($pass in @('original', 'resaved')) {
        $openPath = $(if ($pass -eq 'original') { $path } else { Join-Path $evidence 'resaved.pptx' })
        $presentation = $app.Presentations.Open($openPath, -1, 0, -1)
        if ($presentation.Slides.Count -ne $slideCount) { throw 'PowerPoint changed the logical slide count' }
        $passReport = @{ name = $pass; slideCount = $presentation.Slides.Count; slides = @() }
        foreach ($plan in $plans) {
            $sequence = $presentation.Slides.Item($plan.slide).TimeLine.MainSequence
            if ($sequence.Count -ne $plan.targets.Count) {
                throw "Slide $($plan.slide): PowerPoint dropped entrance effects ($($sequence.Count)/$($plan.targets.Count))"
            }
            for ($i = 0; $i -lt $plan.targets.Count; $i++) {
                $effect = $sequence.Item($i + 1)
                $target = $plan.targets[$i]
                if ($effect.Shape.Id -ne $target.shape -or $effect.Timing.TriggerType -ne $target.trigger -or
                    ($null -ne $target.paragraph -and $effect.Paragraph -ne $target.paragraph)) {
                    throw "Slide $($plan.slide): effect $($i + 1) has a changed target or click group"
                }
            }
        }
        $settings = $presentation.SlideShowSettings
        $settings.ShowType = 2 # Windowed slideshow, without touching other presentations.
        $settings.StartingSlide = $plans[0].slide
        $settings.EndingSlide = $presentation.Slides.Count
        $before = [PowerPointPlayback]::Windows([IO.Path]::GetFileName($openPath))
        $window = $settings.Run()
        $window.Width = 1100
        $window.Height = 680
        Start-Sleep -Milliseconds 700
        $handles = @([PowerPointPlayback]::Windows([IO.Path]::GetFileName($openPath)) | Where-Object { $_ -notin $before })
        if ($handles.Count -ne 1) { throw 'Cannot identify the dedicated slideshow window safely' }
        foreach ($plan in $plans) {
            $window.View.GotoSlide($plan.slide, -1)
            Start-Sleep -Milliseconds 400
            if ($window.View.GetClickIndex() -ne 0 -or $window.View.GetClickCount() -ne $plan.clicks) {
                throw "Slide $($plan.slide): incorrect initial state or click count"
            }
            $frames = @()
            $changes = @()
            try {
                for ($click = 0; $click -le $plan.clicks; $click++) {
                    Start-Sleep -Milliseconds 300
                    if ($window.View.CurrentShowPosition -ne $plan.slide -or $window.View.GetClickIndex() -ne $click) {
                        throw "Slide $($plan.slide): skipped build $click"
                    }
                    $frame = [PowerPointPlayback]::Capture($handles[0])
                    $frame.Save((Join-Path $evidence "$pass-slide-$($plan.slide)-click-$click.png"))
                    $previousFrame = $(if ($click) { $frames[-1] } else { $null })
                    $frames += $frame
                    if ($click) {
                        $changed = [PowerPointPlayback]::ChangedPixels($previousFrame, $frame)
                        if ($changed -eq 0) { throw "Slide $($plan.slide): build $click did not visibly reveal content" }
                        $changes += $changed
                    }
                    if ($click -lt $plan.clicks) { $window.View.Next() }
                }
                # Revisit every earlier build and confirm exact restored visibility.
                for ($click = $plan.clicks - 1; $click -ge 0; $click--) {
                    $window.View.GotoClick($click)
                    Start-Sleep -Milliseconds 300
                    $frame = [PowerPointPlayback]::Capture($handles[0])
                    try {
                        if ([PowerPointPlayback]::ChangedPixels($frames[$click], $frame) -ne 0) {
                            throw "Slide $($plan.slide): build $click did not restore its earlier visibility"
                        }
                    } finally { $frame.Dispose() }
                }
                if ($plan.slide -lt $slideCount) {
                    $window.View.GotoClick($plan.clicks)
                    $window.View.Next()
                    if ($window.View.CurrentShowPosition -ne $plan.slide + 1) {
                        throw "Slide $($plan.slide): advance after the final build did not enter the next logical slide"
                    }
                }
                $passReport.slides += @{ slide = $plan.slide; effects = $plan.targets.Count; clicks = $plan.clicks; changedPixels = $changes }
            } finally { foreach ($frame in $frames) { $frame.Dispose() } }
        }
        $window.View.Exit()
        $window = $null
        if ($pass -eq 'original') { $presentation.SaveCopyAs((Join-Path $evidence 'resaved.pptx'), 24) }
        $presentation.Close()
        $presentation = $null
        $report.passes += $passReport
    }
    $report | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $evidence 'playback.json')
    "PASS: $($report.file), PowerPoint $($report.version), $($plans.Count) reveal slides, original + saved/reopened playback"
} finally {
    if ($window) { $window.View.Exit() }
    if ($presentation) { $presentation.Close() }
    # Do not quit PowerPoint: COM may share a user-owned application instance.
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
