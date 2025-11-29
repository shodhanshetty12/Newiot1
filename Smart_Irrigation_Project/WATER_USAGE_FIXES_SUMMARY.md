# Water Usage Page Fixes Summary

## What Was Fixed

### 1. Complete Rebuild Using Status Report Logic
- ✅ Rebuilt `water-usage.js` to use the **exact same** data ingestion pipeline as `status-report.js`
- ✅ Uses `DataIngestion.processIncoming()` for all data normalization
- ✅ Uses same `normalizeTimestamp()` function
- ✅ Uses same `processWaterData()` logic

### 2. Cumulative Water Calculation (24h)
- ✅ **Fixed**: Uses proven logic from Status Report
- ✅ Only increments cumulative when `pumpState === true`
- ✅ If `water_total_liters` from backend → uses it directly
- ✅ If `water_total_liters` decreases → treats as reset (no negative jump)
- ✅ Updates global state: `updateState({ lastCumulativeWater: cumulative })`

### 3. Instantaneous Flow Chart
- ✅ **Fixed**: Calculates correctly from:
  - Direct from `payload.flow_rate_lps` if available
  - Or `(newTotal - oldTotal) / deltaSeconds` if backend provides total
- ✅ Clamped to `>= 0` (no negative values)
- ✅ Marks spikes if `> 5.0 L/s`
- ✅ Shows `0` when pump is OFF

### 4. Scrolling Usage Log (Real Data)
- ✅ **Fixed**: Replaced fake/hardcoded log system
- ✅ Each valid water event creates a row with:
  - Formatted timestamp: `DD/MM/YYYY, HH:MM:SS`
  - Actual liters used (from `deltaLiters` or calculated)
- ✅ Only logs when there's actual flow (`instantaneous > 0` or `deltaLiters > 0`)
- ✅ Trimmed to last 100 entries
- ✅ Shows most recent first
- ✅ No more Z-format timestamps
- ✅ No more repeated static values

### 5. "Last Updated" Label
- ✅ **Fixed**: Always updates on each valid data frame
- ✅ Uses `normalizeTimestamp()` and formats with `toLocaleString('en-GB', {...})`
- ✅ Format: `DD/MM/YYYY, HH:MM:SS`
- ✅ Never shows `--` when data is available

### 6. APP_MODE & Simulation State Respect
- ✅ **Fixed**: Loads global state on page load
- ✅ Checks `simulationRunning` and `APP_MODE`
- ✅ Sets `freezeUpdates = true` if simulation not running and mode is SIMULATION
- ✅ Charts update **only** when:
  - `simulationRunning === true` (in SIMULATION mode), OR
  - `APP_MODE === "HARDWARE"` (in HARDWARE mode)
- ✅ Charts pause automatically when simulation stops

### 7. WebSocket Data Stream Connection
- ✅ **Fixed**: Connects to shared WebSocket using `WebSocketClient`
- ✅ Uses `DataIngestion` pipeline for all incoming data
- ✅ Falls back to polling (`/api/status-report`) if WebSocket unavailable
- ✅ Auto-reconnects on disconnect

### 8. CSS / Layout
- ✅ Charts appear side-by-side (2-column grid)
- ✅ Usage log below charts
- ✅ No overflow issues
- ✅ No jitter (animations disabled)
- ✅ Charts use `chart.update('none')` for incremental updates

## Files Modified

1. **`frontend/assets/js/water-usage.js`** - Complete rebuild:
   - Uses same `normalizeTimestamp()` as status-report.js
   - Uses same `processWaterData()` logic
   - Uses `DataIngestion` pipeline
   - Real usage log with actual flow data
   - Respects APP_MODE and simulation state
   - WebSocket + polling fallback

2. **`frontend/pages/water-usage.html`** - Cleaned up:
   - Removed old fake table refresh logic
   - Table now updated by water-usage.js with real data

## Acceptance Criteria Met

### ✅ Both charts show live updates during simulation/hardware
- Charts update every 1 second when simulation running or hardware active
- Uses same data source as Status Report page

### ✅ "Last Updated" shows correct timestamp
- Updates on every valid data frame
- Format: `DD/MM/YYYY, HH:MM:SS`
- Never stale

### ✅ Table entries match real flow changes
- Each row represents actual water usage event
- Liters calculated from `deltaLiters` or `instantaneous * deltaSeconds`
- Only shows entries when there's actual flow

### ✅ No repeated rows
- Each entry has unique timestamp
- No duplicate data

### ✅ No static fake timestamps
- All timestamps formatted with `toLocaleString('en-GB', {...})`
- No Z-format timestamps
- Real-time updates

### ✅ All readings consistent with Status Report
- Uses same data ingestion pipeline
- Uses same water calculation logic
- Uses same timestamp normalization
- Same data source (WebSocket or `/api/status-report`)

## Technical Details

### Data Flow
1. WebSocket/Polling receives data → `DataIngestion.processIncoming()` normalizes
2. `processWaterData()` calculates cumulative and instantaneous (same as status-report.js)
3. Charts update incrementally with `chart.update('none')`
4. Usage log updated with real `deltaLiters` values
5. Global state updated with `lastCumulativeWater`

### State Management
- Loads from `GlobalState` on page load
- Respects `simulationRunning` flag
- Respects `APP_MODE` (SIMULATION/HARDWARE)
- Updates global state when cumulative changes

### Chart Updates
- Only when `!freezeUpdates && APP_MODE.shouldUpdateCharts()`
- Incremental updates (no reinit)
- No animations (prevents jitter)
- Max 300 points per chart

## Summary

**Cumulative water now real-time** ✅
- Calculated from actual flow events
- Only increases when pump ON
- Persisted to global state

**Instantaneous flow now calculated correctly** ✅
- From `flow_rate_lps` or calculated from cumulative diff
- Clamped to >= 0
- Shows 0 when pump OFF

**Data logs tied to actual flow/cumulative delta** ✅
- Each row represents real water usage
- Calculated from `deltaLiters` or `instantaneous * deltaSeconds`
- No fake values

**No more fake repeated values** ✅
- All data from real-time sources
- Each entry unique

**No more Z-format timestamps** ✅
- All timestamps formatted: `DD/MM/YYYY, HH:MM:SS`
- Consistent across all displays

**Simulation mode respected** ✅
- Charts pause when simulation stops
- Charts resume when simulation starts
- Respects APP_MODE state

**Charts stop when simulation stops** ✅
- `freezeUpdates` flag prevents updates
- Checks `APP_MODE.shouldUpdateCharts()`

**Real pump ON/OFF affects calculations** ✅
- Cumulative only increases when pump ON
- Instantaneous = 0 when pump OFF
- Usage log only shows entries when flow > 0

**Clean layout** ✅
- Side-by-side charts
- Usage log below
- No overflow
- No jitter

