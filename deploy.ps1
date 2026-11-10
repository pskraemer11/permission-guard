#Requires -Version 7
<#
.SYNOPSIS
    Deployt permission-guard aus dem Projekt in das Laufzeitverzeichnis.

.DESCRIPTION
    Quelle ist dieses Verzeichnis (tools/permission-guard im Projekt), Ziel ist
    ~/.config/opencode/plugin/permission-guard.

    Das Ziel bleibt absichtlich schreibgeschuetzt (permission: ask): Kein Agent
    soll seine eigenen Regeln unbemerkt aendern koennen. Dieses Skript ist der
    einzige Weg dorthin und kostet genau eine Rueckfrage - deshalb wird hier
    gebuendelt statt einzeln gespeichert.

.PARAMETER Check
    Nichts kopieren, nur Quell- und Laufzeitstand vergleichen.

.PARAMETER SkipTests
    Testlauf ueberspringen (nur fuer reine Kommentar-Aenderungen sinnvoll).

.PARAMETER Target
    Abweichendes Zielverzeichnis (zum Testen des Skripts).

.EXAMPLE
    pwsh -File .\tools\permission-guard\deploy.ps1

.EXAMPLE
    pwsh -File .\tools\permission-guard\deploy.ps1 -Check
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$SkipTests,
    [string]$Target = (Join-Path $HOME ".config\opencode\plugin\permission-guard")
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
    "test.mjs",
    "README.md",
    "start-reviewer.ps1",
    "smoke-reviewer.mjs",
    "bench-reviewer.ps1",
    "bench-quality.ps1",
    "stats.mjs"
)

# Die Laufzeitkonfiguration ist ortsabhaengig (Backend, Modell, Port). Sie wird
# deshalb nur beim ersten Deploy aus der Vorlage erzeugt und spaeter nie
# ueberschrieben.
$configName = "shell-reviewer.config.json"
$configExample = "shell-reviewer.config.example.json"

if (-not (Test-Path -LiteralPath $Target)) {
    throw "Zielverzeichnis fehlt: $Target"
}

function Get-FileHashOrNull {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

# 1. Tests: nur deployen, was gruen ist.
if (-not $Check -and -not $SkipTests) {
    Write-Host "== Tests =="
    & node (Join-Path $source "test.mjs")
    if ($LASTEXITCODE -ne 0) {
        throw "Tests fehlgeschlagen (Exitcode $LASTEXITCODE) - kein Deploy."
    }
}

# 2. Kopieren.
if (-not $Check) {
    Write-Host "`n== Kopieren nach $Target =="
    foreach ($file in $files) {
        Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $Target $file) -Force
        Write-Host "  $file"
    }

    $configTarget = Join-Path $Target $configName
    if (-not (Test-Path -LiteralPath $configTarget)) {
        Copy-Item -LiteralPath (Join-Path $source $configExample) -Destination $configTarget -Force
        Write-Host "  $configName (aus Vorlage erzeugt)"
    }
    else {
        Write-Host "  $configName bleibt erhalten (ortsspezifisch)"
    }
}

# 3. Byte-Vergleich: das laufende Plugin muss identisch mit der Quelle sein.
Write-Host "`n== Vergleich (SHA256) =="
$mismatch = 0
foreach ($file in $files) {
    $a = Get-FileHashOrNull (Join-Path $source $file)
    $b = Get-FileHashOrNull (Join-Path $Target $file)
    if ($a -eq $b) {
        Write-Host ("  {0,-12} identisch" -f $file)
    } else {
        Write-Host ("  {0,-12} ABWEICHUNG" -f $file) -ForegroundColor Red
        $mismatch++
    }
}

# 4. Zusatzdateien im Ziel, die es in der Quelle nicht gibt.
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
