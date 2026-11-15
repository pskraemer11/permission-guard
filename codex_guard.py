"""Codex-Hook: lehnt destruktive Kommandos ab, bevor sie laufen.

Warum ein Hook und keine Regel: Codex-Prefix-Regeln vergleichen Argumente exakt.
Eine Zeile wie ``pwsh -Command "git push"`` traf deshalb keine ``forbidden``-Regel.
Ein ``PreToolUse``-Hook sieht den Befehlstext und kann ihn ablehnen.

Warum überhaupt: Die Sandbox schützt das Arbeitsverzeichnis nicht. Mit
``workspace-write`` sind Löschen und Überschreiben darin erlaubt; schreibgeschützt
sind nur ``.git``, ``.codex``, ``.agents`` und ``.aws``. Die gefährlichen Eingriffe
liegen also innerhalb, wo keine Regel greift.

Geprüft werden vier Kategorien:

1. ``git push`` in jeder Form, auch durch eine Shell umhüllt.
2. Git-Kommandos, die Arbeit oder Geschichte vernichten.
3. ``--no-verify``, das projektweit nur mit ausdrücklicher Freigabe erlaubt ist.
4. Massenlöschung, außer unter ``cache/``, ``staging/``, ``tmp/`` und ``temp/``.

Grenze: Der Guard liest Text, er führt nichts aus. ``apply_patch``-Löschungen,
``Start-Process``, ``xargs``, fremde Skripte und Aliase bleiben unsichtbar. Fehler
im Hook sind fail-open: Startet das Skript nicht, führt Codex den Befehl aus.

Aufruf durch Codex (stdin: Hook-JSON, stdout: Entscheidung):

    python ~/.codex/hooks/codex_guard.py
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Iterable

SEPARATORS = re.compile(r"&&|\|\||[;|\n\r]")
LEADING = re.compile(r"^[\s&{}()\[\]]+")
SHELLS = {"pwsh", "pwsh.exe", "powershell", "powershell.exe", "bash", "bash.exe", "sh", "cmd", "cmd.exe"}
CMD_FLAGS = {"/c", "/k", "/s"}
GIT = re.compile(r"^git(\.exe)?$", re.IGNORECASE)
GIT_FLAGS_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--exec-path", "--namespace"}
GIT_FLAGS_PLAIN = {"--no-pager", "-P", "-p", "--paginate", "--bare", "--literal-pathspecs"}
GIT_DESTRUCTIVE = {"filter-branch", "filter-repo"}
DELETE_COMMANDS = {"remove-item", "rm", "ri", "del", "erase", "rd", "rmdir"}
RECURSIVE_FLAGS = {"-r", "-rf", "-fr", "-recurse", "--recursive"}
SHELL_RECURSIVE = "/s"
# apply_patch: Loeschen in geschuetzten Pfaden und Massenloeschung.
DELETE_PATTERN = re.compile(r"^\*\*\* Delete File:\s*(.+?)\s*$", re.MULTILINE)
PROTECTED_PATH_PARTS = {".git", ".codex", ".githooks"}
PROTECTED_FILES = {"agents.md"}
MAX_PATCH_DELETIONS = 5
# Loeschen ist nur unter diesen Pfadbestandteilen erlaubt.
ALLOWED_DELETE_PARTS = {"cache", "staging", "tmp", "temp"}

REASON_PUSH = "Remote-Pushes bleiben beim Nutzer. Der Push wurde von einem Hook blockiert."
REASON_HISTORY = "Das Kommando verwirft Arbeit oder Geschichte. Bitte vom Nutzer ausführen lassen."
REASON_NO_VERIFY = "--no-verify umgeht die Projekt-Gates. Nur mit ausdrücklicher Freigabe im Auftrag."
REASON_DELETE = (
    "Massenlöschung außerhalb von cache/, staging/, tmp/ oder temp/. Ziel und Umfang prüfen,"
    " dann vom Nutzer ausführen lassen."
)
REASON_MIRROR = "robocopy /MIR löscht am Ziel alles, was in der Quelle fehlt."
REASON_PATCH_PROTECTED = (
    "Der Patch löscht eine Datei in einem geschützten Pfad (.git, .codex, .githooks"
    " oder eine AGENTS.md). Bitte vom Nutzer ausführen lassen."
)
REASON_PATCH_BULK = (
    f"Der Patch löscht mehr als {MAX_PATCH_DELETIONS} Dateien. Umfang prüfen, dann vom Nutzer ausführen lassen."
)


def clean(token: str) -> str:
    """Entfernt Anfuehrungs- und Klammerzeichen an den Raendern."""
    return token.strip().strip("\"'`{}()[]")


def tokens(segment: str) -> list[str]:
    """Zerlegt ein Segment in bereinigte Tokens."""
    return [clean(part) for part in re.split(r"\s+", segment.strip()) if part.strip()]


def inner_text(parts: list[str]) -> str:
    """Bildet den Befehlsrest einer Shell-Umhuellung ohne deren Schalter.

    Nur die Schalter *vor* dem eigentlichen Kommando gehoeren zur Umhuellung.
    Alles danach bleibt stehen, sonst verliert der innere Befehl seine eigenen
    Optionen (etwa ``Remove-Item -Recurse``).
    """
    rest = list(parts[1:])
    while rest and (rest[0].startswith("-") or rest[0].lower() in CMD_FLAGS):
        rest.pop(0)
    return " ".join(rest)


def git_subcommand(parts: Iterable[str]) -> tuple[str, list[str]] | None:
    """Liefert (Unterkommando, Rest) fuer eine git-Tokenfolge."""
    rest = list(parts)
    while rest and (rest[0] == "&" or "=" in rest[0] and not rest[0].startswith("-")):
        rest.pop(0)
    if not rest or not GIT.match(rest[0]):
        return None
    index = 1
    while index < len(rest):
        token = rest[index]
        if token in GIT_FLAGS_WITH_VALUE:
            index += 2
            continue
        if token in GIT_FLAGS_PLAIN:
            index += 1
            continue
        return token, rest[index + 1 :]
    return None


def is_push(parts: list[str]) -> bool:
    """Prueft, ob die Tokenfolge ein git-push-Kommando ergibt."""
    found = git_subcommand(parts)
    return found is not None and found[0] == "push"


def is_history_loss(parts: list[str]) -> bool:
    """Prueft, ob die Tokenfolge Arbeit oder Geschichte verwirft."""
    found = git_subcommand(parts)
    if found is None:
        return False
    sub, rest = found
    if sub in GIT_DESTRUCTIVE:
        return True
    if sub == "reset" and "--hard" in rest:
        return True
    if sub in {"checkout", "restore"} and any(token in {".", ":."} for token in rest):
        return True
    if sub == "clean":
        return any(token.startswith("-") and "f" in token.lower() for token in rest)
    return False


def is_allowed_delete_target(token: str) -> bool:
    """Meldet, ob ein Loeschziel unter cache/, staging/, tmp/ oder temp/ liegt."""
    normalized = token.replace("\\", "/").strip().lower()
    parts = [part for part in normalized.split("/") if part not in ("", ".")]
    return bool(parts) and any(part in ALLOWED_DELETE_PARTS for part in parts)


def is_robocopy_mirror(parts: list[str]) -> bool:
    """Prueft, ob robocopy im Spiegelmodus laeuft (loescht am Ziele)."""
    if not parts or parts[0].lower().removesuffix(".exe") != "robocopy":
        return False
    return any(token.lower().lstrip("/-") == "mir" for token in parts[1:])


def is_mass_deletion(parts: list[str]) -> bool:
    """Prueft, ob rekursiv geloescht wird, ohne erlaubtes Ziel."""
    if not parts:
        return False
    name = parts[0].lower().removesuffix(".exe")
    if name not in DELETE_COMMANDS:
        return False
    flags = {part.lower() for part in parts[1:]}
    recursive = bool(flags & RECURSIVE_FLAGS) or SHELL_RECURSIVE in flags
    if not recursive:
        return False
    targets = [part for part in parts[1:] if not part.startswith("-") and not part.startswith("/")]
    if not targets:
        return True
    return not all(is_allowed_delete_target(target) for target in targets)


def segment_reason(parts: list[str]) -> str | None:
    """Wendet alle Regeln auf ein Segment an."""
    found = git_subcommand(parts)
    if found is not None and "--no-verify" in parts:
        return REASON_NO_VERIFY
    if is_push(parts):
        return REASON_PUSH
    if is_history_loss(parts):
        return REASON_HISTORY
    if is_robocopy_mirror(parts):
        return REASON_MIRROR
    if is_mass_deletion(parts):
        return REASON_DELETE
    return None


def first_reason(command: str, depth: int = 0) -> str | None:
    """Liefert den ersten Ablehnungsgrund eines Befehlstexts."""
    if not command.strip():
        return None
    for raw in SEPARATORS.split(command):
        parts = tokens(LEADING.sub("", raw))
        if not parts:
            continue
        reason = segment_reason(parts)
        if reason is not None:
            return reason
        if depth < 3 and parts[0].lower() in SHELLS:
            nested = first_reason(inner_text(parts), depth + 1)
            if nested is not None:
                return nested
    return None


def normalize_path(value: str) -> str:
    """Vereinheitlicht einen Pfad fuer den lexikalischen Vergleich."""
    path = value.replace("\\", "/").strip().strip("\"'`")
    while path.startswith("./"):
        path = path[2:]
    return path.lower()


def is_protected_path(path: str) -> bool:
    """Meldet, ob ein Pfad in einem geschuetzten Bereich liegt."""
    parts = [part for part in normalize_path(path).split("/") if part not in ("", ".")]
    if not parts:
        return False
    if any(part in PROTECTED_PATH_PARTS for part in parts):
        return True
    return parts[-1] in PROTECTED_FILES


def patch_reason(patch: str) -> str | None:
    """Prueft einen apply_patch-Text auf geschuetzte oder massenhafte Loeschungen."""
    deleted = [match.strip() for match in DELETE_PATTERN.findall(patch)]
    if not deleted:
        return None
    if any(is_protected_path(path) for path in deleted):
        return REASON_PATCH_PROTECTED
    if len(deleted) > MAX_PATCH_DELETIONS:
        return REASON_PATCH_BULK
    return None


def decide(payload: dict[str, object]) -> dict[str, object] | None:
    """Liefert die Ablehnung fuer ein Hook-Ereignis oder ``None``."""
    tool_name = payload.get("tool_name")
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return None
    command = tool_input.get("command")
    if not isinstance(command, str):
        return None
    if tool_name == "Bash":
        reason = first_reason(command)
    elif tool_name == "apply_patch":
        reason = patch_reason(command)
    else:
        return None
    if reason is None:
        return None
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def main() -> int:
    """Liest das Hook-JSON und schreibt gegebenenfalls die Ablehnung."""
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    if not isinstance(payload, dict):
        return 0
    decision = decide(payload)
    if decision is not None:
        print(json.dumps(decision))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
