"""Tests fuer ``codex_guard.py``.

Der Guard ist reine Textpruefung. Die Faelle bilden ab, was im Codex-Protokoll
als ``tool_input.command`` ankommt: nackte Befehle, Shell-Umhuellungen, Ketten.
Die Negativfaelle stammen aus echten Befehlen des Eltern-Repositories.
"""

from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "codex_guard.py"


def load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("codex_guard", SCRIPT)
    assert spec is not None
    loader = spec.loader
    assert loader is not None
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


guard: Any = load_module()

BLOCKED = [
    # Remote-Push, auch umhuellt
    "git push",
    "git push origin master",
    "git push --force-with-lease",
    "git push -n",
    "git.exe push",
    "git -C /tmp/repo push",
    "& git push",
    "cd repo && git push",
    "git status; git push",
    'pwsh -NoProfile -Command "git push"',
    'pwsh.exe -Command "cd repo; git push origin main"',
    'bash -lc "git add . && git push"',
    'cmd /c "git push"',
    # Ein einzelnes & trennt Befehle (Review 17.11.2026)
    "echo ok & git push",
    "echo ok& git push",
    "git status & git push",
    'bash -lc "echo ok & git push"',
    # Arbeit und Geschichte verwerfen
    "git reset --hard",
    "git reset --hard HEAD~1",
    "git -C repo reset --hard origin/main",
    "git checkout .",
    "git checkout -- .",
    "git restore .",
    "git clean -f",
    "git clean -fd",
    "git clean -fdx",
    "git clean --force",
    "git filter-branch --tree-filter x",
    "git filter-repo --path src",
    "git branch -D backup",
    "git branch --delete --force backup",
    "git branch -d -f backup",
    # Gates umgehen
    "git commit --no-verify -m x",
    "git push --no-verify",
    # `git commit -n` ist die Kurzform von --no-verify; gebuendelt von links.
    "git commit -n -m x",
    "git commit -an -m x",
    "git commit -nm x",
    # Massenloeschung ausserhalb cache/staging/tmp/temp
    "Remove-Item -Recurse docs",
    "Remove-Item -Recurse -Force .git",
    "Remove-Item .\\docs -Recurse",
    "Remove-Item -LiteralPath src -Recurse",
    "rm -rf src",
    "rm -r data",
    "rd /s /q docs",
    "rmdir /s /q data",
    "Remove-Item -Recurse",
    "Remove-Item -Recurse *",
    'pwsh -Command "Remove-Item -Recurse docs"',
    "robocopy C:/a C:/b /MIR",
    # Nur freigegebene Wurzeln: Unterordner des Projektordners und das
    # tatsaechliche System-Temp. `..` und absolute Ziele ausserhalb werden
    # abgelehnt (Review 17.11.2026).
    "rm -rf staging/../src",
    "rm -rf ./temp/../.git",
    "rm -rf staging/ok /etc",
    "rm -rf /etc",
    "rm -rf C:/Windows/System32",
    "cd repo && rm -rf staging/x",
    "bash -c 'rm -rf staging/../src'",
    'pwsh -Command "rm -rf staging/x"',
]

TEMP_ROOT = Path(tempfile.gettempdir()).resolve()

ALLOWED = [
    "",
    "git status --short",
    "git pull",
    "git log --oneline -5",
    'echo "git push"',
    'echo "a & b"',
    "make 2>&1",
    "Get-Content x 2>&1",
    "git commit -m 'push later'",
    "git commit -mn x",
    "git branch -d backup",
    "git reset HEAD -- CHANGELOG.md",
    "git checkout -- README.md",
    "git restore --staged README.md",
    "git clean -n",
    "git clean -nd",
    "Remove-Item file.txt",
    "Remove-Item -Force file.txt",
    "Remove-Item -Recurse staging/hooktest",
    "Remove-Item -Recurse -Force staging/ergebnisse",
    "Remove-Item -Recurse tmp/build",
    "Remove-Item -Recurse .\\cache\\npm",
    "rm -rf ./temp/build",
    f"rm -rf {TEMP_ROOT}/foo",
    "python -m pytest -q",
    "python -m ruff check .",
    "Get-Content README.md",
]


@pytest.mark.parametrize("command", BLOCKED)
def test_blocks(command: str) -> None:
    assert guard.first_reason(command) is not None


@pytest.mark.parametrize("command", ALLOWED)
def test_allows(command: str) -> None:
    assert guard.first_reason(command) is None


def test_git_global_options_attached_forms_block() -> None:
    """P0-6: angehaengte globale Git-Optionen duerfen Verbote nicht umgehen."""
    for command in (
        "git --git-dir=.git reset --hard HEAD",
        "git -C. push",
        "git -C./ push",
        "git --work-tree=.git push",
    ):
        assert guard.first_reason(command) is not None, command


def test_bundled_and_abbreviated_delete_flags_block() -> None:
    """P0-7: gebuendelte und abgekuerzte Schalter plus Array-Ziele."""
    for command in (
        "rm -rfv src",
        "Remove-Item -Rec src",
        "Remove-Item -Recurse staging/x,src",
    ):
        assert guard.first_reason(command) is not None, command


def test_hook_json_denies_parameter_and_bundled_delete_forms() -> None:
    """Abnahme Blocker 5: Hook-JSON auf stdin, Exit 0 und deny-Entscheidung."""
    for command in ("Remove-Item -Recurse:$true src", "rm -rfd src", "rm -rffvd src", "rm -irf src"):
        result = subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=json.dumps({"tool_name": "Bash", "tool_input": {"command": command}}),
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0
        decision = json.loads(result.stdout)
        output = decision["hookSpecificOutput"]
        assert output["permissionDecision"] == "deny"
        assert output["permissionDecisionReason"] == guard.REASON_DELETE


def test_reason_matches_category() -> None:
    assert guard.first_reason("git push") == guard.REASON_PUSH
    assert guard.first_reason("git reset --hard") == guard.REASON_HISTORY
    assert guard.first_reason("git branch -D backup") == guard.REASON_HISTORY
    assert guard.first_reason("git commit --no-verify -m x") == guard.REASON_NO_VERIFY
    assert guard.first_reason("Remove-Item -Recurse docs") == guard.REASON_DELETE
    assert guard.first_reason("robocopy C:/a C:/b /MIR") == guard.REASON_MIRROR


def test_decide_ignores_non_bash_tools() -> None:
    payload = {"tool_name": "read", "tool_input": {"command": "git push"}}
    assert guard.decide(payload) is None


def test_decide_returns_deny_shape() -> None:
    payload = {"tool_name": "Bash", "tool_input": {"command": "git push origin main"}}
    decision = guard.decide(payload)
    assert decision is not None
    output = decision["hookSpecificOutput"]
    assert output["hookEventName"] == "PreToolUse"
    assert output["permissionDecision"] == "deny"
    assert output["permissionDecisionReason"] == guard.REASON_PUSH


def run_hook(payload: dict[str, object]) -> str:
    """Hook-Aufruf wie Codex: JSON auf stdin, Ausgabe auf stdout."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout


def test_hook_json_over_stdin_denies_ampersand_push() -> None:
    """Der Hook liest das JSON von stdin - auch fuer den Trenner `&`."""
    out = run_hook({"tool_name": "Bash", "tool_input": {"command": "echo ok & git push"}})
    decision = json.loads(out)
    assert decision["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert decision["hookSpecificOutput"]["permissionDecisionReason"] == guard.REASON_PUSH


def test_hook_json_over_stdin_stays_silent_without_reason() -> None:
    out = run_hook({"tool_name": "Bash", "tool_input": {"command": "git status --short"}})
    assert out.strip() == ""


def test_hook_json_invalid_input_denies() -> None:
    """Fail-closed (23.11.2026): Unlesbare Eingabe ergibt deny, kein Schweigen."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input="kein json",
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    output = json.loads(result.stdout)["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    assert output["permissionDecisionReason"] == guard.REASON_HOOK_ERROR


def test_hook_json_non_dict_denies() -> None:
    """Fail-closed: Gueltiges JSON ohne Objektform ergibt deny."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input="[1, 2]",
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    output = json.loads(result.stdout)["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    assert output["permissionDecisionReason"] == guard.REASON_HOOK_ERROR


def test_decide_malformed_bash_denies() -> None:
    """Fail-closed: Bash ohne auswertbare Eingabe ergibt deny."""
    for payload in ({"tool_name": "Bash"}, {"tool_name": "Bash", "tool_input": {}}):
        decision = guard.decide(payload)
        assert decision is not None
        output = decision["hookSpecificOutput"]
        assert output["permissionDecision"] == "deny"
        assert output["permissionDecisionReason"] == guard.REASON_HOOK_ERROR


def test_main_internal_error_denies(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    """Fail-closed: Eine innere Ausnahme im Hook ergibt deny."""

    def boom(payload: dict[str, object]) -> None:
        raise RuntimeError("kaputt")

    monkeypatch.setattr(guard, "decide", boom)
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO(json.dumps({"tool_name": "Bash", "tool_input": {"command": "git status"}})),
    )
    assert guard.main() == 0
    output = json.loads(capsys.readouterr().out)["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    assert output["permissionDecisionReason"] == guard.REASON_HOOK_ERROR


def test_delete_uses_project_root() -> None:
    """Relative Loeschziele gelten gegen den uebergebenen Projektordner."""
    root = Path("C:/work/repo")
    assert guard.first_reason("rm -rf staging/x", root=root) is None
    assert guard.first_reason("rm -rf src", root=root) is not None
    assert guard.first_reason("cd repo && rm -rf staging/x", root=root) is not None


@pytest.mark.skipif(os.name == "nt", reason="POSIX: der Backslash ist ein Namensbestandteil")
def test_backslash_name_is_not_a_cache_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Ein wortwoertliches ``cache\\npm`` im Projektordner liegt nicht unter cache/."""
    # Das System-Temp wird verlegt, sonst deckt /tmp den ganzen Testordner ab.
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path / "system-temp"))
    (tmp_path / "cache").mkdir()
    (tmp_path / "cache\\npm").write_text("x", encoding="utf-8")
    assert guard.first_reason("rm -rf cache\\npm", root=tmp_path) is not None
    assert guard.first_reason("rm -rf cache/npm", root=tmp_path) is None


def test_hook_json_over_stdin_uses_execution_folder() -> None:
    """Der Ausfuehrungsordner im Hook-Eingang ist der Projektanker."""
    allowed = run_hook({"tool_name": "Bash", "tool_input": {"command": "rm -rf staging/x", "cwd": "C:/work/repo"}})
    assert allowed.strip() == ""
    denied = run_hook({"tool_name": "Bash", "tool_input": {"command": "rm -rf src", "cwd": "C:/work/repo"}})
    decision = json.loads(denied)
    assert decision["hookSpecificOutput"]["permissionDecisionReason"] == guard.REASON_DELETE


PROTECTED_PATCHES = [
    "*** Begin Patch\n*** Delete File: .git/config\n*** End Patch",
    "*** Begin Patch\n*** Delete File: .git\\config\n*** End Patch",
    "*** Begin Patch\n*** Delete File: .githooks/pre-commit\n*** End Patch",
    "*** Begin Patch\n*** Delete File: .codex/hooks/codex_guard.py\n*** End Patch",
    "*** Begin Patch\n*** Delete File: AGENTS.md\n*** End Patch",
    "*** Begin Patch\n*** Delete File: docs/AGENTS.md\n*** End Patch",
    "*** Begin Patch\n*** Delete File: ./a\n*** Delete File: ./b\n*** Delete File: ./c\n"
    "*** Delete File: ./d\n*** Delete File: ./e\n*** Delete File: ./f\n*** End Patch",
]

ALLOWED_PATCHES = [
    "*** Begin Patch\n*** Delete File: staging/alt.md\n*** End Patch",
    "*** Begin Patch\n*** Delete File: docs/veraltet.md\n*** End Patch",
    "*** Begin Patch\n*** Update File: .githooks/pre-commit\n@@\n- a\n+ b\n*** End Patch",
    "*** Begin Patch\n*** Add File: docs/neu.md\n+ Hallo\n*** End Patch",
    "*** Begin Patch\n*** Delete File: ./a\n*** Delete File: ./b\n*** Delete File: ./c\n"
    "*** Delete File: ./d\n*** Delete File: ./e\n*** End Patch",
    "",
]


@pytest.mark.parametrize("patch", PROTECTED_PATCHES)
def test_blocks_patch(patch: str) -> None:
    assert guard.patch_reason(patch) is not None


@pytest.mark.parametrize("patch", ALLOWED_PATCHES)
def test_allows_patch(patch: str) -> None:
    assert guard.patch_reason(patch) is None


def test_decide_handles_apply_patch() -> None:
    payload = {
        "tool_name": "apply_patch",
        "tool_input": {"command": "*** Begin Patch\n*** Delete File: .githooks/pre-push\n*** End Patch"},
    }
    decision = guard.decide(payload)
    assert decision is not None
    assert decision["hookSpecificOutput"]["permissionDecisionReason"] == guard.REASON_PATCH_PROTECTED


# --- Gemeinsame Faelle mit dem OpenCode-Guard -----------------------------
# shared-cases.jsonl liegt neben den JS-Tests unter test/. Beide Suiten lesen
# dieselbe Datei; eine Aenderung auf einer Seite bricht den Test, bis der Wert
# hier bewusst nachgezogen wird.
SHARED = Path(__file__).resolve().parents[1] / "test" / "shared-cases.jsonl"


def load_shared() -> list[dict[str, Any]]:
    """Liest die gemeinsamen Faelle aus der Datei neben dem Guard."""
    cases: list[dict[str, Any]] = []
    for line in SHARED.read_text(encoding="utf-8").splitlines():
        if line.strip():
            cases.append(json.loads(line))
    return cases


SHARED_CASES = load_shared()


def test_shared_cases_available() -> None:
    assert SHARED_CASES, "shared-cases.jsonl ist leer."


@pytest.mark.parametrize("case", SHARED_CASES, ids=[case["id"] for case in SHARED_CASES])
def test_shared_case_matches_codex(case: dict[str, Any]) -> None:
    blocked = guard.first_reason(case["command"]) is not None
    assert blocked == (case["codex"] == "deny")
