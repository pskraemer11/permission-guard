# Compactions — permission-guard

Sitzungshistorie dieses Repositories: warum etwas entschieden wurde, was gilt
und was als Nächstes ansteht. Die Datei wächst nur durch Anhängen. Was sich
dateiweise geändert hat, steht in `CHANGELOG.md`.

================ Compaction 05.11.2026 / 15:05 ================
## Objective
- **Current:** Audit, Auswertung und ein Entscheidungsmodell als Ebene 3/1.
- **Completed:** D0 belegt, D und F gebaut, Prompt gemessen, Clef-Flash integriert.

## Important Details
- **D0 (Fall B):** `permission.evaluate` feuert mit `action` und `metadata.input`; `source.id` gleicht `execute.after.id`, gilt aber je `execute`-Block (zwei Aufrufe, dieselbe ID); `execute.after` feuert für jedes MCP-Werkzeug und zusätzlich für `execute`. Korrelation deshalb über Sitzung + Werkzeug + Argument-Hash.
- **D:** `audit.js` schreibt je Aufruf `decision` + `result` als Hash-Kette, Rotation bei 5 MB, `verify-audit.mjs` prüft beide Generationen. Keine Argumentwerte; `p` wird mitgespeichert.
- **F:** `mcp-report.mjs` zählt nach Werkzeug, Absicht, Entscheidung, Schicht, Modus; Matrix Effekt→Urteil; Kriterienstand (7 Tage/50 Aufrufe/3 Werkzeuge, davon 1 schreibend) am Ende.
- **Reproduzierbarkeit:** `temperature 0` schaltet nur die Sampling-Zufälligkeit ab. Derselbe Prompt lieferte je nach Prompt-Cache 10/14 und 12/14; mit `seed: 42` und `cache_prompt: false` dreimal 12/14. Messreihen laufen deshalb `deterministic`.
- **Prompt:** kompakt 12/14, Rollen- und Felderklärung 8/14 (Modell flüchtet in „Nein"), eine Kontextzeile 11/14. Ein Wort („mit") kippte 12/14 auf 11/14 und das Gate 3/3 auf 2/3 — Formulierung ist fixiert.
- **Entscheidungsmodelle:** `/v1/systemone` existiert lokal. Laya (421M) trennt nicht (8/14, p 0,09–0,60). Clef-Flash (9B, Q4_K_M, 6,3 GB) trennt MCP (Rückfrage ≤ 0,458, Freigabe ≥ 0,884) und Shell (0,02–0,06 gegen 0,94–0,97) sauber; Schwelle 0,7, 75 ms. Modellkarte: `https://huggingface.co/Cloudflare/clef-flash`.
- **Bonsai-Modelle:** Reasoning-Modelle; bei `max_tokens: 8` geht das Budget für `reasoning_content` drauf, `content` bleibt leer. Mit 64 Tokens antworten sie sauber. Abschaltbar über die Reasoning-Option, für den Guard aber nicht attraktiv.
- **Entscheidungen:** npm GitHub-only (`private: true`); F-Kriterien 7 Tage/50/3 inkl. schreibend; dritte Antwort „Unbestimmt" eingebaut, aber standardmäßig aus (11/14).

## Work State
- **Completed:** D0, D, F, Prompt, systemone für MCP und Shell, Doku, Deploy.
- **Active:** nichts.
- **Blocked:** Umstellung der Laufzeitkonfiguration auf Clef wartet auf Nutzerentscheid; kein Push.

## Next Move
1. Die 14 Shell-Fälle als `shell-cases.jsonl` festschreiben und in ein `bench-shell` aufnehmen, damit die Zahlen reproduzierbar bleiben.
2. Nach Nutzerentscheid: `baseUrl`/`model` auf Clef, `mcpBackend` und `shellBackend` auf `systemone`; 24 h Schatten beobachten.
3. S1–S4 im Sub-Repo, CI grün vor dem ersten Push; Aktivierung erst nach den F-Kriterien.

## Relevant Files
- `audit.js`, `verify-audit.mjs`: Kette und Prüfer.
- `mcp-report.mjs`: Auswertung und Kriterienstand.
- `reviewer.js`: Prompt, `systemone`, Schwellen.
- `bench-model.mjs`, `mcp-model-cases.jsonl`: Messreihe.
- `PLANUNG.md`: Entscheidungen und Messungen.

## Important Context
- **Produktion unverändert:** `mcpBackend`/`shellBackend` sind `chat`; Clef läuft nur während der Messung auf Port 8082.
- **Kein Push:** das Repository bleibt beim Nutzer.
- **Teststand:** 573/573, Deploy byte-identisch.
- **Nachbar-Repo:** Die Hooks und die Urteilsdatei für Skills liegen in `~/.agents`; deren Änderungen gehören in dieses Repository, nicht hierher.
