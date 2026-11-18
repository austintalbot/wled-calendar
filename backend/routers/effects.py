"""Effect library CRUD and multi-source import endpoints."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException

from backend.db import get_conn, get_controller_profile, row_to_effect, utc_now_iso
from backend.importers.curated_library import build_curated_presets
from backend.importers.url_importer import fetch_presets_from_url, parse_wled_json_presets
from backend.models import CuratedImportRequest, EffectCreate, JsonImportRequest, UrlImportRequest
from backend.wled_client import adapt_payload_to_controller, extract_preview_colors

router = APIRouter(prefix="/api/effects", tags=["effects"])


def _insert_effect(
    name: str,
    source_type: str,
    source_url: str | None,
    payload: dict[str, Any],
    segment_mode: str,
    tags: list[str],
    preview_colors: list[str] | None = None,
) -> dict[str, Any]:
    """Insert a normalized effect into SQLite and return the created record."""
    colors = preview_colors or extract_preview_colors(payload)
    created_at = utc_now_iso()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO effects (
                name, source_type, source_url, payload_json, segment_mode,
                tags_json, preview_colors_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                source_type,
                source_url,
                json.dumps(payload),
                segment_mode,
                json.dumps(tags),
                json.dumps(colors),
                created_at,
            ),
        )
        row = conn.execute("SELECT * FROM effects WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_effect(row)


@router.get("")
def list_effects() -> dict[str, Any]:
    """List all saved effects ordered newest first."""
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM effects ORDER BY id DESC").fetchall()
    return {"effects": [row_to_effect(r) for r in rows]}


@router.post("")
def create_effect(body: EffectCreate) -> dict[str, Any]:
    """Create a new effect, normalizing its payload to the controller topology."""
    profile = get_controller_profile()
    adapted = adapt_payload_to_controller(body.payload, profile, segment_mode=body.segment_mode)
    record = _insert_effect(
        name=body.name,
        source_type=body.source_type,
        source_url=body.source_url,
        payload=adapted,
        segment_mode=body.segment_mode,
        tags=body.tags,
        preview_colors=body.preview_colors or extract_preview_colors(adapted),
    )
    return {"effect": record}


@router.put("/{effect_id}")
def update_effect(effect_id: int, body: EffectCreate) -> dict[str, Any]:
    """Update an existing effect."""
    profile = get_controller_profile()
    adapted = adapt_payload_to_controller(body.payload, profile, segment_mode=body.segment_mode)
    colors = body.preview_colors or extract_preview_colors(adapted)
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM effects WHERE id = ?", (effect_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Effect not found")
        conn.execute(
            """
            UPDATE effects
            SET name = ?, source_type = ?, source_url = ?, payload_json = ?,
                segment_mode = ?, tags_json = ?, preview_colors_json = ?
            WHERE id = ?
            """,
            (
                body.name,
                body.source_type,
                body.source_url,
                json.dumps(adapted),
                body.segment_mode,
                json.dumps(body.tags),
                json.dumps(colors),
                effect_id,
            ),
        )
        row = conn.execute("SELECT * FROM effects WHERE id = ?", (effect_id,)).fetchone()
    return {"effect": row_to_effect(row)}


@router.delete("/{effect_id}")
def delete_effect(effect_id: int) -> dict[str, bool]:
    """Delete an effect by ID."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM effects WHERE id = ?", (effect_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Effect not found")
    return {"deleted": True}


@router.post("/import/url")
async def import_from_url(body: UrlImportRequest) -> dict[str, Any]:
    """Fetch WLED preset JSON from a URL (GitHub/Gist/Pastebin/raw) and optionally import."""
    profile = get_controller_profile()
    try:
        raw_url, presets = await fetch_presets_from_url(body.url, profile)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to import from URL: {exc}") from exc

    if not body.import_all and not body.selected_keys:
        return {"raw_url": raw_url, "presets": presets, "imported": []}

    selected = set(body.selected_keys or [])
    imported: list[dict[str, Any]] = []
    for item in presets:
        if body.import_all or item["key"] in selected:
            imported.append(
                _insert_effect(
                    name=item["name"],
                    source_type="url",
                    source_url=raw_url,
                    payload=item["payload"],
                    segment_mode="mirror",
                    tags=["imported", "url"],
                    preview_colors=item["preview_colors"],
                )
            )
    return {"raw_url": raw_url, "presets": presets, "imported": imported}


@router.post("/import/json")
def import_from_json(body: JsonImportRequest) -> dict[str, Any]:
    """Parse pasted WLED JSON and save all detected presets."""
    profile = get_controller_profile()
    try:
        presets = parse_wled_json_presets(body.raw_json, profile, default_name=body.name)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid WLED JSON: {exc}") from exc

    imported: list[dict[str, Any]] = []
    for item in presets:
        adapted = adapt_payload_to_controller(item["payload"], profile, segment_mode=body.segment_mode)
        imported.append(
            _insert_effect(
                name=item["name"] if len(presets) > 1 else body.name,
                source_type="json",
                source_url=None,
                payload=adapted,
                segment_mode=body.segment_mode,
                tags=body.tags or ["imported", "json"],
                preview_colors=extract_preview_colors(adapted),
            )
        )
    return {"imported": imported}


@router.get("/curated")
def list_curated() -> dict[str, Any]:
    """Return built-in seasonal and holiday presets resolved for this controller."""
    profile = get_controller_profile()
    return {"curated": build_curated_presets(profile)}


@router.post("/import/curated")
def import_curated(body: CuratedImportRequest) -> dict[str, Any]:
    """Import selected curated presets by slug into the saved effect library."""
    profile = get_controller_profile()
    catalog = {item["slug"]: item for item in build_curated_presets(profile)}
    imported: list[dict[str, Any]] = []
    for slug in body.slugs:
        item = catalog.get(slug)
        if not item:
            continue
        imported.append(
            _insert_effect(
                name=item["name"],
                source_type="curated",
                source_url=None,
                payload=item["payload"],
                segment_mode="mirror",
                tags=item["tags"],
                preview_colors=item["preview_colors"],
            )
        )
    return {"imported": imported}
