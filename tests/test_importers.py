"""Tests for URL/Gist/Pastebin rewriting, JSON preset parsing, and Google Calendar ICS matching."""

from __future__ import annotations

from datetime import date, timedelta

from backend.db import get_controller_profile
from backend.importers.ics_importer import parse_ics_events
from backend.importers.url_importer import parse_wled_json_presets, rewrite_to_raw_url


def test_rewrite_to_raw_url() -> None:
    assert (
        rewrite_to_raw_url("https://github.com/user/repo/blob/main/presets.json")
        == "https://raw.githubusercontent.com/user/repo/main/presets.json"
    )
    assert (
        rewrite_to_raw_url("https://gist.github.com/user/abc123def456")
        == "https://gist.githubusercontent.com/user/abc123def456/raw"
    )
    assert (
        rewrite_to_raw_url("https://pastebin.com/XyZ987")
        == "https://pastebin.com/raw/XyZ987"
    )


def test_parse_single_and_bundle_presets() -> None:
    profile = get_controller_profile()
    bundle = {
        "0": {},
        "1": {"n": "Sparkle-sunset", "bri": 255, "seg": [{"fx": 22, "pal": 21}]},
        "2": {"n": "Lake-sunset", "bri": 200, "seg": [{"fx": 75, "pal": 21}]},
    }
    parsed = parse_wled_json_presets(bundle, profile)
    assert len(parsed) == 2
    assert parsed[0]["name"] == "Sparkle-sunset"
    assert len(parsed[0]["payload"]["seg"]) == 3


def test_parse_ics_google_calendar_tag_and_keyword_matching() -> None:
    today = date.today()
    tomorrow = today + timedelta(days=1)
    day_after = today + timedelta(days=2)

    ics_content = f"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VEVENT
UID:evt-1
DTSTART;VALUE=DATE:{today.strftime('%Y%m%d')}
DTEND;VALUE=DATE:{tomorrow.strftime('%Y%m%d')}
SUMMARY:Christmas Eve
DESCRIPTION:Holiday lights
END:VEVENT
BEGIN:VEVENT
UID:evt-2
DTSTART:{tomorrow.strftime('%Y%m%d')}T190000
DTEND:{tomorrow.strftime('%Y%m%d')}T210000
SUMMARY:Movie Night [wled: Warm Sunset Glow]
DESCRIPTION:Dim lights for movie
END:VEVENT
BEGIN:VEVENT
UID:evt-3
DTSTART;VALUE=DATE:{day_after.strftime('%Y%m%d')}
DTEND;VALUE=DATE:{(day_after + timedelta(days=1)).strftime('%Y%m%d')}
SUMMARY:Dentist Appointment
END:VEVENT
END:VCALENDAR
"""
    effects = [
        {"id": 1, "name": "Christmas Classic Twinkle", "tags": ["holiday", "christmas"]},
        {"id": 2, "name": "Warm Sunset Glow", "tags": ["everyday", "sunset"]},
    ]

    events = parse_ics_events(ics_content, "America/Boise", effects)
    assert len(events) == 3

    evt1 = next(e for e in events if e["uid"] == "evt-1")
    assert evt1["is_all_day"] is True
    assert evt1["matched_effect_id"] == 1
    assert evt1["match_source"] == "auto:christmas"

    evt2 = next(e for e in events if e["uid"] == "evt-2")
    assert evt2["is_all_day"] is False
    assert evt2["matched_effect_id"] == 2
    assert evt2["match_source"] == "tag:warm sunset glow"

    evt3 = next(e for e in events if e["uid"] == "evt-3")
    assert evt3["matched_effect_id"] is None
