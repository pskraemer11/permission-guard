// Messreihe fuer Ebene 3 (05.11.2026).
//
// Die 33 festen Faelle in mcp-cases.jsonl enthalten nur drei Graubereich-Faelle.
// Fuer die Prompt-Qualitaet ist das zu wenig: hier stehen 14 Werkzeuge ohne
// erkennbares Verb, fuenf davon klar lesend, neun nicht. Gemessen wird die
// Trefferquote des lokalen Modells gegen ein vorher festgelegtes Soll.
//
// Das Modell streut bei temperature 0 (llama.cpp, Batch- und Cache-Zustand).
// Ein Einzellauf ist deshalb kein Urteil: --repeat fragt jeden Fall mehrfach
// und zaehlt die Mehrheit; "einstimmig" zeigt, wie stabil die Antworten waren.
//
// Braucht einen laufenden Reviewer (shell-reviewer.config.json).
//
//   node bench-model.mjs
//   node bench-model.mjs --repeat 3
//   node bench-model.mjs --json
//
// Exit 1, sobald ein Soll nicht getroffen wird.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mcpCriteria } from "./guard.js"
import { loadConfig, reviewMcp } from "./reviewer.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CASES_FILE = path.join(HERE, "mcp-model-cases.jsonl")
const asJson = process.argv.includes("--json")
const repeatIndex = process.argv.indexOf("--repeat")
const repeat = repeatIndex > 0 ? Math.max(1, Number(process.argv[repeatIndex + 1]) || 1) : 1

function loadCases() {
  const raw = fs.readFileSync(CASES_FILE, "utf8")
  const cases = []
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const item = JSON.parse(line)
    for (const field of ["id", "tool", "modelWant", "why"]) {
      if (item[field] === undefined) throw new Error(`Zeile ${index + 1}: Feld ${field} fehlt`)
    }
    if (!["allow", "ask"].includes(item.modelWant)) throw new Error(`Zeile ${index + 1}: modelWant ungueltig`)
    cases.push(item)
  }
  return cases
}

const cases = loadCases()
const config = loadConfig()
if (!config.enabled) {
  console.error("bench-model: Reviewer ist deaktiviert (shell-reviewer.config.json).")
  process.exit(1)
}

const rows = []
for (const item of cases) {
  const criteria = mcpCriteria(item.tool, { input: item.input ?? {} }, "build")
  // Der Bestand muss im Graubereich liegen, sonst misst die Reihe etwas anderes.
  if (criteria.action.intent !== "unknown" || criteria.context.secret || criteria.context.oversized) {
    rows.push({ item, ok: false, majority: "ask", agree: 0, votes: 0, ms: 0 })
    continue
  }
  const votes = []
  const started = Date.now()
  for (let run = 0; run < repeat; run++) {
    const reviewed = await reviewMcp({ criteria, input: item.input ?? {}, config: { ...config, deterministic: true } })
    votes.push(reviewed.decision)
  }
  const ms = Math.round((Date.now() - started) / repeat)
  const allow = votes.filter((vote) => vote === "allow").length
  const majority = allow > votes.length - allow ? "allow" : "ask"
  const agree = Math.max(allow, votes.length - allow)
  rows.push({ item, ok: majority === item.modelWant, majority, agree, votes: votes.length, ms })
}

const hit = rows.filter((row) => row.ok).length
const stable = rows.filter((row) => row.agree === row.votes).length
const askShare = cases.filter((item) => item.modelWant === "ask").length
const trivial = askShare / cases.length

if (asJson) {
  console.log(
    JSON.stringify(
      {
        total: cases.length,
        hit,
        stable,
        repeat,
        trivial,
        rows: rows.map((row) => ({ id: row.item.id, want: row.item.modelWant, got: row.majority, agree: row.agree, votes: row.votes, ms: row.ms })),
      },
      null,
      2,
    ),
  )
} else {
  for (const row of rows) {
    const label = `${row.item.id}`.padEnd(26)
    const votes = row.votes ? `${row.agree}/${row.votes}` : "-"
    console.log(`${row.ok ? "ok  " : "FAIL"}  ${label} ${row.majority.padEnd(5)} (${row.item.modelWant.padEnd(5)}) ${votes.padEnd(7)} ${row.ms} ms`)
  }
  console.log("")
  console.log(
    `Ebene 3: ${hit}/${cases.length} getroffen (${Math.round((hit / cases.length) * 100)} %), ` +
      `einstimmig ${stable}/${cases.length} bei ${repeat} Lauf/Laeufen. ` +
      `Immer-"Nein" waere ${askShare}/${cases.length} (${Math.round(trivial * 100)} %).`,
  )
}

if (hit !== cases.length) process.exit(1)
