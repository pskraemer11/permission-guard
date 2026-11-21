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

    # Nur verfolgte Aenderungen blockieren. Unversionierte Dateien (Screenshots,
    # review/) bleiben unberuehrt und werden nur genannt - sie sind nicht Teil
    # des Commits, und der Commit ist das, was hier ausgeliefert wird.
    $dirty = Invoke-Git @('status', '--porcelain', '--untracked-files=no')
    if ($dirty) { throw "Arbeitsbaum ist nicht sauber:`n$dirty" }
    $untracked = Invoke-Git @('ls-files', '--others', '--exclude-standard')
    if ($untracked) {
        Write-Host 'Hinweis: unversionierte Dateien bleiben unberuehrt:'
        $untracked -split "`n" | ForEach-Object { Write-Host "  $_" }
    }

    $current = Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')
    $resume = $current -ne 'main'
    if ($resume -and $current -notlike 'welle-*') {
        throw "Aktueller Branch ist '$current', erwartet 'main' oder ein Wellen-Branch ('welle-*')."
    }

    $ahead = [int](Invoke-Git @('rev-list', '--count', 'origin/main..HEAD'))
    if ($ahead -lt 1) { throw 'Kein Commit vor origin/main - nichts zu liefern.' }

    if ($resume) {
        # Fortsetzen: ein frueherer Lauf hat Branch, Reset und Push schon
        # erledigt und ist an den Pruefungen oder am PR gescheitert. Ein zweiter
        # Lauf darf weder den Branch neu anlegen noch main erneut zuruecksetzen.
        $Branch = $current
    }
    elseif (-not $Branch) {
        $Branch = 'welle-' + (Get-Date -Format 'yyyyMMdd-HHmm')
    }

    $steps = if ($resume) {
        @(
            "git push -u origin $Branch",
            "gh pr list --head $Branch --state open (PR weiterverwenden, sonst anlegen)",
            "gh pr checks --watch --required",
            "gh pr checks --json state,name (Suche nach FAILURE)",
            "gh pr merge --merge --delete-branch",
            "git switch main",
            "git pull --ff-only"
        )
    }
    else {
        @(
            "git branch $Branch",
            "git reset --hard origin/main",
            "git switch $Branch",
            "git push -u origin $Branch",
            "gh pr create --base main --head $Branch --fill",
            "gh pr checks --watch --required",
            "gh pr checks --json state,name (Suche nach FAILURE)",
            "gh pr merge --merge --delete-branch",
            "git switch main",
            "git pull --ff-only"
        )
    }
    if ($DryRun) {
        if ($resume) { "Setze fort auf $Branch ($ahead Commit(s) vor origin/main)" }
        else { "Branch: $Branch ($ahead Commit(s))" }
        $steps | ForEach-Object { "  $_" }
        return
    }

    if ($resume) {
        "Setze fort auf $Branch ($ahead Commit(s) vor origin/main)."
    }
    else {
        Invoke-Git @('branch', $Branch) | Out-Null
        Invoke-Git @('reset', '--hard', 'origin/main') | Out-Null
        Invoke-Git @('switch', $Branch) | Out-Null
        "Branch $Branch angelegt ($ahead Commit(s))."
    }

    Invoke-Git @('push', '-u', 'origin', $Branch) | Out-Null
    "Gepusht."

    # Ein vorhandener offener PR wird weiterverwendet; nur ohne PR wird einer
    # angelegt. Sonst scheitert der zweite Lauf an "already exists".
    $existing = (& gh pr list --head $Branch --state open --json number --jq '.[0].number' | Out-String).Trim()
    if ($existing) {
        "PR #$existing wird weiterverwendet."
    }
    else {
        & gh pr create --base main --head $Branch --fill
        if ($LASTEXITCODE -ne 0) { throw 'PR konnte nicht angelegt werden.' }
    }

    # Nur die erforderlichen Pruefungen blockieren. GitHub laesst gelegentlich
    # einen fertig gelaufenen Job auf "in_progress" stehen - Status und
    # conclusion widersprechen sich dann, und --watch ohne --required wartet
    # endlos (Vorfall 21.11.2026, Job "Zeilenenden und BOM"). Ein Fehlschlag
    # unter den optionalen Pruefungen zaehlt weiterhin.
    # Direkt nach dem Push sind die Pruefungen noch nicht registriert; gh meldet
    # dann "no checks reported" und endet mit Exit 1. Das ist kein Fehlschlag,
    # sondern zu frueh - deshalb warten und erneut versuchen (max. 3 Minuten).
    # Jeder andere Exitcode ist ein echtes Ergebnis und bricht sofort ab.
    $deadline = (Get-Date).AddMinutes(3)
    while ($true) {
        $report = (& gh pr checks --watch --required 2>&1 | Out-String)
        if ($LASTEXITCODE -eq 0) { break }
        if ($report -notmatch 'no checks reported' -or (Get-Date) -gt $deadline) {
            throw "Erforderliche Pruefungen nicht bestanden. Branch $Branch bleibt stehen; main ist unveraendert.`n$($report.Trim())"
        }
        Start-Sleep -Seconds 5
    }

    $failed = & gh pr checks --json state,name --jq '[.[] | select(.state == "FAILURE") | .name] | join(", ")'
    if ($failed) {
        throw "Pruefung fehlgeschlagen: $failed. Branch $Branch bleibt stehen; main ist unveraendert."
    }

    & gh pr merge --merge --delete-branch
    if ($LASTEXITCODE -ne 0) { throw 'Merge fehlgeschlagen.' }

    Invoke-Git @('switch', 'main') | Out-Null
    Invoke-Git @('pull', '--ff-only') | Out-Null
    "Fertig: $Branch gemergt, main nachgezogen."
} finally {
    Pop-Location
}
