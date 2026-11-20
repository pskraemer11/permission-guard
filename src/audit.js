// Audit-Kette fuer MCP-Entscheidungen (Schritt D, 05.11.2026).
//
// Zwei Datensaetze je Aufruf: "decision" beim permission.evaluate (auch im
// Schattenmodus) und "result" beim execute.after. Verknuepft werden sie ueber
// einen Schluessel aus Sitzung, Werkzeug und Argument-Hash - D0 hat gezeigt,
// dass source.id je execute-Block gilt und fuer mehrere Aufrufe gleich ist.
//
// Der Datensatz enthaelt niemals Argumentwerte, Resultatinhalte, URLs oder
// Pfade: nur Feldnamen, Zielarten, Flags, Entscheidungen und Hashes.
//
// Grenze: Eine Hash-Kette erkennt Veraenderung und Umordnung, aber kein
// Abschneiden am Ende ohne externen Anker. Sie ist keine Signatur.

import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const AUDIT_SCHEMA = 1
export const GENESIS = "genesis"
export const MAX_BYTES = 5 * 1024 * 1024

function sha256(text) {
  return createHash("sha256").update(text).digest("hex")
}

// Stabile Serialisierung: Schluessel sortiert, keine Leerzeichen. Zwei gleiche
// Datensaetze ergeben damit immer denselben Hash, auch nach einem Neustart.
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  const keys = Object.keys(value).sort()
  const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
  return `{${parts.join(",")}}`
}

export function hashRecord(record) {
  const { hash, ...rest } = record
  return sha256(canonicalJson(rest))
}

// Schluessel fuer die Zusammenfuehrung von decision und result.
export function callKey(sessionHash, tool, argHash) {
  return sha256(`${sessionHash}|${tool}|${argHash}`).slice(0, 16)
}

export function shortHash(value) {
  const text = String(value ?? "")
  return text ? sha256(text).slice(0, 16) : "-"
}

// Ablageort: Windows LOCALAPPDATA, sonst XDG_STATE_HOME. "off" schaltet ab.
export function auditPath(env = process.env, platform = process.platform) {
  const custom = env.PERMISSION_GUARD_AUDIT
  if (custom === "off") return null
  if (custom) return custom
  if (platform === "win32") {
    if (!env.LOCALAPPDATA) return null
    return join(env.LOCALAPPDATA, "opencode", "permission-guard", "audit.jsonl")
  }
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state")
  return join(state, "opencode", "permission-guard", "audit.jsonl")
}

// Liest den letzten Datensatz, damit die Kette nach einem Neustart weiterlaeuft.
export function readState(file) {
  try {
    if (!existsSync(file)) return { prev: GENESIS, seq: 0 }
    const text = readFileSync(file, "utf8").trimEnd()
    if (!text) return { prev: GENESIS, seq: 0 }
    const lines = text.split(/\r?\n/)
    const last = JSON.parse(lines[lines.length - 1])
    return { prev: String(last.hash ?? GENESIS), seq: Number(last.seq ?? 0) }
  } catch {
    return { prev: GENESIS, seq: 0 }
  }
}

// Haengt einen Datensatz an und gibt den neuen Kettenzustand zurueck.
// Schreibfehler werden gemeldet, nie geworfen: das Audit darf den Guard nicht
// stoeren.
export function appendRecord(file, fields, state, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_BYTES
  try {
    mkdirSync(dirname(file), { recursive: true })
    try {
      if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`)
    } catch {
      // Datei existiert noch nicht
    }
    const record = {
      v: AUDIT_SCHEMA,
      ...fields,
      seq: state.seq + 1,
      prev: state.prev,
    }
    record.hash = hashRecord(record)
    appendFileSync(file, `${canonicalJson(record)}\n`)
    return { prev: record.hash, seq: record.seq }
  } catch (error) {
    options.onError?.(error)
    return state
  }
}

// Prueft eine Folge von Datensaetzen. startPrev erlaubt die Fortsetzung ueber
// eine Rotation hinweg (erster Datensatz der neuen Generation).
export function verifyChain(records, startPrev = GENESIS, startSeq = 1) {
  let prev = startPrev
  let expectedSeq = startSeq
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (!record || typeof record !== "object") {
      return { ok: false, count: index, error: `Datensatz ${index + 1} ist kein Objekt` }
    }
    if (record.v !== AUDIT_SCHEMA) {
      return { ok: false, count: index, error: `Datensatz ${index + 1}: Schema ${record.v}` }
    }
    if (Number(record.seq) !== expectedSeq) {
      return { ok: false, count: index, error: `Datensatz ${index + 1}: seq ${record.seq} statt ${expectedSeq}` }
    }
    if (record.prev !== prev) {
      return { ok: false, count: index, error: `Datensatz ${index + 1}: prev passt nicht zur Kette` }
    }
    if (record.hash !== hashRecord(record)) {
      return { ok: false, count: index, error: `Datensatz ${index + 1}: Hash weicht ab` }
    }
    prev = record.hash
    expectedSeq += 1
  }
  return { ok: true, count: records.length, last: records.length ? prev : startPrev }
}

// Liest eine Datei zeilenweise als Datensaetze. Defekte Zeilen werden als
// Fehler gemeldet, nicht uebersprungen.
export function parseLines(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
  const records = []
  for (let index = 0; index < lines.length; index++) {
    try {
      records.push(JSON.parse(lines[index]))
    } catch {
      return { ok: false, error: `Zeile ${index + 1} ist kein JSON`, records }
    }
  }
  return { ok: true, records }
}
