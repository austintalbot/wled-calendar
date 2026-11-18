"""WLED controller status, sync, and live apply endpoints."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
import websockets

from backend.db import get_conn, get_controller_profile, log_execution, row_to_effect, save_controller_profile, utc_now_iso
from backend.models import ControllerSettingsUpdate, SegmentMode
from backend.scheduler import reconfigure_scheduler
from backend.wled_client import (
    adapt_payload_to_controller,
    apply_state,
    delete_preset_from_controller,
    fetch_controller_presets,
    fetch_live_state,
    save_preset_to_controller,
    sync_controller_profile,
)

router = APIRouter(prefix="/api/controller", tags=["controller"])


class ApplyRequest(BaseModel):
    """Apply either a saved effect_id or a raw WLED payload immediately."""

    effect_id: int | None = None
    payload: dict[str, Any] | None = None
    segment_mode: SegmentMode = "mirror"
    brightness_override: int | None = None


class SavePresetRequest(BaseModel):
    """Save or overwrite a preset slot on the WLED controller."""

    effect_id: int
    slot_id: int = Field(..., ge=1, le=250)
    name: str | None = None


@router.get("/status")
async def get_status() -> dict[str, Any]:
    """Return cached controller profile plus live WLED state if reachable."""
    profile = get_controller_profile()
    online = False
    live_state: dict[str, Any] | None = None
    live_info: dict[str, Any] | None = None
    error: str | None = None

    try:
        live = await fetch_live_state(profile.host)
        online = True
        live_state = live["state"]
        live_info = live["info"]
    except Exception as exc:
        error = str(exc)

    return {
        "online": online,
        "error": error,
        "profile": profile.model_dump(),
        "live_state": live_state,
        "live_info": live_info,
    }


@router.post("/sync")
async def sync_profile() -> dict[str, Any]:
    """Sync hardware segments, effects, palettes, and coordinates from WLED."""
    profile = get_controller_profile()
    try:
        updated = await sync_controller_profile(profile.host)
        return {"profile": updated.model_dump()}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to sync WLED at {profile.host}: {exc}") from exc


@router.get("/presets")
async def get_controller_presets() -> dict[str, Any]:
    """Fetch saved presets directly from the WLED controller /presets.json."""
    profile = get_controller_profile()
    try:
        presets = await fetch_controller_presets(profile.host)
        return {"presets": presets}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch presets from {profile.host}: {exc}") from exc


@router.put("/settings")
async def update_controller_settings(body: ControllerSettingsUpdate) -> dict[str, Any]:
    """Update controller host, coordinates, or timezone."""
    profile = get_controller_profile()
    if body.host is not None:
        profile.host = body.host.strip()
    if body.latitude is not None:
        profile.latitude = body.latitude
    if body.longitude is not None:
        profile.longitude = body.longitude
    if body.timezone is not None:
        profile.timezone = body.timezone.strip()
    saved = save_controller_profile(profile)
    reconfigure_scheduler()
    return {"profile": saved.model_dump()}


@router.post("/presets/save")
async def save_controller_preset(body: SavePresetRequest) -> dict[str, Any]:
    """Save or overwrite a saved effect into a WLED controller preset slot (1-250)."""
    profile = get_controller_profile()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM effects WHERE id = ?", (body.effect_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Effect not found")

    effect = row_to_effect(row)
    preset_name = (body.name or effect["name"]).strip()[:32]
    payload = adapt_payload_to_controller(effect["payload"], profile, segment_mode=effect["segment_mode"])

    try:
        res = await save_preset_to_controller(body.slot_id, preset_name, payload, host=profile.host)
        log_execution(utc_now_iso(), body.effect_id, preset_name, f"preset_save:#{body.slot_id}", "success")
        return {"ok": True, "slot_id": body.slot_id, "name": preset_name, "wled_response": res}
    except Exception as exc:
        log_execution(utc_now_iso(), body.effect_id, preset_name, f"preset_save:#{body.slot_id}", "error", str(exc))
        raise HTTPException(status_code=502, detail=f"Failed to save preset to WLED: {exc}") from exc


@router.delete("/presets/{slot_id}")
async def remove_controller_preset(slot_id: int) -> dict[str, Any]:
    """Delete a preset slot (1-250) from the WLED controller."""
    profile = get_controller_profile()
    try:
        res = await delete_preset_from_controller(slot_id, host=profile.host)
        return {"ok": True, "deleted_slot": slot_id, "wled_response": res}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to delete preset from WLED: {exc}") from exc


@router.post("/apply")
async def apply_now(body: ApplyRequest) -> dict[str, Any]:
    """Immediately push an effect or raw WLED state to the controller."""
    profile = get_controller_profile()
    effect_name = "Custom State"
    effect_id = body.effect_id

    if effect_id is not None:
        with get_conn() as conn:
            row = conn.execute("SELECT * FROM effects WHERE id = ?", (effect_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Effect not found")
        effect = row_to_effect(row)
        effect_name = effect["name"]
        payload = adapt_payload_to_controller(
            effect["payload"],
            profile,
            segment_mode=effect["segment_mode"],
            brightness_override=body.brightness_override,
        )
    elif body.payload is not None:
        payload = adapt_payload_to_controller(
            body.payload,
            profile,
            segment_mode=body.segment_mode,
            brightness_override=body.brightness_override,
        )
    else:
        raise HTTPException(status_code=400, detail="Provide either effect_id or payload")

    try:
        result = await apply_state(payload, host=profile.host)
        log_execution(utc_now_iso(), effect_id, effect_name, "manual", "success")
        return {"ok": True, "applied_payload": payload, "wled_response": result}
    except Exception as exc:
        log_execution(utc_now_iso(), effect_id, effect_name, "manual", "error", str(exc))
        raise HTTPException(status_code=502, detail=f"Failed to apply to WLED: {exc}") from exc


@router.websocket("/live-stream")
async def live_stream(websocket: WebSocket) -> None:
    """Proxy WLED's WebSocket live-view RGB stream (`lv: true`) to the browser."""
    await websocket.accept()
    profile = get_controller_profile()
    wled_ws_url = f"ws://{profile.host}/ws"

    try:
        async with websockets.connect(wled_ws_url, proxy=None, open_timeout=5) as wled_ws:
            await wled_ws.send('{"lv":true}')

            async def forward_from_wled() -> None:
                async for msg in wled_ws:
                    if isinstance(msg, (bytes, bytearray)) and len(msg) > 2 and msg[0] == 0x4C:
                        await websocket.send_bytes(bytes(msg))

            async def watch_client() -> None:
                while True:
                    await websocket.receive_text()

            t1 = asyncio.create_task(forward_from_wled())
            t2 = asyncio.create_task(watch_client())
            _, pending = await asyncio.wait({t1, t2}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            try:
                await wled_ws.send('{"lv":false}')
            except Exception:
                pass
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
