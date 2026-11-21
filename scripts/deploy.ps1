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

.PARAMETER ShellThreshold
    Setzt shellThreshold in der Laufzeitkonfiguration. Ohne Angabe bleibt der
    vorhandene Wert. Fehlende Schluessel werden immer aus der Vorlage ergaenzt.

.PARAMETER ResultShield
    Setzt resultShield (off | annotate | scan). Ohne Angabe bleibt der
    vorhandene Wert.

.PARAMETER CodexTarget
    Abweichendes Zielverzeichnis fuer den Codex-Guard (zum Testen).

.EXAMPLE
    pwsh -File .\scripts\deploy.ps1

.EXAMPLE
    pwsh -File .\scripts\deploy.ps1 -Check

.EXAMPLE
    pwsh -File .\scripts\deploy.ps1 -ShellThreshold 0.65
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$SkipTests,
    [double]$ShellThreshold = 0,
    [ValidateSet("", "off", "annotate", "scan")]
    [string]$ResultShield = "",
    [string]$Target = (Join-Path $HOME ".config\opencode\plugins\permission-guard"),
    [string]$CodexTarget = (Join-Path $HOME ".codex\hooks")
)

$ErrorActionPreference = "Stop"

$source = Split-Path -Parent $PSScriptRoot
# Ins Ziel kommt nur, was dort laeuft: die Module, die Berichtswerkzeuge und die
# Startskripte. Tests, Fixtures und Messwerkzeuge bleiben im Repo - sie liegen
# unter test/ und importieren ../src/, was im flachen Ziel nicht aufloest.
$files = @(
    "src/guard.js",
    "src/index.js",
    "src/reviewer.js",
    "src/audit.js",
    "src/diagnostics.js",
    "src/shadow.js",
    "src/git-shadow-report.mjs",
    "src/verify-audit.mjs",
    "src/mcp-report.mjs",
    "src/stats.mjs",
    "README.md",
    "README_de.md",
    "scripts/start-reviewer.ps1",
    "scripts/bench-reviewer.ps1",
    "scripts/bench-quality.ps1"
)
# Der Codex-Guard ist ein einzelnes Programm; sein Hook in ~/.codex/hooks.json
# ruft es ueber %USERPROFILE% auf.
$codexFiles = @(
    "codex_guard.py"
)

# Die Laufzeitkonfiguration ist seit 21.11.2026 versioniert: src/shell-reviewer.config.json
# ist die Quelle, wird mitkopiert und per SHA256 verglichen. Damit messen Bench
# und Betrieb dieselben Werte. Fehlt die Quelle, gilt das alte Verhalten:
# Vorlage beim ersten Deploy erzeugen, spaeter nur fehlende Schluessel ergaenzen.
$configName = "shell-reviewer.config.json"
$configExample = "shell-reviewer.config.example.json"
$configSource = Join-Path $source (Join-Path "src" $configName)
$configFromRepo = Test-Path -LiteralPath $configSource
if ($configFromRepo) {
    $files += "src/$configName"
    if ($ShellThreshold -gt 0 -or $ResultShield) {
        Write-Host "Hinweis: -ShellThreshold/-ResultShield wirken nicht, solange src/$configName die Quelle ist."
    }
}

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
        # Quelle darf in einem Unterordner liegen (scripts/); im Ziel liegt
        # jede Datei flach, weil der Plugin-Lader index.js dort erwartet.
        $leaf = Split-Path -Leaf $file
        Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $To $leaf) -Force
        Write-Host "  $leaf"
    }
}

function Compare-DeployFiles {
    param([string[]]$Names, [string]$To)
    $mismatch = 0
    foreach ($file in $Names) {
        $leaf = Split-Path -Leaf $file
        $a = Get-FileHashOrNull (Join-Path $source $file)
        $b = Get-FileHashOrNull (Join-Path $To $leaf)
        if ($a -eq $b) {
            Write-Host ("  {0,-24} identisch" -f $leaf)
        }
        else {
            Write-Host ("  {0,-24} ABWEICHUNG" -f $leaf) -ForegroundColor Red
            $mismatch++
        }
    }
    return $mismatch
}

# Fehlende Schluessel aus der Vorlage ergaenzen; vorhandene Werte bleiben.
# -ShellThreshold setzt die Schwelle ausdruecklich, weil sie eine bewusste
# Kalibrierung ist und nicht still geaendert werden soll.
function Update-RuntimeConfig {
    param([string]$Directory, [double]$Threshold, [string]$Shield)
    $configPath = Join-Path $Directory $configName
    $examplePath = Join-Path $source $configExample
    if (-not (Test-Path -LiteralPath $configPath)) {
        Copy-Item -LiteralPath $examplePath -Destination $configPath -Force
        Write-Host "  $configName (aus Vorlage erzeugt)"
        return
    }
    $current = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -AsHashtable
    $example = Get-Content -LiteralPath $examplePath -Raw | ConvertFrom-Json -AsHashtable
    $added = @()
    foreach ($key in $example.Keys) {
        if ($key.StartsWith("_")) { continue }
        if (-not $current.ContainsKey($key)) {
            $current[$key] = $example[$key]
            $added += $key
        }
    }
    $changed = $false
    if ($Threshold -gt 0 -and $current.ContainsKey("shellThreshold")) {
        if ([double]$current["shellThreshold"] -ne $Threshold) {
            $current["shellThreshold"] = $Threshold
            Write-Host "  shellThreshold -> $Threshold"
            $changed = $true
        }
    }
    if ($Shield -and $current.ContainsKey("resultShield")) {
        if ([string]$current["resultShield"] -ne $Shield) {
            $current["resultShield"] = $Shield
            Write-Host "  resultShield -> $Shield"
            $changed = $true
        }
    }
    if ($added.Count -eq 0 -and -not $changed) {
        Write-Host "  $configName vollstaendig (ortsspezifisch)"
        return
    }
    if ($added.Count -gt 0) {
        Write-Host "  $configName ergaenzt: $($added -join ', ')"
    }
    $current | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding utf8
}

# 1. Tests: nur deployen, was gruen ist.
if (-not $Check -and -not $SkipTests) {
    Write-Host "== Tests =="
    & node (Join-Path $source "test\test.mjs")
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
    if ($configFromRepo) {
        # Schon durch Copy-DeployFiles kopiert; hier nur die Bestaetigung.
        Write-Host "  $configName (Quelle: src/)"
    }
    elseif (-not (Test-Path -LiteralPath $configTarget)) {
        Copy-Item -LiteralPath (Join-Path $source $configExample) -Destination $configTarget -Force
        Write-Host "  $configName (aus Vorlage erzeugt)"
    }
    else {
        Update-RuntimeConfig -Directory $Target -Threshold $ShellThreshold -Shield $ResultShield
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
$leafNames = $files | ForEach-Object { Split-Path -Leaf $_ }
$extra = Get-ChildItem -LiteralPath $Target -File |
    Where-Object { $leafNames -notcontains $_.Name }
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
