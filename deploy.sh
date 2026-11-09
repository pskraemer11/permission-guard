#!/usr/bin/env sh
# Deployt permission-guard aus dem Projekt in das Laufzeitverzeichnis.
#
# Quelle ist das Verzeichnis dieses Skripts, Ziel ist
# ${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugin/permission-guard.
#
# Das Ziel bleibt absichtlich schreibgeschuetzt (permission: ask): Kein Agent
# soll seine eigenen Regeln unbemerkt aendern koennen. Dieses Skript ist der
# einzige Weg dorthin und kostet genau eine Rueckfrage.
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
# verwenden oder das Ziel explizit setzen:
#   Git Bash/MSYS: PERMISSION_GUARD_TARGET=/c/Users/<name>/.config/opencode/plugin/permission-guard
#   WSL:           PERMISSION_GUARD_TARGET=/mnt/c/Users/<name>/.config/opencode/plugin/permission-guard

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=${PERMISSION_GUARD_TARGET:-"${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugin/permission-guard"}

FILES="guard.js index.js reviewer.js shadow.js git-shadow-report.mjs test.mjs README.md start-reviewer.ps1 smoke-reviewer.mjs bench-reviewer.ps1 bench-quality.ps1"
CONFIG_NAME="shell-reviewer.config.json"
CONFIG_EXAMPLE="shell-reviewer.config.example.json"

MODE="deploy"
case "${1:-}" in
  --check) MODE="check" ;;
  --help | -h)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
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
fi

if [ "$MODE" = "deploy" ]; then
  mkdir -p "$TARGET"
  echo
  echo "== Kopieren nach $TARGET =="
  for file in $FILES; do
    cp "$SCRIPT_DIR/$file" "$TARGET/$file"
    echo "  $file"
  done

  if [ ! -f "$TARGET/$CONFIG_NAME" ]; then
    cp "$SCRIPT_DIR/$CONFIG_EXAMPLE" "$TARGET/$CONFIG_NAME"
    echo "  $CONFIG_NAME (aus Vorlage erzeugt)"
  else
    echo "  $CONFIG_NAME bleibt erhalten (ortsspezifisch)"
  fi
fi

echo
echo "== Vergleich (SHA256) =="
echo "   Quelle: $SCRIPT_DIR"
echo "   Ziel:   $TARGET"
mismatch=0
for file in $FILES; do
  if [ ! -f "$TARGET/$file" ]; then
    printf '  %-22s FEHLT\n' "$file"
    mismatch=$((mismatch + 1))
    continue
  fi
  if [ "$(sha256 "$SCRIPT_DIR/$file")" = "$(sha256 "$TARGET/$file")" ]; then
    printf '  %-22s identisch\n' "$file"
  else
    printf '  %-22s ABWEICHUNG\n' "$file"
    mismatch=$((mismatch + 1))
  fi
done

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
