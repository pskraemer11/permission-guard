#Requires -Version 7
<#
.SYNOPSIS
    Bringt den aktuellen Commit über Branch und Pull Request nach main.

.DESCRIPTION
    Ersetzt die sechs Schritte von Hand: Branch anlegen, main zuruecksetzen,
    pushen, PR anlegen, Pruefungen abwarten, mergen, main nachziehen.

    Bricht ab, wenn eine Pruefung rot ist; der Branch bleibt dann stehen und
    nichts wird gemergt. Ohne -Branch wird ein Name aus Datum und Uhrzeit
    gebildet.

    Voraussetzung: sauberer Arbeitsbaum, aktueller Branch main, mindestens ein
    Commit vor origin/main, gh angemeldet.

.PARAMETER Branch
    Name des Arbeitszweigs. Ohne Angabe welle-<yyyyMMdd-HHmm>.

.PARAMETER DryRun
    Zeigt nur, was geschehen wuerde.

.EXAMPLE
    pwsh -NoProfile -File .\scripts\ship.ps1
#>
param(
    [string]$Branch = "",
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    function Invoke-Git([string[]]$Arguments) {
        $out = & git @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') fehlgeschlagen:`n$out" }
        return ($out | Out-String).Trim()
    }

    $dirty = Invoke-Git @('status', '--porcelain')
    if ($dirty) { throw "Arbeitsbaum ist nicht sauber:`n$dirty" }

    $current = Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')
    if ($current -ne 'main') { throw "Aktueller Branch ist '$current', erwartet 'main'." }

    $ahead = [int](Invoke-Git @('rev-list', '--count', 'origin/main..HEAD'))
    if ($ahead -lt 1) { throw 'Kein Commit vor origin/main - nichts zu liefern.' }
    if (-not $Branch) { $Branch = 'welle-' + (Get-Date -Format 'yyyyMMdd-HHmm') }

    $steps = @(
        "git branch $Branch",
        "git reset --hard origin/main",
        "git switch $Branch",
        "git push -u origin $Branch",
        "gh pr create --base main --head $Branch --fill",
        "gh pr checks --watch",
        "gh pr merge --merge --delete-branch",
        "git switch main",
        "git pull --ff-only"
    )
    if ($DryRun) {
        "Branch: $Branch ($ahead Commit(s))"
        $steps | ForEach-Object { "  $_" }
        return
    }

    Invoke-Git @('branch', $Branch) | Out-Null
    Invoke-Git @('reset', '--hard', 'origin/main') | Out-Null
    Invoke-Git @('switch', $Branch) | Out-Null
    "Branch $Branch angelegt ($ahead Commit(s))."

    Invoke-Git @('push', '-u', 'origin', $Branch) | Out-Null
    "Gepusht."

    & gh pr create --base main --head $Branch --fill
    if ($LASTEXITCODE -ne 0) { throw 'PR konnte nicht angelegt werden.' }

    & gh pr checks --watch
    if ($LASTEXITCODE -ne 0) {
        throw "Pruefungen nicht bestanden. Branch $Branch bleibt stehen; main ist unveraendert."
    }

    & gh pr merge --merge --delete-branch
    if ($LASTEXITCODE -ne 0) { throw 'Merge fehlgeschlagen.' }

    Invoke-Git @('switch', 'main') | Out-Null
    Invoke-Git @('pull', '--ff-only') | Out-Null
    "Fertig: $Branch gemergt, main nachgezogen."
} finally {
    Pop-Location
}
