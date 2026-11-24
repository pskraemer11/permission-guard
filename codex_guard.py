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
4. Massenlöschung, außer unter ``cache/``, ``staging/``, ``tmp/`` und ``temp/``
   im Projektordner sowie im tatsächlichen System-Temp. Maßgeblich ist der
   aufgelöste Pfad; ``..`` im Ziel und relative Ziele in einer Kette oder
   Shell-Hülle werden abgelehnt.

Grenze: Der Guard liest Text, er führt nichts aus. ``apply_patch``-Löschungen,
``Start-Process``, ``xargs``, fremde Skripte und Aliase bleiben unsichtbar. Ein
Symlink-Rennen kann den aufgelösten Pfad verändern, nachdem er geprüft wurde.
Fehler *im* Hook sind fail-closed (23.11.2026): Unlesbare Eingabe und innere
Ausnahmen ergeben ein ``deny`` statt stiller Freigabe. Startet das Skript
selbst nicht, entscheidet der Host Codex - darauf hat der Hook keinen
Einfluss; der Deploy prüft den Start per Smoke-Test.

Aufruf durch Codex (stdin: Hook-JSON, stdout: Entscheidung):

    python ~/.codex/hooks/codex_guard.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from collections.abc import Iterable
from pathlib import Path

LEADING = re.compile(r"^[\s&{}()\[\]]+")
SHELLS = {"pwsh", "pwsh.exe", "powershell", "powershell.exe", "bash", "bash.exe", "sh", "cmd", "cmd.exe"}
CMD_FLAGS = {"/c", "/k", "/s"}
GIT = re.compile(r"^git(\.exe)?$", re.IGNORECASE)
GIT_FLAGS_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--exec-path", "--namespace"}
GIT_FLAGS_PLAIN = {"--no-pager", "-P", "-p", "--paginate", "--bare", "--literal-pathspecs"}
GIT_DESTRUCTIVE = {"filter-branch", "filter-repo"}
# Kurzoptionen von `git commit`, die ein Argument aufnehmen: der Rest des
# Tokens ist dann das Argument, kein weiterer Schalter (`-mn` = `-m "n"`).
COMMIT_FLAGS_WITH_VALUE = "mFCctSu"
DELETE_COMMANDS = {"remove-item", "rm", "ri", "del", "erase", "rd", "rmdir"}
RECURSIVE_FLAGS = {"-r", "-rf", "-fr", "-recurse", "--recursive"}
SHELL_RECURSIVE = "/s"
# apply_patch: Loeschen in geschuetzten Pfaden und Massenloeschung.
DELETE_PATTERN = re.compile(r"^\*\*\* Delete File:\s*(.+?)\s*$", re.MULTILINE)
PROTECTED_PATH_PARTS = {".git", ".codex", ".githooks"}
PROTECTED_FILES = {"agents.md"}
MAX_PATCH_DELETIONS = 5
# Loeschen ist nur unter diesen Ordnern des Projektordners erlaubt.
ALLOWED_DELETE_PARTS = {"cache", "staging", "tmp", "temp"}
# Ein Schalter der Windows-Shell (/s, /q) ist kein Pfad. Erst ab drei Zeichen
# gilt ein /-Wort als Pfad, damit /etc nicht als Schalter verschwindet.
PATH_FLAG = re.compile(r"^/[a-z]{1,2}$", re.IGNORECASE)

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
REASON_HOOK_ERROR = (
    "Der Hook konnte die Anfrage nicht auswerten (Fehler im Hook). "
    "Fail-closed: Bitte vom Nutzer prüfen und ausführen lassen."
)


def clean(token: str) -> str:
    """Entfernt Anfuehrungs- und Klammerzeichen an den Raendern."""
    return token.strip().strip("\"'`{}()[]")


def split_segments(command: str) -> list[str]:
    """Zerlegt einen Befehlstext in Segmente.

    Getrennt wird an ``;``, ``|``, ``||``, ``&&``, Zeilenenden und einem
    einzelnen ``&`` (Review 17.11.2026). Ein ``&`` in Zitaten oder in einer
    Stream-Umleitung (``2>&1``) bleibt Text. Frueher galt ``echo ok & git push``
    als ein Segment und kam deshalb ungeprueft durch.
    """
    segments: list[str] = []
    current: list[str] = []
    quote: str | None = None
    index = 0
    while index < len(command):
        char = command[index]
        if quote is not None:
            current.append(char)
            if char == quote:
                quote = None
            index += 1
            continue
        if char in "\"'":
            quote = char
            current.append(char)
            index += 1
            continue
        if char == "&":
            following = command[index + 1] if index + 1 < len(command) else ""
            previous = command[index - 1] if index > 0 else ""
            if following == "&":
                segments.append("".join(current))
                current = []
                index += 2
                continue
            if previous in (">", "<"):
                current.append(char)
                index += 1
                continue
            segments.append("".join(current))
            current = []
            index += 1
            continue
        if char in ";|\n\r":
            segments.append("".join(current))
            current = []
            index += 1
            continue
        current.append(char)
        index += 1
    segments.append("".join(current))
    return segments


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


GIT_FLAGS_WITH_VALUE_PREFIXES = tuple(f"{name}=" for name in GIT_FLAGS_WITH_VALUE if name.startswith("--"))


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
        # Angehängte Formen: "-C<wert>", "-c<wert>" und "--git-dir=<wert>".
        if token.startswith(("-C", "-c")) and token not in {"-C", "-c"} and len(token) > 2:
            index += 1
            continue
        if token.startswith(GIT_FLAGS_WITH_VALUE_PREFIXES):
            index += 1
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
    if sub == "branch":
        # `-D` und `--delete --force` loeschen einen Branch ohne Pruefung;
        # `-d` allein bleibt erlaubt (OpenCode fragt dort nach).
        lowered = [token.lower() for token in rest]
        force_delete = any(token.startswith("-D") for token in rest)
        delete = "--delete" in lowered or any(token.startswith("-d") or token.startswith("-D") for token in rest)
        force = "--force" in lowered or any(
            token.startswith("-") and not token.startswith("--") and "f" in token for token in rest
        )
        return force_delete or (delete and force)
    return False


def commit_no_verify_short(rest: list[str]) -> bool:
    """Erkennt ``git commit -n`` und Buendel wie ``-an``; ``-mn`` ist eine Nachricht."""
    for token in rest:
        if not token.startswith("-") or token.startswith("--"):
            continue
        for char in token[1:]:
            if char == "n":
                return True
            if char in COMMIT_FLAGS_WITH_VALUE:
                break
    return False


def is_allowed_delete_target(token: str, roots: list[Path], root: Path | None, relative_ok: bool) -> bool:
    """Meldet, ob ein Loeschziel unter einer freigegebenen Wurzel liegt.

    Geprueft wird der aufgeloeste Pfad gegen die freigegebenen Wurzeln. ``..``
    im Ziel und relative Ziele ohne eindeutigen Arbeitsordner werden abgelehnt
    (Review 17.11.2026). Unter POSIX ist der Backslash ein Namensbestandteil:
    Existiert das wortwoertliche Ziel, gilt es; sonst gilt die Windows-Lesart.
    """
    raw = token.strip().strip("\"'`")
    if not raw:
        return False
    parts = [part for part in raw.replace("\\", "/").split("/") if part not in ("", ".")]
    if not parts or ".." in parts:
        return False
    path = Path(raw)
    if "\\" in raw and os.name != "nt":
        try:
            base = root.resolve() if root is not None else None
        except OSError:
            base = None
        literal = path if path.is_absolute() else (base / path if base is not None else None)
        if literal is None or not (literal.exists() or literal.is_symlink()):
            path = Path(raw.replace("\\", "/"))
    if not path.is_absolute():
        if not relative_ok or root is None:
            return False
        path = root / path
    try:
        resolved = path.resolve()
    except OSError:
        return False
    return any(resolved == base or resolved.is_relative_to(base) for base in roots)


def delete_roots(root: Path | None) -> list[Path]:
    """Freigegebene Wurzeln fuer rekursives Loeschen.

    Nur die vier freigegebenen Unterordner des Projektordners und das
    tatsaechliche System-Temp. Frueher genuegte ein Pfadbestandteil wie
    ``staging`` irgendwo im Ziel. Der Projektordner wird aufgeloest, damit der
    Vergleich auch dann greift, wenn der Aufrufer einen relativen Pfad uebergibt.
    """
    roots: list[Path] = []
    if root is not None:
        try:
            base = root.resolve()
        except OSError:
            base = None
        if base is not None:
            roots.extend(base / name for name in sorted(ALLOWED_DELETE_PARTS))
    try:
        roots.append(Path(tempfile.gettempdir()).resolve())
    except OSError:
        pass
    return roots


def is_robocopy_mirror(parts: list[str]) -> bool:
    """Prueft, ob robocopy im Spiegelmodus laeuft (loescht am Ziele)."""
    if not parts or parts[0].lower().removesuffix(".exe") != "robocopy":
        return False
    return any(token.lower().lstrip("/-") == "mir" for token in parts[1:])


def is_recursive_token(token: str) -> bool:
    """Prueft ein Schaltertoken auf Rekursion.

    Gebuendelte POSIX-Kurzflags ("-rfv", "-rfd"), exakte Langformen und
    eindeutige PowerShell-Abkuerzungen ("-Rec" ist nur Praefix von
    "-Recurse"). Ein angehaengter Wert ("-Recurse:$true") gehoert nicht zum
    Schaltnamen. "-Force" ist kein Rekursionsschalter und bleibt aussen vor.
    """
    lower = token.lower()
    name = lower.split(":", 1)[0].split("=", 1)[0]
    if name in RECURSIVE_FLAGS:
        return True
    if name.startswith("--") or not name.startswith("-"):
        return False
    stripped = name[1:]
    if "recurse".startswith(stripped):
        return True
    # Gueltige Kurzbuendel beliebiger Laenge ("-rffvd", "-rdf", "-irf"):
    # jedes Zeichen muss ein bekannter POSIX-Schalter sein; "i"/"I"
    # (interaktiv) gehoert dazu. Ein unbekannter Buchstabe im Buendel
    # bleibt fail closed (deny weiter unten in decide).
    return stripped.isalpha() and "r" in stripped and all(char in "rfvqdIi" for char in stripped)


def has_unknown_recursive_bundle(parts: list[str]) -> bool:
    """Meldet ein Kurzbuendel mit Rekursion, das nicht vollstaendig bekannt ist.

    Gilt nur fuer die POSIX-artigen Loeschbefehle (rm/ri/rmdir/rd/del/erase):
    bei Remove-Item (PowerShell) wuerde ein langes Parameternwort wie
    -Force sonst als unbekanntes Buendel gelesen.
    """
    if not parts:
        return False
    name = parts[0].lower().removesuffix(".exe")
    if name not in {"rm", "ri", "rmdir", "rd", "del", "erase"}:
        return False
    for token in parts[1:]:
        flag = token.lower().split(":", 1)[0].split("=", 1)[0]
        if flag.startswith("--") or not flag.startswith("-"):
            continue
        stripped = flag[1:]
        if not stripped or stripped == "r":
            continue
        if "recurse".startswith(stripped):
            continue
        if stripped.isalpha() and "r" in stripped and not all(char in "rfvqdIi" for char in stripped):
            return True
    return False


def is_mass_deletion(parts: list[str], root: Path | None, relative_ok: bool) -> bool:
    """Prueft, ob rekursiv geloescht wird, ohne freigegebenes Ziel."""
    if not parts:
        return False
    name = parts[0].lower().removesuffix(".exe")
    if name not in DELETE_COMMANDS:
        return False
    flags = {part.lower() for part in parts[1:]}
    recursive = any(is_recursive_token(part) for part in parts[1:]) or SHELL_RECURSIVE in flags
    if not recursive:
        return False
    # Schalter der Windows-Shell (/s, /q) sind keine Ziele; ein absolutes
    # POSIX-Ziel wie /etc dagegen schon (Review 17.11.2026).
    raw_targets = [part for part in parts[1:] if not part.startswith("-") and not PATH_FLAG.match(part)]
    # Array-Ziele ("staging/x,src") sind mehrere Ziele in einem Token.
    targets = [piece for part in raw_targets for piece in part.split(",") if piece.strip()]
    if not targets:
        return True
    roots = delete_roots(root)
    return not all(is_allowed_delete_target(target, roots, root, relative_ok) for target in targets)


def segment_reason(parts: list[str], root: Path | None, relative_ok: bool) -> str | None:
    """Wendet alle Regeln auf ein Segment an."""
    found = git_subcommand(parts)
    if found is not None:
        sub, rest = found
        # `git commit -n` ist die Kurzform von `--no-verify`; bei anderen
        # Unterbefehlen bedeutet `-n` etwas anderes (clean und push: --dry-run).
        if "--no-verify" in parts or (sub.lower() == "commit" and commit_no_verify_short(rest)):
            return REASON_NO_VERIFY
    if is_push(parts):
        return REASON_PUSH
    if is_history_loss(parts):
        return REASON_HISTORY
    if is_robocopy_mirror(parts):
        return REASON_MIRROR
    if is_mass_deletion(parts, root, relative_ok) or has_unknown_recursive_bundle(parts):
        return REASON_DELETE
    return None


def first_reason(command: str, depth: int = 0, root: Path | None = None) -> str | None:
    """Liefert den ersten Ablehnungsgrund eines Befehlstexts."""
    if not command.strip():
        return None
    if root is None:
        try:
            root = Path.cwd().resolve()
        except OSError:
            root = None
    segments = [segment for segment in split_segments(command) if segment.strip()]
    # Ein relativer Loeschpfad ist nur in einem einzelnen, nicht umhuellten
    # Befehl eindeutig: in einer Kette oder Shell-Huelle ist der Arbeitsordner
    # nicht der Projektordner (Review 17.11.2026).
    relative_ok = depth == 0 and len(segments) == 1
    for raw in segments:
        parts = tokens(LEADING.sub("", raw))
        if not parts:
            continue
        reason = segment_reason(parts, root, relative_ok)
        if reason is not None:
            return reason
        if depth < 3 and parts[0].lower() in SHELLS:
            nested = first_reason(inner_text(parts), depth + 1, root)
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


def hook_root(payload: dict[str, object]) -> Path | None:
    """Projektordner fuer relative Pfade.

    Codex liefert bei lokalen ``exec_command``-Aufrufen den Ausfuehrungsordner
    im Hook-Eingang; fehlt er, gilt der Ordner des Hook-Prozesses. Unbekannt
    bleibt unbekannt - dann werden relative Loeschziele abgelehnt.
    """
    for container in (payload.get("tool_input"), payload):
        if not isinstance(container, dict):
            continue
        for key in ("cwd", "workdir", "working_directory"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                try:
                    return Path(value).resolve()
                except OSError:
                    return None
    try:
        return Path.cwd().resolve()
    except OSError:
        return None


def deny_decision(reason: str) -> dict[str, object]:
    """Baut die Ablehnungsantwort im Codex-Hook-Format."""
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def decide(payload: dict[str, object]) -> dict[str, object] | None:
    """Liefert die Ablehnung fuer ein Hook-Ereignis oder ``None``."""
    tool_name = payload.get("tool_name")
    tool_input = payload.get("tool_input")
    if tool_name not in ("Bash", "apply_patch"):
        return None
    if not isinstance(tool_input, dict):
        return deny_decision(REASON_HOOK_ERROR)
    command = tool_input.get("command")
    if not isinstance(command, str):
        return deny_decision(REASON_HOOK_ERROR)
    if tool_name == "Bash":
        reason = first_reason(command, root=hook_root(payload))
    elif tool_name == "apply_patch":
        reason = patch_reason(command)
    if reason is None:
        return None
    return deny_decision(reason)


def main() -> int:
    """Liest das Hook-JSON und schreibt gegebenenfalls die Ablehnung.

    Fail-closed (23.11.2026): Unlesbare Eingabe und innere Ausnahmen ergeben
    ein ``deny`` statt stiller Freigabe. Nur ein erfolgreich ausgewertetes
    Ereignis ohne Grund bleibt still (kein Einwand).
    """
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
    except (ValueError, OSError):
        print(json.dumps(deny_decision(REASON_HOOK_ERROR)))
        return 0
    if not isinstance(payload, dict):
        print(json.dumps(deny_decision(REASON_HOOK_ERROR)))
        return 0
    try:
        decision = decide(payload)
    except Exception:
        print(json.dumps(deny_decision(REASON_HOOK_ERROR)))
        return 0
    if decision is not None:
        print(json.dumps(decision))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
