(function (window, document) {
  "use strict";

  const CONFIG = {
    pollIntervalMs: window.WATER_POLL_INTERVAL_MS || 1000,
    maxPoints: 300,
    apiUrl: "/api/water/usage",
    metricsUrl: "/api/metrics/water?range=24h",
    localStorageKey: "irrigation_water_cumulative",
    localStorageTTL: 3600000, // 1 hour
  };

  let charts = {};
  let chartsInitialized = false;
  let refreshTimer = null;
  let wsClient = null;
  let isStopped = false;

  const waterState = {
    lastTimestamp: null,
    lastTotal: null,
    cumulative: 0,
    lastFlowRate: 0,
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
  }

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
          console.warn("Water total reset/wrap detected", {
            previous: waterState.lastTotal,
            current: totalFromBackend,
          });
          cumulative = totalFromBackend;
          instantaneous = 0;
        } else {
          instantaneous = deltaSeconds > 0 ? diff / deltaSeconds : 0;
          cumulative = totalFromBackend;
        }
      } else {
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
        instantaneous = 0;
      }
      waterState.lastTotal = cumulative;
    } else {
      if (pumpState === false) {
        instantaneous = 0;
      }
    }

    // Clamp instantaneous to >= 0
    instantaneous = Math.max(0, instantaneous);

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
    };
  }

  async function fetchFromApi() {
    try {
      const [usageRes, metricsRes] = await Promise.all([
        fetch(`${CONFIG.apiUrl}?_=${Date.now()}`, { cache: "no-store" }),
        fetch(`${CONFIG.metricsUrl}&_=${Date.now()}`, { cache: "no-store" }),
      ]);

      const usageData = usageRes.ok ? await usageRes.json() : [];
      const metricsData = metricsRes.ok ? await metricsRes.json() : [];

      let totalLiters = 0;
      if (metricsData.length > 0) {
        totalLiters = metricsData.reduce((sum, r) => sum + (r.liters || 0), 0);
      } else if (usageData.length > 0) {
        totalLiters = usageData.reduce(
          (sum, r) => sum + (Number(r.liters_used) || 0),
          0
        );
      }

      const latest = Array.isArray(usageData) && usageData.length > 0 
        ? usageData[usageData.length - 1] 
        : null;

      const combined = {
        timestamp: latest?.timestamp || Date.now(),
        water_total_liters: totalLiters,
        flow_rate_lps: null,
        pump_state: null,
      };

      // Use DataIngestion to normalize
      if (window.DataIngestion) {
        return window.DataIngestion.processIncoming(combined);
      }
      return combined;
    } catch (error) {
      console.error("Failed to fetch water usage:", error);
      return null;
    }
  }

  async function fetchData() {
    // Check if we should update charts
    if (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts()) {
      return null;
    }

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
      console.error("fetchData error:", error);
      return null;
    }
  }

  function pushPoint(chart, label, value) {
    if (!chart || typeof value !== "number" || Number.isNaN(value)) return;
    const labels = chart.data.labels;
    const data = chart.data.datasets[0].data;
    labels.push(label);
    data.push(value);
    if (labels.length > CONFIG.maxPoints) {
      labels.shift();
      data.shift();
    }
    chart.update("none");
  }

  function updateCharts(canonical) {
    if (!canonical) return;

    // Check if we should update charts
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

    pushPoint(charts.cumulative, label, water.cumulative);
    pushPoint(charts.flow, label, water.instantaneous);
  }

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

    const ts = new Date(canonical.ts);
    if (updatedAt) {
      updatedAt.textContent = `Last updated: ${ts.toLocaleTimeString()}`;
    }
    if (totalEl && typeof waterState.cumulative === "number") {
      totalEl.textContent = `${waterState.cumulative.toFixed(1)} L`;
    }
    if (flowEl && typeof waterState.lastFlowRate === "number") {
      flowEl.textContent = `${waterState.lastFlowRate.toFixed(2)} L/s`;
    }
  }

  function handleData(canonical) {
    if (!canonical) return;
    
    // Check if we should update charts
    if (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts()) {
      return;
    }
    
    updateCharts(canonical);
    updateUI(canonical);
  }

  async function tick() {
    if (isStopped) return;
    
    // Check if we should update
    if (window.APP_MODE && !window.APP_MODE.shouldUpdateCharts()) {
      return;
    }
    
    const canonical = await fetchData();
    if (canonical) {
      handleData(canonical);
    }
  }

  function startAutoRefresh() {
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

  function startWebSocket() {
    const url = window.WS_URL;
    if (!url || typeof WebSocketClient === "undefined") {
      return;
    }

    if (wsClient) {
      wsClient.close();
    }

    if (isStopped) return;

    wsClient = new WebSocketClient(url, {
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
    });

    wsClient.connect();
  }

  function bootstrap() {
    if (window.AppShell) {
      window.AppShell.rebindToggles();
    }

    // Load cumulative from storage
    loadCumulativeFromStorage();

    initCharts();

    if (window.WS_URL) {
      startWebSocket();
    }
    startAutoRefresh();
  }

  document.addEventListener("DOMContentLoaded", bootstrap);

  window.WaterUsagePage = {
    initCharts,
    fetchData,
    updateCharts,
    updateUI,
    startAutoRefresh,
    startWebSocket,
    handleData,
  };
})(window, document);
