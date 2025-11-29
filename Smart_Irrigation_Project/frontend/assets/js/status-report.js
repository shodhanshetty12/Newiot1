(function (window, document) {
  "use strict";

  // Configuration constants
  const CONFIG = {
    pollIntervalMs: window.STATUS_POLL_INTERVAL_MS || 1000,
    maxPoints: 300,
    apiUrl: window.STATUS_API_URL || "/api/status-report",
    sensorUrl: "/api/sensors/latest",
    summaryUrl: "/api/metrics/summary?range=24h",
    maxDeltaSeconds: 1.0, // Clamp large time deltas
    smoothAlpha: 0.3, // Exponential smoothing factor
    smoothThreshold: 1.2, // Only smooth if difference > threshold
    spikeThresholdLps: 5.0, // Mark spikes above this
    diagnosticsMaxLines: 80,
    localStorageKey: "irrigation_water_cumulative",
    localStorageTTL: 3600000, // 1 hour
  };

  // Chart instances (created once)
  let charts = {};
  let chartsInitialized = false;
  let refreshTimer = null;
  let ws = null;
  let isStopped = false;

  // Water state tracking
  const waterState = {
    lastTimestamp: null,
    lastTotal: null,
    cumulative: 0,
    lastFlowRate: 0,
    resetDetected: false,
  };

  // Smoothing state for temperature, humidity, moisture
  const smoothingState = {
    temperature: null,
    humidity: null,
    moisture: null,
  };

  // Diagnostics with deduplication
  const diagnostics = {
    entries: [],
    seenTimestamps: new Set(),
    maxEntries: CONFIG.diagnosticsMaxLines,
    droppedSamples: 0,
  };

  /**
   * Load cumulative from localStorage if valid
   */
  function loadCumulativeFromStorage() {
    try {
      const stored = localStorage.getItem(CONFIG.localStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        const age = Date.now() - parsed.timestamp;
        if (age < CONFIG.localStorageTTL) {
          waterState.cumulative = parsed.cumulative || 0;
          waterState.lastTotal = parsed.lastTotal || null;
          logLine("Loaded cumulative from localStorage", { cumulative: waterState.cumulative });
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

  /**
   * Get theme colors from CSS variables
   */
  function getThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
      text: styles.getPropertyValue("--text") || "#ffffff",
      muted: styles.getPropertyValue("--muted") || "#8a8fb0",
    };
  }

  /**
   * Log diagnostic entry with deduplication
   */
  function logLine(msg, meta) {
    const ts = new Date().toISOString();
    const tsKey = ts.substring(0, 19);
    const line = meta ? `${ts} | ${msg} | ${JSON.stringify(meta)}` : `${ts} | ${msg}`;

    // Deduplicate by timestamp + message
    const dedupeKey = `${tsKey}|${msg}`;
    if (diagnostics.seenTimestamps.has(dedupeKey)) {
      return;
    }
    diagnostics.seenTimestamps.add(dedupeKey);

    diagnostics.entries.push(line);
    if (diagnostics.entries.length > diagnostics.maxEntries) {
      const removed = diagnostics.entries.shift();
    }

    // Clean up seenTimestamps periodically
    if (diagnostics.seenTimestamps.size > diagnostics.maxEntries * 2) {
      diagnostics.seenTimestamps.clear();
      diagnostics.entries.forEach((entry) => {
        const parts = entry.split(" | ");
        if (parts.length >= 2) {
          const key = parts[0].substring(0, 19) + "|" + parts[1];
          diagnostics.seenTimestamps.add(key);
        }
      });
    }

    const logEl = document.getElementById("statusLog");
    if (logEl) {
      logEl.textContent = diagnostics.entries.join("\n");
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  /**
   * Set mode badge (remove previous to prevent duplication)
   */
  function setModeBadge(mode, simulated) {
    // Remove any existing .mode-indicator elements
    const existing = document.querySelectorAll(".mode-indicator");
    existing.forEach((el) => el.remove());

    const el = document.getElementById("dataModeBadge");
    if (!el) return;
    const label = simulated ? "SIMULATION" : "HARDWARE";
    el.textContent = `Mode: ${mode?.toUpperCase?.() || "--"} • ${label}`;
    el.classList.add("mode-indicator");
  }

  /**
   * Create a line chart (called once per chart)
   */
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
        animation: false, // Disable all animations
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

  /**
   * Initialize charts once (never reinitialize)
   */
  function initCharts() {
    if (chartsInitialized) {
      return;
    }

    const waterCumCtx = document.getElementById("waterCumulativeChart");
    const waterFlowCtx = document.getElementById("waterFlowChart");
    const moistureCtx = document.getElementById("moistureChart");
    const tempCtx = document.getElementById("tempChart");
    const humCtx = document.getElementById("humChart");

    if (!window.Chart || !waterCumCtx || !waterFlowCtx || !moistureCtx || !tempCtx || !humCtx) {
      window.setTimeout(initCharts, 150);
      return;
    }

    // Create charts only once
    charts.waterCumulative = createLineChart(
      waterCumCtx,
      "Water (cumulative 24h)",
      "#00e5ff",
      "rgba(0,229,255,0.18)"
    );
    charts.waterFlow = createLineChart(
      waterFlowCtx,
      "Instantaneous flow (L/s)",
      "#ffea00",
      "rgba(255,234,0,0.18)"
    );
    charts.moisture = createLineChart(
      moistureCtx,
      "Soil Moisture",
      "#69f0ae",
      "rgba(105,240,174,0.18)"
    );
    charts.temperature = createLineChart(
      tempCtx,
      "Temperature (°C)",
      "#ff5252",
      "rgba(255,82,82,0.18)"
    );
    charts.humidity = createLineChart(
      humCtx,
      "Humidity (%)",
      "#ea80fc",
      "rgba(234,128,252,0.18)"
    );

    chartsInitialized = true;
    window.__chartsInitialized = true;
    logLine("Charts initialized", {});
  }

  /**
   * Sync mode from AppShell or API
   */
  async function syncMode() {
    try {
      if (window.AppShell) {
        const state = window.AppShell.getState();
        if (state && state.mode) {
          const mode = state.mode === "hardware" ? "HARDWARE" : "SIMULATION";
          if (window.APP_MODE) {
            window.APP_MODE.setMode(mode);
          }
          setModeBadge(mode, mode !== "HARDWARE");
          return mode;
        }
      }
      const res = await fetch("/api/mode");
      if (res.ok) {
        const data = await res.json();
        const mode = data.mode === "hardware" ? "HARDWARE" : "SIMULATION";
        if (window.APP_MODE) {
          window.APP_MODE.setMode(mode);
        }
        setModeBadge(mode, mode !== "HARDWARE");
        return mode;
      }
    } catch (e) {
      logLine("syncMode error", { error: String(e) });
    }
    return window.APP_MODE ? window.APP_MODE.mode : "SIMULATION";
  }

  /**
   * Apply exponential smoothing to sensor values
   */
  function applySmoothing(key, newValue) {
    if (typeof newValue !== "number" || Number.isNaN(newValue)) {
      return newValue;
    }

    const prev = smoothingState[key];
    if (prev === null) {
      smoothingState[key] = newValue;
      return newValue;
    }

    const diff = Math.abs(newValue - prev);
    if (diff > CONFIG.smoothThreshold) {
      // Apply smoothing: smoothed = prev * (1 - alpha) + next * alpha
      const smoothed = prev * (1 - CONFIG.smoothAlpha) + newValue * CONFIG.smoothAlpha;
      smoothingState[key] = smoothed;
      return smoothed;
    }

    smoothingState[key] = newValue;
    return newValue;
  }

  /**
   * Process water data with proper cumulative and instantaneous flow calculation
   */
  function processWaterData(canonical) {
    if (!canonical) return null;

    const tsMs = canonical.ts;
    const deltaSeconds = canonical.deltaSeconds || 0;

    const flowRate = canonical.flow_rate_lps;
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
          logLine("Water total reset/wrap detected", {
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
        const delta = flowRate * deltaSeconds;
        cumulative += delta;
        instantaneous = flowRate;
      } else {
        // Pump is OFF - instantaneous should be 0
        instantaneous = 0;
        // Cumulative stays the same (no increment)
      }
      waterState.lastTotal = cumulative;
    } else {
      // No water data - keep previous state
      if (pumpState === false) {
        instantaneous = 0;
      }
    }

    // Clamp instantaneous to >= 0
    instantaneous = Math.max(0, instantaneous);

    // Mark spikes
    if (instantaneous > CONFIG.spikeThresholdLps) {
      logLine("Flow spike detected", { instantaneous, threshold: CONFIG.spikeThresholdLps });
    }

    // Update state
    waterState.cumulative = cumulative;
    waterState.lastFlowRate = instantaneous;
    waterState.lastTimestamp = tsMs;
    
    // Persist to localStorage
    saveCumulativeToStorage();

    return {
      instantaneous,
      cumulative,
      timestamp: new Date(tsMs),
      pumpState,
      resetDetected: waterState.resetDetected,
    };
  }

  /**
   * Fetch data from API (with array handling)
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
        logLine("status-report endpoint non-404 error", { status: res.status });
      }
    } catch (e) {
      logLine("status-report fetch failed, falling back", { error: String(e) });
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
      logLine("Fallback fetch error", { error: String(e) });
      return null;
    }
  }

  /**
   * Fetch data (simulation or API)
   */
  async function fetchData() {
    await syncMode();

    // Check if we should update charts
    if (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts()) {
      return null; // Don't fetch if simulation is off and mode is SIMULATION
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
      logLine("fetchData error", { error: String(error) });
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
   * Update all charts with new sample
   */
  function updateCharts(canonical) {
    if (!canonical) return;

    // Check if we should update charts
    if (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts()) {
      return; // Don't update if simulation is off and mode is SIMULATION
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

    pushPoint(charts.waterCumulative, label, water.cumulative);
    pushPoint(charts.waterFlow, label, water.instantaneous);

    // Apply smoothing to sensor values (NOT to cumulative water)
    if (typeof canonical.soil_moisture === "number") {
      const smoothed = applySmoothing("moisture", canonical.soil_moisture);
      pushPoint(charts.moisture, label, smoothed);
    }
    if (typeof canonical.temperature === "number") {
      const smoothed = applySmoothing("temperature", canonical.temperature);
      pushPoint(charts.temperature, label, smoothed);
    }
    if (typeof canonical.humidity === "number") {
      const smoothed = applySmoothing("humidity", canonical.humidity);
      pushPoint(charts.humidity, label, smoothed);
    }

    // Log reset if detected
    if (water.resetDetected) {
      logLine("Cumulative water reset detected - chart continues from new baseline", {});
      waterState.resetDetected = false;
    }
  }

  /**
   * Update UI elements with current values
   */
  function updateUI(canonical) {
    const tempEl = document.getElementById("currentTemp");
    const humEl = document.getElementById("currentHumidity");
    const moistEl = document.getElementById("currentMoisture");
    const waterEl = document.getElementById("totalWater24h");
    const updatedAt = document.getElementById("updatedAt");

    if (!canonical) {
      if (tempEl) tempEl.textContent = "-- °C";
      if (humEl) humEl.textContent = "-- %";
      if (moistEl) moistEl.textContent = "--";
      if (waterEl) waterEl.textContent = "-- L";
      if (updatedAt) updatedAt.textContent = "Last updated: --";
      return;
    }

    const ts = new Date(canonical.ts);
    
    // Use smoothed values for UI to match charts
    if (tempEl && typeof canonical.temperature === "number") {
      const smoothed = applySmoothing("temperature", canonical.temperature);
      tempEl.textContent = `${smoothed.toFixed(1)} °C`;
    }
    if (humEl && typeof canonical.humidity === "number") {
      const smoothed = applySmoothing("humidity", canonical.humidity);
      humEl.textContent = `${smoothed.toFixed(1)} %`;
    }
    if (moistEl && typeof canonical.soil_moisture === "number") {
      const smoothed = applySmoothing("moisture", canonical.soil_moisture);
      moistEl.textContent = `${smoothed.toFixed(0)}`;
    }
    if (waterEl && typeof waterState.cumulative === "number") {
      waterEl.textContent = `${waterState.cumulative.toFixed(1)} L`;
    }
    if (updatedAt) {
      updatedAt.textContent = `Last updated: ${ts.toLocaleTimeString()}`;
    }
  }

  /**
   * Handle a single data payload (used by WS and polling)
   */
  function handleData(canonical) {
    if (!canonical) return;
    
    // Check if we should update charts
    if (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts()) {
      return; // Don't update if simulation is off and mode is SIMULATION
    }
    
    updateCharts(canonical);
    updateUI(canonical);
    
    // Check for anomalies
    if (window.NotificationsManager) {
      window.NotificationsManager.checkForAnomalies(canonical);
    }
  }

  /**
   * Polling tick
   */
  async function tick() {
    if (isStopped) return;
    
    // Check if we should update
    if (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts()) {
      return; // Don't poll if simulation is off and mode is SIMULATION
    }
    
    const canonical = await fetchData();
    if (canonical) {
      handleData(canonical);
    } else {
      // Log dropped sample if DataIngestion is available
      if (window.DataIngestion) {
        const stats = window.DataIngestion.getStats();
        if (stats.droppedSamples > diagnostics.droppedSamples) {
          diagnostics.droppedSamples = stats.droppedSamples;
          logLine("Sample dropped (invalid timestamp or out of order)", {
            totalDropped: diagnostics.droppedSamples,
          });
        }
      }
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

    logLine("Opening WebSocket", { url: wsUrl });

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
            logLine("WebSocket connected", {});
          },
          onError: (error) => {
            logLine("WebSocket error", { error: String(error) });
          },
          onClose: () => {
            logLine("WebSocket closed, will reconnect", {});
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
              logLine("WebSocket parse error", { error: String(e) });
            }
          }
        };
        ws.onopen = () => {
          logLine("WebSocket connected", {});
        };
        ws.onerror = (error) => {
          logLine("WebSocket error", { error: String(error) });
        };
        ws.onclose = () => {
          logLine("WebSocket closed, will reconnect", {});
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
      logLine("WebSocket connection failed", { error: String(e) });
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
    logLine("Status report stopped", {});
  }

  /**
   * Fetch once (for testing)
   */
  async function fetchOnce() {
    const canonical = await fetchData();
    if (canonical) {
      handleData(canonical);
    }
    return canonical;
  }

  /**
   * Bootstrap on page load
   */
  function bootstrap() {
    if (window.AppShell) {
      window.AppShell.rebindToggles();
    }

    // Load cumulative from storage
    loadCumulativeFromStorage();

    initCharts();

    // Listen to APP_MODE changes
    if (window.APP_MODE) {
      window.APP_MODE.onChange((state) => {
        logLine("APP_MODE changed", { mode: state.mode, simulationRunning: state.simulationRunning });
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
  window.__statusReport = {
    state: {
      waterState,
      smoothingState,
      chartsInitialized,
      isStopped,
    },
    fetchOnce,
    startPolling,
    startWebSocket,
    stop,
    handleData,
    initCharts,
    getDiagnostics: () => ({
      entries: diagnostics.entries,
      droppedSamples: diagnostics.droppedSamples,
    }),
  };

  // Also expose as StatusReportPage for backward compatibility
  window.StatusReportPage = {
    initCharts,
    fetchData,
    updateCharts,
    updateUI,
    startAutoRefresh: startPolling,
    startWebSocket,
    handleData,
  };
})(window, document);
