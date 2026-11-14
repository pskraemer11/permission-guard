// Verdrahtungstest fuer index.js (OpenCode-Plugin). Braucht @opencode/plugin
// (devDependency): `npm install` vor dem ersten Lauf. Ausfuehren: node test-index.mjs
//
// Das Plugin wird mit einem Fake-ctx eingebunden; die Hook-Funktion wird
// abgefangen und mit einem Shell-Ereignis aufgerufen. fetch ist eine Attrappe,
// die Modellanfragen mitschreibt. So bleibt der Test ohne laufendes Modell
// deterministisch.
//
// Der Projektordner ist bewusst ein Windows-Pfad. guard.js loest nur
// Laufwerkspfade auf (resolveTarget: alles ab "/" ist "Unix-Wurzel oder UNC");
// mit einem POSIX-Pfad kaeme "Arbeitsordner unbekannt" heraus und dieselbe
// Anweisung endete als "ask" statt "deny". Die Verdrahtung ist damit auf jeder
// Plattform gleich pruefbar - die Ci-Matrix belegt das.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Audit- und Schattenprotokoll in ein Temp-Verzeichnis umlenken, damit der Test
// keine echten Protokolle beschreibt.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pg-index-test-"))
process.env.PERMISSION_GUARD_AUDIT = path.join(scratch, "audit.jsonl")
process.env.PERMISSION_GUARD_GIT_SHADOW_LOG = path.join(scratch, "git-shadow.jsonl")

const { default: plugin } = await import("./index.js")

let failed = 0
const checks = []
const check = (name, ok, detail = "") => {
  if (!ok) failed++
  checks.push([name, ok, detail])
}

// Attrappe fuer das Modell: Die Antwort gibt "changes" hohe Wahrscheinlichkeit,
// damit nichts auf allow gehoben wird. Alle Anfragen werden protokolliert.
const modelCalls = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options = {}) => {
  modelCalls.push({ url: String(url), body: String(options.body ?? "") })
  const answer = {
    model: "stub",
    answers: { effect: { type: "choice", choice: "changes", probabilities: { changes: 0.9, reads: 0.1 }, confidence: 0.9 } },
    usage: { input_tokens: 0, output_tokens: 0 },
  }
  return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } })
}

// Hook einsammeln: setup() ruft ctx.permission.hook("evaluate", fn) auf.
let evaluateHook = null
const ctx = {
  location: { directory: "C:\\work\\scratch-project" },
  permission: {
    hook: async (name, fn) => {
      if (name === "evaluate") evaluateHook = fn
    },
  },
}

check("Plugin-Objekt hat die id permission-guard", plugin?.id === "permission-guard", String(plugin?.id))
await plugin.setup(ctx)
check("setup registriert den evaluate-Hook", typeof evaluateHook === "function")

// 1) Befehl nur in den Metadaten: Das Modell muss ihn sehen (Befund index.js:273).
modelCalls.length = 0
const metaOnly = {
  action: "shell",
  effect: "ask",
  resources: ["some-unknown-tool --run"],
  metadata: { command: "other-unknown-tool --target-from-metadata" },
}
await evaluateHook(metaOnly)
const seenByModel = modelCalls.map((c) => c.body).join("\n")
check(
  "Modell sieht Befehle aus den Metadaten",
  seenByModel.includes("other-unknown-tool--target-from-metadata") || seenByModel.includes("other-unknown-tool"),
  `Anfragen: ${modelCalls.length}`,
)
check("Metadaten-Befehl fuehrt nicht zu allow", metaOnly.effect !== "allow", String(metaOnly.effect))

// 2) Aussen-Schreiben neben unlesbarem Teil wird verweigert, nicht dem Modell vorgelegt.
modelCalls.length = 0
const outside = {
  action: "shell",
  effect: "ask",
  resources: ["some-unknown-tool ; Set-Content C:/Users/x/Desktop/x.txt y"],
  metadata: {},
}
await evaluateHook(outside)
check("Aussen-Schreiben wird verweigert", outside.effect === "deny", `effect=${outside.effect}`)
check("Aussen-Schreiben erreicht das Modell nicht", modelCalls.length === 0, `Anfragen: ${modelCalls.length}`)

// Aufraeumen
globalThis.fetch = originalFetch
fs.rmSync(scratch, { recursive: true, force: true })

for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`)
}
console.log(`\n${checks.length - failed}/${checks.length} bestanden`)
process.exit(failed ? 1 : 0)
