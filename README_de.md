# permission-guard

Dynamische Pfad- und Kommando-Prüfung für Shell-Aufrufe. Das Plugin hebt ein
`ask` der statischen Regeln auf `allow` hoch, wenn das Skript nachweislich nur
liest oder nur in vertraute Ordner schreibt. Ein `allow` oder `deny` der
statischen Regeln bleibt unberührt.

## Problem

Die statischen Regeln in `opencode.jsonc` matchen das **Präfix** des Befehls:

```jsonc
{ "action": "shell", "resource": "Get-ChildItem *", "effect": "allow" }
```

Ein Agent ruft aber fast nie direkt `Get-ChildItem ...` auf, sondern z.B.:

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

## Installation

Quelle: `<Projekt>\tools\permission-guard\`.
Laufzeit: `$HOME\.config\opencode\plugins\permission-guard\` bzw.
`${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/permission-guard` unter
Linux und macOS. Dazu kommt seit 15.11.2026 das zweite Ziel
`$HOME\.codex\hooks\` mit `codex_guard.py` (Codex-Hook).

Das Laufzeitverzeichnis ist bewusst schreibgeschützt (Permission `ask`): kein
Agent soll seine eigenen Regeln unbemerkt ändern können. Deshalb wird im Projekt
entwickelt und getestet, dann **einmal** deployt:

```powershell
cd "$HOME\Python-Projekte\AI+IDE-Hints"
pwsh -File .\tools\permission-guard\scripts\deploy.ps1          # Tests + Kopie + Hashvergleich
pwsh -File .\tools\permission-guard\scripts\deploy.ps1 -Check   # nur vergleichen
```

```sh
cd tools/permission-guard
./scripts/deploy.sh            # Tests + Kopie + Hashvergleich
./scripts/deploy.sh --check    # nur vergleichen
```

Beide Deploy-Skripte deployen nicht, wenn `node test/test.mjs` oder
`python -m pytest tests -q` fehlschlägt, und melden jede Byte-Abweichung
zwischen Quelle und Laufzeit. Nicht per Junction oder Symlink verbinden: dann
läge der Guard in einem Ordner mit Schreibfreigabe und die Selbstschutzgrenze
wäre weg.

Nach dem Klonen einmalig die Node-Abhängigkeit aus der Lock-Datei installieren;
ohne sie schlägt das Test-Gate beim Commit fehl:

```powershell
npm ci                  # @opencode/plugin aus package-lock.json
npm run test:index
```

Unter Windows zeigt `$HOME` in Git Bash und WSL auf das Linux-Home, nicht auf das
Windows-Profil. Dort entweder `deploy.ps1` nehmen oder die Ziele setzen:
`PERMISSION_GUARD_TARGET` und `PERMISSION_GUARD_CODEX_TARGET` auf die
Windows-Pfade (`/mnt/c/Users/<name>/...` in WSL, `/c/Users/<name>/...` in Git
Bash).

## Einrichten und starten

Ohne laufenden Server bleibt alles bei `ask`. Endpunkt, Modell, Grammatik und
Timeout stehen in `shell-reviewer.config.json` (beim Deploy aus
`shell-reviewer.config.example.json` erzeugt, danach nie überschrieben):

| Feld         | Bedeutung                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `enabled`    | Reviewer ein/aus                                                                                         |
| `baseUrl`    | OpenAI-kompatibler Endpunkt                                                                              |
| `model`      | Modellname: `kev-4b` für `systemone`; im Chat-Weg für Backends mit Pflichtangabe                         |
| `apiKeyEnv`  | Name der Umgebungsvariable mit dem Key, nie der Key selbst                                               |
| `timeoutMs`  | Obergrenze, danach `ask`                                                                                 |
| `grammar`    | GBNF; leer nur für Backends, die sie ablehnen                                                            |
| `gitShadow`  | `off` oder `shadow`; im Schattenmodus werden destruktive Git-Formen mit `effect=allow` nur protokolliert |
| `extraRisky` | projektspezifische Muster, die nie freigegeben werden                                                    |

Überschreibbar per Umgebung: `PERMISSION_GUARD_REVIEWER` (`0`/`1`), `_URL`,
`_MODEL`, `_KEY_ENV`, `_TIMEOUT_MS`, `_BACKEND` (`mcpBackend`),
`_SHELL_BACKEND`, `_THRESHOLD` (`mcpThreshold`) und `_SHELL_THRESHOLD`
(`shellThreshold`), `PERMISSION_GUARD_GIT_SHADOW` (`0`/`1` oder `off`/`shadow`),
`PERMISSION_GUARD_GIT_SHADOW_LOG` (Pfad oder `off`).

Die beiden Schwellen-Variablen wirken nur im zulässigen Band 0,5 bis unter 1,0
(`THRESHOLD_BOUNDS` in `src/reviewer.js`); ein Wert außerhalb wird verworfen,
dann gilt die Datei beziehungsweise der Vorgabewert.

**Ablageort.** Gelesen wird die Datei aus dem Ordner neben `reviewer.js`: im
ausgelieferten Plugin also flach im Plugin-Verzeichnis, im Repository unter
`src/`. Eine `shell-reviewer.config.json` im Repo-Root bleibt seit dem Umzug nach
`src/` (21.11.2026) ohne Wirkung — sie wird nicht gefunden, und es gelten still
die Vorgaben. Für Messungen im Repository sind die Umgebungsvariablen deshalb der
verlässlichere Weg: sie greifen unabhängig vom Ablageort.

```powershell
.\scripts\start-reviewer.ps1                       # llama-server, Kev-4B, Port 8080
.\scripts\start-reviewer.ps1 -ModelPath "D:\…\anderes.gguf" -Port 8081
.\scripts\start-reviewer.ps1 -Cpu -Server "C:\…\llama-server.exe"   # ohne GPU-Offload
.\scripts\start-reviewer.ps1 -Batch 2048 -Ubatch 2048               # kleinerer Stapel
.\scripts\start-reviewer.ps1 -Stop
```

Der Standardweg nutzt CUDA mit `-ngl all`. `-Cpu` ist für Rechner ohne
NVIDIA-Grafikkarte oder einen reinen CPU-Build gedacht; dort `timeoutMs` auf 8000
setzen, weil eine Entscheidung dann rund 4 s dauert. Warum der Starter
`-b 4096 -ub 4096` übergibt, steht in `METHODOLOGY_de.md` unter „Betriebsdetails".

**Konfiguration wird beim Laden einmal gelesen.** `loadConfig()` läuft in
`setup()`, also einmal pro Plugin-Instanz. Eine Änderung an
`shell-reviewer.config.json` wirkt deshalb **nicht** sofort:

- Ein reiner Neustart des App-Fensters genügt **nicht**. Die Desktop-App
  verbindet sich auf den bereits laufenden `opencode-cli`-Server; der hält die
  Plugin-Instanz und damit die alte Konfiguration.
- Zuverlässig ist ein Datei-Touch auf `src/index.js` oder `src/reviewer.js`: der
  Dateiwatcher lädt das Plugin neu, und im Log erscheint eine neue Zeile
  `setup: base=…`.
- Alternativ alle OpenCode-Prozesse beenden (auch `opencode-cli`) und neu
  starten.

Prüfen lässt sich das im Guard-Log: Zeitstempel der letzten `setup:`-Zeile
gegen die Änderungszeit der Konfigurationsdatei halten.

## Was erlaubt wird

**Nur lesend:** Ein Skript wird erlaubt, wenn **jede** Anweisung eingeordnet
werden kann als Lesen — etwa `Get-*`, `Test-Path`, `Select-Object`,
`Select-String`, `ConvertFrom-Json`, `git status|diff|log|show`, `rg`, `grep`,
`cat`, `cd`, Zuweisungen, `[System.IO.File]::ReadAllText`, `npm view` und
Hilfe- oder Versionsaufrufe mit genau einem Hilfewort. Kontrollblöcke (`if`,
`foreach`, `try`) zählen nur, wenn ihr Rumpf ebenfalls nur liest.

**Skriptblöcke sind eigener Code.** Ein Block hinter `ForEach-Object`,
`Where-Object`, `Select-Object` und Verwandten wird als eigenes Skript bewertet;
`ask` und `deny` werden mit ihrem Grund durchgereicht. Vorher galt
`Get-ChildItem | ForEach-Object { Remove-Item -Recurse -Force C:\Windows\x }`
als „nur lesend".

**Schreibend im Projekt:** Erlaubt, wenn jedes Ziel auflösbar ist und innerhalb
eines vertrauten Ordners liegt — `Set-Content`, `Add-Content`, `Out-File`,
`New-Item`, `Copy-Item`, `Move-Item`, `Rename-Item`, Umleitungen in eine Datei,
`[System.IO.File]::WriteAllText`, `git add` und `git commit` (ohne `--amend`).

**Dateiwerkzeuge folgen denselben Schutzpfaden.** Ergibt die statische Regel für
`edit`, `write` oder `patch` `ask`, prüft `scopeEdit()` alle Zielpfade; vorhandene
Pfadteile werden physisch aufgelöst, damit Junctions und Symlinks ihr Ziel nicht
verbergen.

**Löschen ist nicht Schreiben** (Nutzerentscheid 29.10.2026): `Remove-Item`, `rm`,
`del` und Verwandte werden zur Rückfrage geführt, sobald `-Recurse` oder `-Force`
gesetzt ist, ein Ziel einen Platzhalter enthält oder keine bekannte Dateiendung
trägt. Das eigene `.git` des Projektordners bleibt hart gesperrt.

Die vollständigen Listen, alle Ausnahmen und ihre Begründung stehen in
`METHODOLOGY_de.md` unter „Regelwerk im Detail".

## Was **nicht** erlaubt wird

| Fall                                                                            | Entscheidung                                    |
| ------------------------------------------------------------------------------- | ----------------------------------------------- |
| Schreiben außerhalb des Projektordners                                          | `deny` (Entscheidung 25.10.2026)                |
| Schreibziel nicht bestimmbar (`$var`, fremde Umgebungsvariable)                 | `deny` (Entscheidung 10.11.2026)                |
| Schreibziel mit Platzhalter (Wildcard)                                          | `ask`                                           |
| `Remove-Item` ohne Ziel (`Get-ChildItem \| Remove-Item`)                        | `deny` (Entscheidung 10.11.2026)                |
| Schreiben in `<Projekt>\.git`, `~/.config/opencode`, `~/.claude`, `~/.codex`    | `deny` (Entscheidung 25.10.2026)                |
| Schreiben in `<Projekt>\.githooks`, `<Projekt>\.github`, `opencode.jsonc`       | `ask` (Entscheidung 18.11.2026)                 |
| Rekursives Löschen auf den Arbeitsordner selbst                                 | `deny` (Entscheidung 25.10.2026)                |
| `git push`                                                                      | `ask` (statisch und Guard)                      |
| `git branch -D`, `git checkout .`, `git restore .`                              | `deny` (Guard; `branch -D` zusätzlich statisch) |
| `git reset --hard`, `git clean`                                                 | `deny` (statische Regel und Guard)              |
| `git branch -d`                                                                 | `ask`; auf Windows ebenfalls `deny`             |
| ↳                                                                               | (case-insensitive `-D`-Regel)                   |
| `git commit --amend`                                                            | `ask`                                           |
| `git commit --no-verify`, `git commit -n`                                       | `deny` (Entscheidung 15.11.2026)                |
| `npm install`, `pip install`, `winget`, `npx`, `Start-Process`                  | `ask`                                           |
| `Invoke-WebRequest`/`-RestMethod` mit Speicher-, Sende- oder Credential-Plan    | `ask` (Details in der Methodik)                 |
| `git config <key> <value>`                                                      | `ask`                                           |
| Registry, Aufgabenplanung, `Set-ExecutionPolicy`, `Set-Acl`                     | `ask`                                           |
| `python` außerhalb der Freigabe, `node` außerhalb der Selbst-Skripte,           | `ask`                                           |
| `pwsh -File`                                                                    |                                                 |
| `& <befehl>`, Dot-Sourcing (Ziel in Variablen)                                  | `deny` (Entscheidung 3)                         |
| `Invoke-Expression`, `iex`, `-EncodedCommand`, `powershell -e`                  | `deny` (Entscheidung 25.10.2026)                |
| Geheimnispfade: `.env`, `.ssh`, `auth.json`, `*.pem`, `*.key`, `.npmrc`, `.aws` | `ask`                                           |
| Geheimnisbegriffe: `password`, `secret`, `token`, `api_key`                     | `ask`                                           |
| `$env:NAME` mit unbekanntem Namen (`$env:TEMP` ist erlaubt)                     | `ask`                                           |
| Schreiben nach `.ssh`, `.gnupg`, `.aws/credentials`, `.git-credentials`         | `deny`                                          |
| `Format-Volume`, `Clear-Disk`, `Initialize-Disk`, `diskpart`                    | `deny`                                          |

Alles, was der Klassifizierer nicht kennt, bleibt bei `ask` (fail closed).
Seit 25.10.2026 geht diesem `ask` ein lokaler Entscheider voraus (Ebene 1).

## Zwei Implementierungen: OpenCode und Codex

Derselbe Schutz existiert zweimal, mit getrenntem Code: das OpenCode-Plugin in
`src/` (Node) und der Codex-Hook `codex_guard.py` (Python). Eine Änderung an der
einen Umsetzung wirkt nicht auf die andere. Codex kennt kein `ask`; sein Hook
kann nur verweigern oder durchlassen und deckt deshalb einen schmalen Katalog
harter Fälle ab, den Rest die Sandbox. Beide Seiten lesen dieselben 40 Fälle aus
`test/shared-cases.jsonl`, damit sie nicht auseinanderlaufen.

Einzelheiten, die gemeinsamen Testfälle und die unterschiedlichen Löschwurzeln
stehen in `METHODOLOGY_de.md` unter „Zwei Implementierungen: OpenCode und Codex".

## Grenzen

- **Kein Sandboxing.** Ein erlaubter Befehl läuft mit deinen Rechten. Das Plugin
  entscheidet nur über Ort und Art des Zugriffs — es isoliert nichts.
- **Modellabhängige Polarität.** Ein neues Modell kann `Ja` und `Nein`
  vertauschen (bei `Jev-Style-Qwen3.5-2B` beobachtet). Der Smoke-Test erkennt
  das daran, dass die Freigabefälle auf `ask` fallen.
- **Ein Modellurteil ist keine Garantie.** Deshalb die statische Liste davor und
  `ask` als Default in allen Zweifelsfällen.
- **Pfadprüfung ist Textanalyse.** Ein Befehl, der seinen Zielpfad erst zur
  Laufzeit berechnet und nicht sicher auflösbar ist (`Join-Path` mit unbekanntem
  Teil, Schleifenvariable), wird `deny`.
- **`python` und `node` laufen nur innerhalb der Freigaben**, sonst `ask`.
  Interpreter führen beliebigen Code aus; `pwsh -File` bleibt `ask`.
- **Ein `cd` in ein anderes Laufwerk** macht relative Ziele unklar → `deny`.
- **Das Entscheidungsmodell hat ein Stapellimit, keine Zeichengrenze.** Zu lange
  Anfragen beantwortet der Server mit einem Fehler, den der Guard für diesen
  Aufruf zu `deny` macht.

## Selbst prüfen

```powershell
node test/test.mjs                  # 992 Unit-Tests, Klassifizierer und Reviewer
node test/test-wiring.mjs           # Fake-git: deny verhindert Ausführung
node test/test-index.mjs            # Plugin-Verdrahtung, Fake-OpenCode
node test/bench-mcp.mjs             # 40 feste MCP-Fälle, 15 davon Verbote
node test/smoke-reviewer.mjs        # 9 Fälle gegen die laufende Konfiguration
python -m pytest tests -q           # Codex-Guard
python -m ruff check .              # Python-Lint
python -m pyright                   # Python-Typprüfung
```

Die Codex-Guard-Tests nutzen eine repo-lokale `tests/conftest.py`-Fixture
statt des `tmp_path` von Pytest (die Codex-Windows-Sandbox kommt mit den
`0o700`-Temp-Verzeichnissen von Pytest nicht zurecht). Die Artefakte landen
im git-ignorierten `tests/artifacts/`. Die Konvention steht in `AGENTS.md`
und `docs/adr/0003-tmp-path-workaround-codex-sandbox.md`.

`node src/replay.mjs` spielt die Befehle aus `opencode.log` gegen den
Klassifizierer und zeigt, wie viele ohne Rückfrage laufen; `node src/analyze.mjs`
zerlegt die verbliebenen Rückfragen nach Ursache.

`%TEMP%\opencode-permission-guard[-<uid>]\guard.log` hält eine Zeile je
Entscheidung. Befehlstexte werden nie roh gespeichert, sondern nur als
`<Name>#<Hash>`; Verzeichnis und Datei sind auf POSIX privat (0700/0600).

## Weiterlesen

| Datei                                   | Inhalt                                                              |
| --------------------------------------- | ------------------------------------------------------------------- |
| `METHODOLOGY_de.md`                     | Regelwerk im Detail, Entscheidungsmodell, MCP-Urteil, Messverfahren |
| `PLANUNG.md`                            | Stand, Messreihen, datierte Entscheidungen                          |
| `CHANGELOG.md`                          | dateiweise Änderungen                                               |
| `COMPACTIONS.md`                        | warum etwas so entschieden wurde                                    |
| `docs/adr/0002-reviewer-und-sandbox.md` | Reviewer und Sandbox im Vergleich                                   |
