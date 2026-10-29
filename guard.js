// Klassifizierer fuer Shell-Befehle.
//
// Zweck: entscheiden, ob ein Befehl nachweislich nur liest. Nur dann darf ein
// "ask" der statischen Regeln zu "allow" hochgestuft werden. Aufrufe ueber
// "&" oder "." (Ziel liegt in einer Variablen/Bindung und ist in der Zeile
// nicht lesbar) werden verweigert ("deny", Nutzerentscheid 22.10.2026).
// Alles Unbekannte bleibt "ask" (fail closed). Ein "deny" der statischen
// Regeln wird nie angefasst.
//
// Reine Funktionen, keine Ein-/Ausgabe - dadurch ohne OpenCode testbar.
// Der eine Import (node:crypto) ist eingebaut und rechnet nur; er liefert
// den Argument-Hash fuer MCP-Freigabe-Schluessel (Schritt A, 29.10.2026).

import { createHash } from "node:crypto"

// Umgebungsvariablen, die kein Geheimnis sind. Alles andere ($env:TOKEN) gilt
// als verdaechtig und bleibt bei "ask".
export const SAFE_ENV = new Set([
  "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "PATH",
  "OS", "WINDIR", "SYSTEMROOT", "SYSTEMDRIVE", "COMPUTERNAME", "USERNAME",
  "USERDOMAIN", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER",
  "NUMBER_OF_PROCESSORS", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
  "COMMONPROGRAMFILES", "COMSPEC", "PATHEXT", "PSMODULEPATH", "HOMEDRIVE",
  "HOMEPATH", "PWD", "SHELL", "LANG", "LC_ALL", "TERM", "TZ", "EDITOR",
  "DOTNET_ROOT", "PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "CONDA_PREFIX",
  // Struktur- und Verzeichnisvariablen, keine Geheimnisse (Befund 25.10.2026:
  // $env:ProgramData und $env:XDG_CONFIG_HOME loesten Rueckfragen aus).
  "PROGRAMDATA", "ALLUSERSPROFILE", "PUBLIC", "SYSTEMDRIVE", "USERPROFILE",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME",
])

// Pfade mit Geheimnissen. Lesen ist erlaubt, aber nur nach Rueckfrage.
// (Die Geheimnisbegriffe token/secret/password/api_key stehen separat unten -
// dort gilt seit 22.10.2026 eine Ausnahme fuer Such-Ersetzungen.)
const SECRET_PATHS = [
  [/\.ssh[\\/]/i, "SSH-Verzeichnis"],
  [/\bid_(rsa|dsa|ecdsa|ed25519)\b/i, "SSH-Key"],
  [/\.git-credentials\b/i, "Git-Credentials"],
  [/\.(npmrc|pypirc|netrc)\b/i, "Paketmanager-Credentials"],
  [/auth\.json\b/i, "Auth-Datei"],
  [/\.aws[\\/]credentials|\.azure[\\/]|\.kube[\\/]config|\.gnupg[\\/]/i, "Cloud-Credentials"],
  [/\bLogin Data\b|\bCookies\b/i, "Browser-Profil"],
]

// Geheimnisbegriffe. Fuer den Check gilt eine eng gefasste Ausnahme
// (Nutzerentscheid 5, 22.10.2026, Abend): innerhalb der Operanden von
// -replace wird Text ohnehin ersetzt, bevor er ausgegeben wird - dort ist
// das Wort ein Suchmuster, kein Zugriff. .env, $env:-Variablen und die
// Pfade oben bleiben vollstaendig geprueft.
const SECRET_TERMS =
  /\b(?:password|passwort|secret|token|api[_-]?key|apikey|private[_-]?key)\b/i

// Operanden von Such-Ersetzungen (-replace, -ireplace, -creplace) ausblenden:
// jedes Zeichen wird durch ein Leerzeichen gleicher Laenge ersetzt, Resttext
// bleibt unveraendert. Bareword-Operanden ohne Anfuehrungszeichen und verdoppelte
// Zitate im Muster ('don''t') werden nicht erkannt - solche Faelle loesen
// weiterhin Rueckfrage aus (gewollt konservativ).
const REPLACE_OPERAND_RX =
  /-(?:c|i)?replace\s*(?:'(?:[^'])*?'|"(?:[^"])*?")(?:\s*,\s*(?:'(?:[^'])*?'|"(?:[^"])*?"))?/gi

// [regex]::Replace(...) gehoert zur selben Maskier-Familie. Nur die Zitate
// IM Aufruf werden ausgeblendet; ein unzitiertes Variablenargument (etwa
// $conf.password) bleibt im Text und loest weiterhin Rueckfrage aus.
const DOTNET_REPLACE_CALL_RX = /\[\s*regex\]::Replace\s*\([^)]*\)/gi

function maskReplaceOperands(script) {
  const outs = script.replace(REPLACE_OPERAND_RX, (m) => " ".repeat(m.length))
  return outs.replace(DOTNET_REPLACE_CALL_RX, (m) =>
    m.replace(/'[^']*'|"[^"]*"/g, (q) => " ".repeat(q.length)),
  )
}

// Hart schreibende Befehle: Netz, Prozesse, Registry, Systemzustand, Git-Historie.
// Ein Treffer irgendwo im Skript genuegt, um "ask" zu bleiben.
//
// Reine Dateischreibbefehle stehen bewusst nicht hier. Sie werden pro Anweisung
// geprueft und duerfen durchlaufen, wenn jedes Ziel in einem vertrauten Ordner
// liegt (siehe scopeWrites).
const WRITE_VERBS = [
  /\b(Set-ItemProperty|New-ItemProperty|Remove-ItemProperty)\b/i,
  /\b(Start-Process|Start-Job|Stop-Process|Stop-Job|Restart-Computer|Stop-Computer)\b/i,
// Invoke-WebRequest/Invoke-RestMethod fehlen hier bewusst: Sie werden im
// Netz-Klassifizierer einzeln bewertet (classifyNetwork), sobald der
// Befehlskopf passt - je nach Flags lesend oder unklar.
  /\b(Invoke-Expression|Invoke-Command)\b/i,
  /\b(Install-Module|Install-Package|Update-Module|Register-|Unregister-|Add-Type)\b/i,
  /\b(Set-ExecutionPolicy|Set-Acl|Add-MpPreference)\b/i,
  /\b(Format-Volume|Clear-Disk|Initialize-Disk|Remove-Partition|diskpart)\b/i,
  /\b(npm|pnpm|yarn)\s+(install|i|add|ci|run|exec|link|unlink|publish|update|up|dedupe|prune|rebuild|test|start|stop|restart|config\s+set)\b/i,
  /\bnpx\b/i,
  /\b(pip|pip3|pipx|winget|choco|scoop|uv|poetry)\s+(install|add|download|upgrade|update|remove|uninstall|sync)\b/i,
  /\b(touch|chmod|chown|ln|truncate|tee)\b/i,
  /\bgit\s+(clone|init|push|pull|fetch|merge|rebase|reset|clean|checkout|switch|restore|rm|mv|apply|am|cherry-pick|revert|bisect|gc|prune|update-ref|filter-branch|submodule|notes|worktree)\b/i,
  /\bgit\s+tag\s+-/i,
  /\bgit\s+branch\s+-[dDmM]/i,
  /\bgit\s+stash\s+(push|pop|drop|clear|save)/i,
  /\bgit\s+reflog\s+expire/i,
  /\bgit\s+config\s+[^-\s][^\s]*\s+\S/i,
  /\breg\s+(add|delete|import)\b/i,
  /\bsc(h)?tasks\b/i,
]

// Schreibende Methoden (auch dann, wenn der Typ harmlos aussieht).
const WRITE_METHODS = new Set([
  "writealltext", "writeallbytes", "writealllines", "appendalltext",
  "appendalllines", "openwrite", "create", "createdirectory", "delete",
  "move", "copy", "replace", "setattributes", "setlastwritetime",
  "downloadfile", "downloadstring", "uploadfile", "uploadstring", "start",
])

// Reine Dateischreibbefehle. Sie duerfen innerhalb vertrauter Ordner laufen,
// wenn jedes Ziel aufloesbar ist; ausserhalb bleibt es bei "ask".
const FILE_WRITE_CMDLETS = new Set([
  "set-content", "add-content", "clear-content", "out-file", "tee-object",
  "new-item", "remove-item", "move-item", "copy-item", "rename-item",
  "mkdir", "md",
  // Aliase
  "sc", "ac", "clc", "ni", "ri", "rm", "rd", "del", "erase", "rmdir",
  "cp", "copy", "cpi", "mv", "move", "mi", "ren", "rni",
])

// Schreibmethoden, deren Ziel das erste Argument ist (Dateisystem).
const FILE_WRITE_METHODS = new Set([
  "writealltext", "writeallbytes", "writealllines", "appendalltext",
  "appendalllines", "createdirectory", "delete", "move", "copy", "replace",
  "setattributes", "setlastwritetime", "openwrite",
])

// Methoden auf Variablen, die nur im Speicher arbeiten.
// read/readline/readtoend/peek: Stream-Reader im Speicher; append/appendline:
// StringBuilder; close: Handle schliessen aendert den Inhalt nicht.
const SAFE_METHODS = new Set([
  "add", "addrange", "toarray", "tolist", "tostring", "trim", "trimstart",
  "trimend", "split", "replace", "contains", "indexof", "lastindexof",
  "startswith", "endswith", "toupper", "tolower", "toupperinvariant",
  "tolowerinvariant", "substring", "padleft", "padright", "join", "format",
  "sort", "reverse", "clone", "concat", "distinct", "first", "last",
  "getenumerator", "movenext", "reset", "dispose", "tostring",
  "append", "appendline", "read", "readline", "readtoend",
  "peek", "close",
])

const READ_CMDLETS = new Set([
  // Get-*
  "get-childitem", "get-item", "get-itemproperty", "get-content", "get-date",
  "get-member", "get-command", "get-help", "get-location", "get-process",
  "get-service", "get-variable", "get-unique", "get-random", "get-filehash",
  "get-acl", "get-module", "get-host", "get-culture", "get-psdrive",
  "get-psprovider", "get-executionpolicy", "get-alias", "get-history",
  "get-type", "get-eventlog", "get-winEvent", "get-ciminstance",
  "get-computerinfo", "get-uptime", "get-credential",
  // Pfad und Text
  "test-path", "resolve-path", "join-path", "split-path", "convert-path",
  "measure-object", "sort-object", "select-object", "where-object",
  "foreach-object", "group-object", "format-table", "format-list",
  "format-wide", "format-custom", "out-string", "out-host", "out-null",
  "convertfrom-json", "convertto-json", "convertfrom-csv", "convertto-csv",
  "import-csv", "convertfrom-stringdata", "select-string", "compare-object", "add-member",
  "select-xml", "start-sleep", "write-output", "write-host",
  "write-information", "write-verbose", "write-warning", "write-debug",
  "new-object", "new-guid", "new-timespan", "new-timespan",
  // Aliase
  "gci", "gi", "gc", "cat", "type", "ls", "dir", "pwd", "gl",
  "cd", "chdir", "set-location", "push-location", "pop-location", "sl", "cls", "clear-host",
  "select", "sort", "group", "measure", "ft", "fl", "fw", "gm", "gv",
  "gsv", "gp", "gps", "gcm", "sls", "compare", "diff", "sleep",
  "echo", "write", "?", "%", "foreach", "where",
  // Ablaufsteuerung im Skript
  "return", "break", "continue", "throw", "exit", "trap",
  "test-json",
])

const READ_BINARIES = new Set([
  "rg", "grep", "egrep", "fgrep", "cat", "ls", "dir", "head", "tail", "wc",
  "file", "stat", "echo", "printf", "which", "where", "basename", "dirname",
  "sort", "uniq", "cut", "tr", "diff", "find", "tree", "jq", "awk", "comm",
  "du", "df", "date", "whoami", "hostname", "uname", "expr", "seq", "rev",
  "column", "nl", "od", "hexdump", "sha256sum", "md5sum", "cksum", "test",
  "true", "false", "sleep", "pwd", "id", "groups", "locale", "printenv",
])

const READ_GIT = new Set([
  "status", "diff", "log", "show", "branch", "remote", "rev-parse",
  "rev-list", "describe", "shortlog", "blame", "ls-files", "ls-tree",
  "cat-file", "tag", "stash", "config", "check-attr", "check-ignore",
  "diff-tree", "diff-index", "name-rev", "merge-base", "for-each-ref",
  "reflog", "worktree", "show-ref", "count-objects", "verify-commit",
  "whatchanged", "grep", "var", "version", "help", "status",
])

// Git-Unterbefehle, die auch bei "read" schreiben koennen.
const GIT_READ_ONLY_ARGS = {
  branch: /(^|\s)(-d|-D|-m|-M|-c|-C|--delete|--move|--copy|--set-upstream|\S+\s+\S+)/,
  tag: /(^|\s)(-d|--delete|-a|-s|-m|-f)/,
  stash: /(^|\s)(push|pop|drop|clear|save|apply|branch|create)/,
  config: /(^|\s)(--replace-all|--add|--unset|--unset-all|--rename-section|--remove-section)/,
  reflog: /(^|\s)(expire|delete)/,
  worktree: /(^|\s)(add|remove|prune|lock|unlock|move|repair)/,
  remote: /(^|\s)(add|remove|rename|set-url|set-head|prune|update)/,
  "for-each-ref": /(^|\s)(--format\s+.*delete)/,
}

const TYPE_READ = /^\[(?:system\.)?(?:io\.(?:file|directory|path|streamreader)|text\.|regex|math|collections\.|convert|environment|diagnostics\.(?:stopwatch|process)|linq\.|security\.cryptography\.|datetime|guid|string|int32|int64|boolean|double|version|uri|xml\.|net\.ipaddress|management\.automation\.)/i

function stripHereStrings(script) {
  // @" ... "@ und @' ... '@ (Inhalt ist Daten, keine Befehle)
  return script.replace(/@(["'])\r?\n[\s\S]*?\r?\n\1@/g, " __HERESTRING__ ")
}

// Entfernt String-Literale fuer die Schreibwort-Suche. Prosa in Meldungen
// ("npm install ...") darf keinen Fehlalarm ausloesen.
function stripStrings(script) {
  let s = stripHereStrings(script)
  s = s.replace(/@?["'][^"']*["']/g, '""')
  return s
}

function splitStatements(script) {
  const out = []
  let cur = ""
  let quote = null
  for (let i = 0; i < script.length; i++) {
    const ch = script[i]
    if (quote) {
      cur += ch
      if (ch === "`" && quote === '"') {
        // Escape im doppelt gequoteten String
        if (i + 1 < script.length) { cur += script[++i] }
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === "\n" || ch === "\r") { out.push(cur); cur = ""; continue }
    if (ch === ";") { out.push(cur); cur = ""; continue }
    if (ch === "|") {
      if (script[i + 1] === "|") { i++ }
      out.push(cur); cur = ""
      continue
    }
    if (ch === "&" && script[i + 1] === "&") { i++; out.push(cur); cur = ""; continue }
    cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

function firstToken(statement) {
  let s = statement.trim()
  // Fuehrende Klammern, Casts, Operatoren entfernen
  s = s.replace(/^[\(\{!]+/, "").trim()
  s = s.replace(/^\[void\]\s*/i, "")
  s = s.replace(/^-(?:not|and|or)\s+/i, "")
  const m = /^([A-Za-z_$][\w.:$-]*|[^\s]+)/.exec(s)
  return m ? m[1] : ""
}

function classifyDotNet(statement, ctx) {
  const s = statement.trim()
  const m = /^\[((?:[^\[\]]|\[[^\[\]]*\])*)\]::(\w+)/.exec(s)
  if (m) {
    const type = m[1].trim()
    const method = m[2].toLowerCase()
    if (WRITE_METHODS.has(method)) {
      if (FILE_WRITE_METHODS.has(method) && /^(?:system\.)?io\.(?:file|directory)$/i.test(type)) return "filewrite"
      // "replace" ist typabhaengig ein Lesezugriff: [regex]::Replace arbeitet
      // im Speicher, nur File/Directory.Replace ersetzt echte Dateien.
      if (method === "replace" && /^(?:(?:system\.)?(?:text\.)?regularexpressions\.|)regex$/i.test(type)) return "read"
      return "write"
    }
    if (!TYPE_READ.test(`[${type}]`)) return "unknown"
    return "read"
  }
  // Cast ohne Methodenaufruf: [datetime]"2026-10-19", [int]$n, [array](...).
  // Ein Cast konvertiert nur den Wert dahinter; der Rest wird wie eine
  // normale Anweisung bewertet. Unbekannte Typen bleiben Rueckfrage.
  const cast = /^\[([A-Za-z][\w.]*)\]\s*([\s\S]+)/.exec(s)
  if (cast && TYPE_READ.test(`[${cast[1]}]`)) return classifyStatement(cast[2].trim(), ctx)
  return "unknown"
}

function classifyGit(tokens) {
  // Fuehrende globale Optionen ueberspringen: -C <pfad>, -c k=v, --no-pager
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === "-C" || t === "-c") { i += 2; continue }
    if (t.startsWith("--no-pager") || t.startsWith("--git-dir") || t.startsWith("--work-tree")) { i += 1; continue }
    break
  }
  const sub = (tokens[i] || "").toLowerCase()
  if (!sub) return "read" // nur "git" -> Hilfe
  // Nur Index und lokale Historie: umkehrbar, kein Netzzugriff.
  // Ein Amend schreibt bestehende Commits um und bleibt deshalb "ask".
  if (sub === "add" || sub === "commit") {
    const rest = tokens.slice(i + 1).join(" ")
    return /(^|\s)--amend\b/.test(" " + rest) ? "write" : "localwrite"
  }
  if (!READ_GIT.has(sub)) return "write"
  const rest = tokens.slice(i + 1)
  const restText = rest.join(" ")

  // git config: lesen nur mit --get/--list oder genau einem Positionsargument.
  if (sub === "config") {
    if (/(^|\s)(--get|--get-all|--get-regexp|--list|-l|--show-origin|--name-only)(\s|$)/.test(" " + restText)) return "read"
    const positional = rest.filter((t) => !t.startsWith("-"))
    return positional.length >= 2 ? "write" : "read"
  }
  if (sub === "remote") {
    return /(^|\s)(add|remove|rename|set-url|set-head|prune|update)(\s|$)/.test(" " + restText) ? "write" : "read"
  }

  const guard = GIT_READ_ONLY_ARGS[sub]
  if (guard && guard.test(" " + restText)) return "write"
  return "read"
}

function splitBlock(statement) {
  const open = statement.indexOf("{")
  if (open < 0) return null
  let depth = 0
  let quote = null
  for (let i = open; i < statement.length; i++) {
    const ch = statement[i]
    if (quote) {
      if (ch === "`" && quote === '"') { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return { head: statement.slice(0, open), body: statement.slice(open + 1, i) }
    }
  }
  return { head: statement.slice(0, open), body: statement.slice(open + 1) }
}

function classifyStatement(raw, ctx) {
  let s = raw.trim()
  if (!s) return "noop"
  if (/^[{}()]+$/.test(s)) return "noop"
  if (s.startsWith("#")) return "noop"

  // Blockenden
  s = s.replace(/^\}+/, "").trim()
  if (!s) return "noop"

  // Kontrollbloecke. Der Rumpf steht entweder in derselben Zeile ({...}) oder
  // in den folgenden Zeilen (dann greift der Zeilensplit weiter unten).
  const block = /^(if|elseif|else|while|foreach|for|switch|function|filter|try|catch|finally|do|process|begin|end|param)\b(?=\s|\()/i.exec(s)
  if (block) {
    const keyword = block[1].toLowerCase()
    const parts = splitBlock(s)
    if (!parts) return "read"
    let head = parts.head.trim()
    if (["function", "filter", "param", "try", "catch", "finally", "do", "process", "begin", "end", "else"].includes(keyword)) {
      head = ""
    } else {
      head = head.replace(/^[A-Za-z_]+\b/, "").trim()
    }
    const results = []
    if (head) results.push(classifyStatement(head.replace(/^\(+/, "").replace(/\)+$/, ""), ctx))
    for (const st of splitStatements(parts.body)) results.push(classifyStatement(st, ctx))
    if (!results.length) return "read"
    // Verweigerung dominiert: eine unlesbare Form im Block verweigert den
    // ganzen Block (Nutzerentscheid 3, 22.10.2026).
    if (results.some((r) => r === "deny")) return "deny"
    if (results.some((r) => r === "unknown" || r === "write")) return "unknown"
    if (results.some((r) => r === "filewrite")) return "filewrite"
    if (results.some((r) => r === "localwrite")) return "localwrite"
    return "read"
  }

  // Nur ein String-Literal -> Write-Output
  if (/^["']/.test(s)) return hasRedirection(s) ? "filewrite" : "noop"
  if (s === "__HERESTRING__") return "noop"

  // Logische Verknuepfung ist ein Ausdruck, kein Befehl.
  if (/^-(?:not|and|or)\b/i.test(s)) return classifyStatement(s.replace(/^-(?:not|and|or)\b\s*/i, ""), ctx)

  // Array- oder Hashtable-Literal ist ein Ausdruck.
  if (/^@[({]/.test(s)) return hasRedirection(s) ? "filewrite" : "read"

  // Zuweisung: $x = <ausdruck>
  const assign = /^\$[\w:]+(?:\.\w+)*\s*(=|\+=|-=|\*=|\/=)\s*([\s\S]*)$/.exec(s)
  if (assign) {
    const rhs = assign[2].trim()
    if (!rhs) return "noop"
    if (rhs === "__HERESTRING__") return "noop"
    if (/^@[{(]/.test(rhs)) return "read"      // Hashtable/Array-Literal
    if (/^["']/.test(rhs)) return "noop"        // String
    if (/^-?\d+(\.\d+)?$/.test(rhs)) return "noop" // Zahl
    return classifyStatement(rhs, ctx)
  }

  // Schluessel = Wert innerhalb eines Hashtables: e={...}
  const pair = /^[A-Za-z_][\w-]*\s*=\s*([\s\S]+)$/.exec(s)
  if (pair && !s.startsWith("$")) return classifyStatement(pair[1].replace(/^\{|\}$/g, ""), ctx)

  // Fuehrende Klammern entfernen: ([regex]::Matches(...)).Count
  s = s.replace(/^@?\(+/, "").trim()

  // [void] ist ein Cast, der den Rueckgabewert verwirft: [void]$sb.Append("x")
  // danach wie die eigentliche Anweisung bewerten.
  s = s.replace(/^\[(?:void)\]\s*/i, "").trim()

  // .NET-Statikaufruf
  if (s.startsWith("[")) return classifyDotNet(s, ctx)

  // Methodenaufruf auf Variable: $x.Add(...)
  const varMethod = /^\$[\w:]+(?:\.\w+)*\.(\w+)\s*\(/.exec(s)
  if (varMethod) {
    const method = varMethod[1].toLowerCase()
    if (WRITE_METHODS.has(method)) return "write"
    return SAFE_METHODS.has(method) ? "read" : "unknown"
  }

  // Jede Anweisung, die mit $ beginnt, ist ein Ausdruck (Variable, Eigenschaft,
  // Vergleich) und fuehrt keinen Befehl aus. Aufrufe ueber & oder . sind unten
  // verweigert ("deny"). Eine Umleitung schreibt nur den Wert.
  if (s.startsWith("$")) return hasRedirection(s) ? "filewrite" : "read"

  // Call-Operator / Dot-Sourcing (Nutzerentscheid 3, 22.10.2026, Abend): Das
  // Ziel liegt in einer Variablen oder Bindung und ist in der Zeile nicht
  // lesbar - verweigern ("deny") statt Rueckfrage. Ausgeschriebene,
  // sichtbare Aufrufe (.\\skript.ps1 direkt) laufen in die normale Einordnung.
  if (/^&\s/.test(s) || /^\.\s/.test(s)) return "deny"

  const token = firstToken(s)
  if (!token) return "unknown"
  const lower = token.toLowerCase()

  // Ein Ausdruck auf einer Variable ist kein Befehl.
  if (lower.startsWith("$")) return hasRedirection(s) ? "filewrite" : "read"

  if (FILE_WRITE_CMDLETS.has(lower)) return "filewrite"

  const kind = classifyCommand(s, lower, ctx)
  // Ausgabe in eine Datei: nur wenn der Befehl selbst nachweislich nur liest.
  if (kind === "read" && hasRedirection(s)) return "filewrite"
  return kind
}

// Ordnet einen Befehl ohne Dateibezug ein: "read", "unknown" oder "write".
// Hilfe und Version (Nutzerentscheid 23.10.2026): Ein Programmname mit genau
// einem Hilfewort stellt sich nur vor - es schreibt, sendet und startet nichts.
// Bewusst eng: genau ein Argument, nur Programme aus dem PATH (kein Pfad, kein
// Skriptname), kein -v (meist "verbose", nicht Version). Unterbefehl-Ketten
// wie "gitleaks dir --help" bleiben Rueckfrage.
const HELP_VERSION_ARGS = new Set(["--help", "-h", "-?", "/?", "--version", "-V"])
const PROGRAM_NAME = /^[A-Za-z][\w.-]*$/
const SCRIPT_NAME = /\.(?:ps1|psm1|sh|bash|bat|cmd|py|pyw|js|mjs|cjs|ts|rb|pl|vbs)$/i

function isHelpVersionOnly(s) {
  const tokens = tokenizeCli(s)
  if (tokens.length !== 2) return false
  if (!PROGRAM_NAME.test(tokens[0]) || SCRIPT_NAME.test(tokens[0])) return false
  const arg = tokens[1]
  return HELP_VERSION_ARGS.has(arg) || arg.toLowerCase() === "help" || arg.toLowerCase() === "version"
}

function classifyCommand(s, lower, ctx) {
  if (isHelpVersionOnly(s)) return "read"

  if (lower === "npm" || lower === "pnpm" || lower === "yarn") {
    const sub = (s.split(/\s+/)[1] ?? "").toLowerCase()
    if (["view", "info", "ls", "list", "outdated", "search", "why", "help", "-v", "--version"].includes(sub)) return "read"
    if (sub === "config" && !/\sconfig\s+set\b/i.test(s)) return "read"
    return "unknown"
  }

  if (lower === "git") {
    const parts = s.split(/\s+/).filter(Boolean)
    return classifyGit(parts.slice(1))
  }
  if (lower === "pwsh" || lower === "powershell" || lower === "pwsh.exe" || lower === "powershell.exe" || lower === "cmd" || lower === "cmd.exe" || lower === "bash" || lower === "sh") {
    // -NoProfile -Command <script> wird vom Aufrufer nicht verschachtelt geprueft
    return "unknown"
  }
  // Externe CLIs: nur lesende Unterbefehle, und nur ohne Schreib-/Sende-Flags.
  const base = lower.split(/[\\/]/).pop()
  if (base === "opencode" || base === "opencode.exe") return classifyOpencode(s)
  if (base === "firecrawl" || base === "firecrawl.exe" || base === "firecrawl.ps1" || base === "firecrawl.cmd") {
    return classifyFirecrawl(s)
  }
  if (base === "gitleaks" || base === "gitleaks.exe") return classifyGitleaks(s)
  if (base === "sqlite3" || base === "sqlite3.exe") return classifySqlite(s)
  if (base === "gh" || base === "gh.exe") return classifyGh(s)

  if (NET_CMD_NAMES.has(base)) return classifyNetwork(s)
  if (base === "python" || base === "python.exe" || base === "py" || base === "py.exe") return classifyPython(s, ctx)

  if (READ_CMDLETS.has(lower)) return "read"
  if (READ_BINARIES.has(lower)) return "read"
  if (lower === "node" || lower === "node.exe") return classifyNode(s, ctx)
  if (lower === "deno" || lower === "ruby" || lower === "perl") return "unknown"
  return "unknown"
}

function findSecrets(script) {
  const hits = []
  for (const [rx, label] of SECRET_PATHS) {
    if (rx.test(script)) hits.push(label)
  }
  // .env ausser .env.example / .env.sample / .env.template
  if (/\.env(?![.\w])/i.test(script) || /\.env\.(?!example|sample|template)[\w.-]+/i.test(script)) {
    hits.push(".env")
  }
  // $env:NAME fuer nicht freigegebene Namen
  for (const m of script.matchAll(/\$env:([A-Za-z_][\w]*)/gi)) {
    if (!SAFE_ENV.has(m[1].toUpperCase())) hits.push(`$env:${m[1]}`)
  }
  if (/Get-ChildItem\s+Env:/i.test(script) || /Get-ChildItem\s+-Path\s+Env:/i.test(script)) hits.push("Env:")
  // Begriffe nur auf dem maskierten Text: -replace-Operanden ausgenommen,
  // Originaltext bleibt fuer alle uebrigen Treffer massgeblich.
  if (SECRET_TERMS.test(maskReplaceOperands(script))) hits.push("Geheimnisbegriff")
  return [...new Set(hits)]
}

// MCP-Beobachtung (Schritt A, 29.10.2026).
//
// Beweis, warum metadata.input das Erkennungsmerkmal ist: packages/core/src/
// tool/mcp.ts Z. 58-70 meldet permission.assert mit metadata: { input: input
// ?? {} }. Kein eingebautes Werkzeug setzt metadata.input (edit: files,
// glob/grep: count, question: answers, todo: todos, shell: sessionID,
// mcp-resource: server/uri oder {}). Allein "resources == ['*']" taugt
// nicht - question und todo melden dasselbe.
//
// Die Argumente stehen damit im Berechtigungs-Event selbst; ein
// execute.before-Capture (bencrouse Z. 524-535) ist hier nicht noetig -
// kein Store, keine Aufraeumlogik, keine Zuordnungsfrage.
//
// Schritt A beobachtet nur: die Funktion liefert Beobachtung und
// Freigabe-Schluessel, entscheidet aber nichts. Der Schluessel ist Werkzeug
// + SHA-256 der Argumente (bencrouse Z. 112-123), damit eine Freigabe spaeter
// nie ein anderes Argument-Set mitdeckt. Argumentwerte landen nie im Log,
// nur Feldnamen (Schema, keine Nutzerdaten); ein Geheimnisverdacht im
// Argument-Text wird zusaetzlich gemeldet.
export function mcpObservation(action, metadata) {
  const out = {
    isMcp: false,
    action: String(action ?? ""),
    key: "",
    argHash: "",
    argCount: 0,
    fields: /** @type {string[]} */ ([]),
    hasArgs: false,
    secret: false,
  }
  if (!metadata || typeof metadata !== "object") return out
  if (!("input" in metadata)) return out
  out.isMcp = true
  const input = metadata.input
  let argsJson = "{}"
  try {
    argsJson = JSON.stringify(input ?? {})
  } catch {
    // Nicht serialisierbar (kann bei JSON-Daten nicht vorkommen): als leere
    // Argumente behandeln - fail closed, denn ohne lesbare Argumente gibt es
    // spaeter keine Freigabe (bencrouse Z. 568-569).
  }
  if (input && typeof input === "object" && !Array.isArray(input)) {
    out.fields = Object.keys(input).slice(0, 12)
    out.argCount = out.fields.length
    out.hasArgs = out.argCount > 0
  } else if (Array.isArray(input)) {
    out.argCount = input.length
    out.hasArgs = input.length > 0
  }
  out.argHash = createHash("sha256").update(argsJson).digest("hex").slice(0, 16)
  out.key = `${out.action}#${out.argHash}`
  out.secret = findSecrets(argsJson).length > 0
  return out
}

function hasWriteVerb(script) {
  for (const rx of WRITE_VERBS) {
    const m = rx.exec(script)
    if (m) return m[1] || m[0]
  }
  return null
}

// Fuer die Umleitungssuche sind Stringinhalte maskiert: ein ">" in Prosa
// ("Ergebnis: 5 > 3") ist Text, keine Umleitung. Der Scanner ersetzt jedes
// Zeichen innerhalb eines Strings durch ein Leerzeichen. Verdopplung der
// Zitate ("", '') wie auch ` -Escapes zaehlen als Inhalt. Geht ein Zitat
// nicht auf, bleibt es konservativ wie eine Umleitung (fail closed).
function maskStrings(script) {
  const chars = [...script]
  let quote = null
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (quote) {
      if (quote === '"' && ch === "`") {
        chars[i] = " "
        if (i + 1 < chars.length) chars[i + 1] = " "
        i++
        continue
      }
      if (ch === quote) {
        if (chars[i + 1] === quote) { chars[i] = " "; chars[i + 1] = " "; i++; continue }
        quote = null
        continue
      }
      chars[i] = " "
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
  }
  return { masked: chars.join(""), unbalanced: quote !== null }
}

function hasRedirection(script) {
  // > und >> zaehlen als Schreiben; 2>&1, *>&1 und -gt/-ge/-lt/-le nicht.
  // Stringinhalte sind maskiert (siehe maskStrings); ohne Aufloesung gilt
  // ein Skript konservativ als schreibend.
  const { masked, unbalanced } = maskStrings(script)
  if (unbalanced) return true
  const cleaned = masked.replace(/\d?>&\d/g, " ")
  return /(^|[^-\w=])>{1,2}(?!&)/.test(cleaned)
}

function hasFileWriteVerb(script) {
  for (const name of FILE_WRITE_CMDLETS) {
    const rx = new RegExp(`(^|[\\s;|&(])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s;|)&]|$)`, "i")
    if (rx.test(script)) return name
  }
  if (/\bio\.(?:file|directory)::/i.test(script)) return ".NET-Dateizugriff"
  return null
}

// --- Pfadpruefung ---------------------------------------------------------
//
// Schreibbefehle duerfen nur durchlaufen, wenn jedes Ziel aufloesbar ist und
// innerhalb eines vertrauten Ordners liegt. Alles andere bleibt "ask".

const PATH_EXTENSIONS = /\.(?:txt|text|md|markdown|json|jsonc|jsonl|log|csv|tsv|xlsx|xlsm|xls|docx|doc|pdf|py|ps1|psm1|sh|bat|cmd|js|mjs|cjs|ts|tsx|jsx|toml|ya?ml|ini|cfg|conf|xml|html|htm|css|scss|lock|env|db|sqlite|png|jpg|jpeg|gif|webp|svg|zip|tar|gz|whl|exe|dll)$/i

function isPathLike(value) {
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  if (value.startsWith("\\\\")) return true
  if (/^[~%$]/.test(value)) return true
  if (/[\\/]/.test(value)) return true
  if (PATH_EXTENSIONS.test(value)) return true
  return false
}

// Normalisiert auf "c:\a\b" (klein, ohne Endtrenner, ohne . und ..).
function normPath(value) {
  const parts = []
  for (const part of String(value).replace(/\//g, "\\").split("\\")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (parts.length && !/^[A-Za-z]:$/.test(parts[parts.length - 1])) parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("\\").toLowerCase()
}

function isUnder(target, root) {
  if (!target || !root) return false
  return target === root || target.startsWith(`${root}\\`)
}

const UNKNOWN = "\u0001"

// cd-Formen (nur absolute, sicher bestimmbare Wechsel). Genutzt von
// scopeWrites und vom Aufloesungskontext in evaluate(); pop-location wird
// bewusst nicht rueckverfolgt - Folgen nur Praezision, nicht Sicherheit,
// weil die erlaubten Zielpfade exakt verglichen werden.
const CD_RE = /^(?:cd|chdir|set-location|sl|push-location)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i

// Loest einen Pfadtoken auf. null = nicht sicher bestimmbar (dann "ask").
function resolveTarget(token, opts, base, vars) {
  let t = String(token ?? "").trim()
  t = t.replace(/^["']|["']$/g, "").trim()
  if (!t) return null

  if (vars && /^\$\{?(\w+)\}?$/.test(t)) {
    const name = /^\$\{?(\w+)\}?$/.exec(t)[1].toLowerCase()
    if (!vars.has(name)) return null
    t = vars.get(name)
  }

  const env = {
    temp: opts.temp,
    tmp: opts.temp,
    userprofile: opts.home,
    home: opts.home,
    appdata: opts.appData,
    homedrive: null,
    homepath: null,
  }
  t = t.replace(/\$env:(\w+)/gi, (m, name) => env[name.toLowerCase()] ?? UNKNOWN)
  t = t.replace(/%(\w+)%/g, (m, name) => env[name.toLowerCase()] ?? UNKNOWN)
  t = t.replace(/^\$HOME\b/i, () => opts.home ?? UNKNOWN)
  if (t.startsWith("~")) t = `${opts.home ?? UNKNOWN}${t.slice(1)}`

  if (t.includes(UNKNOWN) || t.includes("$")) return null
  if (/[*?\[\]]/.test(t)) return null

  if (!/^[A-Za-z]:[\\/]/.test(t)) {
    if (/^[\\/]/.test(t)) return null // Unix-Wurzel oder UNC
    if (!base) return null
    t = `${base}\\${t}`
  }
  return normPath(t)
}

function buildVarMap(statements) {
  const counts = new Map()
  const values = new Map()
  for (const statement of statements) {
    const text = statement.trim()
    let name
    let value
    const literal = /^\$(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/.exec(text)
    if (literal) {
      name = literal[1]
      value = literal[2] ?? literal[3] ?? ""
    } else {
      // Nutzerentscheid 26.10.2026: Join-Path mit literalen Argumenten aufloesen.
      // Ohne das bleibt "$p = Join-Path $env:TEMP \"x\"" unaufloesbar und jede
      // Schreibpruefung endet in einer Rueckfrage, deren Inhalt niemand sieht.
      const join = /^\$(\w+)\s*=\s*Join-Path\s+(.+)$/i.exec(text)
      if (!join) continue
      const parts = []
      let ok = true
      for (const raw of tokenizeCli(join[2])) {
        const token = raw.replace(/^["']|["']$/g, "")
        if (!token || token.startsWith("-")) { ok = false; break }
        parts.push(token)
      }
      if (!ok || !parts.length) continue
      name = join[1]
      value = parts.join("\\").replace(/\\{2,}/g, "\\")
    }
    const key = name.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
    values.set(key, value)
  }
  const out = new Map()
  for (const [key, count] of counts) {
    // Nur eindeutig zugewiesene Variablen sind verlaesslich.
    if (count === 1) out.set(key, values.get(key))
  }
  return out
}

function extractTargets(statement, vars) {
  const out = []
  const add = (value) => {
    const v = String(value ?? "").trim()
    if (v && v.toLowerCase() !== "$null") out.push(v)
  }
  const s = statement.trim()

  // .NET-Aufruf: das erste Argument ist der Pfad.
  if (s.startsWith("[")) {
    const m = /^\[[^\]]+\]::\w+\s*\(\s*(?:"([^"]*)"|'([^']*)')/.exec(s)
    add(m ? (m[1] ?? m[2]) : null)
    return out
  }

  let explicit = false
  for (const m of s.matchAll(/(?<![-\w])-(?:(?:Literal)?Path|Destination|FilePath)\b\s*(?:=|:)?\s*(?:"([^"]*)"|'([^']*)'|([^\s;|()]+))/gi)) {
    explicit = true
    add(m[1] ?? m[2] ?? m[3])
  }
  for (const m of s.matchAll(/(?:^|[^-\w])\d?>{1,2}\s*(?:"([^"]*)"|'([^']*)'|([^\s;|()]+))/g)) {
    explicit = true
    add(m[1] ?? m[2] ?? m[3])
  }
  if (explicit) return out

  // Ohne Pfadparameter: alle Positionsargumente gelten als Ziele. Der
  // Befehlsname selbst ist kein Ziel und wird entfernt.
  const rest = s.replace(/^\s*[^\s;|()]+/, "")
  for (const m of rest.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const v = (m[1] ?? m[2] ?? m[3] ?? "").trim()
    if (!v || v.startsWith("-")) continue
    if (/^\d+$/.test(v)) continue
    add(v)
  }
  return out
}

// One narrowly-scoped source-and-destination exception for the reviewed Ruff config.
// It does not trust APPDATA as a root: only create APPDATA\ruff and copy this
// exact project candidate to APPDATA\ruff\ruff.toml. Every other outside write
// continues through the normal deny path.
function approvedRuffBootstrapTargets(statement, resolved, opts, base) {
  if (!opts.appData || !base) return new Set()

  const tokens = tokenizeCli(statement).map((token) => token.toLowerCase())
  const ruffDir = normPath(`${opts.appData}\\ruff`)
  const ruffConfig = normPath(`${ruffDir}\\ruff.toml`)
  const makeDirectory = [
    "new-item",
    "-itemtype",
    "directory",
    "-path",
    "$env:appdata\\ruff",
  ]
  if (
    tokens.length === makeDirectory.length
    && tokens.every((token, index) => token === makeDirectory[index])
    && resolved.length === 1
    && resolved[0] === ruffDir
  ) {
    return new Set([ruffDir])
  }

  const copyCandidate = [
    "copy-item",
    "-literalpath",
    "staging\\ruff-global-baseline.toml",
    "-destination",
    "$env:appdata\\ruff\\ruff.toml",
  ]
  const candidatePath = normPath(`${base}\\staging\\ruff-global-baseline.toml`)
  if (
    tokens.length === copyCandidate.length
    && tokens.every((token, index) => token === copyCandidate[index])
    && resolved.length === 2
    && resolved[0] === candidatePath
    && resolved[1] === ruffConfig
  ) {
    return new Set([ruffConfig])
  }

  return new Set()
}

// Loeschen (Nutzerentscheid 29.10.2026): Wegwerfen ist nicht wie Schreiben.
// Ein Verzeichnis, "-Recurse" und "-Force" sind nachweislich nicht mehr
// umkehrbar, und ein Ziel mit Platzhalter laesst nicht erkennen, was genau
// verloren geht. Solche Aufrufe werden rueckgefragt statt freigegeben.
// Bewusst ohne Dateisystemzugriff: guard.js bleibt reine Funktion, damit
// node test.mjs den Klassifizierer ohne Umgebung testen kann. Statt `stat`
// gilt deshalb "Ziel ohne Endung ist ein Verzeichnis" - ein Punkt an erster
// Stelle (.git) zaehlt nicht als Endung.
const DELETE_CMDLETS = new Set([
  "remove-item", "del", "erase", "rd", "rmdir",
  // Aliase
  "ri", "rm",
])

function looksLikeDirectory(target) {
  const trimmed = String(target).replace(/[\\/]+$/, "")
  const last = trimmed.split(/[\\/]/).pop() ?? ""
  return last.lastIndexOf(".") <= 0
}

/**
 * Liefert den Grund, warum ein Loeschen rueckgefragt wird, sonst null.
 * @param {string} statement
 * @param {string[]} targets die unveraenderten Zielangaben aus extractTargets
 */
function deletionEscalation(statement, targets) {
  if (/-recurse\b/i.test(statement)) return "Rekursion"
  if (/-force\b/i.test(statement)) return "-Force"
  for (const target of targets) {
    if (/[*?[\]]/.test(target)) return `Platzhalter-Ziel: ${target}`
    if (looksLikeDirectory(target)) return `Verzeichnis: ${target}`
  }
  return null
}

function scopeWrites(statements, options) {
  const opts = options ?? {}
  const vars = buildVarMap(statements)
  const base = opts.base ? resolveTarget(opts.base, opts, null, vars) : null
  if (!base) return { ok: false, reason: "Arbeitsordner unbekannt" }

  const roots = [...(opts.roots ?? []), opts.base]
    .filter(Boolean)
    .map((root) => resolveTarget(root, opts, null, vars))
    .filter(Boolean)
  if (!roots.length) return { ok: false, reason: "keine vertrauten Ordner" }

  const denied = []
  if (opts.home) {
    const home = normPath(opts.home)
    for (const rel of [".ssh", ".aws", ".gnupg", ".kube", ".claude", ".codex", ".opencode", ".gitconfig", ".git-credentials", ".config\\opencode", ".local\\share\\opencode"]) {
      denied.push(normPath(`${home}\\${rel}`))
    }
  }
  for (const fixed of ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata"]) denied.push(fixed)
  denied.push(normPath(`${base}\\.git`))

  // Arbeitsordner: nur absolute, sicher bestimmbare Wechsel zulassen.
  let cwd = base
  for (const statement of statements) {
    const m = CD_RE.exec(statement.trim())
    if (!m) continue
    const next = resolveTarget(m[1] ?? m[2] ?? m[3], opts, cwd, vars)
    if (!next) return { ok: false, reason: `Arbeitsordner unklar: ${m[1] ?? m[2] ?? m[3]}` }
    cwd = next
  }

  for (const statement of statements) {
    if (classifyStatement(statement) !== "filewrite") continue
    const targets = extractTargets(statement, vars)
    if (!targets.length) return { ok: false, reason: `Ziel unklar: ${statement.slice(0, 60)}` }

    const resolved = []
    for (const target of targets) {
      const abs = resolveTarget(target, opts, cwd, vars)
      if (!abs) return { ok: false, reason: `Pfad nicht bestimmbar: ${target.slice(0, 60)}` }
      resolved.push(abs)
    }

    const approvedRuffTargets = approvedRuffBootstrapTargets(statement, resolved, opts, base)
    for (const abs of resolved) {
      if (denied.some((root) => isUnder(abs, root))) return { ok: false, reason: `geschuetzter Pfad: ${abs}` }
      if (!roots.some((root) => isUnder(abs, root)) && !approvedRuffTargets.has(abs)) {
        return { ok: false, reason: `ausserhalb des Projekts: ${abs}` }
      }
    }

    if (/-Recurse\b/i.test(statement) || /\brm\s+-[a-z]*r/i.test(statement)) {
      for (const abs of resolved) {
        if (abs === cwd || isUnder(cwd, abs)) return { ok: false, reason: `rekursiv auf ${abs}` }
      }
    }

    // Loeschen nicht freigeben, sondern rueckfragen. Der Grund beginnt
    // bewusst mit "Loeschen:" und traegt keines der Sperrpraefixe aus
    // evaluate() - daraus folgt "ask", nicht "deny".
    if (DELETE_CMDLETS.has((tokenizeCli(statement)[0] ?? "").toLowerCase().replace(/\.exe$/, ""))) {
      const why = deletionEscalation(statement, targets)
      if (why) return { ok: false, reason: `Loeschen: ${why}` }
    }
  }

  return { ok: true, reason: "Schreiben in vertrautem Ordner" }
}

const DENY_PATHS = [
  /\.ssh[\\/]/i,
  /\.gnupg[\\/]/i,
  /\.git-credentials\b/i,
  /\.aws[\\/]credentials/i,
  /\.kube[\\/]config/i,
]

const DENY_COMMANDS = [
  /\b(Format-Volume|Clear-Disk|Initialize-Disk|Remove-Partition)\b/i,
  /\bdiskpart\b/i,
  // Nutzerentscheid 25.10.2026: verschleierte Ausfuehrung ist keine Frage,
  // sondern eine Verweigerung. Ein Befehlstext in einer Variablen oder ein
  // kodierter Block ist statisch nicht pruefbar.
  /\b(Invoke-Expression|iex)\b/i,
  /-EncodedCommand\b/i,
  /\bpowershell(\.exe)?\b[^\n]*\s-(e|enc|ec|encodedcommand)\b/i,
]

// Fremde CLIs: nur lesende Unterbefehle, alles andere bleibt Rueckfrage.
// Grundlage sind die Hilfe-Baeume der installierten Fassungen (opencode 1.4.2,
// firecrawl-cli), nicht Annahmen.
const CLI_READ_FLAGS = new Set(["--help", "-h", "--version", "-v"])
const OPENCODE_READ_SUBS = new Set(["debug", "stats", "models", "help"])
const FIRECRAWL_READ_SUBS = new Set([
  "list", "list-tools", "find-tools", "search", "map", "alexandria",
  "developer", "gov", "research", "status", "version", "doctor", "help",
])
// Flags, die aus einem Lesebefehl einen Schreib- oder Sendezugriff machen:
// Ausgabedatei, Schluessel auf der Kommandozeile, fremder Endpunkt,
// Screenshot-/Profilzustand, Auftragsabbruch, Webhook.
const FIRECRAWL_UNSAFE_FLAGS = new Set([
  "-o", "--output",
  "-k", "--api-key",
  "--api-url",
  "--screenshot", "--full-page-screenshot",
  "--profile",
  "--cancel",
  "--webhook",
])
// URL oder Domain - entscheidet, ob scrape mehrere Ziele bekommt.
const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:[\w-]+\.)+[a-z]{2,})\S*$/i

function tokenizeCli(statement) {
  const out = []
  let cur = ""
  let quote = null
  for (const ch of statement) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ""
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

// Netz-Lesen (Nutzerentscheid 22.10.2026): Invoke-WebRequest und
// Invoke-RestMethod gelten als Lesen, solange nichts gespeichert oder gesendet
// wird - kein -OutFile/-InFile, keine Methode ausser GET/HEAD, kein -Body/-Form.
// Zusaetzlich fail closed: Variablen-Splatting (@p, Inhalt unsichtbar),
// positionale Hashtables ausserhalb von -Headers sowie -Credential/-Token und
// Co., weil damit mehr als die Anfrage selbst den Rechner verlaesst.
// Unbekannte Flags (Encoding, Redirects, Header-Inhalt) sind unbedenklich.
const NET_CMD_NAMES = new Set(["invoke-webrequest", "invoke-restmethod", "iwr", "irm"])
const NET_BLOCK_FLAGS = new Set([
  "-outfile", "-infile", "-body", "-form",
  "-credential", "-token", "-certificate", "-certificatethumbprint",
])
const NET_SAFE_METHODS = new Set(["get", "head"])

function classifyNetwork(statement) {
  const tokens = tokenizeCli(statement)
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    const lowerT = t.toLowerCase()
    const eq = lowerT.indexOf("=")
    const flag = eq > 0 ? lowerT.slice(0, eq) : lowerT
    if (NET_BLOCK_FLAGS.has(flag)) return "unknown"
    if (flag === "-method") {
      const value = (eq > 0 ? lowerT.slice(eq + 1) : (tokens[i + 1] ?? "")).toLowerCase()
      if (!value || value.startsWith("-") || !NET_SAFE_METHODS.has(value)) return "unknown"
      if (eq <= 0) i++ // Wert steht als eigenes Token; wird mitgenommen
      continue
    }
    if (/^@\w+$/.test(t)) return "unknown" // Splatting: Inhalt unbekannt
    if (t.startsWith("@{")) {
      // Nur als Parameterwert von -Headers sichtbar und unbedenklich.
      const prev = (tokens[i - 1] ?? "").toLowerCase().split("=")[0]
      if (prev !== "-headers") return "unknown"
    }
  }
  return "read"
}

// python (Nutzerentscheidungen 22.10.2026):
//  - `python -m pytest` und `python -m ruff check|format` wie bisher; pytest
//    fuehrt eigenen Code aus - die Freigabe deckt das ausdruecklich ab.
//    ruff `--fix`/`format` schreiben im Projekt: sie kommen als "filewrite"
//    zurueck und landen in scopeWrites. Der py-Launcher mit Versionsflag
//    (`py -3.12 -m pytest`) laeuft mit.
//  - Entscheidung 2 (Abend): Skriptaufrufe mit Zielpfad innerhalb des
//    Projekts sind freigegeben - der Inhalt ist versioniert und damit
//    vor der Ausfuehrung reviewtbar. Parameter des Skripts werden nicht
//    geprueft; sie sind Teil des reviewten Inhalts.
//  - Weiterhin Rueckfrage (fail closed): `python -c` (Inline-Code ist fuer
//    das Review unsichtbar), Skripte ausserhalb des Projekts (Temp-Ordner),
//    unbekannte Interpreter-Flags und der nackte python-Aufruf (REPL).
//    Aufrufe unter <projekt>\.git bleiben ausgeschlossen.
const PY_VERSION_FLAG = /^-\d+(\.\d+)*$/
// Ein-Wort-Flags ohne Seiteneffekt: Ausgabe unaufgepuffert, Optimierung,
// Bytecode-Verzicht, Umgebungs-Isolierung. Klein geschrieben verglichen
// (-O und -o, -S und -s liefern jeweils dasselbe Token).
const PY_SAFE_FLAGS = new Set(["-u", "-b", "-bb", "-o", "-oo", "-e", "-i", "-s", "--isolated"])

function classifyPython(s, ctx) {
  const opts = ctx?.opts ?? {}
  const tokens = tokenizeCli(s)
  let i = 1
  while (i < tokens.length && PY_VERSION_FLAG.test(tokens[i])) i++
  // Seiteneffektfreie Flags ueberspringen; -W nimmt einen Wert (Warnfilter).
  while (i < tokens.length) {
    const t = (tokens[i] ?? "").toLowerCase()
    if (!t.startsWith("-")) break
    if (PY_SAFE_FLAGS.has(t)) { i++; continue }
    if (t === "-w" && i + 1 < tokens.length) { i += 2; continue }
    break
  }
  const head = (tokens[i] ?? "").toLowerCase()
  if (!head) return "unknown" // nackte python-Sitzung (REPL)
  if (head === "-m") {
    const module = (tokens[i + 1] ?? "").toLowerCase()
    if (module === "pytest") return "read"
    // pyright (Nutzerentscheid 29.10.2026): Typpruefung nach pyproject.toml.
    // pyright schreibt weder Quelltext noch Bytecode; wie pytest gilt der
    // Aufruf als vertrauenswuerdig. Nur der nackte `pyright` (Sprachebene
    // ohne python -m) ist davon nicht erfasst.
    if (module === "pyright") return "read"
    if (module !== "ruff") return "unknown"
    const rest = tokens.slice(i + 2)
    const sub = (rest[0] ?? "").toLowerCase()
    if (sub !== "check" && sub !== "format") return "unknown"
    if (sub === "check" && !rest.some((t) => /^--fix(-only)?$/.test(t))) return "read"
    if (sub === "format" && rest.some((t) => t === "--check" || t === "--diff")) return "read"
    return "filewrite"
  }
  if (head.startsWith("-")) return "unknown" // -c, --version, unbekannte Flags
  // Entscheidung 2: Skript, das innerhalb des Projekts aufloesbar ist.
  // Entscheidung 25.10.2026 (verengt): von den Skills sind nur die eigenen
  // vertraut. `~/.agents/skills` enthaelt 82 Python-Dateien, davon 74 aus
  // Fremdquellen (OpenAI `documents`, NVIDIA `accelerated-computing-cudf`,
  // HuggingFace `huggingface-llm-trainer`, `.system`). Ein Git-Repo macht sie
  // reviewbar, nicht geprueft - fremde Skripte bleiben deshalb Rueckfrage.
  if (!opts.base) return "unknown"
  const abs = resolveTarget(expandLeadVar(tokens[i], ctx?.vars), opts, ctx?.cwd ?? null, ctx?.vars)
  if (!abs) return "unknown"
  const roots = [normPath(opts.base)]
  const gitDirs = [normPath(`${opts.base}\\.git`)]
  if (opts.home) {
    const skills = normPath(`${opts.home}\\.agents\\skills`)
    for (const name of TRUSTED_SKILL_DIRS) roots.push(normPath(`${skills}\\${name}`))
    gitDirs.push(normPath(`${opts.home}\\.agents\\.git`))
  }
  if (!roots.some((root) => isUnder(abs, root))) return "unknown"
  if (gitDirs.some((dir) => isUnder(abs, dir))) return "unknown"
  if (!/\.py$/.test(abs)) return "unknown"
  return "read"
}

// Eigene Skills, deren Skripte als reviewbarer Inhalt gelten. Bewusst eine
// Liste und keine Regel: neue Namen kosten eine Zeile, ein fremder Skill
// kommt nicht versehentlich mit.
const TRUSTED_SKILL_DIRS = new Set([
  "markdown-table-formatting",
  "monthly-price-benchmark-workbook",
  "gemma-dev",
  "nemo-retriever",
])

// Entscheidung 1 (22.10.2026): node nur fuer die drei Selbst-Skripte dieses
// Guards (test.mjs, replay.mjs, analyze.mjs), pfadverankert unter
// <projekt>\tools\permission-guard\ und aufloesbar gegen den (per cd
// verfolgten) Arbeitsordner. Alles andere - fremde Skripte, --eval,
// --version, der nackte node-Aufruf - bleibt Rueckfrage. deno, ruby und
// perl sind nicht bereitgestellt und bleiben Rueckfrage.
const NODE_SELF_SCRIPTS = new Set(["test.mjs", "replay.mjs", "analyze.mjs", "stats.mjs"])

// Ersetzt einen fuehrenden Variablenbezug ($dir bzw. ${dir}) durch den
// eindeutig zugewiesenen Literalwert, falls vorhanden. Ohne Zuweisung
// bleibt der Text mit $ stehen und loest spaeter nicht auf (fail closed).
function expandLeadVar(t, vars) {
  const m = /^\$\{?(\w+)\}?/.exec(t)
  if (!m) return t
  const v = vars?.get(m[1].toLowerCase())
  if (v == null || v === "") return t
  return `${v}${t.slice(m[0].length)}`
}

function classifyNode(s, ctx) {
  const opts = ctx?.opts ?? {}
  if (!opts.base) return "unknown"
  const tokens = tokenizeCli(s)
  const arg = expandLeadVar(tokens[1] ?? "", ctx?.vars)
  if (!arg || arg.startsWith("-")) return "unknown"
  const abs = resolveTarget(arg, opts, ctx?.cwd ?? null, ctx?.vars)
  if (!abs) return "unknown"
  const root = normPath(`${opts.base}\\tools\\permission-guard`)
  if (!isUnder(abs, root)) return "unknown"
  const tail = abs.slice(root.length + 1)
  return NODE_SELF_SCRIPTS.has(tail) ? "read" : "unknown"
}

function classifyOpencode(statement) {
  const args = tokenizeCli(statement).slice(1)
  if (!args.length) return "unknown" // startet die TUI
  const head = args[0].toLowerCase()
  if (CLI_READ_FLAGS.has(head)) return "read"
  if (!OPENCODE_READ_SUBS.has(head)) return "unknown"
  // --standalone/--server starten einen eigenen Serverprozess.
  if (args.some((a) => /^--(standalone|server)(=|$)/i.test(a))) return "unknown"
  return "read"
}

function classifyFirecrawl(statement) {
  const args = tokenizeCli(statement).slice(1)
  if (!args.length) return "unknown"
  const head = args[0].toLowerCase()
  if (CLI_READ_FLAGS.has(head) || head === "--status") return "read"
  const sub = head === "x" ? "experimental" : head
  const isScrape = sub === "scrape"
  const isCrawl = sub === "crawl"
  if (!FIRECRAWL_READ_SUBS.has(sub) && !isScrape && !isCrawl) return "unknown"
  for (const arg of args.slice(1)) {
    const flag = arg.toLowerCase().split("=")[0]
    if (FIRECRAWL_UNSAFE_FLAGS.has(flag)) return "unknown"
  }
  // Mehrere URLs legt die CLI in .firecrawl/ ab; ohne Ziel nur eine zulassen.
  if (isScrape && args.slice(1).filter((a) => URLISH.test(a)).length > 1) return "unknown"
  return "read"
}

// gitleaks (Nutzerentscheid 23.10.2026): Die Suche liest nur, aber ein Scan
// ohne --redact schreibt gefundene Geheimnisse in die Ausgabe - damit in den
// Verlauf und ins Protokoll. Deshalb: Scans nur mit voller Redaktion
// (--redact oder --redact=100; Teilredaktion bleibt Rueckfrage). Schreibende
// Flags bleiben Rueckfrage: Bericht, Diagnoseprofil/-ordner, und --log-opts
// (startet git log mit beliebigen Optionen, dort schreibt --output=<datei>).
// Grundlage: Hilfe-Baum der installierten Fassung (gitleaks help/dir/git).
const GITLEAKS_READ_SUBS = new Set(["git", "dir", "file", "directory"])
const GITLEAKS_UNSAFE_FLAGS = new Set([
  "-r", "--report-path", "--report-template", "--log-opts",
  "--diagnostics", "--diagnostics-dir",
])

function classifyGitleaks(statement) {
  const args = tokenizeCli(statement).slice(1)
  if (!args.length) return "unknown"
  const sub = args[0].toLowerCase()
  if (sub === "version" || sub === "help") return args.length === 1 ? "read" : "unknown"
  if (!GITLEAKS_READ_SUBS.has(sub)) return "unknown"
  let redact = false
  for (const arg of args.slice(1)) {
    const lowerArg = arg.toLowerCase()
    if (GITLEAKS_UNSAFE_FLAGS.has(lowerArg.split("=")[0])) return "unknown"
    if (lowerArg === "--redact" || lowerArg === "--redact=100") redact = true
  }
  return redact ? "read" : "unknown"
}

// sqlite3 (Nutzerentscheid 25.10.2026): Nur mit -readonly gilt die Abfrage als
// Lesen. Alles, was eine Ausgabe- oder Sicherungsdatei anlegen koennte, bleibt
// Rueckfrage; ohne das Flag ist der Aufruf unbekannt (sqlite3 oeffnet sonst
// schreibend).
const SQLITE_WRITE_FLAGS = new Set([
  "-cmd", "-init", ".output", ".once", ".save", ".backup", ".restore", ".clone", ".archive",
])

function classifySqlite(statement) {
  const args = tokenizeCli(statement).slice(1)
  if (!args.length) return "unknown"
  const readonly = args.some((a) => /^-(?:readonly|read-only)$/i.test(a))
  if (!readonly) return "unknown"
  for (const arg of args) {
    const lowerArg = arg.toLowerCase()
    // Ein Punktbefehl steht oft in Anfuehrungszeichen und damit als ein Token
    // mit Leerzeichen ("\".output out.txt\""). Deshalb das erste Wort pruefen.
    const head = lowerArg.split(/\s+/)[0]
    if (SQLITE_WRITE_FLAGS.has(head) || lowerArg.startsWith("--output")) return "unknown"
  }
  return "read"
}

// gh (Nutzerentscheid 25.10.2026): ausschliesslich die lesenden Unterbefehle,
// die im Alltag vorkommen. `gh api` fehlte bewusst - es kann POSTen.
// Nachschlaerf (Nutzerentscheid 29.10.2026): `gh api` ist standardmaessig GET
// und deshalb zulaessig, solange ein Senden nachweisbar ausgeschlossen ist.
// Senden liegt vor bei -f/-F/--field/--raw-field/--input (schalten still auf
// POST um), bei -X/--method ausser GET/HEAD/OPTIONS sowie bei `graphql`
// (immer POST, daher auch Mutationen). Es wird kein Pfad interpretiert und
// keine Variable aufgeloest - Mehrdeutiges bleibt "unknown" und damit Rueckfrage.
const GH_SEND_FLAGS = new Set(["-f", "-F", "--field", "--raw-field", "--input"])
const GH_READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function ghApiIsReadOnly(tokens) {
  const lower = tokens.map((t) => t.toLowerCase())
  for (let i = 0; i < lower.length; i++) {
    const token = lower[i]
    // Form "--flag=Wert" (etwa --method=GET) als ein Token.
    const eq = token.indexOf("=")
    if (eq > 0) {
      const name = token.slice(0, eq)
      const value = token.slice(eq + 1)
      if (name === "--method" || name === "-x") {
        if (!GH_READ_METHODS.has(value.toUpperCase())) return false
        continue
      }
      if (GH_SEND_FLAGS.has(name)) return false
      continue
    }
    if (GH_SEND_FLAGS.has(token)) return false
    if (token === "--method" || token === "-x") {
      if (!GH_READ_METHODS.has((lower[i + 1] ?? "").toUpperCase())) return false
      i++
    }
  }
  return true
}

function classifyGh(statement) {
  const tokens = tokenizeCli(statement)
  const args = tokens.slice(1).filter((a) => !a.startsWith("-"))
  if (args.length < 2) return "unknown"
  const sub = `${args[0].toLowerCase()} ${args[1].toLowerCase()}`
  if (sub === "auth status" || sub === "repo view") return "read"
  if (args[0].toLowerCase() !== "api") return "unknown"
  // `gh api graphql` ist immer POST. args[1] ist der Endpunkt-Pfad, weil
  // Flag-Werte bei der Argumentliste entfernt wurden.
  if (args[1].toLowerCase() === "graphql") return "unknown"
  return ghApiIsReadOnly(tokens) ? "read" : "unknown"
}

/**
 * Bewertet ein Shell-Skript.
 * @param {string} script
 * @param {{base?: string, roots?: string[], home?: string, temp?: string, appData?: string}} [options]
 *   base  - Arbeitsordner der Sitzung (Bezug fuer relative Pfade)
 *   roots - zusaetzlich vertraute Ordner (Schreiben erlaubt)
 *   home  - Benutzerprofil (fuer ~, $HOME, geschuetzte Pfade)
 *   temp  - temporaerer Ordner (fuer $env:TEMP)
 *   appData - Windows-Roaming-Konfigurationsordner; nur fuer die enge Ruff-Ausnahme
 * @returns {{decision: "allow" | "ask" | "deny", reason: string}}
 */
export function evaluate(script, options = {}) {
  const raw = String(script ?? "")
  if (!raw.trim()) return { decision: "ask", reason: "leer" }

  for (const rx of DENY_COMMANDS) {
    if (rx.test(raw)) return { decision: "deny", reason: `destruktiv: ${rx.source}` }
  }

  // Kommentare und Here-String-Inhalte sind Daten, keine Befehle.
  const text = stripHereStrings(raw)
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n")

  const write = hasWriteVerb(stripStrings(text))
  const fileWrite = hasFileWriteVerb(stripStrings(text))

  if (write || fileWrite) {
    for (const rx of DENY_PATHS) {
      if (rx.test(text)) return { decision: "deny", reason: "Schreibzugriff auf Geheimnisablage" }
    }
  }
  // Netz, Prozesse, Registry, Git-Historie: immer Rueckfrage.
  if (write) return { decision: "ask", reason: `schreibend: ${write}` }

  const statements = splitStatements(text)

  // Aufloesungskontext fuer pfadverankerte Freigaben (node-/python-Skripte):
  // Variablen aus einfachen Literalzuweisungen und der auf oberster Ebene
  // per cd verfolgte Arbeitsordner. Misslingt ein cd-Ziel, wird relative
  // Pfadaufloesung abgestellt (fail closed).
  const vars = buildVarMap(statements)
  let cwd = resolveTarget(options.base, options, null, vars)
  if (cwd) {
    for (const st of statements) {
      const m = CD_RE.exec(st.trim())
      if (!m) continue
      const next = resolveTarget(m[1] ?? m[2] ?? m[3], options, cwd, vars)
      if (!next) { cwd = null; break }
      cwd = next
    }
  }
  const ctx = { opts: options, vars, cwd }

  const kinds = new Set()
  const unknowns = []
  for (const st of statements) {
    const kind = classifyStatement(st, ctx)
    kinds.add(kind)
    if (kind === "unknown" || kind === "write") unknowns.push(st.slice(0, 80))
  }

  // Nutzerentscheid 3 (22.10.2026, Abend): Aufrufe ueber & oder . verweigern
  // statt Rueckfrage. Die Zeile zeigt nur Namen von Variablen, nicht den
  // Inhalt - eine Frage liess sich so nicht begruendet beantworten. Die
  // Verweigerung schlaegt die Geheimnis-Rueckfrage, weil jede Form von
  // Nachfragen ohne lesbaren Inhalt unbrauchbar bleibt.
  if (kinds.has("deny")) {
    return { decision: "deny", reason: "unpruefbar: Aufruf ueber & oder ." }
  }

  const secrets = findSecrets(raw)
  if (secrets.length) return { decision: "ask", reason: `Geheimnis: ${secrets.slice(0, 3).join(", ")}` }

  if (!statements.length) return { decision: "allow", reason: "nur Ausgabe" }

  if (kinds.has("write") || kinds.has("unknown")) {
    return { decision: "ask", reason: `nicht einordenbar: ${unknowns[0] ?? ""}` }
  }
  if (kinds.has("filewrite")) {
    const scoped = scopeWrites(statements, options)
    // Nutzerentscheid 25.10.2026: Schreiben ausserhalb des Projekts, in
    // geschuetzte Pfade oder rekursiv auf den Arbeitsordner wird nicht mehr
    // gefragt, sondern verweigert. Die Rueckfrage war die haeufigste
    // Unterbrechung und liess sich ohne lesbaren Pfad nicht begruenden.
    // Alles Unbestimmbare ("unklar", "keine vertrauten Ordner") bleibt "ask".
    if (!scoped.ok && /^(ausserhalb des Projekts|geschuetzter Pfad|rekursiv auf)/.test(scoped.reason)) {
      return { decision: "deny", reason: scoped.reason }
    }
    if (!scoped.ok) return { decision: "ask", reason: scoped.reason }
    const reason = kinds.has("localwrite") ? `${scoped.reason} + git add/commit` : scoped.reason
    return { decision: "allow", reason }
  }
  if (kinds.has("localwrite")) {
    return { decision: "allow", reason: "git add/commit (lokal, umkehrbar)" }
  }
  if (!kinds.size || [...kinds].every((k) => k === "noop")) {
    return { decision: "allow", reason: "nur Ausgabe" }
  }
  return { decision: "allow", reason: "nur lesend" }
}
