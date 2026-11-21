from __future__ import annotations

import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

ARTIFACT_ROOT = Path(__file__).resolve().parent / "artifacts"
ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)


@pytest.fixture
def tmp_path() -> Iterator[Path]:
    """A test-local temporary directory without the restricted Windows DACL.

    Pytest's built-in ``tmp_path`` creates directories with ``mode=0o700``. In
    the Codex Windows sandbox that produces a protected ACL which the sandboxed
    process cannot list or remove. This fixture creates the directory under the
    pre-existing ``tests/artifacts`` directory with the normal inherited ACL.
    """
    path = ARTIFACT_ROOT / f"tmp-{uuid.uuid4().hex}"
    path.mkdir()
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
