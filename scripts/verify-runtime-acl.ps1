#Requires -Version 7
<#
.SYNOPSIS
    Prueft die Dateirechte der permission-guard-Laufzeitkopien.

.DESCRIPTION
    Schreiberlaubnis duerfen nur der Eigner, Administratoren und SYSTEM haben.
    Jede andere Identität mit Schreibrechten (Write, Modify, FullControl,
    Delete) meldet FAIL. Das schuetzt vor fremden Benutzern auf dem Rechner,
    nicht vor dem Eigner selbst - das bleibt eine ehrliche Grenze.

    Exit 0 = alle Dateien in Ordnung, 1 = mindestens eine Datei faellt durch
    oder fehlt. Mit -Fix werden die beanstandeten Eintraege entfernt und
    danach erneut geprueft.

.PARAMETER Target
    Zielverzeichnis des OpenCode-Plugins.

.PARAMETER CodexTarget
    Zielverzeichnis des Codex-Guards.

.PARAMETER Fix
    Beanstandete Schreibrechte entfernen statt nur zu melden.

.EXAMPLE
    pwsh -File .\scripts\verify-runtime-acl.ps1

.EXAMPLE
    pwsh -File .\scripts\verify-runtime-acl.ps1 -Fix
#>
[CmdletBinding()]
param(
    [string]$Target = (Join-Path $HOME ".config\opencode\plugins\permission-guard"),
    [string]$CodexTarget = (Join-Path $HOME ".codex\hooks"),
    [switch]$Fix
)

$ErrorActionPreference = "Stop"

# Dieselbe Dateiliste wie deploy.ps1 (dort die Quelle der Wahrheit).
$pluginFiles = @(
    "guard.js", "index.js", "reviewer.js", "audit.js", "diagnostics.js",
    "shadow.js", "git-shadow-report.mjs", "verify-audit.mjs", "mcp-report.mjs",
    "stats.mjs", "README.md", "README_de.md", "start-reviewer.ps1",
    "bench-reviewer.ps1", "bench-quality.ps1", "shell-reviewer.config.json"
)
$codexFiles = @("codex_guard.py")

$writePattern = "Write|CreateFiles|AppendData|Modify|FullControl|Delete"

function Get-OffendingWriters {
    param([System.Security.AccessControl.FileSecurity]$Acl)
    $ownerSid = $null
    try { $ownerSid = $Acl.OwnerSid.Value } catch { $ownerSid = $null }
    if (-not $ownerSid) {
        try { $ownerSid = (New-Object System.Security.Principal.NTAccount($Acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $ownerSid = $null }
    }
    $trustedSids = @($ownerSid, "S-1-5-18", "S-1-5-32-544")  # SYSTEM, Administratoren
    $offending = @()
    foreach ($rule in $Acl.Access) {
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
        if ($rule.FileSystemRights.ToString() -notmatch $writePattern) { continue }
        $sid = $null
        try {
            $sid = ([System.Security.Principal.SecurityIdentifier]$rule.IdentityReference).Value
        } catch {
            try {
                $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
            } catch { $sid = $null }
        }
        if ($sid -and $trustedSids -contains $sid) { continue }
        if ($rule.IdentityReference.ToString() -ieq $Acl.Owner) { continue }
        $offending += $rule
    }
    return $offending
}

function Test-AclFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return @{ Ok = $false; Detail = "fehlt" }
    }
    $acl = Get-Acl -LiteralPath $Path
    $offending = Get-OffendingWriters -Acl $acl
    if ($offending.Count -eq 0) {
        return @{ Ok = $true; Detail = "" }
    }
    $names = $offending | ForEach-Object { $_.IdentityReference.ToString() }
    if ($Fix) {
        foreach ($rule in $offending) { [void]$acl.RemoveAccessRule($rule) }
        Set-Acl -LiteralPath $Path -AclObject $acl
        $again = Get-OffendingWriters -Acl (Get-Acl -LiteralPath $Path)
        if ($again.Count -eq 0) {
            return @{ Ok = $true; Detail = "repariert: $($names -join ', ')" }
        }
        return @{ Ok = $false; Detail = "Fix wirkungslos: $($names -join ', ')" }
    }
    return @{ Ok = $false; Detail = "Schreibrecht fuer: $($names -join ', ')" }
}

$failures = 0
foreach ($pair in @(@($Target, $pluginFiles), @($CodexTarget, $codexFiles))) {
    foreach ($leaf in $pair[1]) {
        $path = Join-Path $pair[0] $leaf
        $result = Test-AclFile -Path $path
        if ($result.Ok) {
            Write-Host ("  {0,-28} ok{1}" -f $leaf, $(if ($result.Detail) { " ($($result.Detail))" } else { "" }))
        }
        else {
            Write-Host ("  {0,-28} FAIL: {1}" -f $leaf, $result.Detail) -ForegroundColor Red
            $failures++
        }
    }
}

if ($failures -gt 0) {
    throw "ACL-Pruefung fehlgeschlagen ($failures Datei(en))."
}
Write-Host "ACL-Pruefung bestanden."
