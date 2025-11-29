(function (window) {
  "use strict";

  const GLOBAL_STATE_KEY = "smart_irrigation_state";

  let GLOBAL_STATE = {
    simulationRunning: false,
    autoPumpMode: false,
    autoScroll: false,
    pumpState: "OFF",
    APP_MODE: "SIMULATION",
    soilThreshold: 300,
    lastCumulativeWater: 0,
    lastTimestamp: 0,
    unreadNotifications: 0,
  };

  /**
   * Save state to localStorage
   */
  function saveState() {
    try {
      localStorage.setItem(GLOBAL_STATE_KEY, JSON.stringify(GLOBAL_STATE));
    } catch (e) {
      console.warn("Failed to save global state:", e);
    }
  }

  /**
   * Load state from localStorage
   */
  function loadState() {
    try {
      const saved = localStorage.getItem(GLOBAL_STATE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        GLOBAL_STATE = { ...GLOBAL_STATE, ...parsed };
      }
    } catch (e) {
      console.warn("Failed to load global state:", e);
    }
  }

  /**
   * Update state with partial object
   */
  function updateState(partial) {
    GLOBAL_STATE = { ...GLOBAL_STATE, ...partial };
    saveState();
    
    // Notify listeners
    if (window.GlobalState && window.GlobalState.listeners) {
      window.GlobalState.listeners.forEach((listener) => {
        try {
          listener(GLOBAL_STATE);
        } catch (e) {
          console.error("GlobalState listener error:", e);
        }
      });
    }
  }

  /**
   * Get current state
   */
  function getState() {
    return { ...GLOBAL_STATE };
  }

  /**
   * Reset state to defaults
   */
  function resetState() {
    GLOBAL_STATE = {
      simulationRunning: false,
      autoPumpMode: false,
      autoScroll: false,
      pumpState: "OFF",
      APP_MODE: "SIMULATION",
      soilThreshold: 300,
      lastCumulativeWater: 0,
      lastTimestamp: 0,
      unreadNotifications: 0,
    };
    saveState();
  }

  /**
   * Global timestamp formatting function
   */
  function formatTimestamp(dt) {
    if (!dt) dt = new Date();
    if (typeof dt === 'number') {
      dt = new Date(dt);
    } else if (typeof dt === 'string') {
      dt = new Date(dt);
    }
    return dt.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  // Initialize listeners array
  const listeners = new Set();

  // Expose API
  window.GlobalState = {
    saveState,
    loadState,
    updateState,
    getState,
    resetState,
    formatTimestamp,
    listeners,
    onChange(listener) {
      if (typeof listener === "function") {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
      return () => {};
    },
  };

  // Load state on initialization
  loadState();
})(window);

