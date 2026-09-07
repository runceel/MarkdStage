param(
    [Parameter(Mandatory = $true)]
    [string] $ArtifactDirectory
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
Add-Type -AssemblyName System.Drawing
$powerPoint = New-Object -ComObject PowerPoint.Application
$startedEmpty = $powerPoint.Presentations.Count -eq 0
try {
    foreach ($theme in @('dark', 'light', 'microsoft', 'custom')) {
        $directory = Join-Path $root $theme
        $renderDirectory = Join-Path $directory 'powerpoint'
        $comparisonDirectory = Join-Path $directory 'comparisons'
        New-Item -ItemType Directory -Path $renderDirectory, $comparisonDirectory -Force | Out-Null
        $presentation = $powerPoint.Presentations.Open(
            (Join-Path $directory 'editable-hybrid.pptx'), -1, 0, 0)
        try {
            $counts = @()
            foreach ($number in 2..6) {
                $name = 'slide-{0:D3}.png' -f $number
                $slide = $presentation.Slides.Item($number)
                $slide.Export((Join-Path $renderDirectory $name), 'PNG', 1280, 720)
                $counts += @{ page = $number; shapes = $slide.Shapes.Count }
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($slide)
                $original = [System.Drawing.Image]::FromFile((Join-Path $directory "original\$name"))
                $rendered = [System.Drawing.Image]::FromFile((Join-Path $renderDirectory $name))
                $comparison = New-Object System.Drawing.Bitmap(2560, 720)
                $graphics = [System.Drawing.Graphics]::FromImage($comparison)
                try {
                    $graphics.DrawImage($original, 0, 0, 1280, 720)
                    $graphics.DrawImage($rendered, 1280, 0, 1280, 720)
                    $comparison.Save((Join-Path $comparisonDirectory $name), [System.Drawing.Imaging.ImageFormat]::Png)
                } finally {
                    $graphics.Dispose()
                    $comparison.Dispose()
                    $original.Dispose()
                    $rendered.Dispose()
                }
            }
            $counts | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'powerpoint-shape-counts.json')
            Write-Output "$theme`: original left / actual PowerPoint right in $comparisonDirectory"
        } finally {
            $presentation.Close()
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation)
        }
    }
} finally {
    if ($startedEmpty -and $powerPoint.Presentations.Count -eq 0) { $powerPoint.Quit() }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint)
}
