# Smart Irrigation Project

## Getting Started

1. Create and activate a virtual environment (optional but recommended)
```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
```
2. Install dependencies
```bash
pip install -r backend/requirements.txt
```
3. Start the backend
```bash
python backend/app.py
```
4. Open the app in your browser at http://localhost:5000

## Hardware Mode (ESP8266 / NodeMCU)

Hardware support lives side-by-side with the CSV simulator. The CSV workflow,
data model, and APIs were left untouched; you simply gain a fully working
hardware path.

### Wiring (must match these pins)

| Component                    | NodeMCU Pin |
|-----------------------------|-------------|
| Capacitive soil sensor OUT  | **A0**      |
| Capacitive soil sensor VCC  | 3.3V        |
| Capacitive soil sensor GND  | GND         |
| Relay IN                    | **D1**      |
| Relay VCC                   | 3.3V        |
| Relay GND                   | GND         |
| Pump (+)                    | External +  |
| Pump (–)                    | Relay COM   |
| Relay NO                    | External –  |
| Optional DHT11/DHT22 data   | D4          |

`hardware/nodemcu_firmware/nodemcu_firmware.ino` already targets these pins and
expects a LOW-active relay (the most common 1-channel board). If your relay is
active HIGH, flip `RELAY_ACTIVE_LEVEL` / `RELAY_INACTIVE_LEVEL`.
The pump or solenoid valve must be powered from its own 5 V/12 V supply: connect
the pump positive lead straight to the supply positive, route the negative lead
through the relay COM, and tie relay NO back to the supply negative.

### Flashing the firmware

1. Install the required Arduino libraries:
   - **ESP8266 board package**
   - `ESP8266WiFi`
   - `ESP8266HTTPClient`
   - `ArduinoJson`
   - `DHT sensor library`
2. Open the sketch in the Arduino IDE, update `WIFI_SSID`, `WIFI_PASSWORD`, and
   `BACKEND_HOST` (the machine that runs `python backend/app.py`).
3. Choose your board (`NodeMCU 1.0 (ESP-12E Module)`), select the COM port, then
   upload.

The firmware samples the soil sensor via **A0**, optionally reads DHT11/22 on
**D4**, and posts JSON to `POST /api/hardware/sync`. The backend responds with
`next_action` (`"ON"` / `"OFF"`) plus configuration such as `poll_interval_ms`.
Manual overrides from the UI remain in effect for up to 15 minutes and are
transparent to the microcontroller.

## Modes (Simulation vs Hardware)

- The app supports two modes: `simulation` and `hardware`.
- Use the Hardware Mode toggle in the navbar to switch.
- Backend endpoints:
  - `GET /api/mode` → `{ "mode": "simulation" | "hardware" }`
  - `POST /api/mode` → `{ mode: "simulation" | "hardware" }`
- When in Hardware Mode, starting a simulation is disabled by the backend.
- `GET /api/sensors/latest` returns the newest sensor row stored.

`/api/hardware/sync` is the preferred way for the NodeMCU to:

- Send real sensor readings (`soil_moisture`, optional `temperature`/`humidity`)
- Receive the latest pump command, auto-mode state, and system threshold
- Honour manual overrides issued from the dashboard

You can still `POST /api/hardware/read` for manual testing with tools such as
Postman or curl.

## What's New (Improvements)

- Persistent simulation engine that doesn’t reset when navigating pages.
- Status & resume: Frontend resumes if a simulation is running.
- Reliable water usage updates with no-cache and cache-busting.
- Metrics APIs (last 24h): `/api/metrics/water_24h`, `/api/metrics/sensors_24h`.
- Status Report page with live, in-place updating charts.
- High-tech theme plus Light/Dark toggle (persisted).
- Dashboard Auto Scroll toggle (off by default).
- Unified navigation bar with live mode/pump/water badges that stay in sync
  across every page, plus consolidated theme/hardware toggles powered by the new
  `AppShell` helper.

## Pages

- Dashboard (`frontend/index.html`)
- Pump Control (`frontend/pages/pump-control.html`)
- Water Usage (`frontend/pages/water-usage.html`)
- Status Report (`frontend/pages/status-report.html`)

## Backend API Overview

- Simulation
  - `POST /api/simulation/start`
  - `POST /api/simulation/stop`
  - `GET /api/simulation/data`
  - `GET /api/simulation/status`
- Data
  - `GET /api/data/recent?limit=N`
  - `GET /api/water/usage`
  - `GET /api/sensors/latest`
- Metrics (24h)
  - `GET /api/metrics/water_24h`
  - `GET /api/metrics/sensors_24h`
- Mode
  - `GET /api/mode`
  - `POST /api/mode`
- Pump control
  - `POST /api/hardware/pump`

## Ideas to Make This a High-Class Project

- Auth/roles; per-zone irrigation; threshold config; alerts.
- Hardware streaming via WebSockets and real-time charts.
- CSV export; weekly/monthly analytics; Docker; CI tests.

## Development Notes

- DB: `backend/irrigation.db` (SQLite). Tables: `sensor_data`, `water_usage`.
- Pump ON step logs 2.0 L to `water_usage` during simulation.
- Frontend loads recent rows and total water on startup and resumes if running.
