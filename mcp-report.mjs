#!/usr/bin/env node
// Auswertung der Audit-Kette (Schritt F, 05.11.2026).
//
// Liest decision- und result-Datensaetze, zaehlt nach Werkzeug, Absicht,
// Entscheidung, Schicht und Modus, zeigt die Matrix "statischer Effekt gegen
// Schattenurteil" und prueft die Aktivierungskriterien.
//
// Aufruf:
//   node mcp-report.mjs                 # alles
//   node mcp-report.mjs --days 7        # letzte 7 Tage
//   node mcp-report.mjs --since 2026-11-01
//   node mcp-report.mjs --json
//
// Es werden nur Feldnamen, Zaehler und Hashes gelesen - der Audit enthaelt
// keine Argumentwerte.

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { auditPath, parseLines } from "./audit.js"

// Kriterien (Nutzerentscheid 05.11.2026)
export const CRITERIA = { days: 7, calls: 50, tools: 3, writeTools: 1 }

function day(value) {
  return String(value ?? "").slice(0, 10)
}

function bump(map, key) {
  map[key] = (map[key] ?? 0) + 1
  return map
}

// Fasst die Datensaetze zusammen. Rein: kein Dateisystem, keine Uhr.
export function summarizeAudit(records, options = {}) {
  const now = options.now ? new Date(options.now) : new Date()
  let since = options.since ?? ""
  if (!since && options.days) {
    const start = new Date(now.getTime() - options.days * 86400000)
    since = start.toISOString().slice(0, 10)
  }

  const decisions = []
  const results = []
  for (const record of records) {
    if (!record || typeof record !== "object") continue
    if (since && day(record.ts) < since) continue
    if (record.kind === "decision") decisions.push(record)
    else if (record.kind === "result") results.push(record)
  }

  const summary = {
    since,
    calls: decisions.length,
    decisions: { allow: 0, ask: 0, deny: 0 },
    layers: { 1: 0, 2: 0, 3: 0 },
    modes: {},
    effects: { allow: 0, ask: 0, deny: 0, unbekannt: 0 },
    matrix: {},
    flags: { unknownIntent: 0, secret: 0, oversized: 0, unresolved: 0, content: 0 },
    tools: {},
    model: [],
    results: { completed: 0, error: 0, other: 0 },
    open: 0,
    days: [],
  }

  const resultKeys = new Set(results.map((record) => record.callID))
  const modelSeen = new Map()

  for (const record of decisions) {
    bump(summary.decisions, record.decision ?? "ask")
    bump(summary.layers, String(record.layer ?? 1))
    bump(summary.modes, record.mode ?? "unbekannt")
    bump(summary.effects, record.effect ?? "unbekannt")

    const effect = summary.effects[record.effect] ? record.effect : "unbekannt"
    summary.matrix[effect] = summary.matrix[effect] ?? { allow: 0, ask: 0, deny: 0 }
    bump(summary.matrix[effect], record.decision ?? "ask")

    if (record.intent === "unknown") summary.flags.unknownIntent++
    if (Array.isArray(record.contextFlags)) {
      if (record.contextFlags.includes("secret")) summary.flags.secret++
      if (record.contextFlags.includes("oversized")) summary.flags.oversized++
      if (record.contextFlags.includes("unresolved")) summary.flags.unresolved++
      if (record.contextFlags.includes("content")) summary.flags.content++
    }

    const tool = String(record.tool ?? "-")
    const entry = summary.tools[tool] ?? { calls: 0, intents: new Set(), decisions: { allow: 0, ask: 0, deny: 0 } }
    entry.calls++
    entry.intents.add(record.intent ?? "unknown")
    bump(entry.decisions, record.decision ?? "ask")
    summary.tools[tool] = entry

    if (Number(record.layer) === 3) {
      const key = `${tool}|${record.decision}|${record.reason}`
      modelSeen.set(key, (modelSeen.get(key) ?? 0) + 1)
    }

    if (!resultKeys.has(record.callID)) summary.open++
  }

  for (const record of results) bump(summary.results, record.status === "completed" || record.status === "error" ? record.status : "other")

  const toolNames = Object.keys(summary.tools).sort()
  const writeTools = toolNames.filter((name) => {
    const intents = summary.tools[name].intents
    return intents.has("write") || intents.has("destructive")
  })
  summary.dayList = [...new Set(decisions.map((record) => day(record.ts)))].sort()
  summary.toolList = toolNames.map((name) => ({
    tool: name,
    calls: summary.tools[name].calls,
    intents: [...summary.tools[name].intents].sort(),
    decisions: summary.tools[name].decisions,
  }))
  summary.writeTools = writeTools
  summary.model = [...modelSeen.entries()]
    .map(([key, count]) => {
      const [tool, decision, reason] = key.split("|")
      return { tool, decision, reason, count }
    })
    .sort((a, b) => b.count - a.count)

  const met = {
    days: summary.dayList.length >= CRITERIA.days,
    calls: summary.calls >= CRITERIA.calls,
    tools: toolNames.length >= CRITERIA.tools,
    writeTools: writeTools.length >= CRITERIA.writeTools,
  }
  summary.criteria = {
    met,
    ok: Object.values(met).every(Boolean),
    have: {
      days: summary.dayList.length,
      calls: summary.calls,
      tools: toolNames.length,
      writeTools: writeTools.length,
    },
  }
  return summary
}

function table(rows, headers) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index] ?? "").length)),
  )
  const line = (cells) => cells.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("  ")
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join("\n")
}

function printText(summary) {
  const range = summary.since ? `ab ${summary.since}` : "gesamter Zeitraum"
  console.log(`Zeitraum: ${range}  Tage mit Aufrufen: ${summary.dayList.length}  Aufrufe: ${summary.calls}`)
  console.log(
    `Entscheidungen: allow ${summary.decisions.allow}  ask ${summary.decisions.ask}  deny ${summary.decisions.deny}` +
      `  Schichten: 1=${summary.layers[1]} 2=${summary.layers[2]} 3=${summary.layers[3]}` +
      `  Modus: ${Object.entries(summary.modes).map(([k, v]) => `${k}=${v}`).join(" ")}`,
  )
  console.log(`Ergebnisse: completed ${summary.results.completed}  error ${summary.results.error}  sonstige ${summary.results.other}  offen ${summary.open}`)

  const effects = ["allow", "ask", "deny", "unbekannt"].filter((key) => summary.matrix[key])
  if (effects.length) {
    console.log("\nMatrix statischer Effekt -> Schattenurteil")
    console.log(
      table(
        effects.map((effect) => [effect, summary.matrix[effect].allow ?? 0, summary.matrix[effect].ask ?? 0, summary.matrix[effect].deny ?? 0]),
        ["Effekt", "allow", "ask", "deny"],
      ),
    )
  }

  if (summary.toolList.length) {
    console.log("\nWerkzeuge")
    console.log(
      table(
        summary.toolList.map((entry) => [
          entry.tool,
          entry.calls,
          entry.intents.join("+"),
          `${entry.decisions.allow}/${entry.decisions.ask}/${entry.decisions.deny}`,
        ]),
        ["Werkzeug", "Aufrufe", "Absicht", "allow/ask/deny"],
      ),
    )
  }

  const flags = Object.entries(summary.flags).filter(([, count]) => count > 0)
  if (flags.length) {
    console.log(`\nAuffaelligkeiten: ${flags.map(([name, count]) => `${name}=${count}`).join("  ")}`)
  }

  if (summary.model.length) {
    console.log("\nModellentscheidungen (Ebene 3)")
    console.log(table(summary.model.map((entry) => [entry.tool, entry.decision, entry.count, entry.reason]), ["Werkzeug", "Urteil", "Anzahl", "Grund"]))
  }

  const c = summary.criteria
  const status = c.ok ? "erfuellt" : "nicht erfuellt"
  console.log(
    `\nF-Kriterien: ${status}  Tage ${c.have.days}/${CRITERIA.days}  Aufrufe ${c.have.calls}/${CRITERIA.calls}` +
      `  Werkzeuge ${c.have.tools}/${CRITERIA.tools}  schreibend ${c.have.writeTools}/${CRITERIA.writeTools}`,
  )
}

function main() {
  const argv = process.argv.slice(2)
  const value = (name) => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const file = value("file") ?? auditPath()
  if (!file) {
    console.error("mcp-report: kein Ablageort (PERMISSION_GUARD_AUDIT=off?)")
    process.exit(1)
  }

  const records = []
  for (const path of [`${file}.1`, file]) {
    if (!existsSync(path)) continue
    const parsed = parseLines(readFileSync(path, "utf8"))
    if (!parsed.ok) {
      console.error(`mcp-report: ${path}: ${parsed.error}`)
      process.exit(1)
    }
    records.push(...parsed.records)
  }
  if (!records.length) {
    console.error(`mcp-report: keine Datensaetze in ${file}`)
    process.exit(1)
  }

  const summary = summarizeAudit(records, {
    since: value("since"),
    days: value("days") ? Number(value("days")) : undefined,
    now: value("now"),
  })

  if (argv.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }
  printText(summary)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
