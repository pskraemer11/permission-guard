# Security Policy

## Was dieses Projekt ist

Ein Klassifizierer für Werkzeugaufrufe in OpenCode. Er hebt `ask` auf `allow`,
wenn ein Shell-Befehl nachweislich nur liest, und er beurteilt MCP-Aufrufe in
drei Schichten. Er ist **keine Sandbox** und keine Isolationsgrenze: ein
erlaubter Befehl läuft mit den Rechten des angemeldeten Benutzers.

## Bedrohungsmodell

Angenommen wird ein Agent, der Befehle vorschlägt, und ein Nutzer, der
Rückfragen nicht bei jedem Schritt beantworten will. Der Guard verhindert, dass
lesende Befehle nachfragen, und dass schreibende ohne Nachfrage laufen. Er
schützt **nicht** gegen:

- einen Befehl, der als lesend erkannt wird, aber über einen Umweg schreibt,
- ein manipuliertes Modell, das einen Graubereich freigibt,
- einen Angreifer mit Schreibrechten auf das Plugin oder die Konfiguration,
- Datenabfluss durch ein Werkzeug, das der Guard nicht sieht,
- Prompt-Injection in Werkzeugergebnissen. Die Grenz-Markierung `[ud-…]` um
  MCP-Antworten und `execute`-Ergebnisse ist ein Hinweis an das Modell, keine
  Grenze. Dasselbe gilt für den Zusatz `[verdacht: …]`: Er benennt
  Formatkollisionen (Chat-Marker, Rollenzeilen, Werkzeug-Rahmen, unsichtbare
  Steuerzeichen) und erkennt keine Bedeutung. Ein überredender Satz bleibt
  unmarkiert.

Fehler führen bewusst zur Rückfrage, nicht zur Freigabe (`fail closed`). Ein
`deny` der statischen Regeln wird nie überschrieben.

**Ausnahme seit 20.11.2026:** Was niemand prüfen kann, wird verweigert statt
gefragt. Drei Fälle sind belegt:

- MCP-Argumente über 32000 Zeichen (als JSON) ergeben `deny`, außer der
  Werkzeugname belegt eine Leseabsicht und es gibt keinen Geheimnisverdacht.
- Meldet der Modellserver „input … is too large to process", ergibt das für
  genau diesen Aufruf `deny`.
- Ein MCP-`write`/`destructive`-Aufruf, dessen Zielpfad außerhalb von Projekt
  und Temp liegt, ergibt `deny` — dieselbe Grenze wie bei Shell-Befehlen.
  Innerhalb bleibt es bei `ask`.

Eine Rückfrage mit 30000 Zeichen Text ist kein Schutz: Sie ist im
Freigabefenster nicht lesbar und wird reflexhaft bestätigt. Ein
Größenlimit ist weiterhin **kein Fund**; die Begründung im Protokoll lautet
`unpruefbar`, nicht `destruktiv`. Andere Fehler (Zeitüberschreitung, anderer
HTTP-Fehler) bleiben `ask`.

**Webabrufe (seit 20.11.2026):** Der Code-Mode-Interpreter darf jede Adresse
abrufen, und die statische Regel erlaubt `webfetch` pauschal. Der Guard fragt
deshalb jedes Ziel außerhalb von localhost nach. Das ist eine Rückfrage, keine
Grenze: Wer sie bestätigt, gibt den Abruf frei. Lokale Adressen laufen ohne
Rückfrage; ein `deny` der statischen Regeln wird nie überschrieben.

## Grenzen der Audit-Kette

`src/audit.js` schreibt eine SHA256-Kette über MCP-Entscheidungen. Sie erkennt
Veränderung und Umordnung, aber **kein Abschneiden am Ende** ohne externen
Anker. Sie ist keine Signatur. Wer Schreibrechte auf die Datei hat, kann sie
neu aufbauen.

## Zugangsdaten

Das Plugin liest keinen Schlüssel aus einer Datei. Die Konfiguration nennt nur
den **Namen** einer Umgebungsvariablen (`apiKeyEnv`); der Wert bleibt außerhalb
des Repositories. Das Audit enthält keine Argumentwerte und keine Resultate.

## Eine Sicherheitslücke melden

Über die GitHub-Funktion **Security → Report a vulnerability** (Private
Advisory) des Repositories. Bitte keine öffentlichen Issues für
Sicherheitsfragen und keine Adressen in Meldungen oder Logs.

Bitte angeben: betroffene Version, Betriebssystem, der auslösende Befehl oder
MCP-Aufruf, erwartetes und tatsächliches Urteil. Keine echten Zugangsdaten.

## Unterstützte Versionen

| Version | Status |
| --- | --- |
| 0.1.x | unterstützt |
