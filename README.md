# permission-guard

Dynamische Pfad- und Kommando-Prüfung für Shell-Aufrufe.

## Herkunft und Deploy

Quelle: `<Projekt>\tools\permission-guard\`.
Laufzeit: `$HOME\.config\opencode\plugin\permission-guard\` bzw.
`${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugin/permission-guard` unter
Linux und macOS.

Das Laufzeitverzeichnis ist bewusst schreibgeschützt (Permission `ask`): kein
Agent soll seine eigenen Regeln unbemerkt ändern können. Deshalb wird im Projekt
entwickelt und getestet, dann **einmal** deployt:

```powershell
cd "$HOME\Python-Projekte\AI+IDE-Hints"
pwsh -File .\tools\permission-guard\deploy.ps1          # Tests + Kopie + Hashvergleich
pwsh -File .\tools\permission-guard\deploy.ps1 -Check   # nur vergleichen
```

```sh
cd tools/permission-guard
./deploy.sh            # Tests + Kopie + Hashvergleich
./deploy.sh --check    # nur vergleichen
```

Unter Windows zeigt `$HOME` in Git Bash und WSL auf das Linux-Home, nicht auf
das Windows-Profil. Dort entweder `deploy.ps1` nehmen oder das Ziel setzen:
`PERMISSION_GUARD_TARGET=/mnt/c/Users/<name>/.config/opencode/plugin/permission-guard`
(WSL) bzw. `/c/Users/<name>/...` (Git Bash).

Eine Rückfrage für den gesamten Vorgang statt einer pro Speichervorgang.
Beide Deploy-Skripte deployen nicht, wenn `node test.mjs` fehlschlägt, und
melden jede Byte-Abweichung zwischen Quelle und Laufzeit. Die ortspezifische
`shell-reviewer.config.json` wird nur beim ersten Mal aus
`shell-reviewer.config.example.json` erzeugt und danach nie überschrieben.

Nicht per Junction oder Symlink verbinden: dann läge der Guard in einem Ordner
mit Schreibfreigabe und die Selbstschutzgrenze wäre weg.

## Als eigenes Repository veröffentlichen

Dieses Verzeichnis ist so geschnitten, dass es als Wurzel eines eigenen
Repositories funktioniert (`git init` hier, nicht im Monorepo):

| Datei | Zweck |
| --- | --- |
| `LICENSE` | MIT |
| `package.json` | `"type": "module"`, `npm test`, Node ≥ 20 |
| `.gitignore` | schließt `shell-reviewer.config.json`, Logs, `node_modules` aus |
| `deploy.sh` | POSIX-Gegenstück zu `deploy.ps1` |
| `deploy.ps1` | Windows, mit Testlauf und SHA256-Vergleich |

Beim Herauslösen mitnehmen: `.github/workflows/permission-guard.yml` aus dem
Monorepo an die neue Repo-Wurzel verschieben und den `working-directory`-Eintrag
entfernen. Der Workflow prüft auf Windows **und** Linux und bricht ab, wenn eine
Datei einen Benutzerpfad (`C:\Users\<name>`, `/Users/<name>`) oder ein
Schlüsselmuster üblicher Anbieter (OpenAI, OpenCode, GitHub, AWS) enthält.

Nicht ins Repository gehören: `shell-reviewer.config.json` (maschinenabhängig),
Logs und Messartefakte. Zugangsdaten werden ausschließlich über den in
`apiKeyEnv` genannten Variablennamen referenziert, nie als Wert.

Hinweis zur Einordnung: Der **Reviewer** ist allgemein nutzbar. Der **Guard**
ist eine bewusst meinungsstarke PowerShell-Policy mit Entscheidungen aus einem
konkreten Arbeitsablauf – als Referenzimplementierung wertvoll, als
allgemeingültiges Werkzeug nicht.


## Problem

Die statischen Regeln in `opencode.jsonc` matchen das **Präfix** des Befehls:

```jsonc
{ "action": "shell", "resource": "Get-ChildItem *", "effect": "allow" }
```

Ein Agent ruft aber fast nie `Get-ChildItem ...` auf, sondern:

```powershell
cd "C:\...\Projekt"
"=== Status ==="
git status
Get-ChildItem -Force | Select-Object Name
```

Der Befehl beginnt mit `cd`, also greift keine Regel, also `ask`. Ergebnis: eine
Rückfrage alle paar Sekunden, obwohl nichts geschrieben wird.

## Lösung

Das Plugin hängt an `permission.evaluate` und stuft ein **`ask` auf `allow`** hoch,
wenn das Skript nachweislich nur liest — oder nur in **vertraute Ordner** schreibt.
Es greift **nie** in `allow` oder `deny` ein — die statischen Regeln bleiben die
harte Grenze.

Vertraut sind genau zwei Orte:

- der Projektordner der Sitzung (`ctx.location.directory`)
- `%TEMP%\opencode`

Eine eng begrenzte Ausnahme erlaubt Installation und Aktualisierung der
geprüften Ruff-Benutzerbasis: `APPDATA\ruff` anlegen und ausschließlich
`staging/ruff-global-baseline.toml` nach `APPDATA\ruff\ruff.toml` kopieren.
`APPDATA` wird dadurch **nicht** als vertrauter Root freigegeben; andere Dateien,
Unterordner und Schreibbefehle bleiben verweigert.

Relative Pfade werden gegen den Projektordner aufgelöst; ein `cd <absolut>` im
Skript verschiebt den Bezugspunkt. Nur eindeutig zugewiesene Variablen
(`$f = "C:\p\x.txt"`) werden aufgelöst, alles andere bleibt `ask`.

Der globale Ladekontext ohne Projekt (Basis = Benutzerprofil) registriert sich
bewusst nicht, sonst wäre das ganze Profil vertraut.

## Was erlaubt wird

**Nur lesend:** Ein Skript wird erlaubt, wenn **jede** Anweisung eingeordnet
werden kann als:

- `Get-*`, `Test-Path`, `Resolve-Path`, `Measure-Object`, `Select-Object`,
  `Where-Object`, `ForEach-Object`, `Sort-Object`, `Group-Object`, `Format-*`,
  `Out-String`, `ConvertFrom/To-Json`, `Import-Csv`, `Select-String`,
  `Compare-Object`, `Write-Output`
- `git status|diff|log|show|branch|remote|rev-parse|ls-files|cat-file|stash show|config <key>`
- `rg`, `grep`, `find`, `ls`, `cat`, `head`, `tail`, `wc`, `diff`, `jq`
- `cd`, `Set-Location`, `Push-Location`, `Pop-Location`
- Zuweisungen, Ausdrücke auf Variablen, `[System.IO.File]::ReadAllText` & Co.
- `npm view|ls|outdated|search`
- Hilfe- und Versionsaufrufe: ein Programmname mit genau einem Hilfewort
  (`gitleaks --version`, `ruff --help`, `node --version`, `version` als Wort)
- Kontrollblöcke (`if`, `foreach`, `try`), deren Rumpf ebenfalls nur liest

**Schreibend im Projekt:** Zusätzlich erlaubt, wenn jedes Ziel auflösbar ist und
innerhalb eines vertrauten Ordners liegt:

| Befehl | Beispiel |
|---|---|
| `Set-Content`, `Add-Content`, `Out-File`, `Clear-Content` | `Set-Content CHANGELOG.md "..."` |
| `New-Item`, `mkdir` | `New-Item -ItemType Directory build` |
| `Remove-Item`, `del`, `rm` | `Remove-Item build -Recurse` |
| `Copy-Item`, `Move-Item`, `Rename-Item` | `Move-Item a.md b.md` |
| Umleitung in eine Datei | `git log > log.txt` |
| `[System.IO.File]::WriteAllText` / `AppendAllText` / `WriteAllBytes` | `WriteAllText("CHANGELOG.md", $row)` |
| `git add`, `git commit` (ohne `--amend`) | `git commit -m "..."` |
| `python -m ruff check --fix`, `python -m ruff format` | `python -m ruff format .` |

Ein `Remove-Item -Recurse` auf den Projektordner selbst (oder einen seiner
Elternordner) bleibt `ask`.

### Netz-Lesen: `Invoke-WebRequest` / `Invoke-RestMethod`

Nutzerentscheidung (22.10.2026): Beide Cmdlets (auch die Aliase `iwr`/`irm`)
gelten als **Lesen**, solange nichts gespeichert oder gesendet wird. Erlaubt nur
wenn gleichzeitig:

- kein `-OutFile`, `-InFile` (Dateiziel),
- keine Methode außer GET/HEAD (`-Method Post` und Co. bleiben `ask`),
- kein `-Body`, `-Form`.

Zusätzlich fail closed: Variablen-Splatting (`@params`, Inhalt unsichtbar) und
positionale Hashtables außerhalb von `-Headers @{ … }` sind unklar, ebenso
`-Credential`/`-Token`/`-Certificate` — damit verlässt mehr als die Anfrage
selbst den Rechner. Akzeptiertes Restrisiko der Entscheidung: eine GET-URL kann
Daten tragen; ohne Schreibziel führt aber nur die Anfrage selbst nach draußen.

### `python` eng freigegeben

`python` generell bleibt `ask`. Erlaubt sind genau zwei Formen:

| Form | Bewertung |
|---|---|
| `python -m pytest …` (auch `py -3.12 -m pytest …`) | Lesen — die Freigabe deckt bewusst auch die Testcode-Ausführung ab (Entscheidung) |
| `python -m ruff check …` ohne `--fix` | Lesen |
| `python -m ruff format …`, `check … --fix …` | Schreibend → Zielpfadprüfung wie oben (`ruff format D:\…` bleibt `ask`, Wildcards bleiben `ask`) |
| `python -m ruff format --check \|--diff` | Lesen |
| `python <skript>` mit Zielpfad **im Projekt** (Entscheidung 2) | Lesen — Skriptinhalt ist versioniert reviewbar; Parameter des Skripts werden nicht geprüft |
| alles andere (`python -c`, `python -m pip`, Skripte außerhalb des Projekts, `.git`, `python` ohne Zielskript) | `ask` |

### `.NET`-Methoden und Stringmaskierung (Punkt 8)

Der Klassifizierer unterscheidet jetzt zwischen Aussehen und Wirkung — belegt
aus dem Replay (Punkt 8 der PLANUNG), nicht geraten:

| Verhalten                                        | Beispiel                                          | Bewertung                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `>` innerhalb von String-Literalen               | `Write-Output "5 > 3"`                            | Prosa, keine Umleitung. Echte Umleitung (`"x" > f.txt`) greift weiter; geht ein Zitat nicht auf, gilt das Skript konservativ als schreibend                  |
| `[regex]::Replace(...)`                          | `[regex]::Replace($c, "<[^>]+>", " ")`            | Lesen im Speicher. `[IO.File]::Replace` bleibt schreibend                                                                                                    |
| Wert-Casts zu bekannten Lesetypen                | `[datetime]'2026-10-19T22:54:52Z'`                | Der Cast selbst ist nur Konvertierung; der Ausdruck dahinter wird normal bewertet. Unbekannte Typen (`[xml]`, `[scriptblock]`) bleiben `ask`                 |
| `[void]`-Cast                                    | `[void]$out.Append($c)`                           | Wirft nur den Rückgabewert weg; die Anweisung wird danach normal bewertet                                                                                    |
| Stream- und StringBuilder-Methoden auf Variablen | `$sr.ReadLine()`, `$sr.Close()`, `$sb.Append($c)` | `append`, `appendline`, `read`, `readline`, `readtoend`, `peek`, `close` in `SAFE_METHODS`. Schreibende Methoden (`.WriteLine()`, `.Write()`) fehlen bewusst |
| `Import-Csv`                                     | `Import-Csv data.csv`                             | Lesen, wie `Get-Content`                                                                                                                                     |

Wichtigste Lehre: „Zuweisungen als Präfix" (8.1 in der PLANUNG) war eine
falsche Vermutung — die Zuweisung selbst war nie das Problem.
`$ErrorActionPreference = 'Stop'` ist bereits `noop`; die 71 Rückfragen kamen
aus den Methoden-/Cast-Lücken oben in derselben Lesefamilie.

Bewusst **nicht** freigeschaltet, alle aus demselben Replay belegt:

| Form                                | Beispiel                                        | Grund                                                                                                        |
| ----------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Aufruf nutzerdefinierter Funktionen | `Read-Jsonc $p`, `Walk $obj`                    | Rumpf wäre für sich einordbar, aber der Aufruf selbst wird nicht aufgelöst — Nutzerentscheid 4: bleibt `ask`  |
| `& <befehl>` / Dot-Sourcing         | `& node $tp $src 2>&1`, `. .\init.ps1`          | Nutzerentscheid 3: **verweigert** (`deny`) — Ziel steckt in einer Variablen, die Zeile zeigt es nicht         |

### Interpreters-Freigaben (Nutzerentscheidungen 1 und 2, 22.10.2026, spät)

Beides ausdrückliche Nutzerentscheidungen, pfadverankert wie pytest:

| Fall                                                                                                                                                  | Bewertung                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `node tools/permission-guard/test.mjs`, `replay.mjs`, `analyze.mjs` — auch relativ, mit `2>&1`, nach `cd` oder mit eindeutig zugewiesenem Pfad-Präfix | Lesen — Selbstpflege des Guards, Inhalt versioniert                   |
| `python <skript>` mit Zielpfad innerhalb des Projekts (`*.py`), Parameter des Skripts ungeprüft                                                       | Lesen — Inhalt ist versioniert und damit vor der Ausführung reviewbar |
| `python -c`, `python -m <anderes>`, `python` ohne Zielskript (REPL)                                                                                   | `ask` — Inline-Code ist für das Review unsichtbar                     |
| Skripte außerhalb des Projekts (Temp-Ordner) und `<Projekt>\.git`                                                                                     | `ask` — außerhalb des reviewten Umkreises                             |
| `node` mit fremdem Skript, `--eval`, `--version`, nackter Aufruf; `deno`, `ruby`, `perl`                                                              | `ask` — nur die drei benannten Selbst-Skripte sind freigegeben        |

Aufgelöst wird gegen den Arbeitsordner der Sitzung, ein `cd` im selben Skript
folgt mit; Misslingen eines `cd`-Ziels stellt relative Auflösung ab (fail
closed).

### Verweigerung unlesbarer Formen (Entscheidung 3, 22.10.2026, Abend)

Statt einer Rückfrage, die niemand begründet beantworten kann, wird verweigert,
wenn das Ausführungsziel in der Zeile nicht lesbar ist:

| Form                       | Beispiel                                   | Verhalten                                                           |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| Call-Operator              | `& node $tp $src 2>&1`, `& $browser`       | `deny` — Ziel liegt in einer Variablen                              |
| Dot-Sourcing               | `. .\init.ps1`                             | `deny` — lädt ein Skript in die laufende Sitzung                    |
| Block mit solcher Form     | `if ($ok) { & run.ps1 }`                   | `deny` — Verweigerung dominiert den ganzen Block                    |
| Voll ausgeschriebener Call | `node "C:\...\node.exe" "C:\...\test.mjs"` | normale Einordnung — Pfad sichtbar, `ask`/`allow` nach allen Regeln |

Verweigerung schlägt auch die Geheimnis-Rückfrage (`& $t` neben
`$env:GITHUB_TOKEN` → `deny`). Der Ausführende muss solche Befehle mit voll
ausgeschriebenen Pfaden neu formulieren; danach greifen die normalen Freigaben.
Ein `deny` von außerhalb (statische Regeln) wird weiterhin nie berührt.

### Geheimnisbegriffe in Such-Ersetzungen (Entscheidung 5, 22.10.2026, Abend)

Die vier Wörter `token`, `secret`, `password`, `api_key` lösen nur dann eine
Rückfrage aus, wenn sie **nicht** innerhalb einer maskierenden Such-Ersetzung
stehen — dort wird Text ohnehin ersetzt, bevor er ausgegeben wird:

| Fall                                                         | Verhalten                                    |
| ------------------------------------------------------------ | -------------------------------------------- |
| `[regex]::Replace($t, "token", "…")`, `$x -replace …`        | erlaubt — Wort ist Suchmuster der Maskierung |
| Variablen-Argument im Replace-Aufruf (`$conf.password`)      | `ask` — nicht ausschriebbarer Inhalt         |
| Word-Kontext ohne Ersetzung (`Select-String "token"`, Prosa) | `ask` — Grenze der Ausnahme                  |
| `.env`, `$env:GITHUB_TOKEN`, SSH/AWS-Browser-Pfade           | `ask` — alle übrigen Prüfungen unangetastet  |

Begrenzung (fail closed): Bareword-Muster ohne Anführungszeichen und
verdoppelte Zitate im Muster werden nicht erkannt und lösen weiterhin
Rückfragen aus.

### Hilfe und Version: genau ein Hilfewort

Entscheidung vom 23.10.2026: Jedes Programm darf sich vorstellen — aber nur in
der engsten Form. Erlaubt ist ein Programmname aus dem PATH mit **genau einem**
Hilfewort: `--help`, `-h`, `-?`, `/?`, `--version`, `-V`, `help`, `version`.

Nicht erlaubt bleiben: `-v` (meist „verbose", nicht Version), weitere Argumente
(`node --version --eval …`), Unterbefehl-Ketten (`gitleaks dir --help`),
Skriptnamen (`.\deploy.ps1 --help`) und Aufrufe mit vollem Pfad
(`C:\Tools\x.exe --version`). Die letzte Grenze ist bewusst: Ein Pfad kann auf
ein Skript zeigen, das Hilfe nur behauptet. Schreibende Cmdlets
(`Remove-Item --help`) laufen nicht über diese Regel, sondern über die
Pfadprüfung.

Warum die Enge: Der Aufruf führt das Programm aus; die Freigabe gilt nur, weil
ein Hilfewort nichts schreibt, sendet oder startet. Bei weiteren Argumenten ist
diese Annahme nicht mehr belegbar.

### Fremde CLIs: `opencode`, `firecrawl`, `gitleaks`, `sqlite3`, `gh`

Grundlage sind die Hilfe-Bäume der installierten Fassungen, nicht Annahmen.
Erlaubt wird nur, was nachweislich liest und nichts speichert, sendet oder
startet. Unbekannte Unterbefehle bleiben `ask`.

| CLI | erlaubt | bleibt `ask` |
|---|---|---|
| `opencode` | `--help`, `--version`, `models`, `stats` (ohne `--standalone`/`--server`), `debug` | `run`, `serve`, `api`, `acp`, `auth`, `mcp`, `plugin`, `session`, `service`, `reload`, `pair`, `mini`, `upgrade`, `uninstall`, TUI ohne Argument |
| `firecrawl` | `list`, `list-tools`, `find-tools`, `search`, `map`, `alexandria`, `developer`, `gov`, `research`, `status`, `version`, `doctor`, sowie `scrape` und `crawl` ohne Schreib-Flags | `agent`, `interact`, `monitor`, `batch-scrape`, `parse`, `feedback`, `search-feedback`, `env`, `config`, `login`, `logout`, `init`, `setup`, `make`, `launch`, `experimental`, `credits` |
| `gitleaks` | `version`, `help`, `git`, `dir` (auch `file`/`directory`) — Scans nur mit voller Redaktion (`--redact` oder `--redact=100`) | `stdin`, `completion`, Scans ohne oder mit Teilredaktion (`--redact=20`), `-r`/`--report-path`, `--report-template`, `--log-opts`, `--diagnostics`, `--diagnostics-dir` |
| `sqlite3` | nur mit `-readonly` | ohne das Flag (öffnet schreibend), `-cmd`, `-init`, `.output`, `.once`, `.save`, `.backup`, `.restore`, `.clone`, `.archive` |
| `gh` | `auth status`, `repo view` | alles andere, insbesondere `gh api` (kann POSTen), `pr merge`, `release create` |

Zusätzlich gesperrt, auch bei erlaubtem Unterbefehl: `-o`/`--output`,
`-k`/`--api-key`, `--api-url`, `--screenshot`, `--full-page-screenshot`,
`--profile`, `--cancel`, `--webhook`.

Die sqlite3- und gh-Regeln (Entscheidung 25.10.2026) schließen die zwei
häufigsten Leseaufrufe im Log: `sqlite3.exe -readonly <db> ".tables"` (zehnmal
in sieben Tagen) und `gh auth status`. Beides ist ohne die Flag-Prüfung nicht
tragfähig: `sqlite3` ohne `-readonly` schreibt in die Datenbank, und `gh api`
kann jeden beliebigen Verb senden.

Die gitleaks-Regel (Entscheidung 23.10.2026) hat zwei Gründe: Ein Scan ohne
`--redact` druckt gefundene Geheimnisse — damit in den Verlauf und ins
Protokoll. Und `--log-opts` startet `git log` mit beliebigen Optionen, darunter
`--output=<datei>`; `--diagnostics` schreibt Profile bzw. startet einen
HTTP-Server. Beides bleibt Rückfrage. Grundlage ist der Hilfe-Baum der
installierten Fassung (`gitleaks help`, `gitleaks git --help`,
`gitleaks dir --help`).

Zwei Eigenheiten, die den Regeln zugrunde liegen:

- `firecrawl scrape` legt **mehrere** URLs in `.firecrawl/` ab. Ohne Ziel ist
  deshalb nur eine URL erlaubt; mehrere bleiben `ask`.
- `firecrawl parse` liest eine lokale Datei und lädt sie zur Verarbeitung hoch.
  Das ist kein Lesen, sondern eine Übertragung — bleibt `ask`.

`opencode` hat übrigens weder `status` noch `version` als Unterbefehl: die
Version ist ein Flag (`--version`), Status liefert `stats`.

## Was **nicht** erlaubt wird

| Fall | Entscheidung |
|---|---|
| Schreiben außerhalb des Projektordners | `deny` (Entscheidung 25.10.2026) |
| Schreibziel nicht bestimmbar (`$var`, Wildcard, fremde Umgebungsvariable) | `ask` |
| `Remove-Item` ohne Ziel (`Get-ChildItem \| Remove-Item`) | `ask` |
| Schreiben in `<Projekt>\.git`, `~/.config/opencode`, `~/.claude`, `~/.codex` | `deny` (Entscheidung 25.10.2026) |
| Rekursives Löschen auf den Arbeitsordner selbst | `deny` (Entscheidung 25.10.2026) |
| `git push/reset/clean/checkout/restore/commit --amend` | `ask` |
| `npm install`, `pip install`, `winget`, `npx`, `Start-Process` | `ask` |
| `Invoke-WebRequest`/`-RestMethod` mit Speicher-, Sende- oder Credential-Plan | `ask` (Details oben) |
| `git config <key> <value>` | `ask` |
| Registry, Aufgabenplanung, `Set-ExecutionPolicy`, `Set-Acl` | `ask` |
| `python` außerhalb der Freigabe, `node` außerhalb der Selbst-Skripte, `pwsh -File` | `ask` |
| `& <befehl>`, Dot-Sourcing (Ziel in Variablen) | `deny` (Entscheidung 3) |
| `Invoke-Expression`, `iex`, `-EncodedCommand`, `powershell -e` | `deny` (Entscheidung 25.10.2026) |
| Geheimnispfade: `.env`, `.ssh`, `auth.json`, `*.pem`, `*.key`, `.npmrc`, `.aws` | `ask` |
| Geheimnisbegriffe: `password`, `secret`, `token`, `api_key` | `ask` |
| `$env:NAME` mit unbekanntem Namen (`$env:TEMP` ist erlaubt) | `ask` |
| Schreiben nach `.ssh`, `.gnupg`, `.aws/credentials`, `.git-credentials` | `deny` |
| `Format-Volume`, `Clear-Disk`, `Initialize-Disk`, `diskpart` | `deny` |

Alles, was der Klassifizierer nicht kennt, bleibt bei `ask` (fail closed).
Seit 25.10.2026 geht diesem `ask` ein lokaler Entscheider voraus (Ebene 1).

## Ebene 1: lokaler Entscheider (`reviewer.js`)

Bleibt nach der statischen Prüfung ein `nicht einordenbar` übrig, fragt das
Plugin ein lokales Modell. Der Ablauf ist bewusst zweistufig:

```
Segmente aus dem Scanner (event.resources)
        │
        ├─ statische Risikoliste (RISKY) ── Treffer ──▶ ask  (kein Modellaufruf)
        │
        └─ lokales Modell: "Wirkt der Befehl ausschließlich im Projektordner?"
                ├─ "Ja"   ──▶ allow
                ├─ "Nein" ──▶ ask
                └─ Timeout / Fehler / unklare Antwort ──▶ ask
```

1. **Statische Risikoliste zuerst.** Sie ist die Sicherheitsgrenze, nicht das
   Modell. Ein Treffer (`git push`, `rm`, `python -c`, `npm install`, `docker`,
   Geheimnispfade, verschleiernde Operatoren) verhindert die Befragung
   vollständig. Gemessen: ohne diese Liste erlaubte ein 12B-Modell
   `git push --force` und `shutil.rmtree`.
2. **Eine projektbezogene Ja/Nein-Frage.** Nicht „ändert der Befehl etwas?"
   (im Workspace fast immer ja), sondern „wirkt er ausschließlich im
   Projektordner oder in den genannten temporären Ordnern?". Der Prompt nennt
   beide Pfade, damit das Modell nicht jede Ausgabe nach `%TEMP%` als
   Grenzverletzung wertet (Befund 25.10.2026). Nur ein klares `Ja` hebt `ask`
   auf `allow`; `Nein`, Freitext, Timeout und Verbindungsfehler bleiben `ask`.
   Ein `deny` ist für den Reviewer unerreichbar.

Segmentgrundlage sind die vom Scanner getrennten `resources`. Die Teilung
ignoriert Anführungszeichen — ein Trenner in einem Argument erzeugt höchstens
eine zusätzliche Rückfrage, nie eine versteckte Ausführung.

**„Verschleiernd" ist eng gefasst.** Gesperrt sind Backtick, Redirection (`>`,
`<`) und `$(`. Klammern und geschweifte Klammern sind dagegen normale
PowerShell-Syntax (Scriptblock, Hashtable, Gruppierung) und dürfen das Modell
nicht umgehen. Befund 25.10.2026: mit der weiteren Fassung
`/[`<>{}()]/` erreichten 44 von 59 Rückfragen das Modell nie. Unlesbare
`&`-/`.`-Aufrufe verweigert bereits der Guard.

**Lebenszyklus und Aufwärmlauf.** Das Plugin hält den Server nicht dauerhaft am
Leben, sondern bindet ihn an OpenCode:

- **Start:** `reviewer.js → ensureRunning()` prüft beim Plugin-Setup `/health`
  und startet andernfalls `start-reviewer.ps1` losgelöst. Der Aufruf wartet
  nicht auf den Ladevorgang.
- **Aufwärmlauf:** `warmup()` schickt danach einmal eine Anfrage ohne
  Befehlsprüfung, damit die Gewichte wirklich im Speicher liegen. Ohne ihn zahlt
  die erste echte Entscheidung den Kaltstart und lief am 25.10.2026 in den
  Timeout (`AbortError`). Budget: `warmupTimeoutMs`, Standard 90 000 ms —
  gemessen wurden 34 028 ms Kaltstart gegen 199–256 ms warm (26.10.2026).
  Der Entscheidungs-Timeout bleibt davon unberührt.
- **Ruhepause:** `sleep-idle-seconds` in `%APPDATA%\llama.cpp\config.ini` gibt
  die Gewichte nach Untätigkeit frei (hier 900 s). Der Standardwert `-1`
  deaktiviert das; `load-mode = auto` bedeutet mmap, `--no-mmap` macht den Start
  laut Hilfe der Binärdatei **langsamer**.
- **Ende:** `watchdog-reviewer.ps1` beendet den Server, sobald kein
  `OpenCode`/`opencode-cli` mehr läuft. Fehler sind überall folgenlos — der
  Reviewer bleibt zuständig, notfalls mit `ask`.

### Modellauswahl

`bench-quality.ps1` prüft ein Modell gegen 18 feste Befehle: neun müssen
freigegeben werden (lesend bzw. im Projekt), neun müssen zurückfragen
(Netzwerk, Schreiben außerhalb, Secrets, Löschen, Container). Gleicher Prompt,
gleiche Grammatik, `temperature 0`, ein Aufwärmlauf, gleiches Backend.

Bei der Auswertung zählt nicht die reine Trefferquote: Ein Fehler auf der
`Nein`-Seite ist folgenlos, wenn die statische Liste den Befehl ohnehin kennt.
Entscheidend sind gefährliche Befehle, die sie *nicht* kennt, und
übervorsichtige Rückfragen bei Lesebefehlen.

| Modell | richtig | Median | Datei | wirksame Fehlfreigaben | übervorsichtig |
| --- | --- | --- | --- | --- | --- |
| Gemma 4 12B IT QAT Q4_K_XL | 15/18 | 204 ms | 6,26 GB | 0 | 0 |
| JevK5 4B v0.3 Q5_K_M | 13/18 | **116 ms** | **2,86 GB** | 0 (nach RISKY-Ergänzung) | 1 (`node --version`) |
| Jev-Omni 12B Q4_K_M | 12/18 | 238 ms | 6,87 GB | 0 | 5 |
| Jev-Omni 12B IQ2_XS | 8/18 | 324 ms | 3,62 GB | 0 | 8 |
| Jev-Style Qwen3.5 2B Q4_K_M | Polarität invertiert | 39 ms | 1,22 GB | – | – |

- **Gemma 4 12B ist Standard.** Einziges Modell ohne Fehlentscheidung im
  Wirkungsbereich.
- **JevK5 4B ist der Sparmodus.** 3,4 GB weniger VRAM, eine unnötige Rückfrage.
  Geeignet, wenn parallel ein Coding-Modell auf der GPU liegen soll.
- **Jev-Omni ist ungeeignet** (5 bzw. 8 übervorsichtige Rückfragen). IQ2_XS ist
  zudem langsamer als Q4_K_M.
- **2B-Modelle sind zu klein.** `Jev-Style-Qwen3.5-2B` dreht die Polarität und
  hält `curl … -OutFile C:\temp\…` für sicher.

Neues Modell prüfen — erst messen, dann umstellen:

```powershell
.\bench-quality.ps1 -Model "D:\…\modell.gguf" -Label "Kandidat"
.\bench-quality.ps1 -Model "D:\…\modell.gguf" -Mmproj "D:\…\mmproj.gguf" -Label "Kandidat (Vision)"
# danach: model in shell-reviewer.config.json ändern, dann
node smoke-reviewer.mjs
```

### Backend-Vergleich

| Backend | Latenz (gleiches Modell) | Key | Bemerkung |
| --- | --- | --- | --- |
| **llama.cpp direkt** (`llama-server`) | 203 ms | nein | Standard, `-ngl all --jinja` |
| LM Studio (Port 1234) | 520–900 ms | ja | eigener llama.cpp-Build (CUDA 12) plus Proxy-Schicht |
| OpenRouter Decisions | ~130 ms (Herstellerangabe) | ja | andere API, siehe unten |

Gleiches Modell (`jev-omni`), nur das Backend geändert: 203 ms gegen 520–900 ms.
Der frühere Eindruck „llama.cpp ist dreimal schneller" kam fast vollständig von
dieser Schicht; auf demselben Backend liegt Gemma nur rund 20 % vor Jev-Omni.

**Befund am Rande:** Dasselbe Modell antwortete über llama.cpp mit „Nein" und
über LM Studio mit „Ja" auf `rg -n "TODO" src`. Bei `temperature 0` und
Grammatik darf das nicht passieren; Verdacht: abweichendes Chat-Template oder
Sampling-Defaults. Deshalb: pro Backend prüfen, nicht nur pro Modell.

**Grammatik-Falle.** Ohne `grammar` gibt Gemma 4 12B auf llama.cpp nur
Kanal-Token aus (`"<|channel>0101010"`, `finish_reason: length`). Unbrauchbar,
und es sieht wie ein Serverproblem aus. Mit `root ::= "Ja" | "Nein"` kommt
sauber `Ja`. LM Studio akzeptiert den Parameter und ignoriert ihn; `reviewer.js`
wiederholt die Anfrage einmal ohne Grammatik, falls ein Backend sie ablehnt.

**OpenRouter (Jev 1.13)** ist *kein* Chat-Modell, sondern läuft über den
Entscheidungs-Endpunkt `/api/alpha/decisions` (Modell-ID `typesafe/jev-1.13`) und
liefert Wahrscheinlichkeiten statt Text. Damit ist es kein austauschbares
Backend für `reviewer.js`, aber eine brauchbare dritte Meinung für den
Testfall-Satz. Es beantwortet *unsere* Frage, ist aber kein Ground Truth, und
der Befehlstext verlässt dabei den Rechner — für eine Einmal-Auswertung
vertretbar, für den Dauerbetrieb nicht.

**Artificial Analysis Decision Index v1.0** (13.10.2026): Jev 1.13 führt mit 58
(GLIDE 54, Microsoft-Decision-1 54), 42 USD pro 1 Mio. Aufgaben, 0,13 s pro
Aufgabe, auf der Kosten-/Fähigkeits-Pareto-Kurve. Für unseren Fall zählen die
Sub-Scores Klassifikation (WildGuardTest 94) und Werkzeugwahl (When2Call 81);
Wissen und Schlussfolgern (HLE, Omniscience) tragen den Index, braucht ein
Freigabe-Filter aber nicht. Der Index dient der Vorauswahl, der eigene
18-Befehl-Satz bleibt maßgeblich.

### Betrieb

```powershell
.\start-reviewer.ps1                       # llama-server, Gemma 4 12B, Port 8080
.\start-reviewer.ps1 -ModelPath "D:\…\jevk5-4b-v0.3-Q5_K_M.gguf" -Port 8081
node smoke-reviewer.mjs                    # 9 Fälle gegen die laufende Konfiguration
node test.mjs                              # 309 Unit-Tests
.\start-reviewer.ps1 -Stop
```

Ohne laufenden Server bleibt alles bei `ask`. Endpunkt, Modell, Grammatik und
Timeout stehen in `shell-reviewer.config.json` (beim Deploy aus
`shell-reviewer.config.example.json` erzeugt, danach nie überschrieben):

| Feld | Bedeutung |
| --- | --- |
| `enabled` | Reviewer ein/aus |
| `baseUrl` | OpenAI-kompatibler Endpunkt |
| `model` | Modellname (llama.cpp ignoriert ihn, LM Studio braucht ihn) |
| `apiKeyEnv` | Name der Umgebungsvariable mit dem Key, nie der Key selbst |
| `timeoutMs` | Obergrenze, danach `ask` |
| `grammar` | GBNF; leer nur für Backends, die sie ablehnen |
| `extraRisky` | projektspezifische Muster, die nie freigegeben werden |

Überschreibbar per Umgebung: `PERMISSION_GUARD_REVIEWER` (`0`/`1`), `_URL`,
`_MODEL`, `_KEY_ENV`, `_TIMEOUT_MS`.

**Konfiguration wird beim Laden einmal gelesen.** `loadConfig()` läuft in
`setup()`, also einmal pro Plugin-Instanz. Eine Änderung an
`shell-reviewer.config.json` wirkt deshalb **nicht** sofort:

- Ein reiner Neustart des App-Fensters genügt **nicht**. Die Desktop-App
  verbindet sich auf den bereits laufenden `opencode-cli`-Server; der hält die
  Plugin-Instanz und damit die alte Konfiguration.
- Zuverlässig ist ein Datei-Touch auf `index.js` oder `reviewer.js`: der
  Dateiwatcher lädt das Plugin neu, und im Log erscheint eine neue Zeile
  `setup: base=…`.
- Alternativ alle OpenCode-Prozesse beenden (auch `opencode-cli`) und neu
  starten.

Prüfen lässt sich das im Guard-Log: Zeitstempel der letzten `setup:`-Zeile
gegen die Änderungszeit der Konfigurationsdatei halten.

## Grenzen

- **Kein Sandboxing.** Ein erlaubter Befehl läuft mit deinen Rechten. Das Plugin
  entscheidet nur über Ort und Art des Zugriffs — es isoliert nichts.
- **Modellabhängige Polarität.** Ein neues Modell kann `Ja` und `Nein`
  vertauschen (bei `Jev-Style-Qwen3.5-2B` beobachtet). Der Smoke-Test erkennt
  das daran, dass die Freigabefälle auf `ask` fallen.
- **Ein Modellurteil ist keine Garantie.** Deshalb die statische Liste davor und
  `ask` als Default in allen Zweifelsfällen.
- **Pfadprüfung ist Textanalyse.** Sie erkennt die üblichen Schreibbefehle und
  ihre Ziele. Ein Befehl, der seinen Zielpfad erst zur Laufzeit berechnet
  (`Join-Path`, Schleifenvariable), bleibt `ask`.
- **`python` und `node` laufen nur innerhalb der Freigaben** (Entscheidung 1
  und 2, oben), sonst `ask`. Interpreter führen beliebigen Code aus — die
  Freigaben decken genau das ab: Skripte im reviewten Projektkreis und die
  drei benannten Selbst-Skripte. `pwsh -File` und Aufrufe nutzerdefinierter
  Funktionen (`Read-Jsonc …`) bleiben `ask`; unlesbare `&`-/Dot-Formen sind
  seit Entscheidung 3 verweigert.
- **Ein `cd` in ein anderes Laufwerk** macht alle relativen Ziele unklar → `ask`.

## Messung

Reproduzierbar mit `replay.mjs`. Es liest die Zeilen „spawning process" aus
`opencode.log` (vollständiger Befehl, Argumentliste und `cwd`) und spielt sie
gegen `evaluate()` — mit dem Arbeitsordner der damaligen Sitzung als Basis:

```powershell
node replay.mjs                       # Standard-Log, ganzer Zeitraum
node replay.mjs --since 2026-10-01    # nur neuere Aufrufe
node replay.mjs --json --examples 0   # maschinenlesbar
```

Stand 23.10.2026 (Log 18.–23.10., 1292 eindeutige Befehle): **53,3 % ohne
Rückfrage**, **5,0 % verweigert**, 41,7 % Rückfragen; frequenzgewichtet (`--all`,
1325 Aufrufe): 52,5 % / 4,8 % / 42,6 %. Zuwachs je Punktsitzung: 42,2 % (vor den
CLI-Allowlists) → 44,1 % (Netz-Lesen + enges python) → 48,5 % (Folgelog) →
51,0 % (Punkt 8: Klassifizierer-Lücken) → 52,5 % (Entscheidung 1 und 2:
node-Selbst-Skripte, python-Skripte im Projekt) → 52,9 % (Entscheidung 3
und 5: unlesbare `&`-/Dot-Formen verweigert statt gefragt, Begriffe in
Such-Ersetzungen ohne Rückfrage) → **53,3 %** (Hilfe/Version und gitleaks;
beide sind im Log selten, der Sprung ist deshalb klein). Verbliebene Rückfragen:
„nicht einordenbar" 354 (`python -c` 21, %TEMP%-Skripte, `[IO.File]::Create`,
nutzerdefinierte Funktionen), Geheimnis-Verdacht 75, „schreibend" 53, Pfad nicht
bestimmbar 34, außerhalb des Projekts 12, geschützter Pfad 7, Ziel/Arbeitsordner
unklar 4. Verweigert werden 64 eindeutige `&`-/Dot-Formen des Logs. Häufigste
`ask`-Anfänge bleiben Skripte, die mit `$ErrorActionPreference = …` beginnen
(50) oder nach `cd` weitere, nicht einordenbare Sätze ausführen (30).

Zwei Einschränkungen, damit die Zahl nicht überinterpretiert wird:

- Zähleinheit ist der **einzigartige Aufruf** (einmal je Befehl + Arbeitsordner),
  damit `git status` nicht die Statistik dominiert. Mit `--all` zählt der Replay
  jede Ausführung frequenzgewichtet — in diesem Logfenster fast deckungsgleich
  (1227 Aufrufe, 51,0 % → 49,9 %, weil nur ~34 Wiederholungen im Fenster sind).
  In Sessionfenstern mit wenigen, oft wiederholten Befehlen können beide
  Sichtweisen auseinanderlaufen; beide lassen sich über dasselbe Skript messen.
- Gezählt werden alle Shell-Aufrufe, auch die, die schon durch die statischen
  Regeln ohne Rückfrage liefen. Der Anteil ist deshalb der Anteil der Aufrufe,
  die **nachweislich keine Rückfrage brauchen** — nicht die Zahl der
  eingesparten Rückfragen seit erster Version des Guards.
- Die Zeilen „evaluated permission=bash pattern=…" taugen nicht als Quelle:
  `pattern` ist nur das Fragment, auf das eine statische Regel gematcht hat
  (z. B. `ConvertFrom-Json`), nicht der Befehl.

## Testen

```powershell
cd "$HOME\Python-Projekte\AI+IDE-Hints\tools\permission-guard"
node test.mjs
node replay.mjs                 # Messung: wie viele Befehle laufen ohne Rueckfrage
node analyze.mjs                # Punkt-8-Analyse: Woher genau kommt "nicht einordenbar"
```

275 Fälle in neun Gruppen (ohne/mit Projektbezug, CLI-Allowlists, Hilfe und
Version, gitleaks, Netz-Lesen, Verweigerung & Geheimnis-Ersetzung, python,
Interpreters), Exitcode 1 bei Abweichung.
Der Klassifizierer (`guard.js`) ist eine reine Funktion und braucht weder
OpenCode noch Netzwerk. `replay.mjs` und `analyze.mjs` bleiben im Projekt und
werden nicht deployt.

## Diagnose

`%TEMP%\opencode-permission-guard\guard.log` — eine Zeile je Entscheidung.
Bei `ask`/`deny` ohne Befehlstext, damit nichts Sensibles im Log landet.

## Änderbarkeit

- Erlaubte Befehle: `READ_CMDLETS`, `READ_BINARIES`, `READ_GIT` in `guard.js`
- Lesende .NET-Typen und -Methoden: `TYPE_READ`, `SAFE_METHODS` — jede
  Ergänzung braucht einen Testfall, der aus dem Log belegt ist (`analyze.mjs`)
- Umleitungssuche/Stringmaskierung: `maskStrings()`, `hasRedirection()`
- Netz-Lesen: `NET_CMD_NAMES`, `NET_BLOCK_FLAGS`, `NET_SAFE_METHODS`
- python-Freigabe: `classifyPython()`
- node-Freigabe: `NODE_SELF_SCRIPTS`, `classifyNode()`, `expandLeadVar()`
- Verweigerung unlesbarer Formen: `&`/Dot-Zweig in `classifyStatement()` plus
  Aggregation im Block-Zweig
- Geheimnisbegriff-Ausnahme: `SECRET_TERMS`, `REPLACE_OPERAND_RX`,
  `DOTNET_REPLACE_CALL_RX`, `maskReplaceOperands()`
- Geheimnisse: `SECRET_PATHS`
- Dateischreiben (pfadgeprüft): `FILE_WRITE_CMDLETS`, `FILE_WRITE_METHODS`
- Hart schreibend (immer `ask`): `WRITE_VERBS`
- Harte Sperren: `DENY_PATHS`, `DENY_COMMANDS`
- Vertraute Ordner: `guardOptions()` in `index.js`

Nach jeder Änderung `node test.mjs` laufen lassen und die Erwartung im Test
mitanpassen — der Test ist die Spezifikation.
