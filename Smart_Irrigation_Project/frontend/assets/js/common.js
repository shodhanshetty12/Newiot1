(function (window, document) {
  "use strict";

  if (window.AppShell) {
    return;
  }

  const state = {
    theme: localStorage.getItem("theme") || "light",
    mode: "simulation",
    status: null,
  };

  const THEME_TOGGLES = new Set();
  const THEME_LISTENERS = new Set();
  const MODE_TOGGLES = new Set();
  const STATUS_LISTENERS = new Set();

  let statusInterval = null;
  let initialized = false;
  let syncingMode = false;

  function applyTheme(theme) {
    state.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute(
      "data-theme",
      state.theme === "dark" ? "dark" : ""
    );
    localStorage.setItem("theme", state.theme);
    THEME_TOGGLES.forEach((input) => {
      if (input instanceof HTMLInputElement) {
        input.checked = state.theme === "dark";
      }
    });
    THEME_LISTENERS.forEach((listener) => {
      try {
        listener(state.theme);
      } catch (error) {
        console.error("Theme listener failed:", error);
      }
    });
  }

  function handleThemeChange(event) {
    applyTheme(event.target.checked ? "dark" : "light");
  }

  function initThemeToggles() {
    document
      .querySelectorAll('[data-app-toggle="theme"]')
      .forEach((input) => {
        if (!(input instanceof HTMLInputElement) || THEME_TOGGLES.has(input)) {
          return;
        }
        THEME_TOGGLES.add(input);
        input.checked = state.theme === "dark";
        input.addEventListener("change", handleThemeChange);
      });
    applyTheme(state.theme);
  }

  function setThemeMode(nextTheme) {
    applyTheme(nextTheme === "dark" ? "dark" : "light");
  }

  function updateModeToggles() {
    const isHardware = state.mode === "hardware";
    MODE_TOGGLES.forEach((input) => {
      if (input instanceof HTMLInputElement) {
        input.checked = isHardware;
      }
    });
  }

  function setModeBusy(disabled) {
    MODE_TOGGLES.forEach((input) => {
      if (input instanceof HTMLInputElement) {
        input.disabled = disabled;
      }
    });
  }

  async function setMode(nextMode) {
    if (syncingMode) {
      return;
    }

    const normalized =
      nextMode === "hardware" ? "hardware" : "simulation";
    if (state.mode === normalized) {
      updateModeToggles();
      return;
    }

    syncingMode = true;
    setModeBusy(true);
    try {
      const res = await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: normalized }),
      });
      if (res.ok) {
        const data = await res.json();
        state.mode = data.mode || normalized;
      }
    } catch (error) {
      console.error("Failed to update mode:", error);
    } finally {
      syncingMode = false;
      setModeBusy(false);
      updateModeToggles();
    }
  }

  async function syncModeFromBackend() {
    try {
      const res = await fetch("/api/mode");
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      state.mode = data.mode || state.mode;
      updateModeToggles();
    } catch (error) {
      console.warn("Mode sync failed:", error);
    }
  }

  function handleModeToggle(event) {
    setMode(event.target.checked ? "hardware" : "simulation");
  }

  function initModeToggles() {
    document
      .querySelectorAll('[data-app-toggle="mode"]')
      .forEach((input) => {
        if (!(input instanceof HTMLInputElement) || MODE_TOGGLES.has(input)) {
          return;
        }
        MODE_TOGGLES.add(input);
        input.addEventListener("change", handleModeToggle);
      });
    updateModeToggles();
  }

  function updateNavBadges(status) {
    const modeLabel = status?.mode || state.mode;
    const pumpLabel = status?.pump_status || "OFF";
    const waterValue = typeof status?.water_used === "number"
      ? status.water_used.toFixed(1)
      : "0.0";

    document.querySelectorAll('[data-app-nav="mode"]').forEach((el) => {
      el.textContent = `Mode: ${modeLabel?.toUpperCase() || "--"}`;
    });
    document.querySelectorAll('[data-app-nav="pump"]').forEach((el) => {
      const upper = pumpLabel?.toUpperCase() || "OFF";
      el.textContent = `Pump: ${upper}`;
      el.classList.toggle("status-online", upper === "ON");
      el.classList.toggle("status-offline", upper !== "ON");
    });
    document.querySelectorAll('[data-app-nav="water"]').forEach((el) => {
      el.textContent = `Water: ${waterValue} L`;
    });
  }

  async function pollStatus() {
    try {
      const res = await fetch(`/api/status?_=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      state.status = data;
      if (data.mode) {
        state.mode = data.mode;
        updateModeToggles();
      }
      updateNavBadges(data);
      STATUS_LISTENERS.forEach((listener) => {
        try {
          listener(data);
        } catch (err) {
          console.error("Status listener failed:", err);
        }
      });
    } catch (error) {
      console.warn("Status poll failed:", error);
    }
  }

  function startStatusLoop() {
    if (statusInterval) {
      clearInterval(statusInterval);
    }
    pollStatus();
    statusInterval = window.setInterval(pollStatus, 5000);
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    initThemeToggles();
    initModeToggles();
    syncModeFromBackend();
    startStatusLoop();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        pollStatus();
      }
    });
  }

  window.AppShell = {
    init,
    setMode,
    setTheme: setThemeMode,
    onTheme(listener) {
      if (typeof listener === "function") {
        THEME_LISTENERS.add(listener);
        listener(state.theme);
        return () => THEME_LISTENERS.delete(listener);
      }
      return () => {};
    },
    getState() {
      return { ...state };
    },
    refreshStatus: pollStatus,
    onStatus(listener) {
      if (typeof listener === "function") {
        STATUS_LISTENERS.add(listener);
        if (state.status) {
          listener(state.status);
        }
        return () => STATUS_LISTENERS.delete(listener);
      }
      return () => {};
    },
    rebindToggles() {
      initThemeToggles();
      initModeToggles();
    },
  };

  document.addEventListener("DOMContentLoaded", init);
})(window, document);

