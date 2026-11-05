# Mitmachen

## Voraussetzungen

- Node.js 20 oder neuer; keine Laufzeitabhängigkeiten.
- Git mit Bash (Windows: Git for Windows), damit die Hooks laufen.

## Prüfen

```powershell
node test.mjs          # muss vollständig grün sein
node bench-mcp.mjs     # 33/33 Weiterleitungen, 9 Verbote
```

Änderungen an `reviewer.js` zusätzlich gegen ein laufendes Modell messen
(`node bench-model.mjs --repeat 3`); ohne Modell bleibt das Gate
`bench-mcp.mjs --model` aus.

## Regeln

- **Fail closed.** Alles Unbekannte bleibt `ask`. Ein `deny` der statischen
  Regeln wird nie überschrieben, ein Modell darf nur `ask` zu `allow` heben.
- **Keine neuen Laufzeitabhängigkeiten.** Was eingebaut ist, reicht.
- **Keine Zugangsdaten, keine Benutzernamen, keine absoluten Pfade** in
  Dateien, Commit-Nachrichten oder Logs. Die Hooks prüfen das.
- **Der Quelltext ist die Wahrheit.** Kommentare erklären *warum*, nicht *was*;
  veraltete Kommentare werden mitgeändert.
- Kleine, fokussierte Commits. Sprache: Deutsch in Kommentaren und Doku,
  Englisch in Bezeichnern.

## Hooks

```powershell
git config core.hooksPath .githooks
```

`pre-commit` prüft Secrets und geschützte Adressdomains und ruft das Test-Gate
auf; `pre-push` prüft zusätzlich alle Commits im Push-Bereich. `--no-verify`
nur bei dokumentiertem Notfall.

## Sicherheitsfragen

Siehe `SECURITY.md`. Keine öffentlichen Issues für Sicherheitslücken.
