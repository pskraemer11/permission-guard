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
- Datenabfluss durch ein Werkzeug, das der Guard nicht sieht.

Fehler führen bewusst zur Rückfrage, nicht zur Freigabe (`fail closed`). Ein
`deny` der statischen Regeln wird nie überschrieben.

## Grenzen der Audit-Kette

`audit.js` schreibt eine SHA256-Kette über MCP-Entscheidungen. Sie erkennt
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
