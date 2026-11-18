"""Calendar schedule rules, monthly resolution, and execution log endpoints."""

from __future__ import annotations

import calendar
import json
from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.db import RULE_DEFAULT_PRIORITIES, get_conn, get_controller_profile, row_to_rule, utc_now_iso
from backend.models import ScheduleRuleCreate
from backend.scheduler import refresh_daily_jobs, resolve_day_schedule

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


@router.get("/month")
def get_month_schedule(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
) -> dict[str, Any]:
    """Return day-by-day resolved effects, sunset times, and Google Calendar events for a month."""
    profile = get_controller_profile()
    _, num_days = calendar.monthrange(year, month)
    days = [resolve_day_schedule(date(year, month, day), profile).model_dump() for day in range(1, num_days + 1)]
    return {"year": year, "month": month, "days": days}


@router.get("/rules")
def list_rules() -> dict[str, Any]:
    """List all schedule rules ordered by priority."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT r.*, e.name AS effect_name
            FROM schedule_rules r
            JOIN effects e ON e.id = r.effect_id
            ORDER BY r.priority DESC, r.id DESC
            """
        ).fetchall()
    return {"rules": [row_to_rule(r) for r in rows]}


@router.post("/rules")
def create_rule(body: ScheduleRuleCreate) -> dict[str, Any]:
    """Create a schedule rule (upserting existing default or same-date rules) and refresh today's jobs."""
    priority = body.priority if body.priority is not None else RULE_DEFAULT_PRIORITIES[body.rule_type]
    with get_conn() as conn:
        eff = conn.execute("SELECT id FROM effects WHERE id = ?", (body.effect_id,)).fetchone()
        if not eff:
            raise HTTPException(status_code=404, detail="Target effect not found")

        existing_id: int | None = None
        if body.rule_type == "default":
            row = conn.execute("SELECT id FROM schedule_rules WHERE rule_type = 'default' ORDER BY id DESC LIMIT 1").fetchone()
            if row:
                existing_id = row["id"]
        elif body.rule_type == "date" and body.start_date:
            row = conn.execute(
                "SELECT id FROM schedule_rules WHERE rule_type = 'date' AND start_date = ? ORDER BY id DESC LIMIT 1",
                (body.start_date,),
            ).fetchone()
            if row:
                existing_id = row["id"]

        if existing_id is not None:
            conn.execute(
                """
                UPDATE schedule_rules
                SET rule_type = ?, start_date = ?, end_date = ?, days_of_week_json = ?,
                    holiday_name = ?, effect_id = ?, trigger_type = ?, trigger_time = ?,
                    offset_minutes = ?, brightness_override = ?, priority = ?, enabled = ?
                WHERE id = ?
                """,
                (
                    body.rule_type,
                    body.start_date,
                    body.end_date,
                    json.dumps(body.days_of_week),
                    body.holiday_name,
                    body.effect_id,
                    body.trigger_type,
                    body.trigger_time,
                    body.offset_minutes,
                    body.brightness_override,
                    priority,
                    1 if body.enabled else 0,
                    existing_id,
                ),
            )
            target_id = existing_id
        else:
            cur = conn.execute(
                """
                INSERT INTO schedule_rules (
                    rule_type, start_date, end_date, days_of_week_json, holiday_name,
                    effect_id, trigger_type, trigger_time, offset_minutes,
                    brightness_override, priority, enabled, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    body.rule_type,
                    body.start_date,
                    body.end_date,
                    json.dumps(body.days_of_week),
                    body.holiday_name,
                    body.effect_id,
                    body.trigger_type,
                    body.trigger_time,
                    body.offset_minutes,
                    body.brightness_override,
                    priority,
                    1 if body.enabled else 0,
                    utc_now_iso(),
                ),
            )
            target_id = cur.lastrowid

        row = conn.execute(
            """
            SELECT r.*, e.name AS effect_name
            FROM schedule_rules r
            JOIN effects e ON e.id = r.effect_id
            WHERE r.id = ?
            """,
            (target_id,),
        ).fetchone()
    refresh_daily_jobs()
    return {"rule": row_to_rule(row)}


@router.put("/rules/{rule_id}")
def update_rule(rule_id: int, body: ScheduleRuleCreate) -> dict[str, Any]:
    """Update an existing schedule rule."""
    priority = body.priority if body.priority is not None else RULE_DEFAULT_PRIORITIES[body.rule_type]
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM schedule_rules WHERE id = ?", (rule_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Rule not found")
        conn.execute(
            """
            UPDATE schedule_rules
            SET rule_type = ?, start_date = ?, end_date = ?, days_of_week_json = ?,
                holiday_name = ?, effect_id = ?, trigger_type = ?, trigger_time = ?,
                offset_minutes = ?, brightness_override = ?, priority = ?, enabled = ?
            WHERE id = ?
            """,
            (
                body.rule_type,
                body.start_date,
                body.end_date,
                json.dumps(body.days_of_week),
                body.holiday_name,
                body.effect_id,
                body.trigger_type,
                body.trigger_time,
                body.offset_minutes,
                body.brightness_override,
                priority,
                1 if body.enabled else 0,
                rule_id,
            ),
        )
        row = conn.execute(
            """
            SELECT r.*, e.name AS effect_name
            FROM schedule_rules r
            JOIN effects e ON e.id = r.effect_id
            WHERE r.id = ?
            """,
            (rule_id,),
        ).fetchone()
    refresh_daily_jobs()
    return {"rule": row_to_rule(row)}


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int) -> dict[str, bool]:
    """Delete a schedule rule."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM schedule_rules WHERE id = ?", (rule_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Rule not found")
    refresh_daily_jobs()
    return {"deleted": True}


@router.get("/logs")
def list_logs(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    """Return recent scheduler and manual execution logs."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM execution_logs ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return {"logs": [dict(r) for r in rows]}
