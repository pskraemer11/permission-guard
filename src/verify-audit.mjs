#!/usr/bin/env node
// Prueft die Audit-Kette (Schritt D, 05.11.2026).
//
// Aufruf:
//   node src/verify-audit.mjs                 # Standardablage, auch die Rotation
//   node src/verify-audit.mjs --file <pfad>   # abweichende Datei
//   node src/verify-audit.mjs --last          # nur die aktuelle Generation
//
// Exit 0 = Kette in Ordnung, 1 = Bruch oder Lesefehler.

import { existsSync, readFileSync } from "node:fs"
import { auditPath, checkAnchor, parseLines, readAuditKey, verifyChain } from "./audit.js"

const argv = process.argv.slice(2)
const fileArg = argv.indexOf("--file")
const onlyLast = argv.includes("--last")
const file = fileArg >= 0 ? argv[fileArg + 1] : auditPath()

if (!file) {
  console.error("verify-audit: kein Ablageort (PERMISSION_GUARD_AUDIT=off?)")
  process.exit(1)
}
if (!existsSync(file)) {
  console.error(`verify-audit: Datei fehlt: ${file}`)
  process.exit(1)
}

const generations = onlyLast ? [file] : [`${file}.1`, file]
let prev = "genesis"
let seq = 1
let total = 0
let legacy = 0
const key = readAuditKey(file)

for (const path of generations) {
  if (!existsSync(path)) continue
  const parsed = parseLines(readFileSync(path, "utf8"))
  if (!parsed.ok) {
    console.error(`verify-audit: ${path}: ${parsed.error}`)
    process.exit(1)
  }
  const result = verifyChain(parsed.records, prev, seq, { key })
  if (!result.ok) {
    console.error(`verify-audit: ${path}: ${result.error} (nach ${total} Datensaetzen)`)
    process.exit(1)
  }
  total += result.count
  legacy += result.legacy ?? 0
  prev = result.last
  seq += result.count
  console.log(`${path}: ${result.count} Datensaetze in Ordnung`)
}

// Der Anker der aktuellen Generation muss zur letzten Zeile passen -
// sonst wurde am Ende abgeschnitten oder die Datei ersetzt.
if (!onlyLast || existsSync(file)) {
  const parsed = parseLines(readFileSync(file, "utf8"))
  if (parsed.ok) {
    const anchor = checkAnchor(file, parsed.records)
    if (!anchor.ok) {
      console.error(`verify-audit: ${anchor.error}`)
      process.exit(1)
    }
    if (anchor.anchored) console.log("Anker: letzte Zeile verankert")
  }
}

if (legacy > 0) console.log(`Hinweis: ${legacy} Datensaetze ohne MAC (alte Ablage).`)
console.log(`verify-audit: Kette intakt, ${total} Datensaetze.`)
process.exit(0)
