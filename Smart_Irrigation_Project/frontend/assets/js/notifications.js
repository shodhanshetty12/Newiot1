(function (window, document) {
  "use strict";

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

  const CONFIG = {
    pollIntervalMs: window.NOTIF_POLL_INTERVAL_MS || 2000,
    apiUrl: "/api/notifications",
    ackUrl: "/api/notifications/ack",
    maxStored: 500,
    spikeThresholdLps: window.SPIKE_THRESHOLD_LPS || 2.0,
    lowMoistureThreshold: window.LOW_MOISTURE_THRESHOLD || 20,
  };

  let notifications = [];
  let refreshTimer = null;
  let wsClient = null;
  let lastNotificationId = 0;
  let lastReadTimestamp = null;

  const STORAGE_KEY = "irrigation_notifications";
  const LAST_READ_KEY = "irrigation_notifications_last_read";

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        notifications = parsed.slice(-CONFIG.maxStored);
      }
      
      const lastRead = localStorage.getItem(LAST_READ_KEY);
      if (lastRead) {
        lastReadTimestamp = new Date(lastRead);
      }
    } catch (e) {
      console.warn("Failed to load notifications from storage:", e);
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
      if (lastReadTimestamp) {
        localStorage.setItem(LAST_READ_KEY, lastReadTimestamp.toISOString());
      }
    } catch (e) {
      console.warn("Failed to save notifications to storage:", e);
    }
  }

  function recordEvent(type, message, data = {}) {
    const notif = {
      id: ++lastNotificationId,
      timestamp: new Date().toISOString(),
      type: type || "info",
      message: message || "",
      data,
      seen: false,
    };

    notifications.unshift(notif);
    if (notifications.length > CONFIG.maxStored) {
      notifications.pop();
    }

    saveToStorage();
    updateBadge();
    renderNotifications();
    return notif;
  }

  function updateBadge() {
    const unseen = notifications.filter((n) => !n.seen).length;
    
    // Update global state (persists across pages)
    if (window.GlobalState) {
      window.GlobalState.updateState({ unreadNotifications: unseen });
    }
    
    // Update all badge elements
    const badgeEl = document.querySelector('[data-notif-badge]');
    if (badgeEl) {
      if (unseen > 0) {
        badgeEl.textContent = String(unseen);
        badgeEl.style.display = "inline-block";
      } else {
        badgeEl.textContent = "";
        badgeEl.style.display = "none";
      }
    }

    document.querySelectorAll('[data-notif-count]').forEach((el) => {
      el.textContent = unseen > 0 ? `(${unseen})` : "";
    });
  }

  function renderNotifications() {
    const listEl = document.getElementById("notificationsList");
    if (!listEl) return;

    listEl.innerHTML = "";

    notifications.forEach((notif) => {
      // Ensure timestamp is valid
      if (!notif.timestamp) {
        notif.timestamp = new Date().toISOString();
      }
      const div = document.createElement("div");
      div.className = `item ${notif.seen ? "seen" : "unseen"}`;
      div.dataset.notifId = notif.id;

      const typeClass =
        notif.type === "critical"
          ? "critical"
          : notif.type === "warning"
          ? "warning"
          : "info";

      // Normalize and format timestamp
      const dt = normalizeTimestamp(notif.timestamp);
      const formattedTime = dt.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:start;">
          <div style="flex:1;">
            <span class="type type-${typeClass}">${(notif.type || "info").toUpperCase()}</span>
            <span>${notif.message || ""}</span>
          </div>
          <button class="dismiss-btn" data-dismiss="${notif.id}" style="background:none; border:none; color:var(--muted); cursor:pointer; padding:4px 8px;">✕</button>
        </div>
        <div class="time">${formattedTime}</div>
      `;

      listEl.appendChild(div);
    });

    // Add "Read All" button if there are unseen notifications
    const unseen = notifications.filter((n) => !n.seen).length;
    if (unseen > 0) {
      const readAllBtn = document.createElement("button");
      readAllBtn.textContent = "Read All";
      readAllBtn.className = "btn btn-primary";
      readAllBtn.style.marginTop = "1rem";
      readAllBtn.addEventListener("click", () => {
        markAllRead();
      });
      listEl.appendChild(readAllBtn);
    }

    document.querySelectorAll('[data-dismiss]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = Number(e.target.dataset.dismiss);
        const notif = notifications.find((n) => n.id === id);
        if (notif) {
          notif.seen = true;
          saveToStorage();
          updateBadge();
          renderNotifications();
        }
      });
    });
    
    // Dispatch update event
    const notificationsContainer = document.getElementById("notificationsList");
    if (notificationsContainer) {
      notificationsContainer.dispatchEvent(new Event("notifications-updated"));
    }
  }

  async function markAllRead() {
    // Mark all locally first
    notifications.forEach((n) => {
      n.seen = true;
    });
    lastReadTimestamp = new Date();
    saveToStorage();
    updateBadge();
    renderNotifications();

    // Try to sync with backend
    try {
      const res = await fetch(CONFIG.ackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp: lastReadTimestamp.toISOString(),
        }),
      });
      if (!res.ok) {
        console.warn("Failed to acknowledge notifications on backend");
      }
    } catch (error) {
      console.warn("Backend ack not available, marked locally only:", error);
    }
  }

  function checkForAnomalies(data) {
    if (!data) return;

    if (typeof data.flow_rate_lps === "number" && data.flow_rate_lps > CONFIG.spikeThresholdLps) {
      recordEvent(
        "critical",
        `High flow spike detected: ${data.flow_rate_lps.toFixed(2)} L/s`,
        { flow_rate_lps: data.flow_rate_lps }
      );
    }

    if (
      typeof data.soil_moisture === "number" &&
      data.soil_moisture < CONFIG.lowMoistureThreshold
    ) {
      recordEvent(
        "warning",
        `Low soil moisture: ${data.soil_moisture.toFixed(0)}%`,
        { soil_moisture: data.soil_moisture }
      );
    }

    if (data.pump_state !== undefined) {
      const prevState = window._lastPumpState;
      if (prevState !== undefined && prevState !== data.pump_state) {
        recordEvent(
          "info",
          `Pump turned ${data.pump_state ? "ON" : "OFF"}`,
          { pump_state: data.pump_state }
        );
      }
      window._lastPumpState = data.pump_state;
    }

    // Handle notification from payload
    if (data.notification) {
      const notif = data.notification;
      recordEvent(notif.type || "info", notif.message || "", notif.data || {});
    }
  }

  async function fetchFromApi() {
    try {
      const res = await fetch(`${CONFIG.apiUrl}?_=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) return [];
      const items = await res.json();
      return Array.isArray(items) ? items : [items];
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
      return [];
    }
  }

  async function syncNotifications() {
    const apiItems = await fetchFromApi();

    apiItems.forEach((apiItem) => {
      // Validate timestamp in incoming data
      if (!apiItem.timestamp) {
        console.warn("Missing timestamp in notification payload:", apiItem);
        apiItem.timestamp = new Date().toISOString();
      }
      
      const existing = notifications.find((n) => n.id === apiItem.id);
      if (!existing) {
        notifications.unshift({
          id: apiItem.id || ++lastNotificationId,
          timestamp: apiItem.timestamp || new Date().toISOString(),
          type: apiItem.type || "info",
          message: apiItem.message || "",
          data: apiItem.data || {},
          seen: apiItem.seen || false,
        });
      }
    });

    if (notifications.length > CONFIG.maxStored) {
      notifications = notifications.slice(0, CONFIG.maxStored);
    }

    saveToStorage();
    updateBadge();
    renderNotifications();
    
    // Dispatch update event
    const notificationsContainer = document.getElementById("notificationsList");
    if (notificationsContainer) {
      notificationsContainer.dispatchEvent(new Event("notifications-updated"));
    }
  }

  function startAutoRefresh() {
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
    }
    syncNotifications();
    refreshTimer = window.setInterval(syncNotifications, CONFIG.pollIntervalMs);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        syncNotifications();
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

    wsClient = new WebSocketClient(url, {
      onMessage: (data) => {
        // Data is already normalized by DataIngestion
        checkForAnomalies(data);
      },
      onOpen: () => {
        console.log("Notifications WebSocket connected");
      },
      onError: (error) => {
        console.error("Notifications WebSocket error:", error);
      },
    });

    wsClient.connect();
  }

  function bootstrap() {
    // Load global state and restore unread count
    if (window.GlobalState) {
      window.GlobalState.loadState();
      const state = window.GlobalState.getState();
      // Restore unread count badge immediately if available
      if (typeof state.unreadNotifications === 'number') {
        const badgeEl = document.querySelector('[data-notif-badge]');
        if (badgeEl) {
          if (state.unreadNotifications > 0) {
            badgeEl.textContent = String(state.unreadNotifications);
            badgeEl.style.display = "inline-block";
          } else {
            badgeEl.textContent = "";
            badgeEl.style.display = "none";
          }
        }
        document.querySelectorAll('[data-notif-count]').forEach((el) => {
          el.textContent = state.unreadNotifications > 0 ? `(${state.unreadNotifications})` : "";
        });
      }
    }
    
    loadFromStorage();
    updateBadge();
    renderNotifications();
    
    // Listen to global state changes for badge updates
    if (window.GlobalState) {
      window.GlobalState.onChange((state) => {
        if (typeof state.unreadNotifications === 'number') {
          updateBadge();
        }
      });
    }

    if (window.AppShell) {
      window.AppShell.rebindToggles();
    }

    if (window.WS_URL) {
      startWebSocket();
    }
    startAutoRefresh();

    window.NotificationsManager = {
      recordEvent,
      checkForAnomalies,
      syncNotifications,
      markAllRead,
    };
    
    // Expose for testing
    window.__notifications = {
      markAllRead,
      getNotifications: () => notifications,
      getUnreadCount: () => notifications.filter((n) => !n.seen).length,
    };
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})(window, document);
