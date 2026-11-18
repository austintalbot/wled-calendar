"""SQLite database initialization and repository helpers."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from backend.config import settings
from backend.models import ControllerProfile, SegmentSpec

DEFAULT_SEGMENTS = [
    SegmentSpec(id=0, start=0, stop=712, len=712, pin=16, name="Main Eave"),
    SegmentSpec(id=1, start=712, stop=824, len=112, pin=3, name="Section 2"),
    SegmentSpec(id=2, start=824, stop=1078, len=254, pin=1, name="Section 3"),
]

RULE_DEFAULT_PRIORITIES = {
    "date": 100,
    "holiday": 80,
    "date_range": 60,
    "day_of_week": 40,
    "default": 10,
}


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO 8601 format."""
    return datetime.now(timezone.utc).isoformat()


def get_db_path() -> Path:
    """Return resolved database path, ensuring parent directory exists."""
    path = Path(settings.db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    """Yield a SQLite connection with row_factory and foreign keys enabled."""
    conn = sqlite3.connect(get_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Create tables if they do not exist and seed default controller profile."""
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS controller_profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                host TEXT NOT NULL,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                led_count INTEGER NOT NULL,
                fx_count INTEGER NOT NULL,
                pal_count INTEGER NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                timezone TEXT NOT NULL,
                segments_json TEXT NOT NULL,
                effects_json TEXT NOT NULL,
                fx_data_json TEXT NOT NULL DEFAULT '[]',
                palettes_json TEXT NOT NULL,
                palette_colors_json TEXT NOT NULL DEFAULT '{}',
                last_synced_at TEXT
            );

            CREATE TABLE IF NOT EXISTS effects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_url TEXT,
                payload_json TEXT NOT NULL,
                segment_mode TEXT NOT NULL DEFAULT 'mirror',
                tags_json TEXT NOT NULL DEFAULT '[]',
                preview_colors_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS schedule_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                rule_type TEXT NOT NULL,
                start_date TEXT,
                end_date TEXT,
                days_of_week_json TEXT NOT NULL DEFAULT '[]',
                holiday_name TEXT,
                effect_id INTEGER NOT NULL REFERENCES effects(id) ON DELETE CASCADE,
                trigger_type TEXT NOT NULL DEFAULT 'sunset',
                trigger_time TEXT,
                offset_minutes INTEGER NOT NULL DEFAULT 0,
                brightness_override INTEGER,
                priority INTEGER NOT NULL DEFAULT 50,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ics_feeds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                feed_type TEXT NOT NULL DEFAULT 'google_calendar',
                url TEXT NOT NULL,
                sync_interval_minutes INTEGER NOT NULL DEFAULT 30,
                auto_map_keywords_json TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_synced_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS calendar_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id INTEGER NOT NULL REFERENCES ics_feeds(id) ON DELETE CASCADE,
                uid TEXT NOT NULL,
                summary TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                start_dt TEXT NOT NULL,
                end_dt TEXT NOT NULL,
                is_all_day INTEGER NOT NULL DEFAULT 0,
                matched_effect_id INTEGER REFERENCES effects(id) ON DELETE SET NULL,
                match_source TEXT
            );

            CREATE TABLE IF NOT EXISTS execution_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scheduled_for TEXT NOT NULL,
                executed_at TEXT NOT NULL,
                effect_id INTEGER,
                effect_name TEXT NOT NULL,
                trigger_source TEXT NOT NULL,
                status TEXT NOT NULL,
                error_message TEXT
            );
            """
        )

        # Migrate existing controller_profile table if palette_colors_json is missing
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(controller_profile)").fetchall()}
        if "palette_colors_json" not in cols:
            conn.execute("ALTER TABLE controller_profile ADD COLUMN palette_colors_json TEXT NOT NULL DEFAULT '{}'")
        if "fx_data_json" not in cols:
            conn.execute("ALTER TABLE controller_profile ADD COLUMN fx_data_json TEXT NOT NULL DEFAULT '[]'")

        row = conn.execute("SELECT id FROM controller_profile WHERE id = 1").fetchone()
        if not row:
            conn.execute(
                """
                INSERT INTO controller_profile (
                    id, host, name, version, led_count, fx_count, pal_count,
                    latitude, longitude, timezone, segments_json, effects_json,
                    palettes_json, last_synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    1,
                    settings.wled_host,
                    "WLED",
                    "16.0.1",
                    1078,
                    220,
                    74,
                    settings.default_lat,
                    settings.default_lon,
                    settings.timezone,
                    json.dumps([s.model_dump() for s in DEFAULT_SEGMENTS]),
                    "[]",
                    "[]",
                    None,
                ),
            )


def get_controller_profile() -> ControllerProfile:
    """Load the cached controller profile from SQLite."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM controller_profile WHERE id = 1").fetchone()
        if not row:
            init_db()
            row = conn.execute("SELECT * FROM controller_profile WHERE id = 1").fetchone()
        return ControllerProfile(
            host=row["host"],
            name=row["name"],
            version=row["version"],
            led_count=row["led_count"],
            fx_count=row["fx_count"],
            pal_count=row["pal_count"],
            latitude=row["latitude"],
            longitude=row["longitude"],
            timezone=row["timezone"],
            segments=[SegmentSpec(**s) for s in json.loads(row["segments_json"])],
            effects=json.loads(row["effects_json"]),
            fx_data=json.loads(row["fx_data_json"] or "[]"),
            palettes=json.loads(row["palettes_json"]),
            palette_colors=json.loads(row["palette_colors_json"] or "{}"),
            last_synced_at=row["last_synced_at"],
        )


def save_controller_profile(profile: ControllerProfile) -> ControllerProfile:
    """Persist updated controller profile to SQLite."""
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE controller_profile
            SET host = ?, name = ?, version = ?, led_count = ?, fx_count = ?, pal_count = ?,
                latitude = ?, longitude = ?, timezone = ?, segments_json = ?,
                effects_json = ?, fx_data_json = ?, palettes_json = ?, palette_colors_json = ?, last_synced_at = ?
            WHERE id = 1
            """,
            (
                profile.host,
                profile.name,
                profile.version,
                profile.led_count,
                profile.fx_count,
                profile.pal_count,
                profile.latitude,
                profile.longitude,
                profile.timezone,
                json.dumps([s.model_dump() for s in profile.segments]),
                json.dumps(profile.effects),
                json.dumps(profile.fx_data),
                json.dumps(profile.palettes),
                json.dumps(profile.palette_colors),
                profile.last_synced_at,
            ),
        )
    return profile


def log_execution(
    scheduled_for: str,
    effect_id: int | None,
    effect_name: str,
    trigger_source: str,
    status: str,
    error_message: str | None = None,
) -> None:
    """Insert an execution audit record."""
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO execution_logs (
                scheduled_for, executed_at, effect_id, effect_name,
                trigger_source, status, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                scheduled_for,
                utc_now_iso(),
                effect_id,
                effect_name,
                trigger_source,
                status,
                error_message,
            ),
        )


def row_to_effect(row: sqlite3.Row) -> dict[str, Any]:
    """Convert an effects SQLite row to a dictionary matching EffectRecord."""
    return {
        "id": row["id"],
        "name": row["name"],
        "source_type": row["source_type"],
        "source_url": row["source_url"],
        "payload": json.loads(row["payload_json"]),
        "segment_mode": row["segment_mode"],
        "tags": json.loads(row["tags_json"]),
        "preview_colors": json.loads(row["preview_colors_json"]),
        "created_at": row["created_at"],
    }


def row_to_rule(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a schedule_rules SQLite row to a dictionary matching ScheduleRuleRecord."""
    keys = row.keys()
    return {
        "id": row["id"],
        "rule_type": row["rule_type"],
        "start_date": row["start_date"],
        "end_date": row["end_date"],
        "days_of_week": json.loads(row["days_of_week_json"]),
        "holiday_name": row["holiday_name"],
        "effect_id": row["effect_id"],
        "effect_name": row["effect_name"] if "effect_name" in keys else None,
        "trigger_type": row["trigger_type"],
        "trigger_time": row["trigger_time"],
        "offset_minutes": row["offset_minutes"],
        "brightness_override": row["brightness_override"],
        "priority": row["priority"],
        "enabled": bool(row["enabled"]),
        "created_at": row["created_at"],
    }
