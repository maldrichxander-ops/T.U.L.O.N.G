/*
 * TACTICAL UNIT LOCATOR OPERATION NETWORK GRID (T.U.L.O.N.G)
 * Coded by Aldrich Xander R. Morano
 *
 * MIT License
 * Copyright (c) 2026 Aldrich Xander R. Morano
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, provided the above copyright notice and
 * this permission notice appear in all copies.
 */

// ================= BLYNK =================

#define BLYNK_TEMPLATE_ID "TMPL6I3xgOk45"
#define BLYNK_TEMPLATE_NAME "TACTICAL UNIT LOCATOR OPERATION NETWORK GRID"
#define BLYNK_AUTH_TOKEN "HKEGX3vYVEzqoEv5plTw5tU-7ITdnmlJ"
#define DEVICE_NAME "A-001"

// ================= GSM (for GPS only) =================
#define TINY_GSM_MODEM_SIM7000
#define TINY_GSM_RX_BUFFER 1024

#include <TinyGsmClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <BlynkSimpleEsp32.h>
#include <HTTPClient.h>
#include <Wire.h>
#include "RTClib.h"

// ================= WIFI (for Blynk + Google Sheets) =================
char ssid[] = "meowmeow";
char wifiPass[] = "meowmeow";

// ================= GOOGLE =================
const char* googleScriptURL = "https://script.google.com/macros/s/AKfycbzg9IYQOW3P7QpvNC6Z0dYzvjtd_CIL2m-SvnmaxgPvJbKPKzXhWn9-xrzt3jJvwN6D/exec";

// ================= APN (Smart) — for GPS modem only =================
const char apn[]  = "smartbro";
const char user[] = "";
const char pass[] = "";

// ================= GSM PINS =================
#define UART_BAUD   9600
#define PIN_DTR     25
#define PIN_TX      27
#define PIN_RX      26
#define PWR_PIN     4
#define LED_PIN     12

// ================= I2C PINS FOR RTC =================
// SDA = 21, SCL = 22

#define SerialMon Serial
#define SerialAT  Serial1

TinyGsm modem(SerialAT);

// ================= RTC =================
RTC_DS3231 rtc;
bool rtcAvailable = false;

// ================= BUFFER =================
#define MAX_LOGS 30

struct LogEntry {
  String device;
  String event;
  String timestamp;
  int duration;
};

LogEntry logBuffer[MAX_LOGS];
int logIndex = 0;

// ================= BUTTONS =================
#define BUTTON_STANDBY     32
#define LIGHT_STANDBY      33

#define BUTTON_RESPONDING  18
#define LIGHT_RESPONDING   19

#define BUTTON_ARRIVED     13
#define LIGHT_ARRIVED      14

// ================= BLYNK =================
#define VPIN_STANDBY     V4
#define VPIN_RESPONDING  V5
#define VPIN_ARRIVED     V6

BlynkTimer timer;
WidgetTerminal terminal(V3);

// ================= STATES =================
bool lastStandbyBtn = HIGH;
bool lastRespondBtn = HIGH;
bool lastArrivedBtn = HIGH;

bool standbyState = false;
bool respondingState = false;
bool arrivedState = false;

bool systemArmed = false;
bool emergencyMode = false;
bool blinkState = false;

unsigned long lastBlink = 0;
const int BLINK_INTERVAL = 500;

// ================= GPS SEARCH LOG =================
unsigned long lastSearchLog = 0;
const unsigned long SEARCH_INTERVAL = 60000;
bool searchingMessageSent = false; // ← only print once

// ================= GPS CONNECTED FLAG =================
bool satelliteConnectedOnce = false; // ← tracks first fix

// ================= RTC TIMER =================
DateTime responseStartRTC;

// ================= TIME =================
String getTimestamp() {
  if (rtcAvailable) {
    DateTime now = rtc.now();
    char buf[25];
    sprintf(buf, "%04d-%02d-%02d %02d:%02d:%02d",
            now.year(), now.month(), now.day(),
            now.hour(), now.minute(), now.second());
    return String(buf);
  }
  return "NORTC-" + String(millis() / 1000);
}

// ================= SAVE LOG =================
void saveLog(String event, int duration) {
  if (logIndex < MAX_LOGS) {
    logBuffer[logIndex++] = {
      DEVICE_NAME,
      event,
      getTimestamp(),
      duration
    };
  }
  SerialMon.println("LOG SAVED");
}

// ================= SEND =================
void sendToGoogleSheets(LogEntry log) {
  if (WiFi.status() != WL_CONNECTED) {
    SerialMon.println("WiFi not connected — skipping Google Sheets");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;

  String encodedTimestamp = log.timestamp;
  encodedTimestamp.replace(" ", "%20");

  String url = String(googleScriptURL) +
    "?device=" + log.device +
    "&event=" + log.event +
    "&timestamp=" + encodedTimestamp +
    "&duration=" + String(log.duration);

  SerialMon.println("Sending: " + url);

  http.begin(client, url);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  int httpCode = http.GET();

  SerialMon.print("Google Sheets response: ");
  SerialMon.println(httpCode);

  if (httpCode == 200) {
    SerialMon.println("Google Sheets OK");
  } else {
    String response = http.getString();
    SerialMon.println("Failed: " + response);
  }

  http.end();
}

// ================= SYNC =================
void syncLogs() {
  if (WiFi.status() != WL_CONNECTED) return;

  for (int i = 0; i < logIndex; i++) {
    sendToGoogleSheets(logBuffer[i]);
    delay(200);
  }

  logIndex = 0;
}

// ================= GPS =================
void readGPS()
{
  float lat=0, lon=0, speed=0, alt=0, accuracy=0;
  int vsat=0, usat=0;
  int year=0, month=0, day=0, hour=0, min=0, sec=0;

  if (modem.getGPS(&lat, &lon, &speed, &alt, &vsat, &usat, &accuracy,
                   &year, &month, &day, &hour, &min, &sec)) {

    SerialMon.println(String(DEVICE_NAME) + ": Satellite connected");
    SerialMon.println("Lat: " + String(lat, 8));
    SerialMon.println("Lon: " + String(lon, 8));

    // ✅ Send to terminal ONCE when satellite first connects
    if (!satelliteConnectedOnce) {
      satelliteConnectedOnce = true;
      searchingMessageSent = false; // reset so searching shows again if signal lost later
      terminal.println(String(DEVICE_NAME) + ": Satellite connected");
      terminal.print("Lat: ");
      terminal.println(lat, 6);
      terminal.print("Lon: ");
      terminal.println(lon, 6);
      terminal.println("--------------------");
      terminal.flush();
    }

    if (Blynk.connected()) {
      Blynk.virtualWrite(V7, lon, lat);
      SerialMon.println("V7 sent to Blynk");
    } else {
      SerialMon.println("Blynk not connected — V7 not sent");
    }

  } else {

    if (!searchingMessageSent) {
      searchingMessageSent = true;
      SerialMon.println(String(DEVICE_NAME) + ": Searching for satellite...");
      terminal.println(String(DEVICE_NAME) + ": Searching for satellite...");
      terminal.println("--------------------");
      terminal.flush();
    }
  }
}

// ================= MODEM POWER =================
void modemPowerOn() {
  pinMode(PWR_PIN, OUTPUT);

  digitalWrite(PWR_PIN, HIGH);
  delay(300);

  digitalWrite(PWR_PIN, LOW);
  delay(1200);

  digitalWrite(PWR_PIN, HIGH);

  delay(5000);

  SerialMon.println("Modem power pulse sent");
}

// ================= WIFI RECONNECT =================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  SerialMon.print("Reconnecting to WiFi");
  WiFi.disconnect();
  WiFi.begin(ssid, wifiPass);

  uint32_t t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 10000) {
    delay(500);
    SerialMon.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    SerialMon.println("\nWiFi reconnected");
  } else {
    SerialMon.println("\nWiFi reconnect failed");
  }
}

// ================= BLYNK CONNECTED =================
BLYNK_CONNECTED() {
  Blynk.virtualWrite(VPIN_STANDBY, 0);
  Blynk.virtualWrite(VPIN_RESPONDING, 0);
  Blynk.virtualWrite(VPIN_ARRIVED, 0);
}

// ================= EMERGENCY =================
BLYNK_WRITE(V3)
{
  String cmd = param.asStr();

  cmd.trim();
  cmd.toUpperCase();

  String expected = String(DEVICE_NAME) + " EMERGENCY";
  expected.toUpperCase();

  if (cmd == expected)
  {
    emergencyMode = true;

    standbyState = false;
    respondingState = false;
    arrivedState = false;

    digitalWrite(LIGHT_STANDBY, LOW);
    digitalWrite(LIGHT_RESPONDING, LOW);
    digitalWrite(LIGHT_ARRIVED, LOW);

    terminal.println(String(DEVICE_NAME) + ": EMERGENCY");
    terminal.flush();

    SerialMon.println(String(DEVICE_NAME) + ": EMERGENCY");
  }
}

// ================= SETUP =================
void setup()
{
  SerialMon.begin(115200);

  pinMode(PIN_DTR, OUTPUT);
  digitalWrite(PIN_DTR, HIGH);

  pinMode(BUTTON_STANDBY, INPUT_PULLUP);
  pinMode(BUTTON_RESPONDING, INPUT_PULLUP);
  pinMode(BUTTON_ARRIVED, INPUT_PULLUP);

  pinMode(LIGHT_STANDBY, OUTPUT);
  pinMode(LIGHT_RESPONDING, OUTPUT);
  pinMode(LIGHT_ARRIVED, OUTPUT);

  digitalWrite(LIGHT_STANDBY, LOW);
  digitalWrite(LIGHT_RESPONDING, LOW);
  digitalWrite(LIGHT_ARRIVED, LOW);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  standbyState = false;
  respondingState = false;
  arrivedState = false;
  emergencyMode = false;
  systemArmed = false;
  satelliteConnectedOnce = false;
  searchingMessageSent = false;

  // ================= RTC INIT =================
  Wire.begin(21, 22); // SDA = 21, SCL = 22

  if (!rtc.begin()) {
    SerialMon.println("RTC NOT FOUND — continuing without RTC");
    rtcAvailable = false;
  } else {
    rtcAvailable = true;
    SerialMon.println("RTC OK");
    // ⚠️ UNCOMMENT TO SET TIME — FLASH ONCE THEN COMMENT AGAIN
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  // ================= WIFI INIT =================
  SerialMon.println("Connecting WiFi...");
  WiFi.begin(ssid, wifiPass);

  uint32_t wifiTimeout = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiTimeout < 15000) {
    delay(500);
    SerialMon.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    SerialMon.println("\nWiFi Connected");
  } else {
    SerialMon.println("\nWiFi failed — continuing anyway");
  }

  // ================= BLYNK VIA WIFI (non-blocking) =================
  Blynk.config(BLYNK_AUTH_TOKEN);
  Blynk.connect(3000);

  if (Blynk.connected()) {
    SerialMon.println(String(DEVICE_NAME) + " Connected to Blynk");
    terminal.println(String(DEVICE_NAME) + " Connected to Blynk");
    terminal.flush();
  } else {
    SerialMon.println("Blynk not connected yet — will retry in loop");
  }

  Blynk.virtualWrite(VPIN_STANDBY, 0);
  Blynk.virtualWrite(VPIN_RESPONDING, 0);
  Blynk.virtualWrite(VPIN_ARRIVED, 0);

  // ================= GSM INIT (GPS only) =================
  modemPowerOn();

  SerialAT.begin(UART_BAUD, SERIAL_8N1, PIN_RX, PIN_TX);

  SerialMon.println("Checking modem...");

  uint32_t timeout = millis();

  while (!modem.testAT()) {
    SerialMon.print(".");
    Blynk.run();
    if (millis() - timeout > 60000) {
      SerialMon.println("Restarting modem...");
      modemPowerOn();
      timeout = millis();
    }
  }

  SerialMon.println("\nModem online");

  timeout = millis();

  while (modem.getSimStatus() != SIM_READY) {
    SerialMon.print(".");
    Blynk.run();
    if (millis() - timeout > 60000) {
      SerialMon.println("SIM not detected");
      break;
    }
  }

  SerialMon.println("\nSIM ready");

  modem.sendAT("+CBAND=ALL_MODE");
  modem.waitResponse();

  modem.setPreferredMode(3);
  modem.setNetworkMode(2);

  SIM70xxRegStatus status;
  uint32_t gsmTimeout = millis();

  do {
    int16_t sq = modem.getSignalQuality();
    status = modem.getRegistrationStatus();

    SerialMon.print("Signal:");
    SerialMon.println(sq);

    Blynk.run();
    delay(800);

    if (millis() - gsmTimeout > 60000) {
      SerialMon.println("GSM registration timeout — continuing anyway");
      break;
    }

  } while (status != REG_OK_HOME && status != REG_OK_ROAMING);

  if (status == REG_OK_HOME || status == REG_OK_ROAMING) {
    SerialMon.println("GSM Network connected");
  }

  // ================= GPS INIT =================
  modem.sendAT("+SGPIO=0,4,1,1");
  delay(1000);

  modem.enableGPS();

  SerialMon.println(String(DEVICE_NAME) + ": GPS Started");
  terminal.println(String(DEVICE_NAME) + ": GPS Started");
  terminal.flush();

  timer.setInterval(100L,   checkButtons);
  timer.setInterval(5000L,  readGPS);
  timer.setInterval(10000L, syncLogs);

  SerialMon.println("Setup complete — entering loop");
}

// ================= BUTTON LOGIC =================
void checkButtons()
{
  bool standbyBtn = digitalRead(BUTTON_STANDBY);
  bool respondBtn = digitalRead(BUTTON_RESPONDING);
  bool arrivedBtn = digitalRead(BUTTON_ARRIVED);

  // ===== EMERGENCY MODE =====
  if (emergencyMode)
  {
    if (millis() - lastBlink > BLINK_INTERVAL)
    {
      lastBlink = millis();
      blinkState = !blinkState;
      digitalWrite(LIGHT_RESPONDING, blinkState);
    }

    if (lastRespondBtn == HIGH && respondBtn == LOW)
    {
      emergencyMode = false;

      respondingState = true;
      standbyState = false;
      arrivedState = false;
      systemArmed = true;

      digitalWrite(LIGHT_RESPONDING, HIGH);
      digitalWrite(LIGHT_STANDBY, LOW);
      digitalWrite(LIGHT_ARRIVED, LOW);

      Blynk.virtualWrite(VPIN_RESPONDING, 1);
      Blynk.virtualWrite(VPIN_STANDBY, 0);
      Blynk.virtualWrite(VPIN_ARRIVED, 0);

      // ✅ LOG START
      if (rtcAvailable) responseStartRTC = rtc.now();
      saveLog("RESPONDING", 0);
      Blynk.logEvent("responding");

      terminal.println(String(DEVICE_NAME) + ": RESPONDING");
      terminal.flush();

      SerialMon.println(String(DEVICE_NAME) + ": RESPONDING");
    }

    lastStandbyBtn = standbyBtn;
    lastRespondBtn = respondBtn;
    lastArrivedBtn = arrivedBtn;
    return;
  }

  // ===== START LOCK =====
  if (!systemArmed)
  {
    if (lastStandbyBtn == HIGH && standbyBtn == LOW)
    {
      systemArmed = true;
      standbyState = true;

      digitalWrite(LIGHT_STANDBY, HIGH);
      Blynk.virtualWrite(VPIN_STANDBY, 1);
      Blynk.logEvent("standby");

      SerialMon.println(String(DEVICE_NAME) + ": STANDBY");
      terminal.println(String(DEVICE_NAME) + ": STANDBY");
      terminal.flush();
    }

    lastStandbyBtn = standbyBtn;
    lastRespondBtn = respondBtn;
    lastArrivedBtn = arrivedBtn;
    return;
  }

  // ===== STANDBY =====
  if (lastStandbyBtn == HIGH && standbyBtn == LOW)
  {
    if (!standbyState && !respondingState)
    {
      standbyState = true;
      respondingState = false;
      arrivedState = false;

      digitalWrite(LIGHT_STANDBY, HIGH);
      digitalWrite(LIGHT_RESPONDING, LOW);
      digitalWrite(LIGHT_ARRIVED, LOW);

      Blynk.virtualWrite(VPIN_STANDBY, 1);
      Blynk.virtualWrite(VPIN_RESPONDING, 0);
      Blynk.virtualWrite(VPIN_ARRIVED, 0);
      Blynk.logEvent("standby");

      SerialMon.println(String(DEVICE_NAME) + ": STANDBY");
      terminal.println(String(DEVICE_NAME) + ": STANDBY");
      terminal.flush();
    }
  }

  // ===== RESPONDING =====
  if (lastRespondBtn == HIGH && respondBtn == LOW)
  {
    if (!respondingState)
    {
      respondingState = true;
      standbyState = false;
      arrivedState = false;

      digitalWrite(LIGHT_RESPONDING, HIGH);
      digitalWrite(LIGHT_STANDBY, LOW);
      digitalWrite(LIGHT_ARRIVED, LOW);

      Blynk.virtualWrite(VPIN_RESPONDING, 1);
      Blynk.virtualWrite(VPIN_STANDBY, 0);
      Blynk.virtualWrite(VPIN_ARRIVED, 0);

      // ✅ LOG START
      if (rtcAvailable) responseStartRTC = rtc.now();
      saveLog("RESPONDING", 0);
      Blynk.logEvent("responding");

      SerialMon.println(String(DEVICE_NAME) + ": RESPONDING");
      terminal.println(String(DEVICE_NAME) + ": RESPONDING");
      terminal.flush();
    }
  }

  // ===== ARRIVED (DISABLED WHEN STANDBY IS ACTIVE) =====
  if (!standbyState)
  {
    if (lastArrivedBtn == HIGH && arrivedBtn == LOW)
    {
      if (!arrivedState)
      {
        arrivedState = true;
        standbyState = false;
        respondingState = false;

        digitalWrite(LIGHT_ARRIVED, HIGH);
        digitalWrite(LIGHT_STANDBY, LOW);
        digitalWrite(LIGHT_RESPONDING, LOW);

        Blynk.virtualWrite(VPIN_ARRIVED, 1);
        Blynk.virtualWrite(VPIN_STANDBY, 0);
        Blynk.virtualWrite(VPIN_RESPONDING, 0);

        int duration = 0;

        if (rtcAvailable) {
          DateTime endTime = rtc.now();
          TimeSpan diff = endTime - responseStartRTC;
          duration = diff.totalseconds();
        }

        // ✅ LOG END
        saveLog("ARRIVED", duration);
        Blynk.logEvent("arrived");

        SerialMon.println(String(DEVICE_NAME) + ": ARRIVED AT SCENE");
        terminal.println(String(DEVICE_NAME) + ": ARRIVED AT SCENE");
        terminal.print("Duration: ");
        terminal.println(duration);
        terminal.flush();
      }
    }
  }
  else
  {
    // FORCE ARRIVED OFF WHEN STANDBY
    digitalWrite(LIGHT_ARRIVED, LOW);
    Blynk.virtualWrite(VPIN_ARRIVED, 0);
  }

  lastStandbyBtn = standbyBtn;
  lastRespondBtn = respondBtn;
  lastArrivedBtn = arrivedBtn;
}

// ================= LOOP =================
void loop()
{
  // Reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Reconnect Blynk if dropped
  if (WiFi.status() == WL_CONNECTED && !Blynk.connected()) {
    Blynk.connect(3000);
  }

  Blynk.run();
  timer.run();
}

