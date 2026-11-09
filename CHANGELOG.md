# Changelog

Alle wichtigen Änderungen an diesem Projekt. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

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
