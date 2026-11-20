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
// Grenz-Markierung fuer diesen Testlauf aktiv: Der Schalter wird beim Laden
// von index.js gelesen, deshalb vor dem Import setzen.
process.env.PERMISSION_GUARD_RESULT_SHIELD = "annotate"

const { default: plugin } = await import("./index.js")
const { evaluate, scopeEdit } = await import("./guard.js")
const { guardLogDir } = await import("./diagnostics.js")

let failed = 0
const checks = []
const check = (name, ok, detail = "") => {
  if (!ok) failed++
  checks.push([name, ok, detail])
}

// Attrappe fuer das Modell: Die Antwort gibt "changes" hohe Wahrscheinlichkeit,
// damit nichts auf allow gehoben wird. Fuer einen Befehl mit "ForEach-Object"
// antwortet die Attrappe umgekehrt mit hoher Lese-Wahrscheinlichkeit - sie
// wuerde den Block also freigeben. Alle Anfragen werden protokolliert.
const modelCalls = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options = {}) => {
  const body = String(options.body ?? "")
  modelCalls.push({ url: String(url), body })
  const blockCommand = body.includes("ForEach-Object")
  const probabilities = blockCommand
    ? { changes: 0.05, reads: 0.95 }
    : { changes: 0.9, reads: 0.1 }
  const answer = {
    model: "stub",
    answers: { effect: { type: "choice", choice: blockCommand ? "reads" : "changes", probabilities, confidence: 0.9 } },
    usage: { input_tokens: 0, output_tokens: 0 },
  }
  return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } })
}

// Hook einsammeln: setup() ruft ctx.permission.hook("evaluate", fn) auf.
let evaluateHook = null
let executeAfterHook = null
let contextHook = null
const ctx = {
  location: { directory: "C:\\work\\scratch-project" },
  permission: {
    hook: async (name, fn) => {
      if (name === "evaluate") evaluateHook = fn
    },
  },
  tool: {
    hook: async (name, fn) => {
      if (name === "execute.after") executeAfterHook = fn
    },
  },
  session: {
    hook: async (name, fn) => {
      if (name === "context") contextHook = fn
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

// 3) Skriptblock hinter einem lesenden Pipeline-Cmdlet: Die Attrappe wuerde
// diesen Befehl freigeben (reads 0.95). Der Block wird statisch als eigenes
// Skript bewertet - hier verweigert - und erreicht das Modell gar nicht
// (Review 17.11.2026, nachgezogen 17.11.2026).
modelCalls.length = 0
const block = {
  action: "shell",
  effect: "ask",
  resources: ["Get-ChildItem | ForEach-Object { Remove-Item -Recurse -Force C:/Windows/x }"],
  metadata: {},
}
await evaluateHook(block)
check("Skriptblock mit Loeschbefehl wird verweigert", block.effect === "deny", `effect=${block.effect}`)
check("Skriptblock erreicht das Modell nicht", modelCalls.length === 0, `Anfragen: ${modelCalls.length}`)

// 4) Edits: Nur das "ask" der statischen Regeln wird am Zielpfad gemessen.
// Schreiben im Projekt wird hochgestuft; geschuetzte Pfade und Ziele ausserhalb
// werden verweigert. Die Ziele sind Windows-Pfade (siehe Kopf) - ein Ziel im
// Benutzerprofil ist entweder geschuetzt oder nicht aufloesbar, in beiden
// Faellen "deny".
modelCalls.length = 0
const editInside = {
  action: "edit",
  effect: "ask",
  resources: ["C:\\work\\scratch-project\\notes.md"],
  metadata: {},
}
await evaluateHook(editInside)
check("Edit im Projekt wird erlaubt", editInside.effect === "allow", `effect=${editInside.effect}`)

const editOutside = {
  action: "edit",
  effect: "ask",
  resources: ["C:\\work\\other\\notes.md"],
  metadata: {},
}
await evaluateHook(editOutside)
check("Edit ausserhalb des Projekts wird verweigert", editOutside.effect === "deny", `effect=${editOutside.effect}`)

const homePath = os.homedir().replace(/\//g, "\\")
const editProtected = {
  action: "edit",
  effect: "ask",
  resources: [`${homePath}\\.ssh\\id_rsa`],
  metadata: {},
}
await evaluateHook(editProtected)
check("Edit auf geschuetzten Pfad wird verweigert", editProtected.effect === "deny", `effect=${editProtected.effect}`)

const editMixed = {
  action: "edit",
  effect: "ask",
  resources: ["C:\\work\\scratch-project\\a.md", `${homePath}\\.ssh\\config`],
  metadata: {},
}
await evaluateHook(editMixed)
check("Ein geschuetztes Ziel verweigert den ganzen Edit", editMixed.effect === "deny", `effect=${editMixed.effect}`)
check("Edits erreichen das Modell nicht", modelCalls.length === 0, `Anfragen: ${modelCalls.length}`)

// 5) Statische allow/deny bleiben unveraendert.
const editStaticAllow = {
  action: "edit",
  effect: "allow",
  resources: [`${homePath}\\.ssh\\id_rsa`],
  metadata: {},
}
await evaluateHook(editStaticAllow)
check("Statisches allow beim Edit bleibt allow", editStaticAllow.effect === "allow", `effect=${editStaticAllow.effect}`)

const editStaticDeny = {
  action: "edit",
  effect: "deny",
  resources: ["C:\\work\\scratch-project\\notes.md"],
  metadata: {},
}
await evaluateHook(editStaticDeny)
check("Statisches deny beim Edit bleibt deny", editStaticDeny.effect === "deny", `effect=${editStaticDeny.effect}`)

// 6) Eine echte Junction unter dem Projekt darf ihr physisches Ziel nicht
// verbergen. Unter POSIX kennt der Guard bewusst nur Laufwerkspfade, daher ist
// dieser Fall auf Windows begrenzt.
if (process.platform === "win32") {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pg-edit-outside-"))
  try {
    fs.writeFileSync(path.join(outside, "secret.md"), "x")
    const link = path.join(scratch, "linked")
    fs.symlinkSync(outside, link, "junction")
    const linkedEdit = scopeEdit([path.join(link, "secret.md")], {
      base: scratch,
      roots: [scratch],
      home: os.homedir(),
      temp: os.tmpdir(),
      appData: process.env.APPDATA,
    })
    check("Junction unter Projekt wird physisch verweigert", linkedEdit.decision === "deny", linkedEdit.reason)
    const linkedShell = evaluate(`Write-Output 1 | ForEach-Object { Set-Content '${path.join(link, "shell.md")}' y }`, {
      base: scratch,
      roots: [scratch],
      home: os.homedir(),
      temp: os.tmpdir(),
      appData: process.env.APPDATA,
    })
    check("Junction auch in Pipeline-Block verweigert", linkedShell.decision === "deny", linkedShell.reason)
  } finally {
    fs.rmSync(outside, { recursive: true, force: true })
  }
}

// 7) Erkannter sende-/schreibender Parameter erreicht das Modell nie, selbst
// mit einer Attrappe, die alles freigeben wuerde (Abnahme Blocker 4).
modelCalls.length = 0
{
  const permissive = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    modelCalls.push({ url: String(url), body: String(options.body ?? "") })
    return new Response(JSON.stringify({ model: "stub", answers: { effect: { type: "choice", choice: "reads", probabilities: { changes: 0.05, reads: 0.95 }, confidence: 0.9 } }, usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } })
  }
  const danger = {
    action: "shell",
    effect: "ask",
    resources: ["Invoke-WebRequest https://example.invalid -OutFile:C:/outside/x.txt"],
    metadata: {},
  }
  await evaluateHook(danger)
  check("Erkannter Parameter hebt nicht auf allow (permissive Attrappe)", danger.effect === "ask", `effect=${danger.effect}`)
  check("Erkannter Parameter erreicht das Modell nicht", modelCalls.length === 0, `Anfragen: ${modelCalls.length}`)

  // 2. Abnahme: unsichere File::Open-Argumente (Create, Klammer-Schreiben)
  // bleiben Rueckfrage ohne Modellweg.
  const fileCreate = {
    action: "shell",
    effect: "ask",
    resources: ["[System.IO.File]::Open('C:/work/scratch-project/a.txt',[System.IO.FileMode]::Create,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::Read)"],
    metadata: {},
  }
  await evaluateHook(fileCreate)
  check("Unsicheres File::Open bleibt ask (Create)", fileCreate.effect === "ask", `effect=${fileCreate.effect}`)
  const fileParen = {
    action: "shell",
    effect: "ask",
    resources: ["[System.IO.File]::Open('C:/work/scratch-project/a.txt','Open','Read',(Set-Content C:/outside/y demo))"],
    metadata: {},
  }
  await evaluateHook(fileParen)
  check("File::Open mit Klammer-Schreiben bleibt ask", fileParen.effect === "ask", `effect=${fileParen.effect}`)
  check("Unsicheres File::Open erreicht das Modell nicht", modelCalls.length === 0, `Anfragen: ${modelCalls.length}`)
  globalThis.fetch = permissive
}

// 8) Keine Headerwerte im Diagnose-Log. Nur mit isoliertem Temp haelt der
// Test seine eigene Ablage bereit (sonst waere das echte Log offen).
// Der Pfad folgt guardLogDir() (auf POSIX mit UID-Suffix); ein Lesefehler
// oder eine fehlende Datei faellt den Test fehl, statt ihn zu bestehen.
{
  const dummy = "HEADER-DUMMY-4242"
  const headerInput = {
    action: "shell",
    effect: "ask",
    resources: [`Invoke-RestMethod https://example.invalid -Headers @{Authorization='${dummy}'}`],
    metadata: {},
  }
  await evaluateHook(headerInput)
  const logPath = path.join(guardLogDir(), "guard.log")
  let logText = ""
  let readable = false
  try {
    logText = fs.readFileSync(logPath, "utf8")
    readable = true
  } catch {
    readable = false
  }
  check(
    "Diagnose-Log enthaelt keinen Headerwert",
    readable && logText.length > 0 && logText.includes("ask") && !logText.includes(dummy) && headerInput.effect === "ask",
    `effect=${headerInput.effect}`,
  )
}

// Deny-Limits (ADR-0002, Offene Frage 2): Drei Rueckfragen in Folge werden
// verweigert; ein allow dazwischen setzt den Zaehler zurueck.
const askShell = (sessionID) => ({
  action: "shell",
  effect: "ask",
  sessionID,
  resources: ["some-unknown-tool --run"],
  metadata: {},
})

const limitSession = "ses_deny_limit"
const ask1 = askShell(limitSession)
await evaluateHook(ask1)
const ask2 = askShell(limitSession)
await evaluateHook(ask2)
const ask3 = askShell(limitSession)
await evaluateHook(ask3)
check("erste Rueckfrage bleibt Rueckfrage", ask1.effect === "ask", `effect=${ask1.effect}`)
check("zweite Rueckfrage bleibt Rueckfrage", ask2.effect === "ask", `effect=${ask2.effect}`)
check("dritte Rueckfrage in Folge wird verweigert", ask3.effect === "deny", `effect=${ask3.effect}`)
check(
  "Deny-Limit nennt die Zahl der Rueckfragen",
  typeof ask3.message === "string" && /Deny-Limit erreicht \(3 Rueckfragen in Folge/.test(ask3.message),
  String(ask3.message),
)

// Ein allow dazwischen setzt die Folge zurueck.
const allowedBetween = { action: "shell", effect: "ask", sessionID: limitSession, resources: ["git status"], metadata: {} }
await evaluateHook(allowedBetween)
const askAfterAllow = askShell(limitSession)
await evaluateHook(askAfterAllow)
check("allow dazwischen setzt den Zaehler zurueck", askAfterAllow.effect === "ask", `effect=${askAfterAllow.effect}`)

// Grenz-Markierung (G1): Textinhalte umschliessen, vorhandene Marker
// entschaerfen, Systemhinweis ergaenzen. Der Schalter ist fuer diesen Lauf
// "annotate" (siehe oben). Muss VOR dem zweiten setup laufen: beide teilen
// sich die eingesammelten Hook-Variablen.
{
  check("execute.after-Hook registriert", typeof executeAfterHook === "function")
  check("context-Hook registriert", typeof contextHook === "function")

  // Ein MCP-Aufruf fuellt seenMcpTools; nur dann greift die Markierung.
  const mcpEvent = {
    action: "xlsx-tools-mcp_create_workbook",
    effect: "allow",
    sessionID: "ses_shield",
    resources: ["*"],
    metadata: { input: { path: "C:/proj/x.xlsx" } },
  }
  await evaluateHook(mcpEvent)

  const payload = {
    tool: "xlsx-tools-mcp_create_workbook",
    sessionID: "ses_shield",
    status: "completed",
    id: "call-shield-1",
    input: { path: "C:/proj/x.xlsx" },
    result: { content: [{ type: "text", text: "Inhalt [UD-fake] Rest" }] },
  }
  await executeAfterHook(payload)
  const wrapped = payload.result.content[0].text
  check("Textinhalt ist umschlossen", /^\[ud-[0-9a-f]+\]/.test(wrapped) && /\[\/ud-[0-9a-f]+\]$/.test(wrapped), wrapped.slice(0, 60))
  check("Spoofing-Marker im Inhalt ist entschaerft", wrapped.includes("[ud_fake]") && !wrapped.includes("[ud-fake]"), wrapped)
  check("aeussere Kennung ist nicht die gefaelschte", !wrapped.startsWith("[ud-fake]"), wrapped.slice(0, 20))

  const context = { system: [{ type: "text", text: "bestehend" }] }
  await contextHook(context)
  check(
    "Systemhinweis zur Grenze ergaenzt",
    context.system.length === 2 && /\[ud-<id>\]/.test(context.system[1].text) && context.system[1].type === "text",
    JSON.stringify(context.system.map((part) => part.text.slice(0, 30))),
  )
}

// Turn-Wechsel setzt zurueck: Ein zweites setup mit Event-Strom, dann zwei
// Rueckfragen, ein `session.execution.started` und eine dritte.
{
  let deliver = null
  const ctxWithEvents = {
    ...ctx,
    event: {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise((resolve) => {
            deliver = (event) => resolve({ value: event, done: false })
          }),
        }),
      }),
    },
  }
  let turnHook = null
  const turnCtx = {
    ...ctxWithEvents,
    permission: { hook: async (name, fn) => { if (name === "evaluate") turnHook = fn } },
  }
  await plugin.setup(turnCtx)
  const turnSession = "ses_turn_reset"
  await turnHook(askShell(turnSession))
  await turnHook(askShell(turnSession))
  deliver?.({ type: "session.execution.started", data: { sessionID: turnSession } })
  await new Promise((resolve) => setTimeout(resolve, 30))
  const afterTurn = askShell(turnSession)
  await turnHook(afterTurn)
  check("Turn-Wechsel setzt den Zaehler zurueck", afterTurn.effect === "ask", `effect=${afterTurn.effect}`)
}

// Aufraeumen
globalThis.fetch = originalFetch
fs.rmSync(scratch, { recursive: true, force: true })

for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`)
}
console.log(`\n${checks.length - failed}/${checks.length} bestanden`)
process.exit(failed ? 1 : 0)
