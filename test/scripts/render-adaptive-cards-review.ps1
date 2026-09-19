<#
.SYNOPSIS
Measures actual desktop PowerPoint objects and proves existing-object edits on disposable copies.
.DESCRIPTION
Consumes the review export's evidence.json and theme cards.pptx/model.json/chromium files.
Original presentations are opened read-only and SHA256-checked, including on failures.
Package XML supplies identities only: types, contents, placement and persisted edits are
verified through PowerPoint 16.0 COM. Geometry and TextRange rectangles do not establish
visual acceptance; browser-left/PowerPoint-right PNGs remain a separate review artifact.
#>
param(
    [Parameter(Mandatory = $true)][string]$ArtifactDirectory,
    [ValidateNotNullOrEmpty()]
    [ValidateSet('dark', 'light', 'microsoft', 'custom')]
    [string[]]$Themes = @('dark', 'light', 'microsoft', 'custom')
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$evidence = Get-Content -LiteralPath (Join-Path $root 'evidence.json') -Raw | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
. (Join-Path $PSScriptRoot 'adaptive-cards-powerpoint-evidence.ps1')

$application = New-Object -ComObject PowerPoint.Application
$presentations = $application.Presentations
$initialPresentationCount = $presentations.Count
$startedEmpty = $initialPresentationCount -eq 0
$failures = [Collections.Generic.List[string]]::new()
try {
    $engine = @{
        application = 'PowerPoint desktop'
        version = [string]$application.Version
        fileVersion = (Get-Item -LiteralPath (Join-Path $application.Path 'POWERPNT.EXE')).VersionInfo.FileVersion
        initialPresentationCount = $initialPresentationCount
        renderWidth = 1280; renderHeight = 720
    }
    if ($engine.version -ne '16.0') { throw "This evidence harness requires installed desktop PowerPoint 16.0, not $($engine.version)." }
    foreach ($theme in @($Themes | Select-Object -Unique)) {
        $directory = Join-Path $root $theme
        $file = Join-Path $directory 'cards.pptx'
        $before = $null; $deck = $null; $slides = $null; $archive = $null
        $issues = [Collections.Generic.List[string]]::new()
        $pages = [Collections.Generic.List[object]]::new()
        $reportPath = Join-Path $directory 'powerpoint-report.json'
        $editabilityPath = Join-Path $directory 'editability-report.json'
        $report = [ordered]@{
            schemaVersion = 2; theme = $theme; engine = $engine; createdAt = [DateTime]::UtcNow.ToString('o')
            sourcePptx = $file; pptxSha256 = $null; pptxSha256After = $null; originalUnchanged = $false
            readOnly = $false; slideCount = 0; pages = @()
            mapping = 'Stable zOrder of visible fallback pictures followed by model elements, correlated to package IDs, then verified against actual COM IDs/types/text/bounds.'
            placementPolicy = @{ ordinaryTolerancePx = 0.02; tableOutsideEdgeTolerancePx = 2.0; tableReason = 'Office table grid half-stroke/outside-edge representation.' }
            visualAcceptance = @{ status = 'requires-independent-review'; comparison = 'browser left / actual PowerPoint right'; textRangeRectanglesAreNotBaselines = $true }
            editabilityReport = $null; errors = @(); measuredChecksPassed = $false
        }
        try {
            $before = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
            $report.pptxSha256 = $before
            $model = Get-Content -LiteralPath (Join-Path $directory 'model.json') -Raw | ConvertFrom-Json
            if ($model.width -ne 1280 -or $model.height -ne 720) { throw 'Expected a 1280x720 review model.' }
            $render = Join-Path $directory 'powerpoint'
            $comparisons = Join-Path $directory 'comparisons'
            New-Item -ItemType Directory -Path $render, $comparisons -Force | Out-Null
            $archive = [IO.Compression.ZipFile]::OpenRead($file)
            $deck = Open-ReviewPresentation $presentations $file $true
            $report.readOnly = $deck.ReadOnly -eq -1
            if (-not $report.readOnly) { throw 'The original PPTX was not opened read-only.' }
            $slides = $deck.Slides
            $report.slideCount = [int]$slides.Count
            if ($slides.Count -ne $model.slides.Count) { $issues.Add("Slide count differs: COM $($slides.Count), model $($model.slides.Count).") }
            $setup = $deck.PageSetup
            try {
                if ([Math]::Abs($setup.SlideWidth * 4 / 3 - 1280) -gt 0.02 -or
                    [Math]::Abs($setup.SlideHeight * 4 / 3 - 720) -gt 0.02) {
                    $issues.Add('The actual PowerPoint page setup is not 1280x720 CSS pixels.')
                }
            } finally { Release-ReviewComObject $setup }
            $fixtureCount = @($evidence.fixtures).Count
            if ($fixtureCount -gt $slides.Count) { $issues.Add('Fewer actual slides than review fixtures.') }
            for ($number = 1; $number -le $slides.Count; $number++) {
                $name = 'slide-{0:D3}.png' -f $number
                $slide = $slides.Item($number)
                try {
                    $png = Join-Path $render $name
                    $slide.Export($png, 'PNG', 1280, 720)
                    Assert-ReviewPngSize $png
                    $snapshots = @(Get-ReviewSlideSnapshots $slide)
                    $identities = @(Get-ReviewPackageIdentities $archive $number)
                    $page = Get-ReviewPageEvidence $model.slides[$number - 1] $identities $snapshots $number
                    $page.render = $png
                    $pages.Add($page)
                    foreach ($issue in $page.errors) { $issues.Add("Slide $number`: $issue") }
                    $browser = Join-Path $directory "chromium\$name"
                    if ($number -le $fixtureCount -or (Test-Path -LiteralPath $browser)) {
                        $comparison = Join-Path $comparisons ($name.Replace('.png', '-powerpoint.png'))
                        New-ReviewComparison $browser $png $comparison
                        $page.comparison = $comparison
                    }
                } catch { $issues.Add("Slide $number evidence failed: $($_.Exception.Message)") }
                finally { Release-ReviewComObject $slide }
            }
            Release-ReviewComObject $slides; $slides = $null
            try { Close-ReviewPresentation $deck } finally { $deck = $null }
            $archive.Dispose(); $archive = $null
            $editability = Invoke-ReviewEditability $presentations $file $before $directory @($pages) $engine
            Write-ReviewJson $editability $editabilityPath
            $report.editabilityReport = $editabilityPath
            foreach ($issue in $editability.errors) { $issues.Add("Editability: $issue") }
        } catch { $issues.Add($_.Exception.Message) }
        finally {
            Release-ReviewComObject $slides
            if ($deck) {
                try { Close-ReviewPresentation $deck }
                catch { $issues.Add("Closing owned original presentation failed: $($_.Exception.Message)") }
            }
            if ($archive) { $archive.Dispose() }
            if ($before) {
                $report.pptxSha256After = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
                $report.originalUnchanged = $report.pptxSha256After -eq $before
                if (-not $report.originalUnchanged) { $issues.Add("Read-only review changed original PPTX: $file") }
            }
            $report.pages = @($pages); $report.errors = @($issues)
            $report.measuredChecksPassed = $issues.Count -eq 0
            if (Test-Path -LiteralPath $directory -PathType Container) { Write-ReviewJson $report $reportPath }
        }
        if ($issues.Count -gt 0) {
            $failures.Add("$theme`: $($issues.Count) failed checks; see $reportPath")
            Write-Output $failures[$failures.Count - 1]
        } else {
            Write-Output "$theme`: desktop COM measured $($pages.Count) pages and persisted all five existing-object edits; source SHA256 unchanged. Visual review remains separate."
        }
    }
} finally {
    try {
        if ($startedEmpty -and $presentations.Count -eq 0) { $application.Quit() }
    } finally { Release-ReviewComObject $presentations; Release-ReviewComObject $application }
}
if ($failures.Count -gt 0) { throw ($failures -join "`n") }
