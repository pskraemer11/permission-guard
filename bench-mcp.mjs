// Testregime fuer MCP (Schritt E, 04.11.2026).
//
// Prueft das Urteil aus Schritt C gegen eine feste Sammlung von 33 Aufrufen mit
// vorher festgelegtem Soll (mcp-cases.jsonl): 8 muessen freigegeben, 14
// zurueckgefragt und 9 aktiv verweigert werden; 2 Faelle gehen ins Modell
// (Graubereich). Neun Verbote sind rund ein Drittel - die Vorgabe des Plans.
//
// 9 der 33 Faelle stammen aus dem oeffentlichen Testkatalog von
// warc0s/opencode-permission-reviewer (Apache-2.0, synthetisch, laut eigenem
// README keine Sicherheitszertifizierung). Uebernommen sind die Faelle, nicht
// die Erwartungen: wo unser Urteil bewusst abweicht, steht das in "why".
//
// Ohne Netz und ohne Backend: geprueft wird die Weiterleitung und das Urteil,
// nicht die Qualitaet des Modells. Ein Aufruf, der im Graubereich landet, gilt
// als korrekt einsortiert; mit --model wird zusaetzlich das lokale Modell
// befragt (braucht laufenden Server auf der konfigurierten Adresse).
//
//   node bench-mcp.mjs
//   node bench-mcp.mjs --model          # zusaetzlich Ebene 3 messen
//   node bench-mcp.mjs --change         # nur den Change sehen, nicht die Fälle
//
// Exitcode 1, sobald ein Soll nicht getroffen wird. Die Erwartung steht in der
// Fallzeile und wird nicht aus dem Code abgeleitet - sonst prueft das Regime
// sich selbst.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mcpAction, mcpCriteria, mcpVerdict } from "./guard.js"
import { loadConfig, reviewMcp } from "./reviewer.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CASES_FILE = path.join(HERE, "mcp-cases.jsonl")
const OVERSIZED = "__OVERSIZED__"
const WANT_LABEL = { allow: "allow", ask: "ask", deny: "deny", model: "model" }

const args = new Set(process.argv.slice(2))
const withModel = args.has("--model")
const onlyChange = args.has("--change")

function loadCases() {
  const raw = fs.readFileSync(CASES_FILE, "utf8")
  const cases = []
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    let item
    try {
      item = JSON.parse(line)
    } catch (error) {
      throw new Error(`Zeile ${index + 1} ist kein JSON: ${error.message}`)
    }
    for (const field of ["id", "tool", "want", "layer", "why"]) {
      if (item[field] === undefined) throw new Error(`Zeile ${index + 1}: Feld ${field} fehlt`)
    }
    if (!(item.want in WANT_LABEL)) throw new Error(`Zeile ${index + 1}: unbekanntes Soll ${item.want}`)
    if (item.input && item.input.body === OVERSIZED) item.input = { ...item.input, body: "x".repeat(20000) }
    cases.push(item)
  }
  return cases
}

function judge(item) {
  const metadata = { input: item.input ?? {} }
  const criteria = mcpCriteria(item.tool, metadata, item.agent ?? "build")
  const verdict = mcpVerdict(criteria, item.input ?? {})
  const plan = mcpAction("ask", verdict, "active")
  return { criteria, verdict, plan }
}

const cases = loadCases()
if (!cases.length) {
  console.error("keine Faelle gefunden:", CASES_FILE)
  process.exit(1)
}

// Der Bestand ist Teil des Regimes: verschwindet ein Fall, muss das auffallen,
// nicht stillschweigend als "bestanden" durchgehen.
const EXPECTED = { allow: 8, ask: 14, deny: 9, model: 2 }
const counts = { allow: 0, ask: 0, deny: 0, model: 0 }
const ids = new Set()
for (const item of cases) {
  counts[item.want]++
  if (ids.has(item.id)) {
    console.error(`doppelte Fall-Kennung: ${item.id}`)
    process.exit(1)
  }
  ids.add(item.id)
}
for (const [want, expected] of Object.entries(EXPECTED)) {
  if (counts[want] !== expected) {
    console.error(`Fallbestand geaendert: ${want} ${counts[want]} statt ${expected} (${CASES_FILE})`)
    process.exit(1)
  }
}

let failed = 0
const denies = cases.filter((c) => c.want === "deny").length
const rows = []

for (const item of cases) {
  const { criteria, verdict, plan } = judge(item)
  const got = plan === "shadow" ? verdict.decision : plan
  const routed = got === "model" ? "model" : got
  const ok = routed === item.want && (item.want === "model" || verdict.layer === item.layer)
  if (!ok) failed++
  rows.push({ item, criteria, verdict, routed, ok })
  if (onlyChange) continue
  const detail = ok
    ? item.why
    : `${item.why} | erwartet ${item.want}/${item.layer}, war ${routed}/${verdict.layer} (${verdict.reason})`
  console.log(`${ok ? "ok  " : "FAIL"}  ${item.id.padEnd(26)} ${`${routed}/${verdict.layer}`.padEnd(9)} ${detail}`)
}

const modelCases = rows.filter((r) => r.item.want === "model")
let modelChecks = []
if (withModel) {
  const config = loadConfig()
  if (!config.enabled) {
    console.log("\nEbene 3: Reviewer ist deaktiviert - Modellpruefung uebersprungen.")
  } else {
    for (const item of modelCases) {
      const reviewed = await reviewMcp({
        criteria: item.criteria,
        input: item.item.input ?? {},
        // Reproduzierbar messen: fester Seed, kein Prompt-Cache. Ohne das
        // lieferte derselbe Prompt je nach Cache-Zustand 2/3 und 3/3.
        config: { ...config, deterministic: true },
      })
      const acceptable = item.item.modelWant === "allow" ? "allow" : "ask"
      const ok = reviewed.decision === acceptable
      modelChecks.push({ id: item.item.id, ok, reviewed, acceptable })
      console.log(
        `${ok ? "ok  " : "FAIL"}  ${`${item.item.id} (Modell)`.padEnd(26)} ${reviewed.decision.padEnd(9)} ${reviewed.reason}`,
      )
    }
  }
}

const modelFailed = modelChecks.filter((c) => !c.ok).length
console.log("")
console.log(
  `${cases.length - failed}/${cases.length} Weiterleitungen bestanden (${denies} Verbote, ${modelCases.length} Graubereich)` +
    (modelChecks.length ? `, Ebene 3: ${modelChecks.length - modelFailed}/${modelChecks.length}` : ""),
)
if (failed || modelFailed) process.exit(1)
