// Klassifizierer fuer Shell-Befehle.
//
// Zweck: entscheiden, ob ein Befehl nachweislich nur liest. Nur dann darf ein
// "ask" der statischen Regeln zu "allow" hochgestuft werden. Aufrufe ueber
// "&" oder "." (Ziel liegt in einer Variablen/Bindung und ist in der Zeile
// nicht lesbar) werden verweigert ("deny", Nutzerentscheid 22.10.2026).
// Alles Unbekannte bleibt "ask" (fail closed). Ein "deny" der statischen
// Regeln wird nie angefasst.
//
// Reine Funktionen bis auf eine Ausnahme: die Urteilsdatei fuer Skill-Skripte
// (Nutzerentscheid 05.11.2026) wird gelesen, nie geschrieben. Fehlt sie oder
// ist sie unlesbar, gilt die eingebaute Liste - der Fehlerfall oeffnet nichts.
// Dadurch ohne OpenCode testbar. Der Import von node:crypto rechnet nur; er
// liefert den Argument-Hash fuer MCP-Freigabe-Schluessel (Schritt A, 29.10.2026)
// und den Datei-Hash fuer die Urteilsdatei.

import { createHash } from "node:crypto"
import { existsSync, readFileSync, realpathSync } from "node:fs"

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
  [/\brecovery[-_ ]?codes?\b/i, "Wiederherstellungscodes"],
  [/\bbackup[-_ ]?codes?\b/i, "Backup-Codes"],
  // Schluessel-, Zertifikats- und Tresordateien (Nutzerentscheid 18.11.2026).
  // Die Endung benennt den Inhalt: privater Schluessel, Zertifikat, VPN-Profil
  // oder Passwort-Tresor. Der Punkt vor der Endung und die Trennung danach
  // halten das Muster eng: "monkey.key" trifft, "keys" nicht.
  [/\.(pem|key|ppk|pfx|p12|asc|ovpn|kdbx)\b/i, "Schluesseldatei"],
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
  "new-guid", "new-timespan", "new-timespan",
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
  // Ein Semikolon oder Zeilenumbruch innerhalb eines Skriptblocks trennt
  // keine Anweisungen; der Block wird als Ganzes klassifiziert.
  let braceDepth = 0
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
    if (ch === "{") { braceDepth++; cur += ch; continue }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1)
      cur += ch
      // Folgezweige sind eigene Kontrollbloecke. Ohne diesen Schnitt wertet
      // splitBlock nur den if-Rumpf aus und der else-Rumpf bliebe unsichtbar.
      if (braceDepth === 0 && /^\s*(?:else|elseif|catch|finally)\b/i.test(script.slice(i + 1))) {
        out.push(cur)
        cur = ""
      }
      continue
    }
    if (braceDepth > 0) { cur += ch; continue }
    if (ch === "\n" || ch === "\r") { out.push(cur); cur = ""; continue }
    if (ch === ";") { out.push(cur); cur = ""; continue }
    if (ch === "|") {
      if (script[i + 1] === "|") { i++ }
      out.push(cur); cur = ""
      continue
    }
    if (ch === "&") {
      // && trennt immer. Ein einzelnes & trennt Befehle (Review 17.11.2026);
      // in einer Stream-Umleitung (2>&1, *>&1) und am Segmentanfang bleibt es
      // Text: dort ist es der Call-Operator, der weiter unten verweigert wird.
      if (script[i + 1] === "&") { i++; out.push(cur); cur = ""; continue }
      const prev = script[i - 1]
      if (prev === ">" || prev === "<") { cur += ch; continue }
      const last = cur.trimEnd().slice(-1)
      if (!last || "{(;|,&=".includes(last)) { cur += ch; continue }
      out.push(cur); cur = ""
      continue
    }
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

// [System.IO.File] nur fuer nachweislich lesende Methoden. "Open" ist nur
// mit FileMode::Open und FileAccess::Read lesend; die 2-Argument-Form
// (File::Open mit FileMode) gibt ReadWrite und bleibt Rueckfrage, ebenso
// Create/Append/Truncate und jede unbekannte Methode (z. B. AppendText).
const FILE_READ_METHODS = new Set(["readalltext", "readallbytes", "readalllines", "exists", "openread"])

function fileOpenIsReadOnly(s) {
  const openParen = s.indexOf("(")
  const closeParen = s.lastIndexOf(")")
  if (openParen < 0 || closeParen <= openParen) return false
  // Zitatsbyewusst zerlegen: ein Komma in einer Zeichenketten-Datei
  // ("C:/outside/a,'Open','Read',b.txt") ist Teil des Namens, kein Trenner.
  const args = []
  let depth = 0
  let current = ""
  let quote = null
  for (let k = 0; k < s.slice(openParen + 1, closeParen).length; k++) {
    const ch = s[openParen + 1 + k]
    if (quote) {
      current += ch
      if (quote === '"' && ch === "`") {
        if (openParen + 1 + k + 1 < closeParen) current += s[++k]
        continue
      }
      if (ch === quote) {
        if (openParen + 1 + k + 1 < closeParen && s[openParen + 1 + k + 1] === quote) current += s[++k]
        else quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue }
    if (ch === "," && depth === 0) {
      args.push(current)
      current = ""
      continue
    }
    if (ch === "[" || ch === "(" || ch === "{") depth++
    if (ch === "]" || ch === ")" || ch === "}") depth--
    current += ch
  }
  args.push(current)
  // Nur exakt die Enum-Literale oder Zeichenkettenform zaehlen: "[System.IO.FileMode]::Open"
  // oder "'Open'". Kein Suffix-Vergleich — ein berechneter oder
  // angehaengter Ausdruck ist nicht eindeutig lesend und bleibt Rueckfrage.
  const isEnumOrLiteral = (arg, type, value) => {
    const a = arg.trim()
    const literal = /^["']([^"']*)["']$/.exec(a)
    if (literal) return literal[1].trim().toLowerCase() === value
    const enumMatch = new RegExp(`^(?:\\[(?:system\\.)?io\\.${type}\\]|${type})::([a-z]+)$`, "i").exec(a)
    return enumMatch?.[1].toLowerCase() === value
  }
  // Ein Klammerausdruck im Argument ist eigener Code und wird hier nicht
  // bewertet — die Form bleibt Rueckfrage (fail closed).
  if (args.some((arg) => arg.includes("("))) return false
  // File::Open(path, FileMode.Open, FileAccess.Read) mit drei Argumenten:
  // der Zugriff ist lesend. Die 2-Argument-Form gibt ReadWrite und bleibt
  // Rueckfrage; vier Argumente mit FileShare sind die Leseform dahinter.
  if (args.length === 3) return isEnumOrLiteral(args[1], "filemode", "open") && isEnumOrLiteral(args[2], "fileaccess", "read")
  if (args.length < 4) return false
  return isEnumOrLiteral(args[1], "filemode", "open") && isEnumOrLiteral(args[2], "fileaccess", "read")
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
    if (/^(?:system\.)?io\.file$/i.test(type)) {
      if (method === "open") {
        if (fileOpenIsReadOnly(s)) return "read"
        // Erkannte unsichere File::Open-Argumente (Create, Klammer-Schreiben)
        // bleiben Rueckfrage ohne Modellweg.
        if (ctx) ctx.dangerParam = true
        return "unknown"
      }
      if (FILE_READ_METHODS.has(method)) return "read"
      return "unknown"
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
    if (/(^|\s)(--replace-all|--add|--unset|--unset-all|--rename-section|--remove-section|--edit|-e)(\s|=|$)/.test(" " + restText)) return "write"
    if (/(^|\s)(--get|--get-all|--get-regexp|--list|-l|--show-origin|--name-only)(\s|$)/.test(" " + restText)) return "read"
    const positional = rest.filter((t) => !t.startsWith("-"))
    return positional.length >= 2 ? "write" : "read"
  }
  if (sub === "remote") {
    return /(^|\s)(add|remove|rename|set-url|set-head|prune|update)(\s|$)/.test(" " + restText) ? "write" : "read"
  }
  // git stash ohne Unterbefehl ist ein push; -u, -k und -a sind Schreibformen.
  // Lesend sind nur list und show.
  if (sub === "stash") {
    const stashSub = (rest.find((t) => !t.startsWith("-")) ?? "").toLowerCase()
    return stashSub === "list" || stashSub === "show" ? "read" : "write"
  }

  const guard = GIT_READ_ONLY_ARGS[sub]
  if (guard && guard.test(" " + restText)) return "write"
  return "read"
}

// --- Destruktive Git-Formen (Nutzerentscheid 09.11.2026) -----------------
//
// Die statischen Regeln koennen nur den Befehlsanfang sehen. Besonders auf
// Windows ist `git branch -D *` ausserdem case-insensitiv und trifft dort
// auch `git branch -d`. Diese Pruefung arbeitet auf den Segmenten und
// erkennt die Formen auch hinter globalen Optionen wie `-C`, `-c`,
// `--git-dir` und `--work-tree`. Sie liefert nur ein Muster; die Entscheidung
// `deny` faellt in evaluate(). Ein Treffer in einem unlesbaren Block bleibt
// bewusst aus, dann greift weiterhin die normale "ask"-Einordnung.
const GIT_BLOCK_KEYWORD =
  /^(if|elseif|else|while|foreach|for|switch|function|filter|try|catch|finally|do|process|begin|end|param)\b/i

function gitExecutableName(token) {
  return String(token).toLowerCase().split(/[\\/]/).pop()
}

// Kurzoptionen von `git commit`, die ein Argument aufnehmen: der Rest des
// Tokens ist dann das Argument, kein weiterer Schalter (`-mn` = `-m "n"`).
const COMMIT_FLAGS_WITH_VALUE = "mFCctSu"

// `git commit -n` ist die Kurzform von `--no-verify` (Nutzerentscheid
// 15.11.2026). Gebuendelte Kurzoptionen werden von links gelesen; nach einem
// Buchstaben mit Argument endet die Suche. `-n` bei anderen Unterbefehlen
// bedeutet etwas anderes (clean und push: `--dry-run`), deshalb gilt die Regel
// nur fuer commit.
function commitNoVerifyShort(rest) {
  for (const token of rest) {
    if (!/^-[^-]/.test(token)) continue
    for (const ch of token.slice(1)) {
      if (ch === "n") return true
      if (COMMIT_FLAGS_WITH_VALUE.includes(ch)) break
    }
  }
  return false
}

function gitDestructiveInStatement(statement) {
  let s = statement.trim().replace(/^[({]+/, "").trim()
  if (!s) return null

  // Einzeilige Kontrollbloecke: den Rumpf rekursiv pruefen.
  if (GIT_BLOCK_KEYWORD.test(s)) {
    const parts = splitBlock(s)
    if (!parts) return null
    return (
      gitDestructiveInStatement(parts.body) ||
      gitDestructiveInStatement(parts.head.replace(/^[A-Za-z_]+\b/, ""))
    )
  }

  const tokens = tokenizeCli(s)
  let i = 0
  while (i < tokens.length && /^[{}()]+$/.test(tokens[i])) i++
  if (i >= tokens.length || !["git", "git.exe"].includes(gitExecutableName(tokens[i]))) return null
  i += 1

  while (i < tokens.length) {
    const t = tokens[i]
    if (t === "-C" || t === "-c") { i += 2; continue }
    if (t.startsWith("-C") && t.length > 2) { i += 1; continue }
    if (t.startsWith("--no-pager") || t.startsWith("--git-dir") || t.startsWith("--work-tree")) { i += 1; continue }
    break
  }

  const sub = (tokens[i] || "").toLowerCase()
  const rest = tokens.slice(i + 1)
  if (!sub) return null

  // --no-verify umgeht die Projekt-Gates (Nutzerentscheid 15.11.2026).
  // `git commit -n` ist die Kurzform; bei anderen Unterbefehlen bedeutet `-n`
  // etwas anderes (clean und push: `--dry-run`).
  if (rest.includes("--no-verify") || (sub === "commit" && commitNoVerifyShort(rest))) {
    return {
      pattern: "no-verify",
      reason: "git --no-verify umgeht die Projekt-Gates",
    }
  }

  if (sub === "reset" && rest.includes("--hard")) {
    return {
      pattern: "reset-hard",
      reason: "git reset --hard verwirft Arbeitsstand und Historie",
    }
  }

  if (sub === "clean") {
    const dryRun = rest.some((t) => t === "-n" || t === "--dry-run" || /^-[A-Za-z]*n[A-Za-z]*$/.test(t))
    if (dryRun) return null
    return {
      pattern: "clean",
      reason: "git clean loescht unversionierte Dateien",
    }
  }

  if (sub === "branch") {
    const forceDelete = rest.some((t) => /^-D/.test(t))
    const deleteLong = rest.includes("--delete")
    const deleteShort = rest.some((t) => /^-d/.test(t))
    const force = rest.includes("--force") || rest.some((t) => /^-f/.test(t))
    if (forceDelete || (deleteLong && force) || (deleteShort && force)) {
      return {
        pattern: "branch-force-delete",
        reason: "git branch -D loescht einen Branch ohne Merge-Pruefung",
      }
    }
  }

  if (sub === "checkout" && rest.includes(".")) {
    return {
      pattern: "checkout-dot",
      reason: "git checkout . verwirft nicht gespeicherte Aenderungen",
    }
  }

  if (sub === "restore" && rest.includes(".")) {
    const staged = rest.includes("--staged")
    const worktree = rest.includes("--worktree")
    // Nur der Index (--staged ohne --worktree) ist nicht destruktiv.
    if (!staged || worktree) {
      return {
        pattern: "restore-dot",
        reason: "git restore . verwirft nicht gespeicherte Aenderungen",
      }
    }
  }

  return null
}

function findDestructiveGit(script) {
  for (const statement of splitStatements(script)) {
    const hit = gitDestructiveInStatement(statement)
    if (hit) return hit
  }
  return null
}

// Schattenlauf Variante 3 (09.11.2026): erkennt destruktive Git-Formen auch
// dann, wenn die statische Schicht oder eine gespeicherte Freigabe den Befehl
// bereits erlaubt hat. Reine Beobachtung; keine Entscheidung. Liefert nur
// Muster und Aufrufvariante, nie den Befehlstext.
export function gitShadowRecord(script) {
  const text = String(script ?? "")
  const hit = findDestructiveGit(text)
  if (!hit) return null
  let variant = "direct"
  if (/(?:^|[;&|]\s*)(?:bash|sh|zsh|cmd(?:\.exe)?|env|Start-Process)\b/i.test(text)) {
    variant = "wrapper"
  } else if (/\bgit\b[^\r\n;|&]*\s--(?:git-dir|work-tree)\b/i.test(text)) {
    variant = "git-dir"
  } else if (/\bgit\b[^\r\n;|&]*\s(?:-C|-c)\b/.test(text)) {
    variant = "global-option"
  }
  return { pattern: hit.pattern, variant }
}

// URL-Zugangsdaten sind unabhaengig von ihrem Aufbau geheim: Benutzerinfo vor
// dem @ wird aus Meldungen entfernt, auch wenn kein Tokenwort vorkommt.
function redactUrlCredentials(text) {
  return String(text).replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)@/gi, "$1***@")
}

// Bei quotierten URL-Fragmenten ist die Benutzerinfo statisch nicht sicher zu
// trennen. Dann nur der Musterkopf, nie der Befehlstext.
function hasObscuredUrlCredentials(text) {
  const raw = String(text)
  const at = raw.indexOf("@")
  if (at < 0) return false
  const prefix = raw.slice(0, at)
  return prefix.includes("://") && /["']/.test(prefix)
}

// Meldung analog zum Claude-Hook. Der Befehl wird nur genannt, wenn der
// Geheimnis-Filter ihn nicht als verdaechtig einstuft.
function gitRuleMessage(hit, raw) {
  const head = `permission-guard: ${hit.reason} (Muster: ${hit.pattern})`
  if (findSecrets(raw).length || hasObscuredUrlCredentials(raw)) return head
  const command = redactUrlCredentials(raw).replace(/\s+/g, " ").trim().slice(0, 140)
  return command ? `${head}: ${command}` : head
}

function gitAskMessage(write, raw) {
  let head
  if (write === "push") {
    head = "permission-guard: git push laedt Commits ins Remote (Muster: push)"
  } else if (write === "git branch -d" || write === "branch -d") {
    head = "permission-guard: git branch -d loescht einen gemergten Branch (Muster: branch-safe-delete)"
  } else {
    return undefined
  }
  if (findSecrets(raw).length || hasObscuredUrlCredentials(raw)) return head
  const command = redactUrlCredentials(raw).replace(/\s+/g, " ").trim().slice(0, 140)
  return command ? `${head}: ${command}` : head
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

// Lesende Pipeline-Cmdlets, die einen Skriptblock annehmen. Der Block ist
// eigener Code und wird als eigenes Skript bewertet (Review 17.11.2026).
// Aliase gehoeren dazu, weil PowerShell sie gleich behandelt.
const PIPELINE_BLOCK_CMDLETS = new Set([
  "foreach-object", "foreach", "%", "where-object", "where", "?",
  "select-object", "select", "sort-object", "sort", "group-object", "group",
  "measure-object", "measure",
])
// Ein Ortswechsel im Block veraendert den Kontext fuer alle folgenden Blöcke.
const PIPELINE_LOCATION_RE = /(?:^|[\r\n;|({]\s*)(?:cd|chdir|set-location|sl|push-location|pop-location)\b/i

// Irgendein { ausserhalb von Strings, das nicht direkt zu einem Hashtable
// gehoert. Ein Hashtable am Anfang darf spaetere Bloecke nicht verdecken.
function hasScriptBlock(statement) {
  const { masked } = maskStrings(statement)
  for (let open = masked.indexOf("{"); open >= 0; open = masked.indexOf("{", open + 1)) {
    if (masked[open - 1] !== "@") return true
  }
  return false
}

// Schliessende Klammer zu einem {; ohne Gegenstueck das Textende (der Block
// bleibt dann unvollstaendig und die Bewertung fail closed).
function matchBrace(text, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (quote === '"' && ch === "`") { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return text.length
}

// Zerlegt eine Zeile in die Rumpfe ihrer Skriptbloecke und den Rest ohne
// Bloecke. Ein @{...} ist ein Hashtable-Literal, kann aber selbst Bloecke
// enthalten (berechnete Eigenschaften) oder vor einem weiteren Block stehen.
// Innere Bloecke werden deshalb rekursiv gesammelt.
function scriptBlocks(statement) {
  const bodies = []
  let rest = ""
  let quote = null
  let i = 0
  while (i < statement.length) {
    const ch = statement[i]
    if (quote) {
      rest += ch
      if (quote === '"' && ch === "`" && i + 1 < statement.length) {
        rest += statement[i + 1]
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; rest += ch; i++; continue }
    if (ch === "{") {
      const end = matchBrace(statement, i)
      if (statement[i - 1] === "@") {
        // Hashtable selbst nicht ausfuehren, aber enthaltene Scriptbloecke.
        bodies.push(...scriptBlocks(statement.slice(i + 1, end)).bodies)
      } else {
        bodies.push(statement.slice(i + 1, end))
      }
      rest += " "
      i = end + 1
      continue
    }
    rest += ch
    i++
  }
  return { bodies, rest }
}

// ctx ist ein Sammelplatz fuer den Aufloesungskontext (opts, vars, cwd) und
// fuer Gruende aus Skriptbloecken (blockAsk, blockDeny). scopeWrites ruft die
// Funktion ohne Kontext auf; dann bleibt es bei einem leeren Objekt.
function classifyStatement(raw, ctx = {}) {
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
    // Auch eine Rueckfrage aus einem verschachtelten Pipeline-Block darf
    // nicht als harmloser Kontrollblock durchgehen.
    if (results.some((r) => r === "block")) return "block"
    if (results.some((r) => r === "unknown" || r === "write")) return "unknown"
    if (results.some((r) => r === "filewrite")) return "filewrite"
    if (results.some((r) => r === "localwrite")) return "localwrite"
    return "read"
  }

  // Skriptblock hinter einem lesenden Pipeline-Cmdlet (ForEach-Object,
  // Where-Object, Select-Object und Aliase): Der Block ist eigener Code und
  // wird wie ein Teilausdruck als eigenes Skript bewertet. Frueher galt die
  // ganze Zeile als "read" - ein Block mit Remove-Item kam damit ohne
  // Rueckfrage durch (Review 17.11.2026). Jetzt laeuft die aeussere Pruefung
  // nur weiter, wenn jeder Block erlaubt ist; ask und deny aus dem Block gehen
  // mit ihrem Grund an den Aufrufer.
  if (PIPELINE_BLOCK_CMDLETS.has(firstToken(s).toLowerCase()) && hasScriptBlock(s)) {
    const { bodies, rest } = scriptBlocks(s)
    if (!bodies.length) return "block"
    // Der Block laeuft im Arbeitsordner des Skripts. Ist der Ordner nicht
    // bestimmt oder liegt er ausserhalb des Projekts, waere ein relativer
    // Schreibpfad im Block am falschen Ort geprueft - dann Rueckfrage.
    const base = ctx.opts?.base ? normPath(ctx.opts.base) : null
    let firstAsk = null
    if (base && (!ctx.cwd || !isUnder(ctx.cwd, base))) firstAsk = "Arbeitsordner unklar"
    // Innerhalb des Projekts laeuft der Block im aktuellen Unterordner; die
    // urspruengliche Projektwurzel bleibt als Schutzwurzel erhalten. Liegt der
    // Ordner ausserhalb, wird relativ zur Projektwurzel geprueft und die
    // Rueckfrage oben bleibt bestehen, damit kein relativer Pfad entweicht.
    const blockBase = base && ctx.cwd && isUnder(ctx.cwd, base) ? ctx.cwd : ctx.opts?.base
    const blockOpts = { ...ctx.opts, base: blockBase, protectedBase: base }
    for (const body of bodies) {
      if (PIPELINE_LOCATION_RE.test(body.trim())) firstAsk ??= "Arbeitsordnerwechsel im Block"
      // Gewoehnliche Klammerausdruecke werden hier zusaetzlich zerlegt, weil
      // sie im Block ebenfalls Befehle ausfuehren koennen. Alle Bloecke werden
      // gelesen: ein spaetes deny hat Vorrang vor einem fruehen ask.
      for (const inner of [...subexpressions(body, true), body]) {
        const verdict = evaluate(inner, blockOpts)
        if (verdict.decision === "allow") continue
        if (verdict.decision === "deny") {
          ctx.blockDeny = `Skriptblock: ${verdict.reason}`
          return "deny"
        }
        firstAsk ??= verdict.reason
      }
    }
    if (firstAsk) {
      ctx.blockAsk = `Skriptblock: ${firstAsk}`
      return "block"
    }
    s = rest.trim()
  }

  // Nur ein String-Literal -> Write-Output
  if (/^["']/.test(s)) return hasRedirection(s) ? "filewrite" : "noop"
  if (s === "__HERESTRING__") return "noop"

  // Logische Verknuepfung ist ein Ausdruck, kein Befehl.
  if (/^-(?:not|and|or)\b/i.test(s)) return classifyStatement(s.replace(/^-(?:not|and|or)\b\s*/i, ""), ctx)

  // Array- oder Hashtable-Literal ist ein Ausdruck.
  if (/^@[({]/.test(s)) return hasRedirection(s) ? "filewrite" : "read"

  // Zuweisung: $x = <ausdruck> (auch ${x} = ...)
  const assign = /^\$\{?[\w:]+(?:\.\w+)*\}?\s*(=|\+=|-=|\*=|\/=)\s*([\s\S]*)$/.exec(s)
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

  // Methodenaufruf auf Variable: $x.Add(...) (auch ${x}.Add(...))
  const varMethod = /^\$\{?[\w:]+\}?(?:\.\w+)*\.(\w+)\s*\(/.exec(s)
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
  // Seit 17.11.2026 auch ohne Leerzeichen (&$cmd): der Trenner ist bereits
  // abgeschnitten, was hier beginnt, ist ein Aufruf.
  if (/^&/.test(s) || /^\.\s/.test(s)) return "deny"

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

// New-Object erzeugt beliebige .NET-Objekte. Nur wenige Typen sind rein lesend
// (Puffer, Zaehler, Listen). WebClient oder StreamWriter koennen Netz nutzen oder
// Dateien schreiben und bleiben deshalb Rueckfrage.
const NEW_OBJECT_READ_TYPES =
  /^(?:system\.)?(?:io\.streamreader|text\.stringbuilder|diagnostics\.stopwatch|collections\.(?:arraylist|hashtable|generic\.list))$/i
function classifyNewObject(s) {
  const m = /-typename\s+(\S+)|^\s*new-object\s+(?!-)(\S+)/i.exec(s)
  const type = (m?.[1] ?? m?.[2] ?? "").replace(/[([].*$/, "")
  return NEW_OBJECT_READ_TYPES.test(type) ? "read" : "unknown"
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
  if (base === "gh" || base === "gh.exe") return classifyGh(s, ctx)

  if (NET_CMD_NAMES.has(base)) return classifyNetwork(s, ctx)
  if (base === "python" || base === "python.exe" || base === "py" || base === "py.exe") return classifyPython(s, ctx)

  if (lower === "new-object") return classifyNewObject(s)
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

// --- MCP-Kriterienkatalog (Schritt B, 04.11.2026) -------------------------
//
// Ordnet eine MCP-Anfrage nach den vier Kriterien principal / action /
// resource / context ein und entscheidet weiterhin nichts (Schattenmodus wie
// Schritt A). Grundlage sind ausschliesslich das Berechtigungs-Ereignis und
// die Argument-FELDNAMEN; Werte werden nur auf ihre Form geprueft (URL, Pfad,
// Repository, Suchtext) und nie ausgegeben.
//
// Fail closed: Laesst sich die Absicht nicht aus dem Werkzeugnamen ableiten,
// bleibt sie "unknown". Erst Schritt C darf daraus eine Entscheidung machen;
// "unknown" fuehrt dort zur Rueckfrage, nie zur Freigabe.
const MCP_READ_VERBS = new Set([
  "get", "list", "search", "fetch", "read", "find", "query", "view", "show",
  "status", "structure", "contents", "content", "preview", "inspect",
  "describe", "lookup", "download", "scrape", "map", "crawl", "extract",
  "research", "check", "ask", "count", "stats", "info", "details", "history",
  "log", "logs", "resolve",
])

const MCP_WRITE_VERBS = new Set([
  "create", "update", "edit", "patch", "write", "add", "set", "move",
  "rename", "copy", "fork", "star", "unstar", "lock", "unlock", "assign",
  "unassign", "request", "approve", "submit", "comment", "reply", "send",
  "post", "publish", "push", "upload", "install", "run", "execute", "invoke",
  "call", "manage", "register", "enable", "disable", "configure", "start",
  "stop", "restart", "cancel", "resume", "sleep", "terminate", "archive",
  "unarchive", "grant", "revoke", "invite", "transfer", "pay", "purchase",
  "buy", "tag", "release", "deploy", "sync", "save", "export", "import",
  "share", "merge", "commit", "reserve", "book", "close", "apply", "generate",
  "build", "restore", "replace", "append", "insert", "upsert", "modify",
  "change", "schedule", "order",
])

// Loeschen und Zerstoeren steht ueber Schreiben: ein Name mit "search" und
// "delete" ist eine Loeschung, nicht eine Suche.
const MCP_DESTRUCTIVE_VERBS = new Set([
  "delete", "remove", "drop", "purge", "wipe", "destroy", "erase",
  "truncate", "clear", "reset", "kill", "uninstall", "force",
])

// Felder, deren Inhalt veroeffentlicht oder an ein Ziel geschickt wird. Nur
// die Namen zaehlen; der Inhalt selbst wird nie gelesen oder geloggt.
const MCP_CONTENT_FIELDS = new Set([
  "body", "content", "message", "comment", "text", "title", "description",
  "markdown",
])

const MCP_URL_FIELDS = new Set([
  "url", "urls", "uri", "link", "href", "site", "website", "endpoint",
  "webhook",
])
const MCP_PATH_FIELDS = new Set([
  "path", "file", "filename", "filepath", "file_path", "directory", "dir",
  "folder", "cwd", "workdir", "output",
])
const MCP_REPO_FIELDS = new Set([
  "repo", "repository", "reponame", "repo_name", "full_name", "fullname",
])
const MCP_QUERY_FIELDS = new Set([
  "query", "q", "search", "term", "prompt", "question", "keyword",
  "keywords", "objective", "pattern", "regex", "topic",
])

// Zerlegt den Werkzeugnamen in Woerter: "gh_grep_searchGitHub" ->
// ["gh", "grep", "search", "git", "hub"].
function mcpWords(action) {
  return String(action ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

// Rangfolge unknown < read < write < destructive. Der schwerste Treffer
// gewinnt, der zugehoerige Verb wird fuer die Begruendung mitgefuehrt.
const MCP_INTENT_RANK = { unknown: 0, read: 1, write: 2, destructive: 3 }

function mcpIntent(words) {
  let intent = "unknown"
  let verb = ""
  for (const word of words) {
    let kind = ""
    if (MCP_DESTRUCTIVE_VERBS.has(word)) kind = "destructive"
    else if (MCP_WRITE_VERBS.has(word)) kind = "write"
    else if (MCP_READ_VERBS.has(word)) kind = "read"
    if (!kind) continue
    if (MCP_INTENT_RANK[kind] > MCP_INTENT_RANK[intent]) {
      intent = kind
      verb = word
    } else if (!verb) {
      verb = word
    }
  }
  return { intent, verb }
}

// Argumentwerte im Sinne von "diese Option ist gesetzt": true, von 0
// verschiedene Zahlen, nicht-leere Strings/Listen/Objekte. Ausdrueckliche
// Nein-Werte ("false", "0", "off") zaehlen nicht - sonst machte ein
// ausgeschaltetes Flag die Absicht schwerer als sie ist.
function mcpTruthy(value) {
  if (value === true) return true
  if (value === false || value === null || value === undefined) return false
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") return !/^(?:|0|false|no|off|none|null)$/i.test(value.trim())
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "object") return Object.keys(value).length > 0
  return false
}

// Absicht aus Argument-FELDNAMEN (Schema, kein Nutzerinhalt): `read_health`
// mit `reset: true` ist kein Lesen. Nur schreibende und loeschende Feldnamen
// duerfen die Absicht verschaerfen - ein Feldname darf sie nie entschaerfen,
// sonst wuerde aus "unbekannt" durch ein `query`-Feld ein stilles "allow".
export function mcpArgIntent(input) {
  let best = null
  const seen = new Set()
  const visit = (value, key, depth) => {
    if (value === null || value === undefined || depth > 3) return
    if (typeof value === "object") {
      if (seen.has(value)) return
      seen.add(value)
      if (Array.isArray(value)) {
        for (const item of value) visit(item, key, depth + 1)
        return
      }
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, childKey, depth + 1)
      }
      return
    }
    if (!mcpTruthy(value)) return
    for (const word of mcpWords(key)) {
      const kind = MCP_DESTRUCTIVE_VERBS.has(word)
        ? "destructive"
        : MCP_WRITE_VERBS.has(word)
          ? "write"
          : ""
      if (!kind) continue
      if (!best || MCP_INTENT_RANK[kind] > MCP_INTENT_RANK[best.intent]) {
        best = { intent: kind, verb: word }
      }
    }
  }
  visit(input, "", 0)
  return best
}

// Zielart eines Arguments. Die Form entscheidet zuerst (eine URL bleibt eine
// URL, auch wenn das Feld anders heisst), dann der Feldname.
function mcpResourceKind(key, value) {
  const field = String(key ?? "").toLowerCase()
  const text = String(value)
  if (/^(?:https?|ftp|wss?):\/\//i.test(text)) return "url"
  if (/^[A-Za-z]:[\\/]/.test(text)) return "path"
  if (/^\\\\/.test(text)) return "path"
  if (/^~[\\/]/.test(text)) return "path"
  if (/^\.{1,2}[\\/]/.test(text)) return "path"
  if (MCP_URL_FIELDS.has(field)) return "url"
  if (MCP_PATH_FIELDS.has(field)) return "path"
  if (MCP_REPO_FIELDS.has(field)) return "repo"
  if (MCP_QUERY_FIELDS.has(field)) return "query"
  return ""
}

// Sammelt Zielarten auch in verschachtelten Objekten (etwa files: [{path}]).
// Tiefe und Zyklenschutz halten die Auswertung billig; gezaehlt werden nur
// erkannte Ziele, nicht jeder String.
function walkMcpValues(value, visit, key = "", depth = 0, seen = new Set()) {
  if (value === null || value === undefined || depth > 3) return
  if (typeof value === "string") {
    visit(key, value)
    return
  }
  if (typeof value !== "object") return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) walkMcpValues(item, visit, key, depth + 1, seen)
    return
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    walkMcpValues(childValue, visit, childKey, depth + 1, seen)
  }
}

function mcpResources(input) {
  const kinds = new Set()
  let count = 0
  walkMcpValues(input, (key, value) => {
    const kind = mcpResourceKind(key, value)
    if (kind) {
      kinds.add(kind)
      count++
    }
  })
  return { kinds: [...kinds].sort(), count }
}

// Inhaltsfelder mit tatsaechlichem Inhalt - nur Namen, keine Werte.
function mcpContentFields(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return []
  const fields = []
  for (const [key, value] of Object.entries(input)) {
    if (!MCP_CONTENT_FIELDS.has(key.toLowerCase())) continue
    const filled =
      (typeof value === "string" && value.trim().length > 0) ||
      (Array.isArray(value) && value.length > 0)
    if (filled) fields.push(key)
  }
  return fields.sort()
}

// Kriterienkatalog: principal (wer), action (was), resource (wohin),
// context (unter welchen Bedingungen). Keine Entscheidung, keine Werte.
export function mcpCriteria(action, metadata, agent, sessionID) {
  const obs = mcpObservation(action, metadata)
  const label = String(agent ?? "").replace(/[^\w.-]/g, "").slice(0, 40) || "unbekannt"
  const criteria = {
    isMcp: obs.isMcp,
    key: obs.key,
    argHash: obs.argHash,
    argCount: obs.argCount,
    fields: obs.fields,
    hasArgs: obs.hasArgs,
    secret: obs.secret,
    principal: { agent: label, session: Boolean(sessionID) },
    action: { tool: obs.action, verb: "", intent: "unknown", source: "name" },
    resource: { kinds: [], count: 0 },
    context: {
      emptyArgs: !obs.hasArgs,
      argCount: obs.argCount,
      contentFields: [],
      secret: obs.secret,
      oversized: false,
    },
  }
  if (!obs.isMcp) return criteria

  const input = metadata.input
  const nameIntent = mcpIntent(mcpWords(obs.action))
  const argIntent = mcpArgIntent(input)
  // Ein Argument-Feld darf die Absicht nur verschaerfen, nie entschaerfen.
  const fromArgs = Boolean(argIntent) && MCP_INTENT_RANK[argIntent.intent] > MCP_INTENT_RANK[nameIntent.intent]
  let oversized = false
  try {
    oversized = JSON.stringify(input ?? {}).length > 32000
  } catch {
    // Nicht serialisierbar: wie "zu gross" behandeln (unanalysierbar).
    oversized = true
  }
  criteria.action = {
    tool: obs.action,
    verb: fromArgs ? argIntent.verb : nameIntent.verb,
    intent: fromArgs ? argIntent.intent : nameIntent.intent,
    source: fromArgs ? "arguments" : "name",
  }
  criteria.resource = mcpResources(input)
  criteria.context = {
    emptyArgs: !obs.hasArgs,
    argCount: obs.argCount,
    contentFields: mcpContentFields(input),
    secret: obs.secret,
    oversized,
    unresolved: mcpUnresolved(input),
  }
  return criteria
}

// --- MCP-Entscheidung in drei Schichten (Schritt C, 04.11.2026) -----------
//
// Ebene 2 (Notbremse) laeuft VOR Ebene 1: ein klarer Fall von Zerstoerung
// wird aktiv verweigert, nicht nur nachgefragt. Ebene 1 beantwortet die
// eingeordneten Faelle (lesend -> allow, schreibend/loeschend -> ask);
// bleibt die Absicht unklar, gibt sie "model" zurueck und Ebene 3 (lokales
// Modell) entscheidet. "unanalysierbar" (zu grosse Argumente) wird bewusst
// NICHT als destruktiv gewertet - ein Groessenlimit ist kein Fund.
//
// Autoritaet: Ebene 2 darf "deny", Ebene 1 "allow"/"ask", Ebene 3 nur
// "ask" -> "allow" heben. Ein statisches "deny" der Konfiguration wird nie
// angefasst. Argumentwerte erscheinen in keiner Begruendung.
const MCP_BRAKE_ACTIONS = [
  [
    /(?:^|_)(?:delete|remove)_(?:repository|repo|organization|org|account|user|team|project)(?:_|$)/i,
    "Loeschen von Repository, Konto oder Organisation",
  ],
  [
    /(?:^|_)(?:wipe|destroy|purge|drop)_(?:all|database|db|repository|repo|organization|account|disk|volume)(?:_|$)/i,
    "Massenloeschung",
  ],
  [/(?:^|_)force(?:_|$)/i, "erzwungene Aenderung"],
]

// Nur Muster mit hoher Treffsicherheit. Bewusst eng (Regel der Notbremse aus
// der Recherche): keine Variablenaufloesung, keine Pfadnormalisierung, keine
// mehrdeutigen Faelle. Alles andere bleibt Ebene 1 und damit Rueckfrage.
const MCP_BRAKE_ARGS = [
  [
    /(?:^|[\s;&|])rm\s+-(?=[a-z]*r)(?=[a-z]*f)[a-z]*\s+(?:\/|~|\$HOME|\*)(?:\s|$|\/)/i,
    "rekursives Loeschen im Wurzel- oder Home-Verzeichnis",
  ],
  [
    /\bRemove-Item\b[^\n]*-(?:Recurse|Force)[^\n]*(?:[A-Za-z]:[\\/](?:\s|$|["'])|%USERPROFILE%|\$HOME|~(?:\s|$|["']))/i,
    "rekursives Loeschen eines Laufwerks oder Home-Verzeichnisses",
  ],
  [
    /\b(?:Format-Volume|Clear-Disk|Initialize-Disk)\b|diskpart[^\n]*\bclean\b/i,
    "Datentraeger formatieren oder loeschen",
  ],
  [/:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, "Fork-Bombe"],
  [
    /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[^\n|]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex|Invoke-Expression)\b/i,
    "Netzinhalt direkt ausfuehren",
  ],
]

// Werkzeuge, die Daten nach aussen tragen. Zusammen mit einem Geheimnis-Pfad
// in den Argumenten ergibt das den Notbremsefall "Zugangsdaten exportiert".
const MCP_OUTWARD_VERBS = new Set([
  "send", "mail", "email", "post", "publish", "upload", "share", "transfer",
  "export", "invite",
])

function mcpOutward(tool) {
  return mcpWords(tool).some((word) => MCP_OUTWARD_VERBS.has(word))
}

// Felder, deren Wert ein Ziel benennt. Steht dort nur eine Variable, ist das
// Ziel unbekannt - und damit kein Fall fuer das Modell, sondern Rueckfrage.
const MCP_TARGET_FIELDS = new Set([
  "target", "path", "file", "filename", "directory", "dir", "url", "uri",
  "to", "recipient", "destination", "attachment", "source", "repo",
  "repository", "project", "database", "org", "owner",
])

// $NAME, ${NAME}, %NAME% - nichts davon wird aufgeloest.
const MCP_VARIABLE_RX = /^(?:\$[A-Za-z_][\w]*|\$\{[^}]+\}|%[A-Za-z_][\w]*%|%\{[^}]+\})$/

function mcpUnresolved(input) {
  let hit = ""
  walkMcpValues(input, (key, value) => {
    if (hit) return
    const field = String(key).toLowerCase()
    if (!MCP_TARGET_FIELDS.has(field)) return
    if (MCP_VARIABLE_RX.test(value.trim())) hit = field
  })
  return hit
}

function mcpBrake(criteria, input) {
  const normalized = mcpWords(criteria.action.tool).join("_")
  for (const [rx, reason] of MCP_BRAKE_ACTIONS) {
    if (rx.test(normalized)) return reason
  }
  // Zugangsdaten nach aussen: der Plan nennt "Export von Zugangsdaten" als
  // Notbremsefall. Bewusst eng - es braucht beides: ein nach aussen gerichtetes
  // Werkzeug (senden/veroeffentlichen) UND einen Geheimnis-Pfad in den
  // Argumenten. Ein bloßes Geheimniswort bleibt Rueckfrage, sonst wuerde jedes
  // Issue mit dem Wort "token" hart blockiert.
  if (mcpOutward(criteria.action.tool)) {
    let label = ""
    walkMcpValues(input, (key, value) => {
      if (label) return
      for (const [rx, name] of SECRET_PATHS) {
        if (rx.test(value)) {
          label = name
          return
        }
      }
    })
    if (label) return `Zugangsdaten (${label}) werden nach aussen gesendet`
  }
  let hit = ""
  walkMcpValues(input, (key, value) => {
    if (hit) return
    for (const [rx, reason] of MCP_BRAKE_ARGS) {
      if (rx.test(value)) {
        hit = reason
        return
      }
    }
  })
  return hit
}

// Liefert { decision, layer, reason }. "model" ist keine Endentscheidung:
// der Aufrufer befragt dann Ebene 3 und uebernimmt deren Ergebnis.
export function mcpVerdict(criteria, input) {
  if (!criteria || !criteria.isMcp) {
    return { decision: "ask", layer: 1, reason: "kein MCP-Aufruf" }
  }
  const context = criteria.context ?? {}
  const intent = criteria.action?.intent ?? "unknown"

  // Unanalysierbar zuerst: die Notbremse darf aus einem Groessenlimit keinen
  // "destruktiven" Fund machen (Trennung wie in der Recherche gefordert).
  // Ein Groessenlimit ist kein Fund, aber eine Rueckfrage, die niemand lesen
  // kann, ist kein Schutz: Nur eine aus dem Werkzeugnamen belegte Leseabsicht
  // bleibt erlaubt, alles andere wird verweigert (Entscheidung 20.11.2026).
  if (context.oversized) {
    if (intent === "read" && !context.secret) {
      return { decision: "allow", layer: 1, reason: "nur lesend (grosse Argumente)" }
    }
    return { decision: "deny", layer: 1, reason: "unpruefbar (zu grosse Argumente)" }
  }

  const brake = mcpBrake(criteria, input)
  if (brake) return { decision: "deny", layer: 2, reason: `Notbremse: ${brake}` }

  if (context.unresolved) {
    return { decision: "ask", layer: 1, reason: `Ziel ist eine unaufgeloeste Variable (${context.unresolved})` }
  }
  if (context.secret) {
    return { decision: "ask", layer: 1, reason: "Geheimnisverdacht in den Argumenten" }
  }
  if (context.emptyArgs) {
    return { decision: "ask", layer: 1, reason: "keine Argumente" }
  }
  if (intent === "read") {
    return { decision: "allow", layer: 1, reason: `nur lesend (${criteria.action?.verb || "read"})` }
  }
  if (intent === "write") {
    return { decision: "ask", layer: 1, reason: `schreibend oder oeffentlich (${criteria.action?.verb || "write"})` }
  }
  if (intent === "destructive") {
    return { decision: "ask", layer: 1, reason: `loeschend (${criteria.action?.verb || "delete"})` }
  }
  return { decision: "model", layer: 3, reason: "Absicht nicht einordenbar" }
}

// Schalter fuer die MCP-Entscheidung (Schritt C, 04.11.2026).
//
// "shadow" (Vorgabe): urteilen, protokollieren, nichts aendern.
// "active":           Urteil auf Aufrufe anwenden, die die statischen Regeln
//                     mit "ask" beantworten. "allow"/"deny" der Konfiguration
//                     und gespeicherte Freigaben werden nie angefasst.
//
// Bewusst ein Quelltext-Schalter statt einer Umgebungsvariablen: Aktivieren
// ist ein eigener, pruefbarer Schritt (Testregime E vorher gruen), kein
// Zustand, den ein Terminal vergisst. Umschalten heisst: hier aendern, Tests
// laufen lassen, deployen - dieselbe Kette wie jede andere Plugin-Aenderung.
export const MCP_GATING_MODE = "active"

// Welche Regeln darf ein Plugin-Kontext registrieren? Der globale Kontext
// (Basis = Benutzerprofil) darf nur MCP beobachten. Wuerde er die Shell-
// Regeln mitregistrieren, waere das gesamte Profil vertraut. Reine Funktion,
// damit die Grenze ohne OpenCode testbar bleibt.
export function contextScope(base, home) {
  const norm = (value) => String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
  return norm(base) === norm(home) ? "mcp" : "full"
}

// Was mit einem Urteil geschehen soll. "shadow" und "keep" bedeuten "nichts
// tun"; "model" bedeutet "Ebene 3 befragen, deren Ergebnis uebernehmen".
export function mcpAction(effect, verdict, mode = MCP_GATING_MODE) {
  if (mode !== "active") return "shadow"
  if (String(effect ?? "").toLowerCase() !== "ask") return "keep"
  const decision = verdict?.decision
  if (decision === "allow") return "allow"
  if (decision === "deny") return "deny"
  if (decision === "model") return "model"
  return "ask"
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
  // Review 17.11.2026: 1> und 2> schreiben in eine Datei. Frueher blieb das
  // unerkannt, weil die Ziffer vor dem > als Wortzeichen galt.
  const { masked, unbalanced } = maskStrings(script)
  if (unbalanced) return true
  const cleaned = masked
    .replace(/\d?>&\d/g, " ")
    .replace(/\d?>\s*\$null\b/gi, " ")
  return /(^|[^-\w=])\d?>{1,2}(?!&)/.test(cleaned)
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

// Loest vorhandene Pfadteile physisch auf, damit eine Junction oder ein Symlink
// nicht als harmloser Projektpfad gilt. Fehlende Endteile werden angehaengt.
// null = vorhandener Pfad liess sich nicht aufloesen (fail closed).
function physicalPath(abs) {
  if (!abs) return null
  let current = abs
  const suffix = []
  while (!existsSync(current)) {
    const cut = current.lastIndexOf("\\")
    if (cut < 2) return abs // synthetischer Pfad ohne realen Wurzelteil
    if (cut === 2) {
      // Beim Laufwerkswurzel stehen bleiben: "C:" allein meint unter Windows
      // den aktuellen Ordner auf dem Laufwerk, nicht das Wurzelverzeichnis.
      if (current.length > 3) suffix.unshift(current.slice(3))
      current = current.slice(0, 3)
      break
    }
    suffix.unshift(current.slice(cut + 1))
    current = current.slice(0, cut)
  }
  if (!existsSync(current)) return abs
  try {
    const real = normPath(realpathSync.native(current))
    return suffix.length ? normPath([real, ...suffix].join("\\")) : real
  } catch {
    return null
  }
}

const UNKNOWN = "\u0001"

// cd-Formen (nur absolute, sicher bestimmbare Wechsel). Genutzt vom
// Aufloesungskontext in evaluate(); scopeWrites fuehrt Wechsel sequenziell
// mit. push-location/pop-location werden dort als unpruefbar verweigert,
// weil der Location-Stack nicht modelliert wird.
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

  // Laufwerksrelative Pfade (`C:.git`) haengen vom aktuellen Ordner des
  // Laufwerks ab, nicht vom Projekt. Ohne verlaessliche Aufloesung ablehnen.
  if (/^[A-Za-z]:(?![\\/])/.test(t)) return null
  if (!/^[A-Za-z]:[\\/]/.test(t)) {
    if (/^[\\/]/.test(t)) return null // Unix-Wurzel oder UNC
    if (!base) return null
    t = `${base}\\${t}`
  }
  return normPath(t)
}

// .NET-Methoden und die Argumentpositionen, die Dateien veraendern.
const DOTNET_TARGET_INDICES = {
  copy: [0, 1],
  move: [0, 1],
  replace: [0, 1, 2],
  delete: [0],
  createdirectory: [0],
  writealltext: [0],
  writeallbytes: [0],
  writealllines: [0],
  appendalltext: [0],
  appendalllines: [0],
  setattributes: [0],
  setlastwritetime: [0],
  openwrite: [0],
}

// Cmdlets, bei denen Quelle und Ziel getrennt geprueft werden muessen.
const COPY_MOVE_CMDLETS = new Set([
  "copy-item", "cp", "copy", "cpi",
  "move-item", "mv", "move", "mi",
  "rename-item", "ren", "rni",
])

const COPY_MOVE_PATH_FLAGS = new Set([
  "path", "literalpath", "destination", "filename", "filepath", "newname",
])

// Flags mit eigenem Wert, die kein Pfadziel sind.
const COPY_MOVE_VALUE_FLAGS = new Set([
  "filter", "include", "exclude", "credential", "fromsession", "tosession",
  "erroraction", "warningaction", "informationaction",
  "errorvariable", "warningvariable", "outvariable", "outbuffer",
  "pipelinevariable", "stream",
])

// Zerlegt Argumente an Kommas ausserhalb von Strings und Klammern.
function splitTopLevel(text, separator = ",") {
  const out = []
  let cur = ""
  let depth = 0
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      cur += ch
      if (ch === "`" && quote === '"') {
        if (i + 1 < text.length) cur += text[++i]
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === "(" || ch === "{" || ch === "[") depth++
    else if (ch === ")" || ch === "}" || ch === "]") depth--
    if (ch === separator && depth === 0) {
      out.push(cur.trim())
      cur = ""
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function extractDotNetTargets(statement) {
  const s = statement.trim().replace(/[};]\s*$/, "")
  const m = /^\[((?:[^\[\]]|\[[^\[\]]*\])*)\]::(\w+)\s*\(([\s\S]*)\)\s*$/.exec(s)
  if (!m) return null
  const method = m[2].toLowerCase()
  const indices = DOTNET_TARGET_INDICES[method]
  if (!indices) return null
  const args = splitTopLevel(m[3])
  const out = []
  for (const index of indices) {
    if (index >= args.length) {
      if (method === "replace" && index === 2) continue
      return null
    }
    const value = args[index].trim()
    if (!value || value.toLowerCase() === "$null") {
      if (method === "replace" && index === 2) continue
      return null
    }
    out.push(value)
  }
  return out
}

// Liefert undefined, wenn kein Copy/Move/Rename-Cmdlet vorkommt, null bei
// unklarer Bindung und sonst alle Pfadoperanden.
function extractCopyMoveTargets(statement) {
  const tokens = tokenizeCli(statement)
  const commandIndex = tokens.findIndex((token, index) => {
    if (!COPY_MOVE_CMDLETS.has(token.toLowerCase().replace(/\.exe$/, ""))) return false
    const prev = tokens[index - 1]
    return index === 0 || prev === "{" || prev === "("
  })
  if (commandIndex < 0) return undefined

  const out = []
  for (let i = commandIndex + 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === "{" || token === "}" || token === "(" || token === ")") continue
    if (!token.startsWith("-")) {
      out.push(token)
      continue
    }
    const raw = token.replace(/^-+/, "")
    const sep = raw.search(/[:=]/)
    const name = (sep >= 0 ? raw.slice(0, sep) : raw).toLowerCase()
    const inline = sep >= 0 ? raw.slice(sep + 1) : null
    if (COPY_MOVE_PATH_FLAGS.has(name)) {
      const value = inline ?? tokens[++i]
      if (!value || value.startsWith("-")) return null
      for (const part of value.split(",")) {
        if (part.trim()) out.push(part.trim())
      }
      continue
    }
    if (COPY_MOVE_VALUE_FLAGS.has(name) && inline === null) i++
  }
  return out.length >= 2 ? [...new Set(out)] : null
}

function extractTargets(statement, vars) {
  const out = []
  const add = (value) => {
    const v = String(value ?? "").trim()
    if (v && v.toLowerCase() !== "$null") out.push(v)
  }
  const s = statement.trim()

  // .NET-Aufrufe auch innerhalb eines Blocks erkennen; ein Aufruf in einem
  // String beginnt nicht an einer Befehlsgrenze.
  const dotNetIndex = s.search(/\[[^\]]+\]::\w+\s*\(/)
  if (dotNetIndex >= 0) {
    const prefix = s.slice(0, dotNetIndex).trimEnd()
    if (prefix === "" || /[{(;=]$/.test(prefix)) {
      return extractDotNetTargets(s.slice(dotNetIndex))
    }
  }

  // Copy/Move/Rename: Quelle und Ziel immer gemeinsam pruefen.
  const copyTargets = extractCopyMoveTargets(s)
  if (copyTargets !== undefined) return copyTargets

  let explicit = false
  for (const m of s.matchAll(/(?<![-\w])-(?:(?:Literal)?Path|Destination|FilePath|Target)\b\s*(?:=|:)?\s*(?:"([^"]*)"|'([^']*)'|([^\s;|()]+))/gi)) {
    explicit = true
    add(m[1] ?? m[2] ?? m[3])
  }
  for (const m of s.matchAll(/(?:^|[^-\w])\d?>{1,2}\s*(?:"([^"]*)"|'([^']*)'|([^\s;|()]+))/g)) {
    const target = m[1] ?? m[2] ?? m[3] ?? ""
    // Stream-Umleitung (2>&1, *>&1) ist kein Dateiziel (Review 17.11.2026).
    if (target.startsWith("&")) continue
    explicit = true
    add(target)
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

// Bekannte Parameter der Loesch-Cmdlets. Abkuerzungen werden nur akzeptiert,
// wenn sie eindeutig auf genau einen dieser Namen zeigen.
const DELETION_PARAMETERS = new Set([
  "recurse", "force", "path", "literalpath", "filter", "include", "exclude",
  "credential", "whatif", "confirm", "verbose", "debug", "erroraction",
  "warningaction", "informationaction", "errorvariable", "warningvariable",
  "outvariable", "outbuffer", "pipelinevariable", "stream",
])

const ANY_LOCATION_RE = /(?:^|[;{(\s])(?:cd|chdir|set-location|sl)\b/i
const LOCATION_STACK_RE = /\b(?:push-location|pop-location)\b|\b(?:set-location|sl)\b[^\n]*\s-stack\b/i
const ASSIGNMENT_RE = /(?:^|[;{\s])\$(?:\{?\w+\}?|[\w:]+(?:\.\w+)*)\s*(?:=|\+=|-=|\*=|\/=)/
const CONTROL_STATEMENT_RE = /^(?:if|elseif|else|while|foreach|for|switch|function|filter|try|catch|finally|do|process|begin|end|param)\b(?=\s|\()/i

function resolveDeletionParameter(name) {
  const exact = name.toLowerCase()
  if (DELETION_PARAMETERS.has(exact)) return exact
  const matches = [...DELETION_PARAMETERS].filter((parameter) => parameter.startsWith(exact))
  return matches.length === 1 ? matches[0] : null
}

// Liefert die aufgeloesten Schalter oder null bei unbekannter/mehrdeutiger Form.
function deletionFlags(statement) {
  const flags = new Set()
  for (const token of tokenizeCli(statement).slice(1)) {
    if (!token.startsWith("-")) continue
    const raw = token.replace(/^-+/, "").split(/[:=]/, 1)[0].toLowerCase()
    const resolved = resolveDeletionParameter(raw)
    if (!resolved) return null
    flags.add(resolved)
  }
  return flags
}

// Findet ein Loesch-Cmdlet auch hinter einem Blockanfang.
function deletionCommand(statement) {
  const tokens = tokenizeCli(statement)
  const index = tokens.findIndex((token, i) => {
    const name = token.toLowerCase().replace(/\.exe$/, "")
    if (!DELETE_CMDLETS.has(name)) return false
    const prev = tokens[i - 1]
    return i === 0 || prev === "{" || prev === "("
  })
  return index >= 0 ? tokens[index].toLowerCase().replace(/\.exe$/, "") : null
}

// Ein Punkt im Basisnamen ist kein Dateibeweis: Verzeichnisse duerfen ebenfalls
// Punkte enthalten. Nur bekannte Dateiendungen gelten als sichere Dateiziele.
function looksLikeDirectory(target) {
  const trimmed = String(target).replace(/[\\/]+$/, "")
  const last = trimmed.split(/[\\/]/).pop() ?? ""
  if (last.lastIndexOf(".") <= 0) return true
  return !PATH_EXTENSIONS.test(last)
}

/**
 * Liefert den Grund, warum ein Loeschen rueckgefragt wird, sonst null.
 * @param {string} statement
 * @param {string[]} targets die unveraenderten Zielangaben aus extractTargets
 * @param {Set<string>|null} flags aufgeloeste Schalter, null bei Mehrdeutigkeit
 */
function deletionEscalation(statement, targets, flags = deletionFlags(statement)) {
  if (!flags) return "Unbekannter oder mehrdeutiger Schalter"
  if (flags.has("recurse")) return "Rekursion"
  if (flags.has("force")) return "-Force"
  for (const target of targets) {
    if (/[*?[\]]/.test(target)) return `Platzhalter-Ziel: ${target}`
    if (looksLikeDirectory(target)) return `Verzeichnis: ${target}`
  }
  return null
}

// Aktualisiert die Variablenbindung einer einzelnen Anweisung. Nur literale
// Zuweisungen und Join-Path mit literalen Teilen sind verlaesslich; alles
// andere wird aus der Karte entfernt und spaeter als unpruefbar verweigert.
function updateVarMap(statement, vars) {
  const text = statement.trim()
  const literal = /^\$\{?(\w+)\}?\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/.exec(text)
  if (literal) {
    vars.set(literal[1].toLowerCase(), literal[2] ?? literal[3] ?? "")
    return true
  }
  const join = /^\$\{?(\w+)\}?\s*=\s*Join-Path\s+(.+)$/i.exec(text)
  if (join) {
    const key = join[1].toLowerCase()
    const parts = []
    for (const raw of tokenizeCli(join[2])) {
      const token = raw.replace(/^["']|["']$/g, "")
      if (!token || token.startsWith("-")) {
        vars.delete(key)
        return true
      }
      parts.push(token)
    }
    if (parts.length) vars.set(key, parts.join("\\").replace(/\\{2,}/g, "\\"))
    else vars.delete(key)
    return true
  }
  const assignment = /^\$\{?(\w+)\}?\s*(?:=|\+=|-=|\*=|\/=)/.exec(text)
  if (assignment) {
    vars.delete(assignment[1].toLowerCase())
    // Nur ein Literal gilt als reine Bindung. Alles andere (Befehl, Aufruf,
    // .NET-Methode) wird weiter geprueft, sonst waere "$x = Remove-Item ..."
    // unsichtbar.
    const rhs = text.slice(assignment[0].length).trim()
    return /^(?:-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'|\$\{?\w+\}?|\$null|\$true|\$false)$/i.test(rhs)
  }
  return false
}

function hasStateChange(statement) {
  return ANY_LOCATION_RE.test(statement) || ASSIGNMENT_RE.test(statement)
}

// Zuweisung vor dem Befehl: "$null = Remove-Item ..." hat den Befehl hinter dem
// "=". Ohne diesen Schnitt erkennt die Ziel- und Loeschpruefung ihn nicht, weil
// der Befehl nicht am Segmentanfang steht. Nur fuer die Schreibzielpruefung
// gedacht; die Variablenkarte bleibt unveraendert.
function stripAssignment(statement) {
  return String(statement).replace(/^\s*\$[\w:]+(?:\.\w+)*\s*(?:[+\-*/])?=\s*/, "")
}

// Geschuetzte Pfade an einer Stelle: Geheimnisablagen im Benutzerprofil, die
// Konfiguration der Agenten, Systemordner und das eigene .git des Projekts.
// Shell-Schreibpruefung (scopeWrites) und Edit-Pruefung (scopeEdit) nutzen
// dieselbe Liste, damit die beiden Wege nicht auseinanderlaufen.
// base ist bereits aufgeloest (normPath).
function deniedRoots(base, opts) {
  const denied = []
  if (opts.home) {
    const home = normPath(opts.home)
    for (const rel of [".ssh", ".aws", ".gnupg", ".kube", ".claude", ".codex", ".opencode", ".gitconfig", ".git-credentials", ".config\\opencode", ".local\\share\\opencode"]) {
      denied.push(normPath(`${home}\\${rel}`))
    }
  }
  for (const fixed of ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata"]) denied.push(fixed)
  if (base) denied.push(normPath(`${base}\\.git`))
  // Ein Block kann in einem Unterordner laufen; die Schutzwurzel des
  // urspruenglichen Projekts bleibt trotzdem gesperrt.
  if (opts.protectedBase) denied.push(normPath(`${opts.protectedBase}\\.git`))
  return denied
}

// Ziele, die die Schreibfreigabe nicht mitdeckt (Nutzerentscheid 18.11.2026).
// Hooks, CI-Workflows und die Konfiguration des Guards entscheiden ueber
// spaetere Pruefungen mit; eine Aenderung dort bleibt deshalb Rueckfrage. Der
// Grund beginnt bewusst mit keinem deny-Praefix ("ausserhalb des Projekts",
// "geschuetzter Pfad", "rekursiv auf", "unpruefbar:"), damit evaluate() daraus
// ein "ask" macht. ".git" steht schon in deniedRoots und bleibt dort "deny";
// es steht hier nur, damit die Liste vollstaendig lesbar ist.
const ASK_ONLY_DIRS = new Set([".git", ".githooks", ".github"])
const ASK_ONLY_FILES = new Set(["shell-reviewer.config.json", "opencode.jsonc"])

// Ein Ziel in einem dieser Ordner oder mit einem dieser Namen liefert den
// Grund, sonst null. Pfade sind bereits normPath't (klein, ohne Endtrenner).
function writeAskOnly(abs, base) {
  if (isUnder(abs, base)) {
    for (const part of abs.slice(base.length).split("\\")) {
      if (ASK_ONLY_DIRS.has(part)) return `geschuetzte Ablage ${part}`
    }
  }
  const name = String(abs).split("\\").pop()
  if (ASK_ONLY_FILES.has(name)) return "Konfigurationsdatei"
  return null
}

function scopeWrites(statements, options) {
  const opts = options ?? {}
  const emptyVars = new Map()
  const logicalBase = opts.base ? resolveTarget(opts.base, opts, null, emptyVars) : null
  const base = logicalBase ? physicalPath(logicalBase) : null
  if (!base) return { ok: false, reason: "Arbeitsordner unbekannt" }

  const roots = [...(opts.roots ?? []), opts.base]
    .filter(Boolean)
    .map((root) => resolveTarget(root, opts, null, emptyVars))
    .filter(Boolean)
    .map((root) => physicalPath(root))
    .filter(Boolean)
  if (!roots.length) return { ok: false, reason: "keine vertrauten Ordner" }

  const denied = deniedRoots(base, opts).map((root) => physicalPath(root)).filter(Boolean)

  // Jede Anweisung wird in Ausfuehrungsreihenfolge mit dem dann gueltigen
  // Arbeitsordner und den dann gueltigen Bindungen geprueft. Kontrollfluss,
  // Location-Stack und unaufloesbare Bindungen werden verweigert.
  let cwd = base
  const vars = new Map()
  let braceDepth = 0

  for (const statement of statements) {
    const text = statement.trim()
    if (!text) continue

    if (LOCATION_STACK_RE.test(text)) {
      return { ok: false, reason: `unpruefbar: Location-Stack: ${text.slice(0, 60)}` }
    }

    const masked = stripStrings(text).replace(/\$\{[^}]*\}/g, "$VAR$")
    const open = (masked.match(/{/g) ?? []).length
    const close = (masked.match(/}/g) ?? []).length
    const control = CONTROL_STATEMENT_RE.test(text)
    if ((braceDepth > 0 || open > 0 || control) && hasStateChange(text)) {
      return { ok: false, reason: `unpruefbar: Kontrollfluss mit Zustandsaenderung: ${text.slice(0, 60)}` }
    }

    if (updateVarMap(text, vars)) {
      braceDepth = Math.max(0, braceDepth + open - close)
      continue
    }

    const cd = CD_RE.exec(text)
    if (cd) {
      const next = resolveTarget(cd[1] ?? cd[2] ?? cd[3], opts, cwd, vars)
      if (!next) return { ok: false, reason: `unpruefbar: Arbeitsordner unklar: ${cd[1] ?? cd[2] ?? cd[3]}` }
      cwd = physicalPath(next)
      if (!cwd) return { ok: false, reason: "unpruefbar: Arbeitsordner unklar" }
      braceDepth = Math.max(0, braceDepth + open - close)
      continue
    }

    braceDepth = Math.max(0, braceDepth + open - close)

    // Der Block braucht denselben Aufloesungskontext wie die erste Pruefung:
    // ohne ihn fiele eine Umleitung hinter dem Block aus der Zielpruefung.
    if (classifyStatement(text, { opts, vars, cwd }) !== "filewrite") continue
    // Der Befehl ohne Zuweisung ("$null = Remove-Item ...") fuer Loesch- und Zielpruefung.
    const command = stripAssignment(text)
    const deletion = deletionCommand(command) !== null
    const targets = extractTargets(command, vars)
    if (!targets || !targets.length) {
      return { ok: false, reason: `unpruefbar: Ziel unklar: ${text.slice(0, 60)}` }
    }

    const resolved = []
    for (const target of targets) {
      const logicalAbs = resolveTarget(target, opts, cwd, vars)
      const abs = logicalAbs ? physicalPath(logicalAbs) : null
      if (!abs) {
        // Platzhalter bleiben eine Rueckfrage; unaufloesbare Bindungen werden
        // dagegen verweigert (Nutzerentscheid 10.11.2026).
        if (/[*?[\]]/.test(target)) {
          if (deletion) return { ok: false, reason: `Loeschen: Platzhalter-Ziel: ${target}` }
          return { ok: false, reason: `Ziel unklar: ${target.slice(0, 60)}` }
        }
        return { ok: false, reason: `unpruefbar: Pfad nicht bestimmbar: ${target.slice(0, 60)}` }
      }
      resolved.push(abs)
    }

    const approvedRuffTargets = approvedRuffBootstrapTargets(statement, resolved, opts, base)
    for (const abs of resolved) {
      if (denied.some((root) => isUnder(abs, root))) return { ok: false, reason: `geschuetzter Pfad: ${abs}` }
      if (!roots.some((root) => isUnder(abs, root)) && !approvedRuffTargets.has(abs)) {
        return { ok: false, reason: `ausserhalb des Projekts: ${abs}` }
      }
    }

    // Freigabe nur fuer einfache Schreibvorgaenge im Projekt. Hooks, CI-
    // Workflows und die Konfiguration des Guards sind ausgenommen; sie bleiben
    // Rueckfrage (Nutzerentscheid 18.11.2026).
    for (const abs of resolved) {
      const askWhy = writeAskOnly(abs, base)
      if (askWhy) return { ok: false, reason: `${askWhy}: ${abs}` }
    }

    const flags = deletionFlags(command)
    const recursive = /-Recurse\b/i.test(command)
      || /\brm\s+-[a-z]*r/i.test(command)
      || (flags !== null && flags.has("recurse"))
    if (recursive) {
      for (const abs of resolved) {
        if (abs === cwd || isUnder(cwd, abs)) return { ok: false, reason: `rekursiv auf ${abs}` }
      }
    }

    if (deletion) {
      const why = deletionEscalation(statement, targets, flags)
      if (why) return { ok: false, reason: `Loeschen: ${why}` }
    }
  }

  return { ok: true, reason: "Schreiben in vertrautem Ordner" }
}

/**
 * Prueft die Zieldateien eines Edit-Aufrufs (OpenCode meldet edit/write/patch
 * als action "edit" und nennt die Dateien in resources). Gedacht fuer das
 * "ask" der statischen Regeln; allow und deny dort bleiben unberuehrt.
 *
 * Dieselbe Abstufung wie die Shell-Schreibpruefung: Ziele in vertrauten
 * Ordnern sind erlaubt, geschuetzte Pfade und Ziele ausserhalb werden
 * verweigert. Platzhalter bleiben Rueckfrage, unaufloesbare Pfade werden
 * verweigert; ein fehlender Projektbezug bleibt Rueckfrage.
 *
 * Mehrere Ziele: ein deny schlaegt alles, sonst gilt ask, sonst allow.
 *
 * @param {string[]} resources Zieldateien des Aufrufs
 * @param {{base?: string, roots?: string[], home?: string, temp?: string, appData?: string}} [options]
 * @returns {{decision: "allow" | "ask" | "deny", reason: string}}
 */
export function scopeEdit(resources, options = {}) {
  const opts = options ?? {}
  const emptyVars = new Map()
  const logicalBase = opts.base ? resolveTarget(opts.base, opts, null, emptyVars) : null
  const base = logicalBase ? physicalPath(logicalBase) : null
  if (!base) return { decision: "ask", reason: "Arbeitsordner unbekannt" }

  const roots = [...(opts.roots ?? []), opts.base]
    .filter(Boolean)
    .map((root) => resolveTarget(root, opts, null, emptyVars))
    .filter(Boolean)
    .map((root) => physicalPath(root))
    .filter(Boolean)
  if (!roots.length) return { decision: "ask", reason: "keine vertrauten Ordner" }

  const denied = deniedRoots(base, opts).map((root) => physicalPath(root)).filter(Boolean)
  const targets = Array.isArray(resources) ? resources : []
  if (!targets.length) return { decision: "ask", reason: "kein Ziel" }

  let ask = null
  let deny = null
  for (const target of targets) {
    if (typeof target !== "string" || !target.trim()) {
      // Leere oder fremdartige Ressourcen nicht still verwerfen; andere Ziele
      // werden trotzdem geprueft und ein deny behaelt Vorrang.
      ask ??= { decision: "ask", reason: "kein Ziel" }
      continue
    }
    const logicalAbs = resolveTarget(target, opts, base, emptyVars)
    const abs = logicalAbs ? physicalPath(logicalAbs) : null
    if (!abs) {
      // Wie in scopeWrites: Platzhalter fragen nach, unaufloesbare Pfade
      // werden verweigert.
      if (/[*?[\]]/.test(target)) {
        ask ??= { decision: "ask", reason: "Ziel unklar" }
      } else {
        deny ??= { decision: "deny", reason: "unpruefbar: Pfad nicht bestimmbar" }
      }
      continue
    }
    if (denied.some((root) => isUnder(abs, root))) {
      deny ??= { decision: "deny", reason: "geschuetzter Pfad" }
      continue
    }
    if (!roots.some((root) => isUnder(abs, root))) {
      deny ??= { decision: "deny", reason: "ausserhalb des Projekts" }
      continue
    }
    // Dieselbe Rueckfrage-Klasse wie im Shell-Weg (scopeWrites): Hooks,
    // CI-Workflows und Guard-Konfiguration werden nicht ohne Nachfrage
    // geaendert. deny behält Vorrang, weil deny vor ask geprueft wird und
    // kein fruehes return die Reihenfolge der Ziele entscheiden lässt.
    const askOnly = writeAskOnly(abs, base)
    if (askOnly) ask ??= { decision: "ask", reason: askOnly }
  }
  if (deny) return deny
  if (ask) return ask
  return { decision: "allow", reason: "Schreiben in vertrautem Ordner" }
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
// Unbekannte Flags (Encoding, Redirects) sind unbedenklich; der
// Header-Inhalt ist es nicht (siehe NET_SAFE_HEADERS).
const NET_CMD_NAMES = new Set(["invoke-webrequest", "invoke-restmethod", "iwr", "irm"])
const NET_BLOCK_FLAGS = new Set([
  "-outfile", "-infile", "-body", "-form",
  "-credential", "-token", "-certificate", "-certificatethumbprint",
])
const NET_SAFE_METHODS = new Set(["get", "head"])

// PowerShell nimmt eindeutige Abkuerzungen von Parameternamen an (-M, -B, -OutF).
// Ein Flag, das Praefix eines gesperrten Parameters ist, gilt deshalb als dieser
// Parameter. -M kann auch -MaximumRedirection sein; dann wird der Wert als
// Methode geprueft und scheitert bei jedem Nicht-GET (fail closed).
const NET_METHOD_FLAG = "-method"
function netFlagKind(flag) {
  if (!flag.startsWith("-") || flag.length < 2) return null
  if (NET_BLOCK_FLAGS.has(flag)) return "block"
  for (const blocked of NET_BLOCK_FLAGS) if (blocked.startsWith(flag)) return "block"
  if (NET_METHOD_FLAG.startsWith(flag)) return "method"
  return null
}

// Header, die Geheimnisse tragen oder Datenabfluss möglich machen. Nur die
// harmlosen lesenden Header bleiben zulässig; jeder unbekannte Headername
// oder Variablenwert fragt konservativ nach.
const NET_SAFE_HEADERS = new Set(["accept", "accept-encoding", "accept-language", "content-type", "user-agent"])
const NET_SECRET_HEADERS = new Set(["authorization", "cookie", "x-api-key"])

// Hashtabellen aus dem Befehlstext (mit Zitaten) herausloesen. Eintraege
// trennt ein Semikolon ausserhalb von Zeichenketten und verschachtelten
// Abschnitten; ein Semikolon in einem Wert bleibt Teil des Werts. Ein "@{"
// in einer Zeichenketten-URL zaehlt NICHT als Hashtable (zitierter Text ist
// Datenmaterial, keine Ausfuehrung).
function rawHashtableTables(statement) {
  const source = String(statement ?? "")
  const out = []
  let quote = null
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (quote) {
      if (quote === '"' && ch === "`") { i += 2; continue }
      if (ch === quote) {
        if (source[i + 1] === quote) { i += 2; continue }
        quote = null
      }
      i++
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; i++; continue }
    if (ch === "@" && source[i + 1] === "{") {
      const start = i
      let depth = 1
      let innerQuote = null
      let j = i + 2
      while (j < source.length && depth > 0) {
        const c = source[j]
        if (innerQuote) {
          if (innerQuote === '"' && c === "`") { j += 2; continue }
          if (c === innerQuote) {
            if (source[j + 1] === innerQuote) { j += 2; continue }
            innerQuote = null
          }
        } else if (c === "'" || c === '"') innerQuote = c
        else if (c === "{") depth++
        else if (c === "}") depth--
        j++
      }
      out.push({ start, end: j, body: source.slice(start + 2, Math.max(start + 2, j - 1)) })
      i = Math.max(j, start + 2)
      continue
    }
    i++
  }
  return out
}

// Token-Spannen wie tokenizeCli, aber mit Quellpositionen. Das verbindet
// ein Token mit seiner echten Stelle im Befehlstext.
function statementTokenSpans(statement) {
  const source = String(statement ?? "")
  const out = []
  let current = ""
  let start = null
  let quote = null
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (quote === '"' && ch === "`") {
        if (i + 1 < source.length) current += source[i++]
        continue
      }
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; if (start === null) start = i; continue }
    if (/\s/.test(ch)) {
      if (start !== null) out.push({ start, end: i })
      current = ""
      start = null
      continue
    }
    if (start === null) start = i
    current += ch
  }
  if (start !== null) out.push({ start, end: source.length })
  return out
}

function splitHashtableEntries(body) {
  const out = []
  let current = ""
  let quote = null
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      current += ch
      if (ch === quote) {
        if (body[i + 1] === quote) current += body[++i]
        else quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue }
    if (ch === "{" || ch === "(" || ch === "[") depth++
    if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1)
    if (ch === ";" && depth === 0) { out.push(current); current = ""; continue }
    current += ch
  }
  if (current.trim()) out.push(current)
  return out
}

function headersAreHarmless(tokens, startIndex, statement) {
  // Die Rohform aus dem Befehlstext ist massgeblich, damit beide
  // Eintraege einer Hashtable geprueft werden (auch ohne Leerzeichen
  // um das Semikolon). Die Tabelle ist diejenige, die an der Stelle des
  // aktuellen Tokens beginnt (zitierter "@{…}"-Text in einer URL zaehlt
  // nicht). Mehrdeutiges (keine Tabelle an dieser Stelle) bleibt Rueckfrage.
  const spans = statementTokenSpans(statement)
  const span = spans[startIndex]
  const tables = rawHashtableTables(statement)
  const rawBody = tables.find((table) => span && table.start >= span.start && table.start < span.end)?.body
    ?? tables.find((table) => span && table.start >= span.start)?.body
  if (rawBody === undefined) return false
  const body = rawBody.toLowerCase()
  if (!body.trim()) return false
  const keys = []
  for (const entry of splitHashtableEntries(body)) {
    const eq = entry.indexOf("=")
    if (eq < 0) return false
    const key = entry.slice(0, eq).trim().replace(/^["']|["']$/g, "").toLowerCase()
    if (!/^[a-z0-9-]+$/.test(key)) return false
    keys.push(key)
    const value = entry.slice(eq + 1).trim()
    // Variablenwerte (auch numerische wie $1 und ${...}), Teilausdruecke
    // und verschachtelte Abschnitte bleiben unlesbar und damit Rueckfrage.
    if (/(\$|env:|\()/i.test(value)) return false
  }
  if (!keys.length) return false
  if (keys.some((key) => NET_SECRET_HEADERS.has(key))) return false
  if (keys.some((key) => !NET_SAFE_HEADERS.has(key))) return false
  return true
}

function isHeadersParameter(flag) {
  // PowerShell nimmt eindeutige Abkuerzungen an: -He, -Head, -Hea, …
  return flag.length >= 3 && "-headers".startsWith(flag)
}

function classifyNetwork(statement, ctx) {
  const markDanger = () => { if (ctx) ctx.dangerParam = true }
  const tokens = tokenizeCli(statement)
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    const lowerT = t.toLowerCase()
    // PowerShell schreibt Parameter auch mit Doppelpunkt: -OutFile:C:\x.
    // Nur Tokens mit Fuehrungsstrich zaehlen als Parameter; URLs und Pfade
    // als Wert bleiben unberuehrt.
    let eq = -1
    if (t.startsWith("-")) {
      const eqIndex = lowerT.indexOf("=")
      const colonIndex = lowerT.indexOf(":")
      eq = [eqIndex, colonIndex].filter((n) => n > 0).sort((a, b) => a - b)[0] ?? -1
    }
    const flag = eq > 0 ? lowerT.slice(0, eq) : lowerT
    const kind = netFlagKind(flag)
    if (kind === "block") { markDanger(); return "unknown" }
    if (kind === "method") {
      const value = (eq > 0 ? lowerT.slice(eq + 1) : (tokens[i + 1] ?? "")).toLowerCase()
      if (!value || value.startsWith("-") || !NET_SAFE_METHODS.has(value)) { markDanger(); return "unknown" }
      if (eq <= 0) i++ // Wert steht als eigenes Token; wird mitgenommen
      continue
    }
    if (isHeadersParameter(flag)) {
      // An den Wert als Ganzes gebunden ("-Headers:@{…}", auch "-He:$h")
      // oder als eigenes Token ("-Headers @{…}", auch "-He $h"). Eine
      // Variable oder jede nicht lesbare Form ist Rueckfrage ohne Modellweg.
      const attached = eq > 0 ? lowerT.slice(eq + 1) : null
      if (attached !== null && attached !== "") {
        if (!attached.startsWith("@{")) { markDanger(); return "unknown" }
        if (!headersAreHarmless([t.slice(eq + 1)], 0, statement)) { markDanger(); return "unknown" }
        continue
      }
      const next = tokens[i + 1] ?? ""
      if (!next.startsWith("@{")) { markDanger(); return "unknown" }
      continue // die Hashtabelle prueft der naechste Durchlauf
    }
    if (/^@\w+$/.test(t)) { markDanger(); return "unknown" } // Splatting: Inhalt unbekannt
    if (t.startsWith("@{")) {
      // Nur als Parameterwert von -Headers sichtbar; der Inhalt entscheidet.
      const prevRaw = (tokens[i - 1] ?? "").toLowerCase()
      const prev = prevRaw.split(/[:=]/)[0]
      if (!isHeadersParameter(prev)) { markDanger(); return "unknown" }
      if (!headersAreHarmless(tokens, i, statement)) { markDanger(); return "unknown" }
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
    if (module === "pytest") {
      // "--basetemp" loescht das Zielverzeichnis in jeder Schreibweise
      // (getrennt, mit "=" oder mit ":"); es bleibt Rueckfrage. Andere
      // pytest-Optionen werden nicht geraten (offen, siehe PLANUNG.md).
      const rest = tokens.slice(i + 2).map((t) => t.toLowerCase())
      if (rest.some((t) => t === "--basetemp" || t.startsWith("--basetemp=") || t.startsWith("--basetemp:"))) {
        if (ctx) ctx.dangerParam = true
        return "unknown"
      }
      return "read"
    }
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
  // Fuer Skills gilt seit 05.11.2026 allein die Urteilsdatei: jedes Skript
  // unter `~/.agents/skills` ist Rueckfrage, solange kein Eintrag mit
  // `decision: "trust"` und passendem Hash vorliegt. Die frueher hier
  // eingebaute Namensliste ist entfallen - sie haette eine Freigabe auch dann
  // gehalten, wenn das Pruefprotokoll zu `ask` kommt.
  if (!opts.base) return "unknown"
  const rawArg = tokens[i]
  const expanded = expandLeadVar(rawArg, ctx?.vars)
  const abs = resolveTarget(expanded, opts, ctx?.cwd ?? null, ctx?.vars)
  // Ein Variablenbezug ohne (noch) gueltige Bindung ist unaufloesbar. Die
  // Rueckfrage dafuer darf das Modell nicht auf allow heben (varUnclear).
  if (!abs && ctx && /\$\{?\w/.test(rawArg)) ctx.varUnclear = true
  if (!abs) return "unknown"
  const roots = [normPath(opts.base)]
  const gitDirs = [normPath(`${opts.base}\\.git`)]
  if (opts.home) gitDirs.push(normPath(`${opts.home}\\.agents\\.git`))
  if (!roots.some((root) => isUnder(abs, root)) && skillVerdict(abs, opts) !== true) return "unknown"
  if (gitDirs.some((dir) => isUnder(abs, dir))) return "unknown"
  if (!/\.py$/.test(abs)) return "unknown"
  return "read"
}

// Urteilsdatei (Nutzerentscheid 05.11.2026): SkillSpector-Berichte und
// Pruefprotokolle werden vorab zu einer Datei verdichtet
// (~/.agents/skill-reviews/verdicts.json, erzeugt von skill-verdicts.mjs).
// Der Guard liest sie nur. Vertraut wird ein Skript ausschliesslich bei
// decision "trust" **und** passendem SHA256 der Datei: eine geaenderte oder
// neu hinzugekommene Datei ist nicht gedeckt und bleibt Rueckfrage. Die
// statische Liste bleibt die Untergrenze, die Datei kann sie nur erweitern.
const VERDICT_SCHEMA = 1

function loadSkillVerdicts(file) {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"))
    if (data?.schema !== VERDICT_SCHEMA || !data.skills || typeof data.skills !== "object") return null
    const entries = new Map()
    for (const [name, entry] of Object.entries(data.skills)) {
      if (!entry || typeof entry !== "object") continue
      if (entry.decision !== "trust") continue
      if (!entry.sha256 || typeof entry.sha256 !== "object") continue
      entries.set(name.toLowerCase(), entry)
    }
    return entries
  } catch {
    return null // fehlende oder unlesbare Datei: es gilt allein die statische Liste
  }
}

// true = durch Urteilsdatei gedeckt, false = Datei vorhanden, Skript nicht
// gedeckt, null = keine Urteilsdatei (oder Ziel ausserhalb der Skill-Ordner).
function skillVerdict(abs, opts) {
  if (!opts?.home) return null
  const skills = normPath(`${opts.home}\\.agents\\skills`)
  if (!isUnder(abs, skills)) return null
  const rest = abs.slice(skills.length + 1)
  const slash = rest.indexOf("\\")
  if (slash <= 0) return null
  const entries = loadSkillVerdicts(`${opts.home}\\.agents\\skill-reviews\\verdicts.json`)
  if (!entries) return null
  const entry = entries.get(rest.slice(0, slash))
  if (!entry) return false
  const want = entry.sha256[rest.slice(slash + 1).replace(/\\/g, "/")]
  if (typeof want !== "string" || !/^[a-f0-9]{64}$/i.test(want)) return false
  try {
    return createHash("sha256").update(readFileSync(abs)).digest("hex") === want.toLowerCase()
  } catch {
    return false
  }
}

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
  const rawArg = tokens[1] ?? ""
  const arg = expandLeadVar(rawArg, ctx?.vars)
  if (!arg || arg.startsWith("-")) return "unknown"
  const abs = resolveTarget(arg, opts, ctx?.cwd ?? null, ctx?.vars)
  if (!abs && ctx && /\$\{?\w/.test(rawArg)) ctx.varUnclear = true
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
    // Angehängte Kurzformen ("-ftitle=demo", "-XPOST"): "-f"/"-F" schalten
    // wie die getrennte Form auf POST um, "-X" traegt die Methode im Token.
    if (/^-[fx]/.test(token) && !token.startsWith("--")) {
      const flag = token.slice(0, 2)
      if (flag === "-f" || flag === "-F") {
        if (token.length > 2) return false
      } else if (flag === "-x" && token.length > 2 && token[2] !== "=") {
        if (!GH_READ_METHODS.has(token.slice(2).toUpperCase())) return false
        continue
      }
    }
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

function classifyGh(statement, ctx) {
  const tokens = tokenizeCli(statement)
  const args = tokens.slice(1).filter((a) => !a.startsWith("-"))
  if (args.length < 2) return "unknown"
  const sub = `${args[0].toLowerCase()} ${args[1].toLowerCase()}`
  if (sub === "auth status" || sub === "repo view") return "read"
  if (args[0].toLowerCase() !== "api") return "unknown"
  // `gh api graphql` ist immer POST. args[1] ist der Endpunkt-Pfad, weil
  // Flag-Werte bei der Argumentliste entfernt wurden.
  if (args[1].toLowerCase() === "graphql") { if (ctx) ctx.dangerParam = true; return "unknown" }
  const readOnly = ghApiIsReadOnly(tokens)
  if (!readOnly && ctx) ctx.dangerParam = true
  return readOnly ? "read" : "unknown"
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
 * @returns {{decision: "allow" | "ask" | "deny", reason: string, message?: string}}
 */
// Kommentar ab "#" entfernen, aber nur ausserhalb von Anfuehrungszeichen. Ein
// "#" in einem String ("a # b") ist Text; der fruehere Schnitt verbarg den Rest
// der Zeile vor allen Pruefungen. Ein offenes Zitat laesst den Rest stehen
// (fail closed: mehr Text bleibt sichtbar).
function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (quote === '"' && ch === "`") { i++; continue }
      if (ch === quote) {
        if (line[i + 1] === quote) { i++; continue }
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

// Teilausdruecke, die PowerShell beim Auswerten ausfuehrt: $( ... ) auch in
// doppelt gequoteten Strings sowie @( ... ) und @{ ... }. stripStrings wuerde
// sie sonst verbergen. Ein nicht geschlossener Ausdruck liefert keinen Teil
// und bleibt bei der normalen Pruefung.
function subexpressions(script, includeParentheses = false) {
  const found = []
  // @( und @{ nur als Literal: ein vorangehendes Wort-, Klammer- oder
  // Ref-Zeichen macht es zu einem Index (stash@{0}) oder zu einer Refkurzform
  // (HEAD@{u}); in einem String fuehrt PowerShell kein @( aus, nur $( - und
  // das bleibt von dieser Ausnahme unberuehrt.
  const collect = (start) => {
    let depth = 1
    const prefixQuotes = []
    for (let j = 0; j < start; j++) {
      const ch = script[j]
      const quote = prefixQuotes[prefixQuotes.length - 1]
      if (quote) {
        if (quote === '"' && ch === "`") { j++; continue }
        if (ch === quote) {
          if (script[j + 1] === quote) { j++; continue }
          prefixQuotes.pop()
        }
      } else if (ch === '"' || ch === "'") prefixQuotes.push(ch)
    }
    // Die aeussere String-Schicht ist beim $( bereits bekannt. Sie darf die
    // schliessende Klammer nicht verdecken; verschachtelte Zitate im Code
    // werden dagegen weiterhin ignoriert.
    let outerQuote = prefixQuotes[prefixQuotes.length - 1] ?? null
    const nestedQuotes = []
    let i = start
    for (; i < script.length && depth > 0; i++) {
      const ch = script[i]
      const quote = nestedQuotes[nestedQuotes.length - 1]
      if (quote) {
        if (quote === '"' && ch === "`") { i++; continue }
        if (ch === quote) {
          if (script[i + 1] === quote) { i++; continue }
          nestedQuotes.pop()
        }
        continue
      }
      // Ein inneres Anfuehrungszeichen kann dem äußeren entsprechen. Es ist
      // erst dann die äußere String-Schicht, wenn unmittelbar die schliessende
      // Klammer folgt; "safe" im Teilausdruck oeffnet stattdessen ein Zitat.
      if (outerQuote && ch === outerQuote && /^\s*[)}]/.test(script.slice(i + 1))) { outerQuote = null; continue }
      if (ch === '"' || ch === "'") { nestedQuotes.push(ch); continue }
      if (ch === "(" || ch === "{") depth++
      else if (ch === ")" || ch === "}") depth--
    }
    if (depth === 0) found.push(script.slice(start, i - 1))
  }
  const re = /\$\(|(?<![\w)\]}."'])@[({]/g
  let m
  while ((m = re.exec(script)) !== null) collect(m.index + m[0].length)

  // Gewoehnliche Klammerausdruecke nur in Pipeline-Bloecken und ausserhalb
  // von Strings: `(Set-Content ...)` ist Code, "(...)" in Prosa ist Text.
  if (includeParentheses) {
    const { masked } = maskStrings(script)
    const paren = /(?<![\w$@])\(/g
    let match
    while ((match = paren.exec(masked)) !== null) collect(match.index + 1)
  }
  return found
}

export function evaluate(script, options = {}) {
  const raw = String(script ?? "")
  if (!raw.trim()) return { decision: "ask", reason: "leer" }

  for (const rx of DENY_COMMANDS) {
    if (rx.test(raw)) return { decision: "deny", reason: `destruktiv: ${rx.source}` }
  }

  // Teilausdruecke werden wie eigene Skripte bewertet. Alle werden gelesen:
  // ein spaetes deny darf nicht hinter einem fruehen ask verschwinden.
  let subexpressionAsk = null
  for (const inner of subexpressions(raw)) {
    const r = evaluate(inner, options)
    // Keine Befehlswerte im Grund: der innere Grund enthaelt den
    // Teilausdruck und damit Moeglichkeiten Geheimnisse - Diagnose-Logs
    // duerfen ihn nicht aufnehmen.
    if (r.decision === "deny") {
      return { decision: "deny", reason: "Teilausdruck: unpruefbar", ...(r.message ? { message: r.message } : {}) }
    }
    if (r.decision !== "allow" && !subexpressionAsk) {
      subexpressionAsk = { decision: r.decision, reason: "Teilausdruck: unpruefbar", ...(r.message ? { message: r.message } : {}) }
    }
  }
  // Erst kurz vor einer moeglichen Freigabe anwenden: ein spaeteres deny in
  // den eigentlichen Anweisungen muss weiterhin Vorrang haben.
  let write = null
  let secrets = []
  const allowUnlessSubexpressionAsk = (reason) => {
    if (write) {
      const message = gitAskMessage(write, raw)
      return { decision: "ask", reason: `schreibend: ${write}`, ...(message ? { message } : {}) }
    }
    if (subexpressionAsk) return subexpressionAsk
    if (secrets.length) return { decision: "ask", reason: `Geheimnis: ${secrets.slice(0, 3).join(", ")}` }
    return { decision: "allow", reason }
  }
  // Ein Geheimnis-Ausdruck als Wert macht das Ziel unaufloesbar; das bleibt
  // eine Rueckfrage. Echte Pfadverbote werden davon nicht abgeschwaecht.
  const denyUnlessSecretValue = (reason) => {
    if (secrets.length && reason.startsWith("unpruefbar:")) {
      return { decision: "ask", reason: `Geheimnis: ${secrets.slice(0, 3).join(", ")}` }
    }
    return { decision: "deny", reason }
  }

  // Kommentare und Here-String-Inhalte sind Daten, keine Befehle.
  const text = stripHereStrings(raw)
    .split(/\r?\n/)
    .map((line) => stripComment(line))
    .join("\n")

  // Destruktive Git-Formen zuerst: Sie sollen auch dann verweigert werden,
  // wenn der Befehl erst hinter globalen Optionen sichtbar wird. Ein Treffer
  // bleibt "deny"; die Meldung nennt Muster und - ohne Geheimnisverdacht -
  // den Befehl.
  const destructiveGit = findDestructiveGit(text)
  if (destructiveGit) {
    return {
      decision: "deny",
      reason: destructiveGit.reason,
      message: gitRuleMessage(destructiveGit, raw),
    }
  }

  write = hasWriteVerb(stripStrings(text))
  const fileWrite = hasFileWriteVerb(stripStrings(text))

  if (write || fileWrite) {
    for (const rx of DENY_PATHS) {
      if (rx.test(text)) return { decision: "deny", reason: "Schreibzugriff auf Geheimnisablage" }
    }
  }
  // Netz, Prozesse, Registry, Git-Historie bleiben Rueckfrage, aber erst vor
  // einer Freigabe: ein gleichzeitiges Pfadverbot muss Vorrang behalten.

  const statements = splitStatements(text)

  // Aufloesungskontext fuer pfadverankerte Freigaben (node-/python-Skripte
  // und Pipeline-Bloecke): Bindungen werden sequenziell in
  // Ausfuehrungsreihenfolge verfolgt. Eine spaetere Zuweisung darf einen
  // frueheren Gebrauch nicht rueckwirkend gueltig machen; "$p = $x" loescht
  // die Bindung, und ein unaufloesbarer Variablenbezug bleibt Rueckfrage
  // ohne Modellweg (ctx.varUnclear). Eine Zuweisung in einem
  // Kontrollfluss (if/else/try/foreach/...) ist nicht nachverfolgbar —
  // ob sie laeuft, ist unbekannt —, deshalb verfaellt die Bindung der
  // betroffenen Variablen (fail closed). Ein Block darf nicht den erst
  // spaeter erreichten cd-Zustand erben. Misslingt ein cd-Ziel, wird
  // relative Pfadaufloesung ab dort abgestellt (fail closed).
  const vars = new Map()
  let cwd = resolveTarget(options.base, options, null, vars)
  const ctx = { opts: options, vars, cwd, varUnclear: false, dangerParam: false }
  let braceDepth = 0

  const kinds = new Set()
  const unknowns = []
  for (const st of statements) {
    const text = st.trim()
    if (text) {
      const masked = stripStrings(text).replace(/\$\{[^}]*\}/g, "$VAR$")
      const open = (masked.match(/{/g) ?? []).length
      const close = (masked.match(/}/g) ?? []).length
      // Die Schleifenvariable einer foreach-Zuweisung ist ebenfalls eine
      // nicht nachverfolgte Haltung: ihr Wert ist der aktuelle
      // Durchlaufswert und darf eine fruehere Bindung nicht ueberschreiben.
      const loop = /foreach\s*\(\s*(\$\{?\w+\}?)\s+in\b/i.exec(text)
      if (loop) vars.delete(loop[1].replace(/[$\{\}]/g, "").toLowerCase())
      if ((braceDepth > 0 || open > 0 || CONTROL_STATEMENT_RE.test(text)) && hasStateChange(text)) {
        for (const match of text.matchAll(/(\$\{?\w+\}?)\s*(?:=|\+=|-=|\*=|\/=)/g)) vars.delete(match[1].replace(/[$\{\}]/g, "").toLowerCase())
      }
      braceDepth = Math.max(0, braceDepth + open - close)
    }
    updateVarMap(st, vars)
    ctx.cwd = cwd
    const kind = classifyStatement(st, ctx)
    kinds.add(kind)
    if (kind === "unknown" || kind === "write") unknowns.push(st.slice(0, 80))
    const m = CD_RE.exec(st.trim())
    if (m) cwd = resolveTarget(m[1] ?? m[2] ?? m[3], options, cwd, vars)
  }

  // Nutzerentscheid 3 (22.10.2026, Abend): Aufrufe ueber & oder . verweigern
  // statt Rueckfrage. Die Zeile zeigt nur Namen von Variablen, nicht den
  // Inhalt - eine Frage liess sich so nicht begruendet beantworten. Die
  // Verweigerung schlaegt die Geheimnis-Rueckfrage, weil jede Form von
  // Nachfragen ohne lesbaren Inhalt unbrauchbar bleibt.
  if (kinds.has("deny")) {
    // Ein Block meldet seinen eigenen Grund; sonst bleibt es beim Aufruf &/.
    return { decision: "deny", reason: ctx.blockDeny ?? "unpruefbar: Aufruf ueber & oder ." }
  }

  secrets = findSecrets(raw)

  if (!statements.length) return allowUnlessSubexpressionAsk("nur Ausgabe")

  // Aussen-Schreiben verweigern, auch wenn der Rest unlesbar ist. Sonst ginge
  // der ganze Befehl an das Modell, das ihn auf allow heben koennte.
  if (kinds.has("filewrite")) {
    const early = scopeWrites(statements, options)
    if (!early.ok && /^(ausserhalb des Projekts|geschuetzter Pfad|rekursiv auf|unpruefbar:)/.test(early.reason)) {
      return denyUnlessSecretValue(early.reason)
    }
  }
  // Skriptblock (Review 17.11.2026): Der Block wurde als eigenes Skript
  // bewertet und ist nicht erlaubt. Rueckfrage mit dem Grund aus dem Block -
  // index.js befragt das Modell nur bei "nicht einordenbar", dieser Fall
  // erreicht es also nie.
  if (kinds.has("block")) {
    if (write || secrets.length || subexpressionAsk) {
      return allowUnlessSubexpressionAsk(ctx.blockAsk ?? "Skriptblock: eigener Code im Block nicht bewertet")
    }
    return { decision: "ask", reason: ctx.blockAsk ?? "Skriptblock: eigener Code im Block nicht bewertet" }
  }
  if (kinds.has("write") || kinds.has("unknown")) {
    // Unaufloesbare Variable und erkannte sende-/schreibende Parameter
    // (ctx.dangerParam: Netz-Block-Flag, gh-Senden, --basetemp,
    // vertraulicher Header) bleiben Rueckfrage ohne Modellweg. index.js
    // befragt das Modell nur bei "nicht einordenbar"; ein erkannter
    // Parameter darf nicht per Modell auf allow gehoben werden.
    // Keine Befehlswerte (Header-Schluessel/-Werte) im Grund: sie landen
    // im Diagnose-Log (index.js) und duerfen dort nicht stehen.
    const unknownReason = ctx.varUnclear
      ? "unpruefbar: Variable unklar"
      : ctx.dangerParam
        ? "unpruefbar: sende- oder schreibender Parameter"
        : `nicht einordenbar: ${unknowns[0] ?? ""}`
    if (write || secrets.length || subexpressionAsk) {
      return allowUnlessSubexpressionAsk(unknownReason)
    }
    return { decision: "ask", reason: unknownReason }
  }
  if (kinds.has("filewrite")) {
    const scoped = scopeWrites(statements, options)
    // Nutzerentscheid 25.10.2026: Schreiben ausserhalb des Projekts, in
    // geschuetzte Pfade oder rekursiv auf den Arbeitsordner wird nicht mehr
    // gefragt, sondern verweigert. Die Rueckfrage war die haeufigste
    // Unterbrechung und liess sich ohne lesbaren Pfad nicht begruenden.
    // Unklare Bindungen sowie nicht aufloesbarer Kontrollfluss/Location-Stack
    // werden ebenfalls verweigert. Nur ein fehlender Projektbezug
    // ("Arbeitsordner unbekannt", "keine vertrauten Ordner") bleibt "ask".
    if (!scoped.ok && /^(ausserhalb des Projekts|geschuetzter Pfad|rekursiv auf|unpruefbar:)/.test(scoped.reason)) {
      return denyUnlessSecretValue(scoped.reason)
    }
    if (!scoped.ok) {
      if (write || secrets.length || subexpressionAsk) return allowUnlessSubexpressionAsk(scoped.reason)
      return { decision: "ask", reason: scoped.reason }
    }
    const reason = kinds.has("localwrite") ? `${scoped.reason} + git add/commit` : scoped.reason
    return allowUnlessSubexpressionAsk(reason)
  }
  if (kinds.has("localwrite")) {
    return allowUnlessSubexpressionAsk("git add/commit (lokal, umkehrbar)")
  }
  if (!kinds.size || [...kinds].every((k) => k === "noop")) {
    return allowUnlessSubexpressionAsk("nur Ausgabe")
  }
  return allowUnlessSubexpressionAsk("nur lesend")
}
