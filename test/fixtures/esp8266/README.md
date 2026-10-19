ESP8266 flash images for `test/esp8266js-adapter.test.mjs`, built from our
esp8266js fork's own blob-free firmware: no Espressif SDK code, no Arduino
core, no ROM. Each image boots without the mask ROM on the fork's simulator.

* `blink.bin` — `firmware/blink.c`: GPIO2 toggles every 500 ms, "blink",
  "on", "off" on the serial port.
* `button.bin` — `firmware/sketches/button.c` on the fork's Arduino-style
  layer: the LED on GPIO2 follows a pulled-up button on GPIO5, presses are
  counted by a falling-edge interrupt and announced, and setup shifts 0xA5
  out on GPIO4 (data) / GPIO14 (clock).

Source: CrispStrobe/esp8266js at commit
3f99f2be6cac95771036063fcf8082a1137f7171 (its firmware is unchanged on main since), built
by that repository's CI (run 38470350997, artifact `own-firmware`) with
xtensa-lx106-elf-gcc from the Arduino ESP8266 package 3.1.2, used as the
compiler only. MIT, as the rest of that repository.

```
e4b90dba7f352090190432a502021df65edd8d6c202387dabf57cacbc1d6cb50  blink.bin
b7175311a52950a8a61e6d6ab408dbff15f20611ab823eae8d4f6dbf03863f7c  button.bin
```
