#!/usr/bin/env node
// Replay: spielt die im opencode.log protokollierten Shell-Aufrufe gegen den
// Klassifizierer und zaehlt die Entscheidungen. Damit ist eine Aussage wie
// "x % der Befehle laufen ohne Rueckfrage" reproduzierbar statt behauptet.
//
// Quelle sind die Zeilen "spawning process": sie enthalten den vollstaendigen
// Befehl, die Argumentliste und das Arbeitsverzeichnis.
//
// Nicht geeignet sind die Zeilen "evaluated permission=bash pattern=...":
// "pattern" ist nur das Fragment, auf das eine statische Regel gematcht hat
// (z. B. "ConvertFrom-Json"), nicht der Befehl. Ein Replay darauf misst Unsinn.
//
// Aufruf:
//   node replay.mjs [logdatei] [Optionen]
//
// Optionen:
//   --since <datum>   nur Eintraege ab JJJJ-MM-TT bzw. ISO-Zeitpunkt
//   --limit <n>       nur die letzten n Shell-Aufrufe
//   --all             Duplikate mitzaehlen (Standard: einmal je Befehl+cwd)
//   --examples <n>    bis zu n ask-Faelle mit Grund ausgeben (Standard 8)
//   --top <n>         die n haeufigsten ask-Anfaenge nennen (Standard 10)
//   --json            maschinenlesbare Ausgabe
//   --help
//
// Das Arbeitsverzeichnis kommt aus dem Log, nicht aus dem Aufrufordner: relative
// Pfade werden also so bewertet wie in der damaligen Sitzung.
//
// Grenze der Aussage: gezaehlt werden alle Shell-Aufrufe, auch die, die schon
// durch die statischen Regeln ohne Rueckfrage liefen. Der Anteil "ohne
// Rueckfrage" ist deshalb eine Obergrenze, nicht die Zahl der eingesparten
// Rueckfragen.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { evaluate } from "./guard.js"

const DEFAULT_LOG = path.join(os.homedir(), ".local", "share", "opencode", "log", "opencode.log")
const SPAWN_RX =
  /^timestamp=(\S+) .*?message="spawning process" command="((?:[^"\\]|\\.)*)" args="((?:[^"\\]|\\.)*)" cwd="((?:[^"\\]|\\.)*)"/
const SHELLS = new Set(["pwsh.exe", "powershell.exe", "pwsh", "powershell", "bash.exe", "bash", "sh", "zsh", "cmd.exe"])

function usage(code = 0) {
  const text = `Replay der Shell-Aufrufe aus dem OpenCode-Log.

  node replay.mjs [logdatei] [--since <datum>] [--limit <n>]
                  [--all] [--examples <n>] [--top <n>] [--json]

  Standard-Log: ${DEFAULT_LOG}`
  console.log(text)
  process.exit(code)
}

function parseArgs(argv) {
  const opts = { log: DEFAULT_LOG, since: null, limit: 0, all: false, examples: 8, top: 10, json: false }
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
    else if (arg === "--all") opts.all = true
    else if (arg === "--examples") opts.examples = Number(next())
    else if (arg === "--top") opts.top = Number(next())
    else if (arg === "--json") opts.json = true
    else if (arg.startsWith("-")) throw new Error(`unbekannte Option: ${arg}`)
    else opts.log = arg
  }
  if (!Number.isFinite(opts.limit) || opts.limit < 0) throw new Error("--limit erwartet eine Zahl")
  return opts
}

// Zap schreibt JSON-Escapes in die Logzeile: \" \\ \n \t \uXXXX.
function unescape(value) {
  let out = ""
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch !== "\\") {
      out += ch
      continue
    }
    const esc = value[++i]
    if (esc === undefined) {
      out += "\\"
      break
    }
    if (esc === "n") out += "\n"
    else if (esc === "r") out += "\r"
    else if (esc === "t") out += "\t"
    else if (esc === "\\") out += "\\"
    else if (esc === '"') out += '"'
    else if (esc === "u") {
      out += String.fromCharCode(parseInt(value.slice(i + 1, i + 5), 16))
      i += 4
    } else out += "\\" + esc
  }
  return out
}

// Aus args (JSON-Array) das Skript holen: -Command <script> bzw. -c <script>.
function extractScript(argsJson) {
  let args
  try {
    args = JSON.parse(argsJson)
  } catch {
    return null
  }
  if (!Array.isArray(args)) return null
  for (let i = 0; i < args.length - 1; i++) {
    const flag = String(args[i]).toLowerCase()
    if (flag === "-command" || flag === "-c" || flag === "/c" || flag === "-encodedcommand") {
      return typeof args[i + 1] === "string" && args[i + 1].trim() ? args[i + 1] : null
    }
  }
  return null
}

function readInvocations(file) {
  const raw = fs.readFileSync(file, "utf8")
  const entries = []
  let foreign = 0
  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes('message="spawning process"')) continue
    const match = SPAWN_RX.exec(line)
    if (!match) continue
    const command = unescape(match[2])
    const shell = path.basename(command).toLowerCase()
    if (!SHELLS.has(shell)) {
      foreign++
      continue
    }
    const script = extractScript(unescape(match[3]))
    if (!script) continue
    entries.push({ at: match[1], script, cwd: unescape(match[4]) })
  }
  return { entries, foreign }
}

// Fuer die Punkt-8-Analyse (analyze.mjs): dieselbe Parsing-Logik wird
// importiert statt kopiert - so kann keine Variante veralten.
export { DEFAULT_LOG, extractScript, readInvocations, unescape }

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

  // Standard: jeder Befehl einmal je Arbeitsordner. Sonst dominieren
  // Alltagsbefehle wie `git status` die Statistik. Das ist die Variety-Sicht.
  // --all zaehlt dagegen jede Ausfuehrung (frequenzgewichtet, Pareto-Sicht) -
  // in Fenstern mit wiederholten Befehlen koennen beide auseinanderlaufen.
  const seen = new Map()
  for (const entry of selected) {
    const key = opts.all ? `${entry.at}\u0000${entry.cwd}\u0000${entry.script}` : `${entry.cwd}\u0000${entry.script}`
    const hit = seen.get(key)
    if (hit) {
      hit.count++
      hit.last = entry.at
    } else {
      seen.set(key, { ...entry, count: 1, first: entry.at, last: entry.at })
    }
  }
  const commands = [...seen.values()]

  const home = os.homedir()
  const tmpRoot = path.join(os.tmpdir(), "opencode")
  const verdicts = commands.map((entry) => {
    const base = entry.cwd
    // Der globale Ladekontext (Basis = Benutzerprofil) registriert sich in
    // Produktion nicht; dort fragt also immer das statische Regelsystem.
    if (path.resolve(base).toLowerCase() === path.resolve(home).toLowerCase()) {
      return { ...entry, decision: "ask", reason: "kein Projektkontext" }
    }
    return { ...entry, ...evaluate(entry.script, { base, roots: [base, tmpRoot], home, temp: os.tmpdir() }) }
  })

  const count = { allow: 0, ask: 0, deny: 0 }
  for (const v of verdicts) count[v.decision] = (count[v.decision] ?? 0) + 1

  const byReason = new Map()
  for (const v of verdicts.filter((v) => v.decision === "ask")) {
    const key = v.reason.split(":")[0]
    byReason.set(key, (byReason.get(key) ?? 0) + 1)
  }
  const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1])

  const firstAt = selected[0]?.at.slice(0, 10) ?? "?"
  const lastAt = selected[selected.length - 1]?.at.slice(0, 10) ?? "?"

  const result = {
    log: path.resolve(opts.log),
    invocations: entries.length,
    considered: selected.length,
    foreignProcesses: foreign,
    uniqueCommands: commands.length,
    firstAt,
    lastAt,
    count,
    percent: {
      allow: Number(((100 * count.allow) / commands.length).toFixed(1)),
      ask: Number(((100 * count.ask) / commands.length).toFixed(1)),
      deny: Number(((100 * count.deny) / commands.length).toFixed(1)),
    },
    reasons: Object.fromEntries(reasons),
  }

  if (opts.json) {
    console.log(JSON.stringify({ ...result, examples: verdicts.filter((v) => v.decision === "ask").slice(0, opts.examples) }, null, 2))
    return 0
  }

  const pad = (v, n) => String(v).padStart(n)
  console.log(`Log      : ${result.log}`)
  console.log(`Zeitraum : ${firstAt} .. ${lastAt}`)
  console.log(`Shell-Aufrufe im Log: ${entries.length}; betrachtet: ${selected.length}; fremde Prozesse uebersprungen: ${foreign}`)
  console.log(`Befehle  : ${commands.length}${opts.all ? "" : " (eindeutig je Arbeitsordner)"}`)
  console.log("")
  for (const key of ["allow", "ask", "deny"]) {
    console.log(`  ${key.padEnd(6)} ${pad(count[key], 6)}  ${result.percent[key].toFixed(1).padStart(5)} %`)
  }

  if (reasons.length) {
    console.log("\nGruende fuer ask")
    for (const [reason, n] of reasons) console.log(`  ${String(n).padStart(6)}  ${reason}`)
  }

  if (opts.top > 0) {
    const byCmd = new Map()
    for (const a of verdicts.filter((v) => v.decision === "ask")) {
      const head = a.script.trim().split(/\s+/).slice(0, 2).join(" ")
      byCmd.set(head, (byCmd.get(head) ?? 0) + 1)
    }
    const top = [...byCmd.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.top)
    if (top.length) {
      console.log(`\nTop ${top.length} ask-Anfaenge (erste zwei Woerter)`)
      for (const [head, n] of top) console.log(`  ${String(n).padStart(6)}  ${head}`)
    }
  }

  if (opts.examples > 0) {
    const asks = verdicts.filter((v) => v.decision === "ask").slice(0, opts.examples)
    if (asks.length) {
      console.log(`\nBeispiele (${asks.length})`)
      for (const a of asks) {
        const one = a.script.replace(/\s+/g, " ").slice(0, 110)
        console.log(`  [${a.reason.split(":")[0]}] ${one}`)
      }
    }
  }

  return 0
}

// Nur beim direkten Start ausfuehren; als Import (analyze.mjs) bleibt die
// Datei Bibliothek.
if (process.argv[1] &&
    path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = main()
}
