#!/usr/bin/env node
// Erzeugt die Urteilsdatei fuer Skill-Skripte (Nutzerentscheid 05.11.2026).
//
// Quellen:
//   --reports  Verzeichnis mit SkillSpector-Berichten (<skill>.json)
//   --skills   Skill-Verzeichnis (Default: ~/.agents/skills)
//   --out      Zieldatei (Default: ~/.agents/skill-reviews/verdicts.json)
//   --date     Datum der Erzeugung (Default: heute, JJJJ-MM-TT)
//
// Die Datei enthaelt je Skill mit ausfuehrbarem Python-Code: Punktzahl,
// Regel-IDs, Datum des Pruefprotokolls und den SHA256 jeder Skriptdatei.
// Eine Freigabe ("trust") wird nie erfunden. Sie steht nur dann in der
// Ausgabe, wenn sie schon in der vorhandenen Datei stand und sich keine
// Skriptdatei geaendert hat. Jede Aenderung faellt auf "ask" zurueck, damit
// eine Freigabe nicht still auf neuen Code uebergeht.
//
// Der Guard liest die Datei nur. Ohne --write geht die Ausgabe nach stdout.

import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"

const SCHEMA = 1

function fail(message) {
  console.error(`skill-verdicts: ${message}`)
  process.exit(1)
}

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`)
  if (i > 0 && i + 1 < process.argv.length) return process.argv[i + 1]
  return fallback
}

// Wiederholbares --reports: spaetere Verzeichnisse gewinnen je Skill.
function args(name) {
  const values = []
  process.argv.forEach((value, i) => {
    if (value === `--${name}` && i + 1 < process.argv.length) values.push(process.argv[i + 1])
  })
  return values
}

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Python-Dateien unterhalb eines Skill-Ordners, ohne .git und __pycache__.
function pythonFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "__pycache__") continue
      pythonFiles(full, acc)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".py")) {
      acc.push(full)
    }
  }
  return acc
}

function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function readReport(file) {
  const data = JSON.parse(readFileSync(file, "utf8"))
  const risk = data?.risk_assessment ?? {}
  const issues = Array.isArray(data?.issues) ? data.issues : []
  const rules = [...new Set(issues.map((i) => String(i?.id ?? "")).filter(Boolean))].sort()
  return {
    score: Number(risk.score ?? 0),
    severity: String(risk.severity ?? ""),
    findings: issues.length,
    rules,
  }
}

// Datum aus dem Pruefprotokoll (<name>.md, Zeile "- Datum: JJJJ-MM-TT").
function reviewDate(reviewsDir, name) {
  try {
    const text = readFileSync(join(reviewsDir, `${name}.md`), "utf8")
    const m = /^-\s*Datum:\s*(\d{4}-\d{2}-\d{2})/m.exec(text)
    return m ? m[1] : null
  } catch {
    return null
  }
}

// Gleiche Dateimenge und gleiche Hashes? Nur dann darf "trust" bestehen.
function unchanged(prev, hashes) {
  const a = Object.keys(prev?.sha256 ?? {}).sort()
  const b = Object.keys(hashes).sort()
  if (a.length !== b.length) return false
  return a.every((key, i) => key === b[i] && prev.sha256[key] === hashes[key])
}

function main() {
  const reportDirs = args("reports").map((value) => resolve(value))
  if (!reportDirs.length) fail("--reports fehlt (Verzeichnis mit den SkillSpector-Berichten)")
  for (const dir of reportDirs) {
    if (!existsSync(dir)) fail(`Berichtsverzeichnis fehlt: ${dir}`)
  }

  const skillsDir = resolve(arg("skills", join(homedir(), ".agents", "skills")))
  if (!existsSync(skillsDir)) fail(`Skill-Verzeichnis fehlt: ${skillsDir}`)

  const outFile = resolve(arg("out", join(homedir(), ".agents", "skill-reviews", "verdicts.json")))
  const reviewsDir = dirname(outFile)
  const generated = arg("date", today())

  // Eine vorhandene Datei wird nur gelesen, nie stillschweigend ersetzt:
  // ohne lesbares JSON bleibt der Aufruf stehen.
  let existing = { skills: {} }
  if (existsSync(outFile)) {
    try {
      existing = JSON.parse(readFileSync(outFile, "utf8"))
    } catch {
      fail(`vorhandene Datei ist kein gueltiges JSON: ${outFile} (nicht ueberschrieben)`)
    }
  }

  const found = new Map()
  for (const dir of reportDirs) {
    for (const file of readdirSync(dir)) {
      if (!file.toLowerCase().endsWith(".json")) continue
      found.set(basename(file, ".json"), { path: join(dir, file), source: basename(dir) })
    }
  }

  const skills = {}
  const drift = []
  const missing = []
  let withoutCode = 0

  for (const [name, source] of [...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const skillDir = join(skillsDir, name)
    let files = []
    if (existsSync(skillDir)) {
      files = pythonFiles(skillDir).sort()
    } else {
      missing.push(name)
      continue
    }
    if (!files.length) {
      withoutCode++
      continue
    }

    let report
    try {
      report = readReport(source.path)
    } catch {
      fail(`Bericht nicht lesbar: ${source.path}`)
    }

    const sha256 = {}
    for (const full of files) {
      const key = relative(skillDir, full).split(/[\\/]/).join("/").toLowerCase()
      sha256[key] = hashFile(full)
    }

    const prev = existing?.skills?.[name]
    let decision = "ask"
    let reason = "neu"
    if (prev?.decision === "reject") {
      decision = "reject"
      reason = "bestehend"
    } else if (prev?.decision === "trust" && unchanged(prev, sha256)) {
      decision = "trust"
      reason = "unveraendert"
    } else if (prev?.decision === "trust") {
      reason = "Skriptdatei geaendert"
      drift.push(name)
    } else if (prev) {
      reason = "bestehend"
    }

    skills[name] = {
      decision,
      reason,
      score: report.score,
      severity: report.severity,
      findings: report.findings,
      rules: report.rules,
      report: source.source,
      reviewed: reviewDate(reviewsDir, name),
      sha256,
    }
  }

  const payload = {
    schema: SCHEMA,
    generated,
    reports: reportDirs.map((dir) => basename(dir)),
    skills,
  }

  const names = Object.keys(skills)
  const trusted = names.filter((n) => skills[n].decision === "trust")
  const unguarded = trusted.filter((n) => !skills[n].reviewed)

  console.error(`Berichte: ${found.size} aus ${reportDirs.length} Verzeichnis(sen)  Skills mit Python-Code: ${names.length}  ohne Code: ${withoutCode}`)
  console.error(`Vertraut: ${trusted.length}  zurueckgesetzt: ${drift.length}  fehlende Ordner: ${missing.length}`)
  for (const name of drift) console.error(`  zurueckgesetzt (Skript geaendert): ${name}`)
  for (const name of unguarded) console.error(`  Hinweis: trust ohne Pruefprotokoll: ${name}`)
  for (const name of missing) console.error(`  Hinweis: Bericht ohne Skill-Ordner: ${name}`)

  const text = `${JSON.stringify(payload, null, 2)}\n`
  if (!process.argv.includes("--write")) {
    process.stdout.write(text)
    return
  }

  const tmp = `${outFile}.tmp`
  writeFileSync(tmp, text, "utf8")
  renameSync(tmp, outFile)
  console.error(`geschrieben: ${outFile}`)
}

main()
