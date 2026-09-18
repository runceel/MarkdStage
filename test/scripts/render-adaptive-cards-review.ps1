param([Parameter(Mandatory = $true)][string]$ArtifactDirectory)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
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
        $render = Join-Path $directory 'powerpoint'
        $comparisons = Join-Path $directory 'comparisons'
        New-Item -ItemType Directory -Path $render, $comparisons -Force | Out-Null
        $deck = $application.Presentations.Open($file, -1, 0, 0)
        try {
            $pages = @()
            foreach ($number in 1..7) {
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
                    if (@($shapes | Where-Object name -EQ 'adaptive-card artwork').Count -ne 1) {
                        throw "Slide $number does not have exactly one Adaptive Card artwork."
                    }
                    $pages += @{ page = $number; shapes = $shapes }
                } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($slide) }
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
            @{ engine = $engine; pages = $pages; slideCount = $deck.Slides.Count; readOnly = $true } |
                ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $directory 'powerpoint-report.json')
        } finally {
            $deck.Close()
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($deck)
        }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $before) {
            throw "Read-only PowerPoint review changed $file."
        }
        Write-Output "$theme`: real PowerPoint rendered seven fixture pages; original PPTX unchanged."
    }
} finally {
    if ($startedEmpty -and $application.Presentations.Count -eq 0) { $application.Quit() }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)
}
