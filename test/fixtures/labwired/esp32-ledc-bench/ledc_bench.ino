// bw-board ESP32 bench: four LEDs, four duties, held — LEDC duty must reach
// the circuit as pad edges.
//   GPIO2  analogWrite(64)          -> 25 %  (1 kHz, 8-bit, LS channel 7)
//   GPIO5  ledcWrite(0, 768 of 1023) -> 75 %  (5 kHz, 10-bit, HS channel 0)
//   GPIO18 analogWrite(0)           -> 0 %
//   GPIO19 digitalWrite(HIGH)       -> full on (the reference)
#include <Arduino.h>

void setup() {
  pinMode(19, OUTPUT);
  digitalWrite(19, HIGH);
  analogWrite(2, 64);
  ledcSetup(0, 5000, 10);
  ledcAttachPin(5, 0);
  ledcWrite(0, 768);
  analogWrite(18, 0);
}

void loop() {
}
