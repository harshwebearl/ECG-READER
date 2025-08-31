#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <WiFiManager.h>
#include <EEPROM.h>

// === MQTT Configuration ===
const char* mqtt_server = "cd07331e117b4586bf2b979e80f68084.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "harsh";
const char* mqtt_pass = "Harsh@12";

// === Device Configuration ===
String device_id = "P3";
const String device_name = "ECG Reader";
const String device_model = "ECG-Monitor-Pro";
const String firmware_version = "2.0.1";

// === Data Storage for Charting ===
#define MAX_SAMPLES 250 // Buffer for 2.5 seconds at 100Hz
struct ECGData {
  unsigned long timestamp;
  int ecg_value;
};
ECGData ecgBuffer[MAX_SAMPLES];
int sampleIndex = 0;

// Forward declarations for buzzer functions
void buzzerBeep(int duration = 200);
void buzzerAlert(int beeps = 3);

// === WiFi Manager ===
WiFiManager wifiManager;

// Pin definitions
#define ECG_PIN 34
#define LO_PLUS 32
#define LO_MINUS 33
#define LED_PIN 2
#define STATUS_LED_PIN 13
#define RESET_PIN 0
#define POWER_BUTTON_PIN 25
#define BUZZER_PIN 26
#define BATTERY_PIN 35

// Timing variables
unsigned long lastSendTime = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastReconnectAttempt = 0;
const int sendInterval = 10; // 100Hz sampling rate
const int heartbeatInterval = 300000;
const int reconnectInterval = 5000;

// Connection tracking
bool wifiConnected = false;
bool mqttConnected = false;
int reconnectAttempts = 0;
const int maxReconnectAttempts = 5;

// Connection status states
enum ConnectionStatus {
  STATUS_PENDING,
  STATUS_SUCCESSFUL,
  STATUS_FAILED
};
ConnectionStatus currentStatus = STATUS_PENDING;
unsigned long statusBlinkTimer = 0;
const int statusBlinkInterval = 500;
bool statusLedState = false;

// Data quality tracking
int validReadings = 0;
int totalReadings = 0;
bool leadsOff = false;

// Power control
bool deviceRunning = false;
bool lastButtonState = HIGH;
unsigned long lastButtonPress = 0;
const unsigned long debounceDelay = 200;

// Battery monitoring
float batteryVoltage = 0;
unsigned long lastBatteryCheck = 0;
const unsigned long batteryCheckInterval = 30000;

WiFiClientSecure secureClient;
PubSubClient client(secureClient);

// Status update functions
void updateConnectionStatus(ConnectionStatus newStatus) {
  currentStatus = newStatus;
  switch (newStatus) {
    case STATUS_PENDING:
      digitalWrite(STATUS_LED_PIN, LOW);
      statusBlinkTimer = millis();
      buzzerBeep(100);
      break;
    case STATUS_SUCCESSFUL:
      digitalWrite(STATUS_LED_PIN, HIGH);
      buzzerBeep(200);
      break;
    case STATUS_FAILED:
      digitalWrite(STATUS_LED_PIN, LOW);
      buzzerAlert(3);
      break;
  }
}

void handleStatusLED() {
  if (currentStatus == STATUS_PENDING) {
    if (millis() - statusBlinkTimer >= statusBlinkInterval) {
      statusBlinkTimer = millis();
      statusLedState = !statusLedState;
      digitalWrite(STATUS_LED_PIN, statusLedState);
    }
  }
}

// Buzzer control functions
void buzzerBeep(int duration) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(duration);
  digitalWrite(BUZZER_PIN, LOW);
}

void buzzerAlert(int beeps) {
  for(int i = 0; i < beeps; i++) {
    buzzerBeep(100);
    delay(100);
  }
}

// Power button control
void checkPowerButton() {
  bool currentButtonState = digitalRead(POWER_BUTTON_PIN);
  if (currentButtonState == LOW && lastButtonState == HIGH &&
      (millis() - lastButtonPress) > debounceDelay) {
    deviceRunning = !deviceRunning;
    lastButtonPress = millis();
    if (deviceRunning) {
      Serial.println("=== DEVICE POWERED ON ===");
      digitalWrite(LED_PIN, HIGH);
      buzzerBeep(100);
    } else {
      Serial.println("=== DEVICE POWERED OFF ===");
      digitalWrite(LED_PIN, LOW);
      buzzerBeep(200);
    }
  }
  lastButtonState = currentButtonState;
}

// Battery monitoring
void checkBattery() {
  if (millis() - lastBatteryCheck >= batteryCheckInterval) {
    lastBatteryCheck = millis();
    int adcValue = analogRead(BATTERY_PIN);
    batteryVoltage = (adcValue / 4095.0) * 3.3 * 2;
    Serial.println("Battery: " + String(batteryVoltage, 2) + "V");
    if (batteryVoltage < 3.2 && batteryVoltage > 2.0) {
      Serial.println("WARNING: Low battery!");
      buzzerAlert(5);
    }
  }
}

// Configure SSL client
void configureClientSSL() {
  secureClient.setInsecure();
}

// WiFi setup
void setup_wifi() {
  Serial.println("=== WiFi Configuration ===");
  wifiManager.setAPCallback(configModeCallback);
  wifiManager.setSaveConfigCallback(saveConfigCallback);
  wifiManager.setConfigPortalTimeout(300);
  wifiManager.setConnectTimeout(20);
  wifiManager.setDebugOutput(true);
  if (!wifiManager.autoConnect("ECG-Reader-Setup")) {
    Serial.println("Failed to connect and hit timeout");
    ESP.restart();
    delay(1000);
  }
  wifiConnected = true;
  digitalWrite(LED_PIN, HIGH);
  Serial.println("\n=== WiFi Connected Successfully! ===");
  Serial.println("SSID: " + WiFi.SSID());
  Serial.println("IP address: " + WiFi.localIP().toString());
  Serial.println("Signal strength: " + String(WiFi.RSSI()) + " dBm");
  Serial.println("Device ID: " + device_id + " (hardcoded)");
  Serial.println("Device Name: " + device_name);
  Serial.println("=====================================");
}

void configModeCallback(WiFiManager *myWiFiManager) {
  Serial.println("\n=== WiFi Configuration Mode ===");
  Serial.println("Connect to WiFi network: ECG-Reader-Setup");
  Serial.println("Password: NONE (Open Network)");
  Serial.println("Then open: http://192.168.4.1");
  Serial.println("Configure your WiFi credentials there");
  Serial.println("===============================");
  for (int i = 0; i < 10; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(100);
    digitalWrite(LED_PIN, LOW);
    delay(100);
  }
}

void saveConfigCallback() {
  Serial.println("Configuration saved successfully!");
  Serial.println("Device will restart and connect to your WiFi...");
}

// Check WiFi connection
void checkWiFiConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConnected) {
      Serial.println("WiFi connection lost. Attempting to reconnect...");
      wifiConnected = false;
      mqttConnected = false;
      digitalWrite(LED_PIN, LOW);
    }
    if (millis() - lastReconnectAttempt > reconnectInterval) {
      lastReconnectAttempt = millis();
      Serial.println("Attempting WiFi reconnection...");
      WiFi.reconnect();
      int attempts = 0;
      while (WiFi.status() != WL_CONNECTED && attempts < 10) {
        delay(500);
        Serial.print(".");
        attempts++;
        digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      }
      if (WiFi.status() == WL_CONNECTED) {
        wifiConnected = true;
        updateConnectionStatus(STATUS_SUCCESSFUL);
        Serial.println("\nWiFi reconnected successfully!");
      } else {
        updateConnectionStatus(STATUS_FAILED);
      }
    }
  }
}

// Reset WiFi configuration
void resetWiFiConfig() {
  Serial.println("Resetting WiFi configuration...");
  wifiManager.resetSettings();
  Serial.println("WiFi settings cleared. Restarting...");
  ESP.restart();
}

// MQTT Connection
void connectMQTT() {
  if (!wifiConnected) return;
  if (reconnectAttempts >= maxReconnectAttempts) {
    Serial.println("Max MQTT reconnect attempts reached. Restarting WiFi...");
    reconnectAttempts = 0;
    wifiConnected = false;
    updateConnectionStatus(STATUS_FAILED);
    WiFi.disconnect();
    delay(1000);
    setup_wifi();
    return;
  }
  Serial.print("Connecting to MQTT broker... Attempt ");
  Serial.println(reconnectAttempts + 1);
  String will_topic = "iot/devices/" + String(device_id) + "/status";
  String client_id = String(device_id) + "_" + String(random(0xffff), HEX);
  if (client.connect(client_id.c_str(), mqtt_user, mqtt_pass,
                     will_topic.c_str(), 0, true, "offline")) {
    Serial.println("MQTT connected successfully!");
    mqttConnected = true;
    reconnectAttempts = 0;
    StaticJsonDocument<300> statusDoc;
    statusDoc["status"] = "online";
    statusDoc["device_id"] = device_id;
    statusDoc["device_name"] = device_name;
    statusDoc["device_model"] = device_model;
    statusDoc["firmware_version"] = firmware_version;
    statusDoc["ip"] = WiFi.localIP().toString();
    statusDoc["rssi"] = WiFi.RSSI();
    statusDoc["timestamp"] = millis();
    statusDoc["mac_address"] = WiFi.macAddress();
    String statusPayload;
    serializeJson(statusDoc, statusPayload);
    client.publish(will_topic.c_str(), statusPayload.c_str(), true);
    String capTopic = "iot/devices/" + String(device_id) + "/capabilities";
    StaticJsonDocument<300> capDoc;
    capDoc["sampling_rate"] = 1000 / sendInterval;
    capDoc["adc_resolution"] = 12;
    capDoc["max_value"] = 4095;
    capDoc["lead_detection"] = true;
    String capPayload;
    serializeJson(capDoc, capPayload);
    client.publish(capTopic.c_str(), capPayload.c_str(), true);
  } else {
    Serial.print("MQTT connection failed, rc=");
    Serial.println(client.state());
    reconnectAttempts++;
    mqttConnected = false;
  }
}

// Send heartbeat
void sendHeartbeat() {
  if (!mqttConnected) return;
  String heartbeatTopic = "iot/devices/" + String(device_id) + "/heartbeat";
  StaticJsonDocument<200> heartbeatDoc;
  heartbeatDoc["timestamp"] = millis();
  heartbeatDoc["uptime"] = millis() / 1000;
  heartbeatDoc["free_heap"] = ESP.getFreeHeap();
  heartbeatDoc["wifi_rssi"] = WiFi.RSSI();
  heartbeatDoc["device_name"] = device_name;
  String heartbeatPayload;
  serializeJson(heartbeatDoc, heartbeatPayload);
  client.publish(heartbeatTopic.c_str(), heartbeatPayload.c_str());
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== ECG Monitor Starting ===");
  Serial.println("Version: 2.1 - WiFi Configuration with Chart Data");
  pinMode(LO_PLUS, INPUT_PULLUP);
  pinMode(LO_MINUS, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(RESET_PIN, INPUT_PULLUP);
  pinMode(POWER_BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(STATUS_LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  currentStatus = STATUS_PENDING;
  if (digitalRead(RESET_PIN) == LOW) {
    Serial.println("Reset button pressed. Checking for WiFi reset...");
    delay(3000);
    if (digitalRead(RESET_PIN) == LOW) {
      resetWiFiConfig();
    }
  }
  randomSeed(analogRead(0));
  setup_wifi();
  configureClientSSL();
  client.setServer(mqtt_server, mqtt_port);
  connectMQTT();
  deviceRunning = false;
  Serial.println("=== Setup Complete ===");
  Serial.println("Device ID: " + device_id);
  Serial.println("WiFi SSID: " + WiFi.SSID());
  Serial.println("IP Address: " + WiFi.localIP().toString());
  Serial.println("Sampling Rate: " + String(1000/sendInterval) + " Hz");
  Serial.println("=== Press power button to start ECG monitoring ===");
  buzzerBeep(150);
}

void loop() {
  unsigned long currentMillis = millis();
  checkPowerButton();
  checkBattery();
  handleStatusLED();
  if (!deviceRunning) {
    delay(100);
    return;
  }
  checkWiFiConnection();
  if (wifiConnected && !client.connected()) {
    if (currentMillis - lastReconnectAttempt > reconnectInterval) {
      lastReconnectAttempt = currentMillis;
      connectMQTT();
    }
  }
  if (client.connected()) {
    client.loop();
  }
  if (currentMillis - lastSendTime >= sendInterval) {
    lastSendTime = currentMillis;
    totalReadings++;
    bool currentLeadsOff = (digitalRead(LO_PLUS) == HIGH || digitalRead(LO_MINUS) == HIGH);
    if (currentLeadsOff != leadsOff) {
      leadsOff = currentLeadsOff;
      String statusTopic = "iot/devices/" + String(device_id) + "/status";
      if (leadsOff) {
        client.publish(statusTopic.c_str(), "Leads Off - Check electrode connections!", true);
        Serial.println("WARNING: Leads disconnected!");
        buzzerAlert(2);
      } else {
        client.publish(statusTopic.c_str(), "Leads connected - Signal restored", true);
        Serial.println("INFO: Leads reconnected");
        buzzerBeep(50);
      }
    }
    if (!leadsOff) {
      int ecg_value = analogRead(ECG_PIN);
      validReadings++;
      // Store data for potential charting
      if (sampleIndex < MAX_SAMPLES) {
        ecgBuffer[sampleIndex].timestamp = currentMillis;
        ecgBuffer[sampleIndex].ecg_value = ecg_value;
        sampleIndex++;
      }
      StaticJsonDocument<200> doc;
      doc["device_id"] = device_id;
      doc["timestamp"] = currentMillis;
      doc["ecg_value"] = ecg_value;
      doc["sequence"] = totalReadings;
      doc["signal_quality"] = (validReadings * 100) / totalReadings;
      doc["leads_off"] = false;
      String payload;
      serializeJson(doc, payload);
      String topic = "iot/devices/" + String(device_id);
      if (mqttConnected && client.publish(topic.c_str(), payload.c_str())) {
        digitalWrite(LED_PIN, LOW);
        delay(1);
        digitalWrite(LED_PIN, HIGH);
        if (totalReadings % 100 == 0) {
          Serial.println("=== DEBUG INFO ===");
          Serial.println("Readings sent: " + String(totalReadings) +
                        ", Quality: " + String((validReadings * 100) / totalReadings) + "%");
          Serial.println("📡 Publishing to topic: " + String(topic));
          Serial.println("🆔 Device ID: " + String(device_id));
          Serial.println("📦 Sample payload: " + payload);
          Serial.println("🌐 MQTT connected: " + String(mqttConnected));
          Serial.println("📶 WiFi RSSI: " + String(WiFi.RSSI()) + " dBm");
          Serial.println("==================");
        }
      } else {
        Serial.println("Publish failed! MQTT connected: " + String(mqttConnected));
      }
    }
  }
  if (currentMillis - lastHeartbeat >= heartbeatInterval) {
    lastHeartbeat = currentMillis;
    sendHeartbeat();
  }
  delay(2);
}