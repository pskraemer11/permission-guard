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
import { MCP_GATING_MODE, contextScope, evaluate, mcpAction, mcpCriteria, mcpObservation, mcpVerdict } from "./guard.js"
import { appendRecord, auditPath, callKey, readState, shortHash } from "./audit.js"
import { ensureRunning, loadConfig, review, reviewMcp, warmup } from "./reviewer.js"

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
    appData: process.env.APPDATA,
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
    // Audit-Kette (Schritt D): Feldnamen, Zielarten, Entscheidungen und Hashes.
    // Keine Argumentwerte, keine Pfade, keine URLs. Schreibfehler landen als
    // Diagnosezeile, nie als Ausnahme - das Audit darf den Guard nicht stoeren.
    const auditFile = auditPath()
    let auditState = auditFile ? readState(auditFile) : null
    const seenMcpTools = new Set()
    const audit = (fields) => {
      if (!auditFile || !auditState) return
      auditState = appendRecord(
        auditFile,
        { ts: new Date().toISOString(), mode: MCP_GATING_MODE, ...fields },
        auditState,
        { onError: (error) => debug(`audit error ${error?.message ?? String(error)}`) },
      )
    }
    // OpenCode laedt globale Plugins zusaetzlich ohne Projektbezug (Basis ist
    // dann das Benutzerprofil). Dieser Kontext registriert nur den MCP-Zweig:
    // Shell-Pfade im ganzen Profil als vertraut zu behandeln waere zu weit.
    // Die MCP-Beobachtung ist davon unabhaengig und soll auch dort laufen.
    const homeContext = contextScope(options.base, os.homedir()) === "mcp"
    debug(homeContext ? "setup: globaler Kontext - nur MCP-Beobachtung" : `setup: base=${options.base}`)

    try {
      await hook("evaluate", async (input) => {
        try {
          if (!input) return

          // Schritte A, B und C (29.10., 04.11.2026): MCP beobachten, nach den
          // vier Kriterien einordnen (principal, action, resource, context) und
          // in drei Schichten urteilen. Die Argumente stehen im Event selbst
          // (metadata.input; Beweis: mcp.ts Z. 62 meldet sie). Ob das Urteil
          // gilt, entscheidet MCP_GATING_MODE in guard.js - in "shadow" wird
          // nur protokolliert, die statischen Regeln aus opencode.jsonc
          // entscheiden weiterhin. Der Zweig laeuft VOR der effect-Pruefung,
          // weil auch "allow"-Aufrufe (Regel oder gespeicherte Freigabe) fuer
          // die Monitor-Phase interessant sind. Im Log stehen Feldnamen und
          // Zielarten, nie Argumentwerte; ein Geheimnisverdacht wird
          // zusaetzlich gemeldet.
          const crit = mcpCriteria(
            String(input.action ?? ""),
            input.metadata,
            input.agent,
            input.sessionID,
          )
          if (crit.isMcp) {
            const effect = String(input.effect ?? "unbekannt").toLowerCase()
            const verdict = mcpVerdict(crit, input.metadata?.input ?? {})
            const argsNote = crit.hasArgs ? `args=${crit.argCount} felder=${crit.fields.join(",") || "-"}` : "keine argumente"
            const notes = [
              `absicht=${crit.action.intent}${crit.action.verb ? `/${crit.action.verb}` : ""}`,
              `ziel=${crit.resource.kinds.join("+") || "keins"}`,
            ]
            if (crit.context.contentFields.length) notes.push(`inhalt=${crit.context.contentFields.join(",")}`)
            if (crit.action.source === "arguments") notes.push("quelle=argumente")
            if (crit.context.unresolved) notes.push(`unaufgeloest=${crit.context.unresolved}`)
            if (crit.context.oversized) notes.push("unanalysierbar")
            if (crit.secret) notes.push("geheimnisverdacht")
            const plan = mcpAction(effect, verdict)
            notes.push(plan === "shadow" ? `schatten=${verdict.decision}/${verdict.layer}` : `urteil=${verdict.decision}/${verdict.layer}`)
            debug(`mcp ${effect} ${crit.action.tool} agent=${crit.principal.agent} key=${crit.key} ${argsNote} ${notes.join(" ")}`)

            // Audit (Schritt D): je Aufruf ein Entscheidungsdatensatz, auch im
            // Schattenmodus. Die Kennung verbindet ihn mit dem Ergebnisdatensatz
            // aus execute.after; source.id taugt dafuer nicht (D0: gilt je
            // execute-Block).
            seenMcpTools.add(crit.action.tool)
            const sessionHash = shortHash(input.sessionID)
            const record = (decision, layer, reason, applied, probability) =>
              audit({
                kind: "decision",
                sessionHash,
                sourceHash: shortHash(input.source?.id),
                callID: callKey(sessionHash, crit.action.tool, crit.argHash),
                agent: crit.principal.agent,
                tool: crit.action.tool,
                intent: crit.action.intent,
                verb: crit.action.verb || "-",
                resourceKinds: crit.resource.kinds,
                contextFlags: [
                  crit.context.emptyArgs ? "empty" : null,
                  crit.secret ? "secret" : null,
                  crit.context.oversized ? "oversized" : null,
                  crit.context.unresolved ? "unresolved" : null,
                  crit.context.contentFields.length ? "content" : null,
                ].filter(Boolean),
                decision,
                layer,
                reason: String(reason ?? "").slice(0, 80),
                effect,
                applied,
                status: "open",
                ...(probability == null ? {} : { probability }),
              })

            if (plan === "shadow" || plan === "keep") {
              record(verdict.decision, verdict.layer, verdict.reason, false)
              return
            }

            // Ebene 3 nur im Graubereich (Absicht unbekannt). Geheimnisverdacht
            // und unanalysierbare Argumente erreichen das Modell nie.
            const decided = plan === "model"
              ? await reviewMcp({ criteria: crit, input: input.metadata?.input ?? {}, project: options.base, config: reviewerConfig })
              : { decision: plan, reason: verdict.reason }

            if (decided.decision === "allow") {
              input.effect = "allow"
              input.message = `permission-guard: MCP ${decided.reason}`
              debug(`mcp allow (aktiv) ${decided.reason} ${crit.action.tool} key=${crit.key}`)
              record("allow", verdict.layer, decided.reason, true, decided.probability)
            } else if (decided.decision === "deny") {
              input.effect = "deny"
              input.message = `permission-guard: MCP ${decided.reason}`
              debug(`mcp deny (aktiv) ${decided.reason} ${crit.action.tool} key=${crit.key}`)
              record("deny", verdict.layer, decided.reason, true, decided.probability)
            } else {
              debug(`mcp ask (aktiv) ${decided.reason} ${crit.action.tool} key=${crit.key}`)
              record("ask", verdict.layer, decided.reason, false, decided.probability)
            }
            return
          }

          // Im globalen Kontext endet die Pruefung hier: Nur MCP wird
          // beobachtet, Shell-Befehle bleiben bei den statischen Regeln.
          if (homeContext) return

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

      // Ergebnisdatensatz (Schritt D): execute.after feuert laut D0 auch fuer
      // MCP-Aufrufe aus Code Mode, einmal je Werkzeug. Aufgenommen werden nur
      // Werkzeuge, die zuvor als MCP eingeordnet wurden - sonst entstuenden
      // Ergebniszeilen ohne Entscheidung.
      const toolHook = ctx?.tool?.hook
      if (typeof toolHook === "function") {
        await toolHook("execute.after", async (payload) => {
          try {
            const tool = String(payload?.tool ?? "")
            if (!tool || !seenMcpTools.has(tool) || !auditFile || !auditState) return
            const observation = mcpObservation(tool, { input: payload?.input })
            const sessionHash = shortHash(payload?.sessionID)
            auditState = appendRecord(
              auditFile,
              {
                kind: "result",
                ts: new Date().toISOString(),
                mode: MCP_GATING_MODE,
                sessionHash,
                sourceHash: shortHash(payload?.id),
                callID: callKey(sessionHash, tool, observation.argHash),
                agent: String(payload?.agent ?? "").replace(/[^\w.-]/g, "").slice(0, 40) || "unbekannt",
                tool,
                status: String(payload?.status ?? "unknown"),
              },
              auditState,
              { onError: (error) => debug(`audit error ${error?.message ?? String(error)}`) },
            )
          } catch (error) {
            debug(`audit result error ${error?.message ?? String(error)}`)
          }
        })
      }

      console.log(
        homeContext
          ? "[permission-guard] aktiv - globaler Kontext: MCP-Beobachtung; Shell-Regeln nur im Projekt"
          : `[permission-guard] aktiv - Lesen und Schreiben im Projekt laufen ohne Rueckfrage; Ebene 1 Reviewer ${reviewerConfig.enabled ? `an (${reviewerConfig.model} @ ${reviewerConfig.baseUrl})` : "aus"}`,
      )
      // Serverstart und Aufwaermlauf im Hintergrund: OpenCode oeffnet sich, der
      // Reviewer soll ohne Zutun bereitstehen, und die erste echte Entscheidung
      // soll den Kaltstart nicht bezahlen. Bewusst nicht awaited, damit die
      // Registrierung oben nicht auf ein langsames Backend wartet. Im globalen
      // Kontext wird der Reviewer nur fuer den aktiven MCP-Modus gebraucht;
      // im Schattenmodus waere ein 12B-Kaltstart ohne Nutzen.
      if (!homeContext || MCP_GATING_MODE === "active") void ensureRunning(reviewerConfig)
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
