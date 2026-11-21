---
status: accepted
date: 2026-11-21
---

# Pytest-`tmp_path`-Workaround für die Codex-Windows-Sandbox

## Kontext

Pytest legt `tmp_path`- und Basetemp-Verzeichnisse mit `mode=0o700` an. In der
Codex-Windows-Sandbox kann der Sandboxprozess auf ein solches Verzeichnis
danach weder auflisten noch schreiben noch löschen (`PermissionError
[WinError 5]`). Das gilt für jedes Python-Repo in diesem Arbeitsbereich,
nicht nur für permission-guard.

## Entscheidung

Test-Temp-Verzeichnisse entstehen nicht mehr über Pytest, sondern über das
Repo: `tests/conftest.py` überschreibt `tmp_path` und legt pro Test einen
Ordner unter `tests/artifacts/` mit `Path.mkdir()` (ohne `mode`) an und
räumt mit `shutil.rmtree(..., ignore_errors=True)` auf. `tests/artifacts/`
ist in `.gitignore` aufgenommen. Kein `--basetemp`, kein `tmp_path`,
kein `tmp_path_factory.mktemp`, kein `tempfile.TemporaryDirectory` /
`tempfile.mkdtemp` (erzeugen intern ebenfalls `0o700`-Ordner).

## Konsequenzen

- Testartefakte liegen vorübergehend im Repo; vertretbar, weil
  `tests/artifacts/` ignoriert ist.
- `TemporaryDirectory` im Produktionscode bleibt davon unberührt.
- Das Muster ist im Skill `python-project-init` (Baseline und
  Template-`tests/conftest.py`) und in den `AGENTS.md` der
  `Python-Projekte`-Repos verankert.
