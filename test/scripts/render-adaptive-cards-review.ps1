param([Parameter(Mandatory = $true)][string]$ArtifactDirectory)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$evidence = Get-Content -LiteralPath (Join-Path $root 'evidence.json') -Raw | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
$application = New-Object -ComObject PowerPoint.Application
$startedEmpty = $application.Presentations.Count -eq 0
try {
    $engine = @{
        application = 'PowerPoint desktop'
        version = $application.Version
        fileVersion = (Get-Item -LiteralPath (Join-Path $application.Path 'POWERPNT.EXE')).VersionInfo.FileVersion
    }
    foreach ($theme in @('dark', 'light', 'microsoft', 'custom')) {
        $directory = Join-Path $root $theme
        $file = Join-Path $directory 'cards.pptx'
        $before = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
        $model = Get-Content -LiteralPath (Join-Path $directory 'model.json') -Raw | ConvertFrom-Json
        $render = Join-Path $directory 'powerpoint'
        $comparisons = Join-Path $directory 'comparisons'
        New-Item -ItemType Directory -Path $render, $comparisons -Force | Out-Null
        $deck = $application.Presentations.Open($file, -1, 0, 0)
        try {
            $pages = @()
            $fixtureCount = $evidence.fixtures.Count
            foreach ($number in 1..$deck.Slides.Count) {
                $name = 'slide-{0:D3}.png' -f $number
                $slide = $deck.Slides.Item($number)
                try {
                    $slide.Export((Join-Path $render $name), 'PNG', 1280, 720)
                    $shapes = @()
                    for ($index = 1; $index -le $slide.Shapes.Count; $index++) {
                        $shape = $slide.Shapes.Item($index)
                        try {
                            $shapes += @{
                                name = $shape.Name; type = $shape.Type; z = $shape.ZOrderPosition
                                x = $shape.Left * 4 / 3; y = $shape.Top * 4 / 3
                                width = $shape.Width * 4 / 3; height = $shape.Height * 4 / 3
                            }
                        } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shape) }
                    }
                    $expectedCards = if ($number -le $fixtureCount) { $evidence.fixtures[$number - 1].expected.Count } else { 0 }
                    $pictures = @($shapes | Where-Object name -EQ 'adaptive-card artwork')
                    if ($pictures.Count -ne $expectedCards) {
                        throw "Slide $number does not have the expected $expectedCards Adaptive Card artwork(s)."
                    }
                    $fallbacks = @($model.slides[$number - 1].fallbacks | Where-Object { $_.type -eq 'adaptive-card' -and $_.artwork -ne $false })
                    $maximumDelta = 0.0
                    for ($card = 0; $card -lt $pictures.Count; $card++) {
                        $fallback = $fallbacks[$card]
                        $expected = @{
                            x = [Math]::Floor($fallback.x); y = [Math]::Floor($fallback.y)
                            width = [Math]::Ceiling($fallback.x + $fallback.width) - [Math]::Floor($fallback.x)
                            height = [Math]::Ceiling($fallback.y + $fallback.height) - [Math]::Floor($fallback.y)
                        }
                        foreach ($dimension in @('x', 'y', 'width', 'height')) {
                            $delta = [Math]::Abs($pictures[$card][$dimension] - $expected[$dimension])
                            $maximumDelta = [Math]::Max($maximumDelta, $delta)
                            if ($delta -gt 0.02) { throw "Slide $number card $card has incorrect PowerPoint $dimension ($delta px)." }
                        }
                    }
                    $pages += @{ page = $number; shapes = $shapes; cardPlacementMaximumDeltaPx = $maximumDelta }
                } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($slide) }
                if ($number -gt $fixtureCount) { continue }
                $original = [Drawing.Image]::FromFile((Join-Path $directory "chromium\$name"))
                $rendered = [Drawing.Image]::FromFile((Join-Path $render $name))
                $bitmap = [Drawing.Bitmap]::new(2560, 720)
                $graphics = [Drawing.Graphics]::FromImage($bitmap)
                try {
                    $graphics.DrawImage($original, 0, 0, 1280, 720)
                    $graphics.DrawImage($rendered, 1280, 0, 1280, 720)
                    $bitmap.Save((Join-Path $comparisons ($name.Replace('.png', '-powerpoint.png'))), [Drawing.Imaging.ImageFormat]::Png)
                } finally { $graphics.Dispose(); $bitmap.Dispose(); $original.Dispose(); $rendered.Dispose() }
            }
            @{ engine = $engine; pages = $pages; slideCount = $deck.Slides.Count; readOnly = $true; pptxSha256 = $before } |
                ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $directory 'powerpoint-report.json')
        } finally {
            $deck.Close()
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($deck)
        }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $before) {
            throw "Read-only PowerPoint review changed $file."
        }
        Write-Output "$theme`: real PowerPoint rendered $fixtureCount fixture pages and the back cover; original PPTX unchanged."
    }
} finally {
    if ($startedEmpty -and $application.Presentations.Count -eq 0) { $application.Quit() }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)
}
