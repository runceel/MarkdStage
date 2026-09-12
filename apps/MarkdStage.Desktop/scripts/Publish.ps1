param(
    [ValidateSet("x64", "arm64")]
    [string]$Architecture = "x64",
    [string]$Configuration = "Release",
    [ValidateSet("Msix", "Archive")]
    [string]$Format = "Msix",
    [string]$CertificatePath,
    [string]$CertificatePassword,
    [string]$Publisher,
    [string]$PackageName,
    [string]$Version,
    [string]$TimestampUrl,
    [switch]$Unsigned
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex {
    param(
        [Parameter(Mandatory)]
        [byte[]]$Bytes
    )

    $digest = [Security.Cryptography.SHA256]::HashData($Bytes)
    return [Convert]::ToHexString($digest).ToLowerInvariant()
}

function Test-VendorAssetIntegrity {
    param(
        [Parameter(Mandatory)]
        [string]$VendorDirectory
    )

    $manifestPath = Join-Path $VendorDirectory "vendor-assets.lock.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Publish output is missing Web\vendor\vendor-assets.lock.json"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $asset = $manifest.assets.'mermaid.min.js'
    $chunks = @($asset.chunks)
    if ($null -eq $asset -or $chunks.Count -eq 0) {
        throw "Vendor asset manifest is missing mermaid.min.js chunks."
    }

    $combinedHash = [Security.Cryptography.IncrementalHash]::CreateHash(
        [Security.Cryptography.HashAlgorithmName]::SHA256)
    $totalLength = [long]0
    try {
        for ($index = 0; $index -lt $chunks.Count; $index++) {
            $chunk = $chunks[$index]
            $name = [string]$chunk.file
            if ([int]$chunk.index -ne ($index + 1) -or [string]::IsNullOrWhiteSpace($name)) {
                throw "Vendor asset manifest contains an invalid Mermaid chunk entry."
            }

            $chunkPath = Join-Path $VendorDirectory $name
            if (-not (Test-Path -LiteralPath $chunkPath -PathType Leaf)) {
                throw "Publish output is missing Web\vendor\$name"
            }

            $bytes = [IO.File]::ReadAllBytes($chunkPath)
            if ($bytes.LongLength -ne [long]$chunk.size) {
                throw "$name failed size verification."
            }

            $actualHash = Get-Sha256Hex -Bytes $bytes
            $expectedHash = [string]$chunk.sha256
            if (-not $actualHash.Equals($expectedHash, [StringComparison]::OrdinalIgnoreCase)) {
                throw "$name failed SHA-256 verification."
            }

            $combinedHash.AppendData($bytes)
            $totalLength += $bytes.LongLength
        }

        $actualCombinedHash = [Convert]::ToHexString(
            $combinedHash.GetHashAndReset()).ToLowerInvariant()
    }
    finally {
        $combinedHash.Dispose()
    }

    if ($totalLength -ne [long]$asset.size) {
        throw "mermaid.min.js failed size verification."
    }

    $expectedCombinedHash = [string]$asset.sha256
    if (-not $actualCombinedHash.Equals(
        $expectedCombinedHash,
        [StringComparison]::OrdinalIgnoreCase)) {
        throw "mermaid.min.js failed SHA-256 verification."
    }
}

function Test-PeSubsystem {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][int]$ExpectedSubsystem
    )
    $stream = [IO.File]::OpenRead($Path)
    $reader = [IO.BinaryReader]::new($stream)
    try {
        if ($reader.ReadUInt16() -ne 0x5a4d) { throw "Invalid executable: $Path" }
        $stream.Position = 0x3c
        $peOffset = $reader.ReadUInt32()
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x4550) { throw "Invalid PE executable: $Path" }
        $stream.Position = $peOffset + 24 + 68
        if ($reader.ReadUInt16() -ne $ExpectedSubsystem) {
            throw "The executable has the wrong Windows subsystem: $Path"
        }
    }
    finally { $reader.Dispose(); $stream.Dispose() }
}

$appRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$project = Join-Path $appRoot "src\MarkdStage.App\MarkdStage.App.csproj"
$cliProject = Join-Path $appRoot "src\MarkdStage.Cli\MarkdStage.Cli.csproj"
$runtime = "win-$Architecture"
$platform = if ($Architecture -eq "arm64") { "ARM64" } else { "x64" }
$output = Join-Path $appRoot "artifacts\$runtime"
$msix = Join-Path $appRoot "artifacts\MarkdStage-$runtime.msix"
$archive = Join-Path $appRoot "artifacts\MarkdStage-$runtime.zip"

if (-not $IsWindows) {
    throw "Desktop publishing requires Windows and the Windows SDK build tools."
}
if ($Format -eq "Archive") {
    $repositoryRoot = Resolve-Path (Join-Path $appRoot "..\..")
    $sourceVersion = (Get-Content -LiteralPath (Join-Path $repositoryRoot "packages\markdstage-cli\package.json") -Raw |
        ConvertFrom-Json).version
    if (([version]($sourceVersion -split '-')[0]).Major -ge 4 -or
        ($Version -and ([version]$Version).Major -ge 4) -or
        ($env:GITHUB_REF_NAME -match '^v?([0-9]+)\.' -and [int]$Matches[1] -ge 4)) {
        throw "Archive format is only supported for pre-v4 releases. Use MSIX for the Store cutover."
    }
    if ($CertificatePath -or $CertificatePassword -or $Unsigned -or $Publisher -or $PackageName -or $TimestampUrl) {
        throw "Signing and package-identity options apply only to -Format Msix."
    }
}
else {
    if (-not $Unsigned -and [string]::IsNullOrWhiteSpace($CertificatePath)) {
        throw "Provide -CertificatePath for a signed package, or -Unsigned for Store submission."
    }
    if ($Unsigned -and $CertificatePath) {
        throw "-Unsigned and -CertificatePath are mutually exclusive."
    }
    $winapp = Get-Command winapp -ErrorAction Stop
}

if (Test-Path $output) {
    Remove-Item $output -Recurse -Force
}
$artifact = if ($Format -eq "Archive") { $archive } else { $msix }
if (Test-Path $artifact) {
    Remove-Item $artifact -Force
}

dotnet publish $project `
    -c $Configuration `
    -r $runtime `
    -p:Platform=$platform `
    -p:SelfContained=true `
    -p:WindowsAppSDKSelfContained=true `
    -p:PublishSingleFile=false `
    -p:PublishTrimmed=false `
    -p:PublishReadyToRun=false `
    -o $output
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

dotnet publish $cliProject `
    -c $Configuration `
    -r $runtime `
    -p:Platform=$platform `
    -p:SelfContained=true `
    -p:WindowsAppSDKSelfContained=true `
    -p:PublishSingleFile=false `
    -p:PublishTrimmed=false `
    -p:PublishReadyToRun=false `
    -o $output
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$required = @(
    "MarkdStageApp.exe",
    "MarkdStageApp.dll",
    "MarkdStageCli.exe",
    "MarkdStageCli.dll",
    "MarkdStageCli.runtimeconfig.json",
    "appxmanifest.xml",
    "CliData\commands.json",
    "CliData\host.html",
    "CliData\host.mjs",
    "Shared\runtime\host-bootstrap.mjs",
    "Shared\runtime\portable-output.mjs",
    "Shared\runtime\io-host.mjs",
    "Shared\markdown-deck.mjs",
    "Shared\schema\theme-v1.json",
    "App.xbf",
    "MainPage.xbf",
    "MainWindow.xbf",
    "PresenterWindow.xbf",
    "MarkdStageApp.pri",
    "Assets\AppIcon.ico",
    "Web\index.html",
    "Web\renderer\renderer.js",
    "Web\vendor\vendor-assets.lock.json",
    "SurfacePen\pen-button-listener.ps1",
    "THIRD-PARTY-NOTICES.md"
)
foreach ($relative in $required) {
    if (-not (Test-Path (Join-Path $output $relative) -PathType Leaf)) {
        throw "Publish output is missing $relative"
    }
}

Test-VendorAssetIntegrity -VendorDirectory (Join-Path $output "Web\vendor")
Test-PeSubsystem -Path (Join-Path $output "MarkdStageApp.exe") -ExpectedSubsystem 2
Test-PeSubsystem -Path (Join-Path $output "MarkdStageCli.exe") -ExpectedSubsystem 3

if ($Format -eq "Archive") {
    Compress-Archive -Path (Join-Path $output "*") -DestinationPath $archive -CompressionLevel Optimal
    $checksum = "$archive.sha256"
    $hash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $(Split-Path $archive -Leaf)" | Set-Content -Encoding ascii $checksum
    Write-Output $archive
    Write-Output $checksum
    return
}

$manifestPath = Join-Path $output "appxmanifest.xml"
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
$identity = $manifest.Package.Identity
$identity.SetAttribute("ProcessorArchitecture", $Architecture)
if ($Publisher) { $identity.SetAttribute("Publisher", $Publisher) }
if ($PackageName) { $identity.SetAttribute("Name", $PackageName) }
if ($Version) {
    $parsed = [version]$Version
    if ($parsed.Revision -ne 0 -or $parsed.Major -lt 1 -or
        $parsed.Major -gt 65535 -or $parsed.Minor -lt 0 -or $parsed.Minor -gt 65535 -or
        $parsed.Build -lt 0 -or $parsed.Build -gt 65535) {
        throw "Store package versions must have four parts, a nonzero major, and a zero revision."
    }
    $identity.SetAttribute("Version", $Version)
}
if ($identity.Publisher -eq "CN=AppPublisher" -and [string]::IsNullOrWhiteSpace($Publisher)) {
    throw "Supply -Publisher matching the signing certificate or Partner Center identity."
}
$applications = @($manifest.Package.Applications.Application)
if ($applications.Count -ne 1 -or $applications[0].Executable -ne "MarkdStageApp.exe") {
    throw "The package must have one application entry targeting MarkdStageApp.exe."
}
$manifest.Save($manifestPath)

$names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($file in Get-ChildItem -LiteralPath $output -Recurse -File) {
    $relative = [IO.Path]::GetRelativePath($output, $file.FullName)
    if (-not $names.Add($relative)) { throw "Case-colliding package file: $relative" }
    if ($file.Name -eq "node.exe" -or $relative -match '(^|[\\/])node_modules([\\/]|$)') {
        throw "The native package must not carry a Node runtime or node_modules."
    }
}
foreach ($script in Get-ChildItem -LiteralPath (Join-Path $output "Shared") -Recurse -File -Include *.mjs,*.js) {
    if ((Get-Content -LiteralPath $script.FullName -Raw) -match '(?m)(?:from\s*|import\s*(?:\(\s*)?)["'']node:') {
        throw "The packaged Shared graph contains a Node import: $($script.Name)"
    }
}

$packageArguments = @("pack", $output, "--output", $msix, "--executable", "MarkdStageApp.exe", "--self-contained")
if (-not $Unsigned) {
    $packageArguments += @("--cert", (Resolve-Path -LiteralPath $CertificatePath).Path)
    if ($CertificatePassword) { $packageArguments += @("--cert-password", $CertificatePassword) }
}
& $winapp.Source @packageArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path -LiteralPath $msix -PathType Leaf)) { throw "winapp did not produce the requested MSIX." }
if ($TimestampUrl -and -not $Unsigned) {
    $signTool = Get-Command signtool -ErrorAction Stop
    & $signTool.Source timestamp /tr $TimestampUrl /td SHA256 $msix
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$checksum = "$msix.sha256"
$hash = (Get-FileHash $msix -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $msix -Leaf)" | Set-Content -Encoding ascii $checksum
Write-Output $msix
Write-Output $checksum
