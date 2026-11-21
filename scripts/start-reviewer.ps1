# Startet den lokalen Entscheider fuer Ebene 1 und 3 (permission-guard/reviewer.js).
#
#   .\scripts\start-reviewer.ps1                    # Kev-4B (Entscheidungsmodell) auf Port 8080
#   .\scripts\start-reviewer.ps1 -Port 8081         # anderer Port
#   .\scripts\start-reviewer.ps1 -ModelPath <pfad>  # anderes GGUF
#   .\scripts\start-reviewer.ps1 -Np 1              # ein Slot (kein Prefix-Teilen)
#   .\scripts\start-reviewer.ps1 -Cpu -Server <cpu-llama-server>  # ohne GPU-Offload
#   .\scripts\start-reviewer.ps1 -Stop              # beendet den Prozess auf diesem Port
#
# Der Reviewer ist optional: laeuft er nicht, bleibt jede nicht einordenbare
# Anfrage bei "ask" (fail closed). Gestartet wird er vom Plugin (ensureRunning
# in reviewer.js) beim Oeffnen von OpenCode und vom Watchdog, wenn er fehlt;
# beendet wird er vom Watchdog, sobald kein OpenCode mehr laeuft. Dieser Aufruf
# bleibt der Weg von Hand.

param(
  [int]$Port = 8080,
  [string]$ModelPath = "D:\LLM-Modelle\Llama-GGUF\ggml-org\Kev-4B-GGUF\Kev-4B-Q4_K_M.gguf",
  [string]$Server = "C:\Program Files\llama.cpp\llama-server.exe",
  [string]$DraftPath = "",
  # Stapelgroesse fuer den Prompt. Entscheidungsmodelle laufen im
  # Embedding-Modus; dort erzwingt llama.cpp n_batch = n_ubatch, und Frage samt
  # Antwortoptionen muss in EINEN Stapel passen. 2048 deckt gemessen 48000
  # Zeichen (21.11.2026, Kev-4B) und halbiert den Compute-Puffer gegenueber
  # 4096 (2149 statt 4297 MiB). Die Werte hier uebersteuern die
  # chat-taugliche Einstellung in %APPDATA%\llama.cpp\config.ini.
  [int]$Batch = 2048,
  [int]$Ubatch = 2048,
  # Slots. Ein Decision-Request mit mehreren Fragen erzeugt einen Task je Frage;
  # der gemeinsame Prefix wird nur zwischen Slots wiederverwendet. Vorgabe 5,
  # weil der Reviewer fuenf Fragen stellt: gemessen 20.11.2026 Kev-4B 236 ms
  # mit einem Slot gegen 159 ms mit fuenf. Bei -np 1 teilt sich nichts.
  [int]$Np = 5,
  # Unified KV: ein gemeinsamer KV-Puffer fuer alle Slots, -c bleibt dann ein
  # Pool statt 32768/Np je Slot. Die Vorgabe von llama-server greift nur, wenn
  # die Slotzahl "auto" ist; bei ausdruecklichem -np ist Unified aus. Deshalb
  # setzt das Skript es bei mehr als einem Slot selbst (llama-server --help,
  # gemessen).
  [switch]$KvUnified,
  [switch]$Cpu,
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
  $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
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

# Gesamtbudget fuer Start und Bereitschaft. Ein haengender Start kostete am
# 21.11.2026 zweimal 10 bis 15 Minuten: Der Server war laenger bereit, das
# Skript merkte es nicht und blockierte beim Oeffnen der Log-Datei.
$startBudgetSeconds = 120
$deadline = (Get-Date).AddSeconds($startBudgetSeconds)

function Test-FileWritable {
  param([string]$Path)
  try {
    $stream = [System.IO.File]::Open(
      $Path,
      [System.IO.FileMode]::Append,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::None)
    $stream.Close()
    return $true
  } catch {
    return $false
  }
}

# Der Vorgaenger haelt die Log-Datei noch, dann blockiert Start-Process ohne
# Meldung. Erst warten, bis beide Dateien frei sind, sonst klar abbrechen.
$logFree = $false
for ($i = 0; $i -lt 40; $i++) {
  if ((Test-FileWritable $log) -and (Test-FileWritable "$log.err")) { $logFree = $true; break }
  Start-Sleep -Milliseconds 250
}
if (-not $logFree) {
  "Log-Datei wird noch gehalten: $log.err"
  "Vorgaenger beenden (scripts/start-reviewer.ps1 -Stop) oder kurz warten."
  exit 1
}

# Standard bleibt CUDA/GPU. -Cpu ist fuer einen separaten CPU-Build ohne CUDA
# gedacht. --no-op-offload gehoert nicht dazu: Er bremst auch den reinen
# CPU-Build (Smoke 17.11.2026, zwei Aufrufe ueber 6000 ms).
$gpuLayers = $Cpu ? '0' : 'all'
$serverArgs = @('-m', $ModelPath, '-c', '32768', '-np', "$Np", '-b', "$Batch", '-ub', "$Ubatch", '--port', "$Port", '--no-webui', '-ngl', $gpuLayers, '--jinja')
if ($KvUnified -or $Np -gt 1) { $serverArgs += @('--kv-unified') }
if ($DraftPath) { $serverArgs += @('--model-draft', $DraftPath) }
# Start. Die Log-Dateien sind oben geprueft; damit blockiert Start-Process
# nicht am Vorgaenger. Die Zeit vor und nach dem Aufruf wird gemessen, weil
# genau dieser Aufruf am 21.11.2026 zweimal haengen blieb.
$started = Get-Date
$proc = Start-Process -FilePath $Server -WindowStyle Hidden -ArgumentList $serverArgs `
  -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
$proc.Id | Set-Content -LiteralPath $pidFile
$startSeconds = [int]((Get-Date) - $started).TotalSeconds
if ($startSeconds -gt 10) { "Hinweis: Start-Process brauchte $startSeconds s - Log-Datei war blockiert?" }

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 -ErrorAction Stop
    if ($h.StatusCode -eq 200) { "Reviewer bereit: http://127.0.0.1:$Port/v1 (Log: $log)"; exit 0 }
  } catch { }
}
"Reviewer nicht bereit nach $startBudgetSeconds s - Log: $log.err"
"Prozess PID $($proc.Id) laeuft weiter; beenden mit scripts/start-reviewer.ps1 -Stop."
exit 1
