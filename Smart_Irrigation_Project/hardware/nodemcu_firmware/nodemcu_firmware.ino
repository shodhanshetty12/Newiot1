/**
 * Smart Irrigation – ESP8266 NodeMCU Firmware
 *
 * Hardware mode expectations:
 *  - Soil moisture capacitor sensor on A0 (0-1023)
 *  - Relay input on D1 (see RELAY_ACTIVE_LEVEL)
 *  - Optional DHT11/DHT22 on D4
 *  - Pump/valve powered via relay as described in README
 *
 * The sketch samples the sensors, sends them to the Flask backend
 * (/api/hardware/sync) and executes the returned pump command without
 * blocking the loop.
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ------------------------- User Configuration -------------------------
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char *BACKEND_HOST = "192.168.1.50"; // Backend/Laptop IP on the same network
const uint16_t BACKEND_PORT = 5000;
const char *SYNC_ENDPOINT = "/api/hardware/sync";

// Sensor pins
constexpr uint8_t SOIL_PIN = A0;
constexpr uint8_t RELAY_PIN = D1;
constexpr uint8_t DHT_PIN = D4;

// Relay configuration (LOW for most 3.3V relay boards)
constexpr uint8_t RELAY_ACTIVE_LEVEL = LOW;
constexpr uint8_t RELAY_INACTIVE_LEVEL = HIGH;

// DHT configuration (set to false if you do not have the sensor connected)
constexpr bool USE_DHT = true;
#define DHT_TYPE DHT22  // Change to DHT11 if needed
DHT dht(DHT_PIN, DHT_TYPE);

// Sampling cadence (will be updated by backend suggestions)
unsigned long pollIntervalMs = 5000;
unsigned long nextSampleAt = 0;

// Wi-Fi reconnect cadence
unsigned long lastWifiAttempt = 0;
constexpr unsigned long WIFI_RETRY_MS = 10000;

// Internal state
WiFiClient wifiClient;
String lastCommand = "OFF";
float smoothedSoil = -1.0f;

// ------------------------- Utility Functions -------------------------
void connectWiFiBlocking() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" connected.");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }
  const unsigned long now = millis();
  if (now - lastWifiAttempt < WIFI_RETRY_MS) {
    return;
  }
  lastWifiAttempt = now;
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("Reconnecting to Wi-Fi...");
}

float smoothSoilReading(float rawValue) {
  const float alpha = 0.3f;
  if (smoothedSoil < 0) {
    smoothedSoil = rawValue;
  } else {
    smoothedSoil = (alpha * rawValue) + ((1.0f - alpha) * smoothedSoil);
  }
  return smoothedSoil;
}

void driveRelay(const String &command) {
  if (command == lastCommand) {
    return;
  }
  const bool turnOn = (command == "ON");
  digitalWrite(RELAY_PIN, turnOn ? RELAY_ACTIVE_LEVEL : RELAY_INACTIVE_LEVEL);
  lastCommand = command;
  Serial.printf("Relay -> %s\n", command.c_str());
}

String buildPayload(float soil, float temperature, float humidity, bool hasDht) {
  StaticJsonDocument<256> doc;
  doc["soil_moisture"] = soil;
  if (hasDht) {
    doc["temperature"] = temperature;
    doc["humidity"] = humidity;
  }
  doc["source"] = "nodemcu";

  String body;
  serializeJson(doc, body);
  return body;
}

void processResponse(const String &payload) {
  StaticJsonDocument<256> doc;
  auto err = deserializeJson(doc, payload);
  if (err) {
    Serial.printf("Failed to parse response: %s\n", err.c_str());
    return;
  }

  const char *next = doc["next_action"] | "OFF";
  driveRelay(String(next));

  if (doc.containsKey("poll_interval_ms")) {
    unsigned long suggested = doc["poll_interval_ms"];
    if (suggested >= 2000 && suggested <= 60000) {
      pollIntervalMs = suggested;
    }
  }
}

void sendSample() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skipped sample (Wi-Fi offline).");
    return;
  }

  const float rawSoil = analogRead(SOIL_PIN);
  const float soil = smoothSoilReading(rawSoil);

  bool hasDht = false;
  float temperature = NAN;
  float humidity = NAN;
  if (USE_DHT) {
    temperature = dht.readTemperature();
    humidity = dht.readHumidity();
    hasDht = !(isnan(temperature) || isnan(humidity));
  }

  const String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + SYNC_ENDPOINT;
  HTTPClient http;

  if (!http.begin(wifiClient, url)) {
    Serial.println("HTTP begin() failed");
    return;
  }
  http.addHeader("Content-Type", "application/json");

  const String body = buildPayload(soil, temperature, humidity, hasDht);
  const int code = http.POST(body);

  if (code > 0) {
    const String resp = http.getString();
    Serial.printf("HTTP %d\n", code);
    processResponse(resp);
  } else {
    Serial.printf("HTTP error: %d\n", code);
  }
  http.end();
}

// ------------------------- Arduino Entry Points -------------------------
void setup() {
  Serial.begin(115200);
  pinMode(SOIL_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_INACTIVE_LEVEL);

  if (USE_DHT) {
    dht.begin();
  }

  connectWiFiBlocking();
  nextSampleAt = millis() + 1000;  // first sample after 1s
}

void loop() {
  ensureWiFi();

  const unsigned long now = millis();
  if (now >= nextSampleAt) {
    nextSampleAt = now + pollIntervalMs;
    sendSample();
  }
}
