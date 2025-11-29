# backend/hardware.py
"""
Hardware bridge between the Flask backend and the ESP8266 NodeMCU.

This module keeps CSV-based simulation intact while providing:
  * A predictable REST handshake for the microcontroller (POST /api/hardware/sync)
  * Clean pump decision logic that respects manual overrides
  * Optional DHT telemetry passthrough
  * Transition-aware water logging + notifications
"""

from __future__ import annotations

import datetime
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

from flask import Blueprint, request, jsonify

from database import (
    get_setting,
    insert_data,
    log_notification,
    log_water_usage,
    set_setting,
)

hardware_bp = Blueprint("hardware", __name__)

# --- Constants ----------------------------------------------------------------
PUMP_LITERS_PER_CYCLE = 2.0
MANUAL_OVERRIDE_DEFAULT = 120  # seconds
MIN_MANUAL_OVERRIDE = 15
MAX_MANUAL_OVERRIDE = 900


# --- Helpers ------------------------------------------------------------------
def _utc_now_str() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _coerce_float(value) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _get_threshold() -> float:
    try:
        return float(get_setting("moisture_threshold", "500") or 500)
    except Exception:
        return 500.0


def _get_auto_mode() -> bool:
    try:
        return get_setting("auto_mode", "false") == "true"
    except Exception:
        return False


def _safe_seconds(value, default) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _refresh_poll_interval() -> int:
    """Read the recommended poll interval from the DB (if configured)."""
    try:
        configured = int(
            get_setting("hardware_poll_interval_ms", str(STATE.poll_interval_ms))
            or STATE.poll_interval_ms
        )
    except Exception:
        configured = STATE.poll_interval_ms

    with STATE.lock:
        STATE.poll_interval_ms = max(1000, configured)
        return STATE.poll_interval_ms


@dataclass
class HardwareState:
    """In-memory, thread-safe cache for the latest hardware reading."""

    lock: threading.Lock = field(default_factory=threading.Lock, init=False)
    latest: Dict[str, Optional[float]] = field(
        default_factory=lambda: {
            "timestamp": None,
            "soil_moisture": None,
            "temperature": None,
            "humidity": None,
            "pump_status": "OFF",
            "source": "hardware",
            "manual_override_active": False,
            "auto_mode": False,
            "threshold": 500,
        }
    )
    manual_override: Optional[str] = None
    manual_override_expiry: float = 0.0
    poll_interval_ms: int = 5000

    def snapshot(self) -> Dict[str, Optional[float]]:
        with self.lock:
            return dict(self.latest)

    def set_manual_override(self, action: str, seconds: int):
        expires = time.time() + seconds
        with self.lock:
            self.manual_override = action
            self.manual_override_expiry = expires
            self.latest["manual_override_active"] = True
            self.latest["pump_status"] = action

    def clear_manual_override_if_needed(self):
        with self.lock:
            if self.manual_override and time.time() >= self.manual_override_expiry:
                self.manual_override = None
                self.latest["manual_override_active"] = False


STATE = HardwareState()


def _resolve_pump_state(soil_value: Optional[float]) -> Tuple[str, float, bool, bool]:
    """Return (desired_action, threshold, auto_mode, manual_override_active)."""
    threshold = _get_threshold()
    auto_mode = _get_auto_mode()

    STATE.clear_manual_override_if_needed()
    with STATE.lock:
        manual_action = STATE.manual_override
        manual_override_active = manual_action is not None

    if manual_override_active:
        desired = manual_action or "OFF"
    elif auto_mode and soil_value is not None and soil_value < threshold:
        desired = "ON"
    else:
        desired = "OFF"

    return desired, threshold, auto_mode, manual_override_active


def _record_transition(previous: str, desired: str, timestamp: str, source: str):
    """Persist pump transitions for notifications + stats."""
    if previous == desired:
        return

    try:
        set_setting("last_pump_status", desired)
    except Exception:
        pass

    try:
        if desired == "ON":
            log_water_usage(timestamp, PUMP_LITERS_PER_CYCLE)
            log_notification(f"Pump turned ON ({source})", "info", timestamp)
        else:
            log_notification(f"Pump turned OFF ({source})", "info", timestamp)
    except Exception:
        pass


def _ingest_sensor_payload(payload: Dict, source: str) -> Dict:
    timestamp = payload.get("timestamp") or _utc_now_str()
    soil_moisture = _coerce_float(payload.get("soil_moisture"))
    temperature = _coerce_float(payload.get("temperature"))
    humidity = _coerce_float(payload.get("humidity"))

    desired, threshold, auto_mode, manual_active = _resolve_pump_state(soil_moisture)

    with STATE.lock:
        previous = STATE.latest.get("pump_status", "OFF")
        STATE.latest.update(
            {
                "timestamp": timestamp,
                "soil_moisture": soil_moisture,
                "temperature": temperature,
                "humidity": humidity,
                "pump_status": desired,
                "source": source,
                "manual_override_active": manual_active,
                "auto_mode": auto_mode,
                "threshold": threshold,
            }
        )

    insert_data(
        {
            "timestamp": timestamp,
            "soil_moisture": soil_moisture,
            "temperature": temperature,
            "humidity": humidity,
            "pump_status": desired,
        }
    )

    _record_transition(previous, desired, timestamp, source)

    return {
        "timestamp": timestamp,
        "desired_action": desired,
        "threshold": threshold,
        "auto_mode": auto_mode,
        "manual_override_active": manual_active,
    }


# --- Routes -------------------------------------------------------------------
@hardware_bp.route("/api/hardware/read", methods=["POST"])
def read_sensor():
    """
    Legacy ingest endpoint (kept for backward compatibility / manual testing).
    """
    payload = request.get_json(silent=True) or {}
    result = _ingest_sensor_payload(payload, source=payload.get("source", "api"))
    return jsonify({"status": "received", **result})


@hardware_bp.route("/api/hardware/sync", methods=["POST"])
def hardware_sync():
    """
    Primary hardware handshake. The ESP8266 posts sensor values and receives the
    desired pump action + configuration in a single, non-blocking call.
    """
    payload = request.get_json(silent=True) or {}
    result = _ingest_sensor_payload(payload, source=payload.get("source", "nodemcu"))
    poll_interval = _refresh_poll_interval()

    return jsonify(
        {
            "next_action": result["desired_action"],
            "threshold": result["threshold"],
            "auto_mode": result["auto_mode"],
            "manual_override_active": result["manual_override_active"],
            "timestamp": result["timestamp"],
            "poll_interval_ms": poll_interval,
        }
    )


@hardware_bp.route("/api/hardware/status", methods=["GET"])
def get_status():
    return jsonify(STATE.snapshot())


@hardware_bp.route("/api/hardware/command", methods=["GET"])
def get_command():
    soil_value = STATE.snapshot().get("soil_moisture")
    desired, threshold, auto_mode, manual_active = _resolve_pump_state(soil_value)
    return jsonify(
        {
            "action": desired,
            "threshold": threshold,
            "auto_mode": auto_mode,
            "manual_override_active": manual_active,
        }
    )


@hardware_bp.route("/api/hardware/pump", methods=["POST"])
def control_pump():
    data = request.get_json(silent=True) or {}
    action = str(data.get("action", "")).upper()
    if action not in ("ON", "OFF"):
        return jsonify({"error": "Invalid action"}), 400

    hold_for = _safe_seconds(data.get("hold_seconds"), MANUAL_OVERRIDE_DEFAULT)
    hold_for = max(MIN_MANUAL_OVERRIDE, min(MAX_MANUAL_OVERRIDE, hold_for))
    STATE.set_manual_override(action, hold_for)

    try:
        log_notification(f"Pump manually forced {action}", "warning")
    except Exception:
        pass

    return jsonify(
        {
            "status": "pump updated",
            "pump_status": action,
            "manual_override_seconds": hold_for,
        }
    )
