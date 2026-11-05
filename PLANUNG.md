# PLANUNG — permission-guard

Stand: 05.11.2026

## Wozu dieses Dokument

`permission-guard` ist aus einem Werkstatt-Ordner entstanden und soll ein
eigenständiges Repository werden. Dieses Dokument hält fest, was dafür fehlt
(Plan 1, Schritte S0–S6) und wie die MCP-Prüfungen fertig werden (Plan 2,
Schritte D–G).

Es ersetzt keine Dokumentation: `README.md` beschreibt das Verhalten,
`docs/entscheidungsgrundlage-mcp-gating-2026-10-29.md` die Recherche und die
Architekturentscheidungen. Hier steht nur der Weg dorthin.

## Ist-Zustand (05.11.2026)

Belegt durch `git log`, `git status`, `git grep`, `npm view`, `gh api` und
`node test.mjs`/`node bench-mcp.mjs`.

| Bereich     | Zustand                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Git         | Branch `master`, 13 Commits, **kein Remote**, keine Tags                                                                                                                       |
| Arbeitsbaum | sauber bis auf zwei untracked Notizen unter `docs/`                                                                                                                            |
| Metadaten   | alle 13 Commits tragen denselben Benutzernamen und eine Noreply-Adresse als Autor **und** Committer                                                                            |
| Fixtures    | `mcp-cases.jsonl` nennt in 8 Zeilen den eigenen Benutzernamen und ein echtes Repository                                                                                        |
| Tests       | 518/518 (`node test.mjs`), 33/33 Routing (`node bench-mcp.mjs`)                                                                                                                |
| MCP         | Schritte A–C deployt, aber `MCP_GATING_MODE = "shadow"`; im aktuellen `guard.log` steht keine `mcp`-Zeile                                                                      |
| npm         | `opencode-permission-guard` ist mit 1.0.0 an ein fremdes Paket vergeben                                                                                                        |
| GitHub      | `<user>/permission-guard` ist frei (404 am 05.11.2026)                                                                                                                         |
| CI          | der Parent-Workflow `permission-guard.yml` überspringt alles, weil `tools/permission-guard/` im Parent gitignored ist — auf einem frischen Checkout existiert der Ordner nicht |

Der Parent führt `tools/permission-guard/` in `.gitignore:76`. Für den Parent
ist der Ordner damit unsichtbar; für dieses Repository ist der Parent nur ein
Ablageort.

## Offene Punkte, priorisiert

| Prio | Punkt                                                                    | Aufwand | Abhängigkeit           |
| ---- | ------------------------------------------------------------------------ | ------- | ---------------------- |
| P0   | S0: Fixtures und Commit-Metadaten von Benutzernamen und Adresse befreien | S       | vor jedem Push         |
| P0   | S1: Remote, Sichtbarkeit und npm-Namensentscheidung                      | S       | Nutzerentscheidung     |
| P1   | D0: echten MCP-Aufruf beobachten, Code-Mode-Pfad und `source.id` prüfen  | S       | blockiert D und F      |
| P1   | Ebene-3-Prompt verbessern und gegen `bench-mcp --model` messen           | M       | vor Aktivierung        |
| P1   | S2: eigenständige CI im Sub-Repo                                         | M       | Remote                 |
| P1   | S3: Hooks, `.gitattributes`, `.gitleaksignore`                           | S       | —                      |
| P1   | S4: README, CHANGELOG, SECURITY, CONTRIBUTING, AGENTS                    | M       | —                      |
| P2   | D: Audit-Protokoll mit Hash-Kette                                        | M       | D0                     |
| P2   | F: Auswertung und Monitor-Kriterien                                      | M       | D                      |
| P2   | Aktivierung `MCP_GATING_MODE = "active"`                                 | S       | F + Nutzerentscheidung |
| P2   | S5/S6: Release, Parent aufräumen, optionaler Umzug                       | S–M     | S0–S4                  |
| P3   | G0/G1: Ergebnis-Form prüfen, Grenz-Markierung                            | M       | D                      |
| P3   | G2/G3: statische Injection-Prüfung, optional lokales Modell              | M–L     | G1                     |
| P3   | Warmup-`TypeError` diagnostizieren                                       | S       | —                      |
| P3   | `package.json` vervollständigen (`exports`, `repository`, `files`)       | S       | S1                     |

## Plan 1: Eigenständiges Repository

### S0 — Sanitizing (P0, vor jedem Push)

Ziel: Weder Dateien noch Commit-Metadaten verraten, wem das Repository gehört.
Der Inhalt bleibt unverändert; geändert werden nur Fixtures und Identitäten.

1. `mcp-cases.jsonl`: `owner`, `repo` und `org` durch neutrale Fixtures
   ersetzen (`team`, `lumen`), passend zu den bereits vorhandenen
   warc0s-Fällen. Die Erwartungen (`want`, `layer`, `why`) bleiben Zeichen für
   Zeichen gleich — sie hängen nicht an den Werten.
2. Alle getrackten Dateien nach Benutzername, E-Mail-Adressen, `C:\Users\…`
   und `/Users/…` durchsuchen. Treffer einzeln bewerten; Platzhalter wie
   `C:\Users\<name>` und `C:\Users\u` bleiben.
3. Die zwei untracked Notizen unter `docs/` **nicht veröffentlichen**. Sie
   bleiben lokal und werden per `.gitignore` ausgeschlossen, damit ein
   `git add -A` sie nicht versehentlich erfasst.
4. Commit-Identität bereinigen:
   - Sicherung: `git bundle create <Ablage>/permission-guard-pre-sanitize-2026-11-05.bundle --all`,
     danach `git bundle verify`.
   - Alle Commits mit neutraler Identität neu schreiben
     (`git filter-branch --env-filter`): `permission-guard <noreply@example.invalid>`.
   - `refs/original` löschen, Reflog leeren, `git gc --prune=now` — sonst
     bleiben die alten Commits erreichbar.
   - Repo-lokale Identität ebenfalls neutral setzen, damit neue Commits nicht
     wieder den Benutzernamen tragen. Rückgängig mit
     `git config --unset user.name; git config --unset user.email`.
5. Alle SHAs ändern sich. Die in `PLANUNG.md`, `CHANGELOG.md` und
   `COMPACTIONS.md` des Parents zitierten Hashes werden ungültig; das wird dort
   vermerkt. Eine Zuordnung alt → neu steht am Ende dieser Datei.

**Abnahme:**

- `git grep` findet weder Benutzername noch echte Adresse;
- `git log --format='%an <%ae> | %cn <%ce>' | sort -u` liefert genau eine
  neutrale Zeile;
- `node test.mjs` 518/518 und `node bench-mcp.mjs` 33/33;
- das Bundle ist geprüft und liegt außerhalb des Repositories.

### S1 — Repo-Identität und Metadaten (P1)

- GitHub-Repository `<user>/permission-guard` anlegen, **privat**. Kein Push
  durch den Agenten; der Push bleibt beim Nutzer.
- `package.json`:
  - Name: `opencode-permission-guard` ist belegt. Empfehlung: **GitHub-only**
    für v0.1.0, kein npm-Publish; alternativ ein Scope wie
    `@<scope>/opencode-permission-guard`.
  - `version: 0.1.0`, `description`, `repository`, `bugs`, `homepage`,
    `license`, `engines`.
  - `exports: { ".": "./index.js" }` — nötig, falls das Paket später als
    npm-Paket geladen wird.
  - `files` vollständig: `guard.js`, `index.js`, `reviewer.js`, `audit.js`,
    `test.mjs`, `bench-mcp.mjs`, `mcp-cases.jsonl`, `stats.mjs`,
    `start-reviewer.ps1`, `smoke-reviewer.mjs`, `bench-reviewer.ps1`,
    `bench-quality.ps1`, `watchdog-reviewer.ps1`, `deploy.ps1`, `deploy.sh`,
    `shell-reviewer.config.example.json`, `README.md`, `LICENSE`, `docs/`.
  - Scripts: `test`, `bench`, `smoke`; später `verify-audit`.
- `npm pack --dry-run` prüfen: nur gewollte Dateien, keine lokale
  Konfiguration, keine Logs.

### S2 — CI im Sub-Repo (P1)

- Den Parent-Workflow `.github/workflows/permission-guard.yml` in das Sub-Repo
  übernehmen. Die „Quellen vorhanden?“-Prüfung entfällt dort.
- Matrix: Node 20 und 22 × Ubuntu und Windows.
- Schritte: Checkout, Node einrichten, `node test.mjs`, `node bench-mcp.mjs`,
  Secret-/Pfad-Scan, `npm pack --dry-run`.
- Optional `actionlint` für die Workflow-Dateien selbst.
- Erst nach einem grünen Lauf im Sub-Repo den Parent-Workflow entfernen (mit
  Zustimmung), sonst bleibt eine irreführende Attrappe stehen.

### S3 — Hooks und Git-Hygiene (P1)

- `.githooks/` aus `~/.agents/references/githooks/` übernehmen (byte-identisch).
- `test-gate.conf` anpassen: Präfixe `guard.js index.js reviewer.js audit.js
  test.mjs bench-mcp.mjs package.json README.md PLANUNG.md mcp-cases.jsonl
  .github .githooks`; `test=node test.mjs`.
- `.gitattributes`: `.githooks/* text eol=lf`, JS/JSON/MD konsistent.
- `.gitleaksignore` für Fixture-Fingerprints oder `gitleaks:allow`-Kommentare.
- `git config core.hooksPath .githooks` dokumentieren (pro Klon nötig).

### S4 — Dokumentation (P1)

- `README.md`: Zweck, Installation, Deploy, Tests, Sicherheitsmodell
  („kein Sandboxing“), MCP-Stand, Grenzen. Testzahl auf 518 korrigieren.
- `CHANGELOG.md` nach Keep a Changelog: `0.1.0` mit dem aktuellen Umfang,
  `Unreleased` für D–G.
- `SECURITY.md`: Bedrohungsmodell, keine Garantie, Meldung über GitHub Private
  Advisory — ohne E-Mail-Adresse.
- `CONTRIBUTING.md`: Node 20+, `node test.mjs`, keine Laufzeitabhängigkeiten,
  Commit- und Privacy-Regeln.
- `AGENTS.md` im Sub-Repo: Testbefehl, Deploy nur über die Skripte, keine
  Geheimnisse, Quelltext ist die Wahrheit.

### S5 — Release (P2)

- Tag `v0.1.0`, sobald S0–S4 erledigt sind.
- GitHub Release mit Kurzfassung und bekannten Grenzen.
- npm nur, wenn Name oder Scope entschieden und `npm pack --dry-run` sauber
  ist.
- Push bleibt beim Nutzer.

### S6 — Parent aufräumen, optionaler Umzug (P2)

- Parent-Workflow entfernen, sobald die Sub-Repo-CI grün ist.
- Parent-`AGENTS.md`, `PLANUNG.md`, `CHANGELOG.md`, `COMPACTIONS.md` auf den
  neuen Ort und Status verweisen.
- **Umzug:** erst nach v0.1.0. Ein Umzug nach
  `$HOME/Python-Projekte/permission-guard` ist sauberer, ändert aber Pfade in
  README, Parent-Doku und Hooks. Bis dahin bleibt der Ordner, wo er ist.

## Plan 2: MCP-Prüfungen, Schritte D bis G

Die Schritte A–C stehen und sind im Schattenmodus deployt. Schritt E ist grün.
Was fehlt, ist der Nachweis im echten Betrieb (D0), das Protokoll (D), die
Auswertung (F), die Aktivierung und die Ergebnis-Ebene (G).

### D0 — Live-Beleg und Korrelation (P0, Go/No-Go)

Ziel: beweisen, dass der Guard echte MCP-Aufrufe sieht und dass
`permission.evaluate` mit `execute.after` korrelierbar ist.

- Temporäre Diagnoseversion (nicht deployt), die **nur Feldnamen und Längen**
  protokolliert, keine Werte.
- Einen harmlosen MCP-Aufruf in einer Projekt-Sitzung auslösen, zum Beispiel
  `deepwiki_read_wiki_structure`.
- Drei Fragen:
  1. Feuert `permission.evaluate` mit `action = <server>_<tool>` und
     `metadata.input`?
  2. Ist `source.id` vorhanden und identisch mit `execute.after.id`?
  3. Feuert `execute.after` auch für Aufrufe aus Code Mode?

Drei mögliche Ergebnisse:

| Ergebnis | Befund                                    | Folge                                                                                                       |
| -------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A        | beides feuert, IDs gleich                 | D wie geplant                                                                                               |
| B        | beides feuert, IDs fehlen oder weichen ab | Korrelation über `sessionID` + Werkzeug + Argument-Hash + kurzes Zeitfenster; dokumentieren                 |
| C        | kein `permission.evaluate` für MCP        | das Gating über den Permission-Hook trägt nicht; Architektur neu entscheiden, bevor D/F weitergebaut werden |

**Abnahme:** eine Evidenzzeile mit Ja/Nein pro Frage, keine Argumentwerte.

### D — Protokoll mit Hash-Kette

- Neues `audit.js` als reine Funktionen: `canonicalJson()`, `hashRecord()`,
  `appendRecord()`, `verifyChain()`.
- Schema `v: 1`, `seq`, `ts`, `kind: "decision" | "result"`, `mode`,
  `sessionHash`, `callID`, `agent`, `tool`, `intent`, `resourceKinds`,
  `contextFlags`, `decision`, `layer`, `reason`, `effect`, `status`.
- **Keine Argumentwerte, keine Resultatinhalte, keine URLs oder Pfade** — nur
  Feldnamen, Zielarten, Flags und Hashes.
- Zwei Datensätze pro Aufruf: `decision` beim `permission.evaluate` (auch im
  Schattenmodus), `result` beim `execute.after` (`completed`/`error`),
  verknüpft über `callID` oder den in D0 bestimmten Ersatzschlüssel.
- Hash-Kette: `hash = sha256(canonical(record ohne hash))`, `prev` ist der Hash
  des Vorgängers; über Rotationen hinweg fortgeführt.
- Ablage: `%LOCALAPPDATA%\opencode\permission-guard\audit.jsonl` bzw.
  `${XDG_STATE_HOME:-~/.local/state}/opencode/permission-guard/audit.jsonl`;
  per `PERMISSION_GUARD_AUDIT` überschreibbar.
- Rotation bei etwa 5 MB; jede Generation beginnt mit `prev` = letzter Hash der
  Vorgängergeneration.
- `verify-audit.mjs`: prüft die Kette, meldet den ersten Bruch, zählt die
  Datensätze; Exit 1 bei Bruch.
- Schreibfehler dürfen den Guard **nie** stören: `try/catch`, Diagnosezeile.
- Tests: Kette intakt, mittlere Zeile geändert, Zeile gelöscht, Reihenfolge
  getauscht, doppelte `seq`, Rotation, leere Datei, defekte Zeile, keine Werte
  im Datensatz.
- Grenze dokumentieren: Eine Hash-Kette erkennt Veränderung und Umordnung,
  aber kein Abschneiden am Ende ohne externen Anker; sie ist keine Signatur.

### F — Monitor-Phase

- Neues `mcp-report.mjs` oder Erweiterung von `stats.mjs`:
  - Zählungen nach Werkzeug, Absicht, Entscheidung, Schicht und Modus;
  - Matrix „statischer Effekt gegen Schattenurteil“ (allow/ask/deny);
  - Werkzeuge mit `unknown`, Geheimnisverdacht, unanalysierbaren Argumenten
    oder unaufgelösten Zielen;
  - Modellentscheidungen mit Begründung;
  - `--since`, `--days`, `--json`.
- Vorgeschlagene Aktivierungskriterien (vom Nutzer zu bestätigen):
  - mindestens 50 echte MCP-Aufrufe über 7 Tage und 3 Werkzeuge;
  - jede Schatten-`deny`-Entscheidung gegen einen real genutzten Aufruf
    einzeln geprüft;
  - keine `allow`-Freigabe bei Geheimnisverdacht, unanalysierbaren Argumenten
    oder unaufgelösten Zielen (per Design);
  - eine Modellstichprobe vom Nutzer bewertet;
  - ausdrückliche Freigabe zum Umschalten.
- Parallel die Prompt-Qualität verbessern: klares Ziel, Relevanz der Argumente,
  „Nein“-Kriterien, Beispiele. Messen mit `bench-mcp --model`: 3/3 halten,
  keine neuen Fehlfreigaben.

### Aktivierung

- Voraussetzungen: E grün, D verifiziert, F-Kriterien erfüllt, Prompt geprüft,
  Nutzerentscheidung.
- Änderung: `MCP_GATING_MODE = "active"` in `guard.js`; Tests, Deploy, Gate,
  Commit.
- Wirkung: nur statische `ask`-Fälle werden beeinflusst; `allow`, `deny` und
  gespeicherte Freigaben bleiben unangetastet.
- 24 Stunden beobachten; Rollback ist eine Zeile plus Deploy.

### G — Ergebnis-Ebene

- **G0:** Spike mit einem harmlosen MCP-Ergebnis: Form von `result.content`
  prüfen, verändern, zurückgeben; sicherstellen, dass die Änderung erhalten
  bleibt.
- **G1:** Grenz-Markierung: Textinhalte in `[UD-<id>]…[/UD-<id>]` wrappen, per
  `ctx.session.hook("context")` eine Systemanweisung ergänzen, vorhandene
  `[UD-`-Marker im Inhalt neutralisieren (Spoofing-Schutz). Nur Text, keine
  Dateien. Schalter `MCP_RESULT_SHIELD_MODE = "off" | "annotate" | "scan"`.
- **G2:** statische Injection-Muster („ignore previous instructions“,
  Rollenmarker, Tool-Aufruf-Spoofing) satzweise prüfen; Treffer **markieren,
  nicht blockieren**; Größenlimit; Fehlalarm-Fixtures.
- **G3:** optional lokales Modell nur im Graubereich; lokal, mit Timeout, **nur
  annotieren**, nie blockieren; nur wenn G2 messbaren Nutzen zeigt.
- **G4:** Tests, Doku, Shadow-Rollout, Nutzerentscheidung vor jeder aktiven
  Wirkung.
- Ehrliche Grenze: G verhindert keine Ausführung. Die harte Grenze bleibt die
  Berechtigungsprüfung.

## Reihenfolge

1. **S0 Sanitizing** — erledigt am 05.11.2026.
2. **D0 Live-Beleg** — ohne ihn sind D und F nicht belastbar.
3. **Prompt-Qualität** und **D** implementieren.
4. **S1–S4** parallel; CI muss vor dem ersten Push grün sein.
5. **F** messen, Kriterien prüfen, **aktivieren**.
6. **G0/G1**, danach optional G2/G3.
7. **Release v0.1.0**, Push durch den Nutzer, danach Parent aufräumen.

## Entscheidungen

Festgelegt:

| Nr. | Frage          | Entscheidung                                                     |
| --- | -------------- | ---------------------------------------------------------------- |
| 1   | Ort            | bleibt vorerst `tools/permission-guard/`; Umzug erst nach v0.1.0 |
| 2   | Sichtbarkeit   | privat, Name `<user>/permission-guard`                           |
| 3   | Historie       | neu schreiben mit neutraler Identität, Bundle als Sicherung      |
| 4   | untracked Docs | nicht veröffentlichen, lokal behalten                            |
| 5   | G              | zunächst nur annotieren                                          |

Offen:

| Nr. | Frage                 | Empfehlung                                               |
| --- | --------------------- | -------------------------------------------------------- |
| 6   | npm                   | GitHub-only für v0.1.0, weil der Name belegt ist         |
| 7   | Aktivierungskriterien | 50 Aufrufe / 7 Tage / 3 Werkzeuge bestätigen oder ändern |
| 8   | Push                  | bleibt beim Nutzer; der Agent pusht nicht                |

## Grenzen

- Der Guard ist ein Klassifizierer, keine Sandbox. Er prüft Aufrufe, bevor sie
  laufen, und kann irren.
- Der Schattenmodus ändert nichts. Erst die Aktivierung gibt dem MCP-Urteil
  Wirkung.
- Eine Hash-Kette ist kein Beweis gegen Löschen am Dateiende.
- Fremde Fälle (warc0s, hueyexe, defender) liefern Fälle, keine Erwartungen;
  Abweichungen stehen in `why`.

## Nachtrag 05.11.2026: Historie umgeschrieben

S0 hat alle Commits mit der neutralen Identität
`permission-guard <noreply@example.invalid>` neu geschrieben. Damit sind alle
vorher zitierten Hashes ungültig. Die Sicherung
`permission-guard-pre-sanitize-2026-11-05.bundle` liegt außerhalb des
Repositories und wurde mit `git bundle verify` geprüft.

| Alt       | Neu       | Betreff                                      |
| --------- | --------- | -------------------------------------------- |
| `687517a` | `d12cebf` | initialer Stand aus dem Monorepo             |
| `1090f9e` | `fabf2b7` | Lebenszyklus, Guard-Ausdrücke, Log-Statistik |
| `19bdc97` | `acf2e8d` | Fehlalarme des Reviewers entschärft          |
| `ce1a5ac` | `7271ade` | Watchdog-Diagnosezeilen                      |
| `35e01c8` | `5daa7d2` | Ausnahme für die Ruff-Benutzerbasis          |
| `3b2d2e3` | `854d8c0` | drei Lücken aus Rückmeldung F                |
| `ff8d4c2` | `d0f5269` | MCP-Schritt A                                |
| `e487348` | `2cb8c80` | Entscheidungen aus Teil 5                    |
| `2d691c5` | `31c35c5` | Shadow-Log deckt alle Effekte ab             |
| `ca33e05` | `ba05af5` | MCP-Schritt B                                |
| `11b9f58` | `a860d19` | MCP-Schritt C                                |
| `74751f2` | `c08329f` | MCP-Schritt E                                |
| `6fe01da` | `3cb5231` | README-Tabellen ausgerichtet                 |
| `5b4998e` | `42f0103` | S0, Planung, CHANGELOG                       |
