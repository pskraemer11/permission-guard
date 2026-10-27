// OpenCode-Plugin: dynamische Pfad- und Kommando-Pruefung fuer Shell-Aufrufe.
//
// Haengt an permission.evaluate und stuft ein "ask" der statischen Regeln auf
// "allow" hoch, wenn das Skript nachweislich nur liest oder nur in vertraute
// Ordner schreibt. Aufrufe ueber "&" oder "." (Ziel in Variablen/Bindung,
// Zeile nicht lesbar) stuft es auf "deny" herab - Nutzerentscheid vom
// 22.10.2026. Alles andere bleibt "ask"; ein "deny" der statischen Regeln
// wird nie ueberschrieben.
//
// Ebene 1 (25.10.2026): Bleibt nach der statischen Pruefung ein "nicht
// einordenbar" uebrig, fragt reviewer.js ein lokales Modell (llama.cpp). Das
// Modell darf ausschliesslich "ask" zu "allow" heben; eine Risikoliste wird
// vorher geprueft, jeder Fehler und jeder Timeout bleibt "ask".
//
// Die Entscheidungslogik liegt in guard.js und reviewer.js und ist ohne
// OpenCode testbar (node test.mjs). Dieses Modul ist nur die Verdrahtung.

import { Plugin } from "@opencode/plugin"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { evaluate } from "./guard.js"
import { ensureRunning, loadConfig, review, warmup } from "./reviewer.js"

const BASE_DIR = path.join(os.tmpdir(), "opencode-permission-guard")
const LOG_FILE = path.join(BASE_DIR, "guard.log")
// Eine Generation Historie: bei 1 MB wird guard.log zu guard.log.1 und neu
// begonnen. Frueher wurde die Datei geloescht, damit war die Statistik nach
// wenigen Tagen weg (stats.mjs liest beide Generationen).
const LOG_MAX_BYTES = 1024 * 1024

// Diagnose: Entscheidung und Grund. Bei "allow" zusaetzlich die ersten Zeichen
// des Befehls (er hat den Geheimnis-Filter bereits passiert). Bei "ask"/"deny"
// bewusst kein Befehlstext, damit nichts Sensibles im Log landet.
function debug(message) {
  try {
    fs.mkdirSync(BASE_DIR, { recursive: true })
    try {
      if (fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
        fs.renameSync(LOG_FILE, `${LOG_FILE}.1`)
      }
    } catch {
      // Logdatei existiert noch nicht
    }
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Diagnose darf den Server nie stoeren.
  }
}

// resources[] enthaelt die einzelnen Segmente des Befehls (durch | ; && getrennt).
// Alle zusammen ergeben das Skript; ein einzelnes Segment zu pruefen waere lueckenhaft.
function pickScript(input) {
  const parts = []
  if (Array.isArray(input.resources)) {
    for (const r of input.resources) {
      if (typeof r === "string" && r.trim()) parts.push(r)
    }
  }
  const meta = input.metadata
  if (meta && typeof meta === "object") {
    for (const key of ["command", "cmd", "script", "commandLine"]) {
      const v = meta[key]
      if (typeof v === "string" && v.trim()) parts.push(v)
    }
  }
  return parts.join("\n")
}

const SHELL_ACTIONS = new Set(["shell", "bash", "execute", "terminal", "command"])

function guardOptions(ctx) {
  const base = ctx?.location?.directory ?? process.cwd()
  return {
    base,
    roots: [base, path.join(os.tmpdir(), "opencode")],
    home: os.homedir(),
    temp: os.tmpdir(),
  }
}

export default Plugin.define({
  id: "permission-guard",

  async setup(ctx) {
    const hook = ctx.permission?.hook
    if (typeof hook !== "function") {
      console.error("[permission-guard] permission.hook ist nicht verfuegbar")
      return
    }

    const options = guardOptions(ctx)
    const reviewerConfig = loadConfig()
    // OpenCode laedt globale Plugins zusaetzlich ohne Projektbezug (Basis ist
    // dann das Benutzerprofil). Wuerde dieser Kontext mitregistrieren, waere
    // das gesamte Profil vertraut - deshalb nur der Projektkontext.
    if (path.resolve(options.base).toLowerCase() === path.resolve(os.homedir()).toLowerCase()) {
      debug("setup: globaler Kontext ohne Projekt - keine Registrierung")
      return
    }
    debug(`setup: base=${options.base}`)

    try {
      await hook("evaluate", async (input) => {
        try {
          if (!input) return
          if (String(input.effect ?? "").toLowerCase() !== "ask") return
          if (!SHELL_ACTIONS.has(String(input.action ?? "").toLowerCase())) return

          const script = pickScript(input)
          if (!script) return

          const verdict = evaluate(script, options)
          if (verdict.decision === "allow") {
            input.effect = "allow"
            input.message = `permission-guard: ${verdict.reason}`
            debug(`allow ${verdict.reason} | ${script.replace(/\s+/g, " ").slice(0, 140)}`)
          } else if (verdict.decision === "deny") {
            input.effect = "deny"
            input.message = `permission-guard: ${verdict.reason}`
            debug(`deny ${verdict.reason}`)
          } else if (verdict.reason.startsWith("nicht einordenbar")) {
            // Ebene 1: lokales Modell entscheidet nur ueber den Rest.
            // Grundlage sind die vom Scanner getrennten Segmente; sie zeigen
            // auch Inhalte, die in Anfuehrungszeichen verborgen waeren.
            const commands = Array.isArray(input.resources) && input.resources.length
              ? input.resources
              : [script]
            const reviewed = await review({ commands, project: options.base, temp: options.temp, config: reviewerConfig })
            if (reviewed.decision === "allow") {
              input.effect = "allow"
              input.message = `permission-guard: reviewer ${reviewed.reason}`
              debug(`allow (reviewer) ${reviewed.reason} | ${commands.join(" ; ").replace(/\s+/g, " ").slice(0, 140)}`)
            } else {
              const detail = verdict.reason.startsWith("Geheimnis") ? "" : ` | ${script.replace(/\s+/g, " ").slice(0, 140)}`
              debug(`ask (reviewer) ${reviewed.reason}${detail}`)
            }
          } else {
            // Bei Geheimnis-Verdacht bewusst kein Befehlstext im Log.
            const detail = verdict.reason.startsWith("Geheimnis") ? "" : ` | ${script.replace(/\s+/g, " ").slice(0, 140)}`
            debug(`ask ${verdict.reason}${detail}`)
          }
        } catch (error) {
          debug(`error ${error?.message ?? String(error)}`)
        }
      })
      console.log(
        `[permission-guard] aktiv - Lesen und Schreiben im Projekt laufen ohne Rueckfrage; Ebene 1 Reviewer ${reviewerConfig.enabled ? `an (${reviewerConfig.model} @ ${reviewerConfig.baseUrl})` : "aus"}`,
      )
      // Serverstart und Aufwaermlauf im Hintergrund: OpenCode oeffnet sich, der
      // Reviewer soll ohne Zutun bereitstehen, und die erste echte Entscheidung
      // soll den Kaltstart nicht bezahlen. Bewusst nicht awaited, damit die
      // Registrierung oben nicht auf ein langsames Backend wartet.
      void ensureRunning(reviewerConfig)
        .then((s) => {
          const state = s.already ? "lief bereits" : s.started ? `gestartet (Port ${s.port})` : "nicht gestartet"
          debug(`setup: Server ${state}${s.reason ? ` (${s.reason})` : ""}`)
          return warmup(reviewerConfig)
        })
        .then((w) => debug(`setup: Aufwaermlauf ${w.ok ? "ok" : "fehlgeschlagen"} ${w.ms ?? 0} ms${w.reason ? ` (${w.reason})` : ""}`))
        .catch(() => {})
    } catch (error) {
      debug(`setup: Registrierung fehlgeschlagen ${error?.message ?? error}`)
      console.error("[permission-guard] Registrierung fehlgeschlagen", error)
    }
  },
})
