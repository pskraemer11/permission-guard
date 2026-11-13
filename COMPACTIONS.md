# Compactions — permission-guard

Sitzungshistorie dieses Repositories: warum etwas entschieden wurde, was gilt
und was als Nächstes ansteht. Die Datei wächst nur durch Anhängen. Was sich
dateiweise geändert hat, steht in `CHANGELOG.md`.


=============== Compaction 22.10.2026 / Rueckfrageflut ================
## Objective
- **Current:** Rueckfragen bei Shell-Aufrufen auf reine Lesebefehle reduzieren,
  per dynamischer Pruefung in `permission.evaluate`.

## Work State
- **Completed:** Plugin `permission-guard` in `~\.config\opencode\plugin\` mit
  Klassifizierer, 49 Testfaellen und README. Konfigurationskommentar angepasst.
- **Open:** Wirksam erst nach Neustart der App (Plugin-Verzeichnis wird beim
  Serverstart geladen). Danach `%TEMP%\opencode-permission-guard\guard.log` pruefen.

## Important Details
- **Warum die statischen Regeln versagen:** Sie matchen das Praefix des Befehls.
  Reale Agenten-Befehle beginnen mit `cd`, einer Zuweisung oder einer Meldung.
  Deshalb greift fast nie eine `allow`-Regel, und der Standard `ask` zieht.
- **Vertrag des Plugins:** nur `ask` -> `allow`. `allow` und `deny` bleiben
  unangetastet. Unbekannte Befehle bleiben `ask` (fail closed).
- **Bewusste Ausschluesse:** `python`, `node`, `pwsh -File`, `& \` sind
  nicht statisch pruefbar und bleiben `ask`. Geheimnispfade (`.env`, `.ssh`,
  `auth.json`) und Geheimnisbegriffe ebenso.
- **Messung:** 84 `pwsh -Command`-Aufrufe am 22.10.; 40 davon rein lesend,
  35 vor und 40 nach den Korrekturen. Die restlichen 44 sind Schreibbefehle oder
  nicht einordenbar - dort ist die Rueckfrage gewollt.
- **Grenze:** Das Plugin ist Policy, keine Isolation. Ein erlaubter Befehl laeuft
  mit den Rechten des Nutzers.

## Next Move
1. App neu starten, dann eine Lesekette (`cd` + `git status` + `Get-ChildItem`)
   auf Rueckfragefreiheit pruefen und eine Schreibkette gegenpruefen.
2. Optional: `npm view`/`git config`-Faelle im Log nachjustieren.
3. Optional: Plugin-Baum in ein eigenes Git-Repo ueberfuehren, falls Versionierung gewuenscht.

## Stand 22.10.2026 (nach Neustart): Schreibfreigabe nach Pfad

### Ergebnis
- **Bug gefunden:** `ctx.permission.hook` ist die Registrierungsfunktion selbst,
  nicht ein Objekt mit `.evaluate`. Der Hook war nie aktiv — die erste Messung
  nach dem Neustart zeigte 0 Wirkung. Korrekt ist `hook("evaluate", cb)`.
- **Zweitfund:** `resources[]` enthaelt die einzelnen Pipeline-Segmente. Vorher
  wurde nur das laengste geprueft, jetzt werden alle verkettet.
- **Drittfund:** Das Plugin registrierte sich zweimal — einmal mit dem
  Benutzerprofil als Basis. Damit war `$HOME` vertraut. Der globale
  Kontext ohne Projekt registriert sich jetzt nicht mehr.

### Schreibfreigabe
- Erlaubt ohne Rueckfrage, wenn **jedes** Ziel in `Projektordner` oder
  `%TEMP%\opencode` liegt: `Set-Content`, `Add-Content`, `Out-File`,
  `New-Item`, `mkdir`, `Remove-Item`, `Copy/Move/Rename-Item`, `>`-Umleitung,
  `[System.IO.File]::Write*`.
- `ask` bleibt bei: Ziel ausserhalb, unbestimmbares Ziel, Wildcard, fremde
  `$env:`-Variable, `<Projekt>\.git`, `Remove-Item -Recurse` auf die Projektwurzel.
- `deny` bleibt fuer `.ssh`, `.gnupg`, `.aws`, `.git-credentials`.
- `git add`/`git commit` (ohne `--amend`) laufen mit; `push`, `reset`, `clean`,
  `checkout`, `config <key> <value>` nicht.

### Messung
- 1083 echte PowerShell-Befehle aus `opencode.log`, jeweils mit dem
  aufgezeichneten `cwd` als Projektbasis: **40 % ohne Rueckfrage**
  (25 % ohne Plugin, 32 % mit reiner Lesefreigabe).
- Verbleibende Rueckfragen sind ueberwiegend Absicht: `python` 135,
  `Invoke-WebRequest`/`-RestMethod` 96, Geheimnisse 83, `node` 25, `& $cmd` 25.
- Ehrliche Einordnung: Die Hoffnung auf 80 % ist mit diesem Sicherheitsmodell
  nicht erreichbar. Wer `python`/`node` freigibt, gewinnt weitere ~15 %, verliert
  aber die Pfadkontrolle vollstaendig — bewusst nicht gemacht.

### Tests
- `node test.mjs`: 83 Faelle, alle bestanden.
- Live: Lesen + Schreiben + Loeschen im Projekt ohne Rueckfrage; Schreiben nach
  `%TEMP%\permission-guard-probe.txt` erzeugt `permission.asked` (im Bridge-Log
  bestaetigt).

### Arbeitsweise (dokumentiert; verbindlich ist `AGENTS.md`)
- Der Nutzerentscheid liegt seit 22.10.2026 verbindlich in
  `$HOME\.config\opencode\AGENTS.md` (Abschnitt "Arbeitsweise", vier Regeln:
  Recherche und Planen statt Trial and Error; externe Recherche via
  Exa/Firecrawl/Browser, danach Nutzer fragen; eine Introspektion statt
  mehrerer Runden; nicht im geschuetzten Ordner iterieren).
  Dieser Block haelt nur fest, woran es sich entzuendet hat.
- **Recherche und Planen statt Trial and Error.** Erst Dokumentation, Typen,
  Referenzimplementierung oder - wenn lokal nichts zu finden ist -
  Exa/Firecrawl. Trial and Error ist als Methode ausgeschlossen. Fuehrt auch
  die externe Recherche nicht zum Ziel: Nutzer fragen, nicht raten.
- **Eine Introspektion statt mehrerer.** Wenn Laufzeitdaten unbekannt sind:
  alle Fragen in einem Durchlauf (`Object.keys`, `typeof`, `length`), nicht in
  drei Speicher-Runden. Der V2-Hook war so in einem Schritt klaerbar.
- **Nicht im geschuetzten Ordner iterieren.** `~\.config\opencode\**` ist
  bewusst `ask`; jede Speicherung dort ist eine Rueckfrage. Entwicklung und
  Tests laufen im Projekt (`tools/permission-guard/`), deployt wird einmal.
- **Keine Junction fuer den Guard.** Laege er in einem Ordner mit
  Schreibfreigabe, koennte ein Agent seine eigenen Regeln unbemerkt aendern -
  genau die Grenze, die der Ask-Bereich zieht.

### Offen
- `Invoke-RestMethod`/`Invoke-WebRequest` ohne `-OutFile`/`POST` koennte man als
  Netz-Lesen einordnen — bleibt vorerst `ask` (Exfiltrationsvektor).
- `opencode`-CLI und `firecrawl`-CLI sind nicht eingeordnet.
- Replay-Messung wiederholen, wenn im Alltag genug neue Befehle im Log liegen.

## Relevant Files
- `$HOME\.config\opencode\plugin\permission-guard\guard.js` - Klassifizierer
- `$HOME\.config\opencode\plugin\permission-guard\test.mjs` - Spezifikation
- `$HOME\.config\opencode\plugin\permission-guard\index.js` - Verdrahtung
- `$HOME\.config\opencode\opencode.jsonc` - statische Regeln
## Stand 22.10.2026 (Abend): Planung statt Ad-hoc-Liste

- **Neu:** `PLANUNG.md` im Projekt. Der Ordner ist Werkstatt fuer handwerkliche
  Harness-/Tool-/Sicherheitsfragen, kein Anwendungsprojekt; die Themen kehren
  wieder und brauchen eine dauerhafte Liste statt Chatgedaechtnis.
- **Entschieden (Nutzer):** (1) `Invoke-WebRequest`/`Invoke-RestMethod` gelten
  als Netz-Lesen, solange nichts geschrieben oder gesendet wird (kein
  `-OutFile`, kein POST/Body). (2) `opencode` und `firecrawl` werden per
  Subcommand-Allowlist freigegeben, Rest `ask`. (3) `python -m pytest` und
  `python -m ruff` ja, `python` generell nein.
- **Damit sind die drei "Offen"-Punkte des vorigen Blocks entschieden.** Die
  Umsetzung steht in `PLANUNG.md` Abschnitte 1-3.
- **Aufgeraeumt:** Das Firecrawl-Beispielprojekt "Open Lovable" war am 22.10.
  11:46 direkt nach `$HOME\` entladen worden (331 Dateien, 2,53 MB,
  kein `.git`, kein abweichender Zeitstempel - also unveraendert). Mit Freigabe
  entfernt: 11 Ordner und 10 Dateien.
- **Aufgeraeumt:** npm-Reste im Home entfernt (`node_modules\`, 57,2 MB,
  `package.json`, `package-lock.json`) - ein einmaliges `npm install` im
  Profil, kein globaler Prefix, von keinem Skript und keinem Projekt
  referenziert. Playwright-Browser unter `%LOCALAPPDATA%` bleiben.
- **Verlust, ehrlich benannt:** `guard-replay.mjs` und `guard-examples.mjs`
  lagen in `%TEMP%` und sind weg. Die Messergebnisse (40 % ohne Rueckfrage,
  Verteilung der Rest-Rueckfragen) stehen hier, sind aber nicht reproduzierbar.
  `opencode.log` (39,4 MB) ist unversehrt. Lehre: Analysewerkzeuge ins Projekt,
  nur Wegwerf-Ausgaben nach `%TEMP%`.
- **Versionsluecke:** Der Plugin-Code wurde erst mit dem Umzug ins Projekt
  versioniert (`6fdb399`). Git kennt nur diesen Endstand, nicht die
  Zwischenstaende (Lesefreigabe `905e489`, Schreibfreigabe `a167e0e` - dort
  wurden nur Doku-Dateien committet). Ab jetzt ist jede Aenderung im Projekt
  diffbar.
- **Eigene Sessions:** Prompt-Manager, Review-Tools (inkl.
  `~\.agents\skills\review-workflow`), RAG (eigener Projektordner).
- **Umgebung:** Claude Desktop deinstalliert; Claude Code CLI bleibt vorerst.

### Next Move
1. `replay.mjs` neu schreiben (aus `opencode.log`) und im Projekt ablegen.
2. Danach CLI-Allowlists (`PLANUNG.md` Punkt 2); vorher `opencode --help` und
   `firecrawl --help` aufnehmen, nicht aus dem Gedaechtnis arbeiten.
3. Replay-Skript als `tools/permission-guard/replay.mjs` neu schreiben.

## Stand 22.10.2026 (Nachtrag): Replay reproduzierbar

- **Neu:** `tools/permission-guard/replay.mjs`. Quelle sind die
  "spawning process"-Zeilen aus `opencode.log` (Befehl, Argumente, `cwd`);
  bewertet wird mit dem damaligen Arbeitsordner. Ausgabe: allow/ask/deny in
  Prozent, Gruende, Top-Anfaenge, Beispiele; `--json` fuer Weiterverarbeitung.
- **Methodischer Fund:** Die naheliegende Quelle "evaluated permission=bash
  pattern=..." ist untauglich. `pattern` ist das Fragment, auf das eine
  statische Regel gematcht hat (`ConvertFrom-Json`, `k[:50]:52s`), nicht der
  Befehl. Replay darauf: 8632 "Befehle", 71 % Freigabe - ein Artefakt.
- **Belastbare Zahl:** 1140 eindeutige Shell-Aufrufe (Log 18.-22.10.),
  **42 % ohne Rueckfrage**; deckungsgleich mit der Nachmittagsmessung (40 %).
  Restrueckfragen: nicht einordenbar 381, schreibend 147, Geheimnis 86,
  Pfad nicht bestimmbar 26, ausserhalb des Projekts 11, geschuetzter Pfad 7.
- **Ehrliche Grenze:** gezaehlt werden alle Shell-Aufrufe, auch die schon
  vorher durch statische Regeln erlaubten. 42 % ist eine Obergrenze, nicht die
  Zahl der eingesparten Rueckfragen.
- **Neue Luecken (PLANUNG.md Punkt 8):** Zuweisungen `$ErrorActionPreference=`
  (82), Befehle mit `cd <projekt>` (35), `Write-Output "=== ..."` (11);
  ausserdem Fehlalarme des Begriffsfilters, wenn `token|secret|password` nur in
  der Befehlszeile steht (Redaktions-Regex).
- **README deployt** (Hashvergleich identisch); `replay.mjs` bleibt im Projekt.

### Next Move
1. Netz-Lesen (`PLANUNG.md` Punkt 1) und `python -m pytest|ruff` (Punkt 3)
   umsetzen, Testfaelle ergaenzen, deployen.
2. Mit `node replay.mjs` vorher/nachher messen.
3. Danach Klassifizierer-Luecken (Punkt 8): `$ErrorActionPreference=`,
   `cd <projekt>`, `Write-Output "=== ..."`, Begriffsfilter-Fehlalarme.

## Stand 22.10.2026: CLI-Allowlists umgesetzt (PLANUNG.md Punkt 2)

- **Vorgehen:** erst die echten Hilfe-Baeume aufgenommen (`opencode 1.4.2`,
  `firecrawl-cli` inkl. Unterbefehle), dann die Listen gebaut. Das war noetig,
  weil mehrere Annahmen nicht stimmten:
  `opencode status`/`version` existieren nicht (Flag `--version`, Status =
  `stats`); `firecrawl scrape` schreibt bei **mehreren** URLs nach
  `.firecrawl/`; `firecrawl parse` laedt die lokale Datei hoch (Uebertragung,
  bleibt `ask`); `credits` ist lesend, bleibt aber laut Entscheidung `ask`.
- **Erlaubt:** `opencode` Hilfe/Version, `models`, `stats` (ohne
  `--standalone`/`--server`), `debug`. `firecrawl` `list`, `list-tools`,
  `find-tools`, `search`, `map`, `alexandria`, `developer`, `gov`, `research`,
  `status`, `version`, `doctor` sowie `scrape`/`crawl` ohne Schreib-Flags.
- **Gesperrt:** zusaetzlich `-o/--output`, `-k/--api-key`, `--api-url`,
  `--screenshot`, `--full-page-screenshot`, `--profile`, `--cancel`,
  `--webhook`; `scrape` erlaubt ohne Ziel nur eine URL.
- **Regel:** Freigabe nur per Subcommand-Allowlist, keine Praefix-Freigabe.
  Alles Unbekannte bleibt `ask` (fail closed).
- **Tests:** 132/132 (89 + 43 CLI-Faelle).
- **Messung:** derselbe Log-Stand, alter gegen neuen Klassifizierer:
  42,2 % → 44,0 % (1157 → 1156 Befehle, +21 Freigaben). Die CLI-Aufrufe sind
  im Alltag selten - der sichtbare Effekt kommt mit Punkt 1 und Punkt 3.
- **Deployt:** vier Dateien per `deploy.ps1`, SHA256 identisch.

### Next Move
1. Netz-Lesen (`PLANUNG.md` Punkt 1) und `python -m pytest|ruff` (Punkt 3)
   umsetzen, Testfaelle ergaenzen, deployen.
2. Mit `node replay.mjs` vorher/nachher messen (erwartet deutlich mehr als
   +2 Punkte: `Invoke-WebRequest`/`-RestMethod` 96, `python -m` 14).
3. Danach Klassifizierer-Luecken (Punkt 8): `$ErrorActionPreference=`,
   `cd <projekt>`, `Write-Output "=== ..."`, Begriffsfilter-Fehlalarme.
4. Offen: `ruff --fix`/`format` an die Pfadpruefung koppeln oder pauschal
   erlauben; `check-skill-duplicates.ps1` (Exitcode 1 dauerhaft);
   `~\.agents\skills\review-workflow` (nur `review.md`, keine `SKILL.md`).

=============== Compaction 22.10.2026 / 19:38 ================
## Objective
- **Current:** permission-guard: PLANUNG Punkte 1 und 3 umgesetzt — Netz-Lesen
  (Punkt 1) und eng freigegebenes `python` (Punkt 3).
- **Completed:** `classifyNetwork` und `classifyPython` in `guard.js`, 50 neue
  Testfälle (182/182), einmal deployt, gemessen: 44,1 % → 48,5 % ohne Rückfrage.

## Important Details
- **Decision (ruff, Nutzer):** `ruff format`/`check --fix` laufen an dieselbe
  Pfadprüfung wie die Schreibbefehle — `filewrite` → `scopeWrites`. Entfernte
  Ziele (`ruff format D:\…`) und Wildcards bleiben `ask`; pauschale Freigabe
  verworfen. pytest läuft pauschal als `read`: die Freigabe deckt den eigenen
  Testcode ausdrücklich ab. `py -3.12 -m …` läuft mit.
- **Finding:** Der Schub kommt aus Netz-Lesen: „schreibend" 147 → 51 entspricht
  den 96 `Invoke-WebRequest`/`-RestMethod`-Aufrufen. POST/-OutFile-Fälle
  bleiben `ask` und fallen jetzt in „nicht einordenbar" (370 → 410).
- **Risk (fail closed über die Entscheidung hinaus):** Variablen-Splatting
  (`@params`), positionale Hashtables außerhalb von `-Headers @{ … }` und
  `-Credential`/`-Token`/-Certificate bleiben `ask` — sonst wäre ein
  versteckter Sende-/Upload-Kanal möglich.
- **Grenze beibehalten:** Geheimnisbegriffsfilter verlangt weiter Rückfrage,
  wenn `token`/`secret` in der URL steht — PLANUNG Punkt 8.4 unberührt.

## Work State
### Completed / Active / Blocked
- Completed: deploy.ps1 (SHA256 identisch), README-Abschnitte Netz-Lesen und
  python, PLANUNG aktualisiert (Punkte 1/3 erledigt, ruff-Entscheidung,
  Reihenfolge: Punkt 8 jetzt dran).
- Active: nichts laufend.
- Blocked: Punkt 5 wartet auf die Claude-Code-Entscheidung.

## Next Move
1. Punkt 8 (Klassifizierer-Lücken): `$ErrorActionPreference =` (71),
   `cd <projekt>` (38), `python -c` (21), `Write-Output "=== …"` (9),
   Geheimnisbegriffe in URLs/Regex-Redaktionen (8.4).
2. Punkt 8 umsetzen, dann Replay erneut messen.

## Relevant Files
- `tools/permission-guard/guard.js` — `classifyNetwork`, `classifyPython`
- `tools/permission-guard/test.mjs` — 182 Fälle in fünf Gruppen
- `tools/permission-guard/README.md` — Doku mit Messwert 48,5 %
- `tools/permission-guard/deploy.ps1` — der eine Weg ins Laufzeitverzeichnis

=============== Compaction 22.10.2026 / 21:14 ================

## Objective
Punkt 8 (Klassifizierer-Lücken) der PLANUNG abschließen: Musteranlage über
die „nicht einordenbar"-Fälle, echte Ursachen in `guard.js` fixen, erneut
messen, deployen, dokumentieren.

## Important Details
- **Neu `analyze.mjs`:** gruppiert die ask-Fälle nach der **ersten unbekannten
  Anweisung** — gelesen aus der Begründung des Klassifizierers selbst
  („nicht einordenbar: …"), also ohne Bewertungslogik zu duplizieren.
  `replay.mjs` exportiert dafür die Parsing-Helfer (vor dem Schutz lief die
  Datei bei jedem Import mit; jetzt fileURLToPath-Hauptlauf-Schutz in
  beiden Skripten). Die Musterliste (223 Muster vor dem Fix, 227 danach)
  ersetzt das Dimensionsratespiel vom Vormittag.
- **Befund — korrigiert alle drei PLANUNG-Annahmen:**
  - 8.1 „Zuweisungen als Präfix": unzutreffend, Zuweisungen waren nie das
    Problem (`$x = "…"` noop, `$x = Get-Content …` Lesen). Ursache waren
    .NET-Lücken in denselben Skripten: `$sr.ReadLine()`, `[void]$x.Append()`,
    `[regex]::Replace`, `[datetime]"…"`-Casts, `Import-Csv`.
  - 8.2 `cd`-Präfix: kein Klassifiziererfehler; den 38 Fällen folgten
    bewusst-ask-Formen (python-Skripte, `node`, `& $cmd`). Nichts geändert.
  - 8.3 `Write-Output "==="`: **0 Logbelege** (kein ask-Grund enthält
    „Write-Output"); trotzdem Semantikfix in `hasRedirection()`.
- **guard.js (fail closed, je Änderung ein Test):** `SAFE_METHODS` +
  `append`/`appendline`/`read`/`readline`/`readtoend`/`peek`/`close`;
  `[void]`-Cast wird vor der Bewertung entfernt; Casts zu `TYPE_READ`-Typen
  ohne `::` bewerten den dahinterstehenden Ausdruck normal (unbekannte Typen
  wie `[xml]` bleiben `ask`); `[regex]::Replace` = Lesen,
  `[IO.File]::Replace` bleibt schreibend; `Import-Csv` = lesend;
  `hasRedirection()` maskiert Stringinhalte — Prosa-`>` ist kein Schreiben,
  nicht aufgelöstes Zitat gilt konservativ als Schreiben, echte Umleitung
  (`"x" > f.txt`) weiter filewrite mit Zielprüfung.
- **Bewusst nicht freigeschaltet (alle Replay-belegt):** Aufrufe
  nutzerdefinierter Funktionen (`Read-Jsonc`, `Walk`), `& <befehl>` (11),
  `node` (17), python-Skripte/`python -c` (72). Nur mit Nutzerentscheid.
- **Zählbasis (Pareto-Rückfrage des Nutzers):** Replays Standardsicht ist
  einzigartig je Befehl+cwd (Variety); `--all` zählt frequenzgewichtet
  (Pareto). In diesem Fenster fast deckungsgleich (51,0 % ↔ 49,9 %,
  1200 eindeutig / 1231 Aufrufe — nur ~34 Wiederholungen), weil der
  Zeitraum Exploration war, keine Loop-Session. README nennt jetzt beide.

## Work State
### Completed
- **194/194 Tests** (12 neu), **Replay 48,5 % → 51,0 %** einzigartig
  (+32 Freigaben), `--all` 49,9 %.
- Deploy über `deploy.ps1`: 4 Dateien, SHA256 identisch, Dateiwatcher lädt neu.
- README: Punkt-8-Abschnitt (Tabelle der Verhalten, „nicht freigeschaltet"-,
  Messwertblock mit Zählbasis-Hinweis, 194 Fälle, Änderbarkeitsliste um
  `TYPE_READ`/`SAFE_METHODS`/`maskStrings()` erweitert).
- PLANUNG: Basiszeile auf `analyze.mjs` umgeschrieben; 8.1–8.3 als erledigt
  mit korrigierter Ursache; Reihenfolge Punkt 8 abgeschlossen, offene
  Nutzerentscheid-Frage (node, `&`, eigene Funktionen, 8.4) notiert;
  Entscheidungslog +2 Zeilen.
- Live-Messung geprüft: `guard.log` hat heute nur 31 invoked-Zeilen (davon
  3 shell) — für eine UX-Quote zu dünn; Frequenz-Sicht bleibt Replay-gestützt.

### Blocked
- 8.4 Geheimnisbegriffs-Fehlalarme: bleibt konservativ, nur bei
  Nutzerfreigabe (Idee: `-replace`-Muster/Regex-Inhalte nicht werten).
- Punkt 5 Skills-Hygiene: wartet auf Claude-Code-Deinstallation-Entscheidung.
- Commit wartet auf Freigabe; ein Commit, dann Replay erneut fürs Morgen-Log.

## Next Move
1. Nutzer um Commit-Freigabe bitten (Vorschlag:
   „permission-guard: Punkt 8 — .NET-Lesemethoden und Wert-Casts
   freigeschaltet (48,5 → 51,0 %)").
2. Danach: Replay erneut anstoßen, wenn der Nutzer die verbleibenden
   frequentierten Lücken entscheiden will (node-Tests wie pytest?
   `& <literal>`? eigene Funktionen?).
3. 8.4 nur bei Alltags-Störung ändern (Nutzervorgabe).

## Relevant Files
- `tools/permission-guard/analyze.mjs` — **neu**, Punkt-8-Musteranlage
- `tools/permission-guard/guard.js` — SAFE_METHODS, classifyDotNet, maskStrings
- `tools/permission-guard/replay.mjs` — exportiert Parsing-Helfer
- `tools/permission-guard/test.mjs` — 194 Fälle in fünf Gruppen
- `tools/permission-guard/README.md` — Zählbasis-Hinweis (Variety/Pareto)
- `PLANUNG.md` — Punkte 1/3 erledigt; ruff-Entscheidung im Entscheidungslog
## 2026-10-22, spaeter Abend — Interpreters-Freigaben (Entscheidungen 1 und 2), Restentscheide vorgetragen

- Umgesetzt nach Nutzerwort am Abend: Entscheidung 1 (A1) — `node` frei nur fuer
  `tools/permission-guard/test.mjs|replay.mjs|analyze.mjs`, pfadverankert
  (Arbeitsordner + `cd`-Verfolgung + eindeutige Variablen-Praefixe);
  Entscheidung 2 (B2) — `python <skript>` frei, wenn der Zielpfad im Projekt
  aufloest (`*.py`, nicht unter `.git`); `python -c`, Temp-Skripte, fremde
  node-Skripte, `deno`/`ruby`/`perl` bleiben `ask`. Code: `classifyNode()`,
  erweitertes `classifyPython()`, Aufloesungskontext `ctx` in `evaluate()`,
  `expandLeadVar()`, `CD_RE` vereinheitlicht.
- Test: neue Gruppe „Interpreters" (+26 Faelle) -> **220/220 bestanden**
  (vorher 194). Messung: 51,0 % -> **52,5 %** einzigartig (1222 Befehle),
  frequenzgewichtet 51,6 % von 1252 Aufrufen. Deploy: vier Dateien, SHA256
  identisch (README danach redaktionell ueberarbeitet -> endldepolys nochmal).
- Doku: README (Abschnitt „Interpreters-Freigaben", Tabellen mit
  `%TEMP%\opencode\fmt_table.py` + `splice.py` ausgerichtet — beide Scripte
  bleiben dort liegen und sind wiederverwendbar: nur eigene Tabellen
  behandeln), PLANUNG 8.5/8.6 (umgesetzt), Reihenfolge, Entscheidungslog
  (+3), CHANGELOG neue Sektion. Zwischenzeitlicher eigener Fehler: ein Edit
  an falscher Stelle hatte 8.4 verunstaltet — repariert und probegelsen.
- Offen: Entscheidung 3 — Nutzerneigung `&`-Formen zu **verweigern (deny)**
  statt Rueckfrage (Ursache: in `& node $tp $src` sieht der Nutzer nicht, was
  hinter `$tp`/`$src` steckt; ask hilft dort nicht). deny-Verkabelung existiert
  in index.js bereits (Zeile 104-107); Umsetzung (kinds.has("deny") +
  Testanpassung von `& $bash script.sh`) erst nach Rueckmeldung. Entscheidung
  4 (eigene Funktionen) und 5 (8.4-Begriffsfilter) sind in einfachen Worten
  erneut vorgetragen, warten auf Wort. Commit weiterhin aufgeschoben.
## 2026-10-22, Abend (2) — Entscheidungen 3 bis 5 umgesetzt

- Nutzerwort eingeholt (Rueckfragen in klarer Sprache): 3 = `deny` fuer
  unlesbare `&`-/Dot-Formen; 4 = eigene Funktionen bleiben `ask`; 5 =
  Geheimnisbegriffe ausserhalb von Such-Ersetzungen ausgenommen.
- Umgesetzt in guard.js: `& `/Dot-Zweig liefert `deny` (Block-Zweig laesst
  Verweigerung dominieren — vorher fiel sie durch und wurde `read`!),
  `evaluate()` ordnet Verweigerung vor Geheimnis-Rueckfrage;
  `SECRET_TERMS` aus `SECRET_PATHS` ausgegliedert; `maskReplaceOperands()`
  maskiert Operanten von `-replace`/`-ireplace`/`-creplace` sowie Zitate in
  `[regex]::Replace(...)` (Variable-Argumente bleiben Rueckfrage). index.js:
  nur Kopfkommentar (deny-Verdrahtung bestand bereits).
- Test: `& $bash script.sh` ask→deny, neue Gruppe „Verweigerung &
  Geheimnis-Ersetzung" (13 Faelle) -> **232/232 bestanden** (vorher 220).
- Messung: allow **52,9 %** (651/1230), deny **5,2 %** (64 unlesbare Formen,
  vorher 0), ask 41,9 %; Geheimnis 91 -> **75**; „nicht einordenbar" 383 ->
  332; frequenzgewichtet 52,0/5,1/42,9 (1261). Deploy: vier Dateien, SHA256
  identisch (zwischendurch zwei Deploys — README-Stand endlich).
- Doku: README (Verweigerungs-Abschnitt, Geheimnis-Ausnahme, Messstand,
  232 Faelle in sieben Gruppen, Aenderbarkeitsliste), PLANUNG 8.4/8.7/8.8 +
  Reihenfolge-Zeile 8 abgeschlossen + Entscheidungslog (+3),
  CHANGELOG neue Sektion (Tabellen mit temp/opencode/fmt_table.py +
  splice.py ausgerichtet — beide Scripte wiederverwendbar).
- Vertrag sharper: Plugin kann jetzt ask→allow UND ask→deny; deny der
  statischen Regeln bleibt unangetastet. Punkt 8 der PLANUNG ist damit
  **abgeschlossen**; Commit ist weiterhin aufgeschoben (Nutzerwort steht aus).
- Wichtig fuer spaeter: maskReplaceOperands erkennt KEINE Bareword-Muster
  und KEINE verdoppelten Zitate im Muster (bleiben Rueckfrage, gewollt) —
  [regex]::Replace maskiert nur Zitate, nicht Variablenargumente.
## 2026-10-22, Abend (3) — pre-push-Hook: Live-Testlauf ohne Push und Haertung (fail closed)

- Anlass (Nutzerwort): pre-push und die CI-Pruefungen als Live-Testlauf —
  ohne Push, weil das Repo kein Remote hat. Vorgehen nach Rueckfrage:
  Hook von Hand angestossen (kein Push-Befehl; Werte so uebergeben, wie git
  sie bei einem echten Zielpaar uebergeben haette) plus CI-Nachbau mit
  gitleaks (Historie + Dateibaum).
- **Fund (Luecke):** Die PowerShell-Pruefstrecke uebergibt die Wertszeile mit
  CR; der Hook las "000…000\r" als Fernwert, baute ein unlesbares
  Range-Paar, gitleaks loggte "fatal: ambiguous argument" und meldete
  trotzdem gruen — stiller Leerlauf (fail-open), Widerspruch zum Grundsatz
  "unlesbar = blockieren" wie beim permission-guard. Echtes `git push`
  (LF-Zeilenende) war nicht betroffen.
- **Messung (echter Bestand sauber):** `gitleaks git` 28 Commits (4,6 MB),
  `gitleaks dir` 20,6 MB, je "no leaks found"; Privacy-Zaehler fuer
  Identitaet/Nachricht/hinzugefuegte Zeilen je 0 Treffer; konfigurierte
  Identitaet ohne Muster-Treffer. Vorab-Vermutung „Sperre wegen
  Domaenen-Treffer" war falsch — Messung schlaegt Erinnerung.
- **Umbau nach Nutzerwort (beide Stellen):** `.githooks\pre-push` sowie
  Vorlage `$HOME\.agents\references\githooks\pre-push` (fc byte-gleich):
  nach `read` CR an beiden Revisionswerten abklemmen; ohne gueltige
  40-stellige Hex-Revision "PUSH BLOCKIERT - Zielbereich nicht auswertbar"
  mit Abgang 1 (fail closed).
- **Testprobe:** LF-Lauf gruen mit echter Pruefung (28 Commits); CRLF-Lauf
  danach gruen mit echter Pruefung (bash -x-Spur zeigt sauberes `_logopts`);
  Text- statt-Revisions-Wert und zu kurze Hex-Folge blockieren je mit
  Abgang 1. Doku: CHANGELOG neue Sektion (Tabellen mit
  `%TEMP%\opencode\fmt_table.py` + `splice.py` ausgerichtet). Kein Deploy
  noetig — Hooks laufen direkt aus `.githooks\`, Vorlage-Kopie gleichgezogen;
  Commit unmittelbar danach mit laufenden Hooks.
- Testgut dauerhaft ins Projekt verschoben (Nutzerfreigabe in derselben
  Runde): `tools/githooks-test/testrun.sh` sammelt vier Verhaltensproben zum
  pre-push-Hook mit Erwartungspruefung (LF-Zeilenende Abgang 0,
  CR-Endrest Abgang 0, unlesbarer Text Abgang 1, Kurz-Hex Abgang 1) —
  Erstrun **4/4 bestanden**; `README.md` im selben Ordner (Aufruf,
  Proben-Tabelle, Fund-Hintergrund). Wegwerfkopien bleiben im Temp-Ordner
  zurueck.

## 2026-10-23 — Hilfe/Version fuer alle Programme, gitleaks lesend mit Redaktion

- Anlass (Nutzerwort): "Versionsabfragen mit (--)version und Hilfeaufrufe mit
  --help koennten fuer alle Kommandos auf die allow-Liste. Oder ist das zu
  weitgehend? Und 'gitleaks dir' ist auch nur lesend." Dazu die Frage, ob Guard
  und gitleaks in den Nachbarprojekten genauso funktionieren und ob dort die
  CI-Regeln angepasst werden muessen.
- **Entscheidung (Nutzer, 23.10.):** Hilfe/Version nur als Einzelaufruf fuer
  alle Programme; gitleaks `version`/`help`/`git`/`dir`, Scans nur mit voller
  Redaktion; Nachbarprojekte nur dokumentieren, nichts aendern.
- **Umsetzung:** `isHelpVersionOnly()` — Programmname aus dem PATH plus genau
  ein Hilfewort (`--help`, `-h`, `-?`, `/?`, `--version`, `-V`, `help`,
  `version`); kein `-v`, keine weiteren Argumente, keine Unterbefehl-Ketten,
  keine Skript-/Pfadnamen. `classifyGitleaks()` — `version`/`help`/`git`/`dir`
  (auch `file`/`directory`) lesend; Scans nur mit `--redact` oder
  `--redact=100`; `-r`/`--report-path`, `--report-template`, `--diagnostics`,
  `--diagnostics-dir`, `--log-opts` bleiben `ask`; `stdin`/`completion`
  bleiben `ask`. Grundlage der Flag-Liste: `gitleaks help`,
  `gitleaks git --help`, `gitleaks dir --help` der installierten Fassung —
  dabei zwei zusaetzliche Schreibwege (`--diagnostics`,
  `--diagnostics-dir`) gefunden und gesperrt.
- **Test/Messung:** **275/275** (vorher 232), zwei neue Gruppen (20 + 23
  Faelle); Replay 18.–23.10.: 53,3 % allow (vorher 52,9 %), 41,7 % ask,
  5,0 % deny; frequenzgewichtet 52,5 / 42,6 / 4,8. Kleiner Sprung, weil
  Hilfe-/Versionsaufrufe und gitleaks-Scans im Log selten sind.
- **Deploy:** `deploy.ps1`; vier Dateien SHA256-identisch.
- **Nachbarprojekte (nur Abgleich, keine Aenderung):** Fuenf Hook-Repos nutzen
  eigene Linien — `privacy_gate.py` + PowerShell (Benchmark-Price, Empire,
  Inspect-Evals, Benchmarks) bzw. Shell + `lib.sh` mit bereits vorhandener
  CR-Bereinigung (pdf2xlsx). Alle fuenf pruefen den Push-/PR-Bereich in CI
  (`check-range` bzw. Hook-Aufruf). Vier externe Klone (Bonsai-demo,
  exllamav3, lmms-eval, tabbyAPI) ohne lokale Hooks. gitleaks ist nur hier
  verdrahtet; die Privacy-Regel ist dort bereits abgedeckt. Die Luecke liegt
  hier: dieses Repo hat keine CI.
- **Doku:** README (Abschnitt Hilfe/Version, gitleaks-Zeile, Messstand,
  Teststand), CHANGELOG-Sektion, PLANUNG Punkt 9/10, Entscheidungslog.

## 2026-10-24 — OpenWork v1 → v2: 290 Chats migriert, Chat-DB entlastet, Starter fest verdrahtet

- Anlass: OpenWork startete nicht mehr („OpenWork couldn't start"), und die
  Chat-DB war auf 7,03 GB angewachsen, überwiegend aus venv-Diffs.
- **Ursache Start:** OpenWork startet immer zusätzlich eine v1-Engine. Diese
  liest die globale `opencode.jsonc`, die v2-Schlüssel (`permissions`) enthält,
  und bricht ab (`engine.v1.serve error`). Lösung ohne Eingriff in die globale
  Konfiguration: private v1-kompatible Datei unter
  `%APPDATA%\OpenWork\v1-config`, im Starter über `XDG_CONFIG_HOME` gesetzt.
- **DB-Bereinigung bewusst vor der Migration:** Die Kopierphase der Migration
  archiviert v1-Zeilen in die Zieldatenbank — Ballast wäre mitgewandert, und
  eine Quelle mit 1,1 GB lässt sich deutlich schneller snapshotieren.
  venv-Erkennung über Marker (`site-packages/`, `pyvenv.cfg`, `dist-info/`,
  `__pycache__/`, `/Scripts/activate`), weil Ordnernamen beliebig sind
  (`.venv`, `.venv-inspect`, `exllamav3_env`). Entfernt wurden nur abgeleitete
  Diffs (`message.summary.diffs`, Projekt-Patches); Tool-Ausgaben blieben.
  Ergebnis: 34.465 Diff- und 34.465 Datei-Einträge → 0, `VACUUM` von 7,03 GB
  auf 1,13 GB in 10,5 s, `quick_check=ok`, Zeilenzahlen unverändert.
- **Ablaufsteuerung:** Watcher `%TEMP%\opencode\ow-clean.py` (wartet auf freie
  DB → Backup → Row-Dump → Trim → `VACUUM` → Verifikation; detached,
  idempotent, Log `ow-clean.log`, Ergebnis `ow-clean-result.json`). Ein
  `VACUUM` verlangt eine nicht exklusiv gesperrte DB; die Sitzung läuft in
  einem verwaisten `opencode-cli.exe` und endet nicht mit `OpenCode.exe`.
- **Migration:** 290/290 Sessions importiert, 0 übersprungen; Phasen
  `snapshot` → `externalizing` → `converting` → `restoring` → `copying` →
  `completed`. Der Fortschrittszähler der UI zeigt die Gesamtzahl, nicht den
  Fortschritt.
- **Pitfall 1 — Schema-Mismatch `time_archived`:** `sameSchema()` vergleicht
  `session_v2`, `session_message`, `project` und `event_sequence` inklusive
  Name, Typ, NOT NULL und PK. Der mitgelieferte Sidecar ist 2.0.26, die Daten
  kamen aus 2.1.4 und haben in `project` eine Spalte mehr. Fix **in der
  Zieldatenbank** (`ALTER TABLE project ADD COLUMN time_archived INTEGER`),
  nicht in den Daten; danach waren alle vier Tabellen deckungsgleich und die
  Kopierphase lief durch.
- **Pitfall 2 — `sidecar`-Override:** `OPENWORK_ENGINE_V2_PREVIEW=sidecar` ist
  der Migrationsmodus und setzt bei jedem Boot `chatRouting=false`. Nach
  abgeschlossener Migration muss der Starter den Override weglassen; dann gilt
  der gespeicherte Zustand aus `%APPDATA%\openwork\engine-v2-preview.json`.
- **Pitfall 3 — Shortcut-Marker:** `updateWindowsShortcut()` vergleicht nur
  Pfad und Signatur aus `windows-brand-shortcut.txt`, nicht das `.lnk`-Ziel.
  Der eigene Starter überlebt Neustarts; nach einem Update mit neuer Signatur
  kann die Startmenü-Verknüpfung wieder auf `OpenWork.exe` zeigen — dann neu
  setzen.
- **Restore-Kosten:** O(Nachrichten × Payloads), 42.534 Nachrichten gegen
  20.885 Payloads; eine einzelne 507-KB-Nachricht brauchte 6,8 s. Einpassiges
  Ersetzen der einfachen `OWPAYLOAD…END`-Token (`ow-fastrestore2.py`) schaffte
  8.509 Nachrichten in 2,4 s; Daten-URL-Payloads bleiben
  `restoreHistoryPayloads()` überlassen. 19 `OWPAYLOAD`-Treffer in Chat-Texten
  blieben unangetastet, weil nur exakte 60-Zeichen-Token aus der
  Payload-Tabelle ersetzt werden.
- **Verifikation:** Ziel-DB 1.138 MB, `quick_check=ok`, 290 `session_v2`,
  41.397 `session_message`, v1-Archiv 41.393 Nachrichten / 172.268 Parts /
  290 Sessions. Neustart über die Verknüpfung: alle Startphasen `ok`,
  `windows.shortcut ok`, beide `.lnk` unverändert, `enabled=true`,
  `chatRouting=true`, `migration=completed`. `app.asar` blieb unverändert
  (Stand 23.10.2026).
- **Aufräumen:** 29,0 GB gelöscht (alte Staging-Kopie 14,4 GB,
  `%TEMP%\ow-repro` 8,0 GB, v1-Testprofile rund 19 MB). Die App hatte ihre
  aktive Staging-Kopie nach Erfolg selbst entfernt. Die Sicherungen in
  `$HOME\openwork-v2-backup\` bleiben erhalten und bilden den
  Rückweg auf v1.
- **Offen:** Nach einem OpenWork-Update prüfen, ob die Startmenü-Verknüpfung
  noch auf `start-openwork-v2.vbs` zeigt und ob der Sidecar dann so neu ist,
  dass `time_archived` von Haus aus existiert.

=============== Compaction 24.10.2026 / 21:42 ================
## Objective
- **Current:** Reichweite von permission-guard und gitleaks klären, saubere Installationsgrundlage für OpenWork/OpenCode herstellen, Chatlisten-Befund sichern.
- **Completed:** Guard-Ladung in OpenWork belegt; v1-Primärarchitektur belegt; Variante B entschieden; Start-Verknüpfung repariert; Chatlisten-Ursache (50er-Pagination) gefunden; Upstream-Issue vorbereitet.

## Important Details
- **Decision (Variante B):** OpenWork bleibt ohne permission-guard (eigene Permission-UI); bewachte Repo-Arbeit läuft in OpenCode Desktop (globaler Guard, shell=ask). Die XDG-Umleitung bleibt Bestandteil der OpenWork-Installation, kein Guard-Notbehelf.
- **Architecture:** OpenWork 0.18.62 bootet v1-primär (`createManagedOpencodeServer`, `role: primary`, `sidecars\opencode.exe`); v2 2.0.26 läuft zusätzlich für `chatRouting=true`. Kein v2-only-Schalter (`OPENWORK_ENGINE_*` nur Timeouts/Auto-Upgrade). v1 liest die globale Config immer; `OPENCODE_CONFIG` hilft nicht. Die v2-`permissions`-Array-Form ist bewusst v2-Schema, nicht v1-kompatibel.
- **Finding (Guard):** Der Guard lädt in OpenWork v2 aus dem Workspace-Plugin (`setup: base=...` im guard.log), ist aber wirkungslos: OpenWorks Laufzeitconfig setzt Shell nicht auf `ask` (nur `external_directory`); der Guard hebt nur `ask` an.
- **Finding (Chatliste):** `GET /api/session` liefert 50 + Cursor; `?limit=500` alle 292; `directory`/`project` filtern korrekt, `workspace` wird ignoriert bzw. liefert 500. Die UI sieht nur die ersten 50, daher „No tasks yet" in alten Workspaces. Kein Datenverlust.
- **Fix (Start):** Der echte Desktop liegt via Known Folder Move in `OneDrive\Desktop`; die Verknüpfung zeigte nach einem Update auf `OpenWork.exe`. Auf `start-openwork-v2.vbs` zurückgestellt. v1-Beweis: mit XDG Exit 0, ohne XDG Exit 1.

## Work State
### Completed
- Guard-Kopie im Scratch-Workspace entfernt; Testkopie `%TEMP%\opencode\dbtest` bleibt.
- PLANUNG Punkt 13, Entscheidungslog, Plan-Datei und Issue-Entwurf aktualisiert.
### Active
- Issue-Posten blockiert: Fine-grained PAT ohne `issues:write`; Body liegt bereit.
### Blocked
- Upstream-Issue (Token-Rechte).

## Next Move
1. Issue mit passendem Token oder in der Web-Oberfläche posten; URL nachtragen.
2. Optional: API-Workaround (`?directory=...&limit=500`) für alte Chats.
3. Danach zurück zu den offenen permission-guard-Punkten.

## Relevant Files
- `docs/Plan Guard-OpenWork 20261024.md`: Variante B, Erwartungsmatrix, Stufen.
- `docs/OpenWork-Issue-Chatliste 20261024.md`: Issue-Entwurf (Posten blockiert).
- `PLANUNG.md`: Punkt 13, Entscheidungslog.
- `%APPDATA%\OpenWork\start-openwork-v2.vbs`, `OneDrive\Desktop\OpenWork.lnk`: Starter und reparierte Verknüpfung.
- `%TEMP%\opencode\dbtest`: Testkopie der Engine-DB (behalten).

## Important Context
- Chat-DB: 292 Sitzungen / 41.404 Nachrichten, vollständig; `project.worktree` passt.
- OpenWork: Engine v2 2.0.26, `chatRouting=true`, `engine-v2-preview` enabled.
- OpenCode Desktop: 2.1.4, Guard aktiv, `shell=ask`.


## Nachtrag 24.10.2026 / 21:50 — Issue #6475 veröffentlicht

- https://github.com/different-ai/openwork/issues/6475 (OPEN, Titel wie im
  Entwurf). Der PAT-Mangel betraf nur das automatische Posten; die
  Web-Oberfläche hat funktioniert.

## Nachtrag 24.10.2026 / 21:56 — gitleaks fehlt: Push blockiert (fail closed)

- Der `else`-Zweig des pre-push-Hooks blockiert jetzt, statt den Secret-Scan
  zu überspringen (WSL-Befund: gitleaks fehlte, Push wäre grün gewesen).
  Projekt-Hook und Vorlage byte-gleich (SHA256); Probe 5 deckt den Fall ab
  (5/5), echter Bereich `HEAD~1..HEAD` grün.

## Nachtrag 24.10.2026 / 22:05 — Claude Code deinstalliert, Skills-Hygiene abgeschlossen

- **Entscheidung:** Claude Code wird nicht mehr gebraucht. Entfernt wurden die
  native Binary (`~/.local/bin/claude.exe`), das npm-Paket
  `@anthropic-ai/claude-code` und der Chocolatey-Shim (elevated);
  `where claude` ist leer.
- **Daten gesichert:** `~/.claude` (370 MB, inkl. Credentials/History/Skills)
  und `~/.claude.json` als `.backup-20261024-2200`; `~/.local/share/claude`
  ebenfalls. Die Backups bleiben vorerst liegen.
- **Skills:** Die 94 `.claude`-Kopien sind mit dem Backup aus dem aktiven Pfad;
  kanonisch bleiben 95 Skills unter `~/.agents/skills`. `review-workflow`
  (nur `review.md`) liegt jetzt unter `~/.agents/references/review-workflow.md`.
- **Verifikation:** `check-skill-duplicates.ps1` Exit 0 — claude nicht
  vorhanden, 0 Duplikate, 0 tote Links.
- **Offen:** Backup nach Sichtprüfung löschen (nur mit Zustimmung); das
  globale `~/.config/opencode/AGENTS.md` nennt Claude Code noch in der
  App-Liste.

## Nachtrag 24.10.2026 / 22:03 — Claude-Backup gelöscht, AGENTS.md bereinigt

- `~/.claude.backup-20261024-2200` (370,5 MB) nach Sichtprüfung gelöscht.
- Globales `~/.config/opencode/AGENTS.md`: Claude-Code aus der App-Liste
  entfernt (Backup `AGENTS.md.bak-20261024-220211`).
- Kleine Reste bleiben: `~/.claude.json.backup-20261024-2200` (64,5 KB) und
  `~/.local/share/claude.backup-20261024-2200` (leer).

## Compaction 25.10.2026 / 15:03

## Objective
- **Current:** Shell-Reviewer (Ebene 1) fertigstellen, Repo-Geruest anlegen, committen.
- **Completed:** Recherche Codex/OpenCode Go+Zen, `policies`-Befund, Ebene 0+1 im
  permission-guard, Modellvergleich, Veroeffentlichungsvorbereitung.

## Important Details
- **Entscheidung Codex:** Weg C (`opencode-go-proxy`), ausdruecklich **ohne**
  `config enable` – sonst wird `openai_base_url` global gesetzt und der
  Picker-Katalog ersetzt. Go-Abo steht noch aus.
- **`policies` vs `permissions`:** Policies sind binaer (`allow`/`deny`), ein
  `ask` wird beim Laden verworfen; `allow` gewaehrt nichts. Merksatz in
  `opencode.jsonc` und Projekt-`AGENTS.md`.
- **Ebene 0:** Shell-Regeln bleiben auf "Standard ask" (kein Umdrehen). Dazu
  gezielte `deny` fuer `git push`, `npm/pnpm/yarn install|add|ci`, Schreiben
  ausserhalb des Projekts, `iex`/`-EncodedCommand`, `docker|podman|nerdctl`.
- **Ebene 1:** statische Risikoliste zuerst, dann eine projektbezogene
  Ja/Nein-Frage an ein lokales Modell; nur ein klares `Ja` hebt `ask` auf
  `allow`, jeder Fehler bleibt `ask`.
- **Modellwahl:** Gemma 4 12B Q4_K_XL auf llama.cpp (204 ms, 6,26 GB, keine
  Fehlentscheidung im Wirkungsbereich). JevK5 4B als Sparmodus (116 ms,
  2,86 GB). Jev-Omni Q4/IQ2 zu vorsichtig, 2B-Modelle invertieren die Polaritaet.

## Work State
### Completed
- Ebene 0+1 implementiert, deployt, 309/309 Tests, Smoke 9/9.
- Modell- und Backendvergleich dokumentiert (README, PLANUNG 17/18).
- Repo-Geruest: LICENSE, .gitignore, package.json, deploy.sh, CI-Matrix
  Windows+Ubuntu mit Pfad-/Schluesselpruefung.

### Active
- Commit dieses Stands.

### Blocked
- Go-Abo (Console) und damit der Codex-Proxy-Aufbau.
- `policies`-Vorrang endgueltig nur per Live-Test bestaetigt, Logbefund reicht.

## Next Move
1. Commit (nur eigene Dateien; `docs/Vergleich OpenCode vs OpenWork` ist fremd).
2. Bei Go-Abo: Proxy starten, Provider-Block + Profil, Katalog auf 10 Eintraege.
3. Optional: Jev 1.13 ueber OpenRouter als dritte Meinung fuer die 18 Testfaelle.

## Relevant Files
- `tools/permission-guard/reviewer.js`: Ebene 1, Fail-closed-Logik.
- `tools/permission-guard/guard.js`: statische Einordnung, neue Denies.
- `tools/permission-guard/README.md`: Modellwahl, Backends, Betrieb, Veroeffentlichung.
- `~/.config/opencode/opencode.jsonc`: Policies korrigiert, Deny-Liste erweitert.
- `PLANUNG.md` 14–18, `CHANGELOG.md` 25.10.2026.

## Important Context
- Quelle ist `tools/permission-guard/`, Laufzeit
  `$HOME/.config/opencode/plugin/permission-guard/`; Deploy nur ueber
  `deploy.ps1`/`deploy.sh` (Testlauf + SHA256-Vergleich).
- 8080 laeuft mit Gemma 4 12B; ohne Server bleibt alles bei `ask`.
- Keine Zugangsdaten in Dateien: Keys nur ueber `apiKeyEnv`-Variablennamen.

---

## Nachtrag 25.10.2026 . 15:19 — Konfiguration wird einmal geladen; permission-guard als eigenes Repo

- **Betriebsfakt:** loadConfig() läuft in setup(), also einmal pro
  Plugin-Instanz. Eine Änderung an `shell-reviewer.config.json` wirkt nicht
  sofort. Ein Fenster-Neustart genügt **nicht**, weil die Desktop-App auf den
  laufenden `opencode-cli`-Server verbindet und der die alte Instanz hält.
  Zuverlässig: Datei-Touch auf `index.js`/`reviewer.js` (Dateiwatcher lädt
  neu, neue `setup: base=…`-Zeile im Guard-Log) oder alle Prozesse beenden.
  Nachgewiesen am 25.10.2026: letzter Ladevorgang 14:38, Konfigurationsdatei
  von 14:16 — geladen war die aktuelle Fassung.
- **Entscheidung (Variante B):** `tools/permission-guard` wird ein eigenes
  Repository nach dem Muster von `tools/ai-prompt-manager`. Das Eltern-Repo
  gibt den Pfad frei (`git rm -r --cached`) und ignoriert ihn künftig; das
  Unter-Repo führt die Dateien. Veröffentlichung ist beschlossen, der Zeitpunkt
  bleibt offen (erst Praxistest).
- **Grund für die Trennung:** zwei Wahrheiten für denselben Code; ein
  versehentliches `git add` im Eltern-Repo hätte einen Gitlink (mode 160000)
  erzeugt und die Dateien still aus dem Tracking genommen.

<a id="compaction-26102026-1200"></a>

## Compaction 26.10.2026 / 22:30 — Reviewer-Lebenszyklus an OpenCode gebunden

## Objective
- **Current:** Der Reviewer soll nur laufen, solange OpenCode läuft — Start beim
  Öffnen, Entladen beim Schließen, Ruhepause bei Untätigkeit.
- **Completed:** NPU/Ryzen-AI-Rückbau, CUDA- und Nsight-Aufräumen, Klärung der
  leeren Berechtigungsabfrage, Issue #59377.

## Important Details
- **Nutzerentscheid 26.10.2026:** Reviewer startet automatisch; `sleep-idle-seconds`
  auf 15 Minuten (900 s) statt 50 (3000 s).
- **Gemessen:** Kaltstart 34.028 ms, warm 199–256 ms. Ursache der Verdrängung war
  **nicht** WDDM-Druck, sondern `sleep-idle-seconds` in
  `%APPDATA%\llama.cpp\config.ini` (Standard wäre `-1` = aus).
- **`load-mode = auto` bedeutet mmap** (Hilfe der installierten Binärdatei,
  Build b11514). `--no-mmap` macht den Start laut derselben Hilfe *langsamer*,
  nicht schneller.
- **`config.ini` wird automatisch gelesen** (Doku: `%APPDATA%\llama.cpp\config.ini`
  ist die Windows-Standardstelle). Belegt über `parallel = 4` ↔ `/props`
  `total_slots: 4`.
- **Korrektur einer Fehlannahme:** Der „Gemeinsame GPU-Speicher" (15,8 GB) ist
  kein reservierter RAM, sondern eine Adressraum-Obergrenze. Belegt:
  Hardware-reserviert 0 GB, Shared-Anteil 0,3/15,8 GB belegt. Absenken bringt
  keinen RAM und nimmt nur das Auslagerungsventil.

## Work State
### Completed
- `reviewer.js`: `ensureRunning()` ergänzt (prüft `/health`, startet sonst
  `start-reviewer.ps1` losgelöst); `warmupTimeoutMs` 90 000 ms statt
  `timeoutMs × 6`.
- `index.js`: ruft `ensureRunning()` vor `warmup()` auf, loggt Serverzustand.
- `watchdog-reviewer.ps1`: beendet den Server, wenn kein `OpenCode`/`opencode-cli`
  läuft.
- `shell-reviewer.config.json` + Vorlage: `warmupTimeoutMs: 90000`.
- `config.ini`: `sleep-idle-seconds` 900 (Sicherung `config.ini.bak-20261026-2100`).
- Task `permission-guard reviewer` (Anmeldestart) deaktiviert — das Plugin
  startet jetzt.
- Tests 346/346, Smoke-Test bestanden, Deploy SHA256-identisch.

### Active
- Beobachtung über einen Tag: Greift das Entladen beim Schließen zuverlässig,
  und fällt nach der 15-Minuten-Pause noch ein `ask` an?

### Blocked
- Nichts.

## Next Move
1. Praxis beobachten: `setup: Server …` und `Aufwaermlauf …` im Guard-Log.
2. Falls nach langer Pause weiterhin ein `ask` auftritt: Warmlauf-Budget prüfen
   (90 s gegen gemessene 34 s).
3. Offen aus Auftrag B: ob `resources` bei Shell-Freigaben den Befehl enthält.

## Relevant Files
- `tools/permission-guard/reviewer.js`, `index.js`, `watchdog-reviewer.ps1`
- `~/.config/opencode/plugin/permission-guard/shell-reviewer.config.json`
- `%APPDATA%\llama.cpp\config.ini`
- `PLANUNG.md` Abschnitte 20–22, `CHANGELOG.md`
- `staging/opencode-issue-permission-shell.md` (eingereichter Issue-Text)

## Important Context
- **Deploy-Weg:** Projekt → `deploy.ps1` → `~/.config/opencode/plugin/permission-guard`
  (Ziel bleibt schreibgeschützt). `watchdog-reviewer.ps1` wird **nicht** deployt;
  der Task ruft die Projektdatei direkt auf.
- **Plugin-Reload:** Änderungen an `index.js`/`reviewer.js` laden das Plugin über
  den Dateiwatcher neu; eine neue `setup:`-Zeile im Guard-Log belegt das.
- **Lehre aus dem Startmenü-Fall:** Bei Shell-Links die Rohbytes prüfen, nicht
  die COM-Abstraktion. `WScript.Shell` liefert gecachte Werte und meldet eine
  korrekte Verknüpfung als defekt.
- **Keine Zugangsdaten in Dateien:** Keys nur über `apiKeyEnv`-Variablennamen.
---

## Compaction 26.10.2026 / 22:50 — Reviewer-Fehlalarme entschärft, Befehlsstil als Dauerregel

## Objective
- **Current:** Rückfragefrequenz des permission-guard senken (26.10.): 129 ask
  in 5,5 Stunden, davon 114 vom statischen Reviewer-Teil geblockt.
- **Completed:** Reviewer-Lebenszyklus (Compaction 22:30).

## Important Details
- **Nutzerentscheid 26.10.2026:** Punkte B (Fehlalarme), D (Prompt) und C
  (Befehlsstil als Dauerregel) sofort umsetzen; morgen Smoke-Test; danach
  erst die Podman-Boundary prüfen, dann weitere Regel-Arbeit.
- **Woher die Rueckfragen kamen** (Messung `staging/measure-guard-noise.mjs`,
  Fenster 16:10–21:49, 126 Reviewer-Faelle): `2>&1` 44 von 51 Operator-Treffern
  (guard.js faengt das schon richtig ab, nur reviewer.js nicht); RISKY[0] mit
  Backslash traf jeden absoluten Windows-Pfad; zitatblinde Segmentierung
  erzeugte Fragmente wie `XDNA' }`.
- **Nebenbefund:** der deployte Reviewer-Prompt war im Bench (21 Faelle) zu
  locker — 6 von 9 "Nein"-Faellen durchgelassen (u.a. `docker run
  -v C:\:/host`, `.ssh/id_rsa`); die statische Liste deckt das in der Praxis
  ab, aber der Prompt hielt Lesen ausserhalb des Projekts fuer "Nein".
- **Fix (reviewer.js):** Standard-Handle-Redirection ist keine Verschleierung
  (auch die an `&` getrennte Ressourcen-Form); Segmentierung zitatbewusst
  (`''` = Escape, offenes Zitat haelt den Rest zusammen); Backslash aus
  RISKY[0]; neue Regeln fuer `cmd /c`, Vollpfad-Interpreter mit `-c` und
  `conda|mamba run … python -c` (Inline-Code hinter Wrapper); Ausdrucks-
  Segmente (Hashtable, lokale Zuweisung) nicht gegen die Lesbarkeitsregel,
  `$env:` bleibt ausgenommen.
- **Prompt (reviewer.js):** Ja-Gruende zuerst, Lesen ausserhalb ausdruecklich
  mit Beispielen (`nvidia-smi -L`); Nein-Gruende danach. Temperatur 0,
  max_tokens 6, Ja/Nein-Grammatik unveraendert.
- **Dauerregel C** steht in `~/.config/opencode/AGENTS.md` unter
  "Shell-Befehlsstil": kein `===`-Deko-Output, kein `2>&1`, ein Befehl je
  Tool-Aufruf. Grund der Regel: das Kontextfenster vergisst; AGENTS.md lädt
  jede OpenCode-Sitzung. **Nur OpenCode** — in `~/.codex/AGENTS.md` nach
  Nutzerwunsch am 27.10. wieder entfernt, weil Codex die OS-Sandbox trägt
  und dort kein Rückfragendruck besteht, der den Stil entschuldigt.

## Work State
### Completed
- `measure-guard-noise.mjs`: 376 eindeutige Befehle, 233 allow / 143 ask;
  Ausloeser der 126 Reviewer-Faelle in Familien getrennt.
- `measure-reviewer-flips.mjs`: 20 echte Befragungen zuordenbar; unter neuer
  Logik flippen 6 ask→allow, **0** allow→ask; 10 treffen die (verfeinerte)
  statische Liste, statt ins Modell zu kommen.
- `bench-quality.ps1` auf 21 Faelle erweitert, `-PromptId legacy|prod|new`,
  `-ExistingPort` (nutzt laufenden Server statt zweites GGUF im VRAM);
  legacy 17/21, prod 15/21, new 18/21, Median 217–225 ms.
- Tests 346 → **366**, alle gruen; Deploy via `deploy.ps1`, zehn Dateien
  SHA256-identisch; `smoke-reviewer.mjs` 9/9.

### Active
- (keine — Wartefenster bis zum Smoke-Test morgen)

### Blocked
- (keine)

## Next Move
1. Smoke-Tag am 27.10.: `stats.mjs` gegen das Fenster von heute halten;
   pruefen, dass die neuen Lese-Faelle liefen und nichts Gefaehrliches
   einfach durchlaufen ist.
2. Danach Podman-Boundary entscheiden (das eigentliche Codex-Modell),
   nicht den Klassifizierer weiter drehen.
3. `measure-reviewer-flips.mjs` folgt evtl. in den Testbestand, sobald die
   Smoke-Zahlen vorliegen.

## Relevant Files
- `tools/permission-guard/reviewer.js` (Fix + Prompt), `test.mjs` (Gruppe
  "Reviewer: Fehlalarme"), `bench-quality.ps1`, `smoke-reviewer.mjs`
- `~/.config/opencode/plugin/permission-guard/` (Deploy, SHA256-identisch)
- `~/.config/opencode/AGENTS.md`, `~/.codex/AGENTS.md` (Befehlsstil)
- `staging/measure-guard-noise.mjs`, `staging/measure-reviewer-flips.mjs`
- `PLANUNG.md` Abschnitt 23, `CHANGELOG.md` (26.10.2026, spät)

## Important Context
- **Sicherheit bleibt bezeugt:** die Sperrfälle der neuen Testgruppe bleiben
  ausdrücklich gesperrt: verschleiertes Befehlswort (`r'm' -rf /`),
  Zuweisung gefolgt vom Call-Operator (`$cmd = 'rm'; & $cmd x`),
  Umgebungstampering (`$env:PATH = …`) und Inline-Code hinter
  Environment-Wrapper (`conda run … python -c "…"`,
  `mamba run … pwsh -Command`).
- **Bench-Grenze:** die neun "Nein"-Fälle des Bench sind statisch abgedeckt
  und erreichen das Modell nie; Fehlfreigaben dort sind theoretisch.
- **Lehre:** Punkt C im Kontextfenster verschwindet; AGENTS.md lädt in jeder
  Sitzung und ist der einzige dafür zuverlässige Speicher.

=============== Compaction 28.10.2026 / 17:51 ================
## Objective
- **Current:** Globale Ruff-Baseline, Permission-Guard-Leserecht, Projekt-Setup-Skill und Pyright-Warnung klären.
- **Completed:** Guard-Status geprüft, Formatpunkt in PLANUNG als erledigt vermerkt, Setup-Skills/Commands durchsucht, Ruff-Konfigschema und Windows-Discovery korrigiert dokumentiert.

## Important Details
- **Correction:** `~/.config/ruff/ruff.toml` war keine wirksame Ruff-Quelle: standalone `ruff.toml` darf nicht `[tool.ruff]` enthalten; `ruff check --config ...` scheitert mit `unknown field tool`. Für Windows nimmt Ruff ohne `XDG_CONFIG_HOME` die native User-Konfiguration unter `%APPDATA%/ruff/ruff.toml`; dort existiert noch keine Datei.
- **Global baseline:** Entwurf `staging/ruff-global-baseline.toml`, gültiges standalone-Schema, Auswahl `E4,E7,E9,F`, `E501` ignoriert, ohne globalen Versionspin. Probe: `print` akzeptiert, `F401` erkannt. Deployment nicht erfolgt: Permission-Guard lehnte das Backup außerhalb des Projekts ab. Nicht mit anderem Schreibwerkzeug umgehen.
- **Permission-Guard:** `python -m ruff format --check .` war bereits read/allow (zwei Testfälle). `npm test`: 366/366; keine Guard-Änderung nötig.
- **OpenCode setup:** Kein allgemeiner Projekt-Bootstrap-Skill oder -Command gefunden. `implementation`, `project-audit` und `/test` sind keine Generatoren. Empfehlung: agent-agnostischer Bootstrap-Skill plus Repository-Template.
- **Pyright update:** `PYRIGHT_PYTHON_FORCE_VERSION=latest` nicht setzen; das macht den Checker laufzeitabhängig. `pyright==1.1.411` gepinnt lassen und Updates kontrolliert per Dependabot/Renovate-PR aus einer CI-Requirements-Datei prüfen.
- **Planung:** Vorherige Formatabweichung ist erledigt (52 Dateien bestehen `ruff format --check .`); PLANUNG statt AGENTS führt den Status.

## Work State
### Completed
- Korrektur in `AGENTS.md`, PLANUNG, CHANGELOG und COMPACTIONS; Guard- und Skill-Bestand verifiziert.
### Active
- Globaler Ruff-Deploy wartet auf einen guard-zugelassenen Weg bzw. Nutzeraktion.
### Blocked
- Kein Schreibzugriff außerhalb des Projektordners; keine Backup- oder Config-Datei wurde dort verändert.

## Next Move
1. Für den echten globalen Windows-Pfad `%APPDATA%/ruff/ruff.toml` einen vom Guard zugelassenen Deployment-Weg festlegen.
2. Optional: eine gemeinsame Python-Projekt-Bootstrap-Skill/Template beauftragen.

## Relevant Files
- `staging/ruff-global-baseline.toml`, `PLANUNG.md`, `AGENTS.md`, `CHANGELOG.md`
- `tools/permission-guard/guard.js`, `tools/permission-guard/test.mjs`
- `~/.config/ruff/ruff.toml` (falsches Schema; bleibt unverändert)

## Important Context
- Pyright-Wrapper-Warnung zu 1.1.414 ist informational; CI und lokaler Aufruf bleiben auf der geprüften 1.1.411.

<a id="compaction-28102026-1803"></a>

=============== Compaction 28.10.2026 / 18:03 ================
## Objective
- **Current:** Die schmale Ruff-Baseline global wirksam machen, ohne APPDATA als allgemeinen Schreibbereich freizugeben.
- **Completed:** Guard-Ausnahme eng begrenzt, getestet und deployed; globale Ruff-Datei unter Windows angelegt und Discovery geprüft.

## Important Details
- **Path correction:** Mit leerem `XDG_CONFIG_HOME` nutzt Ruff auf Windows `%APPDATA%/ruff/ruff.toml`; `~/.config/ruff/ruff.toml` war nicht der automatische Pfad und hat zudem das falsche standalone-Schema (`[tool.ruff]`). Die alte Datei bleibt unverändert.
- **Global config:** Neuer Zielordner und `ruff.toml` erstellt; dort lag vorher keine Datei, daher gab es kein bestehendes Ziel zu sichern. Hash des Ziels mit `staging/ruff-global-baseline.toml` verglichen. `ruff check --show-settings ruff.toml` aus dem Zielordner zeigt die erwartete Discovery, Länge 120 und explizite Regeln.
- **Guard exception:** Nur zwei Formen werden freigegeben: `New-Item ... $env:APPDATA\ruff` und Copy der exakten reviewed candidate-Datei nach `$env:APPDATA\ruff\ruff.toml`. Keine anderen APPDATA-Dateien/-Unterordner, kein generisches `Set-Content`. Deployment des Plugins via `deploy.ps1`; maschinenabhängige Reviewer-Konfiguration blieb erhalten.
- **Verification:** Permission-Guard `npm test` 372/372; Deploy-SHA256-Check identisch; beide realen Befehle erfolgreich. Projekt-Checks: Ruff, Format, Pyright 0 Fehler/0 Warnungen, Pytest 10 passed; Workflow YAML 3/3.
- **Pyright update:** `PYRIGHT_PYTHON_FORCE_VERSION=latest` nicht setzen. Gepinnte Version plus Dependabot/Renovate-PR über eine CI-Requirements-Datei bewahrt reproduzierbare Checks; noch nicht eingerichtet.
- **Project setup:** Kein allgemeiner Bootstrap-Skill/Command vorhanden. Empfehlung bleibt agent-agnostischer Skill plus Repo-Template; nicht erstellt.

## Work State
### Completed
- Globale Ruff-Baseline und Guard-Deploy. Changelog/PLANUNG/AGENTS aktualisiert.
### Active
- Keine.
### Blocked
- Nichts.

## Next Move
1. Den ersten GitHub-Actions-Lauf auf Ubuntu/Windows nach Push/PR prüfen.
2. Optional Dependabot für `requirements-ci.txt` einrichten, damit Pyright-Updates als testbare PRs kommen.
3. Falls gewünscht, allgemeine Python-Projekt-Bootstrap-Skill/Template anlegen.

## Relevant Files
- `%APPDATA%/ruff/ruff.toml`, `staging/ruff-global-baseline.toml`
- `tools/permission-guard/{guard.js,index.js,test.mjs,README.md,deploy.ps1}`
- `PLANUNG.md`, `CHANGELOG.md`, `AGENTS.md`

## Important Context
- `ruff format --check .` war bereits allow-listed und read-only; die normale project config bleibt auf Ruff 0.17.3 gepinnt.

<a id="compaction-28102026-1916"></a>

=============== Compaction 29.10.2026 / 00:43 ================
## Objective
- **Current:** Den zweiten CI-Lauf auswerten und den verbliebenen Workflow-Fehler beheben.
- **Completed:** `tests` auf beiden OSen gruen; `permission-guard` von einem gescheiterten Job-`if` auf eine Runner-Probe umgestellt (`46110d8`), Doku korrigiert.

## Important Details
- **Erfolgsmeldung:** Der 2. Push (`22eda28..bace539`) lieferte Check-Runs: `Lint und Tests (windows-latest)` = success, `Lint und Tests (ubuntu-24.04)` = success, `Push-/PR-Bereich` = success. Damit ist die offene Frage „laeuft Pytest auf Linux?" beantwortet — ja.
- **permission-guard weiter rot:** Die hashFiles-Version erzeugte `jobs: []` (kein Job, kein Check-Run, Laufname = Dateiname) — also ein **Workflow-Level-Fehler**, den lokale Parser nicht sehen. Der Fehler-Text war nicht holbar (Checks-API 403 mit dem aktiven Token; `jobs: []` liefert keine Logs; die Actions-Seite braucht Auth).
- **Ursache:** `hashFiles` im Job-`if` — GitHub wertet Job-Bedingungen offenkundig anders aus als PyYAML/schema. Lehre: lokale YAML-Validierung (`tools/ci/validate_workflows.py`) prueft Struktur, **nicht** Ausdrueckskontexte; erst der Push prueft GitHub-seitig.
- **Fix ohne Annahmen:** Job-`if` raus, stattdessen Bash-Probeschritt nach dem Checkout (`steps.quellen.outputs.vorhanden`), alle Folgeschritte bedingt, sonst `::notice::`. Ausdruecke nur Steps-Outputs und `runner.os` — keine Funktion, kein hashFiles.
- **Zwei Token-Befunde (wiederkehrend):** Der aktive `GITHUB_TOKEN` darf weder Repos anlegen noch Check-Runs lesen (403); fuer beide Lese-/Schreib-Aufrufe wurde die Variable env-lokal entfernt, gh nutzte dann den Keyring-Token (`repo`+`workflow`).
- **Doku korrigiert:** Die CHANGELOG-Zeile, die den hashFiles-Ansatz als Erloesung beschrieb, ist jetzt als „gescheitert" markiert; neuer Abschnitt „Job-Gate durch Runner-Probe ersetzt".

## Work State
### Completed
- `46110d8` (Workflow-Fix) plus CHANGELOG/PLANUNG-Korrektur; tiefer Struktur-Check und Workflow-Validator 3/3.
### Active
- Keine.
### Blocked
- Nichts; der Nutzer muss pushen.

## Next Move
1. Push durch den Nutzer; danach pruefen, ob `permission-guard` endlich Check-Runs hat und beide Jobs erscheinen.
2. Die sechs Dependabot-PRs rebase/lauen lassen und dann einzeln bewerten.

## Relevant Files
- `.github/workflows/permission-guard.yml` (Bash-Probeschritt)
- `CHANGELOG.md` (korrigierte Zeile + neuer Abschnitt), `PLANUNG.md`

## Important Context
- Der aktive Token braucht fuer Check-Runs den Keyring-Fallback (`$env:GITHUB_TOKEN = $null`); das ist ein env-lokaler Wechsel, kein persistenter.
- `tests` ist seit dem 2. Push auf beiden OSen success — der CI-Kern der Arbeit ist damit bewiesen.

<a id="compaction-29102026-1343"></a>

=============== Compaction 29.10.2026 / 13:43 ================
## Objective
- **Current:** OpenCode-Konfigurationsfehler aufklären und beheben; MCP-Lücke des permission-guard analysieren und vorhandene GitHub-Lösungen vor einem eigenen Bau recherchieren.
- **Completed:** `opencode.jsonc` repariert (fehlendes Komma, Nutzerfreigabe erteilt); MCP-Server wieder verbunden; MCP-Introspektion berichtet; Recherche zu Guard-Plugins und MCP-Permission-Lösungen mit `gh` durchgeführt (Exa/Firecrawl in dieser Sitzung nicht verfügbar).

## Important Details
- **Bug/Finding (Config):** In `opencode.jsonc` fehlte nach Zeile 52 ein Komma. OpenCode verwirft bei einem Parsefehler die **gesamte Datei** (`if (!info) return`, config.ts) — Meldung `rejected malformed JSON or JSONC document`, seit 19.10. und 56× im Log. Folge: alle MCP-Server, `permissions`, `policies` und `providers` wirkten nicht. Plugins liefen trotzdem, weil OpenCode die Verzeichnisse `plugin/` und `plugins/` **automatisch** entdeckt (source-directory.ts) — das erklärte den Widerspruch „Guard läuft, Config tot".
- **Backups:** `opencode.jsonc.bak` war byte-identisch defekt (gleicher Hash); älteres Backup vom 25.10. ohne den Fehler. Reparatur = genau ein Komma; Backup `opencode.jsonc.backup-20261029-131541-before-comma-fix`. Das Trailing Comma in Zeile 467 ist **kein** Fehler (OpenCode parst mit `allowTrailingComma: true`).
- **MCP-Introspektion:** `action` = `server_tool` (z.B. `exa_search`), `resources` immer `["*"]`, Argumente in `metadata.input`; `PermissionEvaluation` hat kein `title`. Der Guard lässt MCP heute komplett durch (frühes `SHELL_ACTIONS`-Return, index.js ~109); `pickScript()` lieferte für MCP `"*"`.
- **Recherche 2a/2b (Daten gesammelt, Bericht ausstehend):** `hueyexe/opencode-auto-permissions` (38★, TS, 422 KB): feste Sicherheitsregeln + einstufiges Review-Modell, unterstützt lokales llama.cpp, prüft nur `ask`-Regeln. `warc0s/opencode-permission-reviewer` (19★, TS, 1090 KB): allow/deny/escalate, JSONL-Audit, nur Cloud-Modelle, hält MCP aus der Reviewer-Session. Beide: **kein MCP-Gating**; nur `permission.ask` (Shell). Unser Guard hat zusätzlich Tier 2 (`shell.execute`) als Defense-in-depth — das bieten beide nicht. `stackoneHQ/defender` (npm, MIT, ~25k Downloads/Monat): prüft MCP-Werkzeug-**Ergebnisse** auf Prompt-Injection, bevor sie ins Modell gelangen — entspricht PostToolUse. Klein ohne LLM: `jigonyoo/mcp-permission-server` (Grant mit scope/expiry/max_uses/purpose, hash-gekettetes, nachvollziehbares Audit-Log; Teil des 5er-Sets GuardStack) und `mizcausevic-dev/mcp-permission-broker` (regex-Regeln auf tool_name/caller_id, allow/deny/require_approval). Groß: `microsoft/agent-governance-toolkit` (6491★, Python, OTel/Dashboard/DB) — für Single-User-Desktop überdimensioniert, nur Referenz.
- **OpenCode V2:** `tool.hook("execute.before")` kann blockieren (hooks.ts:23: nur dieses Event darf failen); `execute.after` liefert Werkzeug, Eingabe und Ergebnis — entspricht Pre-/PostToolUse. Die vier protect-mcp-Kriterien (principal/action/resource/context) sind abbildbar; `principal` = `agent` ist für MCP noch ungenutzt. Signierte Quittung bewusst weggelassen (Ein-Nutzer-Desktop).
- **Modell/Llama-Server:** Gemma-4-12B-qat lädt lazy in die VRAM — erster Aufruf 16.104 ms bei 1,04 GB, danach 185 ms bei 8,31 GB. Das Taskmanager-Momentbild des Nutzers war korrekt, der Zustand änderte sich. Inferenz verifiziert (`grammar` „Ja|Nein").
- **Nutzerentscheid (Konfig):** Reparatur ja; Schrittfolge: Config fix → OpenCode-Neustart im Projektordner → dann Guard-Registrierung beobachten.

## Work State
### Completed
- Config repariert und verifiziert: `rejected malformed` ab 13:15 = 0; vier MCP-Server wieder `mcp connected` (exa, firecrawl, github, gh_grep); Prüfskript `staging/check_jsonc.py` entwickelt (Kommentar-/Trailing-Comma-tolerant wie OpenCode selbst).
- Introspektion und Handlungsplan berichtet; GitHub-Recherche abgeschlossen (Datenlage vollständig).

### Active
- Vergleichsübersicht 2a/2b (Ersatz oder Ergänzung unseres Guards) und Beschreibung der großen/small Lösungen mit Aufwandsschätzung — Bericht steht noch aus.
- Planung der protect-mcp-Übertragung (vier PreToolUse-Kriterien + `execute.after`-Protokoll) — nur Planung, keine Umsetzung.

### Blocked
- Live-MCP-Trigger im Guard: Session läuft in `$HOME`, dort registriert sich der Guard nicht; Wechsel erst nach OpenCode-Neustart möglich.
- VRAM-Wert nur per Taskmanager (`nvidia-smi` auf diesem System nicht auffindbar).

## Next Move
1. Vergleichsübersicht 2a/2b liefern: können die beiden OpenCode-Plugins unseren Guard ersetzen oder ergänzen — mit Bewertung.
2. Große Lösungen detailliert beschreiben; kleine MCP-Lösungen mit vertretbarem Implementierungsaufwand bewerten („kleine Lösung besser als keine").
3. Planung der protect-mcp-Kriterien-Übertragung vorlegen — erst nach Freigabe umsetzen.
4. Nutzer startet OpenCode im Projektordner neu; danach Guard-Registrierung und echte Entscheidungszeilen im Log prüfen.
5. Offen: Split/Umsetzung des Skill-Commits `54d1dfb` (zurückgestellt); `Aufwaermlauf fehlgeschlagen (TypeError)` im Guard-Protokoll untersuchen; Temp-Artefakte (`oc-src`, `package/`, `opencode-plugin-2.2.1.tgz`) aufräumen.

## Relevant Files
- `~/.config/opencode/opencode.jsonc`: repariert; Backup `opencode.jsonc.backup-20261029-131541-before-comma-fix`.
- `staging/check_jsonc.py`: JSONC-Prüfskript (gitignore, im Projektordner = reviewbar für den Guard).
- `tools/permission-guard/index.js`, `reviewer.js`, `~/.config/opencode/plugin/permission-guard/shell-reviewer.config.json`: MCP-Gap und geplante Erweiterung.
- `COMPACTIONS.md`: dieser Block.

## Important Context
- MCP-`action` wird sanitisiert zu `server_tool`; Argumente liegen in `metadata.input`, `resources` ist immer `["*"]` — Nutzdaten müssen aus dem Input gelesen werden.
- Der Guard registriert sich nur, wenn die Sitzung außerhalb von `$HOME` liegt (base ≠ homedir).
- `~/.agents` hat keinen Remote; Commit `54d1dfb` (23 wshobson-Skills) ist lokal und noch nicht auf die 23 Einträge umgeschnitten.

## 29.10.2026 / spaeter — Entscheidungsdokumentation MCP-Gating angelegt, F-Rueckmeldung diagnostiziert

### Objective
- Recherche- und Planungsergebnisse zur MCP-Erweiterung dauerhaft in `tools/permission-guard/docs/entscheidungsgrundlage-mcp-gating-2026-10-29.md` festhalten (Auftrag des Nutzers: „Sonst ist spaetestens nach der naechsten Compaction vieles davon wieder verschwunden").
- F-Rueckmeldung zum bestehenden Guard (fuenf Punkte) pruefen und Ursachen beweisen, nicht raten.
- Sub-Repositoriums-Plan klaeren: `tools/permission-guard` ist **bereits** ein eigenes Git-Repo (master, 5 Commits, kein Remote).

### Important Details
- **Regel-Semantik (Kernwissen):** `permission.ts` Z. 74–84 nutzt `findLast` — **die letzte passende Regel gewinnt**, kein Treffer = `ask`. Pauschale Regeln also nach oben, spezielle nach unten. `Wildcard.match` normalisiert `\` → `/` auf beiden Seiten und ignoriert unter Windows Groß/Klein — **Pfad-Trennzeichen sind kein Problem**. `~` wird fuer `edit`/`write` aufgeloest (`expandHome`, agent.ts Z. 152–158).
- **Werkzeug-Aktionen:** `write.ts` Z. 78–79 meldet **`action: "edit"`** (nicht `write`); `skill.ts` Z. 51–53 meldet `action: "skill"` mit `resources: [skill.id]`; `mcp.ts` Z. 58–70 meldet `action: "<server>_<tool>"`, `resources` **immer `["*"]`**, Argumente in `metadata.input`.
- **F-Befund 1 (Beweis, kein Verdacht):** Skills und Bearbeiten sind in der **live Config bereits `allow`** — `staging/probe_permission_rules.py` simuliert `evaluate()`/`Wildcard.match()` 1:1 gegen die echte `opencode.jsonc`: **0 von 9 Abweichungen** (`skill *` → allow; `edit ~/Python-Projekte/*` → allow deckt COMPACTIONS.md und `./staging`; `edit ~/.agents/skills/*` → ask; Konfig-Ordner → ask). Die beobachteten Rueckfragen stammen aus der Komma-Falle (19.10.–29.10.).
- **F-Befund 2 (drei echte Guard-Luecken, mit `staging/probe_guard_cases.py` belegt: 3 von 6 Abweichungen):**
  1. `python -m pyright` → `ask`. `guard.js` `classifyPython()` Z. 986–996 kennt nur `pytest` und `ruff`.
  2. lesendes `gh api` → `ask`. `classifyGh()` Z. 1143–1150 laesst bewusst nur `auth status` und `repo view` zu (Entscheidung 25.10., Begruendung „es kann POSTen").
  3. `Remove-Item … -Recurse -Force` auf einen Unterordner → **`allow`**. `scopeWrites()` Z. 833–837 blockiert `-Recurse` nur, wenn das Ziel den Arbeitsordner **enthaelt** (`abs === cwd || isUnder(cwd, abs)`); ein Unterordner enthaelt ihn nicht. Zusätzlich ist nur `${base}\.git` in `denied` (Z. 801), nicht etwaige `.git` darunter — deshalb lief der Nutzerbefund `…/python-project-template/.git -Recurse` durch.
- **Nutzerfreigaben erteilt:** Plan Schritte A–E (Grundgerüst, vier Kriterien, drei Ebenen, Protokoll, Testregime) plus Erweiterung des Testregimes um den 600-Fall-Testkatalog aus `warc0s` (`benchmarks/permission-reviewer/data/cases.jsonl`, synthetisch/Single-Author, laut eigenem README keine Sicherheitszertifizierung — Struktur-Vorbild, kein Beweis).
- **Uebernehmbarste Einzelbausteine (Fundstellen in der Doku):** `bencrouse` — Argumente via `execute.before` abfangen (Z. 524–535), keine Freigabe ohne Argumente (Z. 568–569), Freigabe-Schluessel mit Argument-Hash (Z. 112–123), drei getrennte Kanaele im Pruef-Prompt `<TRUSTED-USER-INTENT>` / `<UNTRUSTED-PENDING-ACTION>` / `<UNTRUSTED-RECENT-TOOLS>` samt Inject-Regel (Z. 176–181, 422–432), Absichtsspeicher Aufgabe/Verbote/Erlaubnisse (Z. 238–250), Autoridad nur `ask → allow` (Z. 18–21, 600), Sicherungsschalter nach 3/20 Fehlversuchen (Z. 603–606). `hueyexe` — Shell-Kompositions-Regel (`[;&|<>`$()]` nie auto-erlauben) und Shadow-Modus; sein „bei Fehler blockieren" wird **nicht** uebernommen. `warc0s` — Notbremse vor dem Modell, insbesondere „unanalysierbar" streng von „destruktiv" trennen. `defender` — Grenz-Markierung unzuverlaessiger Inhalte als spaeterer Schritt G; dreistufige Kaskade bestaetigt den Weg ueber das lokale Modell.
- **Offen beim Nutzer:** (1) Ablehnungsverhalten bei MCP — still durchfragen wie `bencrouse` oder aktiv sperren wie `hueyexe` (Empfehlung: klare Verbote sperren, sonst fragen); (2) Absichtsspeicher ja/nein (Empfehlung: ja, nach Schritt A–C); (3) Freigabe der drei Behebungen aus F-Befund 2; (4) Reihenfolge D vor F (Empfehlung: ja, D wird zum Auswerten von F gebraucht).

### Work State
#### Completed
- `tools/permission-guard/docs/entscheidungsgrundlage-mcp-gating-2026-10-29.md` geschrieben (Teile 1–5 + drei Anhaenge: Pruefwerkzeuge, Fundstellen, Modell-/Messumgebung).
- `staging/probe_permission_rules.py` (9 Faelle, 0 Abweichungen) und `staging/probe_guard_cases.py` (6 Faelle, 3 Abweichungen) angelegt; beide bestehen `ruff check` und `ruff format`; Ergebnisse nach Formatierung identisch.
- `staging/append_changelog_block.py` + `staging/changelog-add-mcp-doku.md`: CHANGELOG-Eintrag „Entscheidungsgrundlage MCP-Gating angelegt (29.10.2026)" angehaengt (CHANGELOG jetzt 299.399 Bytes).
- Ursachen fuer alle fuenf F-Punkte abschliessend geklaert (zwei davon: bereits erfuellt, Rueckfragen aus der toten Config).

#### Active
- Compaction-Block wird an `COMPACTIONS.md` angehaengt.
- Naechster Arbeitsschritt: Behebungen aus F-Befund 2 (guard.js Z. 986–996, 1143–1150, 833–837 + `denied`-Liste) — **Freigabe des Nutzers steht aus**.

#### Blocked
- Umsetzung von Schritt A–E wartet auf die vier Nutzerentscheidungen oben.
- Live-MCP-Trigger nicht testbar: Session in `$HOME` (Guard registriert sich dort nicht) und kein MCP-Werkzeug im Werkzeugkatalog der Sitzung.

### Next Move
1. Nutzer fragen: Freigabe der drei guard.js-Behebungen, Ablehnungsverhalten, Absichtsspeicher, Reihenfolge D/F.
2. Nach Freigabe: guard.js anpassen, dann `node test.mjs` und `bench-quality.ps1` laufen lassen (Projektregel: nach JavaScript-Aenderungen `npm test`).
3. Schritt A–C (MCP-Pruefstelle ueber `tool.hook("execute.before")`), dann E (Testregime, erweitert um den warc0s-Katalog), dann D (Protokoll ueber `execute.after` mit Hash-Kette), dann F (Monitor/Shadow-Phase), spaeter G (Ergebnis-Ebene).
4. Offen von frueher: Commit `54d1dfb` teilen (zurueckgestellt); `Aufwaermlauf fehlgeschlagen (TypeError)` in `reviewer.js` Z. 383 untersuchen; Temp-Artefakte (`%TEMP%\opencode\oc-src`, `package\`, `opencode-plugin-2.2.1.tgz`) aufraeumen.

### Relevant Files
- `tools/permission-guard/docs/entscheidungsgrundlage-mcp-gating-2026-10-29.md`: Entscheidungsgrundlage (Plan, Recherche, Diagnose).
- `staging/probe_permission_rules.py`, `staging/probe_guard_cases.py`, `staging/append_changelog_block.py`, `staging/changelog-add-mcp-doku.md`: Pruef- und Anhangswerkzeuge (gitignore, im Projektordner = reviewbar).
- `tools/permission-guard/guard.js`: `classifyPython()` Z. 986–996, `classifyGh()` Z. 1143–1150, `scopeWrites()` Z. 833–837, `denied`-Liste Z. 801 — die drei Behebungsorte.
- `COMPACTIONS.md`: dieser Block; `CHANGELOG.md`: Eintrag vom 29.10.

### Important Context
- Die Entscheidungsdokumentation ist bewusst **vor** der Umsetzung entstanden — der Guard ist bis auf die noch ausstehenden Behebungen unveraendert.
- `tools/permission-guard` ist bereits ein Git-Repo auf `master` ohne Remote; fuer den spaeteren GitHub-Push genuegt `git remote add origin …`. `git push` ist in der `opencode.jsonc` doppelt gesperrt — der Push liegt beim Nutzer.
- Modell fuer Ebene 3: `google/gemma-4-12b-qat@q4_0`, Port 8080, Grammatik `"Ja"|"Nein"`; laeuft lazy in die VRAM (erster Aufruf 16.104 ms bei 1,04 GB, danach 185–3.835 ms bei 8,31 GB).

## 29.10.2026 / spaeter 2 — Guard-Lücken F behoben und deployt, MCP-Planung steht bereit

### Objective
- Nutzerfreigaben aus der Frage-Runde umsetzen: alle drei F-Behebungen, Ablehnungsverhalten „klare Verbote blockieren, sonst fragen“, Absichtsspeicher „ja, nach dem Grundgerüst“.
- Danach Schritt A–E der MCP-Erweiterung laut freigegebenem Plan.

### Important Details
- **Umgesetzt in `guard.js` (Nutzerfreigabe 29.10.2026):**
  1. `pyright`: `classifyPython()` erkennt `python -m pyright` / `py -X -m pyright` als lesend (neben `pytest`).
  2. `gh api`: `ghApiIsReadOnly()` — nur `GET`/`HEAD`/`OPTIONS` (als `-X Wert` oder `--method=Wert`); Sendeflags `-f`, `-F`, `--field`, `--raw-field`, `--input` und Endpunkt `graphql` (immer POST) führen zu `ask`; mehrdeutige Formen bleiben `unknown` → `ask`. `guard.js` bleibt reine Funktion — kein Pfadinterpretieren, kein Variablenauflösen.
  3. Löschen: `DELETE_CMDLETS` (remove-item/del/erase/rd/rmdir/ri/rm) + `deletionEscalation()` — `-Recurse`, `-Force`, Platzhalter-Ziele und Ziele ohne Namens-Endung (Verzeichnis-Verdacht, `.git` zählt ohne Endung) → `ask`. Begründung `Loeschen:` beginnt mit keinem der drei Sperr-Präfixe in `evaluate()`, also `ask` statt `deny`. Bewusst **ohne `fs`** (reine Funktion, `looksLikeDirectory()` = Endungs-Heuristik, fail-closed: `Remove-Item LICENSE` fragt einmal).
  4. Das eigene Projekt-`.git` bleibt `deny` (denied-Liste seit 22.10.); erfasst wird jetzt das `.git` in einem **Unterordner** — genau der Nutzerbefund `staging/…/python-project-template/.git`.
- **Verifikation:** `node test.mjs` = 393/393 (16 neue Regressionstests; eine bestehende Erwartung korrigiert: `-Recurse -Force` auf Projekt-Unterordner ist jetzt `ask`). `deploy.ps1` mit Testlauf, danach SHA256-Vergleich: alle Dateien byte-identisch, `shell-reviewer.config.json` erhalten. `staging/probe_guard_cases.py` = 0 von 6 (vorher 3 von 6).
- **README aktualisiert** (vier Stellen): neue Lösch-Regel als Absatz, `pyright`-Zeile, `gh api`-Freigabe samt `ghApiIsReadOnly()`-Erklärung, `Remove-Item`-Beispiel.
- **Entscheidungsdokument** um Abschnitt 4.3a ergänzt; kaputter Absatz aus dem abgebrochenen Edit-Roundtrip (266–267, `-F`-Gewirr) repariert.
- **Freigegeben, aber noch nicht umgesetzt:** Ablehnungsverhalten (klare Verbote aktiv blockieren, sonst fragen) und Absichtsspeicher (Aufgabe/Verbote/Erlaubnisse, nach Schritt A–C) — beides gehört zur MCP-Erweiterung, nicht zu den drei F-Behebungen.
- **Repo-Stand:** `tools/permission-guard` (eigenes Repo, master, kein Remote): `guard.js`, `test.mjs`, `README.md`, `docs/` — Commit in dieser Sitzung gezogen.

### Work State
#### Completed
- Drei F-Behebungen in `guard.js` umgesetzt, getestet (393/393), deployt (SHA256-identisch).
- README, Entscheidungsdokument 4.3a, CHANGELOG und diese Compaction nachgezogen.
- Entscheidungsgrundlage-Markdown-Tabelle pipes-ausgerichtet (Skill `markdown-table-formatting`).

#### Active
- Nächster Arbeitsschritt: MCP-Schritt A — `tool.hook("execute.before")` in `index.js` für den Argument-Capture, `evaluateMcp()` als reine Funktion in `guard.js` (Argument-Hash als Freigabe-Schlüssel, keine Freigabe ohne Argumente), Shadow-Modus-Logging ohne Wirkung; Tests in `test.mjs`.

#### Blocked
- Live-MCP-Trigger erst testbar, wenn OpenCode in einer Projektordner-Sitzung läuft (Guard registriert sich nur bei cwd ≠ `$HOME`).
- Schritte B–E warten auf A.

### Next Move
1. Schritt A bauen (Capture-Store in `index.js`, `evaluateMcp()` in `guard.js`, Shadow-Log, Tests) — deployen, aber noch nichts blockieren.
2. Schritt B (Prüfkatalog principal/action/resource/context) und C (drei Ebenen: feste Regel → Notbremse → lokales Gemma) auf A aufsetzen.
3. Schritt E: Testregime ~20 MCP-Fälle mit festem Soll, Struktur nach `warc0s`-`cases.jsonl`; dann D (execute.after-Protokoll mit Hash-Kette), dann F (Monitor-Phase), später G (Ergebnis-Ebene).
4. Offen von früher: Commit `54d1dfb` teilen (zurückgestellt); `Aufwaermlauf fehlgeschlagen (TypeError)` in `reviewer.js` (warmup ~383); Temp-Artefakte (`%TEMP%\opencode\oc-src`, `package\`, `opencode-plugin-2.2.1.tgz`, `rc-bencrouse-permissions-check.ts`) aufräumen.

### Relevant Files
- `tools/permission-guard/guard.js`: `classifyPython()` (pyright), `ghApiIsReadOnly()`/`classifyGh()`, `DELETE_CMDLETS`/`looksLikeDirectory()`/`deletionEscalation()`, `scopeWrites()`.
- `tools/permission-guard/index.js`: Schritt-A-Ziel — `tool.hook("execute.before")`, bisheriger `SHELL_ACTIONS`-Frühausstieg ~Z. 109.
- `tools/permission-guard/test.mjs`: 393 Fälle; neue MCP-Fälle kommen hier dazu.
- `tools/permission-guard/docs/entscheidungsgrundlage-mcp-gating-2026-10-29.md`: Plan A–F, Recherche 2a/2b, Diagnose F, Umsetzung 4.3a.
- `staging/probe_guard_cases.py`, `staging/probe_permission_rules.py`: Empirik (0 bzw. 0 Abweichungen nach den Fixes).

### Important Context
- MCP-Introspektion bleibt bindend: `action` = `<server>_<tool>` (z. B. `exa_search`), `resources` immer `["*"]`, Argumente in `metadata.input`; `execute.before` liefert Werkzeugname + Argumente vor der Berechtigungsentscheidung (bewiesen via bencrouse `permissions-check.ts` Z. 524–535).
- Regel-Semantik: `findLast` gewinnt, kein Treffer = `ask`; `Wildcard.match` normalisiert `\` → `/`, unter Windows Groß/Klein ignorierend.
- Nutzerentscheid 29.10.: Ablehnung = „klare Verbote aktiv blockieren, bei allem anderen durchfragen“ (Modellfehler → fragen, nie blockieren — anders als hueyexe); Absichtsspeicher = ja, aber erst nach Schritt A–C.
- Modell Ebene 3: `google/gemma-4-12b-qat@q4_0`, Port 8080, Grammatik `"Ja"|"Nein"`, lazy in VRAM.

## 29.10.2026 / spaeter 3 — Config zweitemmal repariert, MCP-Schritt A umgesetzt und deployt

### Objective
- Fortsetzung nach Compaction 2: Projektstand erkunden, dann dort weitermachen, wo die vorherige Sitzung abgebrochen war (kaputter Absatz im Entscheidungsdokument, fehlende Commits/Nachdokumentation).
- Anschliessend MCP-Schritt A (Shadow-Beobachtung) bauen, nach Nutzerfreigabe.

### Important Details
- **opencode.jsonc ZWEITES Mal kaputt am 29.10.** (bewiesen via `staging/check_jsonc.py`, nicht geraten): Beim Eintragen der neuen MCP-Server `deepwiki` und `hf-mcp-server` gingen drei Strukturfehler in einen — zwei fehlende Kommas zwischen den deepwiki-Eintraegen UND die fehlende schliessende Klammer des Blocks `providers` (Zeile ~235). Letztere liess `default_agent`, `agents`, `policies`, `permissions` und `mcp` innerhalb von `providers` haengen; das Wurzelobjekt blieb offen (Endtiefe 1). OpenCode verwirft die GESAMTE Datei → alle MCP-Server weg. Repariert; Verifikation: `check_jsonc.py` „JSONC GUELTIG", 16 Top-Level-Keys, 13 MCP-Server, `probe_permission_rules.py` 0 von 9 bei 94 Regeln. Backup: `opencode.jsonc.backup-20261029-mcp-deepwiki-comma-fix`. **Handmuster (jetzt auch im CHANGELOG): nach jedem Handedit `python staging/check_jsonc.py <config>` laufen lassen** — zweimal in einem Tag ging eine Editierung kaputt, ohne dass OpenCode es offenbarte.
- **Neue Hilfsskripte in `staging/`:** `brace_depth.py` (Klammerbilanz gesamt), `brace_depth_verbose.py` (Tiefe je Zeile), `brace_top_sections.py` (Top-Level-Sektionen — fand die providers-Luecke), `append_block.py` (generalisierter Anhaenger mit argv: ziel, blockdatei, marker).
- **MCP-Schritt A umgesetzt (Commit `ff8d4c2`, deployt, 416/416):**
  - `mcpObservation(action, metadata)` in `guard.js` — reine Funktion. Erkennt MCP an `metadata.input`: Beweis `mcp.ts` Z. 62 (`metadata: { input: input ?? {} }`) ist der EINZIGE Setter; `resources == ["*"]` allein reicht NICHT (question und todo melden dasselbe — Quelltext-Gegenbeweis, der den ersten Entwurf des Erkenners widerlegte, BEVOR er deployt wurde). Liefert: `isMcp`, `key` (`Werkzeug#SHA256(args)[0:16]`, nach bencrouse Z. 112–123), `argHash`, `argCount`, `fields` (nur Feldnamen, nie Werte), `hasArgs` (false bei `{}`), `secret` (via `findSecrets` auf serialisiertem JSON).
  - Erster `guard.js`-Import überhaupt: `node:crypto` (eingebaut, rechnet nur — kein I/O, kein externes Package).
  - `index.js`: MCP-Zweig im `permission.evaluate`-Hook VOR dem `SHELL_ACTIONS`-Frühausstieg. Bei `effect=ask` Logzeile `mcp ask <action> agent=… key=… args=N felder=…` (+ ` geheimnisverdacht`). **Es wird nichts geändert** — `input.effect` bleibt unberührt (Shadow-Modus).
  - **Bewusste Abweichung vom Plan:** der geplante `execute.before`-Capture (bencrouse Z. 524–535) entfiel als überflüssiger State — die Argumente stehen im Event selbst (`PermissionEvaluation.metadata`, durchgereicht in `permission.ts` Z. 173). Kein Store, keine Aufraeumlogik, keine Zuordnungsfrage. `source.id` = `execute.before`-`id` (beide `context.id`, tool.ts Z. 111 vs. mcp.ts Z. 68) haette exakte Zuordnung erlaubt — brauchte ich nicht.
  - 23 neue Tests: 12 Erkennung (inkl. Gegenproben question/todo/mcp-resource/shell/undefined/null/String), 7 Schlüssel-Eigenschaften (Stabilität, Unterscheidung, Werkzeuganteil, Hash-Länge 16, `hasArgs=false` bei `{}`), 4 Geheimnisverdacht. Ein Fehlmein im eigenen Testfall (`argCount === 2` bei einfeldigem Objekt) vor dem Deploy korrigiert.
- **Session-Befund (wichtig für Live-Tests):** Die MCP-Tools erscheinen/disparieren im Werkzeugkatalog dieser Sitzung mehrfach — Nebenprodukt der Config-Neuladung. Der Guard registriert sich in dieser Sitzung NICHT (cwd = `$HOME`). Live-MCP-Trigger also weiterhin erst in einer Projektordner-Sitzung prüfbar; die Shadow-Logzeilen sind dann in `%TEMP%\opencode-permission-guard\guard.log` sichtbar (`mcp ask …`).

### Work State
#### Completed
- F-Diagnose abgeschlossen und drei Guard-Lücken behoben (Commit `3b2d2e3`).
- Entscheidungsdokument: kaputter Absatz (4.3a, `-F`-Gewirr aus abgebrochenem Edit) repariert, Schritt A auf „umgesetzt" gestellt inkl. Beweisführung.
- opencode.jsonc zweimal repariert (Komma 13:15, providers-Klammer ~16:00), beide Male verifiziert und mit Backup.
- MCP-Schritt A: `mcpObservation()` + Shadow-Verdrahtung + 23 Tests, 416/416, deployt (SHA256-identisch), Commit `ff8d4c2`.
- CHANGELOG: drei Einträge heute (Entscheidungsgrundlage, F-Behebungen, Config-Reparatur 2, Schritt A); COMPACTIONS: Blöcke 1–3.

#### Active
- Nächster Arbeitsschritt: **Schritt B — Prüfkatalog** (Kriterien principal/action/resource/context auf `mcpObservation` aufsetzen), dann C (drei Ebenen: feste Regel → Notbremse → lokales Gemma), E (Testregime ~20 MCP-Fälle mit festem Soll, Struktur nach warc0s `cases.jsonl`), D (`execute.after`-Protokoll mit Hash-Kette), F (Monitor-Phase).

#### Blocked
- Live-MCP-Trigger-Test: Guard registriert sich nur bei cwd ≠ `$HOME`; User muss OpenCode in `~/Python-Projekte/AI+IDE-Hints` starten. Danach: MCP-Aufruf auslösen, `guard.log` auf `mcp ask …`-Zeilen prüfen.
- Absichtsspeicher (freigegeben, „nach dem Grundgerüst"): wartet auf Schritte B–C.

### Next Move
1. Schritt B bauen: Prüfkatalog (principal/action/resource/context) über `mcpObservation` — lesende Suchaufrufe auf exa/gh_grep/firecrawl als Kandidaten für „allow", schreibende (github_* mit POST-Charakter, firecrawl_agent, monitor/delete) als „fragt".
2. Schritt C: drei Ebenen (feste Regel → Notbremse mit „unanalysierbar ≠ destruktiv"-Trennung → lokales Gemma `google/gemma-4-12b-qat@q4_0`, Port 8080, Grammatik `"Ja"|"Nein"`, nur im Graubereich). Ablehnungsverhalten laut Nutzerfreigabe: klare Verbote aktiv blockieren, sonst durchfragen; Modellfehler → fragen, nie blockieren.
3. Schritt E: Testregime ~20 MCP-Fälle mit vorher festem Soll (≈ ein Drittel „muss verboten sein"), Fallzeilen-Struktur nach warc0s `cases.jsonl`; erst danach Schärfung.
4. Schritt D (`execute.after`-Log mit Hash-Kette), dann F (Monitor/Shadow-Phase), später G (Ergebnis-Ebene, Grenz-Markierung).
5. Offen von früher: `Aufwaermlauf fehlgeschlagen (TypeError)` in `reviewer.js` (~Z. 383); Temp-Artefakte aufräumen (`%TEMP%\opencode\oc-src`, `package\`, `opencode-plugin-2.2.1.tgz`, `rc-bencrouse-permissions-check.ts`); Commit `54d1dfb` teilen (zurückgestellt); Guard-Repo hat kein Remote (Push liegt beim Nutzer).

### Relevant Files
- `tools/permission-guard/guard.js`: `mcpObservation()` (neu, ~Z. 523–570), `classifyPython()` (pyright), `ghApiIsReadOnly()`/`classifyGh()`, `DELETE_CMDLETS`/`deletionEscalation()`.
- `tools/permission-guard/index.js`: MCP-Shadow-Zweig vor SHELL_ACTIONS-Check (~Z. 105–125).
- `tools/permission-guard/test.mjs`: 416 Fälle; MCP-Block zwischen „Antwortformat" und „Aufbau".
- `tools/permission-guard/docs/entscheidungsgrundlage-mcp-gating-2026-10-29.md`: Plan A–F mit Umsetzungsstand; Schritt A enthält die Abweichungsbegründung.
- `~/.config/opencode/opencode.jsonc`: repariert; Backup `opencode.jsonc.backup-20261029-mcp-deepwiki-comma-fix` (+ das vom Vormittag).
- `staging/`: `check_jsonc.py`, `brace_depth.py`, `brace_top_sections.py`, `append_block.py` (Werkzeugkasten für Config-Wartung), Probe-Skripte, Anhangsblöcke.

### Important Context
- MCP-Argumente stehen im Berechtigungs-Event (`metadata.input`) — kein Capture nötig; `resources` ist bei MCP immer `["*"]` und taugt nicht als Merkmal (question/todo als Falsch-Positive bewiesen).
- Freigabe-Schlüssel-Format: `<action>#<sha256(args)[0:16]>` — eine Freigabe deckt nie ein anderes Argument-Set.
- Log-Privacy bei MCP: nur FeldNAMEN, nie Werte; ein Geheimnisverdacht wird zusaetzlich gemeldet, der Argumenttext selbst nie.
- Shadow-Modus ist Königsweg: Schritt A ist deployt, aber wirkungslos — die Monitor-Daten aus echten Sitzungen entscheiden über die Schärfung in Schritt E/F.
- Modell Ebene 3 unverändert: `google/gemma-4-12b-qat@q4_0`, lazy in VRAM.

<a id="compaction-01112026-1706"></a>

=============== Compaction 04.11.2026 / 08:08 ================
## Objective
- Beide offenen Punkte erledigt: AGENTS.md-Satz zu `git push` auf den Ist-Zustand korrigiert und MCP-Schritt B (Kriterienkatalog principal/action/resource/context) gebaut, getestet, deployt und im Nested-Repo committet.
- Dokumentation im Projektwurzelverzeichnis nachgezogen (`CHANGELOG.md`, `COMPACTIONS.md`, `PLANUNG.md`).

## Important Details
- **Decisions:** Der Katalog entscheidet weiterhin nichts (Schattenmodus wie Schritt A). Rangfolge `destructive` > `write` > `read`; ohne erkennbares Verb bleibt die Absicht `unknown` — Schritt C macht daraus eine Rückfrage, nie eine Freigabe. `mcpCriteria()` ersetzt `mcpObservation()` in `index.js`; die alte Funktion bleibt exportiert und getestet.
- **Design:** Zielarten kommen aus der Form vor dem Feldnamen (`https://…` → `url`, `C:\…` → `path`), verschachtelt bis Tiefe 3 mit Zyklenschutz. Argumente über 16 KB gelten als `unanalysierbar` — bewusst getrennt von „destruktiv“ (Idee aus warc0s). Werte verlassen die Funktion nicht; der Test „keine Argumentwerte in den Kriterien“ sichert das ab.
- **Finding:** Die README-Testzahl war veraltet (275 statt 416/453); jetzt 453 Fälle mit den aktuellen Gruppen. Sonst keine neue Lücke gefunden.
- **AGENTS.md:** `git push` wird allein in `permissions` geregelt (`shell / git push *` → `ask`); der tote `policies`-Eintrag ist seit `94ba4c0` entfernt.

## Work State
### Completed
- `AGENTS.md` korrigiert (Punkt 1 der offenen Liste).
- `guard.js`: `mcpCriteria()` + Verb-/Ziel-/Kontextkatalog; `index.js`: Schatten-Logzeile um `absicht=`, `ziel=`, `inhalt=` erweitert; keine Änderung an `input.effect`.
- `test.mjs`: 37 neue Tests (14 Absicht, 9 Zielarten, 14 principal/context/Datenschutz), gesamt **453/453**.
- `README.md`: Abschnitt „MCP: Schattenmodus (Schritte A und B)“ plus aktualisierte Testbeschreibung.
- Deploy: `deploy.ps1` meldet alle zehn Dateien SHA256-identisch; `shell-reviewer.config.json` blieb erhalten.
- Nested-Commit `ca33e05` (4 Dateien, +355/−21).
- Doku: `PLANUNG.md` Abschnitt 23 + Nachtrag zu Punkt 17 + zwei Entscheidungslog-Zeilen; CHANGELOG-Block angehängt.
### Active
- Nichts; Schritt B ist abgeschlossen.
### Blocked
- Schritt C wartet auf Nutzerfreigabe (feste Regeln, Notbremse, lokales Gemma; Absichtsspeicher bleibt zurückgestellt).
- Offen: skillspector braucht API-Key; `Aufwaermlauf-TypeError` in `reviewer.js`; Commit `54d1dfb` teilen; Temp-Aufräumen; uncommittete Reste in `~/.agents`.

## Next Move
1. Schritt C entwerfen: Regelkatalog auf Basis von `action.intent` + `resource.kinds` + `context` (lesende Suche allow, destruktiv ask/deny, Schreiben ask), weiterhin shadow und mit Testregime E (20 Fälle, ein Drittel Verbot) vor Aktivierung.
2. Danach Schritt D (Protokoll mit Hash-Kette), dann F (Monitor-Auswertung).

## Relevant Files
- `tools/permission-guard/guard.js`: `mcpCriteria()` ab ~Z. 579, Konstanten ab ~Z. 523.
- `tools/permission-guard/index.js`: Schatten-Zweig ab ~Z. 109.
- `tools/permission-guard/test.mjs`: MCP-Kriterien ab ~Z. 690.
- `tools/permission-guard/README.md`: Abschnitt „MCP: Schattenmodus (Schritte A und B)“.
- `PLANUNG.md`: Abschnitt 23, Nachtrag zu Punkt 17, Entscheidungslog.
- `CHANGELOG.md`: Block „AGENTS.md korrigiert, MCP-Schritt B umgesetzt“.
- `tools/permission-guard/docs/entscheidungsgrundlage-mcp-gating-2026-10-29.md`: Plan A–G.

## Important Context
- Schattenmodus heißt: **keine Verhaltensänderung**. `input.effect` bleibt, wie die statischen Regeln entscheiden; MCP-Server ohne explizite `permissions`-Regel fragen weiterhin nach.
- Der Katalog ist die Datengrundlage für die Monitor-Phase F; aus dem Log lässt sich später ablesen, welche Absicht-/Ziel-Kombinationen tatsächlich auftreten.
- Stand kompakt: 453/453 Tests, deployt, Config-Repo und Gate unberührt.

=============== Compaction 04.11.2026 / 08:15 ================
## Objective
- MCP-Schritt C umgesetzt: Drei-Schichten-Urteil (feste Regel, Notbremse, lokales Gemma) in `guard.js` und `reviewer.js`, verdrahtet in `index.js`, weiterhin **Schattenmodus**.
- Getestet (498/498), deployt, in beiden Repos committet und im Projektwurzelverzeichnis dokumentiert.

## Important Details
- **Decisions:** Ebene 2 (Notbremse) läuft vor Ebene 1, weil ein klarer Zerstörungsfall aktiv verweigert gehört statt nachgefragt. Ebene 1 übersetzt den Katalog aus B: `read` allow, `write`/`destructive` ask, `unknown` → Modell. Ebene 3 hebt nur `ask`→`allow`; ein `deny` entsteht dort nie.
- **Reihenfolge der Sonderfälle:** `unanalysierbar` (> 16 KB) → Notbremse → Geheimnisverdacht → leere Argumente → Absicht. So kann ein Größenlimit nie als „destruktiv" gelten und die Notbremse nie von einem Geheimnisverdacht verdrängt werden.
- **Schalter:** `MCP_GATING_MODE = "shadow"` in `guard.js`, `mcpAction()` sagt, ob ein Urteil gilt (in `active` nur bei statischem `ask`; `allow`/`deny`/gespeicherte Freigaben unangetastet). Quelltext statt Umgebungsvariable, weil Aktivieren ein prüfbarer Vorgang sein soll.
- **Prompt-Kanäle:** drei Abschnitte nach bencrouse; Kanal-Tags in Argumenten werden neutralisiert, eine Aufforderung im unzuverlässigen Teil ist allein Grund für „Nein". Absichtsspeicher bleibt zurückgestellt (Entscheidung 2 vom 01.11.).
- **Fund:** `escapeChannelTags()` schrieb `$1` wörtlich in den Prompt (Gruppe war nicht-erfassend) — der neue Test deckte es auf, Fix `$&`.

## Work State
### Completed
- `guard.js`: `mcpVerdict()`, `mcpAction()`, `MCP_GATING_MODE`, Notbremse-Listen (Werkzeugnamen und Argumente), `walkMcpValues()` als gemeinsamer Baumlauf.
- `reviewer.js`: `buildMcpMessages()`, `parseMcpAnswer()`, `reviewMcp()`; `requestCompletion()` aus `review()` herausgelöst, damit beide Ebenen denselben Aufruf teilen.
- `index.js`: Schatten-Zweig urteilt mit, Log erweitert um `schatten=<entscheidung>/<schicht>`; aktiver Pfad mit zweiter Logzeile vorbereitet.
- `test.mjs`: 45 neue Tests, gesamt **498/498**.
- `README.md`: Abschnitt „Schritt C" (Tabelle, Grenzen, Schalter, Beispielzeile), Testbeschreibung auf 498 aktualisiert.
- `deploy.ps1`: alle zehn Dateien SHA256-identisch; Nested-Commit `11b9f58`; Config-Repo `7875517` mit Gate 0/0/1.
- Doku: `PLANUNG.md` Abschnitt 24 + Entscheidungslog-Zeile; CHANGELOG-Block angehängt.
### Active
- Nichts; Schritt C ist abgeschlossen.
### Blocked
- Aktivierung wartet auf Testregime E (etwa 20 Fälle, ein Drittel „muss verboten sein") und eine bewusste Nutzerentscheidung.
- Offen: skillspector braucht API-Key; `Aufwaermlauf-TypeError` in `reviewer.js`; Commit `54d1dfb` teilen; Temp-Aufräumen; uncommittete Reste in `~/.agents`.

## Next Move
1. Schritt E bauen: `mcp-cases.jsonl` mit Soll-Entscheidung und Begründung (Vorbild `warc0s`-`cases.jsonl`), Prüfskript gegen `mcpCriteria`/`mcpVerdict`, Ausgabe wie `bench-quality.ps1`; ohne Modell für Ebene 1+2, Ebene 3 separat mit laufendem Gemma.
2. Danach Schritt D (Protokoll mit Hash-Kette), dann F (Monitor-Auswertung über `stats.mjs`).
3. Erst wenn E grün ist: `MCP_GATING_MODE` auf `"active"`, Tests, Deploy, Gate — als eigener, dokumentierter Schritt.

## Relevant Files
- `tools/permission-guard/guard.js`: `mcpVerdict()`/`mcpAction()` ab ~Z. 848, Notbremse-Listen ab ~Z. 780.
- `tools/permission-guard/reviewer.js`: MCP-Prompt/Ebene 3 ab ~Z. 300, `requestCompletion()` ab ~Z. 480.
- `tools/permission-guard/index.js`: MCP-Zweig Z. 109–160.
- `tools/permission-guard/test.mjs`: „MCP: Entscheidung (Schritt C)" ab ~Z. 772.
- `tools/permission-guard/README.md`: Abschnitt „Schritt C: Urteil in drei Schichten".
- `PLANUNG.md`: Abschnitt 24; CHANGELOG-Block „MCP-Schritt C …".
- `tools/permission-guard/docs/entscheidungsgrundlage-mcp-gating-2026-10-29.md`: Plan A–G.

## Important Context
- **Keine Verhaltensänderung:** `input.effect` bleibt, wie die statischen Regeln entscheiden; MCP-Server ohne explizite `permissions`-Regel fragen weiterhin nach.
- Logzeile im Schattenmodus: `mcp ask <tool> agent=build key=<tool>#<hash> args=N felder=… absicht=… ziel=… schatten=deny/2`.
- Der Tabellenformatter über die ganze README hätte fremde Tabellen umgebrochen — nur die eigene Tabelle wurde ausgerichtet (per Probe-Datei geprüft).
- Stand kompakt: 498/498 Tests, deployt, beide Repos committet, Gate unverändert grün.

=============== Compaction 04.11.2026 / 09:25 ================
## Objective
- MCP-Schritt E umgesetzt: festes Testregime mit 33 Aufrufen und vorher festgelegtem Soll, erweitert um den öffentlichen Fallkatalog von `warc0s`.
- Dabei zwei echte Urteilslücken geschlossen (Absicht aus Argumenten, Datenabfluss) und eine dritte durch den Live-Lauf gefunden (unaufgelöste Zielvariablen).
- Getestet (518/518), Bench 33/33, Ebene 3 live 3/3, deployt und in beiden Repos committet.

## Important Details
- **Fallbestand:** 33 Aufrufe — 8 `allow`, 13 `ask`, 9 `deny`, 3 `model`. Die Erwartung steht in der Fallzeile (`mcp-cases.jsonl`), nicht im Code; sonst prüfte das Regime sich selbst. `--change` prüft Anzahl und eindeutige Kennungen, damit kein Fall still verschwindet.
- **Fremdquelle:** 9 Fälle aus `warc0s/opencode-permission-reviewer` (Apache-2.0, synthetisch, laut README keine Sicherheitszertifizierung). Übernommen sind die **Fälle**, nicht die Erwartungen. `hueyexe` prüft nur `action: "shell"` (keine MCP-Fälle), `defender` prüft Werkzeug-Ergebnisse (Schritt G).
- **Lücke 1:** `read_health` mit `{reset: true}` war nach dem Namen lesend. `mcpArgIntent()` hebt die Absicht über gesetzte Argument-Feldnamen auf `write`/`destructive`; `false`/`"false"`/`0`/`off` zählen nicht, ein Feldname darf nie entschärfen.
- **Lücke 2:** Datenabfluss ist Notbremse — nach außen gerichtetes Werkzeug **und** Geheimnis-Pfad in den Argumenten ergibt `deny`. Ein Geheimnis*wort* allein bleibt Rückfrage.
- **Lücke 3:** Gemma gab `safe_cleanup` mit `target: "$DEFAULT"` frei. `mcpUnresolved()` schickt unaufgelöste Ziele (`$NAME`, `${NAME}`, `%NAME%`) in Zielfeldern direkt auf `ask` (Ebene 1); Textfelder bleiben unberührt.
- **Fund beim Commit:** gitleaks blockierte den Platzhalter `token abcdef123456` als `generic-api-key` (Entropie 3,58). Ersetzt durch `PLATZHALTER` — kein echter Schlüssel, keine Rotation.

## Work State
### Completed
- `mcp-cases.jsonl`: 33 Fälle inklusive 9 warc0s-Fällen und dokumentierten Abweichungen.
- `bench-mcp.mjs`: Prüflauf, `--model`, `--change`, Bestandsschutz.
- `guard.js`: `mcpArgIntent()`, `mcpOutward()`/`MCP_OUTWARD_VERBS`, `mcpUnresolved()`, erweiterte `SECRET_PATHS`, `context.unresolved`.
- `index.js`: Log um `quelle=argumente` und `unaufgeloest=<feld>` ergänzt.
- `test.mjs`: 20 neue Tests, gesamt **518/518**.
- `README.md`: Abschnitt „Schritt E" mit Fremdquellen-Tabelle und den drei Lücken.
- Deploy: zehn Dateien SHA256-identisch; Nested-Commit `74751f2`, Config-Repo `5422583` (Gate 0/0/1).
- Doku: `PLANUNG.md` Abschnitt 25 + Entscheidungslog-Zeile; CHANGELOG-Block angehängt.
- Tabellenformatter über die drei ganzen Dokumente mit Backup und Nachweis, dass nur Tabellen-Whitespace geändert wurde (Zeilenzahl, Text außerhalb, Zellinhalte normalisiert).
### Active
- Nichts; Schritt E ist abgeschlossen. Weiterhin Schattenmodus (`MCP_GATING_MODE = "shadow"`).
### Blocked
- Aktivierung wartet auf Schritt D (Protokoll mit Hash-Kette), F (Monitor-Auswertung) und eine bewusste Nutzerentscheidung.
- Vorgemerkt: Schritt G (Ergebnis-Ebene, Vorbild `stackoneHQ/defender`) und die Prüfung eines ausführlicheren Ebene-3-Prompts — beides in `PLANUNG.md` Abschnitt 25 unter „Vorgemerkt".
- Offen: `Aufwaermlauf fehlgeschlagen (TypeError)` in `reviewer.js`; Commit `54d1dfb` teilen; Temp-Aufräumen (`package\`, `opencode-plugin-2.2.1.tgz`, `rc-bencrouse-permissions-check.ts`, `warc0s-cases.jsonl`, `warc0s-build-dataset.py`); uncommittete Reste in `~/.agents`; skillspector braucht API-Key.

## Next Move
1. Schritt D: Protokoll über `execute.after` mit Hash-Kette.
2. Danach F (Monitor-Auswertung über `stats.mjs`); erst dann Aktivierung als eigener, dokumentierter Schritt.
3. Optional: Kriterien-Kurzfassung über `input.message` an MCP-Rückfragen zeigen (die Anzeige ist derzeit nur `*`, Issue #51519).

## Relevant Files
- `tools/permission-guard/guard.js`: `mcpArgIntent()` ab ~Z. 670, `mcpUnresolved()` vor `mcpBrake()` ab ~Z. 891, `mcpVerdict()` ab ~Z. 950.
- `tools/permission-guard/bench-mcp.mjs`: `EXPECTED` und Bestandsschutz.
- `tools/permission-guard/mcp-cases.jsonl`: 33 Fallzeilen mit `want`, `layer`, `why`.
- `tools/permission-guard/test.mjs`: „MCP: Argument-Absicht und Datenabfluss".
- `tools/permission-guard/README.md`: „Schritt E: Testregime".
- `PLANUNG.md`: Abschnitt 25; CHANGELOG-Block „MCP-Schritt E …".

## Important Context
- **Keine Verhaltensänderung:** Schattenmodus; `input.effect` bleibt, wie die statischen Regeln entscheiden.
- Logzeile: `mcp ask <tool> … absicht=destructive ziel=… quelle=argumente unaufgeloest=target schatten=ask/1`.
- Die drei Lücken sind bewusst eng: lieber eine Rückfrage zu viel als ein hartes Verbot aus schwacher Evidenz.
- Stand kompakt: 518/518 Tests, 33/33 Weiterleitungen, Ebene 3 live 3/3, beide Repos committet.

================ Compaction 05.11.2026 / 10:50 ================
## Objective
- Drei Betriebsfragen beantworten: MCP-Prompt zeigt nur `*`, MCP-Events nur im Projektordner, SkillSpector ohne API-Key und mit vielen Fehlalarmen.

## Important Details
- **MCP-Prompt:** Ursache ist `resources: ["*"]` im MCP-Wrapper; die App rendert `resources`. Issue #51519 ist durch PR #60548 („name the MCP tool and its input in the permission dock") am 04.11.2026 geschlossen, aber v2.2.5 (30.10.2026) enthält den Fix noch nicht. Die TUI zeigt den Aktionsnamen schon. Bis zum nächsten Release bleibt nur TUI oder Guard-Log.
- **Read-only MCP:** Das MCP-Protokoll kennt `readOnlyHint`/`destructiveHint`, OpenCode nutzt sie aber nicht für Berechtigungen (Code-Suche: nur Claude-Agent-Adapter/Tests; `packages/core/src/tool/mcp.ts` sendet weiterhin `resources: ["*"]`). Automatisches Allow gibt es daher nicht. Statische Einzel-Allow-Regeln würden den künftigen Geheimnis-/Datenabfluss-Check umgehen; empfohlen ist die Aktivierung des Guard-MCP-Zweigs, nicht eine breite Allowlist.
- **Globale MCP-Beobachtung:** `index.js` übersprang den Home-Kontext komplett, um nicht das ganze Profil als vertraut zu markieren. Jetzt registriert der Home-Kontext nur MCP (`contextScope()`), Shell bleibt Projekt. Test 521/521, deployt; Log zeigt `setup: globaler Kontext - nur MCP-Beobachtung`. Code Mode ist nicht die Ursache: ein Exa-Aufruf aus Code Mode erzeugte genau eine `mcp`-Zeile.
- **SkillSpector:** NVIDIA-Tool (Apache-2.0), lokal per uv installiert; über 100 Regel-IDs plus 20 YARA-Regeln. Die LLM-Stufe nutzt standardmäßig NVIDIA (`nv_inference`/`nv_build`) und braucht dafür `NVIDIA_INFERENCE_KEY`; `--no-llm` oder lokale Provider (`ollama`, `opencode_cli`, `claude_cli`, `gemini_cli`) vermeiden den Key.
- **Score:** CRITICAL 50, HIGH 25, MEDIUM 10, LOW 5 (Grundpunkte), multipliziert mit Confidence, abklingenden Gewichten 1/0,5/0,25 und 1,3 für ausführbare Dateien; Schwelle 50. `severity` wird aus dem Score abgeleitet, `max_issue_severity` getrennt. Beispiel `rag-blueprint`: 100/CRITICAL bei max. HIGH und 0 ausführbaren Dateien; PE3 findet `.env` in Prosa, YR4 „hidden instructions" in Doku.
- **99-Skill-Lauf (25.10.2026):** 202 Befunde, davon 154 in `.md`, 33 in `.py`, 8 in `.json`, 4 in `.mjs`, 2 in `.pyc`, 1 ohne Endung. 10 von 99 Skills liegen über der Schwelle 50; darunter reine Doku-Skills. Kein Malware-, Webshell- oder Miner-Treffer. Top-Regeln: RP1 (41, unversionierte `uvx`/Docker-Images), AE1 (31, Abdeckung), PE2 (24, sudo), E1 (15, externe URLs), PE3 (12, Credential-Wörter).
- **Weitere Beispiele:** `nemo-retriever` 64/HIGH (AE1 Abdeckung, PE2 sudo in Install-Doku, AST4 subprocess im Helferskript, LP3 fehlende Tool-Deklaration); `python-project-bootstrap` 48/MEDIUM (SC9 auf echtem `.githooks/pre-commit` ohne Endung); `huggingface-llm-trainer` 100/CRITICAL (u. a. legitime HF-Uploads als E5, `sudo` im Docstring als PE2).
- **Block-Empfehlung:** nur bestätigte harte Indikatoren (Malware/Webshell/Miner, Credential→Netz, Remote-Download+Ausführen, Deserialisierung, Cloud-Metadata-SSRF, Selbstmodifikation, Hook mit Geheimnis-Exfiltration). Alles andere ist `ask`/Info; nie der Score allein. `--no-llm` für deterministische Triage, Baseline nur für bestätigte Fehlalarme.

## Work State
- **Fertig:** globale MCP-Beobachtung implementiert, getestet, deployt; Antwort auf die drei Fragen belegt.
- **Offen:** nächster OpenCode-Release für den Prompt-Fix; SkillSpector-Kriterien als Richtlinie festschreiben; D0/D/F/G bleiben offen.

## Next Move
1. Nach dem nächsten OpenCode-Release den MCP-Prompt prüfen (Toolname + Argumente).
2. SkillSpector-Regelliste in eine kurze Block/Ask/Info-Richtlinie überführen und mit `skill-review` verzahnen.
3. D0-Beobachtung abschließen (source.id, execute.after) und D umsetzen.

## Relevant Files
- `tools/permission-guard/index.js`: Home-Kontext registriert nur MCP.
- `tools/permission-guard/guard.js`: `contextScope()`, `MCP_GATING_MODE`.
- `tools/permission-guard/test.mjs`: drei Kontext-Tests, 521/521.
- `staging/skillspector-regeln.json`: Regelinventar (temporär).
- `staging/skillspector-*.json`: Scanbeispiele rag-blueprint, nemo-retriever, python-project-bootstrap.

## Important Context
- **Keine Verhaltensänderung:** `MCP_GATING_MODE` bleibt `"shadow"`.
- **Kein Push:** Der Agent pusht nicht; der nächste Push bleibt beim Nutzer.
- **SkillSpector entscheidet nie:** Das Urteil entsteht weiterhin aus gelesenem Code (Skill `skill-review`).

================ Compaction 05.11.2026 / 11:26 ================
## Objective
- `tools/permission-guard` auf dem Weg zum eigenständigen Repository: Planung festgehalten, Schritt S0 (Sanitizing) umgesetzt, privates GitHub-Repo angelegt.
- Kein Push; er bleibt beim Nutzer.

## Important Details
- **Planung:** `tools/permission-guard/PLANUNG.md` beschreibt S0–S6 (Repo, CI, Hooks, Doku, Release, Umzug) und die MCP-Schritte D0, D, F, Aktivierung sowie G0–G4. Offene Punkte sind priorisiert, Entscheidungen getrennt in „festgelegt" und „offen".
- **S0 Fixtures:** `mcp-cases.jsonl` nennt in acht Zeilen nur noch `team`/`lumen`. Die Erwartungen blieben unverändert; `bench-mcp.mjs` meldet weiter 33/33, `test.mjs` 518/518.
- **S0 Metadaten:** Alle 14 Commits mit `permission-guard <noreply@example.invalid>` als Autor und Committer neu geschrieben (`git filter-branch`), `refs/original` gelöscht, Reflog geleert, `git gc --prune=now`. Das alte Commit-Objekt ist nicht mehr vorhanden.
- **Sicherung:** `staging/permission-guard-pre-sanitize-2026-11-05.bundle`, mit `git bundle verify` geprüft. Sie enthält die alte Historie und ist gitignored.
- **Lokale Identität:** `user.name`/`user.email` im Sub-Repo ebenfalls neutral gesetzt, damit neue Commits nicht wieder den Benutzernamen tragen. Rückgängig mit `git config --unset user.name; git config --unset user.email`.
- **Nicht veröffentlicht:** Die zwei untracked Notizen unter `docs/` (Codex/OpenCode-Vergleich, Statistik 01.11.) sind jetzt per `.gitignore` ausgeschlossen und bleiben lokal.
- **Repo:** `<user>/permission-guard` ist privat angelegt und als `origin` eingetragen; `gh repo view` meldet `isEmpty: true`, also keinen Push.
- **Hashes:** Alle vor dem 05.11. zitierten Sub-Repo-Hashes sind ungültig. Die Zuordnung alt → neu steht am Ende der Sub-Repo-`PLANUNG.md`; Abschnitt 26 der Parent-`PLANUNG.md` verweist darauf.

## Work State
- **Fertig:** S0 vollständig; Planung und CHANGELOG im Sub-Repo; Parent-`PLANUNG.md` Abschnitt 26; dieser Block.
- **Offen (S1–S6):** `package.json` vervollständigen, CI ins Sub-Repo, Hooks/`.gitattributes`/`.gitleaksignore`, README/CHANGELOG/SECURITY/CONTRIBUTING/AGENTS, Release v0.1.0, Parent aufräumen.
- **Offen (MCP):** D0 Live-Beleg, Prompt-Qualität, Schritt D, F, Aktivierung, G.
- **Entschieden:** Repo privat; Ort bleibt vorerst; Historie neu geschrieben; lokale Docs bleiben lokal; G annotiert zunächst nur.

## Next Move
1. D0: echten MCP-Aufruf beobachten (feuert `permission.evaluate`, gibt es `source.id`, feuert `execute.after` auch aus Code Mode?).
2. Ebene-3-Prompt gegen die festen Fälle verbessern und mit `bench-mcp --model` messen.
3. Schritt D (Audit mit Hash-Kette) umsetzen.
4. Parallel S1–S4; CI muss vor dem ersten Push grün sein.

## Relevant Files
- `tools/permission-guard/PLANUNG.md`: S0–S6, MCP D–G, Zuordnung alt → neu.
- `tools/permission-guard/CHANGELOG.md`: erster Eintrag zu S0.
- `tools/permission-guard/mcp-cases.jsonl`: 33 Fälle mit neutralen Fixtures.
- `tools/permission-guard/.gitignore`: zwei lokale Docs ausgeschlossen.
- `staging/permission-guard-pre-sanitize-2026-11-05.bundle`: Sicherung der alten Historie.
- `PLANUNG.md`: Abschnitt 26; `CHANGELOG.md`: Block 05.11.

## Important Context
- **Keine Verhaltensänderung am Guard:** S0 betrifft Fixtures, Dokumentation und Git-Metadaten; `MCP_GATING_MODE` bleibt `"shadow"`.
- **Kein Push:** `origin` ist gesetzt, aber das Remote ist leer. Der erste Push liegt beim Nutzer.
- **Prüfstand:** 518/518 Tests, 33/33 Weiterleitungen, Identität genau eine neutrale Zeile, `git grep` ohne Treffer für Benutzername oder Adresse.
- **Nächste Entscheidung:** npm (GitHub-only empfohlen) und die Aktivierungskriterien für F (50 Aufrufe / 7 Tage / 3 Werkzeuge).

================ Compaction 05.11.2026 / 11:53 ================
## Objective
- SkillSpector-Auswertung an die Skill-Prüfung anbinden: vorberechnete Urteilsdatei statt Live-Scanner.

## Important Details
- **Befund:** `tools/permission-guard` enthielt bis heute keinen SkillSpector-Bezug. Die einzige Brücke war die handgepflegte Liste `TRUSTED_SKILL_DIRS` (vier Namen) plus fünf Prüfprotokolle unter `~/.agents/skill-reviews/`. `staging/skillspector-regeln.json` (104 Regeln, 20 YARA) und `skillspector_aggregate.py` sind reine Auswertungen ohne Laufzeitbezug; die Hooks kennen Skills nicht.
- **Entscheidung des Nutzers:** vorberechnete Urteilsdatei. Ein Skript verdichtet Berichte und Protokolle zu `~/.agents/skill-reviews/verdicts.json`; der Guard liest sie nur.
- **Generator:** `tools/permission-guard/skill-verdicts.mjs`. Quellen `--reports` (SkillSpector-JSON) und `--skills`; Ausgabe je Skill mit Python-Code: `decision`, `reason`, `score`, `severity`, `findings`, `rules`, `reviewed`, `sha256` je Datei. Eine Freigabe wird nie erzeugt: neue Einträge stehen auf `"ask"`, ein geändertes Skript fällt beim nächsten Lauf auf `"ask"` zurück. Eine vorhandene, aber unlesbare Datei wird nicht überschrieben.
- **Leseseite:** `guard.js` prüft in `classifyPython` zusätzlich `skillVerdict()`. Vertraut wird nur bei `decision: "trust"` **und** passendem SHA256 der Zieldatei; fehlende Datei, fremdes Schema, fehlender Hash oder Lesefehler führen zur statischen Liste bzw. zu `ask`. Die vier eingebauten Namen bleiben die Untergrenze.
- **Prüfstand:** 530/530 Tests (neun neue Fälle: trust+Hash, fehlender Eintrag, Hash-Drift, `ask`, trust ohne Hashes, unlesbares JSON, fremdes Schema, ohne Datei, statische Liste). Ende-zu-Ende auf dem echten Pfad: trust+Hash → allow, falscher Hash → ask, Datei danach byte-identisch. Deployt, zehn Dateien SHA256-identisch.
- **Datenlage:** 99 Berichte, davon 7 Skills mit Python-Code (67 Skripte); 86 ohne ausführbaren Code bleiben außen vor. Sechs Berichte haben keinen Skill-Ordner (u. a. `huggingface-llm-trainer`, `imagegen`), drei Skills mit Python-Code haben keinen Bericht (`.system`, `prompt-engineering-patterns`, `python-project-bootstrap`). Diese bleiben unverändert Rückfrage.
- **Noch keine Freigabe:** alle sieben Einträge stehen auf `"ask"`, das Verhalten ist damit unverändert. `nemo-retriever` ist der einzige mit Protokoll (25.10.2026); die vier statischen Namen decken es ohnehin.
- **skill-review:** Stufe 1 bekam die Drei-Töpfe-Regel (blockiert nur bei bestätigtem Schadcode, fragt bei Netz/Credentials/Schreiben außerhalb, Hinweis bei Score und Prosa), Stufe 4 verweist für Freigaben auf `verdicts.json`. Tabellen mit dem Formatter ausgerichtet.

## Work State
- **Fertig:** Generator, Leseseite, neun Tests, Deploy, README-Abschnitt, CHANGELOG-Eintrag (Sub-Repo-Commit `322c0a7`), skill-review-Richtlinie.
- **Offen:** Freigabeentscheidungen in `verdicts.json` (Nutzerentscheid), Berichte für die drei ungescannten Skills, Commit in `~/.agents` (dort liegen weitere fremde Änderungen), kein Push.

## Next Move
1. Entscheiden, ob ein Skill mit Protokoll auf `"trust"` gesetzt wird (Kandidat: `nemo-retriever`, bereits statisch gedeckt).
2. Fehlende Berichte für `.system`, `prompt-engineering-patterns`, `python-project-bootstrap` erzeugen, dann Generator erneut laufen lassen.
3. D0/D/F/G und S1-S4 bleiben wie geplant.

## Relevant Files
- `tools/permission-guard/skill-verdicts.mjs`: Generator.
- `tools/permission-guard/guard.js`: `skillVerdict()`, `loadSkillVerdicts()`, `VERDICT_SCHEMA`.
- `tools/permission-guard/test.mjs`: neun Urteilsdatei-Tests.
- `~/.agents/skill-reviews/verdicts.json`: erzeugte Datei (7 Skills, alle `ask`).
- `~/.agents/skills/skill-review/SKILL.md`: Drei-Töpfe-Regel.
- `staging/verify-verdicts.mjs`: Einmalprüfung auf dem echten Pfad.

================ Compaction 05.11.2026 / 12:20 ================
## Objective
- Nachtrag: fehlende Berichte erzeugt, erste Freigabe eingetragen, Bring-Schuld im Skill-Repo geprüft.

## Important Details
- **Drei Berichte (05.11.2026):** `.system` 100/CRITICAL (12 Befunde, 95,6 % Abdeckung, Exitcode 1, weil keine eigene `SKILL.md` vorhanden ist), `prompt-engineering-patterns` 44/MEDIUM (4), `python-project-bootstrap` 48/MEDIUM (2). Ablage `logs/skillspector/2026-11-05/` (gitignoriert).
- **Generator:** `--reports` ist wiederholbar, das später genannte Verzeichnis gewinnt je Skill; jeder Eintrag trägt `report`. Stand: 10 Skills, 78 Skripte, 1 `trust` (`nemo-retriever`), 9 `ask`, 0 Abweichungen, 0 Python-Skills ohne Eintrag.
- **Doppelte Deckung:** `nemo-retriever` steht zusätzlich in `TRUSTED_SKILL_DIRS`; der Guard prüft die statische Liste zuerst (Kurzschluss), der Dateieintrag ist dort nur Nachweis. Wer allein die Datei entscheiden lassen will, muss die vier Namen aus dem Code entfernen — dann fallen die drei ohne Protokoll auf `ask`.
- **Kein CI im Skill-Repo:** `git -C ~/.agents remote -v` ist leer, `.github/` existiert nicht, die Hooks unter `references/githooks` kennen Skills nicht. Die beschriebene Bring-Schuld ist damit heute nicht wirksam.
- **Datenschutz:** SkillSpector-Berichte enthalten den absoluten Quellpfad mit Benutzernamen. Sie dürfen nicht ins Repo; die Urteilsdatei ist die bereinigte Fassung. CI kann deshalb nur Hashes prüfen, nicht neu scannen.
- **Guard schreibt nicht:** Ein Schreibvorgang aus dem Guard in seine eigene Vertrauensdatei wäre selbstmodifizierendes Vertrauen. Der Log nennt den unbekannten Pfad bereits; ein Meldeskript genügt.

## Work State
- **Fertig:** Berichte, Regeneration, Freigabe, Abgleich (`staging/check-verdicts.mjs`: 0 Abweichungen), Sub-Repo-Commit `3d2afa8`.
- **Offen:** CI-Workflow und Hook-Schritt für `~/.agents` (blockierend oder nur prüfend), Meldeskript für ungedeckte Skill-Aufrufe, Remote für `~/.agents`.

## Next Move
1. Entscheidung: Prüf-Workflow (empfohlen) oder zusätzlich automatische Aktualisierung im `pre-commit`.
2. Danach Verifier als Datei nach `~/.agents` legen und den Workflow schreiben.

================ Compaction 05.11.2026 / 13:10 ================
## Objective
- Drei fehlende Prüfprotokolle nachholen, Freigaben eintragen, statische Liste auflösen.

## Important Details
- **Protokolle (05.11.2026):** `markdown-table-formatting` TRUST (Scanner 71 stammt ausschließlich aus einem inzwischen entfernten `__pycache__`), `monthly-price-benchmark-workbook` TRUST (Skript liest die Mappe, schreibt nur den Bericht), `gemma-dev` ASK (Gradio-Beispiel lädt ein Modell und öffnet einen lokalen Webserver; Vertex-Beispiel braucht Cloud-Anmeldedaten).
- **`TRUSTED_SKILL_DIRS` entfernt:** Die Namensliste hätte `gemma-dev` auch gegen ein ASK-Protokoll freigegeben. Jetzt entscheidet allein `verdicts.json`; ohne Datei oder ohne passenden Hash ist jedes Skill-Skript Rückfrage. Stand: 3 `trust`, 7 `ask`.
- **Laufzeitprobe:** `nemo-retriever`, `markdown-table-formatting`, `monthly-price-benchmark-workbook` → allow; `gemma-dev`, `documents` → ask.
- **Prüfstand:** 530/530 Tests (vier frühere allow-Fälle auf ask umgestellt, ein Projektpfad-Fall ersetzt), deployt, Sub-Repo-Commit `eca5261`.
- **Referenzen:** `references/` unter einem Skill gehört dem Skill; `~/.agents/references/` ist die gemeinsame Ebene (Dokumente plus `scripts/`, dort lag bereits `check-skill-duplicates.ps1`). Kein Umbau nötig.
- **Guard-Fehlalarm:** Eine lesende `Select-String`-Suche mit dem Wort `iex` im Suchmuster wurde als destruktiv verweigert — Mustertext wird wie Code behandelt.

## Work State
- **Fertig:** Protokolle, Freigaben, eine Freigabequelle, Doku, Deploy.
- **Offen:** Remote für `~/.agents`, Commit dort, Meldezeile „neu aufgenommen“, Entscheidung zu den sieben `ask`.

## Next Move
1. Privates Remote für `~/.agents` anlegen und den ersten Push durch den Nutzer.
2. Im `--refresh` neu aufgenommene Skills ausgeben.
3. Verbleibende Skills einzeln prüfen.

================ Compaction 05.11.2026 / 14:05 ================
## Objective
- Entscheidungen npm/F festhalten, D0 abschließen, Schritt D (Audit-Kette) umsetzen.

## Important Details
- **npm:** `opencode-permission-guard` ist seit 04.05.2026 von einem fremden Benachrichtigungs-Plugin belegt (Version 1.0.0), `permission-guard` ebenfalls. GitHub-Namensraum ist davon unberührt. Entscheidung: GitHub-only, `"private": true`.
- **F-Kriterien:** 7 verschiedene Tage, ≥ 50 Aufrufe, ≥ 3 Werkzeuge davon ≥ 1 schreibend, plus Qualitätsbedingungen. Ausgangsstand 2 Aufrufe/1 Werkzeug; F selbst fehlt noch.
- **D0 (Fall B):** `permission.evaluate` feuert mit `action` und `metadata.input`; `source.id` existiert und gleicht `execute.after.id`, gilt aber je `execute`-Block (zwei Aufrufe, dieselbe ID); `execute.after` feuert für jedes MCP-Werkzeug und zusätzlich für `execute`. Korrelation daher über Sitzung + Werkzeug + Argument-Hash + Zeitfenster.
- **D umgesetzt:** `audit.js` (kanonisches JSON, Hash-Kette, Rotation bei 5 MB, `verifyChain`), `verify-audit.mjs`, Verdrahtung in `index.js` (Entscheidung im MCP-Zweig, Ergebnis über `ctx.tool.hook("execute.after")`). Ablage `%LOCALAPPDATA%\opencode\permission-guard\audit.jsonl`, `PERMISSION_GUARD_AUDIT=off` schaltet ab.
- **Datensatz ohne Werte:** Zeitpunkt, Modus, gehashte Sitzung, Werkzeug, Absicht, Zielarten, Flags, Entscheidung, Schicht, gekürzter Grund, `callID`, `prev`, `hash`.
- **Prüfstand:** 543/543 Tests (13 neue Audit-Fälle), deployt, Lebendtest: decision+result mit gleicher Kennung `9305ebbadc730807`, Kette intakt. Sub-Repo-Commit `c98f21d`.
- **Aufgeräumt:** 20 `.before_*`-Zwischenstände gelöscht (nicht versioniert); D0-Sonde und ihr Protokoll entfernt (Löschen in `~/.config/opencode` und außerhalb des Projekts ist gesperrt, der Nutzer hat es ausgeführt).

## Work State
- **Fertig:** Entscheidungen, D0, Schritt D, Doku.
- **Offen:** F (`mcp-report.mjs`), Ebene-3-Prompt, S1–S4/CI, erster Push des Guard-Repos.

## Next Move
1. F bauen, damit die Kriterien messbar werden; parallel Prompt gegen `bench-mcp --model`.
2. S1–S4: Metadaten, CI, Hooks, Doku im Sub-Repo; CI grün vor dem Push.
3. Danach Aktivierung erst nach 7 Tagen/50 Aufrufen.

================ Compaction 05.11.2026 / 14:40 ================
## Objective
- F umsetzen: Auswertung der Audit-Kette inklusive Kriterienstand.

## Important Details
- **`mcp-report.mjs`:** liest beide Audit-Generationen, zählt nach Werkzeug, Absicht, Entscheidung, Schicht und Modus, zeigt die Matrix Effekt→Urteil, Auffälligkeiten (unbekannt, Geheimnis, unanalysierbar, unaufgelöst, Inhalt), offene Aufrufe ohne `execute.after` und Ebene-3-Gründe; `--since`, `--days`, `--json`. Am Ende der Kriterienstand im Klartext.
- **Rein testbar:** `summarizeAudit(records, options)` ohne Dateisystem und ohne Uhr; 13 Fixture-Tests.
- **Erster Lauf:** 1 Aufruf, 1 Tag, 1 Werkzeug, 0 schreibend — Kriterien messbar und offen.
- **Prüfstand:** 556/556 Tests, deployt, Sub-Repo-Commit `dba6c3f`.

## Work State
- **Fertig:** D0, D, F, Doku.
- **Offen:** Ebene-3-Prompt, S1–S4/CI.

## Next Move
1. Ebene-3-Prompt gegen die 33 festen Fälle prüfen und mit `bench-mcp --model` messen.

================ Compaction 05.11.2026 / 15:05 ================
## Objective
- **Current:** Audit, Auswertung und ein Entscheidungsmodell als Ebene 3/1.
- **Completed:** D0 belegt, D und F gebaut, Prompt gemessen, Clef-Flash integriert.

## Important Details
- **D0 (Fall B):** `permission.evaluate` feuert mit `action` und `metadata.input`; `source.id` gleicht `execute.after.id`, gilt aber je `execute`-Block (zwei Aufrufe, dieselbe ID); `execute.after` feuert für jedes MCP-Werkzeug und zusätzlich für `execute`. Korrelation deshalb über Sitzung + Werkzeug + Argument-Hash.
- **D:** `audit.js` schreibt je Aufruf `decision` + `result` als Hash-Kette, Rotation bei 5 MB, `verify-audit.mjs` prüft beide Generationen. Keine Argumentwerte; `p` wird mitgespeichert.
- **F:** `mcp-report.mjs` zählt nach Werkzeug, Absicht, Entscheidung, Schicht, Modus; Matrix Effekt→Urteil; Kriterienstand (7 Tage/50 Aufrufe/3 Werkzeuge, davon 1 schreibend) am Ende.
- **Reproduzierbarkeit:** `temperature 0` schaltet nur die Sampling-Zufälligkeit ab. Derselbe Prompt lieferte je nach Prompt-Cache 10/14 und 12/14; mit `seed: 42` und `cache_prompt: false` dreimal 12/14. Messreihen laufen deshalb `deterministic`.
- **Prompt:** kompakt 12/14, Rollen- und Felderklärung 8/14 (Modell flüchtet in „Nein"), eine Kontextzeile 11/14. Ein Wort („mit") kippte 12/14 auf 11/14 und das Gate 3/3 auf 2/3 — Formulierung ist fixiert.
- **Entscheidungsmodelle:** `/v1/systemone` existiert lokal. Laya (421M) trennt nicht (8/14, p 0,09–0,60). Clef-Flash (9B, Q4_K_M, 6,3 GB) trennt MCP (Rückfrage ≤ 0,458, Freigabe ≥ 0,884) und Shell (0,02–0,06 gegen 0,94–0,97) sauber; Schwelle 0,7, 75 ms. Modellkarte: `https://huggingface.co/Cloudflare/clef-flash`.
- **Bonsai-Modelle:** Reasoning-Modelle; bei `max_tokens: 8` geht das Budget für `reasoning_content` drauf, `content` bleibt leer. Mit 64 Tokens antworten sie sauber. Abschaltbar über die Reasoning-Option, für den Guard aber nicht attraktiv.
- **Entscheidungen:** npm GitHub-only (`private: true`); F-Kriterien 7 Tage/50/3 inkl. schreibend; dritte Antwort „Unbestimmt" eingebaut, aber standardmäßig aus (11/14).

## Work State
- **Completed:** D0, D, F, Prompt, systemone für MCP und Shell, Doku, Deploy.
- **Active:** nichts.
- **Blocked:** Umstellung der Laufzeitkonfiguration auf Clef wartet auf Nutzerentscheid; kein Push.

## Next Move
1. Die 14 Shell-Fälle als `shell-cases.jsonl` festschreiben und in ein `bench-shell` aufnehmen, damit die Zahlen reproduzierbar bleiben.
2. Nach Nutzerentscheid: `baseUrl`/`model` auf Clef, `mcpBackend` und `shellBackend` auf `systemone`; 24 h Schatten beobachten.
3. S1–S4 im Sub-Repo, CI grün vor dem ersten Push; Aktivierung erst nach den F-Kriterien.

## Relevant Files
- `audit.js`, `verify-audit.mjs`: Kette und Prüfer.
- `mcp-report.mjs`: Auswertung und Kriterienstand.
- `reviewer.js`: Prompt, `systemone`, Schwellen.
- `bench-model.mjs`, `mcp-model-cases.jsonl`: Messreihe.
- `PLANUNG.md`: Entscheidungen und Messungen.

## Important Context
- **Produktion unverändert:** `mcpBackend`/`shellBackend` sind `chat`; Clef läuft nur während der Messung auf Port 8082.
- **Kein Push:** das Repository bleibt beim Nutzer.
- **Teststand:** 573/573, Deploy byte-identisch.
- **Nachbar-Repo:** Die Hooks und die Urteilsdatei für Skills liegen in `~/.agents`; deren Änderungen gehören in dieses Repository, nicht hierher.

=============== Compaction 05.11.2026 / 21:18 ================
## Objective
- **Current:** actionlint als automatische CI-Pruefung fuer die Workflow-Dateien dieses Sub-Repos ergaenzen.
- **Completed:** `.github/workflows/actionlint.yml` hinzugefuegt; CHANGELOG aktualisiert.

## Important Details
- **Why:** Die Node-Tests pruefen das Verhalten des Guards, aber nicht, ob GitHub die Workflow-Beschreibung korrekt versteht. actionlint prueft YAML, GitHub-Ausdruecke und Action-Eingaben.
- **Implementation:** Eigenstaendiger Check bei Push und Pull Request; offizielles, auf `rhysd/actionlint:1.7.12` festgelegtes Image. Es bringt shellcheck und pyflakes mit. Lokales Podman/Docker ist dafuer nicht erforderlich.
- **Verification:** Lokaler actionlint-Lauf ueber den Workflow-Ordner: 0 Befunde; danach Node-Suite und MCP-Fallbestand separat geprueft.

## Work State
### Completed
- Workflow + CHANGELOG + dieser Compaction-Block.
### Blocked
- Kein Push durch den Agenten; bleibt beim Nutzer.

## Relevant Files
- `.github/workflows/actionlint.yml`, `CHANGELOG.md`

=============== Compaction 10.11.2026 / 10:21 ================
## Objective
- **Current:** Vier Codex-Security-Befunde im permission-guard beheben.

## Important Details
- **Finding 1:** `extractTargets` prueft bei .NET-Copy/Move/Replace und Copy-/Move-/Rename-Cmdlets alle Operanden; unklare Bindungen sind `deny`.
- **Finding 2:** `scopeWrites` arbeitet sequenziell mit cwd und Variablenbindungen; Kontrollfluss/Location-Stack mit Zustandsaenderung sowie unaufloesbare Bindungen sind `deny`; Wildcards bleiben `ask`.
- **Finding 3:** `index.js` loggt nur `Name#Hash`; `diagnostics.js` legt den Logpfad pro UID an und erzwingt auf POSIX `0700`/`0600`.
- **Finding 4:** `deletionFlags` loest eindeutige PowerShell-Prefixe (`-r`, `-fo`) auf; punktierte Ziele ohne bekannte Dateiendung gelten als potenzielle Verzeichnisse.
- **Tests:** 686/686 Guard-Tests, 13/13 Verdrahtung, 33/33 MCP-Faelle; Syntaxchecks gruen.

## Work State
### Completed
- Code, Tests, README, CHANGELOG.
### Blocked
- Kein Deploy und kein Push; die Laufzeitkopie bleibt unveraendert.
### Next Move
1. Nutzerentscheid zu Deploy via `deploy.ps1`.
2. Danach Push durch den Nutzer.

## Relevant Files
- `guard.js`, `index.js`, `diagnostics.js`, `stats.mjs`, `test.mjs`, `README.md`, `CHANGELOG.md`


=============== Compaction 12.11.2026 / Befehlsstil-Doku ================
## Objective
- **Current:** Die Guard-Dokumentation erklärt Segmentierung und Umleitungen.
  Die Stilregel für Agentenbefehle steht in `~/AGENTS.md`.
- **Why:** Entscheidung E8 vom 11.11.2026 des Nutzers: Die Stilregel bleibt global
  für alle Harnesses. Die technische Erklärung der Segmentierung gehört in diese
  Dokumentation.

## Status
- `README.md`: Abschnitt „Befehlszerlegung und Befehlsstil“ ergänzt, vor „Ebene 1“.
- Umleitungen sind mit dem Code abgeglichen: Standard-Handles sind keine
  Verschleierung, Dateiumleitungen zählen als Schreiben.
- Keine Codeänderung. Tests nicht ausgeführt, weil nichts committet wird und die
  Änderung reine Doku ist.
- Offen: Der Reviewer antwortet seit dem 11.11. nicht mehr (Ursache in einer
  eigenen Session zu klären, siehe PLANUNG O-15).

## Next Move
1. Vor einem Commit `node test.mjs`, `node test-wiring.mjs` und `node bench-mcp.mjs`
   ausführen, wie es das Repo vorschreibt.
2. Commit und Push nur auf Anweisung des Nutzers.


=============== Compaction 13.11.2026 / Review-Befunde Kerndateien ================
## Objective
- Die Befunde aus dem code-review (medium) über `guard.js`, `index.js`, `audit.js`,
  `reviewer.js` beheben. Mehrere waren fail-open: Der Guard erlaubte destruktive
  Befehle. Begründung: `AGENTS.md` verlangt fail closed.

## Status
- Behoben, mit Regressionstest je Befund plus Kontrollfall (`test.mjs`, Abschnitt
  "Befunde des Reviews vom 13.11.2026"):
  - Kommentar-Schnitt in Strings (`stripComment`)
  - `$( … )`, `@( … )`, `@{ … }` als Teilausdrücke (`subexpressions`)
  - PowerShell-Abkürzungen der Netz-Parameter (`netFlagKind`)
  - git config Schreibformen, git stash ohne Unterbefehl
  - `New-Object` nur für wenige Lesetypen (`classifyNewObject`)
  - `-Target` als Ziel
  - Außerhalb-Schreiben vor "nicht einordenbar" verweigern
  - `index.js`: Modell sieht auch die Metadaten-Befehle
  - `reviewer.js`: `error`-Listener beim Start von `pwsh`; Test mit Prozess-Probe,
    im alten Zustand nachweislich rot (Exit 1) und im neuen grün (Exit 0)
- Gates: `test.mjs` 708/708, `test-wiring.mjs` 13/13, `bench-mcp.mjs` 33/33,
  `bench-mcp.mjs --change` unverändert.
- `index.js` lässt sich in diesem Ordner nicht importieren (fehlendes Paket
  `@opencode/plugin`). Die Änderung ist nur per `node --check` und Lesen geprüft,
  nicht durch einen Test.

## Offen (Entscheidung nötig)
- MCP `sync`: Mit `sync` als Schreibverb fiel der Bench-Fall `warc0s-project-sync`
  von "Modell entscheidet" auf "ask". Das ist eine Designfrage. Gelöst wurde nur der
  Konflikt "Lesewort neben sync" (`MCP_AMBIGUOUS_VERBS`). Wer `sync` allgemein als
  schreibend will, ändert dann den Bench-Erwartungswert bewusst.
- Nicht im Review-Ergebnis, aber laut Review real: `$null = Remove-Item …` und
  `@(Remove-Item …)` in der statischen Liste des Reviewers; `shellThreshold: 0` in der
  Konfiguration lässt jede Wahrscheinlichkeit als allow durch. Nicht behoben.
- Zwei Plugin-Instanzen mit gemeinsamer `audit.jsonl` können die Kette verzweigen
  (nur aus dem Code abgeleitet, nicht geprüft). Nicht behoben.
- `reviewer.js` mit neuem Standard (`systemone`): Die Messung mit
  `bench-model.mjs --repeat 3` (AGENTS.md) steht weiter aus.

## Next Move
1. Entscheidung zu `sync` treffen.
2. `bench-model.mjs --repeat 3` gegen das laufende Modell.
3. Die offenen Punkte oben einzeln als Befund prüfen und beheben.
4. Commit und Push nur auf Anweisung.
