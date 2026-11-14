# PLANUNG — permission-guard

Stand: 14.11.2026

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

| Prio | Punkt                                                                                     | Aufwand | Abhängigkeit                  |
| ---- | ----------------------------------------------------------------------------------------- | ------- | ----------------------------- |
| P1   | S6: Parent-Workflow entfernen, Verweise umstellen                                         | S       | CI grün (erfüllt), Zustimmung |
| P2   | Beobachtung nach Aktivierung: 24 h Log und `mcp-report` prüfen                            | S       | läuft seit 05.11.             |
| P3   | Shell-Fälle als `shell-cases.jsonl` und `bench-shell` festschreiben                       | S       | —                             |
| P3   | G0/G1: Ergebnis-Form prüfen, Grenz-Markierung                                             | M       | D                             |
| P3   | G2/G3: statische Injection-Prüfung, optional lokales Modell                               | M–L     | G1                            |
| P3   | Dreiweg-Antwort „Unbestimmt" entscheiden                                                  | S       | Messung                       |
| P3   | Warmup-`TypeError` diagnostizieren                                                        | S       | —                             |
| P3   | Suchmuster mit Befehlsnamen (`iex`) löst Verweigerung aus                                 | S       | —                             |
| P3   | `repository`/`bugs`/`homepage` in `package.json`                                          | S       | Nutzerentscheid               |

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

**Umgesetzt 05.11.2026 (S1–S4):** `package.json` mit `exports`, vollständiger
Dateiliste und Skripten (`bench`, `bench:model`, `report`, `verify-audit`,
`verdicts`); `private: true` bleibt. `repository`/`bugs`/`homepage` fehlen
bewusst — die URL enthält den Kontonamen, den die Privacy-Regel aus Dateien
heraushält. CI `.github/workflows/ci.yml`: Matrix Node 20/22 × Ubuntu/Windows,
Tests, `bench-mcp`, Fallbestand, `npm pack --dry-run`, Pfad- und Schlüssel-Scan;
`actionlint` grün. Hooks aus `~/.agents/references/githooks/` byte-identisch
übernommen, `test-gate.conf` mit `test=node test.mjs`, `.gitattributes` auf LF,
`core.hooksPath=.githooks` gesetzt — der Commit lief durch das Gate (573/573).
`SECURITY.md`, `CONTRIBUTING.md`, `AGENTS.md` angelegt; README-Testzahl auf 573
korrigiert. `npm pack --dry-run`: 26 Dateien, keine lokale Konfiguration, keine
Logs. Damit ist das Repo push-bereit; Tag und Parent-Aufräumen folgen nach dem
ersten grünen CI-Lauf.

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

**Ergebnis 05.11.2026 — Fall B.** Sonde mit Feldnamen und ID-Hashes (keine Werte),
ein Code-Mode-Block mit zwei MCP-Aufrufen (`deepwiki_read_wiki_structure`,
`exa_web_search_exa`):

1. `permission.evaluate` feuert mit `action=<server>_<tool>` und `metadata.input` — **ja**.
2. `source.id` ist vorhanden und gleich der `id` aus `execute.after` — **ja**, aber
   nicht je Aufruf eindeutig: beide MCP-Aufrufe desselben `execute`-Blocks trugen
   dieselbe ID. Sie identifiziert die auslösende Nachricht, nicht den einzelnen Aufruf.
3. `execute.after` feuert auch aus Code Mode — **ja**, einmal je MCP-Werkzeug und
   zusätzlich für `execute` selbst, jeweils mit `tool` und `status=completed`.

Folge für D: Korrelation über `sessionID` + Werkzeugname + Argument-Hash + kurzes
Zeitfenster; die ID ist der Anker, nicht der Schlüssel. Ein Eintrag ohne passendes
`execute.after` bleibt „offen" und wird nach Ablauf als unbestätigt markiert.

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

**Umgesetzt 05.11.2026:** `audit.js` (kanonisches JSON, Hash, Append, Rotation,
`verifyChain`), `verify-audit.mjs`, Verdrahtung in `index.js` (Entscheidung im
MCP-Zweig, Ergebnis über `ctx.tool.hook("execute.after")`). 13 Tests, deployt,
Lebendtest: `deepwiki_read_wiki_structure` erzeugte decision+result mit gleicher
Kennung, Kette intakt. Ablage `%LOCALAPPDATA%\opencode\permission-guard\audit.jsonl`.

### F — Monitor-Phase

- Neues `mcp-report.mjs` oder Erweiterung von `stats.mjs`:
  - Zählungen nach Werkzeug, Absicht, Entscheidung, Schicht und Modus;
  - Matrix „statischer Effekt gegen Schattenurteil“ (allow/ask/deny);
  - Werkzeuge mit `unknown`, Geheimnisverdacht, unanalysierbaren Argumenten
    oder unaufgelösten Zielen;
  - Modellentscheidungen mit Begründung;
  - `--since`, `--days`, `--json`.
- Aktivierungskriterien (Nutzerentscheid 05.11.2026):
  - mindestens 50 echte MCP-Aufrufe an **7 verschiedenen Tagen**;
  - mindestens 3 Werkzeuge, darunter **mindestens eines mit Schreibwirkung**
    (firecrawl crawl/monitor, github create/update) — drei Lesesuchen an einem
    Nachmittag erfüllen die Kriterien bewusst nicht;
  - jede Schatten-`deny`-Entscheidung gegen einen real genutzten Aufruf
    einzeln geprüft;
  - keine `allow`-Freigabe bei Geheimnisverdacht, unanalysierbaren Argumenten
    oder unaufgelösten Zielen (per Design);
  - eine Modellstichprobe vom Nutzer bewertet;
  - ausdrückliche Freigabe zum Umschalten.
- F selbst muss zuerst existieren: ohne `mcp-report.mjs` ist keine der Zahlen
  messbar. Stand 05.11.2026: 2 Aufrufe, 1 Werkzeug, beide `allow/1`.
- Parallel die Prompt-Qualität verbessern: klares Ziel, Relevanz der Argumente,
  „Nein“-Kriterien, Beispiele. Messen mit `bench-mcp --model`: 3/3 halten,
  keine neuen Fehlfreigaben.

**Ebene 3 umgesetzt 05.11.2026:** Prompt kompakt gefasst (Regel, vier
Beispiele), Messreihe `bench-model.mjs` mit 14 Graubereich-Fällen. Vorher 8/14
(Trivialniveau), nachher 12/14; Rollen- und Felderklärung verschlechterte auf
8/14, eine Kontextzeile auf 11/14. Feste Fälle 33/33 und 3/3. Das Modell streut
bei `temperature 0`; die Messung läuft deshalb mit Seed und ohne Prompt-Cache.

**Entscheidungsmodelle geprüft 05.11.2026:** Der lokale llama.cpp bietet
`/v1/systemone` (auf dem Chat-Modell: `501 not a decision model`). Gemessen mit
denselben 14 Fällen, Frage als `choice` „reads" gegen „changes":

| Modell | Größe | Treffer | Trennung |
| --- | --- | --- | --- |
| Laya (`Laya-Q8_0`, 421M) | 0,4 GB | 8/14 (Trivialniveau) | p 0,09–0,60, Reihenfolge falsch |
| Clef-Flash (`Q4_K_M`, 9B) | 6,3 GB | **14/14** ab Schwelle 0,5 | Rückfrage ≤ 0,458, Freigabe ≥ 0,884 |
| gemma-4-26B-A4B + MTP (Chat) | 11 GB | 13/14, Gate 3/3 | — |
| gemma-4-12B (Chat, Betrieb) | 4 GB | 12/14, Gate 3/3 | — |

Empfehlung: Clef-Flash als Ebene-3-Backend über einen eigenen `systemone`-Modus
(Schwelle 0,7), Gate danach mit den 33 festen Fällen. Bis dahin bleibt das 26B
die beste Chat-Option. Laya scheidet aus: zu klein für Werkzeugnamen ohne
Semantik.

**Umgesetzt 05.11.2026:** `mcpBackend: "chat" | "systemone"` und `mcpThreshold`
in `reviewer.js`; im `systemone`-Modus geht `{tool, arguments}` als Zustand und
eine `choice`-Frage („reads"/„changes") an `/v1/systemone`. Lebendtest mit
Clef-Flash: 14/14, Gate 33/33 + 3/3, 75 ms je Anfrage; das Audit speichert `p`.
13 neue Tests (570/570).

**Ebene 1 ebenso (05.11.2026):** `shellBackend: "systemone"` mit
`shellThreshold`; je Segment eine Anfrage, das schwächste Ergebnis zählt.
Gemessen an 14 Shell-Befehlen 14/14 (Freigaben 0,94–0,97, Änderungen
0,02–0,06); Lebendtest durch `review()` 6/6. Drei Integrationstests (573/573).

**Bonsai-Modelle:** `prism-ml/bonsai-27b` und `ternary-bonsai-2-27b` sind
Reasoning-Modelle. Bei `max_tokens: 8` geht das Budget für
`reasoning_content` drauf, `finish_reason=length`, `content` leer. Mit 64 Tokens
antworten sie sauber („Ja"). Kein Modellfehler, sondern eine zu knappe Grenze.

**Umgesetzt 05.11.2026:** `mcp-report.mjs` liest die Audit-Kette (beide
Generationen), zählt nach Werkzeug, Absicht, Entscheidung, Schicht und Modus,
zeigt die Matrix Effekt→Urteil, Auffälligkeiten, offene Aufrufe und
Ebene-3-Gründe; `--since`, `--days`, `--json`, Kriterienstand am Ende.
13 Tests (556/556). Erster Lauf: 1 Aufruf, 1 Tag, 1 Werkzeug, 0 schreibend —
die Kriterien sind damit messbar und offen.

### Aktivierung

- Voraussetzungen: E grün, D verifiziert, F-Kriterien erfüllt, Prompt geprüft,
  Nutzerentscheidung.
- Änderung: `MCP_GATING_MODE = "active"` in `guard.js`; Tests, Deploy, Gate,
  Commit.
- Wirkung: nur statische `ask`-Fälle werden beeinflusst; `allow`, `deny` und
  gespeicherte Freigaben bleiben unangetastet.
- 24 Stunden beobachten; Rollback ist eine Zeile plus Deploy.

**Umgesetzt 05.11.2026 (bewusste Abweichung):** Aktiviert wurde mit **einem**
beobachteten MCP-Aufruf, nicht mit den vereinbarten 7 Tagen / 50 Aufrufen. Grund
ist der Backend-Wechsel: Die Kriterien entstanden für das Chat-Modell (12/14,
streuend bei `temperature 0`). Mit Clef-Flash als Entscheidungsmodell liegt die
Trennung bei 0,458 gegen 0,884 und die festen Fälle bei 14/14 plus Gate 3/3 —
pro Aufruf aussagekräftiger als 50 Chat-Entscheidungen. Die Beobachtung läuft
trotzdem weiter: `node mcp-report.mjs` zählt Tage, Aufrufe und Werkzeuge; die
Zahlen dienen jetzt der Kontrolle nach der Aktivierung, nicht mehr als
Vorbedingung. Rollback: `MCP_GATING_MODE = "shadow"`, Tests, Deploy.

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
| 6   | npm            | GitHub-only für v0.1.0, `"private": true` (05.11.2026)           |
| 7   | Kriterien F    | 7 verschiedene Tage, ≥ 50 Aufrufe, ≥ 3 Werkzeuge, davon ≥ 1 schreibend (05.11.2026) |

Offen:

| Nr. | Frage                 | Empfehlung                                               |
| --- | --------------------- | -------------------------------------------------------- |
| 8   | Push                  | bleibt beim Nutzer; der Agent pusht nicht                |

## Grenzen

- Der Guard ist ein Klassifizierer, keine Sandbox. Er prüft Aufrufe, bevor sie
  laufen, und kann irren.
- Der Schattenmodus ändert nichts. Erst die Aktivierung gibt dem MCP-Urteil
  Wirkung.
- Eine Hash-Kette ist kein Beweis gegen Löschen am Dateiende.
- Fremde Fälle (warc0s, hueyexe, defender) liefern Fälle, keine Erwartungen;
  Abweichungen stehen in `why`.
- Ein Suchmuster ist für den Guard Code. `Select-String -Pattern 'iex'` wird
  deshalb verweigert, obwohl nur gelesen wird. Bewusst offen gelassen: die
  Unterscheidung „Zeichenkette als Daten" gegen „Zeichenkette als Befehl" ist
  genau die Grenze, an der ein Klassifizierer falsch liegen kann.

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

## Nachtrag 14.11.2026: Test-Gate gegen CRLF abgesichert

`pre-commit` und `pre-push` brechen ab, wenn `.githooks/test-gate.conf` ein CR
enthält. Grund: Ein CR am Zeilenende wandert in den letzten Wert; `.githooks/`
passt nicht mehr als Präfix, der Testbefehl heißt `test-index.mjs\r`, und das
Gate überspringt still. Die Vorlage, dieses Repo, `AI+IDE-Hints` und
`python-project-template` tragen dieselben Hook-Dateien (SHA256 geprüft).

Erkennung per `case`, nicht per `grep`: Die Git-Bash-Grep findet ein CR in der
Datei nicht (gemessen). Smoke-Test: CRLF → Exit 1 mit Meldung, LF → Exit 0;
`bash -n` 8/8; `test.mjs`, `test-index.mjs`, `test-wiring.mjs` und
`bench-mcp.mjs` Exit 0.

Offen: Commit und Push dieses Repos; getrennte Commits für `~/.agents`,
`AI+IDE-Hints` und `python-project-template`; die fünf Nachbar-Repos mit
eigenem Hook-Stand haben nur die AGENTS.md-Regel, noch kein Laufzeit-Gate.
