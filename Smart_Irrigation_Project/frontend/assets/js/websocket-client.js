(function (window) {
  "use strict";

  /**
   * Global APP_MODE state management
   */
  window.APP_MODE = window.APP_MODE || {
    mode: "SIMULATION", // 'SIMULATION' | 'HARDWARE'
    simulationRunning: false,
    listeners: new Set(),
    
    setMode(mode) {
      const normalized = mode === "HARDWARE" ? "HARDWARE" : "SIMULATION";
      if (this.mode !== normalized) {
        this.mode = normalized;
        // Sync with global state
        if (window.GlobalState) {
          window.GlobalState.updateState({ APP_MODE: normalized });
        }
        this.notifyListeners();
      }
    },
    
    setSimulationRunning(running) {
      if (this.simulationRunning !== running) {
        this.simulationRunning = running;
        // Sync with global state
        if (window.GlobalState) {
          window.GlobalState.updateState({ simulationRunning: running });
        }
        this.notifyListeners();
      }
    },
    
    shouldUpdateCharts() {
      // Check global state first (source of truth)
      if (window.GlobalState) {
        const state = window.GlobalState.getState();
        if (state.APP_MODE === "SIMULATION") {
          return state.simulationRunning === true;
        }
        return state.APP_MODE === "HARDWARE";
      }
      // Fallback to local state
      if (this.mode === "SIMULATION") {
        return this.simulationRunning;
      }
      return this.mode === "HARDWARE";
    },
    
    onChange(listener) {
      if (typeof listener === "function") {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
      return () => {};
    },
    
    notifyListeners() {
      this.listeners.forEach((listener) => {
        try {
          listener({ mode: this.mode, simulationRunning: this.simulationRunning });
        } catch (e) {
          console.error("APP_MODE listener error:", e);
        }
      });
    },
  };

  /**
   * Data ingestion pipeline - normalizes and validates all incoming data
   */
  const DataIngestion = {
    lastTimestampMs: null,
    droppedSamples: 0,
    
    /**
     * Normalize timestamp to epoch milliseconds
     */
    normalizeTimestamp(ts) {
      if (!ts) return Date.now();
      if (typeof ts === "number") {
        // If < 10^10, assume seconds; otherwise milliseconds
        return ts < 10_000_000_000 ? ts * 1000 : ts;
      }
      if (typeof ts === "string") {
        const parsed = Date.parse(ts);
        return isNaN(parsed) ? Date.now() : parsed;
      }
      return Date.now();
    },
    
    /**
     * Validate timestamp is strictly increasing
     */
    validateTimestamp(tsMs) {
      if (this.lastTimestampMs === null) {
        this.lastTimestampMs = tsMs;
        return true;
      }
      
      if (tsMs <= this.lastTimestampMs) {
        this.droppedSamples++;
        return false;
      }
      
      this.lastTimestampMs = tsMs;
      return true;
    },
    
    /**
     * Clamp delta seconds to prevent large jumps
     */
    clampDeltaSeconds(tsMs) {
      if (this.lastTimestampMs === null) return 0;
      const rawDelta = (tsMs - this.lastTimestampMs) / 1000;
      return Math.max(0, Math.min(rawDelta, 1.0));
    },
    
    /**
     * Normalize payload to canonical format
     */
    normalizePayload(raw) {
      const tsMs = this.normalizeTimestamp(raw.timestamp);
      
      // Validate timestamp
      if (!this.validateTimestamp(tsMs)) {
        return null; // Invalid - dropped
      }
      
      const deltaSeconds = this.clampDeltaSeconds(tsMs);
      
      // Build canonical payload
      const canonical = {
        ts: tsMs,
        temperature: typeof raw.temperature === "number" ? raw.temperature : null,
        humidity: typeof raw.humidity === "number" ? raw.humidity : null,
        soil_moisture: typeof raw.soil_moisture === "number" ? raw.soil_moisture : null,
        pump_state: raw.pump_state === true || raw.pump_state === "ON" || raw.pump_state === 1,
        flow_rate_lps: typeof raw.flow_rate_lps === "number" ? raw.flow_rate_lps : null,
        water_total_liters: typeof raw.water_total_liters === "number" ? raw.water_total_liters : null,
        notification: raw.notification || null,
        deltaSeconds,
      };
      
      return canonical;
    },
    
    /**
     * Process incoming data (WS message or HTTP response)
     */
    processIncoming(data) {
      // Handle arrays - use last element
      const raw = Array.isArray(data) ? data[data.length - 1] : data;
      if (!raw) return null;
      
      return this.normalizePayload(raw);
    },
    
    getStats() {
      return {
        droppedSamples: this.droppedSamples,
        lastTimestampMs: this.lastTimestampMs,
      };
    },
    
    reset() {
      this.lastTimestampMs = null;
      this.droppedSamples = 0;
    },
  };

  /**
   * WebSocket client helper with automatic reconnection
   */
  class WebSocketClient {
    constructor(url, options = {}) {
      this.url = url;
      this.options = {
        reconnectInterval: options.reconnectInterval || 3000,
        maxReconnectAttempts: options.maxReconnectAttempts || Infinity,
        onMessage: options.onMessage || null,
        onOpen: options.onOpen || null,
        onClose: options.onClose || null,
        onError: options.onError || null,
      };
      this.ws = null;
      this.reconnectTimer = null;
      this.reconnectAttempts = 0;
      this.isManualClose = false;
    }

    connect() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        return;
      }

      try {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          if (this.options.onOpen) {
            this.options.onOpen();
          }
        };

        this.ws.onmessage = (event) => {
          if (this.options.onMessage) {
            try {
              const rawData = JSON.parse(event.data);
              
              // Validate timestamp exists
              if (!rawData.timestamp) {
                console.warn("Missing timestamp in WebSocket payload:", rawData);
                rawData.timestamp = Date.now(); // Add current timestamp as fallback
              }
              
              // Use data ingestion pipeline
              const normalized = DataIngestion.processIncoming(rawData);
              if (normalized) {
                // Update global state with pump state and timestamp from WebSocket
                if (window.GlobalState && normalized.pump_state !== undefined) {
                  window.GlobalState.updateState({
                    pumpState: normalized.pump_state ? "ON" : "OFF",
                    lastTimestamp: normalized.ts
                  });
                }
                
                this.options.onMessage(normalized);
              }
            } catch (e) {
              console.error("WebSocket message parse error:", e);
            }
          }
        };

        this.ws.onerror = (error) => {
          if (this.options.onError) {
            this.options.onError(error);
          }
        };

        this.ws.onclose = () => {
          if (this.options.onClose) {
            this.options.onClose();
          }
          if (!this.isManualClose) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        console.error("WebSocket connection error:", error);
        this.scheduleReconnect();
      }
    }

    scheduleReconnect() {
      if (this.isManualClose) return;
      if (
        this.options.maxReconnectAttempts !== Infinity &&
        this.reconnectAttempts >= this.options.maxReconnectAttempts
      ) {
        return;
      }

      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, this.options.reconnectInterval);
    }

    send(data) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(typeof data === "string" ? data : JSON.stringify(data));
        return true;
      }
      return false;
    }

    close() {
      this.isManualClose = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    }

    isConnected() {
      return this.ws && this.ws.readyState === WebSocket.OPEN;
    }
  }

  // Expose APIs
  window.WebSocketClient = WebSocketClient;
  window.DataIngestion = DataIngestion;
})(window);
