"""Google Calendar Secret iCal URL and ICS holiday feed parser & matcher."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import recurring_ical_events
from icalendar import Calendar

from backend.config import settings

TAG_PATTERN = re.compile(r"(?:\[wled:\s*([^\]]+)\]|#wled:([A-Za-z0-9 _-]+))", re.IGNORECASE)

DEFAULT_KEYWORD_MAP = {
    "christmas": ["christmas", "xmas"],
    "halloween": ["halloween", "spooky"],
    "thanksgiving": ["thanksgiving", "harvest", "autumn"],
    "independence day": ["july 4", "4th of july", "fireworks", "patriotic"],
    "new year": ["new year", "champagne"],
    "valentine": ["valentine", "rose"],
    "st. patrick": ["st. patrick", "emerald", "shamrock"],
    "easter": ["easter", "pastel", "spring"],
    "birthday": ["birthday", "party", "rainbow"],
    "game day": ["game day", "stadium"],
}


def match_event_to_effect(
    summary: str,
    description: str,
    effects: list[dict[str, Any]],
    keyword_overrides: dict[str, int] | None = None,
) -> tuple[int | None, str | None]:
    """Match an ICS event to a saved effect via explicit [wled: ...] tag or keyword rules."""
    combined_text = f"{summary}\n{description}"

    # 1. Explicit [wled: Effect Name] or #wled:EffectName tag
    tag_match = TAG_PATTERN.search(combined_text)
    if tag_match:
        target = (tag_match.group(1) or tag_match.group(2) or "").strip().lower()
        for eff in effects:
            if eff["name"].lower() == target:
                return eff["id"], f"tag:{target}"
        for eff in effects:
            if target and target in eff["name"].lower():
                return eff["id"], f"tag:{target}"

    lower_text = combined_text.lower()

    # 2. User-configured feed keyword overrides
    if keyword_overrides:
        for kw, eff_id in keyword_overrides.items():
            if kw.strip().lower() in lower_text:
                return eff_id, f"keyword:{kw}"

    # 3. Built-in holiday / celebration keyword matching against saved effects
    for trigger_kw, effect_needles in DEFAULT_KEYWORD_MAP.items():
        if trigger_kw in lower_text:
            for eff in effects:
                eff_name = eff["name"].lower()
                eff_tags = " ".join(eff.get("tags", [])).lower()
                if any(n in eff_name or n in eff_tags for n in effect_needles):
                    return eff["id"], f"auto:{trigger_kw}"

    return None, None


def parse_ics_events(
    ics_text: str,
    tz_name: str,
    effects: list[dict[str, Any]],
    keyword_overrides: dict[str, int] | None = None,
    window_days_back: int = 30,
    window_days_forward: int = 365,
) -> list[dict[str, Any]]:
    """Parse an ICS string (expanding recurring events) into normalized event dicts."""
    cal = Calendar.from_ical(ics_text)
    tz = ZoneInfo(tz_name)
    now_local = datetime.now(tz)
    start_bound = (now_local - timedelta(days=window_days_back)).date()
    end_bound = (now_local + timedelta(days=window_days_forward)).date()

    expanded = recurring_ical_events.of(cal).between(start_bound, end_bound)
    parsed: list[dict[str, Any]] = []

    for component in expanded:
        uid = str(component.get("UID", ""))
        summary = str(component.get("SUMMARY", "Untitled Event"))
        description = str(component.get("DESCRIPTION", ""))
        dtstart_prop = component.get("DTSTART")
        dtend_prop = component.get("DTEND")
        if not dtstart_prop:
            continue

        raw_start = dtstart_prop.dt
        raw_end = dtend_prop.dt if dtend_prop else raw_start
        is_all_day = isinstance(raw_start, date) and not isinstance(raw_start, datetime)

        if is_all_day:
            start_dt = datetime.combine(raw_start, time.min, tzinfo=tz)
            if isinstance(raw_end, date) and not isinstance(raw_end, datetime):
                end_dt = datetime.combine(raw_end, time.min, tzinfo=tz)
            else:
                end_dt = start_dt + timedelta(days=1)
        else:
            start_dt = raw_start.replace(tzinfo=tz) if raw_start.tzinfo is None else raw_start.astimezone(tz)
            if isinstance(raw_end, datetime):
                end_dt = raw_end.replace(tzinfo=tz) if raw_end.tzinfo is None else raw_end.astimezone(tz)
            else:
                end_dt = start_dt + timedelta(hours=1)

        matched_id, match_source = match_event_to_effect(
            summary=summary,
            description=description,
            effects=effects,
            keyword_overrides=keyword_overrides,
        )

        parsed.append(
            {
                "uid": uid or f"{summary}-{start_dt.isoformat()}",
                "summary": summary,
                "description": description,
                "start_dt": start_dt.isoformat(),
                "end_dt": end_dt.isoformat(),
                "is_all_day": is_all_day,
                "matched_effect_id": matched_id,
                "match_source": match_source,
            }
        )

    return parsed


async def fetch_and_parse_ics(
    url: str,
    tz_name: str,
    effects: list[dict[str, Any]],
    keyword_overrides: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """Download an ICS / Google Calendar Secret iCal URL and parse events."""
    async with httpx.AsyncClient(timeout=settings.http_timeout, follow_redirects=True) as client:
        resp = await client.get(url.strip())
        resp.raise_for_status()
        ics_text = resp.text

    return parse_ics_events(
        ics_text=ics_text,
        tz_name=tz_name,
        effects=effects,
        keyword_overrides=keyword_overrides,
    )
