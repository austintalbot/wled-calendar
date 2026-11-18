"""Async WLED HTTP JSON API client and payload adapter."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from typing import Any

import httpx

from backend.config import settings
from backend.db import get_controller_profile, save_controller_profile, utc_now_iso
from backend.models import ControllerProfile, SegmentSpec

SEGMENT_ALLOWED_KEYS = {
    "fx",
    "sx",
    "ix",
    "pal",
    "c1",
    "c2",
    "c3",
    "col",
    "bri",
    "on",
    "rev",
    "mi",
    "grp",
    "spc",
    "of",
    "o1",
    "o2",
    "o3",
    "cct",
    "sel",
    "frz",
}


def _base_url(host: str) -> str:
    """Normalize host string into an HTTP base URL."""
    cleaned = host.strip().rstrip("/")
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        return cleaned
    return f"http://{cleaned}"


def _resolve_index(value: Any, names: list[str], max_count: int) -> int:
    """Resolve an effect or palette ID from an integer or string name, clamped to device bounds."""
    if isinstance(value, str):
        needle = value.strip().lower()
        for idx, name in enumerate(names):
            if name.lower() == needle:
                return idx
        for idx, name in enumerate(names):
            if needle in name.lower():
                return idx
        return 0
    if isinstance(value, (int, float)):
        idx = int(value)
        limit = max(len(names), max_count, 1)
        return max(0, min(idx, limit - 1))
    return 0


def extract_preview_colors(payload: dict[str, Any]) -> list[str]:
    """Extract up to 3 hex color strings from the first segment of a WLED payload."""
    segs = payload.get("seg")
    if not isinstance(segs, list) or not segs:
        return ["#38bdf8", "#818cf8"]
    first = segs[0] if isinstance(segs[0], dict) else {}
    cols = first.get("col")
    if not isinstance(cols, list) or not cols:
        return ["#38bdf8", "#818cf8"]

    hex_colors: list[str] = []
    for rgb in cols[:3]:
        if isinstance(rgb, list) and len(rgb) >= 3:
            r, g, b = (max(0, min(255, int(c))) for c in rgb[:3])
            if (r, g, b) != (0, 0, 0) or not hex_colors:
                hex_colors.append(f"#{r:02x}{g:02x}{b:02x}")
    return hex_colors or ["#38bdf8"]


def _normalize_segment(
    seg: dict[str, Any],
    spec: SegmentSpec,
    profile: ControllerProfile,
) -> dict[str, Any]:
    """Build a controller-compatible segment dict for a specific hardware SegmentSpec."""
    normalized: dict[str, Any] = {
        "id": spec.id,
        "start": spec.start,
        "stop": spec.stop,
        "on": seg.get("on", True),
        "bri": max(1, min(255, int(seg.get("bri", 255)))),
        "fx": _resolve_index(seg.get("fx", 0), profile.effects, profile.fx_count),
        "sx": max(0, min(255, int(seg.get("sx", 128)))),
        "ix": max(0, min(255, int(seg.get("ix", 128)))),
        "pal": _resolve_index(seg.get("pal", 0), profile.palettes, profile.pal_count),
        "c1": max(0, min(255, int(seg.get("c1", 128)))),
        "c2": max(0, min(255, int(seg.get("c2", 128)))),
        "c3": max(0, min(255, int(seg.get("c3", 16)))),
        "col": deepcopy(seg.get("col", [[255, 255, 255], [0, 0, 0], [0, 0, 0]])),
        "sel": True,
    }
    for optional_key in ("rev", "mi", "grp", "spc", "of", "o1", "o2", "o3", "cct", "frz"):
        if optional_key in seg:
            normalized[optional_key] = seg[optional_key]
    return normalized


def adapt_payload_to_controller(
    raw_state: dict[str, Any],
    profile: ControllerProfile,
    segment_mode: str = "mirror",
    brightness_override: int | None = None,
) -> dict[str, Any]:
    """Adapt an arbitrary WLED state/preset dict to the controller's hardware topology."""
    state = deepcopy(raw_state)
    # Remove preset-only metadata that should not be sent or can confuse /json/state
    for meta_key in ("n", "ql", "ps", "pl", "mainseg", "bs"):
        state.pop(meta_key, None)

    adapted: dict[str, Any] = {
        "on": state.get("on", True),
        "bri": max(
            1,
            min(
                255,
                int(brightness_override if brightness_override is not None else state.get("bri", 255)),
            ),
        ),
        "transition": max(0, min(255, int(state.get("transition", 7)))),
    }

    raw_segs = state.get("seg")
    if isinstance(raw_segs, dict):
        raw_segs = [raw_segs]
    if not isinstance(raw_segs, list) or not raw_segs:
        # Support top-level shorthand payloads (e.g. {"fx": 22, "pal": 21})
        shorthand = {k: v for k, v in state.items() if k in SEGMENT_ALLOWED_KEYS}
        raw_segs = [shorthand]

    # Filter out dummy {"stop": 0} entries common in WLED presets.json
    valid_raw_segs = [s for s in raw_segs if isinstance(s, dict) and s.get("stop", 1) != 0]
    if not valid_raw_segs:
        valid_raw_segs = [{}]

    target_specs = profile.segments or [SegmentSpec(id=0, start=0, stop=profile.led_count, len=profile.led_count)]
    adapted_segs: list[dict[str, Any]] = []

    for idx, spec in enumerate(target_specs):
        if segment_mode == "custom" and idx < len(valid_raw_segs):
            source_seg = valid_raw_segs[idx]
        else:
            source_seg = valid_raw_segs[0]
        adapted_segs.append(_normalize_segment(source_seg, spec, profile))

    adapted["seg"] = adapted_segs
    return adapted


async def sync_controller_profile(host: str | None = None) -> ControllerProfile:
    """Query /json/info, /json/cfg, /json/eff, and /json/pal from WLED and persist."""
    current = get_controller_profile()
    target_host = host or current.host
    base = _base_url(target_host)

    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        info_resp, cfg_resp, eff_resp, pal_resp = await asyncio.gather(
            client.get(f"{base}/json/info"),
            client.get(f"{base}/json/cfg"),
            client.get(f"{base}/json/eff"),
            client.get(f"{base}/json/pal"),
        )
        for resp in (info_resp, cfg_resp, eff_resp, pal_resp):
            resp.raise_for_status()

    info = info_resp.json()
    cfg = cfg_resp.json()
    effects = eff_resp.json()
    palettes = pal_resp.json()

    led_ins = cfg.get("hw", {}).get("led", {}).get("ins", [])
    segments: list[SegmentSpec] = []
    for idx, ins in enumerate(led_ins):
        length = int(ins.get("len", 0))
        if length <= 0:
            continue
        start = int(ins.get("start", 0))
        pins = ins.get("pin") or []
        segments.append(
            SegmentSpec(
                id=idx,
                start=start,
                stop=start + length,
                len=length,
                pin=int(pins[0]) if pins else None,
                name=ins.get("text") or f"Segment {idx + 1}",
            )
        )

    ntp = cfg.get("if", {}).get("ntp", {})
    lat = float(ntp.get("lt", current.latitude) or current.latitude)
    lon = float(ntp.get("ln", current.longitude) or current.longitude)

    updated = ControllerProfile(
        host=target_host,
        name=info.get("name", current.name),
        version=info.get("ver", current.version),
        led_count=int(info.get("leds", {}).get("count", current.led_count)),
        fx_count=int(info.get("fxcount", len(effects) or current.fx_count)),
        pal_count=int(info.get("palcount", len(palettes) or current.pal_count)),
        latitude=lat,
        longitude=lon,
        timezone=current.timezone,
        segments=segments or current.segments,
        effects=effects if isinstance(effects, list) else current.effects,
        palettes=palettes if isinstance(palettes, list) else current.palettes,
        last_synced_at=utc_now_iso(),
    )
    return save_controller_profile(updated)


async def fetch_live_state(host: str | None = None) -> dict[str, Any]:
    """Fetch live /json/state and /json/info from WLED."""
    profile = get_controller_profile()
    base = _base_url(host or profile.host)
    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        state_resp, info_resp = await asyncio.gather(
            client.get(f"{base}/json/state"),
            client.get(f"{base}/json/info"),
        )
        state_resp.raise_for_status()
        info_resp.raise_for_status()
        return {"state": state_resp.json(), "info": info_resp.json()}


async def fetch_controller_presets(host: str | None = None) -> list[dict[str, Any]]:
    """Fetch saved presets from WLED /presets.json."""
    profile = get_controller_profile()
    base = _base_url(host or profile.host)
    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        resp = await client.get(f"{base}/presets.json")
        resp.raise_for_status()
        raw = resp.json()

    results: list[dict[str, Any]] = []
    if not isinstance(raw, dict):
        return results

    for key, val in raw.items():
        if key == "0" or not isinstance(val, dict) or not val:
            continue
        if "seg" not in val and "playlist" not in val and "fx" not in val:
            continue
        name = val.get("n") or f"Controller Preset {key}"
        adapted = adapt_payload_to_controller(val, profile, segment_mode="custom")
        results.append(
            {
                "key": str(key),
                "name": name,
                "payload": adapted,
                "preview_colors": extract_preview_colors(adapted),
            }
        )
    return results


async def apply_state(payload: dict[str, Any], host: str | None = None) -> dict[str, Any]:
    """Send a state payload to WLED POST /json/state."""
    profile = get_controller_profile()
    base = _base_url(host or profile.host)
    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        resp = await client.post(f"{base}/json/state", json=payload)
        resp.raise_for_status()
        return resp.json()
