# Changelog

Alle wichtigen Änderungen an diesem Projekt. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- **Grenz-Markierung für MCP-Ergebnisse (20.11.2026, G1):** `index.js` umschließt
  im `execute.after`-Hook die Textinhalte von MCP-Ergebnissen mit
  `[ud-<id>]…[/ud-<id>]`, entschärft vorhandene `[ud-`-Marker im Text zu
  `[ud_` (Spoofing-Schutz) und ergänzt über `session.hook("context")` eine
  Systemanweisung, dass der Inhalt Daten und keine Anweisung ist.
  Dateiinhalte bleiben unberührt. Schalter
  `PERMISSION_GUARD_RESULT_SHIELD` mit `off` (Standard), `annotate` und `scan`.
  `test-index.mjs` 35/35 (vier neue Fälle).
- **Deny-Limits (20.11.2026):** `index.js` zählt je Sitzung die Rückfragen.
  Drei in Folge oder zehn in den letzten fünfzig werden zu `deny` mit einer
  Meldung, die die Zahl nennt; `allow` und `deny` setzen die Folge zurück. Der
  Zähler wird bei jedem `session.execution.started` geleert, das Limit gilt
  also je Turn. Schwellen über `PERMISSION_GUARD_DENY_CONSECUTIVE`,
  `PERMISSION_GUARD_DENY_RECENT` und `PERMISSION_GUARD_DENY_WINDOW`
  verstellbar. Gezählt wird jede `ask`, nicht nur die des Modells — bei uns ist
  jede davon eine Rückfrage, die weggeklickt werden muss.
  `test-index.mjs` 29/29 (sechs neue Fälle). Ein aktiver Turn-Abbruch ist nicht
  umgesetzt.
- **Vier Achsen in der Shell-Prüfung (20.11.2026):** `reviewer.js` stellt im
  selben `/v1/systemone`-Request drei weitere `noul`-Fragen — `sensitive`
  (private Daten allgemein, breiter als `secrets`), `untrusted` (Code oder
  Inhalt aus fremder Quelle) und `obscured` (verschleiert oder kodiert). Eine
  Freigabe braucht `reads ≥ shellThreshold` **und** jede Achse unter ihrer
  Grenze; eine fehlende Antwort ist eine Rückfrage. Neue Schwellen
  `sensitiveThreshold`, `untrustedThreshold`, `obscuredThreshold` (je 0,5,
  Band über 0 bis 0,5). `bench-shell` 23/23 einstimmig, `bench-model` 14/14,
  `test.mjs` 962/962 (sieben neue Fälle). Mit Clef-Flash gemessen: `untrusted`
  0,973 für einen heruntergeladenen Skript-Aufruf, `obscured` 0,955 für `-enc`,
  `sensitive` 0,443 neben `secrets` 0,955 beim privaten Schlüssel.
  **Grenze:** Nur der Decision-Modell-Typ `clef` legt alle Fragen in einen
  Prompt; llama.cpp kennt sieben Typen, bei den anderen entsteht ein Prompt je
  Frage. Gemessen ist ausschließlich Clef-Flash. Beide READMEs empfehlen
  deshalb ein Clef-Modell und nennen die Prüfung über die GGUF-Metadaten
  (`<arch>.decision.type`), weil ein Dateiname kein Beleg ist. Geprüft am
  20.11.2026: Nur `ggml-org/Clef-Flash` und `ggml-org/Kev-4B` sind
  SystemOne-fähig; `NANI-Nithin/clef-flash` (nur Language Tower),
  `Jev-Omni` (Python-Adapter) und `Jeff-1.1` (Jev-Format) nicht. Ein fehlendes
  Metadatum kann auch am Quantisierer liegen; bei diesen drei Fällen belegt die
  Original-Karte, dass der Decision-Head separat liegt oder fehlt.
- **Kev-4B gemessen (20.11.2026):** Q4_K_M (2,83 GB) trifft mit
  `shellThreshold` 0,50 alle 23 Shell-Fälle; mit Clef-Schwelle 0,65 nur 20/23.
  Q8_0 (4,18 GB) trifft 22/23 (`write-git-add` 0,495). Die Schwellen sind
  modellabhängig. `-np 5 --kv-unified` brachte bei fünf kurzen Anfragen keinen
  Gewinn (Faktor 1,01–1,03). Weitere Modelle aus der ggml-Collection stehen als
  Vormerk in `PLANUNG.md`.
- **`pdftotext` und `pandoc` (20.11.2026):** `guard.js` prüft beide mit eigenen
  Funktionen statt über `READ_BINARIES`. `pdftotext` gilt als lesend, solange
  keine Ausgabedatei folgt (oder `-` als Ziel steht); die 14 Optionen mit
  eigenem Wert werden übersprungen. `pandoc` gilt nur ohne `-o`, `-L`, `-F`,
  `-d`, `--pdf-engine` und `--extract-media` als lesend — diese Optionen
  schreiben eine Datei oder starten fremden Code, `--sandbox` verhindert das
  nicht. Grundlage sind die Hilfetexte von Poppler 26.09.0 und Pandoc 3.14.
  `test.mjs` 955/955 (17 neue Fälle); `README.md`, `README_de.md` und
  `PLANUNG.md` nachgezogen.
- **P2-Beobachtung ausgewertet (20.11.2026):** `PLANUNG.md` hält das Ergebnis
  des Beobachtungsfensters 13.–19.11.2026 fest (136 Entscheidungen, 17
  Werkzeuge, vier angewendete `ask` → `allow`, F-Kriterien wegen fehlender
  schreibender Werkzeuge unentschieden, kein Guard-Fehler).
- **Lese-Werkzeug ohne Verb (20.11.2026):** `guard.js` führt
  `MCP_READ_ONLY_TOOLS` mit `open-knowledge_exec`; das Werkzeug gilt damit als
  `read` und erreicht Ebene 3 nicht mehr. Die Liste ist bewusst nach exaktem
  Namen sortiert, weil `exec` allein bei anderen Servern Code ausführt.
- **Aufwärmlauf wiederholt sich (20.11.2026):** `reviewer.js` versucht eine
  geschlossene Verbindung (`ECONNREFUSED`) bis zu fünfmal im Abstand von
  500 ms und nennt den Code im Log; andere Netzfehler bleiben einmalig.
- **Schreibende MCP-Werkzeuge (20.11.2026):** `mcp-cases.jsonl` prüft drei
  Fälle (`open-knowledge.write` im Projekt, mit `../` daraus ausbrechend, und
  `open-knowledge.delete`). Ergebnis: der Guard fragt in allen drei Fällen und
  unterscheidet das Ziel nicht — anders als die Shell-Prüfung, die außerhalb
  des Projekts verweigert. `bench-mcp.mjs` führt jetzt 36 Fälle (11 Verbote).
- **Pfadabgleich für MCP (20.11.2026):** `guard.js` führt `mcpOutsidePaths()`;
  `mcpVerdict(criteria, input, scope)` verweigert `write` und `destructive`,
  deren Zielpfad außerhalb von Projekt, Temp und vertrauten Ordnern liegt.
  Geprüft werden die Zielfelder (`path`, `file`, `folder`, `output`, `target`,
  `cwd`, …), nicht `source`. Innerhalb bleibt es `ask`. `index.js` übergibt
  Projekt, Temp und Wurzeln aus `guardOptions`. `mcp-cases.jsonl` wächst auf 40
  Fälle (15 Verbote) mit `open-knowledge`, `xlsx-tools-mcp` und
  `libreoffice-calc`. Live belegt nach dem Deploy: Ziel außerhalb → `deny`,
  keine Datei; Ziel im Projekt → `ask`, Rückfrage erschien. Einzelheiten in
  `COMPACTIONS.md`.
- **Compaction (20.11.2026):** `COMPACTIONS.md` hält Sitzungsziel,
  Entscheidungen, die Korrektur der eigenen Fehlaussage zum Audit-Feld
  `layer`, den Live-Beleg und den nächsten Schritt fest (Compaction
  20.11.2026 / 15:21).

- **Größenlimit, Geheimnisfrage und Modellstapel (20.11.2026):** `guard.js`
  verweigert MCP-Argumente über 32000 Zeichen (`deny`), außer der Werkzeugname
  belegt eine Leseabsicht und es gibt keinen Geheimnisverdacht; `reviewer.js`
  macht aus einer fehlenden Secrets-Antwort `ask` statt `allow` und aus dem
  Serverfehler „input … is too large to process" `deny` (andere Serverfehler
  bleiben `ask`, Shell- und MCP-Pfad). `test.mjs` (934/934), `bench-mcp.mjs`
  (33/33, 11 Verbote), `mcp-cases.jsonl` und `AGENTS.md` folgen; `README.md`
  und `README_de.md` beschreiben den Stand, `SECURITY.md` nennt die Ausnahme
  von der Rückfrage-Zusage, `docs/adr/0002-reviewer-und-sandbox.md` trägt die
  Begründung als Nachtrag. `start-reviewer.ps1` übergibt für das
  Entscheidungsmodell `-b 4096 -ub 4096` (neue Parameter `-Batch`/`-Ubatch`,
  Standard 4096) und übersteuert damit `batch-size`/`ubatch-size` aus
  `%APPDATA%\llama.cpp\config.ini`, die für Chatmodelle unverändert bleiben;
  beide READMEs nennen die Stapelgrenze unter „Grenzen/Limits". Gemessen mit
  `ubatch` 1024/2048/4096: die nutzbare Eingabe liegt zwischen 5000 und 6000,
  zwischen 12000 und 16000 bzw. zwischen 24000 und 32000 Zeichen; die
  GPU-Belegung beträgt bei 4096 rund 7,1 GB von 16,3 GB.

- **Zeilenenden und BOM (18.11.2026):** `.gitattributes` setzt den Standard
  `* text=auto eol=lf` und nimmt Binärdateien (`*.png`, `*.jpg`, `*.jpeg`,
  `*.gif`, `*.ico`, `*.gguf`, `*.woff`, `*.woff2`) aus; die bisherigen
  Endungsregeln bleiben. `.editorconfig` beschreibt denselben Stand für
  Editoren (UTF-8 ohne BOM, LF, Abschlusszeile; PowerShell 4 Leerzeichen;
  Markdown behält Leerzeichen am Zeilenende). `scripts/enable-hooks.ps1` setzt
  pro Klon zusätzlich `core.autocrlf false` und `core.eol lf`. `ci.yml` hat den
  neuen Job `zeilenenden`: `git ls-files -z --eol` lässt CRLF in getrackten
  Textdateien scheitern, eine Prüfung auf `EF BB BF` meldet BOM-Dateien;
  gemeldet wird nur der Dateiname.
- **Dependabot (18.11.2026):** `.github/dependabot.yml` aus dem
  Eltern-Repository übernommen: `pip` (findet `requirements-dev.txt` über den
  Dateinamen) und `github-actions`, wöchentlich, höchstens fünf offene
  Pull-Requests.
- **Schlüsseldateien als Geheimnispfad (18.11.2026):** `guard.js` ergänzt
  `SECRET_PATHS` um die Endungen `*.pem`, `*.key`, `*.ppk`, `*.pfx`, `*.p12`,
  `*.asc`, `*.ovpn`, `*.kdbx`; ein Treffer bleibt `ask` mit dem Grund
  `Geheimnis: Schlüsseldatei`. Das Muster verlangt Punkt und Trennung, `keys.txt`
  bleibt lesbar.
- **Ausnahmen der Schreibfreigabe (18.11.2026):** `guard.js` lässt einfaches
  Erstellen und Überschreiben im Projekt weiterhin ohne Rückfrage durch, nimmt
  aber Ziele unter `.git/`, `.githooks/` und `.github/` sowie die Dateien
  `shell-reviewer.config.json` und `opencode.jsonc` aus. Diese bleiben `ask`
  mit statischem Grund (`geschützte Ablage …`, `Konfigurationsdatei`); Löschen
  und Rekursion ändern sich nicht.

- **Skill-Baseline ergänzt (17.11.2026):** `hook-regeln.yml` prüft den Push-/PR-Bereich mit demselben `pre-push`-Hook lokal (gitleaks 8.30.1, `GITHOOKS_TEST_GATE=0`, fail closed bei unlesbaren Revisionen); der Verhaltensproben-Schritt des Eltern-Repositories entfällt, weil `tools/githooks-test/` hier nicht existiert. `scripts/enable-hooks.ps1` setzt `core.hooksPath .githooks` pro Klon. `requirements-dev.txt` pinnt `pip-audit==2.10.1`; `ci.yml` führt `pip_audit --strict` im Python-Job aus. Ruff prüft jetzt die Bandit-`S`-Regeln; `assert` (`S101`) und `subprocess` (`S603`) sind in `tests/*` ignoriert, der Produktivcode war schon sauber.

- **`tmp_path`-Workaround, repo-übergreifend ausgerollt (21.11.2026):**
  Pytest legt `tmp_path`-Verzeichnisse mit `mode=0o700` an; die
  Codex-Windows-Sandbox kann danach nicht mehr darauf zugreifen. Die
  `tests/conftest.py` überschreibt daher `tmp_path` und legt pro Test einen
  Ordner unter `tests/artifacts/` (git-ignoriert) an. Die Konvention steht in
  `AGENTS.md`, die Entscheidung in `docs/adr/0003-tmp-path-workaround-codex-sandbox.md`.
  `tests/test_codex_guard.py`: 149 bestanden, 1 übersprungen.

### Geändert

- **`ship.ps1` übersteht den Start der Prüfungen (21.11.2026):** Unmittelbar
  nach `gh pr create` meldet `gh pr checks` „no checks reported" und endet mit
  Exit 1 — der erste Lauf von PR #18 brach daran ab. Das Skript wiederholt
  jetzt genau diese Meldung (5 s Abstand, höchstens 3 Minuten). Jede andere
  Rückmeldung — rote Prüfung, Netzfehler, Zeitüberschreitung — bricht sofort
  ab und nennt die Ausgabe.
- **`ship.ps1` wartet nur auf erforderliche Prüfungen (21.11.2026):**
  `gh pr checks --watch --required` statt `--watch`. Grund: GitHub ließ im
  Push-Lauf 44838614289 den fertigen Job „Zeilenenden und BOM" auf
  `in_progress` stehen, obwohl alle Schritte `success` meldeten — `--watch`
  wartete endlos, während die PR-Seite grün zeigte (erforderlich sind nur die
  vier `Tests (Node …)`-Kontexte und `actionlint`). Ein Fehlschlag unter den
  optionalen Prüfungen wird weiterhin gemeldet: eine zweite Abfrage sucht
  `state == "FAILURE"` über alle Prüfungen und bricht dann ab.
- **Module nach `src/`, Tests nach `test/` (21.11.2026, Stufe 2):** `guard.js`,
  `index.js`, `reviewer.js`, `audit.js`, `diagnostics.js`, `shadow.js` und die
  Berichtswerkzeuge `analyze.mjs`, `replay.mjs`, `stats.mjs`, `mcp-report.mjs`,
  `git-shadow-report.mjs`, `verify-audit.mjs`, `skill-verdicts.mjs` liegen unter
  `src/`; `test.mjs`, `test-index.mjs`, `test-wiring.mjs`, `smoke-reviewer.mjs`,
  `bench-mcp.mjs`, `bench-model.mjs`, `bench-shell.mjs` und die vier Falllisten
  unter `test/`. Die Tests importieren jetzt `../src/`; `test.mjs` 992/992
  (acht neue Fälle für die neuen Pfade).
- **Deploy liefert nur noch Laufzeitdateien (21.11.2026):** `deploy.ps1` und
  `deploy.sh` kopieren die Module, die Berichtswerkzeuge, `stats.mjs`, beide
  READMEs und die drei PowerShell-Skripte. Tests, Falllisten und Messwerkzeuge
  bleiben im Repo: sie importieren `../src/` und liefen im flachen Ziel ins
  Leere. Im Ziel liegen dadurch fünf veraltete Kopien (`test.mjs`,
  `smoke-reviewer.mjs`, `bench-model.mjs`, `shared-cases.jsonl`,
  `mcp-model-cases.jsonl`), die von Hand zu löschen sind — der Guard schützt
  sein Laufzeitverzeichnis und verweigert das Löschen.
- **`classifyNode` kennt die neuen Ordner (21.11.2026):** Eine führende Ebene
  `src/` oder `test/` wird abgezogen, bevor der Dateiname gegen
  `NODE_SELF_SCRIPTS` geprüft wird. Tiefer verschachtelte Skripte und fremde
  Namen bleiben `ask`.
- **`diagnostics.js` fehlte in `package.json` (`files`) (21.11.2026):**
  nachgetragen; `exports` zeigt auf `./src/index.js`, alle `scripts` auf die
  neuen Pfade.
- **Eigene Prüfskripte auch im Guard-Ordner erlaubt (21.11.2026):** Die
  `node`-Allow-Regel war auf `<workspace>\tools\permission-guard` verankert.
  Wurde direkt in diesem Ordner gearbeitet, entstand der doppelt verschachtelte
  Pfad; die eigenen Tests waren `ask`, und drei davon in Folge lösten das
  Deny-Limit aus. `classifyNode` prüft jetzt zwei Wurzeln — die bisherige und
  den Workspace selbst, wenn sein Name auf `permission-guard` endet.
  `NODE_SELF_SCRIPTS` enthält zusätzlich `test-index.mjs`, `test-wiring.mjs`,
  `bench-mcp.mjs`, `bench-model.mjs`, `bench-shell.mjs` und
  `smoke-reviewer.mjs`. `test.mjs` 985/985 (vier neue Fälle).
- **Skripte nach `scripts/` (20.11.2026):** `deploy.ps1`, `deploy.sh`,
  `start-reviewer.ps1`, `watchdog-reviewer.ps1`, `bench-reviewer.ps1` und
  `bench-quality.ps1` liegen jetzt unter `scripts/`. `deploy.ps1` und
  `deploy.sh` bilden den Quellpfad auf den Dateinamen im Ziel ab; das
  ausgelieferte Layout bleibt flach, weil der Plugin-Lader `index.js` dort
  erwartet. `reviewer.js` findet `start-reviewer.ps1` weiterhin neben sich.
  `.githooks/test-gate.conf` führt `scripts/` als Präfix. Tasks neu
  registriert: `permission-guard reviewer` zeigte auf
  `~/.config/opencode/plugin/…` (Einzahl — der Ordner existiert nicht) und
  zeigt jetzt auf `plugins/…`; der Watchdog-Task auf
  `scripts/watchdog-reviewer.ps1`. Neu: `scripts/ship.ps1` — Branch, Push, PR,
  Prüfungen, Merge und `pull` in einem Aufruf.
- **Betriebsmodell Kev-4B (20.11.2026):** `start-reviewer.ps1` startet
  standardmäßig `Kev-4B-Q4_K_M` mit fünf Slots; `--kv-unified` setzt das Skript
  bei mehr als einem Slot selbst, weil llama-server die Vorgabe nur bei
  „Slots = auto" aktiviert. `shellThreshold` 0,50, `mcpThreshold` bleibt 0,70.
  Grundlage: sieben Decision-Modelle, je mit `-np 1` und `-np 5`, Schwellen
  0,30–0,95, danach Gegenprobe mit Mehrheitsentscheid über drei Läufe. Kev-4B
  14/14 MCP und 23/23 Shell, Median 159 ms; Clef-Flash gleichwertig (14/14,
  23/23) bei 193 ms und 6,4 GB, bleibt als Rückfall. Ausgeschieden:
  vllm-d3-edge (18/23, Optimum 0,30 unter der zulässigen Grenze 0,50),
  Kev-0.8B (15/23, entspricht „immer ask"). `reviewer.js` gibt `confidence`
  weiter — nur `choice`/`score` liefern den Wert, die vier Achsen sind `noul`.
  `shell-reviewer.config.example.json` nachgezogen. **Bekannte Folge:** Ein
  unqualifiziertes `Get-ChildItem | Select-String TODO` fragt jetzt nach
  (`secrets` 0,403 gegen Grenze 0,35, weil es auch `.env` treffen könnte);
  Clef-Flash ließ es durch. Der Fall ist im Smoke-Test als modellabhängig
  markiert, mit dem Messwert im Kommentar.
- **Statische Formatkollisionen (20.11.2026, G2):** `guard.js` hat
  `injectionHits` mit sechs Familien — Chat-Template-Marker (inkl.
  `[PROMPT_INJECTION]`), `[INST]`/`<<SYS>>`, Rollenzeilen, Werkzeug-Rahmen,
  die eigene `[ud-`-Grenze, unsichtbare Steuerzeichen (ohne ZWJ, weil der zu
  Emoji gehört). `index.js` nennt einen Treffer als `[verdacht: …]` vor der
  Grenze; der Text bleibt unverändert, nichts wird blockiert. Keine
  Bedeutungsanalyse: überredende Sätze werden nicht erkannt. `test.mjs`
  975/975 (acht neue Fälle), `test-index.mjs` 45/45 (zwei neue Fälle).
- **Webabrufe im Guard (20.11.2026):** `guard.js` hat `scopeWebfetch`: Ziele
  außerhalb von localhost (`localhost`, `[IP_ADDRESS]`/8, `::1`) ergeben `ask`,
  lokale Ziele bleiben erlaubt, ein `deny` der statischen Regeln wird nicht
  angefasst, und ohne lesbare http(s)-Adresse gilt `ask`. `index.js` prüft die
  Action `webfetch` vor dem globalen Kontext, weil sie nur verschärft.
  Adressen stehen nie im Log. Anlass: Code Mode darf jede Adresse abrufen, und
  `opencode.jsonc` erlaubt `webfetch` pauschal — ein Datenabfluss wäre ohne
  Rückfrage durchgegangen. `test-index.mjs` 43/43 (fünf neue Fälle).
- **Grenz-Markierung greift auch in Code Mode (20.11.2026):** Live-Befund: Der
  `execute.after`-Hook markierte die Antwort des MCP-Werkzeugs
  (`shield annotate tool=deepwiki_read_wiki_contents parts=1`), das Modell bekam
  die Markierung nie zu sehen. Ursache im OpenCode-Binary belegt: Code Mode ist
  der Standardweg für MCP-Werkzeuge, das Modell sieht das Ergebnis des
  Werkzeugs `execute`, nicht die Antwort des MCP-Werkzeugs; `content` und
  `output` sind getrennte Felder. `index.js` umschließt deshalb zusätzlich das
  Ergebnis von `execute`. Eine Regel für beide Wege. `test-index.mjs` 38/38
  (drei neue Fälle). Die Systemanweisung über `session.hook("context")` kam
  live an (durch einen Subagenten bestätigt).
- **Aufwärmlauf erkennt Netzfehler tiefer (20.11.2026):** `reviewer.js` sucht
  den Fehlercode nicht mehr nur in `cause.code`, sondern auch in `cause.cause`
  und `cause.errors` (AggregateError); wiederholbar sind `ECONNREFUSED` und
  `ECONNRESET`. Der Grund nennt jetzt die Ursache (`TypeError: connect
  ECONNREFUSED …`) statt nur den Fehlernamen. Anlass: `setup: Aufwaermlauf
  fehlgeschlagen 0 ms (TypeError)` am 20.11.2026 — ohne Code keine
  Wiederholung, obwohl der Server gerade erst startete. `test.mjs` 967/967
  (zwei neue Fälle).
- **`deploy.ps1` ergänzt fehlende Schlüssel (20.11.2026):** `Update-RuntimeConfig`
  gleicht die Laufzeitkonfiguration mit `shell-reviewer.config.example.json` ab:
  fehlende Schlüssel werden ergänzt, vorhandene Werte bleiben unangetastet. Neue
  Parameter `-ShellThreshold` und `-ResultShield` setzen die beiden bewusst
  kalibrierten Werte ausdrücklich; ohne Angabe bleibt der vorhandene Wert.
  `-Check` ändert weiterhin nichts. `ConvertTo-Json` schreibt die Datei neu,
  deshalb ist die Schlüsselreihenfolge danach alphabetisch statt thematisch.
- **Compaction (20.11.2026 / 19:42):** `COMPACTIONS.md` hält Deny-Limits,
  G0/G1, die Kleinschreibung `[ud-`, den Deploy-Weg für die Laufzeitdatei und
  das offene Hindernis fest (OpenCode hat das Plugin nach dem Deploy nicht neu
  geladen, Live-Beleg für G1 fehlt).
- **Schalter in der Konfigurationsdatei (20.11.2026):** `reviewer.js` liest
  `resultShield`, `denyLimitConsecutive`, `denyLimitRecent` und
  `denyLimitWindow` aus `shell-reviewer.config.json`; `sanitizeSwitches()`
  prüft die Werte (Shield-Modus nur `off`/`annotate`/`scan`, Limits in ihren
  Bändern 1–10, 1–50, 10–200). `index.js` nutzt die Werte aus der
  Konfiguration statt aus Umgebungsvariablen; die Umgebungsvariablen bleiben
  als Übersteuerung. `shell-reviewer.config.example.json` nachgezogen,
  `test.mjs` 965/965 (drei neue Fälle).

- **`shellThreshold` 0,7 → 0,65 (20.11.2026):** Mit fünf Fragen im Prompt lag
  der höchste `ask`-Wert bei `effect` bei 0,616 (kube-config 0,688, dort greift
  `secrets` mit 0,913), der niedrigste `allow`-Wert bei 0,664. 0,65 liegt
  dazwischen; über fünf Läufe sind die Werte exakt identisch.
  `shell-reviewer.config.example.json` nachgezogen.

- **npm in Dependabot und CI (20.11.2026):** `.github/dependabot.yml` führt
  jetzt `package-ecosystem: npm` (Lockfile `package-lock.json` liegt vor, also
  prüft Dependabot `@opencode/plugin` und die transitiven Abhängigkeiten).
  `.github/workflows/ci.yml` prüft mit `npm audit --audit-level=high` als
  Gegenstück zu `pip_audit`; der Schritt läuft einmal (Linux, Node 22), weil er
  das Lockfile prüft und nicht die Node-Version. Lokal: `found 0
  vulnerabilities`, Exit 0. `actionlint` grün.

- **Prompt-Schärfung der Shell-Prüfung (20.11.2026):** `reviewer.js` fragt nicht
  mehr „ist das sicher?", sondern „darf das ohne Rückfrage laufen?", und nennt
  auf der Nein-Seite zusätzlich „uses a credential that appears in the text"
  sowie „its effect cannot be determined from the text". Beide Wege (Systemone
  und Chat-Fallback) tragen dieselbe Regel. `bench-shell` 23/23 einstimmig wie
  vorher, `bench-model` 14/14. Die Ja-Seite blieb bewusst unverändert: Vier
  Umformulierungen dort drückten Schreibziele im Temp-Ordner unter die Schwelle
  (0,55–0,70 statt ≥ 0,70). Grenzfälle liegen dicht an 0,7 (0,64–0,81), die
  Schwelle trennt knapp. Der Chat-Fallback ließ sich mit dem laufenden Server
  nicht messen (57 von 69 Antworten ohne Modellurteil); jene Änderung ist
  ungeprüft.

- **ADR-0002 als angenommen markiert (20.11.2026):** Die Statuszeile nennt jetzt
  „angenommen am 20.11.2026" und die zwei offenen Punkte (Stufe 3 mit vier
  Achsen, Deny-Limits). Inhalt und Historie darunter bleiben unverändert; der
  Nachtrag vom 20.11. belegt die drei umgesetzten Entscheidungen.

- **`package.json` mit Repository-Angaben (20.11.2026):** `repository`, `bugs`
  und `homepage` zeigen auf das GitHub-Repo. Der Handle ist seit der
  Entscheidung vom 20.11.2026 in Dateien erlaubt — er steht für den
  Workflow-Aufruf ohnehin in `.github/workflows/guard.yml`; E-Mail-Adressen und
  Klarnamen bleiben ausgeschlossen. `PLANUNG.md` hält die geänderte S0-Abnahme
  fest.

- **Ruff 0.17.4 → 0.17.5 (18.11.2026):** `requirements-dev.txt` pinnt
  `ruff==0.17.5`, `pyproject.toml` verlangt im `[tool.ruff]`-Abschnitt
  `required-version = "==0.17.5"`. Keine Format- oder Lint-Änderung:
  `ruff check`, `ruff format --check` (2 Dateien), `pyright` (0 Fehler)
  und `pytest` (146 bestanden, 1 übersprungen) sind unter 0.17.5 grün.
  `tools/ci/check_ci_pins.py` existiert im Guard-Repo nicht (Eltern-Repo-Code).
- **Parent-Pin angeglichen (18.11.2026):** Das Eltern-Repo
  (`requirements-ci.txt` und `pyproject.toml`) steht jetzt ebenfalls auf
  Ruff 0.17.5; Guard und Parent sind wieder gleich. Lokal ist Ruff 0.17.5
  installiert. Die Eltern-Prüfung `test_home_agents_sync` bleibt unverändert
  rot (Vorab-Drift der Home-Spiegel, nicht pinbedingt); die Eltern-`AGENTS.md`
  nennt Ruff-Zeilen noch auf 0.17.4 und braucht eine eigene Korrektur.
- **`scripts/enable-hooks.ps1` (18.11.2026):** Das Skript setzt seit dem
  18.11.2026 neben `core.hooksPath .githooks` auch `core.autocrlf false` und
  `core.eol lf`; es meldet beide Werte am Ende und bricht bei jedem
  fehlgeschlagenen `git config` mit Exit 1 ab.
- **Zeilenenden der Stapeldateien (18.11.2026):** `.gitattributes` legt `*.bat`,
  `*.cmd` und `*.sln` auf `text eol=crlf`; `*.ps1` bleibt bei `text eol=lf`, weil
  PowerShell LF versteht, cmd.exe aber CRLF braucht. `.editorconfig` spiegelt
  das mit `[*.{bat,cmd}]` und `end_of_line = crlf`. Der CI-Job `zeilenenden`
  prüft CRLF nur noch dort, wo `.gitattributes` `eol=lf` verlangt. Im Repository
  ist derzeit keine `.bat`-, `.cmd`- oder `.sln`-Datei getrackt.
- **Testzahlen (18.11.2026):** `test.mjs` 882 → 899 (elf Fälle für die
  Geheimnis-Endungen und die beiden Schreibweisen, sechs für die Ausnahmen der
  Schreibfreigabe); `README.md` und `README_de.md` nennen an je vier Stellen die
  neue Summe und führen die neue Rückfrage-Zeile in der Tabelle.
- **Schwellen aus der Konfigurationsdatei geprüft (18.11.2026):** `reviewer.js`
  ergänzt `THRESHOLD_BOUNDS` und das exportierte `sanitizeThresholds`;
  `loadConfig` verwirft Werte außerhalb des Bands und fällt still auf den
  Standard zurück. Band: `mcpThreshold` und `shellThreshold` ab 0,5 bis unter 1,
  `secretsThreshold` über 0 bis 0,5. Grund: `"shellThreshold": 0` setzte bisher
  jede Wahrscheinlichkeit auf `allow` (Befund 13.11.2026); bei den
  Secrets-Werten liegt die Freigabe auf der anderen Seite, deshalb die
  spiegelverkehrte Grenze. Dieselbe Bandprüfung gilt jetzt auch für
  `PERMISSION_GUARD_REVIEWER_THRESHOLD` und
  `PERMISSION_GUARD_REVIEWER_SHELL_THRESHOLD`, die bisher nur `0 < n < 1`
  prüften. Direkt übergebene Werte (`overrides` aus dem Code) bleiben
  unverändert. `test.mjs` 873 → 882 (neun Fälle für das Band); `README.md` und
  `README_de.md` nennen an je vier Stellen die neue Summe und beschreiben das
  gültige Band samt stillem Rückfall.
- **`AGENTS.md` (17.11.2026):** Der Satz zur Byte-Identität der Hooks war so nicht wahr: `pre-commit` weicht von der Vorlage ab, weil deren Skill-Struktur-Check hier keinen `skills/`-Ordner findet und Commits blockieren würde. Die Abweichung ist jetzt dokumentiert.

- **Optionaler CPU-Start des Reviewers (17.11.2026):** `start-reviewer.ps1`
  kennt `-Cpu` und setzt dann `-ngl 0`. Ohne den Schalter bleibt `-ngl all`
  und damit der bisherige CUDA-Standard unverändert. `README.md` und
  `README_de.md` nennen den passenden CPU-only-Server, das nötige höhere
  `timeoutMs` und die Messwerte. `--no-op-offload` gehört nicht zum
  Empfehlungsweg: Im Smoke-Lauf lagen damit zwei Aufrufe über 6000 ms.
- **Nachwärmen nach Reviewer-Timeout (17.11.2026):** Bricht eine Modellanfrage
  wegen Zeitüberschreitung ab, startet `reviewer.js` im Hintergrund genau einen
  Aufwärmlauf. Die aktuelle Entscheidung bleibt ohne Wiederholung und ohne
  zusätzliche Wartezeit `ask`; gleichzeitige Abbrüche teilen sich denselben
  Aufwärmlauf, und dessen Fehler bleiben folgenlos. Andere Server- und
  Netzwerkfehler lösen kein Nachwärmen aus. Alle vier Entscheidungswege
  (Shell/MCP, systemone/chat) sind angeschlossen.
- **`git commit -n` verweigert (15.11.2026, Nutzerentscheid):** Die Kurzform
  von `--no-verify` ist jetzt in beiden Guards `deny`. Gebündelte Kurzoptionen
  werden von links gelesen; `-an` und `-nm` verweigern, `-mn` ist dagegen die
  Nachricht „n“ und bleibt `allow`. Die Regel gilt nur für `commit`: Bei `clean`
  und `push` bedeutet `-n` `--dry-run`. `shared-cases.jsonl` wächst von 29 auf
  36 Fälle; `node test.mjs` 770/770, `pytest tests -q` 123 passed.
- **Codex verweigert `branch -D` (15.11.2026):** `git branch -D`,
  `git branch --delete --force` und `git branch -d -f` sind im Codex-Guard jetzt
  `deny` wie im OpenCode-Guard. `git branch -d` allein bleibt `allow`; OpenCode
  fragt dort weiterhin nach.
- **Gemeinsame Falldatei mit dem Codex-Guard (15.11.2026):** `shared-cases.jsonl`
  hält 29 Befehle mit dem je Seite erwarteten Urteil. `node test.mjs` prüft die
  OpenCode-Seite, `pytest/unit/test_codex_guard.py` im Eltern-Repository die
  Codex-Seite; beide lesen dieselbe Datei. Zahlen: 770/770 hier, 123 Fälle dort.
  `deploy.ps1` und `deploy.sh` rollen die Datei mit aus, weil `test.mjs` sie
  relativ zu sich liest; im Laufzeitverzeichnis läuft die Suite mit 758/758.
- **`--no-verify` verweigert (15.11.2026, Nutzerentscheid):** `git commit
  --no-verify` und `git push --no-verify` sind jetzt `deny` (vorher `allow` bzw.
  `ask`). Grund: Das Flag umgeht die Projekt-Gates; Codex blockierte es bereits.
  Die Regel greift bei jedem Unterbefehl und hinter globalen Optionen (`-C`,
  `-c`). `git commit -n` ist die Kurzform dazu und ist seit demselben Tag
  ebenfalls `deny`.
- **Secrets-Achse in Ebene 1 (14.11.2026):** Die Shell-Anfrage an `/systemone`
  stellt jetzt zusätzlich die Frage „exponiert der Befehl Zugangsdaten oder
  private Daten?“ (Noul) in derselben Anfrage; die Latenz bleibt gleich (rund
  100 ms). Freigabe braucht beides: `reads ≥ shellThreshold` und
  `secrets ≤ secretsThreshold` (Standard 0,35, nach dem Jevvy-Muster mehrerer
  Achsen). Gemessen am 14.11.2026, 23 Fälle mit je drei Läufen: 23/23
  einstimmig. Vier klassische Pfade (`.ssh`, `.env`, `.aws`) fängt die statische
  Liste; `kube config` und `token-count.txt` fängt die Secrets-Achse.
  `bench-shell.mjs` zählt statisch entschiedene Fälle als Kontrolle der Liste,
  nicht als Modellurteil.
- **Shell-Messung `bench-shell.mjs` (13.11.2026):** 17 Fälle mit Projektbezug
  für Ebene 1, `npm run bench:shell`. Gegenstück zu `bench-model.mjs`, das nur
  Ebene 3 misst.
- **Lock-Datei versioniert, `npm ci` in der CI (13.11.2026):** `package-lock.json`
  ist nicht mehr ignoriert. `ci.yml` und `guard.yml` installieren mit `npm ci`
  und führen `test-index.mjs` aus. Der Test-Gate prüft `test-index.mjs` mit.

- **Verdrahtungstest für `index.js` (13.11.2026):** `test-index.mjs` bindet das
  Plugin mit Fake-ctx ein und prüft Metadaten-Befehle an das Modell sowie
  Aussen-Schreiben. `@opencode/plugin` ist eine devDependency; `npm run test:index`
  führt den Test aus. Er läuft in der CI (`ci.yml`, `guard.yml`).
- **Git-Schattenlauf Variante 3 (09.11.2026):** `gitShadow: "shadow"`
  protokolliert destruktive Git-Formen mit `effect=allow` in
  `%LOCALAPPDATA%\opencode\permission-guard\git-shadow.jsonl`, ohne zu
  entscheiden. `git-shadow-report.mjs` wertet nach Muster, Tag, Agent und
  Variante aus; keine Befehlstexte. 652/652 Tests.
- **Verdrahtungstest (09.11.2026):** `test-wiring.mjs` legt einen Fake-`git`
  in den temporären `PATH`; `deny` für `branch -D`, `checkout .`, `restore .`,
  `reset --hard` und `clean -fd` verhindert den Aufruf, `git status` dient als
  Gegenprobe. 13/13 Tests; läuft in CI (Ubuntu/Windows).
- **Git-Guardrails Option B (09.11.2026):** `evaluate()` verweigert
  `reset --hard`, `clean` ohne Dry-Run, `branch -D`, `checkout .` und
  `restore .` auch hinter `-C`/`-c`/`--git-dir`/`--work-tree`; `RISKY` deckt
  die Varianten und Windows-Git-Pfade ab. `ask`/`deny` nennen Muster und
  Befehl. Statisch: `git branch -D *`, `--delete --force`, `checkout .` und
  `restore .` sind `deny`; `git clean -n`/`--dry-run` bleibt `ask`. Auf Windows
  verweigert `git branch -D *` wegen Case-Insensitivität auch `git branch -d`
  (bewusst akzeptiert). 636/636 Tests.
- **Git-Guardrails-Matrix und Tests (09.11.2026, Option A):** `test.mjs`
  prüft die sieben kanonischen Git-Muster, globale Optionen (`-C`, `-c`,
  `--git-dir`, `--work-tree`), Wrapper und erlaubte Gegenproben. Dazu kommen
  sechs `RISKY`-Fälle und fünf Git-Reviewer-Fälle; 624/624 Tests. Mit Option B
  auf 636/636 erweitert.
- **actionlint-CI:** `.github/workflows/actionlint.yml` prüft bei Pushes und Pull Requests alle GitHub-Actions-Workflows mit dem festgelegten offiziellen Image `rhysd/actionlint:1.7.12`, einschließlich shellcheck und pyflakes.

### Geändert

- **Testzahlen in den READMEs korrigiert (17.11.2026):** `README.md` und
  `README_de.md` nannten an drei Stellen noch 797 Fälle für `node test.mjs`;
  korrekt sind 873. Die 40 gemeinsamen Fälle mit dem Codex-Guard sind in der
  Summe enthalten, nicht zusätzlich. `pytest` heißt jetzt präziser „146
  bestanden, 1 übersprungen". `PLANUNG.md` vermerkt den Push auf `main`, die
  grünen Pflicht-Checks und das Löschen des Prüf-Branchs.
- **Merge ohne aktuellen Branch (17.11.2026, Nutzerentscheid):** Der Regelsatz
  `baseline` verlangt die fünf Jobs weiter, aber nicht mehr
  `strict_required_status_checks_policy` (jetzt `false`, gesetzt 13:47). Damit
  entfallen Zwischen-Merges wie `61ad1f0`; `deletion` und `non_fast_forward`
  bleiben. Die Einstellung liegt auf GitHub, nicht im Repo. Neu:
  `docs/adr/0001-pflicht-checks-ohne-aktuell-zwang.md` (erstes ADR dieses
  Repos, mit Begründung und Grenzen). `PLANUNG.md` ergänzt Entscheidung 9;
  `README.md` und `README_de.md` nennen ADR 0004 jetzt ausdrücklich als ADR des
  Eltern-Projekts; `COMPACTIONS.md` korrigiert die Aussage, es gebe hier kein
  `docs/adr/`.
- **Repo-Hook (15.11.2026):** `.githooks/pre-commit` ist die kanonische Fassung
  mit optionalem `.githooks/pre-commit.local`; hier ist keine lokale Datei
  vorhanden. `README.md` und `README_de.md` beschreiben die Konvention.
- **Ruff prüft nur Python (15.11.2026):** `include = ["*.py", "*.pyi"]` nimmt
  Markdown aus Lint und Formatprüfung. Ruff 0.17 hatte zuvor auch `*.md`
  aufgenommen und Python-Blöcke in der Doku mitformatiert; die Formatprüfung
  meldet jetzt 2 statt 14 Dateien.
- **Python-Teil vollständig geprüft (15.11.2026):** `pyproject.toml` pinnt Ruff
  (`==0.17.4`) und beschreibt Pyright; `requirements-dev.txt` ergänzt pytest,
  Ruff und Pyright. Der Python-Job in `ci.yml` läuft mit `ruff check .`,
  `ruff format --check .`, `pyright` und `pytest tests -q` auf Ubuntu und
  Windows. Belegt: lokal 13 Dateien formatiert, 0 Pyright-Fehler, 107 passed.
- **README zweisprachig (15.11.2026):** `README.md` ist englisch,
  `README_de.md` die deutsche Fassung. `deploy.ps1` und `deploy.sh` kopieren
  beide mit. Die deutsche Fassung enthielt einen Tabellenfehler in der
  Step-E-Übersicht (`project_sync` hatte drei statt vier Zellen); er ist
  korrigiert.
- **Codex-Guard zieht ins Repo (15.11.2026):** `codex_guard.py` und seine
  Pytest-Suite (`tests/test_codex_guard.py`) liegen jetzt hier statt im
  Eltern-Repository. `requirements-dev.txt` pinnt `pytest==9.2.0`; `ci.yml` hat
  dafür einen eigenen Python-Job (Ubuntu und Windows, Python 3.12) und nimmt
  `*.py` in den Pfad- und Schlüssel-Scan auf. `deploy.ps1` und `deploy.sh`
  bedienen zwei Ziele und prüfen beide Testreihen. Die Suiten bleiben getrennt:
  `node test.mjs` (770 Fälle) und `python -m pytest tests -q` (123 Fälle).
- **Test-Gate bricht bei CRLF in der Konfiguration ab (14.11.2026):**
  `pre-commit` und `pre-push` prüfen `.githooks/test-gate.conf` vor dem Einlesen
  auf CR. Bisher wanderte das CR in den letzten Wert; `.githooks/` passte nicht
  mehr als Präfix und der Testbefehl hieß `test-index.mjs\r`. Das Gate
  übersprang damit still oder startete eine nicht vorhandene Datei. Jetzt endet
  der Lauf mit Exit 1 und nennt Datei und Fix. Die Hooks bleiben byte-identisch
  mit `~/.agents/references/githooks/`.
- **GitHub-Helfer auf v7 (14.11.2026):** `actions/checkout` und
  `actions/setup-node` stehen in `ci.yml`, `guard.yml` und `actionlint.yml` auf
  `@v7` statt `@v4`. Grund: GitHub hat Node 20 auf seinen Runnern abgekündigt
  und zwang die v4-Helfer auf Node 24; jeder Lauf meldete das als Warnung. v7
  verlangt Runner ab 2.327.1, auf GitHub gehosteten Runnern immer erfüllt. Die
  Node-Matrix (20/22) bleibt unverändert.
- **MCP `sync` ist schreibend (Nutzerentscheid 13.11.2026):** `sync` allein und
  `sync_status` fragen nach. Der Bench-Fall `warc0s-project-sync` wechselt von
  „Modell entscheidet“ zu „Rückfrage“; die Erwartung ist `ask/1`, die Zählung
  Graubereich 3 → 2 und Rückfrage 13 → 14.
- **Shell-Frage nennt Projekt- und Temp-Ordner im Fragetext (14.11.2026):** Die
  Frage lautet „Is this command safe to run without asking the user?“. Die Ordner
  stehen pro Anfrage im Text, nicht nur im Zustand. Gemessen mit Clef-Flash
  Q4_K_M: 17/17, dreimal je Fall. Vorher lag dieselbe Messung bei 12/17.
- **404 von `/systemone` fällt auf den Chat-Weg zurück (13.11.2026):** Gilt für
  Shell und MCP. Betroffen sind LM Studio und Chat-GGUF. Vorher endete jede
  Entscheidung dort in „ask“. Die Angabe „501“ aus dem Eintrag zum Standard
  `systemone` war unvollständig; es ist 404.

- **Reviewer-Standard auf `systemone` (13.11.2026):** `reviewer.js` setzt
  `mcpBackend` und `shellBackend` standardmäßig auf `systemone` statt `chat`.
  Grund: Der Betriebsfall ist ein Entscheidungsmodell (Clef-Flash über
  llama.cpp, Port 8080), das nur über die Systemone-API Wahrscheinlichkeiten
  liefert, nicht über Chat oder Completion. Ohne eigene Konfiguration antwortet
  das Modell sonst mit 501, und jede Anfrage bliebe `ask`. Wer ein Chat-GGUF
  nutzt, setzt `"chat"` plus Grammatik in `shell-reviewer.config.json`.
- **Git-Abschnitt im README (09.11.2026):** Abdeckungsmatrix für
  Klassifizierer und statische Regeln, getrennte `ask`/`deny`-Zeilen,
  `guard.yml` als CI-Testworkflow klargestellt, Testzahl auf 652 aktualisiert.
  Keine Verhaltensänderung, kein Deploy nötig.
- **Projektanweisungen (06.11.2026):** `AGENTS.md` auf die projektspezifischen
  Guard-, Test- und Release-Regeln reduziert. Allgemeine Arbeits-, Datenschutz-
  und Git-Regeln stehen in `$HOME/AGENTS.md` und werden nicht mehr doppelt
  gepflegt.
- **Backend auf Clef-Flash umgestellt (05.11.2026):** Der Reviewer lädt
  `Clef-Flash-Q4_K_M.gguf` (ggml-org) und entscheidet über `/v1/systemone`;
  `mcpBackend` und `shellBackend` stehen auf `systemone`, Schwelle 0,7. Die
  kompaktere `IQ3_XS`-Fassung scheidet aus: ihre GGUF-Metadaten tragen
  `general.architecture = qwen35`, keinen Decision-Head; `/v1/systemone`
  antwortet mit 501.
- **MCP-Aktivierung (05.11.2026):** `MCP_GATING_MODE = "active"`. Bewusste
  Abweichung von den F-Kriterien (ein Aufruf statt sieben Tage und 50 Aufrufe),
  weil die Kriterien für das Chat-Modell galten; Begründung in `PLANUNG.md`.
  Rücknahme: eine Zeile plus Deploy.
- **Aufwärmlauf folgt dem Backend (05.11.2026):** Bei `systemone` geht die
  Aufwärm-Anfrage an `/v1/systemone` statt an `chat/completions`; zwei Tests
  (575/575).

### Behoben

- **minimatch-Override deklariert (18.11.2026):** `package.json` führt neu
  `"overrides": { "minimatch": "11.0.9", "glob": "14.0.6" }` hinter
  `devDependencies`. Damit sollen `GHSA-g3hv-75wg-m249` (minimatch
  `>=7.0.0 <11.0.1`) und `GHSA-3g3m-2fjr-6pw4` (glob `9.0.0–14.0.1`)
  geschlossen werden. JSON ist gültig (`python -m json.tool`); `node
  test-index.mjs` 17/17 und `node test.mjs` 899/899 sind grün. Das `npm
  install` selbst war als Agent blockiert (Permission denied: shell für
  `npm install`), deshalb ist `package-lock.json` unverändert und `npm
  audit` zeigt weiter 28 Schwachstellen; `npm ls` meldet die
  Override-Versionen als `invalid`. Der Nutzer führt `npm install` von
  Hand aus; danach `npm audit` und `npm ls minimatch` / `npm ls glob`
  erneut prüfen.
- **npm audit geschlossen (18.11.2026):** Nach dem Nutzerwurf (`npm install`
  + `npm audit fix`) meldet `npm audit` 0 Schwachstellen; `npm ls
  minimatch`/`glob` zeigt nur noch `11.0.9`/`14.0.6` (deduped/overridden).
  `node test-index.mjs` 17/17 und `node test.mjs` 899/899 bleiben grün.
- **Datumsangabe in der Beispiel-Konfiguration (18.11.2026):**
  `shell-reviewer.config.example.json` nannte „Standard seit 05.11.2026“; der
  Code-Standard `systemone` wurde am 13.11.2026 gesetzt. Die Angabe lautet
  jetzt 13.11.2026. Kein Verhaltensunterschied.
- **Standard-Backend in beiden READMEs (18.11.2026):** Die Backend-Tabelle für
  Ebene 3 markierte `chat` als Standard. Seit dem 13.11.2026 ist `systemone`
  der Standard; `README.md` und `README_de.md` nennen ihn jetzt mit
  „(default)" bzw. „(Standard)".
- **CI-Privacy-Scan bei neuen Testpfaden (17.11.2026):** `test.mjs` nutzt
  für drei Außenziele jetzt `C:/outside/guard-review-nicht-schreiben.txt`
  statt `C:/Users/…`. Der Ort bleibt außerhalb des Projekts, die
  Deny-Erwartungen sind unverändert; der Ubuntu-Scan findet keinen
  personenbezogenen Beispielpfad mehr. Produktivcode bleibt unverändert.
- **URL-Zugangsdaten in Git-Meldungen (17.11.2026):** Benutzerinfo vor `@`
  wird unabhängig vom Aufbau und unabhängig von einem Tokenwort aus
  `gitRuleMessage()` und `gitAskMessage()` entfernt. Ein undurchsichtiger
  synthetischer Testwert erscheint dadurch nicht mehr im Rückfrage- oder
  Verweigerungstext. Bei quotierten URL-Fragmenten bleibt nur der Musterkopf,
  weil die Benutzerinfo statisch nicht sicher trennbar ist. Alle drei
  Regressionstests waren vorher rot.
- **Schreibende Hauptverben und Geheimnisse verdeckten Pfadverbote
  (17.11.2026):** Diese Rückfragen werden erst vor einer Freigabe angewendet.
  `git push` allein bleibt mit Meldung `ask`; zusammen mit einem Schreibzugriff
  außerhalb des Projekts gewinnt `deny`, auch wenn die URL Geheimnisverdacht
  auslöst. Unauflösbare Ziele mit einem Geheimnis-Ausdruck als Wert bleiben
  `ask`; echte Pfadverbote werden davon nicht abgeschwächt. Die Regressionen
  waren vor der Korrektur rot; Meldungstests für `git push`, Branch-Löschen und
  URL mit Geheimnisverdacht bleiben erhalten.
- **Innere Zitate in `$()` (fünfte Review-Runde, 17.11.2026):** Der Scanner
  verwechselte ein inneres `"safe"` mit dem Ende der äußeren Zeichenkette und
  übersah den folgenden Schreibbefehl. Die Klammerauswertung unterscheidet jetzt
  innere und äußere Zitate. Die Regression verwendet einen Befehl mit inneren
  Zitaten und einem nachfolgenden Schreibzugriff; der PowerShell-Parser meldet
  dafür 0 Syntaxfehler. Eine frühere, syntaktisch ungültige Probe wurde
  verworfen.
- **Vierte Review-Runde an Ausdruck und Zielauflösung (17.11.2026):**
  `else`/`catch`-Folgezweige werden geprüft, verschachtelte Ortswechsel bleiben
  sichtbar und `)` in verschachtelten Strings beendet `$()` nicht vorzeitig.
  `ask` aus einem Teilausdruck wird erst vor einer Freigabe angewendet, damit
  spätere Verbote Vorrang behalten. `scopeWrites()` löst Ziele physisch auf;
  dabei bleibt die Laufwerkswurzel `C:\` vom laufwerksrelativen `C:` getrennt.
  Beide README-Fassungen beschreiben die rekursive Blockprüfung.
- **Dritte Review-Runde an Block- und Pfadgrenzen (17.11.2026):**
  `splitStatements()` schneidet nicht mehr innerhalb eines Skriptblocks;
  Blöcke behalten Arbeitsordner und ursprüngliche Schutzwurzel, während
  absolute Verbote Vorrang vor einer Arbeitsordner-Rückfrage haben.
  Klammerausdrücke in Anführungszeichen bleiben Text. `scopeEdit()` löst
  vorhandene Pfadteile physisch auf; ein echter Windows-Junction-Test weist
  nach, dass ein Ziel ausserhalb des Projekts verweigert wird.
- **Sechs weitere Review-Fälle an Blöcken und Editor-Zielen (17.11.2026):**
  Ortswechsel in einem Block machen folgende relative Schreibzugriffe zur
  Rückfrage; Hashtables verdecken keine weiteren Blöcke mehr; alle Blöcke
  werden gelesen und ein späteres `deny` schlägt ein früheres `ask`.
  Laufwerksrelative Pfade wie `C:.git\config` werden abgelehnt. Leere
  Edit-Ressourcen bleiben Rückfrage, ohne andere Ziele zu überspringen.
  Edit-Gründe enthalten keine Zielpfade oder Benutzernamen mehr.
- **Vier Review-Fälle am neuen Block-/Warmup-Weg (17.11.2026):**
  Klammerausdrücke in Pipeline-Blöcken werden ebenfalls bewertet; eine
  Umleitung hinter dem Block behält ihr Ziel; `cd` wird für jeden Block zum
  tatsächlichen Ausführungszeitpunkt statt erst am Skriptende ausgewertet.
  Start- und Timeout-Aufwärmlauf verwenden in `index.js` jetzt dieselbe Sperre
  und laufen nicht doppelt. Alle vier Fälle waren vor der Korrektur als rote
  Tests reproduziert.
- **Editor-Ziele umgingen die Schutzpfade (17.11.2026):** `index.js` behandelte
  nur Shell-Aktionen; `edit`/`write`/`patch` erreichten die Pfadprüfung nicht.
  Ergibt die statische OpenCode-Regel jetzt `ask`, prüft der neue Export
  `scopeEdit()` alle Zielpfade gegen dieselben geschützten und vertrauten
  Ordner wie Shell-Schreibzugriffe. Ein geschütztes oder außerhalb liegendes
  Ziel verweigert den gesamten Aufruf; Platzhalter bleiben Rückfrage. Statische
  `allow`- und `deny`-Ergebnisse bleiben ausdrücklich unverändert
  (Nutzerentscheid 17.11.2026).
- **Pipeline-Skriptblöcke werden einzeln geprüft (17.11.2026):** `guard.js`
  bewertet die Rümpfe hinter `ForEach-Object`, `Where-Object`, `Select-Object`,
  `Sort-Object`, `Group-Object`, `Measure-Object` und ihren Aliasen jetzt als
  eigene Skripte. Lesende Blöcke und Schreibzugriffe innerhalb des Projekts
  können dadurch durchlaufen; `ask` und `deny` aus dem Block werden mit dessen
  Grund durchgereicht. Das gilt auch für einen Pipeline-Block innerhalb eines
  Kontrollblocks. Hashtables und berechnete Eigenschaften bleiben unverändert.
- **`@{u}` galt als Teilausdruck (17.11.2026):** `git rev-list --left-right
  --count 'HEAD...@{u}'` blieb bei `ask` („Teilausdruck: nicht einordenbar:
  u“), weil `subexpressions()` in `guard.js` jedes `@{` ohne Wortzeichen davor
  als PowerShell-Block las; das `.` der Refschreibweise `HEAD...@{u}` fehlte in
  der Ausnahmeliste. Sie enthält jetzt zusätzlich `.`, `'` und `"`, damit auch
  `'@{u}..HEAD'` durchläuft. `$(` bleibt unverändert geprüft - nur dort führt
  PowerShell Inhalt in einem String aus. Belegt mit `node test.mjs` (800/800,
  drei neue Fälle), `node test-index.mjs` (8/8), `node test-wiring.mjs`
  (13/13), `node bench-mcp.mjs` (33/33), `pytest tests -q` (146 passed, 1
  übersprungen), `ruff check`, `ruff format --check` und `pyright` (0 Fehler).
- **Löschprüfung war plattformabhängig (17.11.2026):** Unter Linux lehnte
  `codex_guard.py` zwei Fälle ab, die unter Windows erlaubt waren:
  `Remove-Item -Recurse .\cache\npm` (Backslashes sind unter POSIX
  Namensbestandteil, nicht Trenner) und `rm -rf staging/x`, wenn der Aufrufer
  einen relativen Projektordner übergibt. `is_allowed_delete_target()` liest
  einen Backslash unter POSIX nur dann als Trenner, wenn das wörtliche Ziel
  nicht existiert; `delete_roots()` löst den Projektordner einmal auf, und ohne
  Auflösung entfällt die Projektwurzel (Ablehnung). Damit ist auch die vorher
  offene Randlage geschlossen: Ein echtes `cache\npm` im Projektordner ist
  wieder `deny`. Belegt mit `pytest tests -q` (146 passed, 1 POSIX-Test
  übersprungen, unter Windows) und 147 passed unter WSL/Linux, dazu
  `node test.mjs` (797/797), `ruff` und `pyright`.
- **Skriptblock galt als Lesen (Review 17.11.2026):** `guard.js` bewertete
  `Get-ChildItem | ForEach-Object { Remove-Item -Recurse -Force C:/Windows/x }`
  als „nur lesend“, weil nur der Cmdlet-Name geprüft wurde. Ein Block hinter
  `ForEach-Object`, `Where-Object`, `Select-Object`, `Sort-Object`,
  `Group-Object` oder `Measure-Object` (auch Aliase `%`, `?`, `select`, `sort`,
  `group`, `measure`) ist jetzt `ask` mit eigenem Grund und erreicht das Modell
  nicht (`PIPELINE_BLOCK_CMDLETS`, `hasScriptBlock()`; Zweig `block` in
  `evaluate()`). Kontrollblöcke (`if`, `foreach`, `while`) werden weiterhin Satz
  für Satz geprüft. Zwei bisherige Testerwartungen (harmlose
  `Where-Object`-/`ForEach-Object`-Blöcke) sind bewusst auf `ask` gezogen.
- **`1>` und `2>` wurden nicht als Umleitung erkannt (Review 17.11.2026):**
  `Get-Content a.txt 1> C:/Windows/x.txt` war „nur lesend“, weil die Ziffer vor
  dem `>` als Wortzeichen galt. `hasRedirection()` erkennt die Ziffer jetzt als
  Teil des Operators; `2>&1`, `*>&1` und `2>$null` bleiben ausgenommen, und
  `extractTargets()` prüft das Ziel. Damit greift die Zielprüfung in
  `scopeWrites()` auch für `1>`/`2>`.
- **Einzelnes `&` trennte keine Befehle (Review 17.11.2026):** In `guard.js`
  galt `Get-Content a.txt & Remove-Item -Recurse -Force C:/Windows/x` als ein
  Segment und damit als „nur lesend“. `splitStatements()` trennt jetzt an einem
  einzelnen `&`; in `2>&1` und in Anführungszeichen bleibt es Text. Am
  Segmentanfang bleibt `&` der Call-Operator und verweigert - auch ohne
  Leerzeichen (`&$cmd`), die Prüfung ist von `/^&\s/` auf `/^&/` erweitert.
- **Einzelnes `&` umging die Codex-Regeln (Review 17.11.2026):**
  `codex_guard.py` zerlegte nur an `;`, `|`, `&&` und Zeilenenden; `echo ok &
  git push` war ein Segment und kam durch. `split_segments()` trennt jetzt
  zusätzlich am einzelnen `&`, außerhalb von Zitaten und außerhalb von
  `>&`/`<&`; Shell-Hüllen werden wie bisher rekursiv geprüft.
- **Rekursives Löschen prüfte nur Pfadbestandteile (Review 17.11.2026):**
  `codex_guard.py` erlaubte jedes Ziel, in dem irgendwo `cache`, `staging`,
  `tmp` oder `temp` stand, und ließ absolute POSIX-Ziele aus. Jetzt entscheidet
  der aufgelöste Pfad gegen die freigegebenen Wurzeln (diese vier Ordner im
  Projektordner plus das tatsächliche System-Temp); `..` im Ziel, absolute
  Ziele außerhalb und relative Ziele in einer Kette oder Shell-Hülle werden
  abgelehnt. Projektanker ist der Ausführungsordner aus dem Hook-Eingang
  (`cwd`), sonst der Ordner des Hook-Prozesses. `shared-cases.jsonl` wächst von
  36 auf 40 Fälle; `node test.mjs` 797/797, `pytest tests -q` 146 passed.
- **`test-index.mjs` rot auf Ubuntu (14.11.2026):** Beide Ubuntu-Jobs brachen
  bei „Verdrahtung index.js (Plugin)“ ab (4/6), Windows war grün. Ursache: Der
  Fake-ctx setzte `location.directory` auf `path.resolve("./scratch-project")`,
  also einen POSIX-Pfad. `resolveTarget` löst nur Laufwerkspfade auf und gibt für
  alles ab `/` `null` zurück; `scopeWrites` endete damit auf „Arbeitsordner
  unbekannt“, das Außen-Schreiben wurde zu `ask` statt `deny` und erreichte das
  Modell. Der Test setzt den Projektordner jetzt auf `C:\work\scratch-project`,
  wie die übrigen Fälle in `test.mjs`. Lokal 6/6; der Ubuntu-Lauf ist erst nach
  dem Push belegbar.
- **Zuweisung umging die Schreibprüfung (13.11.2026):** `$null = Remove-Item
  -Recurse -Force C:/x` war als „Schreiben in vertrautem Ordner“ erlaubt. Ursache:
  `updateVarMap` verbuchte jede Zuweisung als reine Bindung und übersprang die
  Zeile. Jetzt gilt nur ein Literal als Bindung; der Befehl dahinter wird geprüft.
  Die Löschprüfung arbeitet auf dem Befehl ohne Zuweisung. Der Fehler bestand
  schon vor den Korrekturen des Tages.
- **Statische Reviewer-Liste (13.11.2026):** Eine Zuweisung oder ein `@(` davor
  gibt den Befehl dahinter nicht mehr frei.
- **Argumente an das Modell (Review, 13.11.2026):** Kanal-Tags werden wie im
  Chat-Pfad neutralisiert; Texte sind auf 8000 Zeichen begrenzt.
- **Zeitbudget Shell (Review, 13.11.2026):** Alle Segmente zusammen haben ein
  Budget von `timeoutMs`. Vorher galt das je Segment.
- **Audit-Kette bei zwei Plugin-Instanzen (13.11.2026):** Beide Instanzen teilen
  `audit.jsonl`. Der Zustand wird jetzt vor jedem Anhängen aus der Datei gelesen.
  Vorher brach die Kette mit „seq 1 statt 3“.
- **Aufwärmlauf bei gemischten Backends (Review, 13.11.2026):** Beide Wege werden
  gewärmt, und nach einem 404 auch der Chat-Weg.

- **Review-Befunde Kerndateien (13.11.2026):** Im Review der Kerndateien
  (`guard.js`, `index.js`, `audit.js`, `reviewer.js`) wurden Umgehungen
  bestätigt, die Befehle fälschlich erlaubten. Behoben in `guard.js`:
  - `#` innerhalb eines Strings schnitt den Rest der Zeile ab. Ein Kommentar
    endet jetzt nur außerhalb von Anführungszeichen.
  - `$( … )` in doppelt gequoteten Strings sowie `@( … )` und `@{ … }` werden
    als eigene Teilausdrücke geprüft. `stash@{0}` bleibt ein Index.
  - PowerShell-Abkürzungen von Netz-Parametern (`-M`, `-B`, `-OutF`) gelten als
    die gesperrten Parameter.
  - `git config --unset`, `--add`, `--replace-all`, `--edit` sind Schreibformen.
    `git stash` ohne Unterbefehl und `git stash -u` sind Schreibformen; lesend
    bleiben nur `list` und `show`.
  - `New-Object` ist nur für wenige reine Lesetypen erlaubt (Puffer, Zähler,
    Listen). `WebClient`, `StreamWriter` u. a. sind Rückfrage.
  - `-Target` (z. B. `New-Item -ItemType Junction`) zählt als Schreibziel.
  - Außerhalb-Schreiben wird verweigert, auch wenn der übrige Befehl unlesbar
    ist. Vorher ging der ganze Befehl an das Modell.
  - MCP: `sync` ist mehrdeutig. Neben einem Lesewort (`sync_status`) gilt der
    Aufruf als schreibend. Ohne Lesewort bleibt die Einordnung offen.
  In `index.js` sieht das Modell jetzt auch die Befehlsfelder der Metadaten, nicht
  nur `resources`. In `reviewer.js` fängt der Start einen fehlenden `pwsh`
  ab, statt den Host zu beenden. Tests: 708/708, Verdrahtung 13/13, MCP 33/33.
  Offen: siehe `COMPACTIONS.md`.
- **Sicherheitsbefunde aus dem Codex-Security-Scan (10.11.2026):**
  Copy/Move/Replace prüfen Quelle, Ziel und Backup; Schreibanweisungen werden
  sequenziell mit dem jeweils gültigen Arbeitsordner und den gültigen Bindungen
  geprüft; unklare Bindungen sowie nicht auflösbarer Kontrollfluss und
  Location-Stack sind `deny`; abgekürzte Löschflags (`-r`, `-fo`) und
  punktierte Verzeichnisziele lösen die Löschrückfrage aus; Diagnose-Logs
  enthalten keine rohen Befehlstexte und liegen in einem privaten Verzeichnis
  (`diagnostics.js`). 686/686 Tests, 13/13 Verdrahtung, 33/33 MCP-Fälle.

### Dokumentiert

- **README als Einstieg, Fachliches nach `METHODOLOGY.md` (21.11.2026):** Die
  README war auf rund 1470 Zeilen gewachsen und hatte die Rolle eines
  Entscheidungsprotokolls übernommen. Neu: `METHODOLOGY.md` und
  `METHODOLOGY_de.md` tragen das Fachliche (Regelwerk im Detail, Listen der
  erlaubten Befehle, Befehlszerlegung, Git-Muster, Ebene 1, MCP-Urteil,
  Messverfahren, Änderbarkeit, Codex-Gegenüberstellung). `README.md` und
  `README_de.md` sind Einstieg für Erstnutzer (rund 290 Zeilen): Problem,
  Lösung, Installation, Einrichten, Verbotsliste, Grenzen, Testbefehle,
  Weiterlesen. Die datierten Stände vom 13.11. und 20.11. stehen jetzt in
  `PLANUNG.md`. Inhalte wurden verschoben, nicht neu geschrieben; geprüft mit
  einem Zeilenvergleich gegen die alte Fassung. Die Installationszeile
  `npm ci` stand zwischen diesen Ständen und wäre fast mitgegangen — sie steht
  jetzt in der README unter Installation. Alle Tabellen der vier Dateien sind
  ausgerichtet (`staging/check-tables.mjs`). Kein Code geändert.
- **Messschwellen über Umgebungsvariablen (21.11.2026):** `README.md` und
  `README_de.md` nennen jetzt die vollständige Liste der Umgebungsvariablen —
  ergänzt um `_BACKEND`, `_SHELL_BACKEND`, `_THRESHOLD` und `_SHELL_THRESHOLD`
  samt zulässigem Band (0,5 bis unter 1,0, sonst wird der Wert verworfen). Neu
  ist außerdem der Ablageort der Konfigurationsdatei: gelesen wird sie neben
  `reviewer.js`, im Repository also unter `src/`. Eine Datei im Repo-Root bleibt
  seit dem Umzug nach `src/` wirkungslos, und es gelten still die Vorgaben
  0,70/0,65. Belegt mit `staging/probe-config.mjs`: ohne Variablen
  `shellThreshold` 0,65, mit Variablen 0,50. Die Gegenprobe
  `staging/gegenprobe.ps1` setzt ihre Schwellen deshalb über
  `PERMISSION_GUARD_REVIEWER_THRESHOLD` und
  `PERMISSION_GUARD_REVIEWER_SHELL_THRESHOLD` statt über eine Datei. Beide
  READMEs beschreiben außerdem das Messverfahren (Vormessung und Gegenprobe) und
  tragen die Nachmessung vom 21.11.2026. Kein Code geändert.
- **Abschluss der Guard- und CPU-Arbeiten (17.11.2026):** `README.md` und
  `README_de.md` beschreiben nun auch die rekursive Blockprüfung,
  `scopeEdit()` samt physischer Link-Auflösung und das Nachwärmen nach einem
  Timeout; beide nennen 873 Unit- und 17 Integrationsfälle. `PLANUNG.md` hält
  die Review- und Messkette, den GPU-Standard und den Abschlussstand fest.
  `COMPACTIONS.md` dokumentiert Entscheidungen und nächsten Schritt. Der Stand
  wurde über `deploy.ps1` übertragen und per SHA256 verglichen; kein neuer ADR,
  weil die Betriebsentscheidungen reversibel sind.
- **Zwei Implementierungen (15.11.2026):** `README.md` hat den Abschnitt „Zwei
  Implementierungen: OpenCode und Codex“ zwischen „Was nicht erlaubt wird“ und
  „Git-Muster“. Er stellt beide Programme gegenüber (Einstieg, Prüfcode,
  Urteile, Grundlage, Modell, Laufzeit, Fehlerfall, Tests), nennt die gemeinsam
  gesperrten Muster und den Wartungshinweis, dass es keinen gemeinsamen Katalog
  gibt. Zahlen: 726/726 Fälle hier, 77 Fälle im Codex-Guard. Keine Codeänderung.
- **Befehlszerlegung und Befehlsstil (12.11.2026):** `README.md` hat einen neuen
  Abschnitt „Befehlszerlegung und Befehlsstil“ vor „Ebene 1“. Er beschreibt die
  Segmentierung, die Modellprüfung je Segment und die Einordnung der
  Umleitungen. Keine Codeänderung.
- **Abnahme-Nacharbeiten zur Welle 1 (18.11.2026, acht Blocker):** Bindungen verfallen bei Zuweisung im Kontrollfluss (`if/else/try/...`, sonst bliebe `$p=$x` im Block unsichtbar); `-Headers $h`/`-Headers:$h` bleiben `ask`; die Chat-Darstellung (formatiertes JSON) wird vor dem Limit geschnitten geprueft — je Pfad Systemone und Chat nachgewiesen; erkannte sende-/schreibende Parameter (`-OutFile:`, `gh -f..`, `--basetemp=..`) bleiben `ask` ohne Modellweg (Verdrahtungstest mit permissiver Attrappe); Codex-Hook erkennt `-Recurse:$true` und `rm -rfd`; ein Klammerausdruck im `File::Open`-Argument bleibt `ask`, die Dreiargument-Leseform wieder `allow`; Headerwert `Accept='text/plain;q=0.9'` korrekt geparst; personenbezogener Pfad in `docs/Claude Auto Modus …:571` maskiert (`C:/outside/permission-guard`); beide READMEs nennen 32000 Zeichen statt 16 KB. Gate: `test.mjs` 921/921, `pytest` 149 bestanden und 1 uebersprungen, `test-index` 19/19, `bench-model` 14/14 einstimmig.
- **2. Abnahme (18.11.2026):** Schleifenvariable einer `foreach`-Zuweisung verfaellt jetzt mit (`$p`-Bindung im Loop, auch `${p}`-Formen); Header-Hashtabellen werden vollstaendig geprueft (`@{Accept='ok';Authorization='demo'}`) und Parameterabkuerzungen (`-He`, `-Head`) erkannt; `File::Open`-Argumente nur exakt als Enum oder Zeichenkettenform anerkannt (kein Suffix-Vergleich); unsichere `File::Open`-Argumente bleiben `ask` ohne Modellweg (Verdrahtungstest mit permissiver Attrappe); `unpruefbar`-Gruende enthalten keine Befehlswerte mehr (Diagnose-Log-Regressionstest, Dummy: 0 Treffer); Codex-Hook erkennt Kurzbuendel beliebiger Laenge (`rm -rffvd`); `test.mjs` nutzt neutralen Pfad `C:/outside/run.py` (CI-Privacy-Scan); Fix-Log-Pfade maskiert. Gate: `test.mjs` 925/925, `test-index` 23/23, `pytest` 149 bestanden und 1 uebersprungen, `bench-model` 14/14 einstimmig.
- **3. Abnahme (18.11.2026):** Kontrollfluss-Bindungen vollstaendig ungültig (auch `${p}`, innere Schleifenvariablen, Skriptbloecke); `${p}=Schreibbefehl` wird RHS-klassifiziert (deny ausserhalb); Header-Hashtabelle wird dem echten Parameterwert zugeordnet (zitierte URL täuscht sie nicht vor) und numerische Variablen (`$1`) abgelehnt; `File::Open`-Argumente zitatsbewusst zerlegt (Komma im Dateinamen kein Trenner); Codex-Hook erkennt `-irf` und unbekannte rekursive Bündel (deny); Gründe und `commandSummary()` ohne Befehlswerte, Log-Test mit `guardLogDir()` und Positivnachweis. Weg-A-Prinzip: unsicher → `ask` → Reviewer nur bei statischem `ask` → sonst `ask`. Gate: `test.mjs` 932/932, `test-index` 23/23, `pytest` 149 bestanden und 1 uebersprungen, `bench-model` 14/14 einstimmig.
- **Review-Welle 1, P0-1 bis P0-11 (18.11.2026, Basis `ceb85cf`):** elf belegte
  Umgehungen geschlossen, je ein Negativtest (P0-8 vier Faelle, je ein Fall je
  Ordner plus deny-Prioritaet in beiden Reihenfolgen; P0-5 ergaenzte
  Antworttests). `test.mjs` 913/913, `pytest` 148 bestanden und 1
  uebersprungen, `bench-mcp` 33/33, `test-wiring` 13/13, `test-index` 17/17,
  Ruff, Ruff-Format und Pyright gruen; `bench-model` 14/14 und `bench-shell`
  23/23 einstimmig gegen den laufenden Reviewer gemessen. Details je Befund in
  `.full-review/fix-log.md`. Im Einzelnen: P0-8 `scopeEdit()` fragt `.githooks`
  und `.github` wie der Shell-Weg nach (`writeAskOnly`), deny gewinnt
  unabhaengig von der Zielreihenfolge; P0-5 nur exakt „Ja"/„Yes" (nach Trim,
  Satzzeichen `.`/`!` am Ende erlaubt, kein Praefix); P0-1 Netz-Parameter am
  Doppelpunkt wie am Gleichheitszeichen zerlegt; P0-2 `gh api -f/-F/-X`
  angehaengt als sendend; P0-9 `--basetemp` in allen Formen `ask`; P0-10
  vertrauliche und unbekannte Header `ask`; P0-3 `[System.IO.File]` nur
  nachweislich lesend (`Open` nur mit `FileMode::Open` + `FileAccess::Read`);
  P0-4 Bindungen sequenziell, unaufloesbare Variable `ask` ohne Modellweg;
  P0-6/P0-7 Codex-Hook: angehaengte Git-Optionen, gebuendelte Schalter
  (`-rfv`), Abkuerzung (`-Rec`), Array-Ziele, alles `deny`; P0-11 jede
  Kuerzung/Tiefenbegrenzung ohne Modell `ask` und Grenze 32000 Zeichen
  (Guard-Oversized 16 KB → 32 KB, Server `-c 32768`). Offen bleiben: P0-5
  Prompt-Schaerfung (Textvorschlag in `PLANUNG.md`), andere pytest-Optionen
  als `--basetemp` (nicht bewiesen, eigene Probe noetig), Shell-Pfad von
  P1-03 (nur Edit-Pfad geschlossen).

## [0.1.0] - 2026-11-05

### Hinzugefügt
- **Urteilsdatei für Skill-Skripte (05.11.2026):** `skill-verdicts.mjs`
  verdichtet die SkillSpector-Berichte und die Prüfprotokolle zu
  `~/.agents/skill-reviews/verdicts.json`. Der Guard liest die Datei nur und
  vertraut einem Skript ausschließlich bei `decision: "trust"` und passendem
  SHA256; jede Änderung fällt auf `ask` zurück. Die statische Liste
  `TRUSTED_SKILL_DIRS` bleibt die Untergrenze. Neun Tests (530/530).
  `--reports` ist wiederholbar (späteres Verzeichnis gewinnt je Skill), jeder
  Eintrag nennt seinen Berichtslauf. Stand: zehn Skills, 78 Skripte, eine
  Freigabe (`nemo-retriever` nach Protokoll vom 25.10.), keine Abweichung.
  Neue Berichte vom 05.11. für `.system`, `prompt-engineering-patterns` und
  `python-project-bootstrap`; `.system` hat keine eigene `SKILL.md`, der
  Sammellauf endet deshalb mit Exitcode 1 bei gültigem Bericht (95,6 %
  Abdeckung, 12 Befunde).
- **Betriebsarten der Urteilsdatei (05.11.2026):** `skill-verdicts.mjs` kennt
  jetzt `--refresh` (Hashes und Entscheidungen fortschreiben, ohne Berichte)
  und `--verify` (Abgleich, Exitcode 1 bei Abweichung). Der `pre-commit` im
  Skill-Repo ruft `--refresh` auf, sobald Skill-Dateien gestaged sind, und
  stagt die Datei mit; die CI ruft `--verify`. Beide kommen ohne Scanner,
  Netz und Schlüssel aus. Der Hook blockiert nicht versionierte Python-Dateien
  unter `skills/` und unvollständig gestagte Python-Änderungen, weil die Datei
  sonst einen Stand beschriebe, der nicht im Commit ist. `pre-push` prüft mit
  `--verify` nach, damit kein veralteter Stand hinausgeht, und `--refresh`
  meldet neue Skills als `neu aufgenommen (ohne Bericht): <name>`. Dreizehn
  Hook-Fälle und elf Werkzeugfälle in einem temporären Repo geprüft.
- **Ebene 3 als Entscheidungsmodell (05.11.2026):** `mcpBackend: "systemone"`
  befragt `/v1/systemone` statt Text zu erzeugen; `mcpThreshold` (0,7)
  entscheidet über die Wahrscheinlichkeit für „reads". Gemessen mit Clef-Flash
  (Q4_K_M, 6,3 GB): 14/14, Rückfrage ≤ 0,458 gegen Freigabe ≥ 0,884, 75 ms;
  Gate 33/33 und 3/3. Laya (421M) verworfen (8/14). Das Audit speichert die
  Wahrscheinlichkeit. 13 neue Tests (570/570).
- **Ebene 1 über das Entscheidungsmodell (05.11.2026):** `shellBackend:
  "systemone"` und `shellThreshold`; je Segment eine Anfrage, das schwächste
  Ergebnis zählt, der statische `neverAutoApprove`-Filter bleibt davor.
  Gemessen an 14 Shell-Befehlen: 14/14, Freigaben 0,94–0,97, Änderungen
  0,02–0,06. Drei Integrationstests (573/573).
- **Betrieb (05.11.2026):** `start-reviewer.ps1` schreibt eine PID-Datei
  (`-Stop` findet den Server zuverlässig), kennt `-DraftPath` für
  Speculative-Decoding-Drafter und prüft die Belegung über `/health` statt über
  `netstat`. `package.json` und `deploy.ps1` führen `audit.js`,
  `verify-audit.mjs`, `mcp-report.mjs`, `bench-model.mjs` und
  `mcp-model-cases.jsonl`; die Konfigurationsvorlage dokumentiert `mcpBackend`,
  `mcpThreshold`, `shellBackend` und `shellThreshold`.
- **Ebene-3-Prompt (05.11.2026):** Kompakte Fassung mit vier Beispielen; das
  Modell sieht jetzt nur noch Regel, Werkzeug, Absicht, Zielarten und Argumente.
  Messreihe `bench-model.mjs` mit 14 Graubereich-Fällen (`mcp-model-cases.jsonl`):
  vorher 8/14 (Trivialniveau), nachher 12/14, 14/14 einstimmig. Rollen- und
  Felderklärung verschlechterte auf 8/14, eine einzelne Kontextzeile auf 11/14.
  Feste Fälle unverändert 33/33 und 3/3. Wegen Streuung bei `temperature 0`
  misst die Reihe mit Seed 42 und ohne Prompt-Cache (`deterministic`).
- **F: Auswertung (05.11.2026):** `mcp-report.mjs` liest die Audit-Kette und
  zählt nach Werkzeug, Absicht, Entscheidung, Schicht und Modus, zeigt die
  Matrix Effekt→Urteil, Auffälligkeiten, offene Aufrufe und Ebene-3-Gründe;
  `--since`, `--days`, `--json`. Am Ende steht der Stand der Kriterien.
  13 Tests (556/556). Erster Lauf: 1 Aufruf, 1 Tag, 1 Werkzeug.
- **Audit-Kette (05.11.2026):** `audit.js` schreibt je MCP-Aufruf einen
  Entscheidungs- und einen Ergebnisdatensatz, verknüpft über Sitzung, Werkzeug
  und Argument-Hash (D0: `source.id` gilt je `execute`-Block). Nur Feldnamen,
  Zielarten, Flags und Hashes; Rotation bei 5 MB über die Generationen hinweg.
  `verify-audit.mjs` prüft die Kette und endet beim ersten Bruch mit Exit 1.
  13 Tests (543/543), deployt; Lebendtest ergab zwei Datensätze mit gleicher
  Kennung und intakter Kette.
- **D0 belegt (05.11.2026):** Der MCP-Pfad feuert im Code Mode. `permission.evaluate`
  kommt mit `action=<server>_<tool>` und `metadata.input`; `source.id` ist
  vorhanden und gleich der `id` aus `execute.after`, gilt aber je
  `execute`-Block, nicht je Aufruf (zwei Aufrufe, dieselbe ID). `execute.after`
  feuert für jedes MCP-Werkzeug und zusätzlich für `execute` selbst. Folge:
  Korrelation über `sessionID` + Werkzeug + Argument-Hash + Zeitfenster (Fall B
  im Plan), nicht über die ID allein. Sonde mit Feldnamen und ID-Hashes, keine
  Werte; nach dem Versuch entfernt.
- **Eine Freigabequelle (05.11.2026):** `TRUSTED_SKILL_DIRS` ist entfallen.
  Skills gelten nur noch über `verdicts.json` als lesbar; ohne passenden
  Hash bleibt jedes Skript Rückfrage. Grund: die Namensliste hätte eine
  Freigabe auch dann gehalten, wenn das Prüfprotokoll zu `ask` kommt.
- **Drei Prüfprotokolle (05.11.2026):** `markdown-table-formatting` (TRUST,
  Scanner-71 stammt nur aus einem inzwischen entfernten `__pycache__`),
  `monthly-price-benchmark-workbook` (TRUST, Skript liest nur und schreibt den
  Bericht) und `gemma-dev` (ASK: Modell-Download, lokaler Webserver, Vertex AI
  mit Cloud-Anmeldedaten). Stand: 3 `trust`, 7 `ask`.
- `PLANUNG.md`: Weg zum eigenständigen Repository (S0–S6) und die noch
  offenen MCP-Schritte D–G.

### Geändert

- **Globale MCP-Beobachtung (05.11.2026):** Der globale Plugin-Kontext
  (Basis = Benutzerprofil) registriert jetzt nur den MCP-Zweig. Shell-Regeln
  bleiben auf den Projektkontext beschränkt; `contextScope()` kapselt die
  Grenze, drei Tests decken Home, Projekt und ähnliche Namen ab. 521/521
  bestanden, deployt. `MCP_GATING_MODE` bleibt `"shadow"`.
- **S0 Sanitizing (05.11.2026):** Fixtures in `mcp-cases.jsonl` auf `team` und
  `lumen` umgestellt. Die Erwartungen (`want`, `layer`, `why`) blieben
  unverändert; `bench-mcp.mjs` meldet weiter 33/33.
- Alle Commits mit neutraler Identität neu geschrieben. Die vor dem 05.11.2026
  zitierten Hashes sind ungültig; die Sicherung liegt außerhalb des
  Repositories.
- Zwei lokale Notizen unter `docs/` per `.gitignore` ausgeschlossen. Sie
  bleiben auf der Platte und gehören nicht ins Repository.
