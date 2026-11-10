// Diagnose-Hilfen fuer den permission-guard.
//
// Befehlstexte koennen Geheimnisse enthalten, auch wenn der Secret-Filter sie
// nicht erkennt. Deshalb landet nur der Programmname und ein Hash im Log.
// Die Ablage liegt auf POSIX in einem benutzerspezifischen Temp-Unterordner
// und wird auf private Modi gesetzt; unter Windows ist os.tmpdir() bereits
// benutzerspezifisch.

import { chmodSync, lstatSync, mkdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { shortHash } from "./audit.js"

export function guardLogDir(
  platform = process.platform,
  uid = typeof process.getuid === "function" ? process.getuid() : null,
) {
  const suffix = platform === "win32" || uid === null ? "" : `-${uid}`
  return join(tmpdir(), `opencode-permission-guard${suffix}`)
}

export function commandSummary(script) {
  const text = String(script ?? "").trim()
  const first = text.split(/\s+/)[0] ?? ""
  const base = first.split(/[\\/]/).pop() ?? ""
  const name = base.replace(/[^\w.-]/g, "").slice(0, 40) || "unbekannt"
  return `${name}#${shortHash(text).slice(0, 12)}`
}

export function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const info = lstatSync(dir)
  if (info.isSymbolicLink()) throw new Error("Logverzeichnis ist ein Symlink")
  if (typeof process.getuid === "function" && statSync(dir).uid !== process.getuid()) {
    throw new Error("Logverzeichnis gehoert einem anderen Benutzer")
  }
  try {
    chmodSync(dir, 0o700)
  } catch {
    // Windows: chmod ist nicht ACL-wirksam; der Benutzer-Tempordner ist privat.
  }
}

export function ensurePrivateFile(file) {
  try {
    chmodSync(file, 0o600)
  } catch {
    // Datei existiert noch nicht oder chmod ist auf Windows nicht wirksam.
  }
}
