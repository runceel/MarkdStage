param(
    [string]$CliPath = "markdstage.exe",
    [Parameter(Mandatory)][string]$ArtifactsDirectory
)

$ErrorActionPreference = "Stop"
$cli = (Get-Command $CliPath -CommandType Application -ErrorAction Stop).Source
$artifacts = [IO.Path]::GetFullPath($ArtifactsDirectory)
[IO.Directory]::CreateDirectory($artifacts) | Out-Null
$root = Join-Path $artifacts ("activation-" + [Guid]::NewGuid().ToString("N"))
$workspace = Join-Path $root ("workspace " + [char]0x65e5 + [char]0x672c)
$caller = Join-Path $workspace "nested folder"
[IO.Directory]::CreateDirectory($caller) | Out-Null
[IO.File]::WriteAllText((Join-Path $workspace ".git"), "gitdir: acceptance-fixture")
$file = Join-Path $caller ("deck " + [char]0x8a9e + ".md")
[IO.File]::WriteAllText($file, "# Activation acceptance`n`n---`n`n## Second slide")
$results = [Collections.Generic.List[object]]::new()
$windows = [Collections.Generic.HashSet[long]]::new()
$server = $null
$junction = $null

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ActivationTestWindows {
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
}
'@

function Start-Cli([string[]]$Arguments, [string]$Directory = $caller) {
    $start = [Diagnostics.ProcessStartInfo]::new($cli)
    $start.UseShellExecute = $false
    $start.WorkingDirectory = $Directory
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Text.Encoding]::UTF8
    $start.StandardErrorEncoding = [Text.Encoding]::UTF8
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    return [Diagnostics.Process]::Start($start)
}

function Invoke-Cli([string[]]$Arguments = @(), [int]$ExitCode = 0, [string]$Directory = $caller) {
    $process = Start-Cli -Arguments ($Arguments + "--json") -Directory $Directory
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit(120000)) {
            Stop-Process -Id $process.Id
            throw "CLI did not exit after activation."
        }
        $text = $stdout.GetAwaiter().GetResult()
        $errorText = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne $ExitCode) { throw "Exit $($process.ExitCode), expected ${ExitCode}: $text $errorText" }
        if ($errorText.Trim()) { throw "Unexpected stderr with --json: $errorText" }
        $report = $text | ConvertFrom-Json
        if ($report.accepted) {
            if (!$report.ok -or !$report.processId -or !$report.windowId) { throw "Incomplete activation acknowledgment: $text" }
            $windows.Add([long]$report.windowId) | Out-Null
        }
        return $report
    }
    finally { $process.Dispose() }
}

function Assert-Equal($Actual, $Expected) {
    if ($Actual -ne $Expected) { throw "Expected '$Expected', got '$Actual'." }
}

function Test-Case([string]$Name, [scriptblock]$Action) {
    try {
        & $Action
        $results.Add([pscustomobject]@{ name = $Name; status = "PASS" })
    }
    catch {
        $results.Add([pscustomobject]@{ name = $Name; status = "FAIL"; detail = "$_" })
        throw
    }
}

function Assert-Ui([string]$Selector, [long]$WindowId) {
    winapp ui wait-for $Selector -w $WindowId -t 15000 --quiet
    if ($LASTEXITCODE -ne 0) { throw "Missing UI: $Selector" }
}

function Save-Screenshot([string]$Name, [long]$WindowId) {
    winapp ui screenshot -w $WindowId -o (Join-Path $artifacts "$Name.png") --quiet
    if ($LASTEXITCODE -ne 0) { throw "Screenshot failed: $Name" }
}

try {
    Test-Case "Bare invocation uses caller directory without selecting a file" {
        $script:bare = Invoke-Cli
        Assert-Equal $bare.workspace $caller
        Assert-Equal $bare.file $null
        Assert-Ui "OpenMarkdownButton" $bare.windowId
        Save-Screenshot "bare" $bare.windowId
    }
    Test-Case "Direct Unicode/spaced Markdown resolves its Git workspace" {
        $script:direct = Invoke-Cli -Arguments @([IO.Path]::GetFileName($file))
        Assert-Equal $direct.workspace $workspace
        Assert-Equal $direct.file $file
        Assert-Equal $direct.mode "preview"
        Assert-Equal $direct.processId $bare.processId
        if ($direct.windowId -eq $bare.windowId) { throw "Different workspaces reused one window." }
        Assert-Ui "Activation acceptance" $direct.windowId
        Save-Screenshot "preview" $direct.windowId
    }
    Test-Case "Preview and relative explicit workspace reuse existing instance/window" {
        $preview = Invoke-Cli -Arguments @("preview", [IO.Path]::GetFileName($file), "--workspace", "..", "--watch")
        Assert-Equal $preview.workspace $workspace
        Assert-Equal $preview.file $file
        Assert-Equal $preview.processId $direct.processId
        Assert-Equal $preview.windowId $direct.windowId
        [IO.File]::WriteAllText($file, "# Updated acceptance`n`n---`n`n## Second slide")
        Assert-Ui "Updated acceptance" $preview.windowId
        [IO.File]::WriteAllText($file, "# Activation acceptance`n`n---`n`n## Second slide")
        Assert-Ui "Activation acceptance" $preview.windowId
        $script:windowCount = @(winapp ui list-windows -a $direct.processId --json | ConvertFrom-Json).Count
    }
    Test-Case "Present enters presenter view and opens exactly one native audience window" {
        $present = Invoke-Cli -Arguments @("present", $file)
        Assert-Equal $present.windowId $direct.windowId
        Assert-Equal $present.processId $direct.processId
        Assert-Equal $present.mode "present"
        Assert-Ui "presenterReturnButton" $present.windowId
        Assert-Ui "presenterCurrentLabel" $present.windowId
        Assert-Ui "presenterNextLabel" $present.windowId
        Save-Screenshot "presenter" $present.windowId
        $count = @(winapp ui list-windows -a $present.processId --json | ConvertFrom-Json).Count
        Assert-Equal $count ($windowCount + 1)
        $again = Invoke-Cli -Arguments @("present", $file)
        Assert-Equal $again.windowId $present.windowId
        Assert-Equal @(winapp ui list-windows -a $present.processId --json | ConvertFrom-Json).Count $count
    }
    Test-Case "Preview leaves presenter mode and bare explicit workspace shows file list" {
        $preview = Invoke-Cli -Arguments @("preview", $file)
        Assert-Ui "Activation acceptance" $preview.windowId
        Assert-Equal @(winapp ui list-windows -a $preview.processId --json | ConvertFrom-Json).Count $windowCount
        $empty = Invoke-Cli -Arguments @("--workspace", "..")
        Assert-Equal $empty.windowId $direct.windowId
        Assert-Equal $empty.file $null
        Assert-Ui "OpenMarkdownButton" $empty.windowId
    }
    Test-Case "Headless server remains responsive without app activation" {
        $script:server = Start-Cli -Arguments @("preview", $file, "--no-open", "--theme", "light", "--watch", "--json")
        $lines = [Collections.Generic.List[string]]::new()
        do {
            $line = $server.StandardOutput.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(45)).GetAwaiter().GetResult()
            if ($null -eq $line) { throw "Headless server exited without a URL." }
            $lines.Add($line)
        } while ($line -ne "}")
        $report = ($lines -join "`n") | ConvertFrom-Json
        if (!$report.ok -or !$report.url -or $report.accepted) { throw "Invalid server output." }
        $response = Invoke-WebRequest -Uri $report.url -NoProxy
        Assert-Equal $response.StatusCode 200
        Stop-Process -Id $server.Id
        $server.WaitForExit()
        $server.Dispose()
        $script:server = $null
    }
    Test-Case "Input errors, unsupported options and junction confinement stay machine-readable" {
        Assert-Equal (Invoke-Cli -Arguments @("missing.md") -ExitCode 2).error "invalid_input"
        Assert-Equal (Invoke-Cli -Arguments @("preview", "deck.txt") -ExitCode 2).error "invalid_markdown_path"
        Assert-Equal (Invoke-Cli -Arguments @($file, "--workspace", ($caller + "-missing")) -ExitCode 2).error "invalid_input"
        Assert-Equal (Invoke-Cli -Arguments @($file, "--theme", "light") -ExitCode 1).error "usage_error"
        Assert-Equal (Invoke-Cli -Arguments @($file, "--theme-file", "theme.css") -ExitCode 1).error "usage_error"
        Assert-Equal (Invoke-Cli -Arguments @("present") -ExitCode 1).error "usage_error"
        $outside = Join-Path $root "other-workspace"
        [IO.Directory]::CreateDirectory($outside) | Out-Null
        Assert-Equal (Invoke-Cli -Arguments @($file, "--workspace", $outside) -ExitCode 2).error "path_outside_workspace"
        $script:junction = Join-Path $root "junction"
        New-Item -ItemType Junction -Path $junction -Value $workspace | Out-Null
        Assert-Equal (Invoke-Cli -Arguments @("--workspace", $junction) -ExitCode 2).error "path_outside_workspace"
    }
    Test-Case "App-side load failure is rejected rather than reported as accepted" {
        $invalid = Join-Path $workspace "invalid.md"
        [IO.File]::WriteAllText($invalid, "---`nbackground-image: /assets/missing.png`n---`n# Invalid")
        $failure = Invoke-Cli -Arguments @("preview", $invalid) -ExitCode 3
        Assert-Equal $failure.ok $false
        Assert-Equal $failure.error "activation_failed"
        if (!$failure.message) { throw "Activation failure has no explanation." }
    }
}
finally {
    if ($server -and !$server.HasExited) { Stop-Process -Id $server.Id }
    foreach ($window in $windows) {
        [ActivationTestWindows]::PostMessage([IntPtr]$window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (@($windows | Where-Object { [ActivationTestWindows]::IsWindow([IntPtr]$_) }).Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
    }
    try {
        if ($junction) { Remove-Item -LiteralPath $junction -Force }
        Test-Case "Fixture cleanup after native process shutdown" {
            $deadline = [DateTime]::UtcNow.AddSeconds(20)
            while ($true) {
                try { [IO.Directory]::Delete($root, $true); break }
                catch [IO.IOException] {
                    # The process can briefly retain its initial working directory after its last window closes.
                    if ([DateTime]::UtcNow -ge $deadline) { throw }
                    Start-Sleep -Milliseconds 200
                }
            }
        }
    }
    finally {
        $results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $artifacts "activation-results.json") -Encoding utf8
    }
}
$results | Format-Table name, status -AutoSize
