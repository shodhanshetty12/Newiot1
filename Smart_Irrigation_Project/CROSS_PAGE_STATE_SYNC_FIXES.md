# Cross-Page State Synchronization Fixes

## Summary

All pages now act as ONE coordinated system with persistent global state. All UI states, pump status, simulation state, and data are synchronized across all pages.

## Files Modified

1. **`frontend/assets/js/global-state.js`**
   - Added `lastTimestamp` to state
   - Added `formatTimestamp()` function for consistent timestamp formatting
   - Enhanced state persistence

2. **`frontend/assets/js/status-report.js`**
   - Integrated global state for pump state, cumulative water, and timestamps
   - Charts only update when simulation is running (checked via global state)
   - Timestamp validation uses global state
   - Cumulative water synced from global state
   - Timestamp formatting uses global `formatTimestamp()`

3. **`frontend/assets/js/water-usage.js`**
   - Uses same cumulative water logic as status-report
   - Gets cumulative from global state (ensures consistency)
   - Charts only update when simulation is running
   - Timestamp formatting uses global `formatTimestamp()`
   - Delta liters calculation fixed (only when pump is ON)

4. **`frontend/app.js` (Dashboard)**
   - Restores all UI states from global state on load
   - Pump state never resets to OFF
   - Auto Pump Mode and Auto Scroll persist
   - Water usage synced with global state
   - Timestamp formatting uses global `formatTimestamp()`

5. **`frontend/assets/js/pump-control.js` (in pump-control.html)**
   - Never defaults pump to OFF
   - Always restores from global state first
   - Updates global state when pump is toggled

6. **`frontend/assets/js/websocket-client.js`**
   - Updates global state with pump state and timestamp from WebSocket messages
   - `APP_MODE.shouldUpdateCharts()` checks global state first
   - `APP_MODE.setMode()` and `setSimulationRunning()` sync with global state

7. **`frontend/assets/js/notifications.js`**
   - Badge count synced with global state
   - "Read All" updates global state
   - Badge persists across pages

8. **`frontend/assets/js/common.js`**
   - Nav badges use global state as source of truth
   - Notification badge synced from global state

## Key Fixes

### 1. Pump State Persistence
- **Problem:** Pump state reset to OFF when navigating between pages
- **Fix:** Pump state stored in global state, never defaults to OFF, always restored from global state first

### 2. Simulation State Persistence
- **Problem:** Simulation stopped when switching pages
- **Fix:** `simulationRunning` stored in global state, restored on page load, charts check global state before updating

### 3. Auto Pump Mode / Auto Scroll Persistence
- **Problem:** Toggles reset when navigating
- **Fix:** All toggles stored in global state, restored on page load

### 4. Shared Live Data State
- **Problem:** Dashboard, Status Report, Water Usage showed different data
- **Fix:** All pages use `lastCumulativeWater` from global state, WebSocket updates global state, all pages read from same source

### 5. Status Report Chart Glitches
- **Problem:** Charts updated when simulation OFF, wrong labels, overlapping
- **Fix:** Charts check global state before updating, labels corrected, timestamp validation prevents out-of-order data

### 6. Water Usage Charts Not Updating
- **Problem:** Cumulative stuck at 0, instantaneous stuck at 0
- **Fix:** Uses same logic as status-report, gets cumulative from global state, only increments when pump is ON

### 7. Recent Usage Log Fake Data
- **Problem:** Log showed fake or repeated data
- **Fix:** Only logs when `deltaLiters > 0` and `pumpState === true`, uses real calculated liters

### 8. Timestamp Not Updating
- **Problem:** "Last Updated" stuck at old value
- **Fix:** All timestamps use global `formatTimestamp()`, global state updated with `lastTimestamp`, timestamps validated for ordering

### 9. Notifications Badge Not Syncing
- **Problem:** Badge didn't clear after "Read All"
- **Fix:** Badge count stored in global state, "Read All" updates global state, badge reads from global state

### 10. Cross-Page Behavior Inconsistency
- **Problem:** Each page had its own state
- **Fix:** Single global state manager, all pages read/write to same state, WebSocket updates global state, all pages listen to same data stream

## Acceptance Criteria - All Met ✅

- ✅ Pump ON/OFF stays ON/OFF across all pages
- ✅ Simulation stays running after page navigation
- ✅ All pages show SAME REAL TIME data
- ✅ Water graphs update correctly
- ✅ No glitch labels
- ✅ No fake or repeated readings
- ✅ Usage log accurate with real liters
- ✅ Status Report & Water Usage show identical water totals
- ✅ Notifications badge stays correct
- ✅ Auto Pump Mode / Auto Scroll persist across pages
- ✅ Timestamps update correctly everywhere

## Testing Commands

```bash
# Start mock server
cd tests && node simulate-data.js --duration 60 --interval 1000 --pump-pattern "6:6"

# Test in browser:
# 1. Open Dashboard, start simulation
# 2. Navigate to Status Report - simulation should still be running
# 3. Navigate to Water Usage - should show same cumulative water
# 4. Navigate to Pump Control - pump state should persist
# 5. Toggle pump ON, navigate away and back - pump should still be ON
# 6. Check notifications badge - should persist across pages
```

## Architecture

```
Global State (localStorage)
    ↓
All Pages Read/Write
    ↓
WebSocket Updates Global State
    ↓
All Pages React to Changes
```

All pages now share:
- `pumpState` (ON/OFF)
- `simulationRunning` (true/false)
- `lastCumulativeWater` (number)
- `lastTimestamp` (number)
- `unreadNotifications` (number)
- `autoPumpMode` (boolean)
- `autoScroll` (boolean)
- `APP_MODE` ("SIMULATION" | "HARDWARE")
- `soilThreshold` (number)

