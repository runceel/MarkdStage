param(
    [Parameter(Mandatory = $true)][string]$InFile,
    [Parameter(Mandatory = $true)][string]$OutFile,
    # Rectangles to fill: "x,y,w,h" (one or more)
    [Parameter(Mandatory = $true)][string[]]$Rect,
    # Pixel to sample the fill color from: "x,y". Omit to use black.
    [string]$SampleFrom
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $InFile).Path)
$bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($src, 0, 0, $src.Width, $src.Height)

$color = [System.Drawing.Color]::Black
if ($SampleFrom) {
    $sp = $SampleFrom -split ','
    $color = $src.GetPixel([int]$sp[0], [int]$sp[1])
}
Write-Host ("fill color: R={0} G={1} B={2}" -f $color.R, $color.G, $color.B)

$brush = New-Object System.Drawing.SolidBrush $color
foreach ($r in $Rect) {
    $p = $r -split ','
    $g.FillRectangle($brush, [int]$p[0], [int]$p[1], [int]$p[2], [int]$p[3])
    Write-Host "masked $r"
}

$g.Dispose()
$bmp.Save((Join-Path (Split-Path -Parent (Resolve-Path $InFile).Path) '__tmp_mask.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$src.Dispose()
$brush.Dispose()

$tmp = Join-Path (Split-Path -Parent (Resolve-Path $InFile).Path) '__tmp_mask.png'
Move-Item -Force $tmp $OutFile
Write-Host "SAVED $OutFile"
