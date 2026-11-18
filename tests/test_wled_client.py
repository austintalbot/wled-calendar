"""Tests for WLED controller client, profile sync, and 3-segment payload adaptation."""

from __future__ import annotations

import httpx
import pytest
import respx

from backend.models import ControllerProfile, SegmentSpec
from backend.wled_client import adapt_payload_to_controller, sync_controller_profile


def _sample_profile() -> ControllerProfile:
    return ControllerProfile(
        host="192.168.68.200",
        name="WLED",
        version="16.0.1",
        led_count=1078,
        fx_count=220,
        pal_count=74,
        latitude=43.45,
        longitude=-112.03,
        timezone="America/Boise",
        segments=[
            SegmentSpec(id=0, start=0, stop=712, len=712, pin=16, name="Seg 1"),
            SegmentSpec(id=1, start=712, stop=824, len=112, pin=3, name="Seg 2"),
            SegmentSpec(id=2, start=824, stop=1078, len=254, pin=1, name="Seg 3"),
        ],
        effects=["Solid", "Blink", "Breathe", "Rainbow", "Sparkle"],
        palettes=["Default", "Party", "Sunset", "Forest"],
    )


def test_adapt_mirrors_single_segment_to_three_controller_segments() -> None:
    profile = _sample_profile()
    internet_preset = {
        "on": True,
        "bri": 200,
        "n": "Cool Internet Preset",
        "seg": [
            {
                "start": 0,
                "stop": 300,
                "fx": "Rainbow",
                "pal": "Sunset",
                "sx": 140,
                "ix": 160,
                "col": [[255, 100, 0], [0, 0, 0], [0, 0, 0]],
            }
        ],
    }

    adapted = adapt_payload_to_controller(internet_preset, profile, segment_mode="mirror")
    assert "n" not in adapted
    assert adapted["bri"] == 200
    assert len(adapted["seg"]) == 3
    assert [(s["id"], s["start"], s["stop"]) for s in adapted["seg"]] == [
        (0, 0, 712),
        (1, 712, 824),
        (2, 824, 1078),
    ]
    # All 3 segments get Rainbow (idx 3) and Sunset (idx 2)
    for seg in adapted["seg"]:
        assert seg["fx"] == 3
        assert seg["pal"] == 2


def test_adapt_clamps_out_of_range_ids_and_preserves_custom_segments() -> None:
    profile = _sample_profile()
    custom_preset = {
        "bri": 255,
        "seg": [
            {"fx": 999, "pal": -5, "col": [[255, 0, 0]]},
            {"fx": 1, "pal": 1, "col": [[0, 255, 0]]},
            {"fx": 2, "pal": 2, "col": [[0, 0, 255]]},
        ],
    }

    adapted = adapt_payload_to_controller(custom_preset, profile, segment_mode="custom", brightness_override=150)
    assert adapted["bri"] == 150
    assert adapted["seg"][0]["fx"] == 219  # clamped to fx_count - 1
    assert adapted["seg"][0]["pal"] == 0   # clamped to 0
    assert adapted["seg"][1]["fx"] == 1
    assert adapted["seg"][2]["fx"] == 2


@pytest.mark.asyncio
async def test_sync_controller_profile_parses_wled_endpoints() -> None:
    profile_host = "192.168.68.200"
    with respx.mock(assert_all_called=True) as mock:
        mock.get(f"http://{profile_host}/json/info").mock(
            return_value=httpx.Response(
                200,
                json={
                    "ver": "16.0.1",
                    "name": "WLED",
                    "leds": {"count": 1078},
                    "fxcount": 3,
                    "palcount": 2,
                },
            )
        )
        mock.get(f"http://{profile_host}/json/cfg").mock(
            return_value=httpx.Response(
                200,
                json={
                    "hw": {
                        "led": {
                            "ins": [
                                {"start": 0, "len": 712, "pin": [16]},
                                {"start": 712, "len": 112, "pin": [3]},
                                {"start": 824, "len": 254, "pin": [1]},
                            ]
                        }
                    },
                    "if": {"ntp": {"lt": 43.45, "ln": -112.03}},
                },
            )
        )
        mock.get(f"http://{profile_host}/json/eff").mock(
            return_value=httpx.Response(200, json=["Solid", "Blink", "Breathe"])
        )
        mock.get(f"http://{profile_host}/json/pal").mock(
            return_value=httpx.Response(200, json=["Default", "Party"])
        )

        synced = await sync_controller_profile(profile_host)

    assert synced.version == "16.0.1"
    assert synced.led_count == 1078
    assert len(synced.segments) == 3
    assert synced.segments[0].stop == 712
    assert synced.segments[2].start == 824
    assert synced.latitude == 43.45
