#Requires -Version 7
<#
.SYNOPSIS
    Startet den Reviewer (llama-server) fuer Ebene 1, wenn er nicht antwortet.

.DESCRIPTION
    Prueft http://127.0.0.1:8080/health. Antwortet nichts, wird der Server ueber
    das deployte start-reviewer.ps1 gestartet (Modellpfad und Flags stehen dort).
    Gedacht fuer einen Task alle fuenf Minuten: Der Anmelde-Trigger allein startet
    nichts neu, wenn der Prozess spaeter endet - dann bleibt jede nicht
    einordenbare Anfrage bei "ask", ohne dass es auffaellt.

    Zweite Aufgabe (Nutzerentscheid 26.10.2026): Laeuft kein OpenCode, wird der
    Server beendet. Das Modell soll nur im Speicher liegen, solange der Reviewer
    gebraucht wird. Der Start liegt beim Plugin (ensureRunning in reviewer.js),
    das beim Laden der Sitzung hochfaehrt, was fehlt.

    Idempotent: Laeuft der Reviewer, passiert nichts. Ist der Port belegt, aber
    /health stumm, wird nicht doppelt gestartet.

.PARAMETER Port
    Port des Reviewers (Standard 8080).

.PARAMETER Quiet
    Keine Konsolenausgabe (fuer den Task).

.EXAMPLE
    pwsh -File .\watchdog-reviewer.ps1
#>
[CmdletBinding()]
param(
    [int]$Port = 8080,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Write-Status([string]$message) {
    if (-not $Quiet) { Write-Host $message }
}

# Ohne OpenCode gibt es nichts zu entscheiden - dann belegt der Reviewer nur
# Speicher. Der Task laeuft alle fuenf Minuten, damit ist der Server spaetestens
# fuenf Minuten nach dem Schliessen beendet. Beim naechsten Start faehrt ihn das
# Plugin ueber ensureRunning wieder hoch.
$openCode = Get-Process -Name "OpenCode", "opencode-cli" -ErrorAction SilentlyContinue
if (-not $openCode) {
    $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listening) {
        $listening | Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
        Write-Status "Kein OpenCode aktiv - Reviewer beendet (Port $Port)."
    }
    else {
        Write-Status "Kein OpenCode aktiv, Reviewer laeuft nicht."
    }
    exit 0
}

$health = "http://127.0.0.1:$Port/health"
try {
    $response = Invoke-WebRequest -Uri $health -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Status "Reviewer laeuft (Port $Port)."
        exit 0
    }
}
catch {
    # nicht erreichbar - weiter unten starten
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Status "Port $Port ist belegt, aber /health antwortet nicht - kein Neustart."
    exit 1
}

$starter = Join-Path $HOME ".config\opencode\plugin\permission-guard\start-reviewer.ps1"
if (-not (Test-Path -LiteralPath $starter)) {
    Write-Status "start-reviewer.ps1 nicht gefunden: $starter"
    exit 1
}

Write-Status "Reviewer fehlt - starte ueber $starter."
& $starter -Port $Port | ForEach-Object { Write-Status $_ }
exit $LASTEXITCODE
