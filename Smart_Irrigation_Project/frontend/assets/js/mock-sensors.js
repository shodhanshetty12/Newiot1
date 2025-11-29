(function (window) {
  "use strict";

  const DEFAULTS = {
    baseFlowLps: 0.35,
    spikeFactor: 2.0,
    spikeFrequency: 0.15, // probability per second when pump is ON
    pumpOnSeconds: 6,
    pumpOffSeconds: 6,
    moistureThreshold: 20, // Pump turns ON when moisture < threshold
  };

  const state = {
    config: { ...DEFAULTS },
    lastTimestamp: Date.now(),
    waterTotal: 0,
    soilMoisture: 45, // percentage-like
    temperature: 27,
    humidity: 55,
    pumpState: false,
    cycleSeconds: 0,
    running: false,
    intervalId: null,
    listeners: new Set(),
  };

  function jitter(value, amount) {
    return value + (Math.random() - 0.5) * amount * 2;
  }

  function stepPumpPattern(dt) {
    state.cycleSeconds += dt;
    const total = state.config.pumpOnSeconds + state.config.pumpOffSeconds;
    if (state.cycleSeconds >= total) {
      state.cycleSeconds -= total;
    }
    state.pumpState = state.cycleSeconds < state.config.pumpOnSeconds;
  }

  /**
   * Evaluate pump action based on soil moisture threshold
   */
  function evaluatePumpAction(soilMoisture, threshold, currentPumpState) {
    if (soilMoisture === null || soilMoisture === undefined) {
      return currentPumpState;
    }
    // If moisture below threshold -> pump ON
    return soilMoisture < threshold;
  }

  function nextSampleInternal(now) {
    const dtSeconds = Math.max(0.1, Math.min((now - state.lastTimestamp) / 1000, 1.0));

    const prevPumpState = state.pumpState;
    
    // Step pump pattern (for time-based cycling)
    stepPumpPattern(dtSeconds);
    
    // Override with threshold-based logic if enabled
    const thresholdBased = evaluatePumpAction(state.soilMoisture, state.config.moistureThreshold, state.pumpState);
    if (thresholdBased !== state.pumpState) {
      state.pumpState = thresholdBased;
    }

    // Flow behaviour
    let flow = 0;
    let hasSpike = false;
    if (state.pumpState) {
      flow = state.config.baseFlowLps;
      if (Math.random() < state.config.spikeFrequency) {
        flow *= state.config.spikeFactor;
        hasSpike = true;
      }
      flow = jitter(flow, flow * 0.1);
      flow = Math.max(0, flow);
    }

    // Integrate water total (only when pump is ON)
    if (state.pumpState) {
      state.waterTotal += flow * dtSeconds;
    }

    // Soil moisture: dries slowly when pump off, rises quickly when on
    if (state.pumpState) {
      state.soilMoisture += 0.8 * dtSeconds;
    } else {
      state.soilMoisture -= 0.2 * dtSeconds;
    }
    state.soilMoisture = Math.max(10, Math.min(90, jitter(state.soilMoisture, 0.5)));

    // Temperature & humidity gentle noise
    state.temperature = Math.max(
      15,
      Math.min(40, jitter(state.temperature, 0.05 * dtSeconds))
    );
    state.humidity = Math.max(
      20,
      Math.min(95, jitter(state.humidity, 0.1 * dtSeconds))
    );

    state.lastTimestamp = now;

    const sample = {
      timestamp: now,
      temperature: state.temperature,
      humidity: state.humidity,
      soil_moisture: state.soilMoisture,
      pump_state: state.pumpState,
      flow_rate_lps: flow,
      water_total_liters: state.waterTotal,
    };

    // Generate notifications for state changes
    if (prevPumpState !== state.pumpState) {
      sample.notification = {
        type: "info",
        message: `Pump turned ${state.pumpState ? "ON" : "OFF"}`,
        data: { pump_state: state.pumpState },
      };
    } else if (hasSpike && flow > 0.5) {
      sample.notification = {
        type: "critical",
        message: `High flow spike detected: ${flow.toFixed(2)} L/s`,
        data: { flow_rate_lps: flow },
      };
    } else if (state.soilMoisture < state.config.moistureThreshold) {
      sample.notification = {
        type: "warning",
        message: `Low soil moisture: ${state.soilMoisture.toFixed(0)}%`,
        data: { soil_moisture: state.soilMoisture },
      };
    }

    // Notify listeners
    state.listeners.forEach((listener) => {
      try {
        listener(sample);
      } catch (e) {
        console.error("MockSensors listener error:", e);
      }
    });

    return sample;
  }

  const MockSensors = {
    configure(options) {
      state.config = { ...state.config, ...(options || {}) };
    },
    
    setMode(mode) {
      const normalized = mode === "HARDWARE" ? "HARDWARE" : "SIMULATION";
      if (window.APP_MODE) {
        window.APP_MODE.setMode(normalized);
      }
    },
    
    isSimulation() {
      return window.APP_MODE ? window.APP_MODE.mode === "SIMULATION" : true;
    },
    
    start() {
      if (state.running) return;
      state.running = true;
      
      if (window.APP_MODE) {
        window.APP_MODE.setSimulationRunning(true);
      }
      
      // Update global state
      if (window.GlobalState) {
        window.GlobalState.updateState({ simulationRunning: true });
      }
      
      // Emit samples at 1 second intervals
      state.intervalId = setInterval(() => {
        if (state.running) {
          const sample = nextSampleInternal(Date.now());
          // Trigger listeners
          state.listeners.forEach((listener) => {
            try {
              listener(sample);
            } catch (e) {
              console.error("MockSensors listener error:", e);
            }
          });
        }
      }, 1000);
      
      // Emit first sample immediately
      const sample = nextSampleInternal(Date.now());
      state.listeners.forEach((listener) => {
        try {
          listener(sample);
        } catch (e) {
          console.error("MockSensors listener error:", e);
        }
      });
    },
    
    stop() {
      if (!state.running) return;
      state.running = false;
      
      if (window.APP_MODE) {
        window.APP_MODE.setSimulationRunning(false);
      }
      
      // Update global state
      if (window.GlobalState) {
        window.GlobalState.updateState({ simulationRunning: false });
      }
      
      if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
      }
    },
    
    isRunning() {
      return state.running;
    },
    
    nextSample() {
      if (!state.running) {
        // Return last sample if not running
        return {
          timestamp: state.lastTimestamp,
          temperature: state.temperature,
          humidity: state.humidity,
          soil_moisture: state.soilMoisture,
          pump_state: state.pumpState,
          flow_rate_lps: 0,
          water_total_liters: state.waterTotal,
        };
      }
      const now = Date.now();
      return nextSampleInternal(now);
    },
    
    getState() {
      return { ...state };
    },
    
    onSample(listener) {
      if (typeof listener === "function") {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      }
      return () => {};
    },
  };

  window.MockSensors = MockSensors;
  
  // Initialize APP_MODE if not already set
  if (!window.APP_MODE) {
    window.APP_MODE = {
      mode: "SIMULATION",
      simulationRunning: false,
      listeners: new Set(),
      setMode(mode) {
        this.mode = mode === "HARDWARE" ? "HARDWARE" : "SIMULATION";
      },
      setSimulationRunning(running) {
        this.simulationRunning = running;
      },
      shouldUpdateCharts() {
        if (this.mode === "SIMULATION") {
          return this.simulationRunning;
        }
        return this.mode === "HARDWARE";
      },
    };
  }
})(window);
