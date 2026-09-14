param(
    [Parameter(Mandatory = $true)][string]$Svg,
    [Parameter(Mandatory = $true)][string]$Out,
    [Parameter(Mandatory = $true)][int]$Width,
    [Parameter(Mandatory = $true)][int]$Height
)

$edge = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Edge not found' }

$svgPath = (Resolve-Path $Svg).Path
$uri = ([uri]("file:///" + ($svgPath -replace '\\', '/'))).AbsoluteUri
$html = @"
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#0B1020;overflow:hidden}
img{display:block;width:${Width}px;height:${Height}px}</style>
<img src="$uri">
"@
$htmlPath = Join-Path ([IO.Path]::GetTempPath()) ("ms-render-" + [guid]::NewGuid().ToString('N') + ".html")
Set-Content -Path $htmlPath -Value $html -Encoding UTF8

$outFull = [IO.Path]::GetFullPath($Out)
$profile = Join-Path ([IO.Path]::GetTempPath()) ("ms-prof-" + [guid]::NewGuid().ToString('N'))

& $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
    --user-data-dir="$profile" --window-size="$Width,$Height" `
    --virtual-time-budget=4000 --screenshot="$outFull" `
    ("file:///" + ($htmlPath -replace '\\', '/')) 2>$null | Out-Null

Remove-Item $htmlPath -ErrorAction SilentlyContinue
Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue

if (Test-Path $outFull) {
    Add-Type -AssemblyName System.Drawing
    $b = [System.Drawing.Bitmap]::FromFile($outFull)
    Write-Host ("OK {0} ({1} x {2})" -f $outFull, $b.Width, $b.Height)
    $b.Dispose()
} else {
    throw "render failed: $outFull"
}
