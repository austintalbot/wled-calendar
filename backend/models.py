"""Pydantic data models for WLED Calendar API and internal services."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


SegmentMode = Literal["mirror", "custom"]
SourceType = Literal["curated", "url", "json", "wled_preset", "manual"]
RuleType = Literal["date", "date_range", "day_of_week", "holiday", "default"]
TriggerType = Literal["fixed_time", "sunset", "sunrise"]
FeedType = Literal["google_calendar", "holiday_ics"]


class SegmentSpec(BaseModel):
    """Hardware segment boundary on the WLED controller."""

    id: int
    start: int
    stop: int
    len: int
    pin: int | None = None
    name: str = ""


class ControllerProfile(BaseModel):
    """Cached hardware and capability profile of the target WLED controller."""

    host: str
    name: str = "WLED"
    version: str = "unknown"
    led_count: int = 1078
    fx_count: int = 220
    pal_count: int = 74
    latitude: float = 43.45
    longitude: float = -112.03
    timezone: str = "America/Boise"
    segments: list[SegmentSpec] = Field(default_factory=list)
    effects: list[str] = Field(default_factory=list)
    palettes: list[str] = Field(default_factory=list)
    last_synced_at: str | None = None


class EffectCreate(BaseModel):
    """Payload to create or update an effect in the library."""

    name: str = Field(..., min_length=1, max_length=120)
    source_type: SourceType = "manual"
    source_url: str | None = None
    payload: dict[str, Any]
    segment_mode: SegmentMode = "mirror"
    tags: list[str] = Field(default_factory=list)
    preview_colors: list[str] = Field(default_factory=list)


class EffectRecord(EffectCreate):
    """Persisted effect record returned by the API."""

    id: int
    created_at: str


class UrlImportRequest(BaseModel):
    """Request to fetch and preview presets from a URL."""

    url: str
    import_all: bool = False
    selected_keys: list[str] | None = None


class JsonImportRequest(BaseModel):
    """Request to parse and import raw WLED JSON."""

    name: str = "Imported Effect"
    raw_json: str | dict[str, Any]
    segment_mode: SegmentMode = "mirror"
    tags: list[str] = Field(default_factory=list)


class CuratedImportRequest(BaseModel):
    """Request to import one or more curated presets by slug."""

    slugs: list[str]


class ScheduleRuleCreate(BaseModel):
    """Payload to create or update a schedule rule."""

    rule_type: RuleType
    start_date: str | None = None
    end_date: str | None = None
    days_of_week: list[int] = Field(default_factory=list)  # 0=Mon .. 6=Sun
    holiday_name: str | None = None
    effect_id: int
    trigger_type: TriggerType = "sunset"
    trigger_time: str | None = None  # HH:MM for fixed_time
    offset_minutes: int = 0
    brightness_override: int | None = Field(default=None, ge=1, le=255)
    priority: int | None = None
    enabled: bool = True


class ScheduleRuleRecord(ScheduleRuleCreate):
    """Persisted schedule rule."""

    id: int
    effect_name: str | None = None
    created_at: str


class FeedCreate(BaseModel):
    """Payload to add an ICS or Google Calendar Secret iCal feed."""

    name: str = Field(..., min_length=1, max_length=120)
    feed_type: FeedType = "google_calendar"
    url: str = Field(..., min_length=8)
    sync_interval_minutes: int = Field(default=30, ge=5, le=1440)
    auto_map_keywords: dict[str, int] = Field(default_factory=dict)
    enabled: bool = True


class FeedRecord(FeedCreate):
    """Persisted calendar feed."""

    id: int
    last_synced_at: str | None = None
    created_at: str


class CalendarEventRecord(BaseModel):
    """Cached event from an ICS / Google Calendar feed."""

    id: int
    feed_id: int
    uid: str
    summary: str
    description: str
    start_dt: str
    end_dt: str
    is_all_day: bool
    matched_effect_id: int | None = None
    matched_effect_name: str | None = None
    match_source: str | None = None


class DayScheduleSummary(BaseModel):
    """Resolved schedule summary for a single calendar day."""

    date: str
    effect_id: int | None = None
    effect_name: str | None = None
    preview_colors: list[str] = Field(default_factory=list)
    source: str | None = None  # rule_type or google_all_day
    trigger_type: TriggerType | None = None
    trigger_time_resolved: str | None = None
    sunset_time: str | None = None
    timed_events: list[CalendarEventRecord] = Field(default_factory=list)
    all_day_events: list[CalendarEventRecord] = Field(default_factory=list)


class ControllerSettingsUpdate(BaseModel):
    """Update controller host or geo coordinates."""

    host: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    timezone: str | None = None
