#!/usr/bin/env node
// Urteilsdatei fuer Skill-Skripte (Nutzerentscheid 05.11.2026).
//
// Drei Betriebsarten:
//   build    (Standard)  verdichtet SkillSpector-Berichte und Pruefprotokolle
//   --refresh            gleicht nur die Hashes mit dem Arbeitsbaum ab
//   --verify             prueft die vorhandene Datei, schreibt nichts
//
// build braucht die Berichte (--reports, wiederholbar). refresh und verify
// kommen ohne sie aus: sie kennen keine Scores, nur Dateien und Hashes. Damit
// kann ein pre-commit die Datei fortschreiben und eine CI sie pruefen, ohne
// dass ein Scanner, ein Netz oder ein Schluessel vorhanden sein muss.
//
// Eine Freigabe ("trust") wird nie erfunden. Sie bleibt nur bestehen, wenn
// sich keine Skriptdatei geaendert hat; sonst faellt der Eintrag auf "ask".

import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"

const SCHEMA = 1

function fail(message, code = 2) {
  console.error(`skill-verdicts: ${message}`)
  process.exit(code)
}

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`)
  if (i > 0 && i + 1 < process.argv.length) return process.argv[i + 1]
  return fallback
}

// Wiederholbares --reports: spaeteres Verzeichnis gewinnt je Skill.
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

function hashTree(dir) {
  const out = {}
  for (const full of pythonFiles(dir).sort()) {
    out[relative(dir, full).split(/[\\/]/).join("/").toLowerCase()] = hashFile(full)
  }
  return out
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

function loadExisting(outFile) {
  if (!existsSync(outFile)) return { skills: {} }
  try {
    return JSON.parse(readFileSync(outFile, "utf8"))
  } catch {
    fail(`vorhandene Datei ist kein gueltiges JSON: ${outFile} (nicht ueberschrieben)`)
  }
}

// Alle Skills im Verzeichnis, die Python-Code enthalten.
function skillDirs(skillsDir) {
  return readdirSync(skillsDir)
    .filter((name) => existsSync(join(skillsDir, name)) && statSync(join(skillsDir, name)).isDirectory())
    .sort()
}

function decide(prev, hashes, name, drift) {
  if (!prev) return { decision: "ask", reason: "neu, ohne Bericht" }
  if (prev.decision === "reject") return { decision: "reject", reason: prev.reason ?? "bestehend" }
  if (prev.decision === "trust" && unchanged(prev, hashes)) {
    return { decision: "trust", reason: prev.reason ?? "unveraendert" }
  }
  if (prev.decision === "trust") {
    drift.push(name)
    return { decision: "ask", reason: "Skriptdatei geaendert" }
  }
  return { decision: prev.decision ?? "ask", reason: prev.reason ?? "bestehend" }
}

function build(reportsDirs, skillsDir, reviewsDir, existing, drift) {
  const found = new Map()
  for (const dir of reportsDirs) {
    for (const file of readdirSync(dir)) {
      if (!file.toLowerCase().endsWith(".json")) continue
      found.set(basename(file, ".json"), { path: join(dir, file), source: basename(dir) })
    }
  }

  const skills = {}
  const missing = []
  let withoutCode = 0

  for (const [name, source] of [...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const dir = join(skillsDir, name)
    if (!existsSync(dir)) {
      missing.push(name)
      continue
    }
    const hashes = hashTree(dir)
    if (!Object.keys(hashes).length) {
      withoutCode++
      continue
    }
    let report
    try {
      report = readReport(source.path)
    } catch {
      fail(`Bericht nicht lesbar: ${source.path}`)
    }
    const verdict = decide(existing?.skills?.[name], hashes, name, drift)
    skills[name] = {
      ...verdict,
      score: report.score,
      severity: report.severity,
      findings: report.findings,
      rules: report.rules,
      report: source.source,
      reviewed: reviewDate(reviewsDir, name),
      sha256: hashes,
    }
  }
  return { skills, stats: { found: found.size, withoutCode, missing } }
}

function refresh(skillsDir, reviewsDir, existing, drift) {
  const skills = {}
  const removed = []
  const added = []
  const known = existing?.skills ?? {}

  for (const name of skillDirs(skillsDir)) {
    const dir = join(skillsDir, name)
    const hashes = hashTree(dir)
    if (!Object.keys(hashes).length) continue
    const prev = known[name]
    if (!prev) added.push(name)
    const verdict = decide(prev, hashes, name, drift)
    skills[name] = {
      ...verdict,
      score: prev?.score ?? null,
      severity: prev?.severity ?? null,
      findings: prev?.findings ?? null,
      rules: prev?.rules ?? [],
      report: prev?.report ?? null,
      reviewed: reviewDate(reviewsDir, name),
      sha256: hashes,
    }
  }

  for (const name of Object.keys(known)) {
    if (!(name in skills)) removed.push(name)
  }
  return { skills, stats: { removed, added } }
}

function verify(dbFile, skillsDir) {
  if (!existsSync(dbFile)) fail(`Urteilsdatei fehlt: ${dbFile}`, 1)
  let data
  try {
    data = JSON.parse(readFileSync(dbFile, "utf8"))
  } catch {
    fail(`Urteilsdatei ist kein gueltiges JSON: ${dbFile}`, 1)
  }
  if (data?.schema !== SCHEMA) fail(`Schema ${data?.schema} statt ${SCHEMA}`, 1)

  const problems = []
  const entries = data.skills ?? {}

  for (const [name, entry] of Object.entries(entries)) {
    if (!["trust", "ask", "reject"].includes(entry?.decision)) {
      problems.push(`${name}: Entscheidung "${entry?.decision}" ist ungueltig`)
      continue
    }
    const dir = join(skillsDir, name)
    if (!existsSync(dir)) {
      problems.push(`${name}: Skill-Ordner fehlt`)
      continue
    }
    const hashes = hashTree(dir)
    if (!Object.keys(hashes).length) {
      problems.push(`${name}: kein Python-Code mehr vorhanden`)
      continue
    }
    if (!unchanged(entry, hashes)) {
      const known = Object.keys(entry?.sha256 ?? {})
      const now = Object.keys(hashes)
      const added = now.filter((k) => !known.includes(k)).length
      const changed = known.filter((k) => hashes[k] && hashes[k] !== entry.sha256[k]).length
      const gone = known.filter((k) => !(k in hashes)).length
      problems.push(`${name}: Hash weicht ab (neu ${added}, geaendert ${changed}, entfallen ${gone})`)
    }
  }

  for (const name of skillDirs(skillsDir)) {
    if (name in entries) continue
    if (Object.keys(hashTree(join(skillsDir, name))).length) {
      problems.push(`${name}: Python-Code ohne Eintrag`)
    }
  }

  if (problems.length) {
    console.error(`skill-verdicts: ${problems.length} Abweichung(en) in ${dbFile}`)
    for (const line of problems) console.error(`  ${line}`)
    console.error("  Naechster Schritt: node skill-verdicts.mjs --refresh --write")
    process.exit(1)
  }

  console.log(`skill-verdicts: ${Object.keys(entries).length} Eintraege, Datei passt zum Arbeitsbaum.`)
}

function main() {
  const skillsDir = resolve(arg("skills", join(homedir(), ".agents", "skills")))
  if (!existsSync(skillsDir)) fail(`Skill-Verzeichnis fehlt: ${skillsDir}`)
  const outFile = resolve(arg("out", join(homedir(), ".agents", "skill-reviews", "verdicts.json")))
  const reviewsDir = dirname(outFile)

  if (process.argv.includes("--verify")) {
    verify(outFile, skillsDir)
    return
  }

  const doRefresh = process.argv.includes("--refresh")
  const generated = arg("date", today())
  const existing = loadExisting(outFile)
  const drift = []
  let skills
  let stats
  let reportsField = Array.isArray(existing?.reports) ? existing.reports : []

  if (doRefresh) {
    ;({ skills, stats } = refresh(skillsDir, reviewsDir, existing, drift))
    console.error(`Skills mit Python-Code: ${Object.keys(skills).length}  entfernt: ${stats.removed.length}`)
    for (const name of stats.removed) console.error(`  entfernt: ${name}`)
    for (const name of stats.added) console.error(`  neu aufgenommen (ohne Bericht): ${name}`)
  } else {
    const reportsDirs = args("reports").map((value) => resolve(value))
    if (!reportsDirs.length) fail("--reports fehlt (Verzeichnis mit den SkillSpector-Berichten)")
    for (const dir of reportsDirs) {
      if (!existsSync(dir)) fail(`Berichtsverzeichnis fehlt: ${dir}`)
    }
    ;({ skills, stats } = build(reportsDirs, skillsDir, reviewsDir, existing, drift))
    reportsField = reportsDirs.map((dir) => basename(dir))
    console.error(
      `Berichte: ${stats.found} aus ${reportsDirs.length} Verzeichnis(sen)  ` +
        `Skills mit Python-Code: ${Object.keys(skills).length}  ohne Code: ${stats.withoutCode}`,
    )
    for (const name of stats.missing) console.error(`  Hinweis: Bericht ohne Skill-Ordner: ${name}`)
  }

  const names = Object.keys(skills)
  const trusted = names.filter((n) => skills[n].decision === "trust")
  const unguarded = trusted.filter((n) => !skills[n].reviewed)

  console.error(`Vertraut: ${trusted.length}  zurueckgesetzt: ${drift.length}`)
  for (const name of drift) console.error(`  zurueckgesetzt (Skript geaendert): ${name}`)
  for (const name of unguarded) console.error(`  Hinweis: trust ohne Pruefprotokoll: ${name}`)

  const payload = {
    schema: SCHEMA,
    generated,
    reports: reportsField,
    skills,
  }

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
