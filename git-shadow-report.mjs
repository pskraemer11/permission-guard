// Auswertung des Git-Schattenlaufs (Variante 3, 09.11.2026).
//
// Liest die JSONL-Datei und zaehlt nach Muster, Variante, Tag und Agent.
// Es werden nur Feldnamen, Zaehler und Hashes gelesen; Befehlstexte enthaelt
// die Datei ohnehin nicht.
//
//   node git-shadow-report.mjs
//   node git-shadow-report.mjs --json
//   node git-shadow-report.mjs --file=<pfad>

import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { shadowPath } from "./shadow.js"

export function summarizeShadow(text) {
  const patterns = {}
  const variants = {}
  const agents = {}
  const days = {}
  const commands = new Set()
  let total = 0

  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!record || typeof record !== "object" || !record.pattern) continue
    total += 1
    patterns[record.pattern] = (patterns[record.pattern] ?? 0) + 1
    const variant = String(record.variant ?? "unbekannt")
    variants[variant] = (variants[variant] ?? 0) + 1
    const agent = String(record.agent ?? "unbekannt")
    agents[agent] = (agents[agent] ?? 0) + 1
    const day = String(record.ts ?? "").slice(0, 10) || "unbekannt"
    days[day] = (days[day] ?? 0) + 1
    if (record.commandHash) commands.add(record.commandHash)
  }

  return { total, patterns, variants, agents, days, uniqueCommands: commands.size }
}

function sorted(object) {
  return Object.entries(object).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function printReport(file, summary) {
  console.log("Git-Schattenlauf (Variante 3)")
  console.log(`Datei: ${file}`)
  console.log(`Datensaetze: ${summary.total}`)
  console.log(`Eindeutige Befehle: ${summary.uniqueCommands}`)
  console.log("")
  console.log("Muster:")
  for (const [name, count] of sorted(summary.patterns)) console.log(`  ${name.padEnd(24)} ${count}`)
  console.log("")
  console.log("Varianten:")
  for (const [name, count] of sorted(summary.variants)) console.log(`  ${name.padEnd(24)} ${count}`)
  console.log("")
  console.log("Tage:")
  for (const [day, count] of sorted(summary.days)) console.log(`  ${day.padEnd(24)} ${count}`)
  console.log("")
  console.log("Agenten:")
  for (const [name, count] of sorted(summary.agents)) console.log(`  ${name.padEnd(24)} ${count}`)
}

function main() {
  const fileArg = process.argv.find((arg) => arg.startsWith("--file="))
  const file = fileArg ? fileArg.slice("--file=".length) : shadowPath()
  if (!file) {
    console.error("Schattenlauf ist aus (PERMISSION_GUARD_GIT_SHADOW_LOG=off) oder kein Ablageort bestimmbar.")
    process.exit(2)
  }

  let text = ""
  try {
    text = readFileSync(file, "utf8")
  } catch {
    console.log(`Keine Datensaetze: ${file}`)
    return
  }

  const summary = summarizeShadow(text)
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ file, ...summary }, null, 2))
  } else {
    printReport(file, summary)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
