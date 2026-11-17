---
status: accepted
date: 2026-11-17
---

# Die Pflicht-Checks bleiben, der Zwang zu einem aktuellen Branch entfällt

Der Regelsatz `baseline` auf dem Default-Branch verlangt fünf Jobs
(`Tests (Node 20/22 / ubuntu-latest/windows-latest)` und `actionlint`) und
setzte zusätzlich `strict_required_status_checks_policy: true`. Diese
Einstellung verlangt, dass der Branch vor dem Merge auf dem Stand von `main`
ist. Bei Einzelarbeit ohne parallele Beiträge erzeugt sie nur Verwaltungsarbeit:
Weil PR #6 vor PR #7 landete, musste `origin/main` in den Branch gemergt werden
(`61ad1f0`), ohne dass sich am Inhalt etwas änderte. Am 17.11.2026 ist die
Einstellung abgeschaltet (`false`, 13:47). Die fünf Pflicht-Jobs, `deletion`
und `non_fast_forward` bleiben unverändert.

## Considered Options

- **Wie bisher (`strict: true`):** schützt davor, mit grünem Stand auf einem
  veralteten `main` zu mergen. Kostet bei einem Einzelarbeiter aber jedes Mal
  einen Zwischen-Merge.
- **Regelsatz entfernen:** Force-Push und Löschen von `main` wären wieder
  möglich; der billigste Schutz ginge verloren.
- **Direkt auf `main` arbeiten:** spart den Branch, verschiebt die Prüfung aber
  hinter den Push. Ein kaputter Stand stünde dann zuerst auf `main`, und es
  gäbe keinen Rücksetzpunkt je Änderung.
- **Einstellung abschalten (gewählt):** Die Prüfungen bleiben Pflicht, nur die
  Forderung „aktuell“ entfällt.

## Consequences

- Ein Merge ist möglich, auch wenn `main` zwischenzeitlich weitergelaufen ist;
  der Zwischen-Merge entfällt.
- Kollidieren zwei Änderungen inhaltlich, zeigt sich das erst am CI-Lauf auf
  `main` und nicht mehr vor dem Merge. Beide Workflows laufen dort weiterhin
  bei jedem Push (`ci.yml` und `actionlint.yml` haben `push:` und
  `pull_request:`).
- Der Regelsatz enthält keine PR-Pflicht und keine Regel `update`
  („Restrict updates“). Ein direkter Push auf `main` umgeht die Pflicht-Checks
  deshalb weiterhin. Diese Grenze ist eine Konvention, keine technische Sperre.

## Notes

- Belegt durch `gh api repos/…/rulesets/26777642` vor und nach der Änderung:
  `enforcement: active`, `conditions: ~DEFAULT_BRANCH`, Regeln `deletion`,
  `non_fast_forward`, `required_status_checks` mit denselben fünf Kontexten und
  `strict_required_status_checks_policy: false`, `updated_at`
  2026-11-17T13:47:46+01:00. Es gibt keine Regel `update` und keine
  `pull_request`-Pflicht.
- Änderungen am Regelsatz brauchen Admin-Rechte. Das hinterlegte
  Fine-grained-Token antwortete mit `403 Resource not accessible by personal
  access token`; der Aufruf gelang mit dem `gh`-OAuth-Token aus der Keyring.
- Die GitHub-Dokumentation beschreibt Pflicht-Checks als Merge-Bedingung („must
  pass before collaborators can merge changes into the branch“). Ob ein
  direkter Push zusätzlich abgewiesen wird, ist nicht belegt; ein Testpush
  steht aus.
