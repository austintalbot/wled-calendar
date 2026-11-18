"""Import WLED presets from raw JSON URLs, GitHub, Gists, and Pastebin."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from backend.config import settings
from backend.models import ControllerProfile
from backend.wled_client import adapt_payload_to_controller, extract_preview_colors


def rewrite_to_raw_url(url: str) -> str:
    """Convert GitHub, Gist, and Pastebin web URLs into raw content URLs."""
    cleaned = url.strip()

    # GitHub file blob -> raw.githubusercontent.com
    gh_match = re.match(r"^https?://github\.com/([^/]+)/([^/]+)/blob/(.+)$", cleaned)
    if gh_match:
        owner, repo, rest = gh_match.groups()
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{rest}"

    # GitHub Gist -> append /raw if not already raw
    gist_match = re.match(r"^https?://gist\.github\.com/([^/]+/[a-fA-F0-9]+)(?:/.*)?$", cleaned)
    if gist_match and "/raw" not in cleaned:
        return f"https://gist.githubusercontent.com/{gist_match.group(1)}/raw"

    # Pastebin -> pastebin.com/raw/<id>
    pb_match = re.match(r"^https?://pastebin\.com/(?!raw/)([A-Za-z0-9]+)$", cleaned)
    if pb_match:
        return f"https://pastebin.com/raw/{pb_match.group(1)}"

    return cleaned


def _parse_commented_json_lines(
    text: str,
    profile: ControllerProfile,
    default_name: str,
) -> list[dict[str, Any]]:
    """Parse community files formatted as `// Preset Name` followed by JSON objects."""
    presets: list[dict[str, Any]] = []
    pending_name: str | None = None
    idx = 1

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("//"):
            pending_name = line.lstrip("/").strip() or None
            continue
        if line.startswith("{") and line.endswith("}"):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict) and ("seg" in obj or "fx" in obj):
                name = str(obj.get("n") or pending_name or f"{default_name} #{idx}")
                adapted = adapt_payload_to_controller(obj, profile, segment_mode="mirror")
                presets.append(
                    {
                        "key": f"line-{idx}",
                        "name": name,
                        "payload": adapted,
                        "preview_colors": extract_preview_colors(adapted),
                    }
                )
                idx += 1
                pending_name = None
    return presets


def parse_wled_json_presets(
    data: Any,
    profile: ControllerProfile,
    default_name: str = "Imported Preset",
) -> list[dict[str, Any]]:
    """Parse either a single WLED preset object, a presets.json bundle, or commented JSON lines."""
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            commented = _parse_commented_json_lines(data, profile, default_name)
            if commented:
                return commented
            raise

    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object containing a WLED preset or presets.json map.")

    presets: list[dict[str, Any]] = []

    # Single preset object (has 'seg', 'fx', or 'bri' directly at top level)
    if "seg" in data or "fx" in data:
        name = str(data.get("n") or default_name)
        adapted = adapt_payload_to_controller(data, profile, segment_mode="mirror")
        presets.append(
            {
                "key": "single",
                "name": name,
                "payload": adapted,
                "preview_colors": extract_preview_colors(adapted),
            }
        )
        return presets

    # Multi-preset bundle (e.g. WLED presets.json {"1": {...}, "2": {...}})
    for key, val in data.items():
        if key == "0" or not isinstance(val, dict) or not val:
            continue
        if "seg" not in val and "fx" not in val:
            continue
        name = str(val.get("n") or f"{default_name} #{key}")
        adapted = adapt_payload_to_controller(val, profile, segment_mode="mirror")
        presets.append(
            {
                "key": str(key),
                "name": name,
                "payload": adapted,
                "preview_colors": extract_preview_colors(adapted),
            }
        )

    if not presets:
        raise ValueError("No valid WLED presets found in JSON payload.")

    return presets


async def _discover_github_repo_json_urls(owner: str, repo: str) -> list[str]:
    """Find WLED preset .json files inside a GitHub repository."""
    api_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/HEAD?recursive=1"
    async with httpx.AsyncClient(timeout=settings.http_timeout, follow_redirects=True) as client:
        resp = await client.get(api_url, headers={"Accept": "application/vnd.github+json"})
        resp.raise_for_status()
        tree = resp.json().get("tree", [])

    json_paths = [
        item["path"]
        for item in tree
        if item.get("type") == "blob" and str(item.get("path", "")).lower().endswith(".json")
    ]
    # Prefer backup/bundle preset files first
    json_paths.sort(key=lambda p: (0 if "preset" in p.lower() else 1, len(p)))
    return [f"https://raw.githubusercontent.com/{owner}/{repo}/HEAD/{p}" for p in json_paths[:10]]


async def fetch_presets_from_url(url: str, profile: ControllerProfile) -> tuple[str, list[dict[str, Any]]]:
    """Fetch JSON from a URL (with GitHub/Gist/Pastebin rewriting) and parse presets."""
    cleaned = url.strip().rstrip("/")
    repo_match = re.match(r"^https?://github\.com/([^/]+)/([^/]+)$", cleaned)
    if repo_match:
        owner, repo = repo_match.groups()
        candidate_urls = await _discover_github_repo_json_urls(owner, repo)
        all_presets: list[dict[str, Any]] = []
        async with httpx.AsyncClient(timeout=settings.http_timeout, follow_redirects=True) as client:
            for raw_candidate in candidate_urls:
                try:
                    resp = await client.get(raw_candidate)
                    resp.raise_for_status()
                    parsed = parse_wled_json_presets(resp.text, profile)
                    for item in parsed:
                        item["key"] = f"{raw_candidate.rsplit('/', 1)[-1]}:{item['key']}"
                    all_presets.extend(parsed)
                except Exception:
                    continue
        if not all_presets:
            raise ValueError(f"No valid WLED preset JSON files found in repository {owner}/{repo}.")
        return cleaned, all_presets

    raw_url = rewrite_to_raw_url(url)
    async with httpx.AsyncClient(timeout=settings.http_timeout, follow_redirects=True) as client:
        resp = await client.get(raw_url)
        resp.raise_for_status()
        text = resp.text

    return raw_url, parse_wled_json_presets(text, profile)
