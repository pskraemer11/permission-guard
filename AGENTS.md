# AGENTS.md — permission-guard

Arbeitsregeln für Agenten in diesem Repository.

## Prüfen

```powershell
node test/test.mjs             # vollständige Suite, Exitcode 1 bei Abweichung
node test/test-wiring.mjs      # Fake-git: deny verhindert Ausführung
node test/bench-mcp.mjs        # 40 feste Fälle, 15 Verbote
python -m pytest tests -q # Codex-Guard, inkl. test/shared-cases.jsonl
python -m ruff check .    # Python-Lint
python -m pyright         # Python-Typprüfung
```

Alle sechs müssen grün sein, bevor committet wird. Für den Python-Teil vorher
einmalig `python -m pip install -r requirements-dev.txt`. Änderungen an
`src/reviewer.js` zusätzlich mit `node test/bench-model.mjs --repeat 3` gegen ein
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

## Tests – tmp_path-Workaround (Codex-Windows-Sandbox)

**Hintergrund.** Pytest legt `tmp_path`- und Basetemp-Verzeichnisse mit
`mode=0o700` an; die Codex-Sandbox kann danach nicht mehr darauf zugreifen. Das
ist ein Fehler der Sandbox, kein Projektfehler — gemeldet und dort noch offen.
Hier steht nur der Workaround, bis er entfällt. Vergleich und Begründung:
`CHANGELOG.md` im Nachbar-Repo `../codex-picker`, ADR
`docs/adr/0003-tmp-path-workaround-codex-sandbox.md`.

Die Fixture in `tests/conftest.py` überschreibt `tmp_path` deshalb:

1. Ein dauerhaft vorhandener Repo-Ordner dient als Artefakt-Root:
   `tests/artifacts/` (in `tests/conftest.py` angelegt).
2. `tests/artifacts/` ist in `.gitignore` aufgenommen.
3. Pro Test ein eigener Ordner unter `tests/artifacts/` mit `.mkdir()`
   (ohne `mode`).
4. Nach dem Test mit `shutil.rmtree(..., ignore_errors=True)` aufräumen.
5. Kein `--basetemp`-Flag verwenden.

Zu vermeiden (umgeht die Fixture und fällt auf `0o700` zurück):

- `tmp_path_factory.mktemp`
- `tempfile.TemporaryDirectory` / `tempfile.mkdtemp`

Neue Tests nehmen den `tmp_path`-Parameter; die Fixture greift automatisch.
Fällt der Workaround weg, werden die Tests unverändert wieder auf Pytests
eingebautes `tmp_path` laufen.
