"""Daily WLED effect scheduler with astral sunset/sunrise and Google Calendar timed events."""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from astral import LocationInfo
from astral.sun import sun

from backend.db import (
    get_conn,
    get_controller_profile,
    log_execution,
    row_to_effect,
    row_to_rule,
    utc_now_iso,
)
from backend.importers.ics_importer import fetch_and_parse_ics
from backend.models import CalendarEventRecord, ControllerProfile, DayScheduleSummary
from backend.wled_client import adapt_payload_to_controller, apply_state

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def get_sun_times(target_date: date, profile: ControllerProfile) -> tuple[datetime, datetime]:
    """Compute local sunrise and sunset datetimes for target_date using controller coordinates."""
    tz = ZoneInfo(profile.timezone)
    loc = LocationInfo(
        name=profile.name,
        region="Local",
        timezone=profile.timezone,
        latitude=profile.latitude,
        longitude=profile.longitude,
    )
    s = sun(loc.observer, date=target_date, tzinfo=tz)
    return s["sunrise"], s["sunset"]


def compute_trigger_datetime(
    target_date: date,
    trigger_type: str,
    trigger_time: str | None,
    offset_minutes: int,
    profile: ControllerProfile,
) -> datetime:
    """Resolve a rule's trigger_type into an exact local datetime for target_date."""
    tz = ZoneInfo(profile.timezone)
    if trigger_type == "fixed_time" and trigger_time:
        hh, mm = (int(p) for p in trigger_time.split(":")[:2])
        base_dt = datetime.combine(target_date, time(hh, mm), tzinfo=tz)
    elif trigger_type == "sunrise":
        sunrise_dt, _ = get_sun_times(target_date, profile)
        base_dt = sunrise_dt
    else:
        _, sunset_dt = get_sun_times(target_date, profile)
        base_dt = sunset_dt

    return base_dt + timedelta(minutes=offset_minutes)


def _rule_matches_date(rule: dict[str, Any], target_date: date, day_events: list[CalendarEventRecord]) -> bool:
    """Return True if a schedule rule applies to target_date."""
    if not rule["enabled"]:
        return False
    iso = target_date.isoformat()
    rtype = rule["rule_type"]

    if rtype == "date":
        return rule["start_date"] == iso
    if rtype == "date_range":
        start = rule["start_date"] or "0000-01-01"
        end = rule["end_date"] or "9999-12-31"
        return start <= iso <= end
    if rtype == "day_of_week":
        return target_date.weekday() in rule["days_of_week"]
    if rtype == "holiday":
        needle = (rule["holiday_name"] or "").strip().lower()
        return bool(needle) and any(needle in ev.summary.lower() for ev in day_events)
    if rtype == "default":
        return True
    return False


def resolve_day_schedule(
    target_date: date,
    profile: ControllerProfile | None = None,
) -> DayScheduleSummary:
    """Resolve the active baseline effect and timed calendar events for a specific date."""
    profile = profile or get_controller_profile()
    tz = ZoneInfo(profile.timezone)
    day_start = datetime.combine(target_date, time.min, tzinfo=tz)
    day_end = day_start + timedelta(days=1)

    _, sunset_dt = get_sun_times(target_date, profile)

    with get_conn() as conn:
        effect_rows = conn.execute("SELECT * FROM effects").fetchall()
        effects_by_id = {r["id"]: row_to_effect(r) for r in effect_rows}

        rule_rows = conn.execute(
            """
            SELECT r.*, e.name AS effect_name
            FROM schedule_rules r
            JOIN effects e ON e.id = r.effect_id
            WHERE r.enabled = 1
            ORDER BY r.priority DESC, r.id DESC
            """
        ).fetchall()
        rules = [row_to_rule(r) for r in rule_rows]

        event_rows = conn.execute(
            """
            SELECT ev.*, e.name AS matched_effect_name
            FROM calendar_events ev
            LEFT JOIN effects e ON e.id = ev.matched_effect_id
            WHERE ev.start_dt < ? AND ev.end_dt > ?
            ORDER BY ev.start_dt ASC
            """,
            (day_end.isoformat(), day_start.isoformat()),
        ).fetchall()

    day_events: list[CalendarEventRecord] = []
    for r in event_rows:
        day_events.append(
            CalendarEventRecord(
                id=r["id"],
                feed_id=r["feed_id"],
                uid=r["uid"],
                summary=r["summary"],
                description=r["description"],
                start_dt=r["start_dt"],
                end_dt=r["end_dt"],
                is_all_day=bool(r["is_all_day"]),
                matched_effect_id=r["matched_effect_id"],
                matched_effect_name=r["matched_effect_name"],
                match_source=r["match_source"],
            )
        )

    all_day_events = [ev for ev in day_events if ev.is_all_day]
    timed_events = [ev for ev in day_events if not ev.is_all_day]

    # Check if an explicit 'date' rule exists (highest priority: 100)
    matching_rules = [r for r in rules if _rule_matches_date(r, target_date, day_events)]
    explicit_date_rule = next((r for r in matching_rules if r["rule_type"] == "date"), None)
    matched_all_day = next((ev for ev in all_day_events if ev.matched_effect_id is not None), None)

    chosen_effect_id: int | None = None
    chosen_source: str | None = None
    trigger_type: str | None = None
    trigger_time_resolved: str | None = None

    if explicit_date_rule:
        chosen_effect_id = explicit_date_rule["effect_id"]
        chosen_source = "date"
        trigger_type = explicit_date_rule["trigger_type"]
        dt = compute_trigger_datetime(
            target_date,
            explicit_date_rule["trigger_type"],
            explicit_date_rule["trigger_time"],
            explicit_date_rule["offset_minutes"],
            profile,
        )
        trigger_time_resolved = dt.strftime("%I:%M %p").lstrip("0")
    elif matched_all_day:
        chosen_effect_id = matched_all_day.matched_effect_id
        chosen_source = f"google_all_day ({matched_all_day.summary})"
        trigger_type = "sunset"
        trigger_time_resolved = sunset_dt.strftime("%I:%M %p").lstrip("0")
    elif matching_rules:
        top_rule = matching_rules[0]
        chosen_effect_id = top_rule["effect_id"]
        chosen_source = top_rule["rule_type"]
        trigger_type = top_rule["trigger_type"]
        dt = compute_trigger_datetime(
            target_date,
            top_rule["trigger_type"],
            top_rule["trigger_time"],
            top_rule["offset_minutes"],
            profile,
        )
        trigger_time_resolved = dt.strftime("%I:%M %p").lstrip("0")

    effect = effects_by_id.get(chosen_effect_id) if chosen_effect_id else None

    return DayScheduleSummary(
        date=target_date.isoformat(),
        effect_id=chosen_effect_id,
        effect_name=effect["name"] if effect else None,
        preview_colors=effect["preview_colors"] if effect else [],
        source=chosen_source,
        trigger_type=trigger_type,  # type: ignore[arg-type]
        trigger_time_resolved=trigger_time_resolved,
        sunset_time=sunset_dt.strftime("%I:%M %p").lstrip("0"),
        timed_events=timed_events,
        all_day_events=all_day_events,
    )


async def execute_effect_job(
    effect_id: int,
    trigger_source: str,
    scheduled_for: str,
    brightness_override: int | None = None,
) -> None:
    """Apply an effect from the DB onto the WLED controller and record an execution log."""
    profile = get_controller_profile()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM effects WHERE id = ?", (effect_id,)).fetchone()

    if not row:
        log_execution(scheduled_for, effect_id, "Unknown", trigger_source, "error", "Effect not found")
        return

    effect = row_to_effect(row)
    payload = adapt_payload_to_controller(
        effect["payload"],
        profile,
        segment_mode=effect["segment_mode"],
        brightness_override=brightness_override,
    )
    try:
        await apply_state(payload, host=profile.host)
        log_execution(scheduled_for, effect_id, effect["name"], trigger_source, "success")
    except Exception as exc:
        logger.exception("Failed to apply effect %s (%s)", effect_id, effect["name"])
        log_execution(scheduled_for, effect_id, effect["name"], trigger_source, "error", str(exc))


async def sync_due_feeds() -> None:
    """Background task to refresh enabled ICS / Google Calendar feeds when due."""
    profile = get_controller_profile()
    with get_conn() as conn:
        feeds = conn.execute("SELECT * FROM ics_feeds WHERE enabled = 1").fetchall()
        effects = [row_to_effect(r) for r in conn.execute("SELECT * FROM effects").fetchall()]

    now = datetime.now(timezone.utc)
    for feed in feeds:
        last_synced = feed["last_synced_at"]
        interval = int(feed["sync_interval_minutes"] or 30)
        if last_synced:
            try:
                last_dt = datetime.fromisoformat(last_synced)
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                else:
                    last_dt = last_dt.astimezone(timezone.utc)
                if (now - last_dt).total_seconds() < interval * 60:
                    continue
            except ValueError:
                pass
        try:
            keyword_map = json.loads(feed["auto_map_keywords_json"] or "{}")
            events = await fetch_and_parse_ics(
                url=feed["url"],
                tz_name=profile.timezone,
                effects=effects,
                keyword_overrides=keyword_map,
            )
            replace_feed_events(feed["id"], events)
        except Exception:
            logger.exception("Failed periodic sync for feed %s", feed["name"])


def replace_feed_events(feed_id: int, events: list[dict[str, Any]]) -> int:
    """Replace cached calendar_events for a feed and update last_synced_at."""
    with get_conn() as conn:
        conn.execute("DELETE FROM calendar_events WHERE feed_id = ?", (feed_id,))
        for ev in events:
            conn.execute(
                """
                INSERT INTO calendar_events (
                    feed_id, uid, summary, description, start_dt, end_dt,
                    is_all_day, matched_effect_id, match_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    feed_id,
                    ev["uid"],
                    ev["summary"],
                    ev["description"],
                    ev["start_dt"],
                    ev["end_dt"],
                    1 if ev["is_all_day"] else 0,
                    ev["matched_effect_id"],
                    ev["match_source"],
                ),
            )
        conn.execute(
            "UPDATE ics_feeds SET last_synced_at = ? WHERE id = ?",
            (utc_now_iso(), feed_id),
        )
    return len(events)


def refresh_daily_jobs() -> None:
    """Clear dynamic daily jobs and schedule today's baseline + timed Google Calendar jobs."""
    if _scheduler is None:
        return

    for job in _scheduler.get_jobs():
        if job.id.startswith("daily_") or job.id.startswith("gcal_"):
            job.remove()

    profile = get_controller_profile()
    tz = ZoneInfo(profile.timezone)
    now = datetime.now(tz)
    today = now.date()
    summary = resolve_day_schedule(today, profile)

    baseline_trigger_dt: datetime | None = None
    if summary.effect_id and summary.trigger_time_resolved:
        is_google_all_day = bool(summary.source and summary.source.startswith("google_all_day"))
        top_rule: dict[str, Any] | None = None
        if not is_google_all_day:
            with get_conn() as conn:
                rule_rows = conn.execute(
                    """
                    SELECT r.*, e.name AS effect_name
                    FROM schedule_rules r
                    JOIN effects e ON e.id = r.effect_id
                    WHERE r.enabled = 1
                    ORDER BY r.priority DESC, r.id DESC
                    """
                ).fetchall()
            rules = [row_to_rule(r) for r in rule_rows]
            matching = [r for r in rules if _rule_matches_date(r, today, summary.all_day_events)]
            explicit_date_rule = next((r for r in matching if r["rule_type"] == "date"), None)
            top_rule = explicit_date_rule or (matching[0] if matching else None)

        baseline_trigger_dt = compute_trigger_datetime(
            today,
            summary.trigger_type or "sunset",
            top_rule["trigger_time"] if top_rule else None,
            top_rule["offset_minutes"] if top_rule else 0,
            profile,
        )
        if baseline_trigger_dt > now:
            _scheduler.add_job(
                execute_effect_job,
                trigger=DateTrigger(run_date=baseline_trigger_dt),
                id=f"daily_baseline_{today.isoformat()}",
                args=[
                    summary.effect_id,
                    f"schedule:{summary.source}",
                    baseline_trigger_dt.isoformat(),
                    top_rule["brightness_override"] if top_rule else None,
                ],
                replace_existing=True,
            )

    # Schedule timed Google Calendar events
    for ev in summary.timed_events:
        if ev.matched_effect_id is None:
            continue
        start_dt = datetime.fromisoformat(ev.start_dt)
        end_dt = datetime.fromisoformat(ev.end_dt)
        if start_dt > now:
            _scheduler.add_job(
                execute_effect_job,
                trigger=DateTrigger(run_date=start_dt),
                id=f"gcal_start_{ev.id}",
                args=[ev.matched_effect_id, f"gcal:{ev.summary}", start_dt.isoformat()],
                replace_existing=True,
            )
        if (
            summary.effect_id
            and end_dt > now
            and end_dt.date() == today
            and (baseline_trigger_dt is None or end_dt >= baseline_trigger_dt)
        ):
            _scheduler.add_job(
                execute_effect_job,
                trigger=DateTrigger(run_date=end_dt),
                id=f"gcal_end_{ev.id}",
                args=[summary.effect_id, f"gcal_restore:{ev.summary}", end_dt.isoformat()],
                replace_existing=True,
            )


def _register_system_jobs(sched: AsyncIOScheduler, tz: ZoneInfo) -> None:
    """Register or update recurring system jobs in the controller timezone."""
    sched.add_job(
        refresh_daily_jobs,
        trigger=CronTrigger(hour=0, minute=1, timezone=tz),
        id="system_midnight_refresh",
        replace_existing=True,
    )
    sched.add_job(
        sync_due_feeds,
        trigger=CronTrigger(minute="*/15", timezone=tz),
        id="system_feed_sync",
        replace_existing=True,
    )


def reconfigure_scheduler() -> None:
    """Re-register system jobs in the current controller timezone and refresh today's jobs."""
    if _scheduler is not None:
        tz = ZoneInfo(get_controller_profile().timezone)
        _register_system_jobs(_scheduler, tz)
    refresh_daily_jobs()


def start_scheduler() -> AsyncIOScheduler:
    """Initialize and start APScheduler with midnight refresh and periodic feed sync."""
    global _scheduler
    if _scheduler is None:
        tz = ZoneInfo(get_controller_profile().timezone)
        _scheduler = AsyncIOScheduler(timezone=tz)
        _register_system_jobs(_scheduler, tz)
        _scheduler.start()
    refresh_daily_jobs()
    return _scheduler


def stop_scheduler() -> None:
    """Shut down APScheduler cleanly."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
