// Ebene 1: lokaler Entscheider fuer Shell-Aufrufe, die guard.js nicht einordnen kann.
//
// Aufbau bewusst zweistufig, nach dem Muster des OpenRouter-Cookbooks
// "Auto-Approve Coding Agent Permission Prompts with Jev":
//
//   1. Statische Risikoliste. Sie ist die Sicherheitsgrenze, nicht das Modell.
//      Ein Treffer hier verhindert die Befragung des Modells vollstaendig.
//   2. Erst danach ein lokales Modell mit *einer* praezisen Frage. Nur ein
//      klares "Ja" wird zu "allow". Jede andere Antwort, jeder Timeout und
//      jeder Fehler bleibt "ask".
//
// Die Frage ist bewusst projektbezogen formuliert: "aendert der Befehl
// irgendetwas?" waere im Workspace fast immer mit "ja" zu beantworten und
// damit nutzlos. Gefragt wird, ob die Wirkung im Projektordner bleibt.
//
// Das Modell darf nie ein "deny" erzeugen und nie ein "deny" der statischen
// Regeln ueberschreiben - es kann ausschliesslich "ask" zu "allow" heben.
//
// Messung 25.10.2026, Gemma 4 12B IT QAT UD Q4_K_XL (llama.cpp, RTX 5060 Ti):
//   - JSON-Antworten waren unzuverlaessig (Wiederholungsschleifen; "allow"
//     auch fuer "git push --force" und "rmtree").
//   - Eine einzelne Ja/Nein-Frage mit Grammatik-Zwang antwortet in ~200 ms
//     und trennt die Faelle sauber - ausser "Remove-Item", das aber schon
//     statisch verweigert wird.
// Jev-Omni (ngquocvinh/Jev-Omni-Q4_K_M, gemma4-Basis, LM Studio) verlangt
// laut Nutzertest die ausdrueckliche Anweisung "Antworte nur mit Ja oder Nein",
// sonst antwortet es ausfuehrlich. Genau das steht im Systemprompt.
//
// Ohne Netz und ohne OpenCode testbar: node test.mjs

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = path.join(HERE, "shell-reviewer.config.json")

const DEFAULTS = {
  enabled: true,
  // llama.cpp (llama-server) oder LM Studio, beide OpenAI-kompatibel.
  baseUrl: "http://127.0.0.1:8080/v1",
  model: "gemma-4-12b-it-qat",
  // LM Studio verlangt einen Key ("Require API Key"). Name der Umgebungsvariable,
  // die ihn haelt - der Wert steht nie in dieser Datei.
  apiKeyEnv: "",
  timeoutMs: 2000,
  maxTokens: 6,
  temperature: 0,
  // GBNF-Grammatik. Gemessen 25.10.2026: llama.cpp braucht sie, sonst gibt
  // Gemma 4 12B nur Kanal-Token aus ("<|channel>0101010"); LM Studio akzeptiert
  // den Parameter und ignoriert ihn. Lehnt ein Backend ihn ab, wiederholt
  // reviewer.js die Anfrage einmal ohne Grammatik.
  grammar: 'root ::= "Ja" | "Nein"',
  // Zusaetzliche Risikomuster aus der Projektkonfiguration.
  extraRisky: [],
}

// --- Risikoliste -----------------------------------------------------------
//
// Bewertet wird immer das *kritischste* Segment. Geteilt wird an jedem
// Operator, der einen neuen Befehl beginnen kann; die Teilung ignoriert
// Anfuehrungszeichen, damit ein Trenner in einem Argument hoechstens eine
// zusaetzliche Rueckfrage erzeugt und niemals einen Befehl versteckt.
//
// Belegt durch den lokalen Test mit Gemma 4 12B (24.10.2026): das Modell
// erlaubte "git push --force" und "python -c 'shutil.rmtree(...)'". Beides
// faengt nur diese Liste ab.
export const RISKY = [
  // Unlesbare oder verschleierte Aufrufe.
  /^(\S*['"\\=$]|[-0-9])/,
  /\$\(|[<>]\(|`|\\\r?\n/,
  // Rechteausweitung.
  /^(sudo|doas|su)\b/,
  // Ein Befehl, der einen anderen Interpreter fuettert.
  /^(bash|sh|zsh|fish|eval|xargs)\b/,
  /^(node|bun|deno|python3?|py|perl|ruby|pwsh|powershell)\s+(-\S+\s+)*(-c|-e|--eval|-Command|-EncodedCommand)\b/i,
  /^(Invoke-Expression|iex)\b/i,
  // Loeschen und Umschreiben.
  /^(rm|del|erase|rmdir|rd|Remove-Item|Clear-Content)\b/i,
  /^(git)\b.*\b(push|reset\s+--hard|clean\s+-\S*[fd]|branch\s+-D|checkout\s+--\s)/,
  // Veroeffentlichen, Ausrollen, Abhaengigkeiten.
  /^(npm|pnpm|yarn|bun)\s+(publish|install|i|add|ci|remove|uninstall)\b/,
  /^(pip|pip3|uv)\s+(install|uninstall|sync|add)\b/,
  /\b(pip|pip3)\s+(install|uninstall)\b/,
  /\s-m\s+pip\s+(install|uninstall)\b/,
  /^(wrangler|vercel|fly|flyctl|netlify)\s+(deploy|publish)\b/,
  /^terraform\s+(apply|destroy)\b/,
  /^kubectl\s+(delete|apply|patch|scale)\b/,
  // Geheimnisse.
  /\.env\b|\.ssh\b|\.aws\b|\.gnupg\b|\.npmrc\b|\.netrc\b|credentials|id_rsa|id_ed25519|auth\.json/i,
  // Prozess- und Systemzustand.
  /^(Start-Process|Stop-Process|Start-Service|Stop-Service|Set-Service|Restart-Computer|Stop-Computer)\b/i,
  /^(sc|reg|schtasks|netsh|bcdedit|diskpart)\b/i,
  // Container-Laufzeiten. Ein "run" mit Bind-Mount kann alles ausserhalb des
  // Projekts veraendern; das soll kein Modell bewerten. Befund 25.10.2026:
  // JevK5 4B hielt "docker run -v C:\:/host alpine rm -rf /host/data" fuer sicher.
  /^(docker|podman|nerdctl)\b/i,
]

// Segmentierung: jeder Operator, der einen neuen Befehl beginnen kann.
const SEGMENT_SPLIT = /\s*(?:&&|\|\||;|\||&|\n|\r|\$\()\s*/
const OPERATOR_CHARS = /[`<>{}()]/

function normalizeCommand(part) {
  let current = String(part ?? "")
  for (let i = 0; i < 8; i += 1) {
    const next = current
      .trim()
      .replace(/^(if|then|elif|else|fi|while|until|do|done|for|in|case|esac|!)\s+/i, "")
      .replace(/^(command|builtin|exec|env|nohup|time|timeout|nice|watch|npx|bunx|pnpx)\s+/i, "")
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=[^\s'"\\$]*\s+/, "")
      .replace(/^\\/, "")
      .replace(/^[^\s'"\\$]*\//, "")
      .replace(/^["']+|["']+$/g, "")
    if (next === current) return current.trim()
    current = next
  }
  return current.trim()
}

// Liefert alle Segmente eines Skripts, normalisiert.
export function segments(raw) {
  const text = String(raw ?? "")
  const parts = text.split(SEGMENT_SPLIT)
  const out = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    out.push({ raw: trimmed, normalized: normalizeCommand(trimmed) })
  }
  return out
}

// true, sobald ein Segment die Risikoliste trifft oder nicht lesbar ist.
export function neverAutoApprove(raw, extraRisky = []) {
  const text = String(raw ?? "")
  if (OPERATOR_CHARS.test(text)) return "verschleiernder Operator"
  const parts = segments(text)
  if (!parts.length) return "leer"
  for (const part of parts) {
    if (!part.normalized) return "leeres Segment"
    for (const pattern of RISKY) {
      if (pattern.test(part.normalized)) return `Risikomuster: ${pattern.source}`
    }
    for (const pattern of extraRisky) {
      let rx
      try {
        rx = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i")
      } catch {
        continue
      }
      if (rx.test(part.normalized)) return `Projektmuster: ${rx.source}`
    }
  }
  return undefined
}

// --- Konfiguration ---------------------------------------------------------

export function loadConfig(overrides = {}) {
  let fromFile = {}
  try {
    fromFile = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
  } catch {
    // Ohne Datei gelten die Defaults; das Plugin bleibt funktionsfaehig.
  }
  const env = process.env
  const config = { ...DEFAULTS, ...fromFile, ...overrides }
  if (env.PERMISSION_GUARD_REVIEWER === "0") config.enabled = false
  if (env.PERMISSION_GUARD_REVIEWER === "1") config.enabled = true
  if (env.PERMISSION_GUARD_REVIEWER_URL) config.baseUrl = env.PERMISSION_GUARD_REVIEWER_URL
  if (env.PERMISSION_GUARD_REVIEWER_MODEL) config.model = env.PERMISSION_GUARD_REVIEWER_MODEL
  if (env.PERMISSION_GUARD_REVIEWER_KEY_ENV) config.apiKeyEnv = env.PERMISSION_GUARD_REVIEWER_KEY_ENV
  if (env.PERMISSION_GUARD_REVIEWER_TIMEOUT_MS) {
    const n = Number(env.PERMISSION_GUARD_REVIEWER_TIMEOUT_MS)
    if (Number.isFinite(n) && n > 0) config.timeoutMs = n
  }
  return config
}

// --- Modellbefragung -------------------------------------------------------
//
// Eine Frage, projektbezogen formuliert. "Aendert der Befehl irgendetwas?"
// waere im Workspace fast immer mit "ja" zu beantworten; gefragt wird
// stattdessen, ob die Wirkung im Projektordner bleibt.
const SYSTEM_PROMPT = `Du pruefst einen Shell-Befehl fuer einen Coding-Agenten. Antworte nur mit "Ja" oder "Nein", ohne weitere Woerter.
Frage: Wirkt dieser Befehl ausschliesslich innerhalb des Projektordners und veraendert nichts ausserhalb?
Antworte "Nein", wenn er Dateien ausserhalb des Projektordners veraendert, System- oder Prozesszustand aendert, Software installiert, Daten ueber das Netzwerk sendet oder Zugangsdaten liest.`

export function buildMessages({ commands, project }) {
  const list = Array.isArray(commands) ? commands : [String(commands ?? "")]
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Projektordner: ${project || "(unbekannt)"}\nBefehl:\n${list.map((c) => `- ${c}`).join("\n")}`,
    },
  ]
}

// Nur ein klares "Ja" gibt frei. "Jein", "Vielleicht", leere Antwort und
// Freitext bleiben Rueckfrage.
export function parseAnswer(text) {
  const raw = String(text ?? "").trim().toLowerCase()
  const first = raw.split(/[^a-zäöüß]+/i).filter(Boolean)[0] ?? ""
  if (first === "ja" || first === "yes") return { decision: "allow", reason: "Modell: Wirkung bleibt im Projekt" }
  if (first === "nein" || first === "no") return { decision: "ask", reason: "Modell: Wirkung ausserhalb oder unsicher" }
  return { decision: "ask", reason: "Modell: Antwort unklar" }
}

// Fragt das lokale Modell. Jeder Fehlerpfad endet bei "ask".
export async function review({ commands, project, config }) {
  const cfg = config ?? loadConfig()
  if (!cfg.enabled) return { decision: "ask", reason: "Reviewer deaktiviert" }

  const risky = neverAutoApprove((commands ?? []).join("\n"), cfg.extraRisky)
  if (risky) return { decision: "ask", reason: `statisch: ${risky}` }

  if (typeof fetch !== "function") return { decision: "ask", reason: "kein fetch" }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(250, cfg.timeoutMs || 2000))
  try {
    const headers = { "content-type": "application/json" }
    if (cfg.apiKeyEnv && process.env[cfg.apiKeyEnv]) {
      headers.authorization = `Bearer ${process.env[cfg.apiKeyEnv]}`
    }
    const payload = {
      model: cfg.model,
      messages: buildMessages({ commands, project }),
      temperature: cfg.temperature ?? 0,
      max_tokens: cfg.maxTokens ?? 6,
      cache_prompt: true,
    }

    const send = (extra) =>
      fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({ ...payload, ...extra }),
      })

    let response = await send(cfg.grammar ? { grammar: cfg.grammar } : {})
    // Ein Backend, das den Grammatik-Parameter nicht kennt, bekommt eine
    // zweite Chance ohne ihn. Gemessen 25.10.2026: llama.cpp braucht die
    // Grammatik (Gemma 4 12B gibt sonst nur Kanal-Token aus), LM Studio
    // akzeptiert sie stillschweigend.
    if (!response.ok && cfg.grammar) response = await send({})
    if (!response.ok) return { decision: "ask", reason: `HTTP ${response.status}` }

    const body = await response.json()
    return parseAnswer(body?.choices?.[0]?.message?.content)
  } catch (error) {
    return { decision: "ask", reason: `Reviewer nicht erreichbar: ${error?.name ?? "Fehler"}` }
  } finally {
    clearTimeout(timer)
  }
}
