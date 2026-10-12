A real Arduino-ESP32 image for `test/labwired-esp32-ledc.test.mjs`: four LEDs
at four held duties on a classic ESP32 (GPIO19 full on, GPIO2 `analogWrite(64)`
= 25 %, GPIO5 `ledcWrite(0, 768)` of 10 bit = 75 %, GPIO18 `analogWrite(0)`).

* `ledc_bench.ino` — the sketch.
* `firmware.elf` — built from it, then `--strip-debug` (symbols kept: the
  engine's Arduino-ESP32 boot thunks are resolved from the symbol table).

Rebuild (PlatformIO Core 6.2.0, platform `espressif32@7.0.1` =
framework-arduinoespressif32 3.20017.241212, i.e. arduino-esp32 2.0.17,
toolchain xtensa-esp32 8.4.0+2021r2-patch5):

```ini
[env:esp32]
platform = espressif32@7.0.1
board = esp32dev
framework = arduino
```

```sh
cp ledc_bench.ino <project>/src/main.ino && pio run -e esp32
xtensa-esp32-elf-strip --strip-debug -o firmware.elf .pio/build/esp32/firmware.elf
```

```
9d2a95c92334edbf54ad6861dba0cb87ff9f9f847260568d96c9ede59a24a3ec  firmware.elf
781aefc29606bd45d6053f9d71ee4c4e08824cc70cffcfc18926accfe22a0713  ledc_bench.ino
```

(Unstripped: `605f26d271ca7609b684379dffc40f16d94680f9a810334d4ef16a5ba85e7664`.
An Arduino build embeds its build date and time, so a rebuild must reproduce
the measured duties, not the hash.)
