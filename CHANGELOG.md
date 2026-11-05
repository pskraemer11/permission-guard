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
- **Betriebsarten der Urteilsdatei (05.11.2026):** `skill-verdicts.mjs` kennt
  jetzt `--refresh` (Hashes und Entscheidungen fortschreiben, ohne Berichte)
  und `--verify` (Abgleich, Exitcode 1 bei Abweichung). Der `pre-commit` im
  Skill-Repo ruft `--refresh` auf, sobald Skill-Dateien gestaged sind, und
  stagt die Datei mit; die CI ruft `--verify`. Beide kommen ohne Scanner,
  Netz und Schlüssel aus. Der Hook blockiert nicht versionierte Python-Dateien
  unter `skills/` und unvollständig gestagte Python-Änderungen, weil die Datei
  sonst einen Stand beschriebe, der nicht im Commit ist. Acht Hook-Fälle und
  neun Werkzeugfälle in einem temporären Repo geprüft.
- **Eine Freigabequelle (05.11.2026):** `TRUSTED_SKILL_DIRS` ist entfallen.
  Skills gelten nur noch über `verdicts.json` als lesbar; ohne passenden
  Hash bleibt jedes Skript Rückfrage. Grund: die Namensliste hätte eine
  Freigabe auch dann gehalten, wenn das Prüfprotokoll zu `ask` kommt.
- **Drei Prüfprotokolle (05.11.2026):** `markdown-table-formatting` (TRUST,
  Scanner-71 stammt nur aus einem inzwischen entfernten `__pycache__`),
  `monthly-price-benchmark-workbook` (TRUST, Skript liest nur und schreibt den
  Bericht) und `gemma-dev` (ASK: Modell-Download, lokaler Webserver, Vertex AI
  mit Cloud-Anmeldedaten). Stand: 3 `trust`, 7 `ask`.
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
