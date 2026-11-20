# Permission Guard und Reviewer/Klassifizierer Linkliste
*18.11.2026

ToDo: 
Leite aus den nachfolgenden Quellen weitere Hinweise ab, wie unser `permission-guard` in `~/Python-Projekte/AI+IDE-Hints/tools/permission-guard` 
bzw. der enthaltene `Reviewer` (lokales Clef-Flash Decision Modell) noch verbessert werden kann.
  
Sowohl Anthropic/Claude als auch OpenAI/Codex haben ähnliche Ansätze, und bei Github und OpenRouter findet sich weitere Repos in dieser Richtung (nutze ggf. Exa / Firecrawl via MCP):

# Permission Guards mit und ohne LLM-Klassifizierer
https://opencode.ai/docs/permissions (statisch) 
https://github.com/anomalyco/opencode/tree/v2.0.12, 

https://github.com/aws-samples/aws-iam-permissions-guardrails
https://github.com/aorizondo/opencode-apex
https://github.com/opzero1/open-guardian
https://github.com/preved911/opencode-bash-guard
https://github.com/WhiteGiverMa/opencode-webfetch-redirect-guard
https://github.com/koppert/opencode-security-guard
https://github.com/mossgowild/opencode-guard
https://github.com/fatihdogmus/opencode-codex-guardian
https://github.com/helloydh007/opencode-permission-guard
https://github.com/StuartGa/opencode-permission-guard
https://www.heise.de/hintergrund/OpenShell-Wie-Nvidia-KI-kontrollieren-und-so-einer-Regulierung-zuvorkommen-will-11498122.html?
seite=all

# Reviewer/Klassifizierer 

## OpenRouter
- https://openrouter.ai/docs/cookbook/building-agents/gate-tool-calls-with-jev.md und https://github.com/PanAchy/jevvy
      applies the same threshold pattern to tools in an OpenRouter Agent SDK agent, with approve, block, and review outcomes
- [OpenCode Integration](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration.md) 
      covers pointing OpenCode at OpenRouter and picking models, which the OpenCode section assumes is done
- [Add Human-in-the-Loop Controls](https://openrouter.ai/docs/cookbook/building-agents/hitl-tools.md) 
      is the pause-and-resume pattern that these prompts are a coding-agent version of
- [TypeSafe SDK on OpenRouter](https://openrouter.ai/docs/guides/community/typesafe-sdk.md) 
      shows the Choice, Score, and Noul primitives if you want a three-way approve, ask, deny question instead of two Nouls
- [Jev documentation hub](https://openrouter.ai/docs/guides/community/jev.md) for the [Jev tutorial](https://openrouter.ai/docs/guides/community/jev-tutorial.md), 
      pricing, and the TypeSafe docs on choosing a threshold
- [Other decision models on OpenRouter](https://openrouter.ai/models?output_modalities=decisions) 
    from OpenAI, Microsoft, Perplexity, Cloudflare, and others take the same Decisions API request: change model and re-check your thresholds on a labeled sample

## OpenAI:
https://learn.chatgpt.com/docs/sandboxing/auto-review
https://developers.openai.com/codex/hooks#permissionrequest,

## Anthropic:
https://code.claude.com/docs/de/permission-modes#how-the-classifier-evaluates-actions
https://code.claude.com/docs/en/hooks#permissionrequest, 

# Spezialthemen
https://github.com/boxpositron/envsitter-guard
https://github.com/trufflesecurity/trufflehog

============

*Claude/Haiku-5.5; 13./14.11.2026

Ja, und die Quellen geben konkrete Hinweise. Die Zusammenfassungen stammen aus dem Abruf und sind kein Wortlaut der Seiten. 
Vor einer Übernahme sollte man die Stellen im Original nachlesen.

*Was wir schon richtig machen: 
Statische Regeln kommen vor dem Modell, Denies werden nie überschrieben (OpenCode, Codex und Jevvy sagen dasselbe), 
das Modell darf nur auf ask oder allow heben, und Fehler oder Timeouts führen zu ask. Unser Ansatz deckt sich damit mit dem der anderen.

Konkrete Hinweise, nach Nutzen geordnet:

1. Zweite Frage für Zugangsdaten und private Daten (Jevvy). Jevvy fragt getrennt nach „schädlich“ (Schwelle ≤ 0,35), „sensibel“ (≤ 0,5), 
„unbekannter Code“ (≤ 0,5) und „verschleiert“ (≤ 0,5). Die Achsen werden einzeln geprüft, und alle müssen bestehen. 
Das ist genau die Lücke bei token.json. Eine eigene Frage „gibt das Zugangsdaten oder private Daten preis?“ würde den Fall unabhängig von der Hauptfrage abfangen. 
Kosten: eine zweite Anfrage pro Segment, also mehr Latenz bei -np 1. Das muss man messen.

2. Die Ordnung der Prüfung (OpenRouter-Cookbook). Der Cookbook-Text nennt als Vorgehen: Wenn eine falsche Freigabe passiert, 
zuerst das Muster in die statische Liste aufnehmen und erst danach die Schwelle verschärfen. 
Die Liste ist die Sicherheitsgrenze, nicht die Schwelle. Das passt zu unserem Vorgehen beim $null-Fehler.

3. Zuweisungen vor der Prüfung abtrennen (Cookbook). Das Cookbook entfernt Variablenzuweisungen, Wrapper und Pfadpräfixe, bevor geprüft wird, 
und behandelt nicht Lesbares als riskant. Das ist genau die Stelle, an der unser $null = Remove-Item-Fehler lag. 
Unsere Korrektur geht in dieselbe Richtung. Es lohnt sich, die Normalisierung des Reviewers gezielt gegen weitere Wrapper zu prüfen.

4. Schwelle und Wortlaut testen (Cookbook). Der Cookbook-Text warnt, dass Scores je nach Formulierung um einige Hundertstel schwanken und 
man nach jedem Modellwechsel neu messen muss. Das bestätigt unsere Messung. 
Wir sollten die Messung so betreiben, dass jeder Wechsel von Frage, Modell oder Quantisierung wiederholt wird.

5. Kalibrierungskorpus mit Pflicht-„ask“-Fällen (Jevvy). Jevvy zählt einen Lauf als ungültig, sobald ein Fall, der nachfragen muss, freigegeben wird. 
Unser bench-shell hat schon 17 Fälle mit diesem Prinzip. Ausbauen sollten wir den Korpus um mehr Grenzfälle. 
Die Fälle sollten aus echten Befehlen des Agenten stammen, nicht nur aus meinen Beispielen.

6. Der Host-Text ist nicht vertrauenswürdig (Jevvy zu Codex). Codex füllt tool_input.description mit einer Freigabefrage, und das Modell bewertet sie schlecht. 
Wir nutzen den Text nicht, das ist richtig. Wichtig wird das, falls wir den Reviewer später als Hook in Claude oder Codex einbauen.

7. Fail-closed nicht blind übernehmen (Claude-Hook). Claude erlaubt onFailure: "block", und dann wird bei einem Fehler verweigert. 
Für einen reinen Freigabe-Filter wäre das zu streng. Richtig ist, bei einem Fehler in die normale Rückfrage zu fallen. Das ist das Verhalten, das wir schon haben.

8. Ein eigenes Verbots-Layer (OpenCode). OpenCode trennt eine Richtliniensicht, die nur hart verweigern darf, von den Freigaben. 
Das entspricht unserer Regel „deny nie überschreiben“. Wir könnten die Verbote in einer eigenen, klar benannten Liste führen, damit sie leichter zu prüfen sind.

9. Externe Verzeichnisse nicht auf Host-Standards verlassen (OpenCode). Dort ist der Zugriff außerhalb des Projekts standardmäßig erlaubt, 
solange man keine Regel setzt. Unser Guard verweigert das selbst, das ist gut. 
Wir sollten sicherstellen, dass kein Pfad auf den Standard der Host-Konfiguration angewiesen ist.

10. Audit ohne Argumentwerte (Jevvy). Jevvy warnt, dass Befehle Geheimnisse enthalten können, und speichert deshalb Limits und Rotation. 
Unser Audit schreibt keine Argumentwerte und hat eine Hash-Kette, das ist stärker. Eine Obergrenze für die Größe fehlt uns noch.

Was ich nicht übernehmen würde: Jevvys Verzicht auf eine statische Verbotsliste. Dort gibt es nur die Wahrscheinlichkeit, und das ist für einen Guard zu wenig.

---
Schritt 1 bereits umgesetzt.

**Nächste Schritte aus der Recherche (offen)
- Empfehlung 3: Normalisierung des Reviewers gegen weitere Wrapper prüfen
- Empfehlung 5: Kalibrierungskorpus aus echten Befehlen erweitern
- Schwelle der Konfigurationsdatei validieren (jetzt auch secretsThreshold)

※ recap: Ziel: permission-guard härten, Review-Befunde und Recherche-Empfehlungen umsetzen.
Secrets-Achse ist gemessen (23/23) und als Commit a7e6b3b lokal vor origin/main. 
Nächster Schritt: Empfehlung 3/5 angehen. (disable recaps in /config)