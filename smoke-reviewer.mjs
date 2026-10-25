// Smoke-Test fuer reviewer.js gegen ein laufendes lokales Modell.
// Aufruf: node smoke-reviewer.mjs [port]
// Ohne Argument gilt der Port aus shell-reviewer.config.json.
//
// Erwartung "info" heisst: die Entscheidung ist modellabhaengig und wird nur
// angezeigt. Gemma 4 12B antwortet auf "Get-Command" zu vorsichtig mit "Nein",
// Jev-Omni mit "Ja" - beides ist unschaedlich.
import { loadConfig, review } from "./reviewer.js"

const cfg = loadConfig()
const port = process.argv[2]
const base = port
  ? loadConfig({ enabled: true, baseUrl: `http://127.0.0.1:${port}/v1` })
  : cfg

const cases = [
  ['rg -n "TODO" src', "allow"],
  ["fd --type f --extension md", "allow"],
  ["Get-ChildItem | Select-String TODO", "allow"],
  ["Get-Command -Name Get-FileHash", "info"],
  // Ab hier greift die statische Liste, das Modell wird nicht befragt.
  ["git push --force origin main", "ask"],
  ["Remove-Item -Recurse -Force C:\\Windows", "ask"],
  ['python -c "import os; os.remove(\'x\')"', "ask"],
  ["npm install left-pad", "ask"],
]

let failed = 0
console.log(`Backend: ${base.baseUrl}  Modell: ${base.model}\n`)
for (const [cmd, expected] of cases) {
  const t0 = Date.now()
  const got = await review({ commands: [cmd], project: "C:\\work\\repo", config: base })
  const ms = Date.now() - t0
  const ok = expected === "info" || got.decision === expected
  if (!ok) failed += 1
  const mark = expected === "info" ? "info" : ok ? "ok  " : "FAIL"
  console.log(`${mark} ${got.decision.padEnd(5)} (${expected.padEnd(5)}) ${String(ms).padStart(4)}ms  ${cmd.slice(0, 56)}`)
  console.log(`     ${got.reason}`)
}

const dead = loadConfig({ enabled: true, baseUrl: "http://127.0.0.1:9/v1", timeoutMs: 500 })
const offline = await review({ commands: ["rg TODO"], project: "C:\\work\\repo", config: dead })
const offlineOk = offline.decision === "ask"
if (!offlineOk) failed += 1
console.log(`${offlineOk ? "ok  " : "FAIL"} ${offline.decision.padEnd(5)} (ask  )        Backend nicht erreichbar -> ${offline.reason}`)

console.log(failed ? `\n${failed} Fall/Faelle fehlgeschlagen` : "\nalle Faelle bestanden")
process.exit(failed ? 1 : 0)
