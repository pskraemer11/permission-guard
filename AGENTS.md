# AGENTS.md — permission-guard

Arbeitsregeln für Agenten in diesem Repository.

## Prüfen

```powershell
node test.mjs        # vollständige Suite, Exitcode 1 bei Abweichung
node test-wiring.mjs # Fake-git: deny verhindert Ausführung
node bench-mcp.mjs   # 33 feste Fälle, 9 Verbote
```

Alle drei müssen grün sein, bevor committet wird. Änderungen an `reviewer.js`
zusätzlich mit `node bench-model.mjs --repeat 3` gegen ein laufendes Modell
messen.

## Deploy

Nur über `deploy.ps1` (Windows) oder `deploy.sh`. Das Skript prüft die Tests,
kopiert und vergleicht SHA256. Die Laufzeitkopie unter
`~/.config/opencode/plugin/permission-guard` ist schreibgeschützt; einzelne
Dateien werden nicht dorthin geschrieben.

## Regeln

- **Fail closed:** Unbekanntes bleibt `ask`; ein `deny` wird nie überschrieben.
- **Quelltext ist die Wahrheit:** Kommentare erklären das Warum und werden mit
  dem Code geändert.

## Historie

`CHANGELOG.md` sagt, *was* sich dateiweise geändert hat; `COMPACTIONS.md` sagt,
*warum*, mit Stand und nächstem Schritt. Beide nur anhängen.
