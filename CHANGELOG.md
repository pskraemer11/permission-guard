# Changelog

Alle wichtigen Änderungen an diesem Projekt. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

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

- **Befehlszerlegung und Befehlsstil (12.11.2026):** `README.md` hat einen neuen
  Abschnitt „Befehlszerlegung und Befehlsstil“ vor „Ebene 1“. Er beschreibt die
  Segmentierung, die Modellprüfung je Segment und die Einordnung der
  Umleitungen. Keine Codeänderung.

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
