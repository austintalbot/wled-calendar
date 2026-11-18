# wled-calendar

A local web application for scheduling daily WLED effects, importing presets from internet sources, and syncing with Google Calendar / ICS holiday feeds—tailored to your WLED controller's hardware topology (`192.168.68.200`).

## Features
- **Controller-Aware Adaptation**: Automatically syncs `/json/info`, `/json/cfg`, `/json/eff`, `/json/pal`, and `/presets.json` from your WLED controller (`1078` LEDs across 3 segments: `0–712`, `712–824`, `824–1078`) and adapts any imported single-segment preset to match.
- **Multi-Source Import Hub**:
  - **Curated Library**: 15 built-in seasonal, holiday, and everyday effects.
  - **URL / Gist / Pastebin**: Paste raw JSON, GitHub file, GitHub Gist, or Pastebin URLs to preview and import presets.
  - **Paste JSON**: Import raw WLED JSON snippets directly.
  - **Controller Presets**: Import existing presets saved on `192.168.68.200`.
- **Google Calendar & ICS Integration**:
  - Paste your Google Calendar **Secret address in iCal format** or any `.ics` holiday feed.
  - Matches events via `[wled: Effect Name]` / `#wled:EffectName` tags or built-in holiday keywords.
  - Supports both **all-day event overrides** and **timed event start/end triggers**.
- **Sunset / Sunrise & Time Scheduler**: Uses `astral` with your controller's coordinates (`43.45, -112.03`) to trigger daily effects at sunset, sunrise, or a fixed time.

## Running Locally

```bash
# 1. Install backend dependencies & build frontend
uv sync
cd frontend && npm install && npm run build && cd ..

# 2. Start the app (serves API + built UI on http://localhost:8000)
uv run uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## Running with Docker & Caddy (Local HTTPS)

```bash
docker compose up --build -d
```

Caddy serves the app over HTTPS on port `443` using its built-in local Certificate Authority (`tls internal`):
- **Default addresses**: `https://wled-calendar.local` and `https://localhost` (or override with `SITE_ADDRESS=192.168.68.x` in `.env`).
- **Trusting the local certificate (optional, removes browser warning)**:
  After starting the stack once, Caddy writes its root CA certificate to `./caddy_data/caddy/pki/authorities/local/root.crt`. On macOS, you can trust it with:
  ```bash
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./caddy_data/caddy/pki/authorities/local/root.crt
  ```
