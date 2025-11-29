/**
 * Global timestamp normalization function
 * Handles ISO strings, epoch seconds, and epoch milliseconds
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

// Load global state
if (window.GlobalState) {
  window.GlobalState.loadState();
}

let simulationInterval;
let waterUsed = 0;
let modeSynced = false;

// Get initial state from GlobalState
const initialState = window.GlobalState ? window.GlobalState.getState() : {};
let simulationRunning = initialState.simulationRunning || false;
let pumpStatus = initialState.pumpState || "OFF";
let autoMode = initialState.autoPumpMode || false;
let currentMode = initialState.APP_MODE === "HARDWARE" ? "hardware" : "simulation";

// DOM Elements
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const tableBody = document.getElementById("simulationTableBody");
const pumpStatusEl = document.getElementById("pumpStatus");
const waterUsageEl = document.getElementById("waterUsage");
const autoModeToggle = document.getElementById("autoModeToggle");
const statusEl = document.getElementById("status");
const autoScrollToggle = document.getElementById("autoScrollToggle");

/* ------------------- UI Update Functions ------------------- */
function updatePumpStatus(status) {
  pumpStatus = status;
  
  // Update global state (persists across pages)
  if (window.GlobalState) {
    window.GlobalState.updateState({ pumpState: status });
  }
  
  if (!pumpStatusEl) return;
  pumpStatusEl.textContent = `Pump Status: ${status}`;
  pumpStatusEl.style.color = status === "ON" ? "green" : "red";
  
  // Update status indicator
  const statusIndicator = document.getElementById("pumpStatusIndicator");
  if (statusIndicator) {
    statusIndicator.className = `status-indicator ${status === "ON" ? "status-online" : "status-offline"}`;
    statusIndicator.textContent = status;
  }
  
  // Update nav badge
  document.querySelectorAll('[data-app-nav="pump"]').forEach((el) => {
    el.textContent = `Pump: ${status}`;
  });
}

function setWaterUsage(amount) {
  waterUsed = Number(amount || 0);
  if (waterUsageEl) {
    waterUsageEl.textContent = `Water Used: ${waterUsed.toFixed(1)} L`;
  }
  
  // Update global state
  if (window.GlobalState) {
    window.GlobalState.updateState({ lastCumulativeWater: waterUsed });
  }
  
  // Update nav badge
  document.querySelectorAll('[data-app-nav="water"]').forEach((el) => {
    el.textContent = `Water: ${waterUsed.toFixed(1)} L`;
  });
}

async function ensureModeSynced() {
  // Check global state first
  const globalState = window.GlobalState ? window.GlobalState.getState() : {};
  if (globalState.APP_MODE) {
    currentMode = globalState.APP_MODE === "HARDWARE" ? "hardware" : "simulation";
  }
  
  if (window.AppShell) {
    const state = window.AppShell.getState();
    if (state?.mode) {
      currentMode = state.mode;
      // Update global state
      if (window.GlobalState) {
        window.GlobalState.updateState({ APP_MODE: currentMode === "hardware" ? "HARDWARE" : "SIMULATION" });
      }
      return currentMode;
    }
  }
  if (modeSynced) {
    return currentMode;
  }
  try {
    const res = await fetch("/api/mode", { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      currentMode = data.mode || currentMode;
      // Update global state
      if (window.GlobalState) {
        window.GlobalState.updateState({ APP_MODE: currentMode === "hardware" ? "HARDWARE" : "SIMULATION" });
      }
    }
  } catch (error) {
    console.warn("Failed to sync mode:", error);
  } finally {
    modeSynced = true;
  }
  return currentMode;
}

function bindGlobalStatus() {
  if (!window.AppShell || window.AppShell.__dashboardBound) {
    return;
  }
  window.AppShell.__dashboardBound = true;
  window.AppShell.onStatus((status) => {
    if (status?.mode) {
      currentMode = status.mode;
    }
    if (status?.pump_status) {
      updatePumpStatus((status.pump_status || "OFF").toUpperCase());
    }
    if (typeof status?.water_used === "number") {
      setWaterUsage(status.water_used);
    }
    if (statusEl && status) {
      statusEl.textContent = `Mode: ${status.mode || "simulation"} | Pump: ${(status.pump_status || "OFF").toUpperCase()} | Simulation: ${
        status.simulation_running ? "RUNNING" : "STOPPED"
      }`;
    }
  });
}

/* ------------------- Simulation Logic ------------------- */
async function fetchSimulationData() {
  try {
    await ensureModeSynced();
    const mode = currentMode;
    let data;
    if (mode === 'hardware') {
      const r = await fetch('/api/sensors/latest', { cache: 'no-store' });
      data = await r.json();
      if (!data || !data.timestamp) {
        statusEl && (statusEl.textContent = 'Waiting for hardware data...');
        return;
      }
    } else {
      const response = await fetch("/api/simulation/data", { cache: 'no-store' });
      data = await response.json();

      // Handle simulation status responses
      if (data.status === "stopped") {
        statusEl.textContent = "Simulation stopped.";
        clearInterval(simulationInterval);
        simulationRunning = false;
        return;
      }
      if (data.status === "completed") {
        statusEl.textContent = "Simulation completed.";
        clearInterval(simulationInterval);
        simulationRunning = false;
        return;
      }
      if (data.status === "starting") {
        statusEl.textContent = "Simulation starting...";
        return;
      }
    }

    // Insert row into table
    if (tableBody && data.timestamp) {
      // Normalize and format timestamp
      const dt = normalizeTimestamp(data.timestamp);
      const formatted = dt.toLocaleString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${formatted}</td>
        <td>${data.soil_moisture || '--'}</td>
        <td>${data.temperature || '--'}</td>
        <td>${data.humidity || '--'}</td>
      `;
      tableBody.appendChild(row);
      
      // Auto-scroll only the table container, not the whole page
      if (!autoScrollToggle || autoScrollToggle.checked) {
        const scrollContainer = document.querySelector('.reading-scroll-container');
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
      
      // Dispatch update event
      if (tableBody) {
        tableBody.dispatchEvent(new Event("data-updated"));
      }
    }

    // Pump control
    if (autoMode && mode !== 'hardware') {
      if (data.pump_status === 1 || data.soil_moisture < 400) {
        updatePumpStatus("ON");
      } else {
        updatePumpStatus("OFF");
      }
    }
  } catch (error) {
    console.error("Error fetching simulation data:", error);
  }
}

/* ------------------- Button Handlers ------------------- */
if (startBtn) {
  startBtn.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/simulation/start", { method: "POST", cache: 'no-store' });
      const result = await res.json();
      if (result.status === "started") {
        statusEl.textContent = "Simulation started.";
        simulationRunning = true;
        
        // Update global state
        if (window.GlobalState) {
          window.GlobalState.updateState({ simulationRunning: true });
        }
        
        // Update APP_MODE if available
        if (window.APP_MODE) {
          window.APP_MODE.setSimulationRunning(true);
        }
        
        // Clear old data on simulation start
        if (tableBody) {
          tableBody.innerHTML = "";
          tableBody.dispatchEvent(new Event("data-updated"));
        }
        simulationInterval = setInterval(fetchSimulationData, 1000);
      }
    } catch (error) {
      statusEl.textContent = "Failed to start simulation.";
      console.error("Failed to start simulation:", error);
    }
  });
}

if (stopBtn) {
  stopBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/simulation/stop", { method: "POST", cache: 'no-store' });
      statusEl.textContent = "Simulation stopped.";
    } catch (error) {
      statusEl.textContent = "Failed to stop simulation.";
      console.error("Failed to stop simulation:", error);
    }
    simulationRunning = false;
    
    // Update global state
    if (window.GlobalState) {
      window.GlobalState.updateState({ simulationRunning: false });
    }
    
    // Update APP_MODE if available
    if (window.APP_MODE) {
      window.APP_MODE.setSimulationRunning(false);
    }
    
    clearInterval(simulationInterval);
    updatePumpStatus("OFF");
  });
}

if (autoModeToggle) {
  // Restore auto pump mode state
  autoModeToggle.checked = autoMode;
  
  autoModeToggle.addEventListener("change", (e) => {
    autoMode = e.target.checked;
    // Update global state
    if (window.GlobalState) {
      window.GlobalState.updateState({ autoPumpMode: autoMode });
    }
  });
}

if (autoScrollToggle) {
  // Restore auto scroll state
  const state = window.GlobalState ? window.GlobalState.getState() : {};
  autoScrollToggle.checked = state.autoScroll || false;
  
  autoScrollToggle.addEventListener("change", (e) => {
    // Update global state
    if (window.GlobalState) {
      window.GlobalState.updateState({ autoScroll: e.target.checked });
    }
  });
}

/* ------------------- Initialization on Load ------------------- */
  async function initializeFromBackend() {
    try {
      // Load global state first and restore UI
      if (window.GlobalState) {
        window.GlobalState.loadState();
        const state = window.GlobalState.getState();
        
        // Restore pump state (never reset to OFF)
        if (state.pumpState) {
          updatePumpStatus(state.pumpState);
        }
        
        // Restore auto pump mode
        if (autoModeToggle) {
          autoModeToggle.checked = state.autoPumpMode || false;
          autoMode = state.autoPumpMode || false;
        }
        
        // Restore auto scroll
        if (autoScrollToggle) {
          autoScrollToggle.checked = state.autoScroll || false;
        }
        
        // Restore water usage
        if (waterUsageEl && state.lastCumulativeWater) {
          setWaterUsage(state.lastCumulativeWater);
        }
        
        // Restore simulation running state
        if (state.simulationRunning) {
          simulationRunning = true;
        }
      }
      
      // Cross-page status (priming before AppShell)
      try {
        const st = await fetch('/api/status', { cache: 'no-store' });
        const sj = await st.json();
        
        // Only update pump if global state doesn't have it
        if (sj && sj.pump_status) {
          const backendPumpState = (sj.pump_status || 'OFF').toUpperCase();
          if (window.GlobalState) {
            const state = window.GlobalState.getState();
            // Use global state if it exists, otherwise use backend
            if (state.pumpState) {
              updatePumpStatus(state.pumpState);
            } else {
              updatePumpStatus(backendPumpState);
            }
          } else {
            updatePumpStatus(backendPumpState);
          }
        }
        
        if (waterUsageEl && typeof sj.water_used === 'number') {
          setWaterUsage(Number(sj.water_used || 0));
        }
        if (statusEl && sj) {
          statusEl.textContent = `Mode: ${sj.mode || 'simulation'} | Pump: ${(sj.pump_status||'OFF').toUpperCase()} | Simulation: ${sj.simulation_running ? 'RUNNING' : 'STOPPED'}`;
        }
        if (sj && sj.mode) {
          currentMode = sj.mode;
          // Update global state
          if (window.GlobalState) {
            window.GlobalState.updateState({ 
              APP_MODE: currentMode === "hardware" ? "HARDWARE" : "SIMULATION" 
            });
          }
        }
      } catch {}
    // Initialize table with recent data if exists
    if (tableBody) {
      const res = await fetch("/api/data/recent?limit=50", { cache: 'no-store' });
      const rows = await res.json();
      tableBody.innerHTML = "";
      rows.reverse().forEach(r => {
        // Normalize and format timestamp
        const dt = normalizeTimestamp(r.timestamp);
        const formatted = dt.toLocaleString('en-GB', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${formatted}</td>
          <td>${r.soil_moisture || '--'}</td>
          <td>${r.temperature || '--'}</td>
          <td>${r.humidity || '--'}</td>
        `;
        tableBody.appendChild(tr);
      });
      if (rows.length > 0) {
        const last = rows[0];
        updatePumpStatus(last.pump_status === 1 || last.pump_status === "ON" ? "ON" : "OFF");
      }
      // Dispatch update event
      tableBody.dispatchEvent(new Event("data-updated"));
    }

    // Initialize water total from water usage logs
    if (waterUsageEl) {
      const usageRes = await fetch("/api/water/usage", { cache: 'no-store' });
      const usageData = await usageRes.json();
      const total = usageData.reduce((sum, r) => sum + Number(r.liters_used || 0), 0);
      setWaterUsage(total);
    }
  } catch (e) {
    console.error("Failed to initialize dashboard:", e);
  }
}

async function resumeIfRunning() {
  try {
    // Check global state first
    const state = window.GlobalState ? window.GlobalState.getState() : {};
    const shouldResume = state.simulationRunning || false;
    
    // Also check backend status
    const res = await fetch("/api/simulation/status", { cache: 'no-store' });
    const s = await res.json();
    
    if (shouldResume || s.running) {
      simulationRunning = true;
      statusEl && (statusEl.textContent = "Simulation running...");
      if (simulationInterval) clearInterval(simulationInterval);
      simulationInterval = setInterval(fetchSimulationData, 1000);
      
      // Update APP_MODE if available
      if (window.APP_MODE) {
        window.APP_MODE.setSimulationRunning(true);
      }
    }
  } catch (e) {
    // ignore
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initializeFromBackend();
  resumeIfRunning();
  bindGlobalStatus();
});
