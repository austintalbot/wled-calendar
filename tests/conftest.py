"""Pytest fixtures for isolated temporary SQLite DB per test."""

from __future__ import annotations

from pathlib import Path
import pytest

from backend.config import settings
from backend.db import init_db


@pytest.fixture(autouse=True)
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Point settings.db_path to a fresh temp SQLite file for each test."""
    db_file = tmp_path / "test_wled_calendar.db"
    monkeypatch.setattr(settings, "db_path", str(db_file))
    init_db()
