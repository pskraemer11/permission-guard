# Startet den lokalen Entscheider fuer Ebene 1 (permission-guard/reviewer.js).
#
#   .\start-reviewer.ps1                    # Gemma 4 12B auf Port 8080
#   .\start-reviewer.ps1 -Port 8081         # anderer Port
#   .\start-reviewer.ps1 -ModelPath <pfad>  # anderes GGUF
#   .\start-reviewer.ps1 -Stop              # beendet den Prozess auf diesem Port
#
# Der Reviewer ist optional: laeuft er nicht, bleibt jede nicht einordenbare
# Anfrage bei "ask" (fail closed). Gestartet wird er vom Plugin (ensureRunning
# in reviewer.js) beim Oeffnen von OpenCode und vom Watchdog, wenn er fehlt;
# beendet wird er vom Watchdog, sobald kein OpenCode mehr laeuft. Dieser Aufruf
# bleibt der Weg von Hand.

param(
  [int]$Port = 8080,
  [string]$ModelPath = "D:\LLM-Modelle\Llama-GGUF\unsloth\gemma-4-12B-it-qat-GGUF\gemma-4-12B-it-qat-UD-Q4_K_XL.gguf",
  [string]$Server = "C:\Program Files\llama.cpp\llama-server.exe",
  [string]$DraftPath = "",
  [switch]$Stop
)

$pidFile = Join-Path $env:TEMP "permission-guard-reviewer-$Port.pid"

if ($Stop) {
  # Erste Wahl: PID aus der Startdatei. Get-NetTCPConnection und netstat sind
  # hier unzuverlaessig (Bindung je nach Backend, lokalisierte Zustaende).
  $pidFile = Join-Path $env:TEMP "permission-guard-reviewer-$Port.pid"
  if (Test-Path -LiteralPath $pidFile) {
    $procId = Get-Content -LiteralPath $pidFile | Select-Object -First 1
    if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
      Stop-Process -Id $procId -Force
      Remove-Item -LiteralPath $pidFile -Force
      "gestoppt (Port $Port, PID $procId)"
      exit 0
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
  $pids = @()
  try {
    $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch { }
  if (-not $pids -or $pids.Count -eq 0) {
    foreach ($line in (netstat -ano)) {
      if ($line -match '(?i)LISTENING|ABHÖREN' -and $line -match ":$Port\s") {
        $parts = ($line -split '\s+') | Where-Object { $_ }
        if ($parts.Count -ge 5) { $pids += [int]$parts[-1] }
      }
    }
    $pids = $pids | Select-Object -Unique
  }
  if (-not $pids -or $pids.Count -eq 0) { "kein Prozess auf Port $Port"; exit 0 }
  $pids | ForEach-Object { Stop-Process -Id $_ -Force }
  "gestoppt (Port $Port)"
  exit 0
}

if (-not (Test-Path -LiteralPath $Server)) { "llama-server nicht gefunden: $Server"; exit 1 }
if (-not (Test-Path -LiteralPath $ModelPath)) { "Modell nicht gefunden: $ModelPath"; exit 1 }

$alive = $false
try {
  $h = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 -ErrorAction Stop
  $alive = $h.StatusCode -eq 200
} catch { }
if ($alive) { "Port $Port ist bereits belegt - laeuft der Reviewer schon?"; exit 0 }

$log = Join-Path $env:TEMP "permission-guard-reviewer-$Port.log"
$serverArgs = @('-m', $ModelPath, '-c', '4096', '--port', "$Port", '--no-webui', '-ngl', 'all', '--jinja')
if ($DraftPath) { $serverArgs += @('--model-draft', $DraftPath) }
$proc = Start-Process -FilePath $Server -WindowStyle Hidden -ArgumentList $serverArgs `
  -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
$proc.Id | Set-Content -LiteralPath $pidFile

foreach ($i in 1..30) {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 -ErrorAction Stop
    if ($h.StatusCode -eq 200) { "Reviewer bereit: http://127.0.0.1:$Port/v1 (Log: $log)"; exit 0 }
  } catch { }
}
"Server antwortet nicht - siehe $log.err"
exit 1
