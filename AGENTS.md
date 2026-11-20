# AGENTS.md — permission-guard

Arbeitsregeln für Agenten in diesem Repository.

## Prüfen

```powershell
node test.mjs             # vollständige Suite, Exitcode 1 bei Abweichung
node test-wiring.mjs      # Fake-git: deny verhindert Ausführung
node bench-mcp.mjs        # 33 feste Fälle, 11 Verbote
python -m pytest tests -q # Codex-Guard, inkl. shared-cases.jsonl
python -m ruff check .    # Python-Lint
python -m pyright         # Python-Typprüfung
```

Alle sechs müssen grün sein, bevor committet wird. Für den Python-Teil vorher
einmalig `python -m pip install -r requirements-dev.txt`. Änderungen an
`reviewer.js` zusätzlich mit `node bench-model.mjs --repeat 3` gegen ein
laufendes Modell messen.

## Deploy

Nur über `deploy.ps1` (Windows) oder `deploy.sh`. Das Skript prüft die Tests,
kopiert und vergleicht SHA256. Es gibt zwei Ziele:
`~/.config/opencode/plugins/permission-guard` (OpenCode-Plugin) und
`~/.codex/hooks` (Codex-Guard). Beide Laufzeitkopien sind schreibgeschützt;
einzelne Dateien werden nicht dorthin geschrieben.

## Regeln

- **Fail closed:** Unbekanntes bleibt `ask`; ein `deny` wird nie überschrieben.
- **Quelltext ist die Wahrheit:** Kommentare erklären das Warum und werden mit
  dem Code geändert.

## Historie

`CHANGELOG.md` sagt, *was* sich dateiweise geändert hat; `COMPACTIONS.md` sagt,
*warum*, mit Stand und nächstem Schritt. Beide nur anhängen.
