"""Tests fuer ``codex_guard.py``.

Der Guard ist reine Textpruefung. Die Faelle bilden ab, was im Codex-Protokoll
als ``tool_input.command`` ankommt: nackte Befehle, Shell-Umhuellungen, Ketten.
Die Negativfaelle stammen aus echten Befehlen des Eltern-Repositories.
"""

from __future__ import annotations

import importlib.util
import json
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
]

ALLOWED = [
    "",
    "git status --short",
    "git pull",
    "git log --oneline -5",
    'echo "git push"',
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
    "rm -rf C:/Users/x/AppData/Local/Temp/foo",
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
# shared-cases.jsonl liegt neben dem Guard. Beide Suiten lesen dieselbe Datei;
# eine Aenderung auf einer Seite bricht den Test, bis der Wert hier bewusst
# nachgezogen wird.
SHARED = Path(__file__).resolve().parents[1] / "shared-cases.jsonl"


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
