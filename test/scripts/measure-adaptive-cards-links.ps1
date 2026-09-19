param([Parameter(Mandatory = $true)][string]$ArtifactDirectory)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$application = New-Object -ComObject PowerPoint.Application
$startedEmpty = $application.Presentations.Count -eq 0
$report = @{ method = 'Read-only PowerPoint hyperlink character formatting and target; PNG appearance is reviewed separately'; themes = @{} }
try {
    foreach ($theme in @('dark', 'light', 'microsoft', 'custom')) {
        $directory = Join-Path $root $theme
        $file = Join-Path $directory 'cards.pptx'
        $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
        $model = Get-Content -LiteralPath (Join-Path $directory 'model.json') -Raw | ConvertFrom-Json
        $deck = $application.Presentations.Open($file, -1, 0, 0)
        $links = @()
        try {
            for ($page = 0; $page -lt $model.slides.Count; $page++) {
                $elements = @($model.slides[$page].elements | Where-Object {
                    $_.adaptiveCard -and $_.type -eq 'text' -and $_.paragraphs[0].runs[0].href
                })
                if (-not $elements.Count) { continue }
                $slide = $deck.Slides.Item($page + 1)
                try {
                    foreach ($element in $elements) {
                        $run = $element.paragraphs[0].runs[0]
                        if ($run.color -notmatch '^#[0-9a-fA-F]{6}$') { throw "Unsupported witness color $($run.color)." }
                        $expectedRgb = [Convert]::ToInt32($run.color.Substring(1, 2), 16) +
                            256 * [Convert]::ToInt32($run.color.Substring(3, 2), 16) +
                            65536 * [Convert]::ToInt32($run.color.Substring(5, 2), 16)
                        $matchCount = 0
                        for ($index = 1; $index -le $slide.Shapes.Count; $index++) {
                            $shape = $slide.Shapes.Item($index)
                            try {
                                if ($shape.HasTextFrame -ne -1 -or $shape.TextFrame.HasText -ne -1) { continue }
                                $range = $shape.TextFrame.TextRange
                                try {
                                    if ($range.Text -ne $run.text) { continue }
                                    $matchCount++
                                    # The whole TextRange includes the paragraph marker,
                                    # whose default color is not the hyperlink run's color.
                                    $characters = $range.Characters(1, $run.text.Length)
                                    try {
                                        $actualRgb = $characters.Font.Color.RGB
                                        $underline = $characters.Font.Underline -eq -1
                                        $href = $characters.ActionSettings.Item(1).Hyperlink.Address
                                    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($characters) }
                                    if ($actualRgb -ne $expectedRgb -or $underline -ne [bool]$run.underline -or $href -ne $run.href) {
                                        throw "Slide $($page + 1), $($element.path): RGB $actualRgb/$expectedRgb, underline $underline/$([bool]$run.underline), target '$href'/'$($run.href)' differ."
                                    }
                                    $links += @{ page = $page + 1; sourcePath = $element.path; text = $range.Text
                                        color = $run.color; actualRgb = $actualRgb; underline = $underline; href = $href }
                                } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($range) }
                            } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shape) }
                        }
                        if ($matchCount -ne 1) { throw "Expected one existing hyperlink label at $($element.path), found $matchCount." }
                    }
                } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($slide) }
            }
        } finally { $deck.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($deck) }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hash) { throw "Read-only link review changed $file." }
        if ($links.Count -lt 3) { throw "$theme lacks the required native link witnesses." }
        $report.themes[$theme] = @{ links = $links; readOnly = $true; sourceSha256 = $hash }
        Write-Output "$theme`: $($links.Count) real native hyperlink labels retain their exact color, underline and target."
    }
} finally {
    if ($startedEmpty -and $application.Presentations.Count -eq 0) { $application.Quit() }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $root 'powerpoint-link-measurements.json')
}
