#!/usr/bin/env node

// Simple mock server for status-report testing:
// - HTTP:  http://localhost:4000/mock-api/status
// - WS:    ws://localhost:4000
//
// Usage examples:
//   node tests/simulate-data.js --duration 30 --interval 1000 --pump-pattern "6:6"
//   node tests/simulate-data.js --duration=60 --spike-frequency=0.3 --pump-pattern=10:20

const http = require("http");
const url = require("url");
const fs = require("fs");
const path = require("path");

let WebSocketServer;
try {
  WebSocketServer = require("ws").Server;
} catch (e) {
  console.error(
    "[simulate-data] Missing dependency 'ws'. Install with: npm install ws"
  );
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = {
    duration: 30, // seconds
    interval: 1000, // milliseconds
    spikeFrequency: 0.15,
    pumpPattern: "6:6", // Format: "on:off" in seconds
  };
  args.forEach((arg) => {
    if (arg.startsWith("--duration=") || arg.startsWith("--duration")) {
      const val = arg.split("=")[1] || args[args.indexOf(arg) + 1];
      if (val) cfg.duration = Number(val) || cfg.duration;
    } else if (arg.startsWith("--interval=") || arg.startsWith("--interval")) {
      const val = arg.split("=")[1] || args[args.indexOf(arg) + 1];
      if (val) cfg.interval = Number(val) || cfg.interval;
    } else if (arg.startsWith("--spike-frequency=")) {
      cfg.spikeFrequency = Number(arg.split("=")[1]) || cfg.spikeFrequency;
    } else if (arg.startsWith("--pump-pattern=") || arg.startsWith("--pump-pattern")) {
      const val = arg.split("=")[1] || args[args.indexOf(arg) + 1];
      if (val) cfg.pumpPattern = val.replace(/["']/g, "") || cfg.pumpPattern;
    }
  });
  return cfg;
}

const cfg = parseArgs();

const DEFAULTS = {
  baseFlowLps: 0.35,
  spikeFactor: 2.0,
};

const state = {
  lastTimestamp: Date.now(),
  waterTotal: 0,
  soilMoisture: 42,
  temperature: 27.3,
  humidity: 56.1,
  pumpState: false,
  cycleSeconds: 0,
  pumpOnSeconds: 6,
  pumpOffSeconds: 6,
};

function configurePumpPattern(pattern) {
  // Support both "6:6" and "6on-6off" formats
  const colonMatch = pattern.match(/(\d+):(\d+)/);
  const dashMatch = pattern.match(/(\d+)on-(\d+)off/);
  
  if (colonMatch) {
    state.pumpOnSeconds = Number(colonMatch[1]) || state.pumpOnSeconds;
    state.pumpOffSeconds = Number(colonMatch[2]) || state.pumpOffSeconds;
  } else if (dashMatch) {
    state.pumpOnSeconds = Number(dashMatch[1]) || state.pumpOnSeconds;
    state.pumpOffSeconds = Number(dashMatch[2]) || state.pumpOffSeconds;
  }
}

configurePumpPattern(cfg.pumpPattern);

function jitter(value, amount) {
  return value + (Math.random() - 0.5) * amount * 2;
}

function stepPumpPattern(dt) {
  state.cycleSeconds += dt;
  const total = state.pumpOnSeconds + state.pumpOffSeconds;
  if (state.cycleSeconds >= total) {
    state.cycleSeconds -= total;
  }
  state.pumpState = state.cycleSeconds < state.pumpOnSeconds;
}

let sampleCount = 0;
let totalWater = 0;
let spikeCount = 0;
let lastSampleTime = Date.now();

function nextSample() {
  const now = Date.now();
  // Ensure strictly increasing timestamps
  if (now <= lastSampleTime) {
    lastSampleTime = lastSampleTime + 1;
  } else {
    lastSampleTime = now;
  }
  
  const dtSeconds = Math.max(0.1, Math.min((lastSampleTime - state.lastTimestamp) / 1000, 1.0));

  stepPumpPattern(dtSeconds);

  let flow = 0;
  let isSpike = false;
  if (state.pumpState) {
    flow = DEFAULTS.baseFlowLps;
    if (Math.random() < cfg.spikeFrequency) {
      flow *= DEFAULTS.spikeFactor;
      isSpike = true;
      spikeCount++;
    }
    flow = jitter(flow, flow * 0.1);
    flow = Math.max(0, flow);
  }

  // Only increment water total when pump is ON
  if (state.pumpState) {
    state.waterTotal += flow * dtSeconds;
  }
  totalWater = state.waterTotal;

  if (state.pumpState) {
    state.soilMoisture += 0.7 * dtSeconds;
  } else {
    state.soilMoisture -= 0.25 * dtSeconds;
  }
  state.soilMoisture = Math.max(5, Math.min(95, jitter(state.soilMoisture, 0.5)));

  state.temperature = Math.max(15, Math.min(40, jitter(state.temperature, 0.05)));
  state.humidity = Math.max(20, Math.min(95, jitter(state.humidity, 0.1)));

  state.lastTimestamp = lastSampleTime;
  sampleCount++;

  return {
    timestamp: lastSampleTime,
    temperature: state.temperature,
    humidity: state.humidity,
    soil_moisture: state.soilMoisture,
    flow_rate_lps: flow,
    water_total_liters: state.waterTotal,
    pump_state: state.pumpState,
  };
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === "/mock-api/status" || parsed.pathname === "/api/status-report") {
    const sample = nextSample();
    res.writeHead(200, { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(sample));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  const interval = setInterval(() => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(nextSample()));
    }
  }, cfg.interval);
  socket.on("close", () => clearInterval(interval));
});

const PORT = 4000;

// Setup logging
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const logFile = path.join(logsDir, `simulate-${Date.now()}.log`);
const logStream = fs.createWriteStream(logFile);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  logStream.write(line);
}

server.listen(PORT, () => {
  log(`Mock server listening on http://localhost:${PORT} for ${cfg.duration}s`);
  log(`Pump pattern: ${state.pumpOnSeconds}s ON / ${state.pumpOffSeconds}s OFF`);
  log(`Interval: ${cfg.interval}ms`);
  log(`Logging to: ${logFile}`);
});

setTimeout(() => {
  log(`Duration reached, shutting down.`);
  log(`Summary: ${sampleCount} samples, ${totalWater.toFixed(2)}L total, ${spikeCount} spikes`);
  logStream.end();
  wss.close();
  server.close(() => process.exit(0));
}, cfg.duration * 1000);
