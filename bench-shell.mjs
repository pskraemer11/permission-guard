// Messreihe fuer Ebene 1 (Shell, systemone). Gegenstueck zu bench-model.mjs, das
// nur Ebene 3 (MCP) misst.
//
// Die Faelle in shell-model-cases.jsonl sind so gewaehlt, dass die statische
// Risikoliste des Reviewers sie nicht vorab entscheidet. Trifft eine Antwort eine
// statische Regel, ist die Messung ungueltig und das Skript bricht ab.
//
// Braucht einen laufenden Reviewer (shell-reviewer.config.json oder Standard).
//
//   node bench-shell.mjs
//   node bench-shell.mjs --repeat 3
//
// Exit 1, sobald ein Soll nicht getroffen wird; Exit 2 bei Backend-Fehlern.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig, neverAutoApprove, review } from "./reviewer.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CASES_FILE = path.join(HERE, "shell-model-cases.jsonl")
const repeatIndex = process.argv.indexOf("--repeat")
const repeat = repeatIndex > 0 ? Math.max(1, Number(process.argv[repeatIndex + 1]) || 1) : 1
// Gleiche Ordner wie in der Pruefung: Projekt und Temp, fuer die Schreibregel.
const PROJECT = "C:/proj"
const TEMP = "C:/tmp"

function loadCases() {
  const cases = []
  for (const [index, line] of fs.readFileSync(CASES_FILE, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const item = JSON.parse(line)
    for (const field of ["id", "command", "modelWant", "why"]) {
      if (item[field] === undefined) throw new Error(`Zeile ${index + 1}: Feld ${field} fehlt`)
    }
    if (!["allow", "ask"].includes(item.modelWant)) throw new Error(`Zeile ${index + 1}: modelWant ungueltig`)
    cases.push(item)
  }
  return cases
}

const cases = loadCases()
const config = { ...loadConfig(), shellBackend: "systemone" }
if (!config.enabled) {
  console.error("bench-shell: Reviewer ist deaktiviert (shell-reviewer.config.json).")
  process.exit(1)
}

const rows = []
let invalidVotes = 0
for (const item of cases) {
  // Faelle, die die statische Liste entscheidet, erreichen das Modell nie.
  // Sie sind kein Modellurteil, sondern eine Kontrolle der Liste; sie zaehlen
  // weder zur Trefferquote noch als ungueltige Antwort.
  if (neverAutoApprove(item.command)) {
    rows.push({ item, ok: true, majority: "statisch", agree: 0, votes: 0, ms: 0 })
    continue
  }
  const votes = []
  const started = Date.now()
  for (let run = 0; run < repeat; run++) {
    const reviewed = await review({ commands: [item.command], project: PROJECT, temp: TEMP, config })
    // Nur ein Modellurteil zaehlt. Statische Regeln, HTTP- und Zeitfehler sind
    // keine Antwort des Modells und machen die Messung ungueltig.
    if (!String(reviewed.reason ?? "").startsWith("Modell:")) invalidVotes++
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
for (const row of rows) {
  const label = `${row.item.id}`.padEnd(24)
  console.log(
    `${row.ok ? "ok  " : "FAIL"}  ${label} ${row.majority.padEnd(8)} (${row.item.modelWant.padEnd(5)}) ${`${row.agree}/${row.votes}`.padEnd(7)} ${row.ms} ms`,
  )
}
console.log("")
console.log(
  `Ebene 1: ${hit}/${cases.length} getroffen (${Math.round((hit / cases.length) * 100)} %), ` +
    `einstimmig ${stable}/${cases.length} bei ${repeat} Lauf/Laeufen.`,
)

if (invalidVotes > 0) {
  console.error(`bench-shell: ${invalidVotes} Antworten ohne Modellurteil - Ergebnis unbrauchbar.`)
  process.exit(2)
}
if (hit !== cases.length) process.exit(1)
