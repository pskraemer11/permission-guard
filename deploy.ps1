#Requires -Version 7
<#
.SYNOPSIS
    Deployt permission-guard aus dem Projekt in die Laufzeitverzeichnisse.

.DESCRIPTION
    Quelle ist dieses Verzeichnis (tools/permission-guard im Projekt). Es gibt
    zwei Ziele:

      - ~/.config/opencode/plugins/permission-guard  (OpenCode-Plugin, Node)
      - ~/.codex/hooks                               (Codex-Guard, Python)

    Beide Ziele bleiben absichtlich schreibgeschuetzt (permission: ask): Kein
    Agent soll seine eigenen Regeln unbemerkt aendern koennen. Dieses Skript ist
    der einzige Weg dorthin und kostet genau eine Rueckfrage - deshalb wird hier
    gebuendelt statt einzeln gespeichert.

.PARAMETER Check
    Nichts kopieren, nur Quell- und Laufzeitstand beider Ziele vergleichen.

.PARAMETER SkipTests
    Testlauf ueberspringen (nur fuer reine Kommentar-Aenderungen sinnvoll).

.PARAMETER Target
    Abweichendes Zielverzeichnis fuer das OpenCode-Plugin (zum Testen).

.PARAMETER CodexTarget
    Abweichendes Zielverzeichnis fuer den Codex-Guard (zum Testen).

.EXAMPLE
    pwsh -File .\tools\permission-guard\deploy.ps1

.EXAMPLE
    pwsh -File .\tools\permission-guard\deploy.ps1 -Check
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$SkipTests,
    [string]$Target = (Join-Path $HOME ".config\opencode\plugins\permission-guard"),
    [string]$CodexTarget = (Join-Path $HOME ".codex\hooks")
)

$ErrorActionPreference = "Stop"

$source = $PSScriptRoot
$files = @(
    "guard.js",
    "index.js",
    "reviewer.js",
    "audit.js",
    "diagnostics.js",
    "shadow.js",
    "git-shadow-report.mjs",
    "verify-audit.mjs",
    "mcp-report.mjs",
    "bench-model.mjs",
    "mcp-model-cases.jsonl",
    "shared-cases.jsonl",
    "test.mjs",
    "README.md",
    "README_de.md",
    "start-reviewer.ps1",
    "smoke-reviewer.mjs",
    "bench-reviewer.ps1",
    "bench-quality.ps1",
    "stats.mjs"
)
# Der Codex-Guard ist ein einzelnes Programm; sein Hook in ~/.codex/hooks.json
# ruft es ueber %USERPROFILE% auf.
$codexFiles = @(
    "codex_guard.py"
)

# Die Laufzeitkonfiguration ist ortsabhaengig (Backend, Modell, Port). Sie wird
# deshalb nur beim ersten Deploy aus der Vorlage erzeugt und spaeter nie
# ueberschrieben.
$configName = "shell-reviewer.config.json"
$configExample = "shell-reviewer.config.example.json"

foreach ($dir in @($Target, $CodexTarget)) {
    if (-not (Test-Path -LiteralPath $dir)) {
        throw "Zielverzeichnis fehlt: $dir"
    }
}

function Get-FileHashOrNull {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Copy-DeployFiles {
    param([string[]]$Names, [string]$To)
    foreach ($file in $Names) {
        Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $To $file) -Force
        Write-Host "  $file"
    }
}

function Compare-DeployFiles {
    param([string[]]$Names, [string]$To)
    $mismatch = 0
    foreach ($file in $Names) {
        $a = Get-FileHashOrNull (Join-Path $source $file)
        $b = Get-FileHashOrNull (Join-Path $To $file)
        if ($a -eq $b) {
            Write-Host ("  {0,-24} identisch" -f $file)
        }
        else {
            Write-Host ("  {0,-24} ABWEICHUNG" -f $file) -ForegroundColor Red
            $mismatch++
        }
    }
    return $mismatch
}

# 1. Tests: nur deployen, was gruen ist.
if (-not $Check -and -not $SkipTests) {
    Write-Host "== Tests =="
    & node (Join-Path $source "test.mjs")
    if ($LASTEXITCODE -ne 0) {
        throw "Tests fehlgeschlagen (Exitcode $LASTEXITCODE) - kein Deploy."
    }
    & python -m pytest (Join-Path $source "tests") -q
    if ($LASTEXITCODE -ne 0) {
        throw "Python-Tests fehlgeschlagen (Exitcode $LASTEXITCODE) - kein Deploy."
    }
}

# 2. Kopieren.
if (-not $Check) {
    Write-Host "`n== Kopieren nach $Target =="
    Copy-DeployFiles -Names $files -To $Target

    $configTarget = Join-Path $Target $configName
    if (-not (Test-Path -LiteralPath $configTarget)) {
        Copy-Item -LiteralPath (Join-Path $source $configExample) -Destination $configTarget -Force
        Write-Host "  $configName (aus Vorlage erzeugt)"
    }
    else {
        Write-Host "  $configName bleibt erhalten (ortsspezifisch)"
    }

    Write-Host "`n== Kopieren nach $CodexTarget =="
    Copy-DeployFiles -Names $codexFiles -To $CodexTarget
}

# 3. Byte-Vergleich: die laufenden Kopien muessen identisch mit der Quelle sein.
Write-Host "`n== Vergleich (SHA256): OpenCode =="
$mismatch = Compare-DeployFiles -Names $files -To $Target

Write-Host "`n== Vergleich (SHA256): Codex =="
$mismatch += Compare-DeployFiles -Names $codexFiles -To $CodexTarget

# 4. Zusatzdateien im OpenCode-Ziel, die es in der Quelle nicht gibt.
$extra = Get-ChildItem -LiteralPath $Target -File |
    Where-Object { $files -notcontains $_.Name }
if ($extra) {
    Write-Host "  Hinweis: Zusatzdateien im Ziel:" (($extra.Name) -join ", ")
}

if ($mismatch -gt 0) {
    throw "$mismatch Datei(en) weichen ab."
}

if ($Check) {
    Write-Host "`nStand geprueft, nichts kopiert."
} else {
    Write-Host "`nDeployt. OpenCode laedt das Plugin automatisch neu (Dateiwatcher)."
}
