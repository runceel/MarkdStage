param(
    [string]$Configuration = "Release",
    [string]$PackageName,
    [string]$Publisher,
    [string]$Version
)

$ErrorActionPreference = "Stop"

function Resolve-WindowsSdkTool {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    $tool = Get-ChildItem -LiteralPath $kitsRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName "x64\$Name.exe" } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if (-not $tool) {
        throw "$Name.exe was not found. Install the Windows SDK build tools."
    }
    return $tool
}

if (-not $IsWindows) {
    throw "Store package creation requires Windows and the Windows SDK build tools."
}

$appRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repositoryRoot = Resolve-Path (Join-Path $appRoot "..\..")
$manifestPath = Join-Path $appRoot "src\MarkdStage.App\Package.appxmanifest"
$publishScript = Join-Path $PSScriptRoot "Publish.ps1"
$artifacts = Join-Path $appRoot "artifacts"
$storeBuild = Join-Path $artifacts "store-upload"
$bundleInput = Join-Path $storeBuild "bundle"
$bundle = Join-Path $storeBuild "MarkdStage-Store.msixbundle"
$bundleValidation = Join-Path $storeBuild "validation"
$upload = Join-Path $artifacts "MarkdStage-Store.msixupload"

[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
$identity = $manifest.Package.Identity
if ([string]::IsNullOrWhiteSpace($PackageName)) {
    $PackageName = [string]$identity.Name
}
if ([string]::IsNullOrWhiteSpace($Publisher)) {
    $Publisher = [string]$identity.Publisher
}
if ([string]::IsNullOrWhiteSpace($Version)) {
    $productVersion = (Get-Content -LiteralPath (
        Join-Path $repositoryRoot "packages\markdstage-cli\package.json") -Raw |
        ConvertFrom-Json).version
    $Version = "$productVersion.0"
}

$parsedVersion = [version]$Version
if ($parsedVersion.Revision -ne 0 -or $parsedVersion.Major -lt 1) {
    throw "Store package versions must use major.minor.patch.0 with a nonzero major."
}

if (Test-Path -LiteralPath $storeBuild) {
    Remove-Item -LiteralPath $storeBuild -Recurse -Force
}
if (Test-Path -LiteralPath $upload) {
    Remove-Item -LiteralPath $upload -Force
}
New-Item -ItemType Directory -Path $bundleInput -Force | Out-Null

foreach ($architecture in @("x64", "arm64")) {
    & $publishScript `
        -Architecture $architecture `
        -Configuration $Configuration `
        -Unsigned `
        -PackageName $PackageName `
        -Publisher $Publisher `
        -Version $Version
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    $package = Join-Path $artifacts "MarkdStage-win-$architecture.msix"
    if (-not (Test-Path -LiteralPath $package -PathType Leaf)) {
        throw "The $architecture Store package was not created."
    }
    Copy-Item -LiteralPath $package -Destination $bundleInput
}

$makeAppx = Resolve-WindowsSdkTool -Name "makeappx"
& $makeAppx bundle /d $bundleInput /p $bundle /o
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
& $makeAppx unbundle /p $bundle /d $bundleValidation /o
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
$bundledPackages = @(Get-ChildItem -LiteralPath $bundleValidation -File -Filter *.msix)
if ($bundledPackages.Count -ne 2) {
    throw "The Store bundle must contain exactly two architecture packages."
}
$architectures = @($bundledPackages | ForEach-Object {
    if ($_.Name -match '[-_](x64|arm64)\.msix$') { $Matches[1] }
})
if (@($architectures | Sort-Object -Unique).Count -ne 2) {
    throw "The Store bundle must contain x64 and ARM64 packages."
}

$uploadStage = Join-Path $storeBuild "upload"
New-Item -ItemType Directory -Path $uploadStage -Force | Out-Null
Copy-Item -LiteralPath $bundle -Destination $uploadStage
[IO.Compression.ZipFile]::CreateFromDirectory($uploadStage, $upload)

$checksum = "$upload.sha256"
$hash = (Get-FileHash $upload -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $upload -Leaf)" | Set-Content -Encoding ascii $checksum

Write-Output $upload
Write-Output $checksum
