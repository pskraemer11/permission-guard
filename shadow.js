// Schattenlauf fuer destruktive Git-Formen (Variante 3, 09.11.2026).
//
// Der Schattenlauf schreibt nur Beobachtungen. Er aendert keine Entscheidung
// und enthaelt keine Befehlstexte, Pfade oder Argumentwerte: nur Muster,
// Variante, Effekt, geplantes Urteil, Agent und Hashes.

import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

// Ablageort: Windows LOCALAPPDATA, sonst XDG_STATE_HOME. "off" schaltet ab.
export function shadowPath(env = process.env, platform = process.platform) {
  const custom = env.PERMISSION_GUARD_GIT_SHADOW_LOG
  if (custom === "off") return null
  if (custom) return custom
  if (platform === "win32") {
    if (!env.LOCALAPPDATA) return null
    return join(env.LOCALAPPDATA, "opencode", "permission-guard", "git-shadow.jsonl")
  }
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state")
  return join(state, "opencode", "permission-guard", "git-shadow.jsonl")
}

// Haengt einen Datensatz an. Schreibfehler werden nur gemeldet, nie geworfen:
// der Schattenlauf darf den Guard nicht stoeren.
export function appendShadow(file, record) {
  if (!file) return false
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(record)}\n`)
    return true
  } catch {
    return false
  }
}
