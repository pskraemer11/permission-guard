#!/usr/bin/env node
// Prueft die Audit-Kette (Schritt D, 05.11.2026).
//
// Aufruf:
//   node verify-audit.mjs                 # Standardablage, auch die Rotation
//   node verify-audit.mjs --file <pfad>   # abweichende Datei
//   node verify-audit.mjs --last          # nur die aktuelle Generation
//
// Exit 0 = Kette in Ordnung, 1 = Bruch oder Lesefehler.

import { existsSync, readFileSync } from "node:fs"
import { auditPath, parseLines, verifyChain } from "./audit.js"

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

for (const path of generations) {
  if (!existsSync(path)) continue
  const parsed = parseLines(readFileSync(path, "utf8"))
  if (!parsed.ok) {
    console.error(`verify-audit: ${path}: ${parsed.error}`)
    process.exit(1)
  }
  const result = verifyChain(parsed.records, prev, seq)
  if (!result.ok) {
    console.error(`verify-audit: ${path}: ${result.error} (nach ${total} Datensaetzen)`)
    process.exit(1)
  }
  total += result.count
  prev = result.last
  seq += result.count
  console.log(`${path}: ${result.count} Datensaetze in Ordnung`)
}

console.log(`verify-audit: Kette intakt, ${total} Datensaetze.`)
process.exit(0)
