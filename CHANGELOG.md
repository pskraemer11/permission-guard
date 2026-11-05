# Changelog

Alle wichtigen Änderungen an diesem Projekt. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- **Urteilsdatei für Skill-Skripte (05.11.2026):** `skill-verdicts.mjs`
  verdichtet die SkillSpector-Berichte und die Prüfprotokolle zu
  `~/.agents/skill-reviews/verdicts.json`. Der Guard liest die Datei nur und
  vertraut einem Skript ausschließlich bei `decision: "trust"` und passendem
  SHA256; jede Änderung fällt auf `ask` zurück. Die statische Liste
  `TRUSTED_SKILL_DIRS` bleibt die Untergrenze. Neun Tests (530/530).
  `--reports` ist wiederholbar (späteres Verzeichnis gewinnt je Skill), jeder
  Eintrag nennt seinen Berichtslauf. Stand: zehn Skills, 78 Skripte, eine
  Freigabe (`nemo-retriever` nach Protokoll vom 25.10.), keine Abweichung.
  Neue Berichte vom 05.11. für `.system`, `prompt-engineering-patterns` und
  `python-project-bootstrap`; `.system` hat keine eigene `SKILL.md`, der
  Sammellauf endet deshalb mit Exitcode 1 bei gültigem Bericht (95,6 %
  Abdeckung, 12 Befunde).
- `PLANUNG.md`: Weg zum eigenständigen Repository (S0–S6) und die noch
  offenen MCP-Schritte D–G.

### Geändert

- **Globale MCP-Beobachtung (05.11.2026):** Der globale Plugin-Kontext
  (Basis = Benutzerprofil) registriert jetzt nur den MCP-Zweig. Shell-Regeln
  bleiben auf den Projektkontext beschränkt; `contextScope()` kapselt die
  Grenze, drei Tests decken Home, Projekt und ähnliche Namen ab. 521/521
  bestanden, deployt. `MCP_GATING_MODE` bleibt `"shadow"`.
- **S0 Sanitizing (05.11.2026):** Fixtures in `mcp-cases.jsonl` auf `team` und
  `lumen` umgestellt. Die Erwartungen (`want`, `layer`, `why`) blieben
  unverändert; `bench-mcp.mjs` meldet weiter 33/33.
- Alle Commits mit neutraler Identität neu geschrieben. Die vor dem 05.11.2026
  zitierten Hashes sind ungültig; die Sicherung liegt außerhalb des
  Repositories.
- Zwei lokale Notizen unter `docs/` per `.gitignore` ausgeschlossen. Sie
  bleiben auf der Platte und gehören nicht ins Repository.
