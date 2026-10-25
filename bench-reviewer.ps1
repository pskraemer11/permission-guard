# Misst die Antwortlatenz des Reviewers fuer ein Modell auf llama.cpp.
#
#   .\bench-reviewer.ps1 -Model <pfad.gguf> -Label "Gemma 12B"
#   .\bench-reviewer.ps1 -Model <pfad.gguf> -Mmproj <pfad.gguf> -Label "Jev-Omni"
#
# Startet einen eigenen Server auf -Port (Standard 8091), wartet auf /health,
# verwirft einen Aufwaermlauf und misst dann -N Anfragen. Der Server wird
# anschliessend beendet. Ein bereits laufender Server auf demselben Port wird
# nicht angefasst (Abbruch mit Hinweis).
#
# Fairness: identischer Systemprompt, identische Nutzernachricht, identische
# Grammatik, temperature 0, max_tokens 8 - nur Modell und Laufzeit variieren.

param(
  [Parameter(Mandatory = $true)][string]$Model,
  [string]$Mmproj,
  [string]$Label = "Modell",
  [int]$Port = 8091,
  [int]$N = 5,
  [string]$Server = "C:\Program Files\llama.cpp\llama-server.exe"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Model)) { "Modell fehlt: $Model"; exit 1 }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  "Port $Port ist belegt - bitte einen freien Port waehlen."; exit 1
}

$serverArgs = @('-m', $Model, '-c', '4096', '--port', "$Port", '--no-webui', '-ngl', 'all', '--jinja')
if ($Mmproj) { $serverArgs += @('--mmproj', $Mmproj) }

$log = Join-Path $env:TEMP "bench-$Port.log"
$proc = Start-Process -FilePath $Server -ArgumentList $serverArgs -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err"

$ready = $false
foreach ($i in 1..60) {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 -ErrorAction Stop
    if ($h.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}
if (-not $ready) { "Server antwortet nicht - siehe $log.err"; Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; exit 1 }

$sys = 'Du pruefst einen Shell-Befehl fuer einen Coding-Agenten. Antworte nur mit "Ja" oder "Nein", ohne weitere Woerter.
Frage: Wirkt dieser Befehl ausschliesslich innerhalb des Projektordners und veraendert nichts ausserhalb?
Antworte "Nein", wenn er Dateien ausserhalb des Projektordners veraendert, System- oder Prozesszustand aendert, Software installiert, Daten ueber das Netzwerk sendet oder Zugangsdaten liest.'
$user = "Projektordner: C:\work\repo`nBefehl:`n- rg -n `"TODO`" src"

function Invoke-One {
  $body = @{
    model = "bench"
    messages = @(@{ role = "system"; content = $sys }, @{ role = "user"; content = $user })
    temperature = 0
    max_tokens = 8
    cache_prompt = $true
    grammar = 'root ::= "Ja" | "Nein"'
  } | ConvertTo-Json -Depth 6
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/chat/completions" -Method Post `
    -ContentType "application/json" -Body $body -TimeoutSec 60
  $sw.Stop()
  return [pscustomobject]@{ Ms = $sw.Elapsed.TotalMilliseconds; Answer = $r.choices[0].message.content }
}

$null = Invoke-One   # Aufwaermlauf, zaehlt nicht

$times = @()
$answers = @()
for ($i = 1; $i -le $N; $i++) {
  $m = Invoke-One
  $times += $m.Ms
  $answers += $m.Answer
}
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue

$sorted = $times | Sort-Object
$median = $sorted[[int][Math]::Floor($sorted.Count / 2)]
$answers = $answers | Select-Object -Unique
"{0,-22} median {1,6:N0} ms   min {2,6:N0}   max {3,6:N0}   Antwort: {4}" -f `
  $Label, $median, $sorted[0], $sorted[-1], ($answers -join "/")
