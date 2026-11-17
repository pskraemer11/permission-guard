#!/usr/bin/env sh
# Deployt permission-guard aus dem Projekt in die Laufzeitverzeichnisse.
#
# Quelle ist das Verzeichnis dieses Skripts. Ziele sind
# ${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/permission-guard und
# ~/.codex/hooks (ueberschreibbar mit PERMISSION_GUARD_CODEX_TARGET).
#
# Beide Ziele bleiben absichtlich schreibgeschuetzt (permission: ask): Kein
# Agent soll seine eigenen Regeln unbemerkt aendern koennen. Dieses Skript ist
# der einzige Weg dorthin und kostet genau eine Rueckfrage.
#
# Aufruf:
#   ./deploy.sh              Tests, kopieren, Hashes vergleichen
#   ./deploy.sh --check      nur vergleichen
#   SKIP_TESTS=1 ./deploy.sh nur kopieren (nur fuer Kommentaraenderungen)
#
# Gegenstueck fuer Windows: deploy.ps1
#
# Hinweis unter Windows: $HOME zeigt in Git Bash/MSYS auf /home/<name>, in WSL
# auf /home/<name> - nicht auf das Windows-Profil. Entweder deploy.ps1
# verwenden oder die Ziele explizit setzen:
#   Git Bash/MSYS: PERMISSION_GUARD_TARGET=/c/Users/<name>/.config/opencode/plugins/permission-guard
#                  PERMISSION_GUARD_CODEX_TARGET=/c/Users/<name>/.codex/hooks
#   WSL:           PERMISSION_GUARD_TARGET=/mnt/c/Users/<name>/.config/opencode/plugins/permission-guard
#                  PERMISSION_GUARD_CODEX_TARGET=/mnt/c/Users/<name>/.codex/hooks

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=${PERMISSION_GUARD_TARGET:-"${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/permission-guard"}
CODEX_TARGET=${PERMISSION_GUARD_CODEX_TARGET:-"$HOME/.codex/hooks"}

FILES="guard.js index.js audit.js diagnostics.js reviewer.js shadow.js git-shadow-report.mjs test.mjs README.md README_de.md start-reviewer.ps1 smoke-reviewer.mjs bench-reviewer.ps1 bench-quality.ps1 shared-cases.jsonl"
CODEX_FILES="codex_guard.py"
CONFIG_NAME="shell-reviewer.config.json"
CONFIG_EXAMPLE="shell-reviewer.config.example.json"

MODE="deploy"
case "${1:-}" in
  --check) MODE="check" ;;
  --help | -h)
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  "") ;;
  *)
    echo "Unbekannte Option: $1 (erlaubt: --check, --help)" >&2
    exit 2
    ;;
esac

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    echo "FEHLER: weder sha256sum noch shasum vorhanden" >&2
    exit 1
  fi
}

if [ "$MODE" = "deploy" ] && [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "== Tests =="
  if command -v node >/dev/null 2>&1; then
    node "$SCRIPT_DIR/test.mjs"
  else
    echo "FEHLER: node nicht gefunden" >&2
    exit 1
  fi
  if command -v python >/dev/null 2>&1; then
    python -m pytest "$SCRIPT_DIR/tests" -q
  else
    echo "FEHLER: python nicht gefunden" >&2
    exit 1
  fi
fi

copy_files() {
  for file in $1; do
    cp "$SCRIPT_DIR/$file" "$2/$file"
    echo "  $file"
  done
}

compare_files() {
  for file in $1; do
    if [ ! -f "$2/$file" ]; then
      printf '  %-22s FEHLT\n' "$file"
      mismatch=$((mismatch + 1))
      continue
    fi
    if [ "$(sha256 "$SCRIPT_DIR/$file")" = "$(sha256 "$2/$file")" ]; then
      printf '  %-22s identisch\n' "$file"
    else
      printf '  %-22s ABWEICHUNG\n' "$file"
      mismatch=$((mismatch + 1))
    fi
  done
}

if [ "$MODE" = "deploy" ]; then
  mkdir -p "$TARGET" "$CODEX_TARGET"
  echo
  echo "== Kopieren nach $TARGET =="
  copy_files "$FILES" "$TARGET"

  if [ ! -f "$TARGET/$CONFIG_NAME" ]; then
    cp "$SCRIPT_DIR/$CONFIG_EXAMPLE" "$TARGET/$CONFIG_NAME"
    echo "  $CONFIG_NAME (aus Vorlage erzeugt)"
  else
    echo "  $CONFIG_NAME bleibt erhalten (ortsspezifisch)"
  fi

  echo
  echo "== Kopieren nach $CODEX_TARGET =="
  copy_files "$CODEX_FILES" "$CODEX_TARGET"
fi

mismatch=0

echo
echo "== Vergleich (SHA256): OpenCode =="
echo "   Quelle: $SCRIPT_DIR"
echo "   Ziel:   $TARGET"
compare_files "$FILES" "$TARGET"

echo
echo "== Vergleich (SHA256): Codex =="
echo "   Quelle: $SCRIPT_DIR"
echo "   Ziel:   $CODEX_TARGET"
compare_files "$CODEX_FILES" "$CODEX_TARGET"

if [ "$mismatch" -gt 0 ]; then
  echo
  echo "FEHLER: $mismatch Datei(en) weichen ab." >&2
  exit 1
fi

if [ "$MODE" = "check" ]; then
  echo
  echo "Stand geprueft, nichts kopiert."
else
  echo
  echo "Deployt. OpenCode laedt das Plugin automatisch neu (Dateiwatcher)."
fi
