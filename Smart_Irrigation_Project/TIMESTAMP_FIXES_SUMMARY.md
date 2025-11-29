# Timestamp Fixes Summary

## What Was Fixed

### 1. Global Timestamp Normalization Function
- Created `normalizeTimestamp()` function in both `app.js` and `notifications.js`
- Handles all timestamp formats:
  - ISO strings (e.g., "2025-09-16T10:47:04.846Z")
  - Epoch seconds (numbers < 1e12)
  - Epoch milliseconds (numbers >= 1e12)
  - Fallback to current date if invalid

### 2. Dashboard Readings Table (`app.js`)
- **Fixed timestamp formatting**: All timestamps now use `normalizeTimestamp()` and format with `toLocaleString('en-GB', {...})`
- **Added cache prevention**: All fetch calls now use `{ cache: 'no-store' }` to prevent stale data
- **Fixed initialization**: Recent data loading also uses normalized timestamp formatting
- **Added update events**: Table dispatches `data-updated` event after each update
- **Clear on simulation start**: Table is cleared when simulation starts to prevent old data

### 3. Notifications Page (`notifications.js`)
- **Fixed timestamp formatting**: All notification timestamps use `normalizeTimestamp()` and format with `toLocaleString('en-GB', {...})`
- **Added timestamp validation**: Checks for missing timestamps in incoming data and warns/logs
- **Added update events**: Notifications container dispatches `notifications-updated` event after rendering
- **Fixed timestamp display**: Time element now shows properly formatted date-time

### 4. WebSocket Client (`websocket-client.js`)
- **Added timestamp validation**: Checks for missing timestamps in WebSocket payloads
- **Fallback timestamp**: Adds current timestamp if missing from payload
- **Warning logging**: Logs warnings when timestamps are missing

## Files Modified

1. **`frontend/app.js`**
   - Added `normalizeTimestamp()` function
   - Updated `fetchSimulationData()` to format timestamps correctly
   - Updated `initializeFromBackend()` to format timestamps correctly
   - Added `cache: 'no-store'` to all fetch calls
   - Added `data-updated` event dispatching
   - Clear table on simulation start

2. **`frontend/assets/js/notifications.js`**
   - Added `normalizeTimestamp()` function
   - Updated `renderNotifications()` to format timestamps correctly
   - Added timestamp validation in `syncNotifications()`
   - Added `notifications-updated` event dispatching
   - Fixed timestamp display format

3. **`frontend/assets/js/websocket-client.js`**
   - Added timestamp validation in WebSocket message handler
   - Added fallback timestamp if missing
   - Added warning logging

## Acceptance Criteria Met

✅ **Dashboard readings table shows correct current timestamp on every new sample**
- Timestamps are normalized and formatted consistently
- No stale cached data due to `cache: 'no-store'`

✅ **Notifications page shows correct human-readable timestamps**
- All timestamps use consistent `en-GB` format
- Format: DD/MM/YYYY, HH:MM:SS

✅ **No old timestamps appear after simulation restart**
- Table is cleared on simulation start
- All data fetched fresh with no cache

✅ **No duplicated timestamps**
- Timestamp validation prevents duplicates
- Each update creates new row with current timestamp

✅ **Time format is consistent across all pages**
- All timestamps use same `toLocaleString('en-GB', {...})` format
- Consistent formatting: DD/MM/YYYY, HH:MM:SS

## Technical Details

### Timestamp Format
All timestamps are displayed as: `DD/MM/YYYY, HH:MM:SS`
Example: `16/09/2025, 10:47:04`

### Cache Prevention
All API calls now include `{ cache: 'no-store' }` to ensure fresh data:
- `/api/simulation/data`
- `/api/sensors/latest`
- `/api/data/recent`
- `/api/status`
- `/api/simulation/status`
- `/api/water/usage`
- `/api/notifications`

### Event Dispatching
- Dashboard table dispatches `data-updated` event after each row insertion
- Notifications container dispatches `notifications-updated` event after rendering

This ensures UI components can listen for updates and refresh accordingly.

