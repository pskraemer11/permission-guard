// Statistik ueber das Guard-Log (Ebene 0/1 des permission-guard).
//
// Quelle ist die Diagnosedatei, die index.js schreibt:
//   %TEMP%/opencode-permission-guard[-<uid>]/guard.log   (+ guard.log.1)
// Zeilenformat: <ISO-Zeit> <allow|ask|deny>[ (reviewer)] <Grund>[ | <Name#Hash>]
//
// Aufruf:
//   node stats.mjs                      # alles, Textausgabe
//   node stats.mjs --since 2026-10-25   # ab Datum (lokal, inklusive)
//   node stats.mjs --days 7             # die letzten sieben Kalendertage
//   node stats.mjs --top 5 --examples 3 # weniger Ausgabe
//   node stats.mjs --json               # maschinenlesbar
//   node stats.mjs --file <pfad>        # andere Datei (z. B. gesicherte Kopie)
//
// Bewusst ohne Netz und ohne Abhaengigkeiten: reine Textauswertung.

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"
import { guardLogDir } from "./diagnostics.js"

const DEFAULT_LOG = path.join(guardLogDir(), "guard.log")

function parseArgs(argv) {
  const args = { since: null, days: null, top: 8, examples: 2, json: false, file: DEFAULT_LOG }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--json") args.json = true
    else if (arg === "--file") args.file = argv[++i]
    else if (arg === "--since") args.since = argv[++i]
    else if (arg === "--days") args.days = Number(argv[++i])
    else if (arg === "--top") args.top = Number(argv[++i])
    else if (arg === "--examples") args.examples = Number(argv[++i])
    else if (arg === "--help" || arg === "-h") args.help = true
    else throw new Error(`unbekannte Option: ${arg}`)
  }
  return args
}

// Eine Zeile in { time, decision, reviewer, reason, command } zerlegen.
// Alles, was nicht dem Muster folgt (z. B. "setup: …" oder "error …"),
// landet in kind=other und wird nur gezaehlt.
export function parseLine(line) {
  const match = /^(\S+)\s+(allow|ask|deny)(\s+\(reviewer\))?\s+(.*)$/.exec(line)
  if (!match) {
    const setup = /^\S+\s+setup:/.test(line)
    return { kind: setup ? "setup" : "other" }
  }
  const [, iso, decision, reviewerFlag, rest] = match
  const cut = rest.indexOf(" | ")
  const reason = (cut === -1 ? rest : rest.slice(0, cut)).trim()
  const command = cut === -1 ? "" : rest.slice(cut + 3).trim()
  return {
    kind: "decision",
    time: new Date(iso),
    decision,
    reviewer: Boolean(reviewerFlag),
    reason,
    command,
  }
}

function readLines(file) {
  const out = []
  for (const candidate of [file, `${file}.1`]) {
    try {
      out.push(...fs.readFileSync(candidate, "utf8").split(/\r?\n/))
    } catch {
      // fehlende Generation ist normal
    }
  }
  return out.filter(Boolean)
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function summarize(rows, { since = null, days = null, top = 8 } = {}) {
  const now = new Date()
  const sinceDate = since ? new Date(`${since}T00:00:00`) : null
  const daysCut = days
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0)
    : null
  const cutoff = [sinceDate, daysCut].filter(Boolean).sort((a, b) => b - a)[0] ?? null

  const summary = {
    first: null,
    last: null,
    lines: rows.length,
    decisions: { allow: 0, ask: 0, deny: 0 },
    reviewer: { consulted: 0, allowed: 0, withheld: 0 },
    byReason: new Map(),
    byDay: new Map(),
    setup: 0,
    other: 0,
  }

  for (const row of rows) {
    if (row.kind === "setup") { summary.setup += 1; continue }
    if (row.kind !== "decision") { summary.other += 1; continue }
    if (Number.isNaN(row.time.getTime())) { summary.other += 1; continue }
    if (cutoff && row.time < cutoff) continue

    summary.decisions[row.decision] += 1
    if (row.reviewer) {
      summary.reviewer.consulted += 1
      if (row.decision === "allow") summary.reviewer.allowed += 1
      else summary.reviewer.withheld += 1
    }
    const reasonKey = `${row.decision}${row.reviewer ? " (reviewer)" : ""}: ${row.reason}`
    const reason = summary.byReason.get(reasonKey) ?? { count: 0, examples: [] }
    reason.count += 1
    if (row.command && reason.examples.length < 1) reason.examples.push(row.command.slice(0, 120))
    summary.byReason.set(reasonKey, reason)

    const key = dayKey(row.time)
    const day = summary.byDay.get(key) ?? { allow: 0, ask: 0, deny: 0 }
    day[row.decision] += 1
    summary.byDay.set(key, day)

    if (!summary.first || row.time < summary.first) summary.first = row.time
    if (!summary.last || row.time > summary.last) summary.last = row.time
  }

  summary.topReasons = [...summary.byReason.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, top)
  return summary
}

function pct(part, total) {
  return total ? `${((part / total) * 100).toFixed(1)} %` : "–"
}

function printText(summary, args) {
  const total = summary.decisions.allow + summary.decisions.ask + summary.decisions.deny
  if (!total) {
    console.log("Keine Entscheidungen im gewaehlten Zeitraum.")
    console.log(`Datei: ${args.file} (und .1)`)
    return
  }
  const fmt = (d) => (d ? d.toLocaleString("de-DE") : "–")
  console.log(`Zeitraum: ${fmt(summary.first)} bis ${fmt(summary.last)}`)
  console.log(`Entscheidungen: ${total}   (setup-Zeilen: ${summary.setup}, sonstige: ${summary.other})`)
  console.log("")
  console.log(`  allow  ${String(summary.decisions.allow).padStart(5)}  ${pct(summary.decisions.allow, total).padStart(7)}`)
  console.log(`  ask    ${String(summary.decisions.ask).padStart(5)}  ${pct(summary.decisions.ask, total).padStart(7)}`)
  console.log(`  deny   ${String(summary.decisions.deny).padStart(5)}  ${pct(summary.decisions.deny, total).padStart(7)}`)
  console.log("")
  console.log(`Reviewer befragt: ${summary.reviewer.consulted}  (davon freigegeben: ${summary.reviewer.allowed}, Zurueckfrage: ${summary.reviewer.withheld})`)
  console.log("")
  console.log("Nach Tag:")
  for (const [day, counts] of [...summary.byDay.entries()].sort()) {
    const sum = counts.allow + counts.ask + counts.deny
    console.log(`  ${day}  allow ${String(counts.allow).padStart(4)}  ask ${String(counts.ask).padStart(4)}  deny ${String(counts.deny).padStart(3)}  = ${String(sum).padStart(4)}`)
  }
  console.log("")
  console.log(`Haeufigste Gruende (Top ${args.top}):`)
  for (const [reason, info] of summary.topReasons) {
    console.log(`  ${String(info.count).padStart(4)}  ${reason}`)
    if (args.examples > 0 && info.examples.length) {
      console.log(`        z. B. ${info.examples[0]}`)
    }
  }
}

function toJson(summary) {
  return {
    first: summary.first?.toISOString() ?? null,
    last: summary.last?.toISOString() ?? null,
    decisions: summary.decisions,
    reviewer: summary.reviewer,
    setupLines: summary.setup,
    otherLines: summary.other,
    byDay: Object.fromEntries(summary.byDay),
    reasons: Object.fromEntries([...summary.byReason.entries()].map(([k, v]) => [k, v.count])),
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log("node stats.mjs [--since YYYY-MM-DD] [--days N] [--top N] [--examples N] [--json] [--file PFAD]")
    return 0
  }
  if (!fs.existsSync(args.file) && !fs.existsSync(`${args.file}.1`)) {
    console.error(`Kein Guard-Log gefunden: ${args.file}`)
    console.error("Das Plugin schreibt es, sobald im Projekt eine Shell-Anfrage bewertet wurde.")
    return 1
  }
  const rows = readLines(args.file).map(parseLine)
  const summary = summarize(rows, args)
  if (args.json) console.log(JSON.stringify(toJson(summary), null, 2))
  else printText(summary, args)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
