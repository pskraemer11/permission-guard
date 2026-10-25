# Startet den lokalen Entscheider fuer Ebene 1 (permission-guard/reviewer.js).
#
#   .\start-reviewer.ps1                    # Gemma 4 12B auf Port 8080
#   .\start-reviewer.ps1 -Port 8081         # anderer Port
#   .\start-reviewer.ps1 -ModelPath <pfad>  # anderes GGUF
#   .\start-reviewer.ps1 -Stop              # beendet den Prozess auf diesem Port
#
# Der Reviewer ist optional: laeuft er nicht, bleibt jede nicht einordenbare
# Anfrage bei "ask" (fail closed). Der Start ist bewusst manuell - ein dauerhaft
# laufender Server belegt VRAM.

param(
  [int]$Port = 8080,
  [string]$ModelPath = "D:\LLM-Modelle\Llama-GGUF\unsloth\gemma-4-12B-it-qat-GGUF\gemma-4-12B-it-qat-UD-Q4_K_XL.gguf",
  [string]$Server = "C:\Program Files\llama.cpp\llama-server.exe",
  [switch]$Stop
)

if ($Stop) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $conn) { "kein Prozess auf Port $Port"; exit 0 }
  $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
  "gestoppt (Port $Port)"
  exit 0
}

if (-not (Test-Path -LiteralPath $Server)) { "llama-server nicht gefunden: $Server"; exit 1 }
if (-not (Test-Path -LiteralPath $ModelPath)) { "Modell nicht gefunden: $ModelPath"; exit 1 }

$alive = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($alive) { "Port $Port ist bereits belegt - laeuft der Reviewer schon?"; exit 0 }

$log = Join-Path $env:TEMP "permission-guard-reviewer-$Port.log"
Start-Process -FilePath $Server -WindowStyle Hidden -ArgumentList @(
  '-m', $ModelPath, '-c', '4096', '--port', "$Port", '--no-webui', '-ngl', 'all', '--jinja'
) -RedirectStandardOutput $log -RedirectStandardError "$log.err"

foreach ($i in 1..30) {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 -ErrorAction Stop
    if ($h.StatusCode -eq 200) { "Reviewer bereit: http://127.0.0.1:$Port/v1 (Log: $log)"; exit 0 }
  } catch { }
}
"Server antwortet nicht - siehe $log.err"
exit 1
