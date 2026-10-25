#!/usr/bin/env node
// Analyse zu Punkt 8 (PLANUNG.md "Klassifizierer-Luecken"): Woher kommen die
// Rueckfragen, die weder "schreibend" noch Geheimnis sind? Basen wie
// replay.mjs (Spawn-Zeilen, ein Eintrag je Befehl+Arbeitsordner) und gruppiert
// die Faelle "nicht einordenbar" nach der ersten Anweisung, die der
// Klassifizierer nicht einordnen konnte. Erst belegen, dann fixen: jedes
// Muster, das guard.js spaeter freigibt, braucht einen Testfall.
//
// Aufruf:
//   node analyze.mjs [logdatei] [--since <datum>] [--limit <n>]
//                    [--patterns <n>] [--detail <text>]
//
//   --since/--limit   wie bei replay.mjs
//   --patterns <n>    oberste n Muster zeigen (Standard 25)
//   --detail <text>   vollstaendige Skripte ausgeben, deren unbekannte
//                     Anweisung den Text enthaelt (hoechstens 20)
//
// Das Skript entscheidet nichts - es zeigt nur, was gesammelt schon da ist.
// Delegation an classes: die unbekannte Anweisung kommt aus der Begruedung
// des Klassifizierers selbst, also ist keine Bewertungslogik doppelt.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { evaluate } from "./guard.js"
import { DEFAULT_LOG, readInvocations } from "./replay.mjs"

function usage(code = 0) {
  const text = `Analyse der Klassifizierer-Luecken aus dem OpenCode-Log.

  node analyze.mjs [logdatei] [--since <datum>] [--limit <n>]
                  [--patterns <n>] [--detail <text>]

  Standard-Log: ${DEFAULT_LOG}`
  console.log(text)
  process.exit(code)
}

function parseArgs(argv) {
  const opts = { log: DEFAULT_LOG, since: null, limit: 0, patterns: 25, detail: "" }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${arg} braucht einen Wert`)
      return v
    }
    if (arg === "--help" || arg === "-h") usage(0)
    else if (arg === "--since") opts.since = next()
    else if (arg === "--limit") opts.limit = Number(next())
    else if (arg === "--patterns") opts.patterns = Number(next())
    else if (arg === "--detail") opts.detail = next()
    else if (arg.startsWith("-")) throw new Error(`unbekannte Option: ${arg}`)
    else opts.log = arg
  }
  if (!Number.isFinite(opts.limit) || opts.limit < 0) throw new Error("--limit erwartet eine Zahl")
  if (!Number.isFinite(opts.patterns) || opts.patterns < 0) throw new Error("--patterns erwartet eine Zahl")
  return opts
}

// Eine unbekannte Anweisung zu einem Muster verschmelzen: dieselbe Stelle in
// 50 Skripten soll als ein Muster erscheinen, nicht als 50. Nur Strings,
// Zahlen und Variablennamen werden generalisiert - Flags und Befehlsnamen
// bleiben lesbar, weil sie die Fixierung bestimmen.
function shapeOf(statement) {
  return statement.trim()
    .replace(/@?["'][^"']*["']/g, '"\u2026"')
    .replace(/\$[A-Za-z_]\w*/g, "$V")
    .replace(/\s+/g, " ")
    .slice(0, 90)
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(opts.log)) {
    console.error(`Logdatei nicht gefunden: ${opts.log}`)
    return 1
  }

  const { entries, foreign } = readInvocations(opts.log)
  if (!entries.length) {
    console.error(`Keine Shell-Aufrufe in ${opts.log}`)
    return 1
  }

  let selected = entries
  if (opts.since) {
    const since = opts.since.length === 10 ? `${opts.since}T00:00:00Z` : opts.since
    const cutoff = Date.parse(since)
    if (Number.isNaN(cutoff)) {
      console.error(`--since ist kein Datum: ${opts.since}`)
      return 1
    }
    selected = selected.filter((e) => Date.parse(e.at) >= cutoff)
  }
  if (opts.limit > 0) selected = selected.slice(-opts.limit)

  // Ein Eintrag je Befehl+Arbeitsordner, wie in replay.mjs.
  const seen = new Map()
  for (const entry of selected) {
    const key = `${entry.cwd}\u0000${entry.script}`
    const hit = seen.get(key)
    if (hit) hit.count++
    else seen.set(key, { ...entry, count: 1 })
  }
  const commands = [...seen.values()]

  const home = os.homedir()
  const tmpRoot = path.join(os.tmpdir(), "opencode")
  const verdicts = commands.map((entry) => {
    const base = entry.cwd
    if (path.resolve(base).toLowerCase() === path.resolve(home).toLowerCase()) {
      return { ...entry, decision: "ask", reason: "kein Projektkontext" }
    }
    return { ...entry, ...evaluate(entry.script, { base, roots: [base, tmpRoot], home, temp: os.tmpdir() }) }
  })

  const asks = verdicts.filter((v) => v.decision === "ask")

  const byPrefix = new Map()
  for (const v of asks) {
    const key = v.reason.split(":")[0]
    byPrefix.set(key, (byPrefix.get(key) ?? 0) + 1)
  }

  const unknownTag = "nicht einordenbar: "
  const patterns = new Map()
  for (const v of asks) {
    if (!v.reason.startsWith(unknownTag)) continue
    const raw = v.reason.slice(unknownTag.length).replace(/\s+/g, " ").trim()
    const shape = shapeOf(raw)
    const hit = patterns.get(shape)
    if (hit) {
      hit.count++
      if (hit.samples.length < 2) hit.samples.push(raw)
    } else {
      patterns.set(shape, { count: 1, samples: [raw], example: v })
    }
  }

  const secretTag = "Geheimnis: "
  const secrets = new Map()
  for (const v of asks) {
    if (!v.reason.startsWith(secretTag)) continue
    secrets.set(v.reason.slice(secretTag.length), (secrets.get(v.reason.slice(secretTag.length)) ?? 0) + 1)
  }

  if (opts.detail) {
    const needle = opts.detail.toLowerCase()
    let shown = 0
    for (const v of asks) {
      if (!v.reason.toLowerCase().includes(needle)) continue
      if (shown >= 20) break
      shown++
      console.log(`--- [${v.reason.split(":")[0]}] ${v.cwd} (${v.count}x)`)
      console.log(v.script)
    }
    console.log(`\n${shown} Skripte mit "${opts.detail}" im Grund`)
    return 0
  }

  const firstAt = selected[0]?.at.slice(0, 10) ?? "?"
  const lastAt = selected[selected.length - 1]?.at.slice(0, 10) ?? "?"
  const pad = (v, n) => String(v).padStart(n)

  console.log(`Log      : ${path.resolve(opts.log)}`)
  console.log(`Zeitraum : ${firstAt} .. ${lastAt}`)
  console.log(`Shell-Aufrufe: ${entries.length}; betrachtet: ${selected.length}; fremde Prozesse uebersprungen: ${foreign}`)
  console.log(`Befehle  : ${commands.length} (eindeutig je Arbeitsordner); Rueckfragen: ${asks.length}`)
  console.log("")
  console.log("Gruende fuer ask")
  const reasons = [...byPrefix.entries()].sort((a, b) => b[1] - a[1])
  for (const [reason, n] of reasons) console.log(`  ${pad(n, 6)}  ${reason}`)

  const top = [...patterns.entries()].sort((a, b) => b[1].count - a[1].count)
  console.log(`\nTop ${Math.min(opts.patterns, top.length)} von ${top.length} Mustern unter "nicht einordenbar"` +
    (top.length ? " (erste unbekannte Anweisung, generalisiert)" : ""))
  for (const [shape, info] of top.slice(0, opts.patterns)) {
    console.log(`  ${pad(info.count, 6)}  ${shape}`)
    for (const raw of [...new Set(info.samples)].slice(0, 2)) console.log(`          ${raw.length > 120 ? `${raw.slice(0, 117)}...` : raw}`)
  }

  const secretsTop = [...secrets.entries()].sort((a, b) => b[1] - a[1])
  if (secretsTop.length) {
    console.log(`\nTop ${Math.min(12, secretsTop.length)} von ${secretsTop.length} Geheimnis-Gruenden (Punkt 8.4, nur Information)`)
    for (const [term, n] of secretsTop.slice(0, 12)) console.log(`  ${pad(n, 6)}  ${term}`)
  }

  return 0
}

// Nur beim direkten Start ausfuehren; als Import bleibt die Datei Bibliothek.
if (process.argv[1] &&
    path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = main()
}
