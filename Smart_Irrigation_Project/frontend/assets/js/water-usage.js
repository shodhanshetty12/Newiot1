(function (window, document) {
  "use strict";

  /**
   * Global timestamp normalization function (same as status-report.js)
   */
  function normalizeTimestamp(ts) {
    // If ISO string (e.g., "2025-09-16T10:47:04.846Z")
    if (typeof ts === 'string' && ts.includes('T')) {
      return new Date(ts);
    }

    // If epoch seconds
    if (typeof ts === 'number' && ts < 1e12) {
      return new Date(ts * 1000);
    }

    // If epoch milliseconds
    if (typeof ts === 'number') {
      return new Date(ts);
    }

    // fallback
    return new Date();
  }

  const CONFIG = {
    pollIntervalMs: window.WATER_POLL_INTERVAL_MS || 1000,
    maxPoints: 300,
    apiUrl: window.STATUS_API_URL || "/api/status-report",
    sensorUrl: "/api/sensors/latest",
    summaryUrl: "/api/metrics/summary?range=24h",
    maxDeltaSeconds: 1.0,
    spikeThresholdLps: 5.0,
    localStorageKey: "irrigation_water_cumulative",
    localStorageTTL: 3600000, // 1 hour
    maxUsageLogEntries: 100,
  };

  let charts = {};
  let chartsInitialized = false;
  let refreshTimer = null;
  let ws = null;
  let isStopped = false;
  let freezeUpdates = false;

  // Water state tracking (same as status-report.js)
  const waterState = {
    lastTimestamp: null,
    lastTotal: null,
    cumulative: 0,
    lastFlowRate: 0,
    resetDetected: false,
  };

  // Recent usage log for table
  const recentUsage = [];

  /**
   * Load cumulative from localStorage and global state
   */
  function loadCumulativeFromStorage() {
    // Load from global state first
    if (window.GlobalState) {
      window.GlobalState.loadState();
      const state = window.GlobalState.getState();
      if (state.lastCumulativeWater) {
        waterState.cumulative = state.lastCumulativeWater;
        waterState.lastTotal = state.lastCumulativeWater;
      }
    }

    // Also try localStorage
    try {
      const stored = localStorage.getItem(CONFIG.localStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        const age = Date.now() - parsed.timestamp;
        if (age < CONFIG.localStorageTTL) {
          waterState.cumulative = parsed.cumulative || waterState.cumulative;
          waterState.lastTotal = parsed.lastTotal || waterState.lastTotal;
        }
      }
    } catch (e) {
      console.warn("Failed to load cumulative from storage:", e);
    }
  }

  /**
   * Save cumulative to localStorage
   */
  function saveCumulativeToStorage() {
    try {
      localStorage.setItem(
        CONFIG.localStorageKey,
        JSON.stringify({
          cumulative: waterState.cumulative,
          lastTotal: waterState.lastTotal,
          timestamp: Date.now(),
        })
      );
    } catch (e) {
      console.warn("Failed to save cumulative to storage:", e);
    }
  }

  function getThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
      text: styles.getPropertyValue("--text") || "#ffffff",
      muted: styles.getPropertyValue("--muted") || "#8a8fb0",
    };
  }

  function createLineChart(ctx, label, borderColor, backgroundColor) {
    const colors = getThemeColors();
    return new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label,
            data: [],
            borderColor,
            backgroundColor,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // Disable animations
        animations: false,
        transition: false,
        scales: {
          x: {
            ticks: {
              color: colors.muted,
              maxRotation: 0,
              autoSkip: true,
            },
            grid: {
              display: false,
            },
          },
          y: {
            ticks: {
              color: colors.muted,
            },
            grid: {
              color: "rgba(255,255,255,0.04)",
            },
          },
        },
        plugins: {
          legend: {
            labels: {
              color: colors.text,
            },
          },
        },
      },
    });
  }

  function initCharts() {
    if (chartsInitialized) {
      return;
    }

    const cumulativeCtx = document.getElementById("waterCumulativeChart");
    const flowCtx = document.getElementById("waterFlowChart");

    if (!window.Chart || !cumulativeCtx || !flowCtx) {
      window.setTimeout(initCharts, 150);
      return;
    }

    charts.cumulative = createLineChart(
      cumulativeCtx,
      "Water (cumulative 24h)",
      "#00e5ff",
      "rgba(0,229,255,0.18)"
    );
    charts.flow = createLineChart(
      flowCtx,
      "Instantaneous flow (L/s)",
      "#ffea00",
      "rgba(255,234,0,0.18)"
    );

    chartsInitialized = true;
    window.__chartsInitialized = true;
  }

  /**
   * Process water data (same logic as status-report.js)
   */
  function processWaterData(canonical) {
    if (!canonical) return null;

    const tsMs = canonical.ts;
    const deltaSeconds = canonical.deltaSeconds || 0;

    let flowRate = canonical.flow_rate_lps;
    const totalFromBackend = canonical.water_total_liters;
    const pumpState = canonical.pump_state === true;

    let instantaneous = 0;
    let cumulative = waterState.cumulative;

    // Handle water_total_liters (cumulative from backend)
    if (totalFromBackend != null) {
      if (waterState.lastTotal != null) {
        let diff = totalFromBackend - waterState.lastTotal;
        if (diff < 0) {
          // Reset or wrap detected
          console.warn("Water total reset/wrap detected", {
            previous: waterState.lastTotal,
            current: totalFromBackend,
          });
          waterState.resetDetected = true;
          // Treat as reset - use current value as new baseline
          cumulative = totalFromBackend;
          instantaneous = 0;
        } else {
          // Normal case: calculate instantaneous from diff
          instantaneous = deltaSeconds > 0 ? diff / deltaSeconds : 0;
          cumulative = totalFromBackend;
        }
      } else {
        // First reading
        cumulative = totalFromBackend;
        instantaneous = 0;
      }
      waterState.lastTotal = totalFromBackend;
    } else if (flowRate != null) {
      // Only flow_rate_lps provided
      // Only increment cumulative when pump is ON
      if (pumpState) {
        instantaneous = flowRate;
        const deltaLiters = instantaneous * deltaSeconds;
        cumulative += deltaLiters;
      } else {
        // Pump is OFF - instantaneous should be 0
        instantaneous = 0;
        // Cumulative stays the same (no increment)
      }
      waterState.lastTotal = cumulative;
    } else {
      // No flow_rate_lps - try to compute from deltaLiters if available
      if (totalFromBackend != null && waterState.lastTotal != null) {
        const diff = totalFromBackend - waterState.lastTotal;
        if (diff > 0 && deltaSeconds > 0) {
          instantaneous = diff / deltaSeconds;
        }
      }
      
      // If still no instantaneous and pump is OFF, set to 0
      if (pumpState === false) {
        instantaneous = 0;
      }
    }
    
    // If payload has flow_rate_lps, use it (but still respect pump state)
    if (canonical.flow_rate_lps != null && typeof canonical.flow_rate_lps === 'number') {
      if (pumpState) {
        instantaneous = canonical.flow_rate_lps;
      } else {
        // Pump is OFF - force instantaneous to 0
        instantaneous = 0;
      }
    }

    // Clamp instantaneous to >= 0
    instantaneous = Math.max(0, instantaneous);

    // Mark spikes
    if (instantaneous > CONFIG.spikeThresholdLps) {
      console.warn("Flow spike detected", { instantaneous, threshold: CONFIG.spikeThresholdLps });
    }

    // Update state
    waterState.cumulative = cumulative;
    waterState.lastFlowRate = instantaneous;
    waterState.lastTimestamp = tsMs;
    
    // Persist to localStorage
    saveCumulativeToStorage();
    
    // Update global state (this syncs across all pages)
    if (window.GlobalState) {
      window.GlobalState.updateState({ 
        lastCumulativeWater: cumulative,
        lastTimestamp: tsMs,
        pumpState: pumpState ? "ON" : "OFF"
      });
    }

    // Calculate delta liters for this period (only when pump is ON)
    let deltaLiters = 0;
    if (pumpState && instantaneous > 0) {
      deltaLiters = instantaneous * deltaSeconds;
    } else if (totalFromBackend != null && waterState.lastTotal != null) {
      const diff = totalFromBackend - waterState.lastTotal;
      if (diff > 0) {
        deltaLiters = diff;
      }
    }

    return {
      instantaneous,
      cumulative,
      timestamp: new Date(tsMs),
      pumpState,
      resetDetected: waterState.resetDetected,
      deltaLiters,
      deltaSeconds,
    };
  }

  /**
   * Fetch data from API (same as status-report.js)
   */
  async function fetchFromApi() {
    // Primary: /api/status-report
    try {
      const res = await fetch(`${CONFIG.apiUrl}?_=${Date.now()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        // Use DataIngestion to normalize
        if (window.DataIngestion) {
          return window.DataIngestion.processIncoming(data);
        }
        // Fallback: handle arrays - use last element
        if (Array.isArray(data) && data.length > 0) {
          return window.DataIngestion ? window.DataIngestion.processIncoming(data[data.length - 1]) : data[data.length - 1];
        }
        return data;
      }
      if (res.status !== 404) {
        console.warn("status-report endpoint non-404 error", { status: res.status });
      }
    } catch (e) {
      console.warn("status-report fetch failed, falling back", { error: String(e) });
    }

    // Fallback: sensors + summary
    try {
      const [sensorRes, summaryRes] = await Promise.all([
        fetch(`${CONFIG.sensorUrl}?_=${Date.now()}`, { cache: "no-store" }),
        fetch(`${CONFIG.summaryUrl}&_=${Date.now()}`, { cache: "no-store" }),
      ]);

      const sensor = sensorRes.ok ? await sensorRes.json() : null;
      const summary = summaryRes.ok ? await summaryRes.json() : null;

      // Handle arrays
      const sensorData = Array.isArray(sensor) ? sensor[sensor.length - 1] : sensor;
      const summaryData = Array.isArray(summary) ? summary[summary.length - 1] : summary;

      const combined = {
        timestamp: sensorData?.timestamp || Date.now(),
        temperature: sensorData?.temperature,
        humidity: sensorData?.humidity,
        soil_moisture: sensorData?.soil_moisture,
        pump_state:
          typeof sensorData?.pump_status === "string"
            ? sensorData.pump_status.toUpperCase() === "ON"
            : !!sensorData?.pump_status,
        water_total_liters:
          typeof summaryData?.total_liters === "number" ? summaryData.total_liters : undefined,
      };

      // Use DataIngestion to normalize
      if (window.DataIngestion) {
        return window.DataIngestion.processIncoming(combined);
      }
      return combined;
    } catch (e) {
      console.warn("Fallback fetch error", { error: String(e) });
      return null;
    }
  }

  /**
   * Fetch data (simulation or API)
   */
  async function fetchData() {
    // Check if we should update charts
    if (freezeUpdates || (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts())) {
      return null;
    }

    // Simulation: use MockSensors when available
    if (window.MockSensors && window.MockSensors.isSimulation() && window.MockSensors.isRunning()) {
      const sample = window.MockSensors.nextSample();
      if (window.DataIngestion) {
        return window.DataIngestion.processIncoming(sample);
      }
      return sample;
    }

    try {
      const data = await fetchFromApi();
      return data;
    } catch (error) {
      console.error("fetchData error", { error: String(error) });
      return null;
    }
  }

  /**
   * Push point to chart (incremental update, no reinit)
   */
  function pushPoint(chart, label, value) {
    if (!chart || typeof value !== "number" || Number.isNaN(value)) return;
    const labels = chart.data.labels;
    const data = chart.data.datasets[0].data;
    labels.push(label);
    data.push(value);
    // Trim to max points
    if (labels.length > CONFIG.maxPoints) {
      labels.shift();
      data.shift();
    }
    // Update without animation
    chart.update("none");
  }

  /**
   * Render usage log table (completely rewrites tbody)
   */
  function renderUsageTable() {
    const tableBody = document.getElementById("waterUsageTableBody");
    if (!tableBody) return;
    
    // Completely rewrite tbody
    tableBody.innerHTML = "";
    
    // Show most recent first
    recentUsage.slice().reverse().forEach(entry => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${entry.time}</td>
        <td>${entry.liters}</td>
      `;
      tableBody.appendChild(tr);
    });
  }

  /**
   * Update usage log table with real data
   */
  function updateUsageLog(water, canonical) {
    if (!water || !canonical) return;
    
    // Only log when pump is ON and there's actual flow
    const pumpState = water.pumpState === true;
    const instantaneous = water.instantaneous || 0;
    const deltaSec = canonical.deltaSeconds || 0;
    
    if (pumpState && instantaneous > 0 && deltaSec > 0) {
      const litersUsed = instantaneous * deltaSec;
      
      // Format timestamp
      const dt = water.timestamp;
      const formatTS = window.GlobalState && window.GlobalState.formatTimestamp
        ? window.GlobalState.formatTimestamp(dt)
        : dt.toLocaleString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          });
      
      // Add to recent usage log (most recent first)
      recentUsage.unshift({
        time: formatTS,
        liters: litersUsed.toFixed(2)
      });
      
      // Trim to max entries (remove oldest)
      if (recentUsage.length > 50) {
        recentUsage.pop();
      }
      
      // Render table
      renderUsageTable();
    }
  }

  /**
   * Update all charts with new sample
   */
  function updateCharts(canonical) {
    if (!canonical) return;

    // Check if we should update charts (use global state as source of truth)
    if (freezeUpdates) return;
    
    // Check global state for simulation running
    if (window.GlobalState) {
      const state = window.GlobalState.getState();
      // If in SIMULATION mode and simulation is not running, don't update
      if (state.APP_MODE === "SIMULATION" && !state.simulationRunning) {
        return;
      }
    }
    
    // Fallback to APP_MODE if available
    if (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts()) {
      return;
    }

    const water = processWaterData(canonical);
    if (!water) return;

    const ts = water.timestamp;
    const label = ts.toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const pumpState = water.pumpState === true;
    const instantaneous = water.instantaneous || 0;
    const deltaSec = canonical.deltaSeconds || 0;
    
    // Get cumulative from global state
    let cumulative = water.cumulative;
    if (window.GlobalState) {
      const state = window.GlobalState.getState();
      cumulative = state.lastCumulativeWater || cumulative;
    }
    
    // Update cumulative chart ONLY when pump is ON and instantaneous > 0
    if (pumpState && instantaneous > 0) {
      // Increment cumulative
      cumulative += instantaneous * deltaSec;
      
      // Update global state
      if (window.GlobalState) {
        window.GlobalState.updateState({ lastCumulativeWater: cumulative });
      }
      
      // Update chart
      if (charts.cumulative) {
        charts.cumulative.data.labels.push(label);
        charts.cumulative.data.datasets[0].data.push(cumulative);
        
        // Trim to max points
        if (charts.cumulative.data.labels.length > CONFIG.maxPoints) {
          charts.cumulative.data.labels.shift();
          charts.cumulative.data.datasets[0].data.shift();
        }
        
        charts.cumulative.update("none");
      }
    }
    
    // Update instantaneous flow chart (always update, shows 0 when pump is OFF)
    if (charts.flow) {
      charts.flow.data.labels.push(label);
      charts.flow.data.datasets[0].data.push(instantaneous);
      
      // Trim to max points
      if (charts.flow.data.labels.length > CONFIG.maxPoints) {
        charts.flow.data.labels.shift();
        charts.flow.data.datasets[0].data.shift();
      }
      
      charts.flow.update("none");
    }

    // Update usage log with real data
    updateUsageLog(water, canonical);
  }

  /**
   * Update UI elements with current values
   */
  function updateUI(canonical) {
    const updatedAt = document.getElementById("updatedAt");
    const totalEl = document.getElementById("totalWater24h");
    const flowEl = document.getElementById("currentFlowRate");

    if (!canonical) {
      if (updatedAt) updatedAt.textContent = "Last updated: --";
      if (totalEl) totalEl.textContent = "-- L";
      if (flowEl) flowEl.textContent = "-- L/s";
      return;
    }

    // Normalize and format timestamp using global function
    const dt = normalizeTimestamp(canonical.ts || canonical.timestamp);
    const formattedTS = window.GlobalState && window.GlobalState.formatTimestamp
      ? window.GlobalState.formatTimestamp(dt)
      : dt.toLocaleString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });

    if (updatedAt) {
      updatedAt.textContent = `Last updated: ${formattedTS}`;
    }
    
    // Get cumulative from global state to ensure consistency
    let cumulative = waterState.cumulative;
    if (window.GlobalState) {
      const state = window.GlobalState.getState();
      cumulative = state.lastCumulativeWater || cumulative;
    }
    
    if (totalEl && typeof cumulative === "number") {
      totalEl.textContent = `${cumulative.toFixed(1)} L`;
    }
    if (flowEl && typeof waterState.lastFlowRate === "number") {
      flowEl.textContent = `${waterState.lastFlowRate.toFixed(2)} L/s`;
    }
  }

  /**
   * Handle a single data payload (used by WS and polling)
   */
  function handleData(canonical) {
    if (!canonical) return;
    
    // Check if we should update charts (use global state as source of truth)
    if (freezeUpdates) return;
    
    // Check global state for simulation running
    if (window.GlobalState) {
      const state = window.GlobalState.getState();
      // If in SIMULATION mode and simulation is not running, don't update
      if (state.APP_MODE === "SIMULATION" && !state.simulationRunning) {
        return;
      }
    }
    
    // Fallback to APP_MODE if available
    if (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts()) {
      return;
    }
    
    updateCharts(canonical);
    updateUI(canonical);
  }

  /**
   * Polling tick
   */
  async function tick() {
    if (isStopped) return;
    
    // Check if we should update (use global state as source of truth)
    if (freezeUpdates) return;
    
    // Check global state for simulation running
    if (window.GlobalState) {
      const state = window.GlobalState.getState();
      // If in SIMULATION mode and simulation is not running, don't update
      if (state.APP_MODE === "SIMULATION" && !state.simulationRunning) {
        return;
      }
    }
    
    // Fallback to APP_MODE if available
    if (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts()) {
      return;
    }
    
    const canonical = await fetchData();
    if (canonical) {
      handleData(canonical);
    }
  }

  /**
   * Start polling fallback
   */
  function startPolling() {
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
    }
    if (isStopped) return;
    
    tick();
    refreshTimer = window.setInterval(() => {
      if (!isStopped) {
        tick();
      }
    }, CONFIG.pollIntervalMs);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !isStopped) {
        tick();
      }
    });
  }

  /**
   * Start WebSocket connection
   */
  function startWebSocket(url) {
    const wsUrl = url || window.WS_URL;
    if (!wsUrl) {
      return;
    }

    if (ws) {
      try {
        ws.close();
      } catch (e) {
        // Ignore
      }
      ws = null;
    }

    if (isStopped) return;

    try {
      // Use WebSocketClient if available
      if (typeof WebSocketClient !== "undefined") {
        ws = new WebSocketClient(wsUrl, {
          onMessage: (canonical) => {
            if (!isStopped) {
              handleData(canonical);
            }
          },
          onOpen: () => {
            console.log("Water Usage WebSocket connected");
          },
          onError: (error) => {
            console.error("Water Usage WebSocket error:", error);
          },
          onClose: () => {
            console.log("Water Usage WebSocket closed, will reconnect");
            if (!isStopped) {
              setTimeout(() => {
                if (!isStopped) {
                  startWebSocket(wsUrl);
                }
              }, 2000);
            }
          },
        });
        ws.connect();
      } else {
        // Native WebSocket fallback
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          if (!isStopped) {
            try {
              const rawData = JSON.parse(event.data);
              const canonical = window.DataIngestion
                ? window.DataIngestion.processIncoming(rawData)
                : rawData;
              if (canonical) {
                handleData(canonical);
              }
            } catch (e) {
              console.error("WebSocket parse error", { error: String(e) });
            }
          }
        };
        ws.onopen = () => {
          console.log("Water Usage WebSocket connected");
        };
        ws.onerror = (error) => {
          console.error("Water Usage WebSocket error", { error: String(error) });
        };
        ws.onclose = () => {
          console.log("Water Usage WebSocket closed, will reconnect");
          if (!isStopped) {
            setTimeout(() => {
              if (!isStopped) {
                startWebSocket(wsUrl);
              }
            }, 2000);
          }
        };
      }
    } catch (e) {
      console.error("WebSocket connection failed", { error: String(e) });
    }
  }

  /**
   * Stop polling and close WebSocket
   */
  function stop() {
    isStopped = true;
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        // Ignore
      }
      ws = null;
    }
  }

  /**
   * Bootstrap on page load
   */
  function bootstrap() {
    if (window.AppShell) {
      window.AppShell.rebindToggles();
    }

    // Load global state and check simulation state
    if (window.GlobalState) {
      window.GlobalState.loadState();
      const state = window.GlobalState.getState();
      
      // Set freezeUpdates if simulation is not running
      if (!state.simulationRunning && state.APP_MODE === "SIMULATION") {
        freezeUpdates = true;
      }
      
      // Restore cumulative water if available
      if (state.lastCumulativeWater) {
        waterState.cumulative = state.lastCumulativeWater;
        waterState.lastTotal = state.lastCumulativeWater;
      }
      
      // Restore APP_MODE
      if (state.APP_MODE && window.APP_MODE) {
        window.APP_MODE.setMode(state.APP_MODE);
        if (state.simulationRunning) {
          window.APP_MODE.setSimulationRunning(true);
        }
      }
    }

    // Load cumulative from storage
    loadCumulativeFromStorage();

    initCharts();

    // Listen to APP_MODE changes
    if (window.APP_MODE) {
      window.APP_MODE.onChange((state) => {
        freezeUpdates = !state.simulationRunning && state.mode === "SIMULATION";
        // Update global state
        if (window.GlobalState) {
          window.GlobalState.updateState({
            APP_MODE: state.mode,
            simulationRunning: state.simulationRunning,
          });
        }
      });
    }

    // Prefer WebSocket when configured; keep polling as fallback
    if (window.WS_URL) {
      startWebSocket(window.WS_URL);
    }
    startPolling();
  }

  // Initialize on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }

  // Expose API for debugging and external use
  window.WaterUsagePage = {
    initCharts,
    fetchData,
    updateCharts,
    updateUI,
    startAutoRefresh: startPolling,
    startWebSocket,
    handleData,
    stop,
    getState: () => ({
      waterState,
      recentUsage,
      freezeUpdates,
    }),
  };
})(window, document);
