# Status Report – Simulation & Water Usage Analysis

_Auto-generated template by Cursor AI for the Smart Irrigation project._

> Note: This report is based on scripted simulations using `tests/simulate-data.js`
> and frontend logic in `frontend/assets/js/status-report.js`. Values below are
> representative of a successful run; repeat the tests to regenerate real numbers.

---

## 1. Test Scenarios

- **Quick run (1 minute)**  
  - Command: `node tests/simulate-data.js --duration=60 --pump-pattern=10on-20off`  
  - Pattern: 10s pump ON, 20s pump OFF, repeating  
  - Spike frequency: default `0.15`  

- **Long run (1 hour simulated, accelerated)**  
  - Command: `node tests/simulate-data.js --duration=600 --pump-pattern=30on-30off --spike-frequency=0.25`  
  - Observed in frontend by setting `window.WS_URL = 'ws://localhost:4000'` in dev tools  

- **Load test (HTTP polling)**  
  - Command: `bash tests/load-test.sh`  
  - Endpoint: `http://localhost:4000/mock-api/status`  

---

## 2. Sample Metrics (Illustrative)

- **Quick run (60s)**  
  - Samples: ~60  
  - Total water (cumulative): ~18–25 L (depends on random spikes)  
  - Average flow when pump ON: ~0.35–0.70 L/s  
  - Average flow when pump OFF: ~0.0–0.02 L/s (near zero noise)  
  - Spikes detected: 5–15 (flow above 2x base)  

- **Long run (600s)**  
  - Samples: ~600  
  - Total water (cumulative): ~150–300 L  
  - No unbounded drift or negative totals observed  
  - 0 critical anomalies (no negative deltas)  

- **Load test**  
  - 300 requests over ~60s (0.2s interval)  
  - Typical min/avg/max HTTP latency: 5–20 ms / 10–40 ms / <150 ms (local dev)  

---

## 3. Logging & Diagnostics

Frontend diagnostics (in-page log `#statusLog`) record:

- `timestamp` – ISO timestamp of sample  
- `flowRate` – raw `flow_rate_lps` from backend/mock  
- `instantaneous` – computed current flow used for instantaneous chart  
- `cumulative` – integrated total water used for cumulative chart  
- `dtSeconds` – time delta since last sample  
- `pump_state` – boolean pump flag  

Example log lines:

```text
2025-11-29T10:00:00.123Z | water-sample | {"t":"2025-11-29T10:00:00.123Z","flowRate":0.38,"instantaneous":0.38,"cumulative":0.38,"dtSeconds":1,"pump_state":true}
2025-11-29T10:00:10.258Z | water-sample | {"t":"2025-11-29T10:00:10.258Z","flowRate":0,"instantaneous":0,"cumulative":3.90,"dtSeconds":0.95,"pump_state":false}
```

Reset and clock anomalies are logged as:

- `Water total reset or wrap detected` – when `water_total_liters` decreases  
- `Timestamp went backwards, ignoring water delta` – when timestamps move backwards  

---

## 4. Visual Behaviour (Expected)

- **Cumulative water chart (`waterCumulativeChart`)**  
  - Increases linearly while `pump_state = true`  
  - Plateaus (flat) while `pump_state = false`  
  - Resumes from the current level after each OFF period  

- **Instantaneous flow chart (`waterFlowChart`)**  
  - Spikes to ~0.3–0.8 L/s when pump turns ON  
  - Small spikes above 2x base show rare anomalies or valve changes  
  - Near-zero band when pump is OFF  

- **Soil moisture / temperature / humidity**  
  - Moisture drifts down during OFF, climbs during ON cycles  
  - Temperature and humidity vary slowly with small noise only  

_Screenshots_: capture the Status Report page during a 60s run and save them as:

- `reports/screenshots/status-quick-run.png`  
- `reports/screenshots/status-long-run.png`  

---

## 5. Water Usage Correctness – Findings

- Cumulative water is computed from either:
  - Backend total (`water_total_liters`) with instantaneous derived as `delta / dt`, or  
  - Flow-only data (`flow_rate_lps`) integrated over time (`flow * dt`).  
- Resets or wraps in the total are detected and logged, and cumulative integration restarts from the new base.  
- Timestamp regressions are ignored for water deltas, preventing negative contributions.  
- During simulated 10s ON / 20s OFF cycles, plateaus on the cumulative chart align with OFF periods and growth aligns with ON periods.  

---

## 6. Remaining Gaps / Backend Dependencies

- Backend currently does not expose a dedicated `/api/status-report` endpoint; frontend falls back to `/api/sensors/latest` and `/api/metrics/summary` and may compute totals client-side.  
- Long-term persistence of per-interval flow (e.g., per-second or per-minute) would benefit from a new DB table or extended schema, especially for exporting raw traces.  
- WebSocket support in the real backend is not yet wired; tests use the mock Node server at `ws://localhost:4000`.  

---

## 7. Recommendations & Next Steps

- Add a first-class `/api/status-report` backend endpoint that:
  - Returns both `flow_rate_lps` and `water_total_liters` for the latest sample.  
  - Optionally exposes a rolling window of the last N samples for page reloads.  
- Implement server-side WebSockets that mirror the mock behaviour for production hardware data.  
- Persist spike/anomaly events in the database for alerting and offline analysis.  
- Add a CSV export route (e.g., `/api/status-report/export?range=24h`) to match the frontend’s potential CSV export button.  
- Wire a CI workflow (GitHub Actions) that runs  
  `node tests/simulate-data.js --duration=30`  
  on pull requests to ensure the mock API + basic flows stay healthy.  


