"""ICS / Google Calendar Secret iCal feed management and sync endpoints."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException

from backend.db import get_conn, get_controller_profile, row_to_effect, utc_now_iso
from backend.importers.ics_importer import fetch_and_parse_ics
from backend.models import FeedCreate
from backend.scheduler import refresh_daily_jobs, replace_feed_events

router = APIRouter(prefix="/api/feeds", tags=["feeds"])


def _row_to_feed(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "feed_type": row["feed_type"],
        "url": row["url"],
        "sync_interval_minutes": row["sync_interval_minutes"],
        "auto_map_keywords": json.loads(row["auto_map_keywords_json"] or "{}"),
        "enabled": bool(row["enabled"]),
        "last_synced_at": row["last_synced_at"],
        "created_at": row["created_at"],
    }


@router.get("")
def list_feeds() -> dict[str, Any]:
    """List configured Google Calendar and ICS holiday feeds."""
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM ics_feeds ORDER BY id DESC").fetchall()
    return {"feeds": [_row_to_feed(r) for r in rows]}


@router.post("")
def create_feed(body: FeedCreate) -> dict[str, Any]:
    """Add a new Google Calendar Secret iCal URL or ICS holiday feed."""
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO ics_feeds (
                name, feed_type, url, sync_interval_minutes,
                auto_map_keywords_json, enabled, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                body.name,
                body.feed_type,
                body.url.strip(),
                body.sync_interval_minutes,
                json.dumps(body.auto_map_keywords),
                1 if body.enabled else 0,
                utc_now_iso(),
            ),
        )
        row = conn.execute("SELECT * FROM ics_feeds WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"feed": _row_to_feed(row)}


@router.delete("/{feed_id}")
def delete_feed(feed_id: int) -> dict[str, bool]:
    """Delete an ICS / Google Calendar feed and its cached events."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM ics_feeds WHERE id = ?", (feed_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Feed not found")
    refresh_daily_jobs()
    return {"deleted": True}


@router.post("/{feed_id}/sync")
async def sync_feed(feed_id: int) -> dict[str, Any]:
    """Fetch, parse, and match events from the configured ICS / Google Calendar feed."""
    profile = get_controller_profile()
    with get_conn() as conn:
        feed = conn.execute("SELECT * FROM ics_feeds WHERE id = ?", (feed_id,)).fetchone()
        if not feed:
            raise HTTPException(status_code=404, detail="Feed not found")
        effects = [row_to_effect(r) for r in conn.execute("SELECT * FROM effects").fetchall()]

    keyword_map = json.loads(feed["auto_map_keywords_json"] or "{}")
    try:
        events = await fetch_and_parse_ics(
            url=feed["url"],
            tz_name=profile.timezone,
            effects=effects,
            keyword_overrides=keyword_map,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to sync feed: {exc}") from exc

    count = replace_feed_events(feed_id, events)
    refresh_daily_jobs()
    return {"synced_events": count, "matched_events": sum(1 for e in events if e["matched_effect_id"])}


@router.get("/{feed_id}/events")
def list_feed_events(feed_id: int) -> dict[str, Any]:
    """List cached events for a specific feed."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT ev.*, e.name AS matched_effect_name
            FROM calendar_events ev
            LEFT JOIN effects e ON e.id = ev.matched_effect_id
            WHERE ev.feed_id = ?
            ORDER BY ev.start_dt ASC
            LIMIT 200
            """,
            (feed_id,),
        ).fetchall()
    return {"events": [dict(r) for r in rows]}
