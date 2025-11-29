## System Overview & Feature Explanation (Website Guide)

This section provides a comprehensive guide to all features, pages, and controls in the Smart Irrigation System web interface.

---

### 1. All Website Pages (Full List)

#### Dashboard (`frontend/index.html`)

**Page Purpose:** Central hub displaying real-time sensor data, simulation controls, and system status overview.

**Who Uses It:** Primary interface for all users to monitor system activity and control simulations.

**Update Behavior:** Live updates every 1-2 seconds when simulation is running or hardware is active. Static display when system is idle.

**Data Displayed:**
- Real-time sensor readings table (soil moisture, temperature, humidity)
- Current pump status indicator
- Total water usage counter
- Simulation status (Running/Stopped)
- System mode indicator (Simulation/Hardware)

**Hardware/Simulation Interaction:**
- In Simulation Mode: Displays data from CSV simulation engine
- In Hardware Mode: Shows live readings from NodeMCU sensors
- Start/Stop buttons control simulation engine
- Auto Scroll toggle controls table scrolling behavior

---

#### Pump Control (`frontend/pages/pump-control.html`)

**Page Purpose:** Manual pump control interface for direct ON/OFF commands.

**Who Uses It:** Users who need to manually override automatic pump behavior or test pump functionality.

**Update Behavior:** Live status updates every 3 seconds. Manual commands execute immediately.

**Data Displayed:**
- Current pump status (ON/OFF) with visual indicator
- Manual control buttons (Turn Pump ON / Turn Pump OFF)

**Hardware/Simulation Interaction:**
- Works in both Simulation and Hardware modes
- In Hardware Mode: Sends commands directly to NodeMCU via `/api/hardware/pump`
- In Simulation Mode: Updates simulation state
- Manual overrides persist for 15 minutes (configurable)

---

#### Water Usage (`frontend/pages/water-usage.html`)

**Page Purpose:** Detailed water consumption tracking with historical charts and usage logs.

**Who Uses It:** Users monitoring water consumption patterns and analyzing irrigation efficiency.

**Update Behavior:** Live chart updates every 1 second. Usage log table refreshes every 6 seconds.

**Data Displayed:**
- Cumulative water chart (24-hour total)
- Instantaneous flow rate chart (liters per second)
- Total water usage meter (24h)
- Current flow rate meter
- Recent usage log table (timestamp, liters used)

**Hardware/Simulation Interaction:**
- In Simulation Mode: Tracks water from simulated pump cycles
- In Hardware Mode: Calculates from real flow sensor data or pump runtime
- Charts update only when system is active (simulation running or hardware sending data)

---

#### Status Report (`frontend/pages/status-report.html`)

**Page Purpose:** Comprehensive 24-hour system overview with live charts for all sensors and water metrics.

**Who Uses It:** Users requiring detailed analytics and visual trends of system performance.

**Update Behavior:** Live updates every 1 second via WebSocket (primary) or polling (fallback). Charts update incrementally without page refresh.

**Data Displayed:**
- Water Usage chart (cumulative 24h + instantaneous flow)
- Soil Moisture chart
- Temperature chart
- Humidity chart
- Current sensor value meters
- Diagnostics log panel
- Simulation control panel (Start/Stop buttons)

**Hardware/Simulation Interaction:**
- In Simulation Mode: Displays simulated sensor data with smoothing
- In Hardware Mode: Shows real-time hardware readings
- Charts automatically pause when simulation stops or hardware disconnects
- WebSocket connection provides lowest-latency updates

---

#### Notifications (`frontend/pages/notifications.html`)

**Page Purpose:** System alerts, warnings, and informational messages management.

**Who Uses It:** All users monitoring system events, anomalies, and status changes.

**Update Behavior:** Live updates via WebSocket for instant notifications. Polls API every 2 seconds as fallback.

**Data Displayed:**
- List of all notifications (critical, warning, info)
- Notification type badges
- Timestamps
- Read/Unread status indicators
- Unread count badge in navigation

**Hardware/Simulation Interaction:**
- Receives notifications from both simulation and hardware modes
- Auto-generates alerts for: flow spikes, low moisture, pump state changes
- Stores notifications locally with backend sync

---

#### Reports (`frontend/pages/reports.html`)

**Page Purpose:** Historical data analysis with aggregated statistics and export capabilities.

**Who Uses It:** Users analyzing long-term trends, generating reports, and exporting data.

**Update Behavior:** Static page with manual refresh. Auto-refreshes every 15 seconds when page is visible.

**Data Displayed:**
- Aggregated statistics table (by time bucket)
- Average soil moisture, temperature, humidity
- Total water usage per period
- Date range selector
- Export buttons (CSV, PDF)

**Hardware/Simulation Interaction:**
- Works with data from both modes
- Aggregates historical data from database
- Date range selector filters data from all sources

---

#### Settings (`frontend/pages/settings.html`)

**Page Purpose:** System configuration and threshold management.

**Who Uses It:** Administrators configuring system parameters and thresholds.

**Update Behavior:** Static page with form submissions. Changes apply immediately.

**Data Displayed:**
- Moisture threshold input
- Auto-mode toggle
- System configuration options
- Save/Cancel buttons

**Hardware/Simulation Interaction:**
- Settings affect both modes
- Threshold changes update pump automation logic
- Auto-mode enables/disables automatic pump control

---

#### Mode Switch (Simulation / Hardware Toggle)

**Location:** Navigation bar (top right), available on all pages

**Purpose:** Switch between simulation data source and real hardware sensors.

**Behavior:**
- Toggle checkbox in navbar
- Updates `APP_MODE` global state
- Charts and data sources switch automatically
- Simulation cannot start in Hardware Mode
- Hardware endpoints activate/deactivate based on mode

---

#### Theme Switch (Dark / Light Toggle)

**Location:** Navigation bar (top right), available on all pages

**Purpose:** Toggle between dark and light color themes for visual comfort.

**Behavior:**
- Toggle checkbox in navbar
- Preference saved to localStorage
- Applies immediately across all pages
- Persists across browser sessions

---

### 2. All Buttons & UI Controls

#### Navigation Bar Controls (Available on All Pages)

**Mode Badge** (`data-app-nav="mode"`)
- **Display:** "Mode: SIMULATION" or "Mode: HARDWARE"
- **Function:** Shows current system mode
- **Updates:** Live, syncs across all pages

**Pump Status Badge** (`data-app-nav="pump"`)
- **Display:** "Pump: ON" or "Pump: OFF"
- **Function:** Shows current pump state
- **Visual:** Green highlight when ON, red when OFF
- **Updates:** Live, every 3-5 seconds

**Water Badge** (`data-app-nav="water"`)
- **Display:** "Water: X.X L"
- **Function:** Shows total water used (24h)
- **Updates:** Live, syncs with water usage calculations

**Notification Badge** (`data-notif-badge`)
- **Display:** Number of unread notifications (hidden when zero)
- **Function:** Quick indicator of pending alerts
- **Updates:** Live via WebSocket or polling
- **Click:** Navigates to Notifications page

**Theme Toggle** (`data-app-toggle="theme"`)
- **Type:** Checkbox
- **Function:** Switch between Dark/Light themes
- **State:** Checked = Dark, Unchecked = Light
- **Persistence:** Saved to localStorage

**Hardware Mode Toggle** (`data-app-toggle="mode"`)
- **Type:** Checkbox
- **Function:** Switch between Simulation and Hardware modes
- **State:** Checked = Hardware, Unchecked = Simulation
- **Effect:** Disables simulation start in Hardware Mode

---

#### Dashboard Page Controls

**Start Simulation Button** (`#startBtn`)
- **Function:** Starts the CSV simulation engine
- **Behavior:** Disabled in Hardware Mode
- **Effect:** Begins generating sensor data, updates charts and tables

**Stop Simulation Button** (`#stopBtn`)
- **Function:** Stops the running simulation
- **Behavior:** Only visible when simulation is running
- **Effect:** Pauses data generation, charts stop updating

**Auto Scroll Toggle** (`#autoScrollToggle`)
- **Type:** Checkbox
- **Function:** Automatically scrolls table to show latest rows
- **State:** Off by default
- **Effect:** When enabled, new rows appear at bottom automatically

**Sensor Data Table**
- **Columns:** Timestamp, Soil Moisture, Temperature, Humidity
- **Function:** Displays historical sensor readings
- **Updates:** New rows appended when simulation/hardware active
- **Scroll:** Manual or auto (if toggle enabled)

---

#### Pump Control Page Controls

**Turn Pump ON Button** (`#manualOnBtn`)
- **Function:** Manually activates pump
- **Behavior:** Sends POST to `/api/hardware/pump` with action "ON"
- **Effect:** Pump activates immediately, override lasts 15 minutes
- **Works In:** Both Simulation and Hardware modes

**Turn Pump OFF Button** (`#manualOffBtn`)
- **Function:** Manually deactivates pump
- **Behavior:** Sends POST to `/api/hardware/pump` with action "OFF"
- **Effect:** Pump deactivates immediately
- **Works In:** Both Simulation and Hardware modes

**Pump Status Indicator** (`#pumpStatusIndicator`)
- **Display:** Visual status dot (green = ON, red = OFF)
- **Function:** Real-time pump state visualization
- **Updates:** Live, syncs with backend status

**Pump Status Text** (`#pumpStatus`)
- **Display:** "Pump Status: ON" or "Pump Status: OFF"
- **Function:** Textual pump state display
- **Updates:** Live, every 3 seconds

---

#### Water Usage Page Controls

**Cumulative Water Chart** (`#waterCumulativeChart`)
- **Type:** Line chart
- **Function:** Shows 24-hour cumulative water consumption
- **Updates:** Live, every 1 second when active
- **Data Source:** Calculated from flow rate or backend total
- **Label:** "Water (cumulative 24h)"

**Instantaneous Flow Chart** (`#waterFlowChart`)
- **Type:** Line chart
- **Function:** Shows real-time flow rate in liters per second
- **Updates:** Live, every 1 second when active
- **Behavior:** Shows 0 when pump is OFF
- **Label:** "Instantaneous flow (L/s)"

**Total Water Meter** (`#totalWater24h`)
- **Display:** "X.X L"
- **Function:** Shows total water used in last 24 hours
- **Updates:** Live, syncs with cumulative chart

**Current Flow Rate Meter** (`#currentFlowRate`)
- **Display:** "X.XX L/s"
- **Function:** Shows current instantaneous flow
- **Updates:** Live, shows 0.00 when pump OFF

**Usage Log Table** (`#waterUsageTableBody`)
- **Columns:** Timestamp, Liters Used
- **Function:** Historical water usage log
- **Updates:** Refreshes every 6 seconds
- **Rows:** Last 20 entries, newest first

---

#### Status Report Page Controls

**Simulation Control Panel** (`#simulationControl`)
- **Location:** Top right of page
- **Components:**
  - Mode Badge (`#appModeBadge`): Shows current mode
  - Start Button (`#simStartBtn`): Starts simulation
  - Stop Button (`#simStopBtn`): Stops simulation
  - Status Text (`#simStatus`): "Running" or "Stopped"
- **Function:** Control simulation from Status Report page
- **Updates:** Live, reflects simulation state

**Water Usage Chart** (Cumulative + Instantaneous)
- **Top Chart:** Cumulative water (24h)
- **Bottom Chart:** Instantaneous flow (L/s)
- **Updates:** Live, only when simulation running or hardware active
- **Behavior:** Charts pause when system idle

**Soil Moisture Chart** (`#moistureChart`)
- **Function:** 24-hour soil moisture trend
- **Updates:** Live with smoothing (prevents sudden jumps)
- **Data:** Percentage values (0-100)

**Temperature Chart** (`#tempChart`)
- **Function:** 24-hour temperature trend
- **Updates:** Live with exponential smoothing
- **Data:** Celsius values
- **Label:** "Temperature (°C)"

**Humidity Chart** (`#humChart`)
- **Function:** 24-hour humidity trend
- **Updates:** Live with exponential smoothing
- **Data:** Percentage values (0-100)
- **Label:** "Humidity (%)"

**Current Sensor Meters**
- **Current Temperature** (`#currentTemp`): Latest temperature value
- **Current Humidity** (`#currentHumidity`): Latest humidity value
- **Current Moisture** (`#currentMoisture`): Latest soil moisture value
- **Total Water (24h)** (`#totalWater24h`): Cumulative water total
- **Updates:** Live, matches chart values (smoothed)

**Diagnostics Panel** (`#statusLog`)
- **Type:** Scrollable text log
- **Function:** System diagnostics and error messages
- **Content:** Timestamp validation, dropped samples, WebSocket status, water resets
- **Updates:** New entries appended, limited to last 80 lines
- **Scroll:** Auto-scrolls to bottom, manual scroll available
- **Format:** Monospace font, pre-formatted text

**Mode Badge** (`#dataModeBadge`)
- **Display:** "Mode: SIMULATION • SIMULATION" or "Mode: HARDWARE • HARDWARE"
- **Function:** Shows current data source mode
- **Updates:** Live, syncs with mode toggle

---

#### Notifications Page Controls

**Read All Button** (`#readAllBtn`)
- **Function:** Marks all notifications as read
- **Behavior:** 
  - Updates local state immediately
  - Attempts backend sync via POST `/api/notifications/ack`
  - Clears unread badge
- **Visibility:** Only shown when unread notifications exist

**Notification List** (`#notificationsList`)
- **Type:** Scrollable list of notification cards
- **Function:** Displays all system notifications
- **Format:** 
  - Type badge (CRITICAL, WARNING, INFO)
  - Message text
  - Timestamp
  - Dismiss button (✕)
- **Updates:** Live via WebSocket, new notifications appear instantly

**Dismiss Button** (per notification)
- **Function:** Marks individual notification as read
- **Behavior:** Updates badge count, removes from unread list
- **Location:** Top right of each notification card

**Notification Type Badges**
- **CRITICAL:** Red background, for flow spikes and critical issues
- **WARNING:** Yellow background, for low moisture and warnings
- **INFO:** Blue background, for pump state changes and info

---

#### Reports Page Controls

**Date Range Selector** (`#range`)
- **Type:** Dropdown/Select
- **Options:** "24h", "7d", "30d", "1y", "all"
- **Function:** Filters report data by time period
- **Behavior:** Updates table immediately on change

**Refresh Button** (`#refresh`)
- **Function:** Manually refreshes report data
- **Behavior:** Fetches latest data from `/api/reports?range=X`
- **Updates:** Table and "Last updated" timestamp

**Download CSV Button** (`#downloadCsv`)
- **Function:** Exports report data as CSV file
- **Behavior:** Opens download link to `/api/reports?range=X&export=csv`
- **Format:** Comma-separated values, includes all table columns

**Download PDF Button** (`#downloadPdf`)
- **Function:** Exports report data as PDF file
- **Behavior:** Opens download link to `/api/reports?range=X&export=pdf`
- **Format:** Formatted PDF document with tables and charts

**Report Table** (`#tbody`)
- **Columns:** Bucket (time period), Avg Soil Moisture, Avg Temperature, Avg Humidity, Total Liters
- **Function:** Aggregated statistics by time bucket
- **Updates:** Auto-refreshes every 15 seconds, manual refresh available
- **Sort:** By time bucket (chronological)

**Last Updated Indicator** (`#updatedAt`)
- **Display:** "Last updated: HH:MM:SS"
- **Function:** Shows when data was last fetched
- **Updates:** On manual refresh or auto-refresh

---

#### Settings Page Controls

**Moisture Threshold Input**
- **Type:** Number input field
- **Function:** Sets soil moisture threshold for automatic pump activation
- **Behavior:** Pump turns ON when moisture < threshold
- **Validation:** Numeric value, typically 0-1000
- **Save:** Requires clicking Save button

**Auto-Mode Toggle**
- **Type:** Checkbox/Toggle
- **Function:** Enables/disables automatic pump control
- **State:** Checked = Auto mode ON, Unchecked = Manual only
- **Effect:** When enabled, pump automatically responds to moisture threshold

**Save Button**
- **Function:** Saves all settings to backend
- **Behavior:** POST to settings API, updates system configuration
- **Feedback:** Success/error message displayed

**Cancel Button**
- **Function:** Discards unsaved changes
- **Behavior:** Resets form to current backend values

---

### 3. Page-by-Page Detailed Breakdown

#### Dashboard Page

**A. What the Page Displays:**
- Real-time sensor data table with timestamp, soil moisture, temperature, humidity
- Current pump status (ON/OFF) with color indicator
- Total water usage counter (24-hour cumulative)
- Simulation status indicator (Running/Stopped)
- System mode indicator (Simulation/Hardware)

**B. What Updates Live:**
- Sensor data table: New rows added every 1-2 seconds when active
- Pump status: Updates every 3-5 seconds
- Water usage: Updates when pump cycles complete
- Simulation status: Updates immediately on start/stop
- Mode indicator: Updates on mode toggle

**C. Backend API Endpoints Used:**
- `GET /api/status` - System status and mode
- `GET /api/data/recent?limit=50` - Recent sensor readings
- `GET /api/water/usage` - Water usage logs
- `POST /api/simulation/start` - Start simulation
- `POST /api/simulation/stop` - Stop simulation
- `GET /api/simulation/status` - Simulation state

**D. Graphs/Tables/Controls:**
- Sensor data table (scrollable, auto-scroll optional)
- Start/Stop simulation buttons
- Auto Scroll toggle checkbox
- Pump status indicator (visual + text)
- Water usage display

**E. User Actions:**
- Start simulation (disabled in Hardware Mode)
- Stop running simulation
- Toggle auto-scroll for table
- View recent sensor history
- Monitor real-time system status

**F. Simulation vs Hardware Mode:**
- **Simulation Mode:** Displays CSV-generated data, simulation controls active
- **Hardware Mode:** Shows real NodeMCU sensor data, simulation controls disabled

---

#### Pump Control Page

**A. What the Page Displays:**
- Current pump status with visual indicator
- Manual control buttons (ON/OFF)
- Status text display

**B. What Updates Live:**
- Pump status: Updates every 3 seconds from backend
- Visual indicator: Changes color based on state

**C. Backend API Endpoints Used:**
- `POST /api/hardware/pump` - Send pump commands (action: "ON" or "OFF")
- `GET /api/status` - Fetch current pump status

**D. Graphs/Tables/Controls:**
- Pump status indicator (colored dot)
- Turn Pump ON button
- Turn Pump OFF button
- Status text display

**E. User Actions:**
- Manually activate pump (15-minute override)
- Manually deactivate pump
- View current pump state

**F. Simulation vs Hardware Mode:**
- **Simulation Mode:** Commands update simulation state
- **Hardware Mode:** Commands sent directly to NodeMCU, override persists 15 minutes

---

#### Water Usage Page

**A. What the Page Displays:**
- Cumulative water chart (24-hour total)
- Instantaneous flow rate chart (L/s)
- Total water meter (24h)
- Current flow rate meter
- Usage log table (timestamp, liters)

**B. What Updates Live:**
- Charts: Update every 1 second when system active
- Meters: Update with chart data
- Usage log: Refreshes every 6 seconds

**C. Backend API Endpoints Used:**
- `GET /api/water/usage` - Water usage logs
- `GET /api/metrics/water?range=24h` - Aggregated water metrics
- WebSocket (if configured): Real-time flow data

**D. Graphs/Tables/Controls:**
- Cumulative water chart (line graph)
- Instantaneous flow chart (line graph)
- Total water meter (large number display)
- Current flow meter (large number display)
- Usage log table (2 columns, 20 rows)

**E. User Actions:**
- View 24-hour water consumption trends
- Monitor real-time flow rates
- Review historical usage logs
- Analyze pump efficiency

**F. Simulation vs Hardware Mode:**
- **Simulation Mode:** Calculates from simulated pump cycles, charts update when simulation running
- **Hardware Mode:** Uses real flow sensor data or pump runtime calculations, charts update when hardware active

---

#### Status Report Page

**A. What the Page Displays:**
- Water usage charts (cumulative + instantaneous)
- Soil moisture chart (24h trend)
- Temperature chart (24h trend)
- Humidity chart (24h trend)
- Current sensor value meters
- Diagnostics log panel
- Simulation control panel

**B. What Updates Live:**
- All charts: Update every 1 second via WebSocket (primary) or polling (fallback)
- Meters: Update with latest smoothed values
- Diagnostics: New entries appended in real-time
- Charts pause automatically when simulation stops or hardware disconnects

**C. Backend API Endpoints Used:**
- `GET /api/status-report` - Primary data source
- `GET /api/sensors/latest` - Fallback sensor data
- `GET /api/metrics/summary?range=24h` - Fallback summary data
- WebSocket `ws://localhost:4000` (if configured): Real-time data stream

**D. Graphs/Tables/Controls:**
- 5 live charts (water cumulative, water flow, moisture, temperature, humidity)
- 4 sensor meters (temperature, humidity, moisture, water total)
- Diagnostics log (scrollable, 80 lines max)
- Simulation control (Start/Stop buttons, status indicator)
- Mode badge

**E. User Actions:**
- View comprehensive 24-hour system overview
- Start/stop simulation from Status Report page
- Monitor all sensors simultaneously
- Review system diagnostics and errors
- Analyze trends with smoothed charts

**F. Simulation vs Hardware Mode:**
- **Simulation Mode:** Charts show simulated data with exponential smoothing, update only when simulation running
- **Hardware Mode:** Charts show real sensor data, update when hardware sending data
- Charts automatically pause when no data source is active

---

#### Notifications Page

**A. What the Page Displays:**
- List of all system notifications
- Notification type badges (CRITICAL, WARNING, INFO)
- Timestamps for each notification
- Read/Unread status indicators
- Read All button (when unread exist)

**B. What Updates Live:**
- New notifications appear instantly via WebSocket
- Polls API every 2 seconds as fallback
- Badge count updates immediately
- Read All button visibility updates

**C. Backend API Endpoints Used:**
- `GET /api/notifications` - Fetch notification list
- `POST /api/notifications/ack` - Acknowledge/read notifications
- WebSocket (if configured): Real-time notification delivery

**D. Graphs/Tables/Controls:**
- Notification list (scrollable cards)
- Type badges (color-coded)
- Dismiss buttons (per notification)
- Read All button
- Timestamp displays

**E. User Actions:**
- View all system alerts and messages
- Mark individual notifications as read
- Mark all notifications as read
- Filter by type (visual via badges)

**F. Simulation vs Hardware Mode:**
- **Simulation Mode:** Receives notifications from simulated events (flow spikes, low moisture, pump changes)
- **Hardware Mode:** Receives notifications from real hardware events
- Both modes generate same notification types

---

#### Reports Page

**A. What the Page Displays:**
- Aggregated statistics table
- Average sensor values by time bucket
- Total water usage per period
- Date range selector
- Export buttons

**B. What Updates Live:**
- Table auto-refreshes every 15 seconds
- Manual refresh available
- Last updated timestamp updates

**C. Backend API Endpoints Used:**
- `GET /api/reports?range=X` - Fetch report data
- `GET /api/reports?range=X&export=csv` - CSV export
- `GET /api/reports?range=X&export=pdf` - PDF export

**D. Graphs/Tables/Controls:**
- Report table (5 columns: bucket, avg moisture, avg temp, avg humidity, total liters)
- Date range dropdown selector
- Refresh button
- Download CSV button
- Download PDF button
- Last updated indicator

**E. User Actions:**
- Select time range (24h, 7d, 30d, 1y, all)
- View aggregated statistics
- Export data as CSV
- Export data as PDF
- Manually refresh data

**F. Simulation vs Hardware Mode:**
- **Simulation Mode:** Aggregates data from simulation database entries
- **Hardware Mode:** Aggregates data from hardware sensor readings
- Both modes contribute to same historical database

---

#### Settings Page

**A. What the Page Displays:**
- Moisture threshold input field
- Auto-mode toggle
- Configuration form
- Save/Cancel buttons

**B. What Updates Live:**
- Settings load on page open
- Changes apply on Save button click
- No live updates (static form)

**C. Backend API Endpoints Used:**
- `GET /api/settings` - Fetch current settings
- `POST /api/settings` - Save settings
- `GET /api/mode` - Current mode status

**D. Graphs/Tables/Controls:**
- Moisture threshold number input
- Auto-mode checkbox/toggle
- Save button
- Cancel button
- Settings form

**E. User Actions:**
- Set soil moisture threshold
- Enable/disable auto-mode
- Save configuration changes
- Cancel unsaved changes

**F. Simulation vs Hardware Mode:**
- **Simulation Mode:** Threshold affects simulated pump automation
- **Hardware Mode:** Threshold sent to NodeMCU for hardware automation
- Settings apply to both modes

---

### 4. Functional Logic Explanation

#### A. Pump Automation Logic

**Soil Moisture Threshold Checking:**
The system continuously monitors soil moisture values against a configurable threshold. The threshold is set in Settings page and stored in backend database.

**When Pump Turns ON:**
- Automatic mode must be enabled
- Soil moisture reading must be below threshold
- No manual override active
- System evaluates: `if (autoMode && soilMoisture < threshold) → pump = ON`

**When Pump Turns OFF:**
- Soil moisture rises above threshold
- Manual override expires (after 15 minutes)
- User manually turns pump OFF
- System evaluates: `if (soilMoisture >= threshold || manualOverrideExpired) → pump = OFF`

**Simulation Mode Handling:**
- Mock sensors generate soil moisture values
- `evaluatePumpAction()` function checks: `soilMoisture < threshold`
- Pump state included in simulated payload
- Charts update to show pump ON/OFF periods

**Fail-Safe Behavior:**
- Manual overrides take precedence over automatic control
- Overrides expire after 15 minutes to prevent stuck states
- Hardware mode requires active NodeMCU connection
- System logs all pump state transitions for audit

---

#### B. Water Usage Monitoring

**Cumulative Water Calculation:**
- **Method 1 (Preferred):** Backend provides `water_total_liters` - frontend uses this directly
- **Method 2 (Fallback):** Frontend calculates from `flow_rate_lps * deltaSeconds` when pump is ON
- Formula: `cumulative += flow_rate_lps * deltaSeconds` (only when `pump_state === true`)
- Persisted to localStorage with 1-hour TTL as backup
- Resets detected and logged when backend total decreases

**Instantaneous Flow Calculation:**
- **Method 1:** Direct from `flow_rate_lps` in payload
- **Method 2:** Calculated from cumulative diff: `(current_total - last_total) / deltaSeconds`
- Clamped to >= 0 (negative values treated as reset)
- Shows 0 when pump is OFF
- Displayed in L/s (liters per second)

**24h Logs Storage and Display:**
- Backend stores individual water usage entries in `water_usage` table
- Each pump ON cycle logs water consumed
- Frontend fetches via `GET /api/water/usage`
- Table displays last 20 entries, newest first
- Aggregated totals available via `/api/metrics/water?range=24h`

**Simulation vs Hardware Modes:**
- **Simulation:** Each pump ON step logs 2.0L to database, cumulative calculated from these logs
- **Hardware:** Real flow sensor provides `flow_rate_lps`, cumulative calculated from flow * time
- Both modes update charts and meters in real-time

---

#### C. Live Graph Engine

**WebSocket vs Polling:**
- **Primary:** WebSocket connection (`ws://localhost:4000` or `window.WS_URL`) provides lowest-latency updates
- **Fallback:** HTTP polling every 1 second to `/api/status-report` or `/api/sensors/latest`
- WebSocket automatically reconnects on disconnect
- Polling activates when WebSocket unavailable

**Timestamp Processing:**
- All timestamps normalized to epoch milliseconds
- Strictly validated: samples with `incoming_ts <= last_ts` are dropped
- Delta seconds clamped to max 1.0 seconds to prevent large jumps
- Out-of-order samples logged and ignored
- Dropped sample counter tracked in diagnostics

**Chart Glitch Prevention:**
- Charts initialized once (never reinitialized)
- All Chart.js animations disabled (`animation: false`)
- Incremental updates using `chart.update('none')`
- Datasets trimmed to 300 points max (oldest removed first)
- No full redraws, only append operations

**Temperature/Humidity Smoothing:**
- Exponential smoothing applied: `smoothed = prev * 0.7 + new * 0.3`
- Only smooths when absolute difference > 1.2 threshold
- Prevents sudden unrealistic drops in sensor readings
- Cumulative water NOT smoothed (shows actual values)
- Smoothing state persists across updates

**Dataset Trimming:**
- Each chart maintains max 300 data points
- When limit reached, oldest label and data point removed via `shift()`
- New points appended via `push()`
- Prevents memory growth and maintains performance
- All charts trimmed independently

---

#### D. Notification Engine

**Notification Generation:**
- **Automatic:** System generates notifications for:
  - Flow spikes above threshold (CRITICAL)
  - Low soil moisture warnings (WARNING)
  - Pump state changes (INFO)
  - System errors and anomalies
- **Manual:** Backend can inject notifications via API
- **WebSocket:** Real-time notification delivery when available

**Notification Storage:**
- Stored in browser localStorage (`irrigation_notifications` key)
- Backend sync via `/api/notifications` API
- Maximum 500 notifications stored locally
- Older notifications automatically pruned
- `lastReadTimestamp` tracks read status

**Unread Badge Functionality:**
- Counts notifications where `seen === false`
- Updates immediately on read/unread changes
- Hidden when count is zero
- Syncs across all pages via navigation badge
- Updates via WebSocket for instant changes

**Read All Functionality:**
- Marks all notifications as `seen = true`
- Updates `lastReadTimestamp` to current time
- Attempts backend sync via `POST /api/notifications/ack`
- If backend unavailable, marks locally and syncs later
- Badge count clears immediately
- Exposed as `window.__notifications.markAllRead()` for testing

---

#### E. Simulation Mode

**Mock Sensor Data Generation:**
- `MockSensors` class generates realistic sensor values
- Soil moisture: Increases when pump ON, decreases when OFF
- Temperature/Humidity: Gentle random jitter around baseline
- Flow rate: Base 0.35 L/s with occasional spikes (2x multiplier)
- Pump state: Controlled by `evaluatePumpAction()` threshold logic
- Timestamps: Strictly increasing, 1-second intervals

**Pump Reaction to Simulated Soil Moisture:**
- `evaluatePumpAction(soilMoisture, threshold, currentState)` called each sample
- Returns `true` (pump ON) when `soilMoisture < threshold`
- Returns `false` (pump OFF) when `soilMoisture >= threshold`
- Pump state included in generated payload
- Charts visualize ON/OFF periods clearly

**Simulation Pause/Resume:**
- Start button: Calls `MockSensors.start()`, begins 1-second interval
- Stop button: Calls `MockSensors.stop()`, clears interval
- State persisted: Simulation can resume after page refresh
- Charts automatically pause when simulation stopped
- `APP_MODE.simulationRunning` flag controls update behavior

**UI Updates in Simulation Mode:**
- Charts update only when `simulationRunning === true`
- Status Report page shows "Running" or "Stopped" indicator
- Dashboard table receives new rows each second
- Water usage accumulates during pump ON periods
- Notifications generated for simulated events
- All pages reflect simulation state via `APP_MODE`

---

#### F. Hardware Mode

**Hardware Endpoints:**
- `POST /api/hardware/sync` - NodeMCU sends sensor data, receives pump command
- `POST /api/hardware/read` - Manual sensor reading (testing)
- `POST /api/hardware/pump` - Manual pump control
- `GET /api/hardware/command` - Fetch current pump command
- `GET /api/sensors/latest` - Latest sensor reading from database

**Real Sensor Data Updates:**
- NodeMCU posts JSON to `/api/hardware/sync` every 5 seconds (configurable)
- Backend stores readings in `sensor_data` table
- Frontend polls `GET /api/sensors/latest` or uses WebSocket
- Charts update when new hardware data arrives
- No smoothing applied to hardware data (shows raw values)

**Pump ON/OFF Command Execution:**
- Manual commands: `POST /api/hardware/pump` with `{"action": "ON"}` or `{"action": "OFF"}`
- Backend sets manual override (15-minute expiry)
- NodeMCU receives command in `/api/hardware/sync` response as `next_action`
- Hardware executes command via relay control
- Override persists until expiry or new command

---

### 5. FAQ Section

**Q: Why do charts move even when simulation is stopped?**
A: Charts should NOT move when simulation is stopped. If they do, check:
- Ensure simulation is actually stopped (check Status Report page indicator)
- Verify `APP_MODE.simulationRunning === false`
- Check if hardware mode is active and sending data
- Review diagnostics log for dropped samples or timestamp issues

**Q: Why do logs show "timestamp drops" or "sample dropped" messages?**
A: This indicates out-of-order or duplicate timestamps. The system:
- Drops samples where `incoming_timestamp <= last_timestamp`
- Logs a single diagnostic line per drop (not spam)
- Prevents chart glitches from bad data
- This is normal behavior for data validation

**Q: Why doesn't the pump turn ON in simulation even when moisture is low?**
A: Check these conditions:
- Auto-mode must be enabled in Settings
- Soil moisture must be below threshold (check Settings page)
- Simulation must be running (Start button clicked)
- Verify `evaluatePumpAction()` is being called (check diagnostics)
- Check if manual override is active (expires after 15 minutes)

**Q: Why does notification count stay high after clicking "Read All"?**
A: Possible causes:
- Backend sync may have failed (check browser console)
- Notifications arriving faster than being marked read
- Browser localStorage may need clearing
- Try refreshing page after clicking "Read All"
- Check if `POST /api/notifications/ack` endpoint is available

**Q: How do I reset the simulation?**
A: To reset simulation:
- Click Stop button to halt current simulation
- Refresh the page (F5) to clear frontend state
- Click Start to begin fresh simulation
- Note: Historical data in database remains (use Reports page to view)

**Q: How do I run hardware mode?**
A: To use hardware mode:
1. Flash NodeMCU firmware (see Hardware Mode section in README)
2. Configure WiFi credentials in firmware
3. Set `BACKEND_HOST` to your server IP
4. Toggle "Hardware" checkbox in navigation bar
5. NodeMCU will begin posting sensor data automatically
6. Charts update when hardware sends data

**Q: Why do temperature/humidity charts look smooth but water chart is jagged?**
A: This is intentional:
- Temperature/Humidity use exponential smoothing to prevent sudden jumps
- Water charts show raw values (no smoothing) for accuracy
- Smoothing only applies when difference > 1.2 threshold
- Cumulative water must show actual consumption, not smoothed estimates

**Q: How often do charts update?**
A: Update frequency depends on mode:
- **WebSocket:** Updates instantly when data arrives (lowest latency)
- **Polling:** Updates every 1 second (fallback)
- **Simulation:** 1 update per second when running
- **Hardware:** Updates when NodeMCU posts (typically every 5 seconds)

**Q: What happens if WebSocket disconnects?**
A: System automatically:
- Falls back to HTTP polling every 1 second
- Attempts WebSocket reconnection after 2 seconds
- Continues functioning normally (no data loss)
- Logs reconnection attempts in diagnostics

**Q: Can I use both simulation and hardware modes simultaneously?**
A: No, the system operates in one mode at a time:
- Toggle between modes via navigation bar checkbox
- Simulation disabled when Hardware mode active
- Hardware mode requires active NodeMCU connection
- Mode switch is immediate and affects all pages

---

*This guide covers all major features and controls. For technical implementation details, refer to the source code and API documentation.*

