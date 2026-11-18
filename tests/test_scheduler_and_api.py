"""Tests for schedule resolution priority, astral sunset, and FastAPI endpoints."""

from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient

from backend.main import app
from backend.scheduler import replace_feed_events, resolve_day_schedule


def test_schedule_priority_and_api_flow() -> None:
    with TestClient(app) as client:
        # 1. Import 2 curated effects
        res = client.post(
            "/api/effects/import/curated",
            json={"slugs": ["warm-sunset", "christmas-twinkle"]},
        )
        assert res.status_code == 200
        imported = res.json()["imported"]
        assert len(imported) == 2
        sunset_id = imported[0]["id"]
        xmas_id = imported[1]["id"]

        # 2. Create a default rule (priority 10)
        res = client.post(
            "/api/schedule/rules",
            json={
                "rule_type": "default",
                "effect_id": sunset_id,
                "trigger_type": "sunset",
            },
        )
        assert res.status_code == 200

        # 3. Create an explicit date override for 2026-12-25 (priority 100)
        res = client.post(
            "/api/schedule/rules",
            json={
                "rule_type": "date",
                "start_date": "2026-12-25",
                "effect_id": xmas_id,
                "trigger_type": "fixed_time",
                "trigger_time": "17:30",
            },
        )
        assert res.status_code == 200

        # 4. Verify month endpoint resolves 2026-12-24 -> Warm Sunset Glow, 2026-12-25 -> Christmas
        month_res = client.get("/api/schedule/month?year=2026&month=12")
        assert month_res.status_code == 200
        days = {d["date"]: d for d in month_res.json()["days"]}

        assert days["2026-12-24"]["effect_id"] == sunset_id
        assert days["2026-12-24"]["source"] == "default"
        assert days["2026-12-24"]["sunset_time"] is not None

        assert days["2026-12-25"]["effect_id"] == xmas_id
        assert days["2026-12-25"]["source"] == "date"
        assert days["2026-12-25"]["trigger_time_resolved"] == "5:30 PM"

        # 5. Add a Google Calendar feed and simulate an all-day matched event on 2026-12-24
        feed_res = client.post(
            "/api/feeds",
            json={
                "name": "Family Google Cal",
                "feed_type": "google_calendar",
                "url": "https://calendar.google.com/calendar/ical/example/basic.ics",
            },
        )
        assert feed_res.status_code == 200
        feed_id = feed_res.json()["feed"]["id"]

        replace_feed_events(
            feed_id,
            [
                {
                    "uid": "gcal-eve",
                    "summary": "Christmas Eve",
                    "description": "",
                    "start_dt": "2026-12-24T00:00:00-07:00",
                    "end_dt": "2026-12-25T00:00:00-07:00",
                    "is_all_day": True,
                    "matched_effect_id": xmas_id,
                    "match_source": "auto:christmas",
                }
            ],
        )

        dec24 = resolve_day_schedule(date(2026, 12, 24))
        assert dec24.effect_id == xmas_id
        assert "google_all_day" in (dec24.source or "")
