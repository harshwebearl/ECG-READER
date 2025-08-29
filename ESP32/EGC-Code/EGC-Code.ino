#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <WiFiManager.h>          // WiFiManager library for easy WiFi configuration
#include <EEPROM.h>               // For storing configuration
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// BLE UUIDs - Using standard Heart Rate Service
#define SERVICE_UUID           "0000180d-0000-1000-8000-00805f9b34fb" // Heart Rate Service
#define CHARACTERISTIC_UUID    "00002a37-0000-1000-8000-00805f9b34fb" // Heart Rate Measurement
#define DEVICE_INFO_UUID      "0000180a-0000-1000-8000-00805f9b34fb" // Device Information Service
#define MANUFACTURER_UUID     "00002a29-0000-1000-8000-00805f9b34fb" // Manufacturer Name
#define MODEL_UUID           "00002a24-0000-1000-8000-00805f9b34fb" // Model Number

// === WiFi Configuration ===
// WiFi credentials will be configured via WiFiManager captive portal
// No hardcoded credentials needed!

// === MQTT Configuration ===
const char* mqtt_server = "cd07331e117b4586bf2b979e80f68084.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "harsh";
const char* mqtt_pass = "Harsh@12";

// === Device Configuration ===
// HARDCODED Device ID - Change this for each device
String device_id = "P3";  // CHANGE THIS FOR EACH DEVICE: P1, P2, P3, etc.
const String device_name = "ECG Reader";
const String device_model = "ECG-Monitor-Pro";
const String firmware_version = "2.0.1";

// Forward declarations for buzzer functions
void buzzerBeep(int duration = 200);
void buzzerAlert(int beeps = 3);

// === WiFi Manager ===
WiFiManager wifiManager;

// Pin definitions
#define ECG_PIN 34
#define LO_PLUS 32
#define LO_MINUS 33
#define LED_PIN 2     // Built-in LED for status indication
#define STATUS_LED_PIN 13   // Additional LED for status indication
#define RESET_PIN 0   // Boot button for WiFi reset (GPIO 0)
#define POWER_BUTTON_PIN 25  // Power on/off button
#define BUZZER_PIN 26        // Buzzer control
#define BATTERY_PIN 35       // Battery voltage monitoring
#define MODE_SELECT_PIN 27   // Pin to select between WiFi and BLE mode

// Timing variables
unsigned long lastSendTime = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastReconnectAttempt = 0;
const int sendInterval = 10;  // 100Hz sampling rate
const int heartbeatInterval = 30000;  // 30 seconds
const int reconnectInterval = 5000;   // 5 seconds

// Connection tracking
bool wifiConnected = false;
bool mqttConnected = false;
bool bleConnected = false;
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
const int statusBlinkInterval = 500; // Blink every 500ms for pending status
bool statusLedState = false;

// BLE variables
BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool useBluetooth = false;  // Will be set based on MODE_SELECT_PIN

// Data quality tracking
int validReadings = 0;
int totalReadings = 0;
bool leadsOff = false;

// Power control
bool deviceRunning = false;
bool lastButtonState = HIGH;
unsigned long lastButtonPress = 0;
const unsigned long debounceDelay = 200; // 200ms debounce

// Battery monitoring
float batteryVoltage = 0;
unsigned long lastBatteryCheck = 0;
const unsigned long batteryCheckInterval = 30000; // Check every 30 seconds

WiFiClientSecure secureClient;
PubSubClient client(secureClient);

// Status update functions
void updateConnectionStatus(ConnectionStatus newStatus) {
  currentStatus = newStatus;
  switch (newStatus) {
    case STATUS_PENDING:
      digitalWrite(STATUS_LED_PIN, LOW);
      statusBlinkTimer = millis(); // Start blinking timer
      buzzerBeep(100); // Short beep
      break;
    case STATUS_SUCCESSFUL:
      digitalWrite(STATUS_LED_PIN, HIGH); // Solid ON
      buzzerBeep(200); // Success beep
      break;
    case STATUS_FAILED:
      digitalWrite(STATUS_LED_PIN, LOW); // OFF
      buzzerAlert(3); // Error pattern
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

  // Check for button press (falling edge with debounce)
  if (currentButtonState == LOW && lastButtonState == HIGH &&
      (millis() - lastButtonPress) > debounceDelay) {

    deviceRunning = !deviceRunning; // Toggle power state
    lastButtonPress = millis();

    if (deviceRunning) {
      Serial.println("=== DEVICE POWERED ON ===");
      digitalWrite(LED_PIN, HIGH); // LED on when running
      buzzerBeep(100); // Power on beep
    } else {
      Serial.println("=== DEVICE POWERED OFF ===");
      digitalWrite(LED_PIN, LOW);  // LED off when stopped
      buzzerBeep(200); // Power off beep
    }
  }

  lastButtonState = currentButtonState;
}

// Battery monitoring
void checkBattery() {
  if (millis() - lastBatteryCheck >= batteryCheckInterval) {
    lastBatteryCheck = millis();

    // Read battery voltage (assuming voltage divider: 3.7V max -> 1.85V to ADC)
    int adcValue = analogRead(BATTERY_PIN);
    batteryVoltage = (adcValue / 4095.0) * 3.3 * 2; // Voltage divider compensation

    Serial.println("Battery: " + String(batteryVoltage, 2) + "V");

    // Low battery warning (below 3.2V)
    if (batteryVoltage < 3.2 && batteryVoltage > 2.0) { // Avoid false readings
      Serial.println("WARNING: Low battery!");
      buzzerAlert(5); // 5 beeps for low battery
    }
  }
}

// Configure SSL client
void configureClientSSL() {
  secureClient.setInsecure();  // Skip SSL verification for testing
}

// Professional WiFi setup with WiFiManager
void setup_wifi() {
  Serial.println("=== WiFi Configuration ===");

  // Set custom parameters for the captive portal
  wifiManager.setAPCallback(configModeCallback);
  wifiManager.setSaveConfigCallback(saveConfigCallback);

  // Configure WiFiManager settings
  wifiManager.setConfigPortalTimeout(300); // 5 minutes timeout
  wifiManager.setConnectTimeout(20); // 20 seconds to connect to WiFi
  wifiManager.setDebugOutput(true); // Enable debug output

  // No custom parameters needed - device name is fixed, device ID is auto-generated

  // FOR TESTING: Force configuration mode (DISABLED - now it will save settings)
  // wifiManager.resetSettings(); // DISABLED - device will now save WiFi credentials

  // Try to connect to saved WiFi credentials
  Serial.println("Attempting to connect to saved WiFi...");

  // If connection fails, start configuration portal (open network - no password)
  if (!wifiManager.autoConnect("ECG-Reader-Setup")) {
    Serial.println("Failed to connect and hit timeout");
    // Reset and try again
    ESP.restart();
    delay(1000);
  }

  // If we get here, WiFi is connected
  wifiConnected = true;
  digitalWrite(LED_PIN, HIGH);  // LED on when connected

  Serial.println("\n=== WiFi Connected Successfully! ===");
  Serial.println("SSID: " + WiFi.SSID());
  Serial.println("IP address: " + WiFi.localIP().toString());
  Serial.println("Signal strength: " + String(WiFi.RSSI()) + " dBm");
  Serial.println("Device ID: " + device_id + " (hardcoded)");
  Serial.println("Device Name: " + device_name);
  Serial.println("=====================================");
}

// Callback when entering configuration mode
void configModeCallback(WiFiManager *myWiFiManager) {
  Serial.println("\n=== WiFi Configuration Mode ===");
  Serial.println("Connect to WiFi network: ECG-Reader-Setup");
  Serial.println("Password: NONE (Open Network)");
  Serial.println("Then open: http://192.168.4.1");
  Serial.println("Configure your WiFi credentials there");
  Serial.println("===============================");

  // Blink LED rapidly in config mode
  for (int i = 0; i < 10; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(100);
    digitalWrite(LED_PIN, LOW);
    delay(100);
  }
}

// Callback when configuration is saved
void saveConfigCallback() {
  Serial.println("Configuration saved successfully!");
  Serial.println("Device will restart and connect to your WiFi...");
}

// Check WiFi connection and reconnect if needed
void checkWiFiConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConnected) {
      Serial.println("WiFi connection lost. Attempting to reconnect...");
      wifiConnected = false;
      mqttConnected = false;
      digitalWrite(LED_PIN, LOW);  // Turn off LED when disconnected
    }

    if (millis() - lastReconnectAttempt > reconnectInterval) {
      lastReconnectAttempt = millis();

      // Try to reconnect using saved credentials
      Serial.println("Attempting WiFi reconnection...");
      WiFi.reconnect();

      // Wait a bit for reconnection
      int attempts = 0;
      while (WiFi.status() != WL_CONNECTED && attempts < 10) {
        delay(500);
        Serial.print(".");
        attempts++;
        digitalWrite(LED_PIN, !digitalRead(LED_PIN));  // Blink during reconnection
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

// Reset WiFi configuration (for factory reset)
void resetWiFiConfig() {
  Serial.println("Resetting WiFi configuration...");
  wifiManager.resetSettings();
  Serial.println("WiFi settings cleared. Restarting...");
  ESP.restart();
}

// MQTT Connection with improved error handling
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

    // Publish online status with device info
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

    // Discovery removed - using manual device ID entry

    // Publish device capabilities
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

// Send heartbeat to indicate device is alive
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

  // Discovery removed - using manual device ID entry
}

// BLE Server Callbacks
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      bleConnected = true;
      Serial.println("BLE Client Connected");
      updateConnectionStatus(STATUS_SUCCESSFUL);
    };

    void onDisconnect(BLEServer* pServer) {
      bleConnected = false;
      Serial.println("BLE Client Disconnected");
      updateConnectionStatus(STATUS_PENDING);
      // Restart advertising to allow new connections
      BLEDevice::startAdvertising();
    }
};

// Setup BLE Server
void setupBLE() {
  // Create the BLE Device
  BLEDevice::init(("ECG-" + device_id).c_str());

  // Create the BLE Server
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // Create the Heart Rate Service
  BLEService *pHRService = pServer->createService(SERVICE_UUID);

  // Create the Heart Rate Measurement Characteristic
  pCharacteristic = pHRService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  // Enable notifications
  BLE2902* p2902 = new BLE2902();
  p2902->setNotifications(true);
  pCharacteristic->addDescriptor(p2902);

  // Create Device Information Service
  BLEService *pDeviceInfoService = pServer->createService(DEVICE_INFO_UUID);

  // Add Manufacturer Name Characteristic
  BLECharacteristic *pManufacturerChar = pDeviceInfoService->createCharacteristic(
                      MANUFACTURER_UUID,
                      BLECharacteristic::PROPERTY_READ
                    );
  pManufacturerChar->setValue("WebEarl ECG");

  // Add Model Number Characteristic
  BLECharacteristic *pModelChar = pDeviceInfoService->createCharacteristic(
                      MODEL_UUID,
                      BLECharacteristic::PROPERTY_READ
                    );
  pModelChar->setValue(device_model.c_str());

  // Start both services
  pHRService->start();
  pDeviceInfoService->start();

  // Start advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setAppearance(0x0340); // Set appearance to Heart Rate Sensor
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
  pAdvertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();
  
  Serial.println("BLE Heart Rate Service ready. Waiting for connections...");
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== ECG Monitor Starting ===");
  Serial.println("Version: 2.1 - WiFi + BLE Configuration");

  // Initialize pins
  pinMode(LO_PLUS, INPUT_PULLUP);
  pinMode(LO_MINUS, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(RESET_PIN, INPUT_PULLUP);  // Reset button
  pinMode(POWER_BUTTON_PIN, INPUT_PULLUP); // Power button
  pinMode(BUZZER_PIN, OUTPUT);       // Buzzer
  pinMode(MODE_SELECT_PIN, INPUT_PULLUP);  // Mode selection pin
  digitalWrite(LED_PIN, LOW);
  digitalWrite(STATUS_LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  
  // Initialize status as pending
  currentStatus = STATUS_PENDING;

  // Check for WiFi reset request (hold boot button for 3 seconds)
  if (digitalRead(RESET_PIN) == LOW) {
    Serial.println("Reset button pressed. Checking for WiFi reset...");
    delay(3000);  // Wait 3 seconds
    if (digitalRead(RESET_PIN) == LOW) {
      Serial.println("WiFi reset requested!");
      resetWiFiConfig();
    }
  }

  // Initialize random seed
  randomSeed(analogRead(0));

  // Check mode selection pin
  useBluetooth = digitalRead(MODE_SELECT_PIN) == LOW;

  if (useBluetooth) {
    // Setup BLE mode
    Serial.println("Starting in BLE mode...");
    setupBLE();
  } else {
    // Setup WiFi mode
    Serial.println("Starting in WiFi mode...");
    setup_wifi();
    configureClientSSL();
    client.setServer(mqtt_server, mqtt_port);
  }

  // Initial connection attempt
  if (wifiConnected) {
    connectMQTT();
  }

  // Device starts in OFF state - wait for button press
  deviceRunning = false;
  Serial.println("=== Setup Complete ===");
  Serial.println("Device ID: " + device_id);
  Serial.println("WiFi SSID: " + WiFi.SSID());
  Serial.println("IP Address: " + WiFi.localIP().toString());
  Serial.println("Sampling Rate: " + String(1000/sendInterval) + " Hz");
  Serial.println("=== Press power button to start ECG monitoring ===");

  // Startup beep
  buzzerBeep(150);
}

void loop() {
  unsigned long currentMillis = millis();

  // Always check power button and battery regardless of device state
  checkPowerButton();
  checkBattery();

  // Update status LED blinking if needed
  handleStatusLED();

  // Only run ECG monitoring when device is powered on
  if (!deviceRunning) {
    delay(100); // Small delay when device is off
    return;     // Skip all ECG functionality
  }

  if (!useBluetooth) {
    // WiFi/MQTT Mode
    checkWiFiConnection();

    // Handle MQTT connection
    if (wifiConnected && !client.connected()) {
      if (currentMillis - lastReconnectAttempt > reconnectInterval) {
        lastReconnectAttempt = currentMillis;
        connectMQTT();
      }
    }
  } else {
    // BLE Mode - handle reconnections if needed
    if (!bleConnected && currentMillis - lastReconnectAttempt > reconnectInterval) {
      lastReconnectAttempt = currentMillis;
      BLEDevice::startAdvertising();
    }
  }

  // Process MQTT messages
  if (client.connected()) {
    client.loop();
  }

  // Send ECG data at specified interval
  if (currentMillis - lastSendTime >= sendInterval) {
    lastSendTime = currentMillis;
    totalReadings++;

    // Check for lead-off condition
    bool currentLeadsOff = (digitalRead(LO_PLUS) == HIGH || digitalRead(LO_MINUS) == HIGH);

    if (currentLeadsOff != leadsOff) {
      leadsOff = currentLeadsOff;
      String statusTopic = "iot/devices/" + String(device_id) + "/status";

      if (leadsOff) {
        client.publish(statusTopic.c_str(), "Leads Off - Check electrode connections!", true);
        Serial.println("WARNING: Leads disconnected!");
        buzzerAlert(2); // 2 beeps for lead disconnection
      } else {
        client.publish(statusTopic.c_str(), "Leads connected - Signal restored", true);
        Serial.println("INFO: Leads reconnected");
        buzzerBeep(50); // Short beep for reconnection
      }
    }

    if (!leadsOff) {
      // EXACTLY like your working Serial Plotter code
      int ecg_value = analogRead(ECG_PIN);  // Direct analogRead - no processing!

      validReadings++;

      // Prepare data for both WiFi and BLE modes
      StaticJsonDocument<200> doc;
      doc["device_id"] = device_id;
      doc["timestamp"] = currentMillis;
      doc["ecg_value"] = ecg_value;  // Raw ADC value - exactly like Serial.println(ecgValue)
      doc["sequence"] = totalReadings;
      doc["signal_quality"] = (validReadings * 100) / totalReadings;
      doc["leads_off"] = false;

      if (useBluetooth) {
        // Send via BLE if connected
        if (bleConnected) {
          // Format data according to standard Heart Rate Measurement format
          uint8_t heartRateData[2];
          // Flags byte: 
          // Bit 0 = 0 (UINT8 heart rate)
          // Bit 1-2 = 0 (Sensor contact feature not supported)
          // Bit 3 = 0 (Energy expended not present)
          // Bit 4 = 0 (RR intervals not present)
          heartRateData[0] = 0x00;
          
          // Convert ECG value to heart rate (improved mapping)
          // Note: This is still a simplified conversion, but more realistic range
          uint8_t heartRate = constrain(map(ecg_value, 1500, 3000, 60, 180), 60, 180);
          heartRateData[1] = heartRate;
          
          pCharacteristic->setValue(heartRateData, 2);
          pCharacteristic->notify();
          Serial.print("Sending Heart Rate: ");
          Serial.println(heartRate);
          digitalWrite(LED_PIN, LOW);
          delay(1);
          digitalWrite(LED_PIN, HIGH);
        }
      } else {
        // Send via MQTT
        String payload;
        serializeJson(doc, payload);
        String topic = "iot/devices/" + String(device_id);

        // Publish the data
        if (mqttConnected && client.publish(topic.c_str(), payload.c_str())) {
        // Blink LED to indicate successful transmission
        digitalWrite(LED_PIN, LOW);
        delay(1);
        digitalWrite(LED_PIN, HIGH);

        // Debug output for troubleshooting
        if (totalReadings % 100 == 0) {  // Print every 100 readings
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
  }

  // Send periodic heartbeat only in WiFi mode
  if (!useBluetooth && currentMillis - lastHeartbeat >= heartbeatInterval) {
    lastHeartbeat = currentMillis;
    sendHeartbeat();
  }

  // Match your working Serial Plotter code - 500Hz sampling rate
  delay(2);
}
