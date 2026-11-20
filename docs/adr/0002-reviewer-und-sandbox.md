# ADR-Entwurf: Reviewer-Prinzip, Pflichtenheft und Sandbox

**Pfad:** `docs/adr/0002-reviewer-und-sandbox.md`
**Status:** vorgeschlagen, nicht freigegeben.
**Datum:** 18.11.2026

## Kontext

Der Guard ist **keine Sandbox**: Er bewertet Berechtigungen, führt Befehle aber nicht isoliert
aus (`SECURITY.md:5–8`, `index.js` Hook-Verdrahtung). Die 4 Abnahme-Runden (je 7–8 Blocker)
zeigen: PowerShell-Textsuche skaliert nicht — jeder Fix findet einen neuen Ast.
Ziele sind (a) weniger Rückfragen an den Nutzer und (b) mehr Schutz vor zerstörerischen
Aktionen im Betriebssystem (Windows und WSL2).

Vergleich (Researcher, Stand 18.11.2026; nur geprüft, was Doku/Quelltext belegen):
- Claude Code Sandbox: default aus, nur macOS/Linux/WSL2, kein natives Windows.
  Ablauf wie bei uns: statisch → Klassifizierer → ask/deny.
- Codex: Sandbox default-an, auch natives Windows (PowerShell-native + Linux in WSL2);
  Reviewer (Auto-review) ist **Opt-in**, nicht default-an. Ebenfalls statisch → Reviewer.
- Inspect-Evals: nutzt `codex sandbox -C … --permission-profile …` (MXC, kein Docker/Podman)
  auf Windows, mit Fail-closed-Probe — als Muster für jede Sandbox-Einbindung unter OpenCode.

## 0) Pflichtenheft — Leitlinie **und** Prüfstein (vor jeder Umsetzung)

Aus `docs/Claude & Codex mit Sandboxing versus OpenCode mit Berechtigungsprüfungen.md:325–355` übernommen:

**Funktional:**

| ID    | Anforderung                                                                           | Prio | Abnahmekriterium |
|-------|---------------------------------------------------------------------------------------|------|----------------------------------------------------------------|
| FA-01 | Befehle aus dem Shell-Tool laufen in der Sandbox, wenn sie aktiv ist                  | Muss | Ein Testbefehl läuft nachweislich eingeschränkt                |
| FA-02 | Schreibzugriff nur auf das Workspace und explizit freigegebene Pfade                  | Muss | Schreiben nach `C:\Windows` schlägt fehl                       |
| FA-03 | Lesezugriff auf Credentials blockiert (z. B. `.ssh`, Credential-Stores, `.env`)       | Muss | Lesen von `%USERPROFILE%\.ssh` schlägt fehl                    |
| FA-04 | Netzwerk standardmäßig gesperrt, Allowlist pro Domain und Port                        | Muss | Zugriff auf eine nicht gelistete Domain wird blockiert         |
| FA-05 | Git-Konfiguration und Hooks sind vor Agentenschreibzugriff geschützt                  | Muss | Schreiben nach `.git/hooks` wird verweigert oder protokolliert |
| FA-06 | Fail-closed: Ist die Sandbox nicht startbar, wird der Befehl verweigert               | Muss | Kein stiller Fallback ohne Sandbox                             |
| FA-07 | Ausbruch (unsandboxed) nur nach expliziter Freigabe                                   | Muss | Standard ist deaktiviert                                       |
| FA-08 | Auto-Allow innerhalb der Sandbox, Rückfragen nur bei Grenzüberschreitung              | Soll | Anzahl der Dialoge bei Routinearbeit sinkt deutlich            |
| FA-09 | Audit-Log für Befehle, Entscheidungen und Verstöße                                    | Soll | Log ist nachvollziehbar und ohne Secrets                       |
| FA-10 | Konfiguration auf Projekt-, Benutzer- und Managed-Ebene mit Vorrang für Managed       | Soll | Managed-Regel lässt sich nicht überschreiben                   |
| FA-11 | Sandbox-Status in der Oberfläche sichtbar                                             | Soll | Status wird angezeigt                                          |
| FA-12 | Konfigurationsdateien von OpenCode und Hooks sind vor Agentenschreibzugriff geschützt | Muss | Agent kann die eigene Policy nicht ändern                      |
| FA-13 | Setup ohne Administratorrechte bevorzugt                                              | Soll | mxc-Pfad ohne UAC                                              |

**Vorbild-Verweise (Übernahme-Tabelle §1.5):**
| FA          | Vorbild                                                              |
|-------------|----------------------------------------------------------------------|
| FA-01–FA-07 | must-ask-Abnahme aus Jevvy-Korpus (Vorbedingung der Sandbox-Abnahme) |
| FA-06       | `opencode-guard`: „no sandbox can be built → refused"                |
| FA-07       | `opencode-guard`: Escape nur mit Begründung und immer `ask`          |
| FA-08       | Jevvy: Achsen sensibel/unbekannter Code/verschleiert getrennt        |
| FA-09       | Jevvy: Audit-Limits (10.000 Zeilen/16 MiB/32 MiB)                    |
| FA-10       | `open-guardian`: Policy-Schichtung policy→rules→project              |
| FA-12       | `codex-guardian`: Self-Protection                                    |

| NFA              | Vorbild                                                    |
|------------------|------------------------------------------------------------|
| NFA-01           | Deny-Limits 3/20 → Pause (Claude, Codex)                   |
| FA-06 (Analogon) | `helloydh007/opencode-permission-guard`: Headless ask→deny |

**Nicht-funktional:**

| ID     | Anforderung                                             | Abnahmekriterium                                          |
|--------|---------------------------------------------------------|-----------------------------------------------------------|
| NFA-01 | Zusätzliche Latenz pro Befehl                           | Zielwert unter 100 ms, gemessen                           |
| NFA-02 | Kompatibilität mit Git, npm, pip, dotnet und Docker-CLI | Testsuite besteht, Docker-Socket nur explizit freigegeben |
| NFA-03 | Unabhängiges Sicherheitsreview vor Release              | Befund dokumentiert, kritische Punkte behoben             |
| NFA-04 | Lizenz- und Notice-Konformität des übernommenen Codes   | Rechtliche Prüfung abgeschlossen                          |
| NFA-05 | Signierte Helper-Binärdatei                             | Signatur wird vor Start geprüft                           |
| NFA-06 | Keine Übertragung von Pfaden oder Logs ohne Opt-in      | Telemetrie ist standardmäßig aus                          |
| NFA-07 | Versionierter Helper mit geprüftem Update-Pfad          | Versionsabgleich bei jedem Start                          |

Aus der Zeile `:217` desselben Dokuments — „Erstelle dafür eine Spezifikation und ein
Pflichtenheft" — wird damit der erste Schritt: **Kein Code ohne Pflichtenheft-Abgleich.**

## 1) Reviewer-Prinzip (vor Sandbox)

Unsicher → `ask` → Reviewer (nur geeignete Graubereiche) → sonst `ask`.
Keine weiteren Spezial-Suffixe erfinden. `deny` nie überschreiben; nur `ask→allow`
durch den Reviewer; Fehler/unklar → `ask`.

- Shell-Frage bisher: [Kriterien statt „harmlos?"] — Lesen überall erlaubt (außer Geheimnisse),
  Schreiben nur Projekt/Temp, keine Systemänderung, kein Netzversand, keine Geheimnisse.
  Aber: die Frage ist unzureichend formuliert, der Begriff und Bedeutung von "harmlos" nicht hinreichend definiert.
  Vergleiche späteren Abschnitt Zeilen 333 ff hier im Text: "## Offene Frage 1 — Jevvy-4-Achsen vs. unsere 2-Fragen".
- **Jev-Vorbild (`github-repos_permission-guard_links.md:68–71`):** zweite Frage für
  Zugangsdaten mit eigener Schwelle (empfohlen ≤0,5 bzw. schädlich/sensibel/unbekannter
  Code/verschleiert) — bei uns teilweise schon da (`SECRETS_QUESTION` + Schwelle 0,35),
  Rest (sensibel/verschleiert getrennt) als Prüfstein aus den Jev-Empfehlungen übernehmen.
  Auch hier kritisch: Vergleiche Zeilen 333 ff: "## Offene Frage 1 — Jevvy-4-Achsen vs. unsere 2-Fragen".
- **Claude-Code-Reviewer als Idee, nicht als Baustein:** Claude Code ist nicht Open Source —
  seine Sandbox ist keine Alternative für OpenCode. Übernehmbar sind nur **Review-Ideen**:
  was der Klassifizierer blockiert (Scope-Erweiterung, nicht vertrauenswürdige
  Infrastruktur, Prompt-Injection, Datenexfiltration, Traffic-Umleitung —
  vgl. `docs/Claude Auto Modus - handle prompt permissions.md:284–285`).

## 1.5) GitHub-Vorbilder (Jev + Guard-Chain, Researcher ss_e0f65cfa7ffeE7pUIs0jfeFHGM, 18.11.2026)

Die Ablageorte im Code sind am aktuellen Stand geprüft; externe Quellaussagen
stammen aus dem Researcher-Bericht (URLs unten). Übernahmen gelten erst nach
eigener Messung — keine Sandbox-Zusage (§0 bleibt Leitlinie).

### Jev / Jevvy / Cookbook (OpenRouter)

**OpenRouter-Cookbook „Gate Agent Tool Calls with Jev"** ([Link](https://openrouter.ai/docs/cookbook/building-agents/gate-tool-calls-with-jev.md)):
Fixe Arithmetik vor dem Modell; drei Noul-Achsen mit Schwelle 0,9/0,1, sonst
Mensch; Audit mit `reason`+Achsen.

- **Was tut es:** Die Prüfung läuft vor jeder Modellanfrage; ein Audit
  (`reason`, `checks`) gehört zum GateDecision. Dienst als Ordnung statisch →
  Modell → ask.
- **Was übernehmen wir:** nichts Neues — schon da (`reviewer.js:914`
  `neverAutoApprove` vor `review()`, `index.js:296–315`). Drei Ausgänge werden
  nicht übernommen (ADR §1: keine Spezial-Suffixe), Audit-Achsen bleiben
  Prüfstein.
- **Was verwerfen wir:** 3-Wege-Umbau.

**OpenRouter-Cookbook „Auto-Approve … with Jev"** ([Link](https://openrouter.ai/docs/cookbook/coding-agents/auto-approve-permission-prompts-with-jev.md)):
Fixe Risikoliste als Sicherheitsgrenze vor den Schwellenfragen (`reversible`,
`serves_task`); Fehler/Timeout → `ask`; deny ruft der Host (`allow` dort wirkt
nicht).

- **Was tut es:** Die Liste blockiert den Modellaufruf vollständig; danach
  zwei Noul-Fragen mit Schwelle 0,9. Das ist exakt unser Ablauf (RISKY +
  Secrets-Achse + schwächstes Segment).
- **Was übernehmen wir:** `serves_task`-Achse als Prüfstein (Tabellen-Nr. 3:
  nur wenn Task-Text vorhanden); `neverAutoApprove`-Logik
  (`reviewer.js:273–306`) und Schwellen-Bänder (`reviewer.js:318–337`).
- **Was verwerfen wir:** Codex-`description` als Task-Text (Freigabe-Frage,
  keine Aufgabenbeschreibung).

**Jevvy** ([github.com/PanAchy/jevvy](https://github.com/PanAchy/jevvy), Korpus
`eval/commands.json`): vier Noul-Achsen (harmful ≤ 0,35,
sensitive/untrusted/obscured ≤ 0,50); „any must-ask auto-approval
disqualifies a calibration run"; Audit-Limits 10.000 Zeilen/16 MiB/32 MiB.

- **Was tut es:** Alle vier Achsen müssen einzeln bestehen; Korpus
  aus `allow`/`ask`/`must-ask`-Fällen inkl. PowerShell-Beispielen.
- **Was übernehmen wir:** Achsen *sensibel/unbekannter Code/verschleiert*
  getrennt als Prüfstein (Nr. 1: `reviewer.js` `buildShellSystemoneRequest`,
  Fragen im selben Request — Latenz steigt nicht); `must-ask`-
  Disqualifikation (Nr. 2: `bench-shell.mjs`, 23 Fälle); Audit-Limits (Nr. 9:
  `audit.js` `MAX_BYTES` = 5 MiB heute; Diagnose-Log 1 MiB,
  `index.js:36`).
- **Was verwerfen wir:** reine Wahrscheinlichkeits-Politik ohne statische
  Liste; Cloud-Jev; Metriken mit wortgetreuen Befehlen (wir: keine
  Argumentwerte, `SECURITY.md:36`).

**Übrige OpenRouter-Links:** TypeSafe-SDK (systemone-Shape, nur Bestätigung);
Jev-Doku (Modellwechsel → Schwellen neu messen; stützt
`reviewer.js:318–337`); OpenCode-Integration (Provider-Verdrahtung, nicht
relevant); HITL (Pause-Muster, später).

### anomalyco/opencode v2.0.12 ([Link](https://github.com/anomalyco/opencode/tree/v2.0.12))

**Was tut es:** `evaluate` flachelt die Rulesets und gibt die **letzte**
passende Regel zurück; ohne Treffer `ask`. MCP-Aktion normalisiert als
`<server>_[PROMPT_INJECTION]`.

- **Was übernehmen wir:** Reihenfolge-Bestätigung (deny-Vorrang, ask über
  allow, dann Hook) — deckt sich mit `index.js:281` und `:296–315`.
- **Was verwerfen wir:** nichts — ist Upstream, kein Plugin.

### Guard-Chain (jeweils 3 Sätze)

**aws-samples/aws-iam-permissions-guardrails** ([Link](https://github.com/aws-samples/aws-iam-permissions-guardrails)):
Python-Bibliothek zur Analyse von AWS-IAM-Policies/SCPs, kein OpenCode-Plugin,
keine LLM-, keine Sandbox-Komponente.

- **Was übernehmen wir:** nichts (falsche Domäne).
- **Was verwerfen wir:** komplett.

**aorizondo/opencode-apex** ([Link](https://github.com/aorizondo/opencode-apex)):
Modulares V2-Plugin mit *Advisor* (eigener Agent, `allow`/`deny`) und *Redact*
(Secrets, AES-256-GCM); statisch+LLM-Mix, keine Sandbox.

- **Was übernehmen wir:** höchstens Redact als späteres Ergebnis-Layer
  (Schritt G aus Entscheindungsgrundlage 248–250).
- **Was verwerfen wir:** Advisor darf `deny` (wir nur `ask→allow`,
  `reviewer.js:421–426`); Secrets-Verschlüsselung mit Keydatei unnötig.

**opzero1/open-guardian** ([Link](https://github.com/opzero1/open-guardian)):
LLM-Judge nach Codex-Guardian-Vorbild (Cloud `gpt-5.6-luna`), Achsen
`risk_level`×`user_authorization`; „critical → deny" gegen behauptete
Autorisierung; Fehler→ask.

- **Was übernehmen wir:** Policy-Schichtung policy→rules→`.opencode/guardian.md`
  als Idee (Nr. 10: Config-Design, FA-10); Entscheidungs-Log.
- **Was verwerfen wir:** Judge darf `deny`; Cloud; kein Sandbox-Anspruch
  („no sandbox").

**preved911/opencode-bash-guard** ([Link](https://github.com/preved911/opencode-bash-guard)):
Rein statisch: `unbash`-AST, jede Segment einzeln, most-restrictive-wins
(deny > ask); Parse-Fehler → `deny` (fail-closed).

- **Was übernehmen wir:** Flag-Level-Verfeinerung als Prüfstein (z. B.
  `curl` nur `-X GET`); AST-parsen als Kontrast zu Regex. Segmentprüfung
  haben wir (`guard.js:229` `splitStatements`, `reviewer.js:886–908`).
- **Was verwerfen wir:** Parse-Error→`deny` (wir: fail-closed→`ask`);
  V1-Glob-Prämisse.

**WhiteGiverMa/opencode-webfetch-redirect-guard** ([Link](https://github.com/WhiteGiverMa/opencode-webfetch-redirect-guard)):
Prüft Redirect-Ketten des nativen `webfetch`; deterministische Codes
(`redirect_loop`, `credential_target`); statisch, keine LLM, keine Sandbox.

- **Was übernehmen wir:** „End-URL beweisen, dann umschreiben" für
  MCP/Web-Resource (`resource.kinds`, `guard.js` statisch).
- **Was verwerfen wir:** als Plugin unnötig (braucht `execute.before`,
  das wir ersetzt haben).

**koppert/opencode-security-guard** ([Link](https://github.com/koppert/opencode-security-guard)):
Linux-only, Jev-Cloud (OpenRouter), ein Noul `readOnlyThreshold 0.90`,
`/tmp`-Literals-Ausnahme; `deny` bleibt final.

- **Was übernehmen wir:** `/tmp`-Sonderpfad als Bestätigung unseres
  Temp-Ordners (nichts Technisches).
- **Was verwerfen wir:** Cloud mit Befehlstext, POSIX-Annahmen, kein
  PowerShell.

**mossgowild/opencode-guard** ([Link](https://github.com/mossgowild/opencode-guard)):
macOS-only (OpenCode ≥ 2.0.32): Shell in Claude Codes Sandbox (Seatbelt) +
Auto-Review-LLM; „If no sandbox can be built… the command is refused".

- **Was übernehmen wir:** **FA-06** („no sandbox → refused") und **FA-07**
  (Escape nur mit Begründung, „always asks, whatever the rules say");
  Sandbox-Verletzungen als Feedback; Transkript-Regel („Tool output is never
  shown to the reviewer").
- **Was verwerfen wir:** macOS/Seatbelt nur (kein Windows/MXC).

**fatihdogmus/opencode-codex-guardian** ([Link](https://github.com/fatihdogmus/opencode-codex-guardian)):
Nutzt Codex-Auto-Review per OAuth, „fresh, tool-free child session",
deterministisches Preflight (Root-Löschung, Blockdevice, Key/`.env`-Export),
Self-Protection, Audit mit Hashes, Circuit-Breaker (3 äquivalente Denials).

- **Was übernehmen wir:** Preflight-als-Statik (Katastrophe→`deny`); **FA-12**
  (Self-Protection: Agent ändert eigene Policy nicht); Audit ohne Rohbefehle.
- **Was verwerfen wir:** OAuth-gebunden, Cloud, audit-Bruch→deny (wir: Audit
  stört nie, `index.js:103–121`) — zu schwer für ein lokales Gate.

**helloydh007/opencode-permission-guard** ([Link](https://github.com/helloydh007/opencode-permission-guard)):
Statische Zwei-Schichten-Regeln (global+Projekt, last-match-wins,
Hot-Reload), Ask-Timeout→auto-reject, Headless-Downgrade (ask→deny);
Windows-tauglich, null LLM, keine Sandbox.

- **Was übernehmen wir:** Headless-Downgrade-Idee (Nr. 11:
  `index.js`, nur ohne TTY); ask-Timeout als UX-Schutz.
- **Was verwerfen wir:** **fail-open** (Regeln fehlend → durchlassen) —
  Gegenteil unseres Fail-closed.

**StuartGa/opencode-permission-guard** ([Link](https://github.com/StuartGa/opencode-permission-guard)):
Benachrichtigungs-Monitor für EACCES/EPERM, keine Entscheidung, keine LLM,
keine Sandbox.

- **Was übernehmen wir:** nichts.
- **Was verwerfen wir:** komplett (kein Gate-Feature).

### OpenCode-Doku ([opencode.ai/docs/permissions](https://opencode.ai/docs/permissions))

„Last matching rule wins"; „Any `deny` denies… otherwise any `ask` asks";
„`shell` runs with the host user's filesystem, process, and network
authority"; Scanner-Fehler → fail-closed.

- **Was übernehmen wir:** Scanner-Fehlentscheidung als Rechtfertigung für
  `ask`-Default; Shell-Anspruch belegt `SECURITY.md:5–8` („keine Sandbox").
- **Was verwerfen wir:** kein neues Modell; Doku führt kein LLM-Gate.

### Codex Auto-review + Hook ([auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review), [PermissionRequest](https://developers.openai.com/codex/hooks#permissionrequest))

Reviewer-Agent blockiert Exfiltration/Secrets-Probing/Destruktives;
Deny-Limits 3/10; „Timeout ≠ unsafe"; Hook: `deny` gewinnt über alle
Hook-Antworten.

- **Was übernehmen wir:** Deny-Limits als Schaltpause-Vorbild (Nr. 7:
  `reviewer.js` Zähler, NFA-01); Block-Kategorien als Kandidaten für
  statische RISKY.
- **Was verwerfen wir:** echter Agent statt Wahrscheinlichkeiten; Cloud.
  (`description`-Feld ist Freigabe-Frage, keine Task — unsere
  Absichtspeicher-Reststellung bleibt.)

### Claude Code ([permission-modes](https://code.claude.com/docs/de/permission-modes#how-the-classifier-evaluates-actions), [hooks](https://code.claude.com/docs/en/hooks#permissionrequest))

**Was tut es:** Regeln → Read-only → Klassifizierer → Block mit Grund;
Tool-Results werden aus den Klassifizierer-Anfragen gestrippt; Block-
Schwellen 3 in Folge / 20 gesamt (nicht konfigurierbar); Hook-Input
`session_id`/`transcript_path`/`cwd`/`permission_mode`/`tool_name`/
`tool_input`, Output `{behavior: "allow"/"deny", …}`.

- **Was übernehmen wir:** 3/20-Denkanstoß (Circuit-Breaker, Nr. 7);
  Tool-Results-strippen als Injection-Regel (wir partiell:
  Kanal-Tags `<UNTRUSTED-…>`, `reviewer.js:430–452`); Block-Kategorien
  (Exfiltration, Injektion, Umleitung) als statische Kandidaten.
- **Was verwerfen wir:** Cloud-Auto-Mode-Modell; Auto-Default. Das
  vollständige Hook-Schema ist aus Doku+Sekundärquelle, nicht aus der
  geladenen Primärseite geprüft (Peilung offen).

## 2) Sandbox — vorhanden nutzen, nichts erfinden

- **Kein Eigenbau.** Priorität: vorhandene Lösungen einbinden, aber Lizenzrechte beachten. 
  Für Windows: die **bereits installierte Codex-Sandbox** (MXC) wie im Nachbarprojekt `Inspect-Evals`
  (`inspect_codex_sandbox.py`: `codex sandbox -C … --permission-profile …`, Profil in
  eigenem `CODEX_HOME`, Fail-closed-Probe, Job-Object-Limits, Env-Strips).
  Nachweise aus dem Ordner: `.inspect-codex-sandbox/` existiert; Docker ist hier gar nicht
  installiert (`Get-Command docker` leer, nur `podman.exe` vorhanden) — mit der lokalen
  Version läuft es ohne/allenfalls mit Podman. Der Doku-Hinweis („Original-Sourcen greifen
  auf Docker-Images zurück") gilt für das **Upstream**, nicht für die lokale
  `Inspect-Evals`-Umsetzung (deren Text ersetzt sogar `docker compose` durch YAML-Lesen).
- **Grenzen:** Sandbox nicht startbar / Profil unklar / Weg nicht erfasst → Abbruch ohne
  unisolierte Ausführung (FA-06). `-C` darf die Wurzel nicht unbemerkt erweitern (FA-02/FA-05).
  `:danger-full-access` kein Rückfall (FA-07). Shell-Sandbox schützt nicht MCP/Dateiwerkzeuge
  allein — Guard bleibt.
- **Windows-MXC, nicht WSL2:** Claude-Sandbox gibt es unter Windows gar nicht (nur
  macOS/Linux/WSL2, default aus) — das ist genau die Lücke, die Codex unter Windows schließt.
  WSL2 bleibt eigener Prüfpunkt (Inseln, Pfade, Interop).

## Alternativen (bereinigt)

- **Claude-Sandbox:** nur Referenz für Review-Ideen, kein Baustein (geschlossen).
- **OpenCode-eigene Sandbox:** keine native Windows-Isolation in der V2-Doku belegt.
- **Eigenbau / Rust-Library:** nicht bevorzugt, solange vorhandene Codex-Sandbox
  (Inspect-Evals-Muster) läuft.
- **GitHub-Deep-Research (Jev + Guard-Chain):** siehe §1.5 — übernommen ist
  nur, was dort „Was übernehmen wir" sagt; alles andere bleibt verworfen.

## Messung

Tester → Coder (nach Freigabe) → Prototyp unter `staging/` (ohne Deploy) →
Windows+WSL2 mit isolierten Testverzeichnissen (FA-01…FA-13 als Prüfstein) →
erst dann Deploy-Entscheid. `replay.mjs` misst nur statische Klassifizierung,
nicht eingesparte Rückfragen. Weniger `ask` ist Erwartung, keine Zusage.

**Nicht getestet:** Jev-Deep-Research, Sandbox-Schutzwirkung, Modell-Bench.
Kein Sandbox-Versprechen in `SECURITY.md` ohne Nachweis.

## Offene Frage 1 — Jevvy-4-Achsen vs. unsere 2-Fragen

**Kontext.** Jevvy verlangt, dass **alle vier** Noul-Achsen bestehen:
`harmful ≤ 0,35` sowie `sensitive`, `untrusted`, `obscured` je `≤ 0,50`
([github.com/PanAchy/jevvy](https://github.com/PanAchy/jevvy), Korpus
`eval/commands.json`). Wir fragen heute zwei Dinge im selben Systemone-
Request (`buildShellSystemoneRequest`, `questions: {effect, secrets}`,
`reviewer.js:570–575`): `effect` (Choice: reads/changes, Freigabe ab
`shellThreshold = 0,7`, `reviewer.js:90`, 886–908 „schwächstes Segment
zählt") und `secrets` (Noul, Freigabe nur bei `secrets ≤ secretsThreshold
= 0,35`, `reviewer.js:95`, 564–568, 903–908).

**Ziel.** Freigaben ohne fehlende Achse: ein Befehl, der unvertrauenswürdigen
Code ausführt oder verschleiert ist, sollte nicht allein deshalb freigegeben
werden, weil er „nur liest".

**Lücke.** *sensibel* und *secrets* sind **nicht identisch**: *sensibel* meint
die Lesbarkeit privater Daten allgemein (Pfad/Inhalt), *secrets* eng die
Zugangsdaten/Private-Daten-Exposition (`SECRETS_QUESTION`,
`reviewer.js:564–568`). *Unbekannter Code* (fremde Interpreter/Wrapper)
und *verschleiert* (codiert/verborgen) deckt unsere `RISKY`-Liste
(`reviewer.js:112–161`) statisch ab; was die Liste nicht sieht, hat keine
eigene Modell-Achse — 05.11-Research nannte genau diese drei als Rest
([Linkliste](../github-repos_permission-guard_links.md)).
**Warum 3 von 4:** `harmful` ≈ unsere `effect`-Achse und *sensibel* ≈ unsere
`secrets`-Achse wurden bereits durch einen einzigen Sensibel-Befund
(`token.json`) gedeckt; getrennt zu zählen wären sie die übrigen drei.
Das ist keine vollständige Jevvy-Lösung, sondern der Vorschlag der
05.11-Recherche.

**Secrets: statisch gab es nie das ganze Bild.** Pfadlisten melden **wer**
bekannt ist: `SECRET_PATHS` (`guard.js:39–54`, z. B. `.ssh`, Key-Endungen),
`DENY_PATHS` (`guard.js:2268–2274`), Geheimnis-Recalls in `RISKY`
(`reviewer.js:112–161,153`). Sie erkennen Pfade und Namen — **nicht** Inhalte
beliebiger Dateien, Umgebungsvariablen, URLs oder fernliegende Ressourcen.
Deshalb ist „Größe kleinste Reviewer-Kandidaten" richtig, aber „alle Secrets
abgedeckt" falsch: Die Modell-Achse fragt, ob der Befehl nach seiner Wirkung
Zugangsdaten offenlegt, auch wenn kein Listenwort vorkommt. Statistisch
bleibt die Achse das Rückfall-Netz unterhalb der Pfade.

**Beobachtung / Schlussfolgerung / Vermutung:**

- *Beobachtung:* Jevvy-4-Achsen ohne statische Liste; unsere 2-Fragen-Achsen
  mit RISKY-Liste davor; Secrets-Achse 23/23 gemessen (§1.5).
- *Schlussfolgerung:* Eine eigene Secrets-Achse ist weiter sinnvoll, weil die
  Pfadlisten Inhalt nicht beweist; die 4-Jevvy-Achsen lösen das gemeinsam.
- *Vermutung:* Drei zusätzliche Nouls im selben Request kosten ~0 Latenz;
  getrennte Requests kosten je Segment eine Zusatz-Runde (`-np 1`).

**Option A — heute (effect + secrets).**
- *Kontext/Ziel:* Nichts ändern, nur als Basis messen (23/23 bench-shell).
- *Lücke:* *unbekannt/verschleiert* und breit-*sensibel* ohne eigene Achse.
- *Fix:* keiner.
- *Aufwand:* 0.
- *Vorteile:* kleinste Latency, alles schon gemessen. *Nachteile:* Kombi-
  Wirkung zweier Achsen statt getrennter Diagnose; Fehlfreigaben dieser Art
  fallen erst im Log auf.

**Option B — Jevvy-4 in einer Anfrage (empfohlen als Prüfstein).**
- *Kontext/Ziel:* je Noul eine Achse (`sensitive`, `untrusted`, `obscured`
  ≤ 0,50; `harmful`→`effect` wie heute) in demselben Request wie
  `buildShellSystemoneRequest`.
- *Lücke:* Kalibrierung für Clef-Flash offen; `effect` ist Choice (reads
  ≥ 0,7), nicht Jevvys Noul-harmful ≤ 0,35 — Schwellen müssen neu gemessen
  werden, nicht übernommen.
- *Fix:* drei Fragen ergänzen, must-ask-Korpus erweitern (Nr. 2), vorher/
  nachher `bench-shell --repeat 3`.
- *Aufwand:* klein-mittel (Fragen, Schwellen-Bänder, Tests).
- *Vorteile:* Latenz ~0 Zusatz (ein Request), klare Diagnose je Achse,
  kein neues Backend. *Nachteile:* mehr Logik im Ungewollten-Schwellen-
  Bereich; Korpus muss aus echten Befehlen wachsen.

**Option C — getrennte Anfragen je Achse.**
- *Kontext/Ziel:* je Achse ein eigener Request (Isolation der Frage).
- *Lücke:* keine — aber Latenz multipliziert sich (`-np 1`, jede Achse nacheinander).
- *Fix:* Schleife über Fragen × Segment.
- *Aufwand:* mittel (Zeitbudget, Warmup, Timeout folgekorrekt).
- *Vorteile:* jede Achse einzeln messbar. *Nachteile:* schlechteste Latenz,
  NFA-01-Risiko, kein Gewinn gegen B außer Kontingenz.

## Offene Frage 2 — Deny-Limits (Ermüdung)

**Kontext.** Rückfragen ermüden: Läuft das Modell gegen den Nutzer, der
nie „ja" sagt, bleibt es ask für immer. Deny-Limits pausieren nicht das
Modell, sie beenden die endlosen Durchläufe.

**Ziel.** Automatisches Anhalten nach einer Deny-Folge — bevor der Nutzer
vor lauter Rückfragen durchwinkt — ohne dass ein einzelner Schuss alles
stoppt.

**Lücke.** Wir haben keinen Zähler; jede Frage bleibt ask, bis der Nutzer
antwortet. Claude und Codex haben Limits (unverwechselbare Zahlen unten).

**Beobachtung — Codex (Auto-review, Primärquelle):** Zähler lebt bei Codex
in `Session` als `GuardedRejectionCircuitBreaker`
(`codex-rs/core/src/guardian/mod.rs`, PR
[#22110](https://github.com/openai/codex/pull/22110), in main):
Konstanten `MAX_CONSECUTIVE_GUARDIAN_DENIALS_PER_TURN = 3`,
`MAX_RECENT_AUTO_REVIEW_DENIALS_PER_TURN = 10`,
`AUTO_REVIEW_DENIAL_WINDOW_SIZE = 50`; Struktur `HashMap<String, Turn>`
(`turn_id → {consecutive, recent: VecDeque<bool>, interrupt_triggered}`),
`record_denial()` / `record_non_denial()` (konter zurückgesetzt, Fenster
gleitet); Call-Site `review.rs` (`record_guardian_denial`,
`record_guardian_non_denial`, „reviewed the last
`AUTO_REVIEW_DENIAL_WINDOW_SIZE`"); Reset per `clear_turn(turn_id)` bei
Task-Start und -Ende (`tasks/mod.rs`). Gestrichen: nur **Auto-review-
Denials** (`GuardianAssessmentOutcome::Deny`); statische Denies und
Nutzer-Denys zählen explizit **nicht**. Action: `GuardianWarning` +
`abort_turn_if_active(Interrupted)`.

**Beobachtung — Claude:** 3 in Folge / 20 gesamt (nicht konfigurierbar;
§1.5), Snapshot-Chain: 20 gesamt, kein Fenster.

**Schlussfolgerung für uns:** Codex speichert in-memory je Turn im
Session-Service; unsere Entsprechung ist der Hook-State in `index.js`
(Setup-Closure, wie `seenMcpTools` `index.js:172`) — kein Audit-Lesen nötig,
kein Platten-State. Der Audit (`index.js:174–199`) führt `decision`/`layer`/
`reason` je Aufruf und eignet sich als Diagnose-Export der Deny-Folge.

**Option A — Claude (3 in Folge / 20 gesamt, je Turn).**
- *Fix:* Zähler `{consecutive, total}` je `sessionID` (Verstellbar:
  Konstanten `3`/`20` als Config-Werte, Default heute).
- *Aufwand:* klein-mittel (Session-Key, Interrupt-Warnung).
- *Vorteile:* einfach, feste 20-Obergrenze. *Nachteile:* hart, kein Fenster —
  20 über die ganze Session verteilt zählt gleich wie 20 in Folge.

**Option B — Codex (3 in Folge / 10 in letzten 50, je Turn).**
- *Fix:* rolling Fenster (`VecDeque<bool>`-Aequivalent) im Hook-State,
  `clear_turn` bei Turn-Ende.
- *Aufwand:* klein (ein Modulrand, kein externer State).
- *Vorteile:* Quelle 1:1 aus dem Primär-Repos zitiert; Fenster begrenzt die
  Fehlpause bei vereinzelten Denys; verstellbar wie A.
- *Nachteile:* Deny-Definition nötig: **nur** Reviewer-`ask` (= statisch
  `ask` → Modell `ask`)? Statische `deny` zählen nicht; Nutzer-`deny`
  zählt nicht.

**Option C — kein Budget.**
- *Fix:* keiner.
- *Aufwand:* 0. *Nachteil:* Ermüdungsproblem bleibt; Nutzer winkt durch.

**Entscheidungsregel (Fix-Vorschlag):** erst einhalten (Q1-Option B) — das
Modell wird präziser (Achsen), Deny-Limit A/B erst danach, Schwelle
verstellbar, Messung: Rückfragen-Rate (`replay.mjs`, `stats.mjs`),
Gate 7/7. Kein Modell-`deny` (wir: Modell darf nie Deny-Limits auslösen,
nur warnen).

**Beobachtung vs. Vermutung:** Deny-Limit-Kette im Auto-review-Primärquelle
beobachtet (PR #22110, main-Stand 5af85998 und f1affbac gelesen); den
Turn-/Session-Key der OpenCode-hooks haben wir lokal noch nicht aus dem
Go/TS-Code verifiziert (Vermutung: `sessionID` aus `index.js` ist der Key).

## Options-Übersicht (architecture-Skill: Options Considered)

| Option | Was | Komplexität | Kosten | Skalierung | Vertrautheit |
|---|---|---|---|---|---|
| A — Heute (2 Fragen + kein Limit) | `effect` + `secrets` wie bisher | Niedrig | 0 | Skaliert nicht gegen Textsuche (4 Abnahmen) | Hoch (bewährt) |
| B — Jevvy-4 in einer Anfrage + Codex-Breaker (3/10-in-50) | 4 `noul`-Fragen (harmful/sensibel/unbekannt/verschleiert), alle ≤ Schwelle, einmal HTTP | Mittel | Latenz gering (eine Anfrage) | Fail-closed im Modell, Lücke Reviewer→Ask geschlossen | Mittel (Jevvy-Muster bekannt) |
| C — Sandbox (Codex-MXC-Vorbild) | `codex sandbox -C --permission-profile`, Fail-closed (FA-06) | Hoch | Codex-CLI + Dienst | Schützt OS-Grenze (Windows/WSL2), kein Ersatz für Reviewer | Mittel (Inspect-Evals-Muster gelesen) |

**Trade-off:** B gewinnt gegen A, wo A blind bleibt (unbekannt/verschleiert), kostet etwas mehr `ask` bei falsch-positiven Schwellen. C schützt dort, wo B nicht hinreicht (OS-Grenze), kostet neue Abhängigkeit und Prototyp-Messung. Kein Modell-`deny` (Reviewer hebt nur `ask→allow`).

## Messplan (vor Deploy, kein Versprechen ohne Nachweis)

1. Ausgangsstand festschreiben: `bench-shell` 23 Fälle, `bench-model` 14, `bench-mcp` 33; `replay --all` + `stats` für Rückfragen-Rate.
2. Je Änderung vorher/nachher dreimal messen; Fehlfreigaben pro Einzellauf ausweisen; `must-ask`-Disqualifikation (Jevvy-Korpus) für B.
3. Sandbox-Prototyp unter `staging/` mit FA-01…FA-13 als Prüfstein; Windows + WSL2 mit isolierten Testverzeichnissen (erlaubt/verweigert außer allen Wurzeln, geschützte Pfade, fehlende Sandbox, direkte/verschachtelte Aufrufe).
4. Erst danach Deploy-Entscheid und P1-Abgleich. Kein Gate-7/7-Grün → kein Deploy.

## Action Items

- [ ] ADR-Nummer `0002` bestätigen.
- [ ] Criteria-Frage schärfen (Textvorschlag) + Messauftrag (PLANUNG.md).
- [ ] Jevvy-4 in einer Anfrage als *eine* Anfrage messen (B). Keine UX-Änderung ohne Messung.
- [ ] Deny-Limit B (Codex-Fenster) als Prototyp; Schwelle verstellbar.
- [ ] Sandbox-Prototyp `staging/` (Codex-CLI), kein Live-Eingriff.
- [ ] `SECURITY.md`-Zusage ohne Nachweis nicht ändern (P1-31 separat).

---

## Nachtrag 20.11.2026: Entscheidungen zu Größe, Geheimnisfrage und Sandbox-Pfad

**Status:** angenommen und umgesetzt. Die Historie oben bleibt unverändert stehen.

### 1. Größenlimit: Option C (deny, außer belegtes Lesen)

*Kontext.* MCP-Argumente über 32000 Zeichen (als JSON) ergaben `ask`. Eine
Rückfrage mit 30000 Zeichen Befehlstext ist im Freigabefenster nicht lesbar
und wird reflexhaft bestätigt; sie schützt niemanden.

*Entscheidung.* `read`-Werkzeuge bleiben `allow`, sofern kein
Geheimnisverdacht besteht; jede andere Absicht wird `deny` mit dem Grund
`unpruefbar (zu grosse Argumente)`. Ein Größenlimit bleibt ausdrücklich
**kein Fund** — der Grund nennt `unpruefbar`, nicht `destruktiv`.

*Umgesetzt.* `guard.js` (`mcpVerdict`), `reviewer.js` (`reviewMcp`),
`test.mjs`, `mcp-cases.jsonl`, `bench-mcp.mjs` (11 statt 9 Verbote),
`README.md`, `README_de.md`, `SECURITY.md`.

### 2. Fehlende Geheimnis-Antwort: `ask` statt stiller Freigabe

*Kontext.* Fehlte die Antwort auf die Secrets-Frage, übersprang der Code die
Sperre und urteilte allein nach der Hauptfrage; „keine Antwort" zählte wie
„kein Risiko".

*Entscheidung.* Ohne Secrets-Wert lautet das Urteil `ask` mit dem Grund
`Modell: keine Antwort auf die Geheimnisfrage`. Das ist ein qualifizierter
Abbruch, keine stille Freigabe.

*Umgesetzt.* `reviewer.js` (`shellBySystemone`), `test.mjs` (der bisherige
Fall „fehlender Wert bleibt bei der Hauptfrage" ist umgedreht).

### 3. Belegter Serverfehler statt geratener Zeichengrenze

*Kontext.* Zwischen der Zeichengrenze (32000) und der Kapazität des
Modellstapels lag ein Bereich, in dem der Server mit HTTP 500 antwortet und
der Guard daraus `ask` machte — wieder eine unlesbare Rückfrage.

*Entscheidung.* Antwortet der Server mit „input … is too large to process",
ergibt das für genau diesen Aufruf `deny`. Andere Fehler (Zeitüberschreitung,
anderer HTTP-Fehler) bleiben `ask`, damit ein vorübergehender Aussetzer nicht
alles blockiert.

*Umgesetzt.* `reviewer.js` (`requestSystemone` wertet den Body nur bei 500
aus; `shellBySystemone` und `reviewMcp` verweigern), `test.mjs` (drei Fälle).

### 4. Messungen zum Modellstapel (20.11.2026)

Gemessen mit `Clef-Flash-Q4_K_M`, `-c 32768 -np 1`, `staging/measure-length.mjs`
und `staging/probe-too-large.mjs`. Der Server läuft im Embedding-Modus; dort
erzwingt llama.cpp `n_batch = n_ubatch`, beide Werte wurden gemeinsam gezogen.

| `-b`/`-ub` | größte beantwortete Eingabe       | erste verweigerte | GPU-Belegung   |
| ---------- | --------------------------------- | ----------------- | -------------- |
| 1024       | 5000 Zeichen                      | 6000              | nicht gemessen |
| 2048       | 12000 Zeichen                     | 16000             | nicht gemessen |
| 4096       | 24000 Zeichen (28000 im Endlauf)  | 31000–32000       | 7054 von 16283 MiB |

*Beobachtung.* Die Grenze wächst mit dem Stapel, aber nicht proportional.
*Schlussfolgerung.* 4096 ist auf dieser Karte ohne Not vertretbar (rund 7,1 GB
von 16,3 GB). Die Werte gehören **nicht** in `%APPDATA%\llama.cpp\config.ini`:
Dort gelten sie für Chatmodelle, und `batch-size = 2048` / `ubatch-size = 1024`
bleiben dafür richtig. `start-reviewer.ps1` übergibt `-b 4096 -ub 4096` im
Aufruf (Parameter `-Batch`/`-Ubatch`); Kommandozeilenargumente übersteuern die
Datei. Watchdog und Plugin starten über dieses Skript, es gibt also nur eine
Stelle. *Vermutung, nicht gemessen:* Mit den vier Achsen der Stufe 3 sinkt die
nutzbare Eingabe weiter, weil jede Frage Prompt-Tokens kostet.

### 5. Sandbox: der CLI-Weg braucht den Windows-Dienst nicht

*Beobachtung.* Der Screenshot vom 18.11. zeigt
`codex-windows-sandbox-service.exe` als Kindprozess der ChatGPT-GUI. Auf der
Maschine existiert dazu der Dienst `CodexSandboxService.OpenAI.Codex`
(Anzeigename „ChatGPT"), gestoppt, solange die GUI nicht läuft. Während eines
vollständigen `codex sandbox`-Laufs (Prozessbaum `codex.exe` → `codex.exe` →
`cmd.exe`, Exit 0) blieb der Dienst **Stopped**.

*Schlussfolgerung.* Der Prototyp auf Basis der Codex-CLI ist unabhängig von
GUI und Dienst lauffähig; die Durchsetzung ist belegt (Schreiben im Home
verweigert, `.ssh`/`.codex` unsichtbar, Netz blockiert, Schreiben im
Arbeitsordner erlaubt).

*Vermutung, nicht belegt.* Die GUI nutzt über diesen Dienst die ältere
Windows-Sandbox, der CLI-Weg MXC. Das wäre aus Codex-Quellcode oder
Dokumentation zu belegen.

*Fehler im Vorbild, gefunden und behoben.* Das Profil aus `Inspect-Evals`
verlässt sich auf `:tmpdir`; das deckt die Windows-Ordner `TEMP`/`TMP` nicht
ab. Erst `":tmpdir" = "deny"` **und** explizite Einträge für `%TEMP%`/`%TMP%`
blockieren das Schreiben dorthin. Die Echo-Probe allein beweist keine
Durchsetzung.

### 6. Offen (nicht entschieden, nicht umgesetzt)

- Vier Achsen (Stufe 3): eigene Messung, Schwellen je Achse kalibrieren.
- Deny-Limits (3/20 gegen 3/10-in-50): zurückgestellt.
- Skriptblock und `$(…)`-Teilausdruck an den Reviewer: nur mit rotem Fall.
