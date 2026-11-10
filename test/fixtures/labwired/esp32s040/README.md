# S040 public-factory evidence

`manifest.json` records exact bytes used by the real public-factory proof.
It identifies the immutable, independently reproduced
`labwired-wasm-fa992f35` release and exact Core source
`fa992f357df88dbd50057a31f13dbcc0835a95cd`. Original local v1/v2 source patches,
artifact identities and replay evidence remain separately recorded in history.
No compiler-toolchain or physical-board capture is inferred. The exact
source-owned guest is produced by the supplier's retained `build_probe.py`, an independent Python Xtensa
encoder under MIT. It uses SRAM1 code, descriptors and three reusable RGB565
row buffers. No Arduino, ESP-IDF, ROM, Wi-Fi or Bluetooth execution is inferred.

The guest initializes ST7701 by GPIO, transfers a complete 480×480 frame using
LCD/GDMA, polls GT911 through I2C, and changes a real pixel in response to touch.
The test observes guest memory and display artifacts through the public target.
The separate tiny H1 guest selects actual GPIO mux functions; debugger MMIO
controls then verify the five physical header pads and Board electrical solve.
It does not replace the display/touch guest or inject a firmware framebuffer.

Fetch the admitted release and source fixture with:

```sh
node scripts/fetch-esp32s040-fixtures.mjs --out /path/to/esp32s040-inputs
```

The input directory contains exactly the required files below. The engine glue
requires a sibling `package.json` containing `{"type":"commonjs"}`:

- `engine/labwired_wasm.js`
- `engine/labwired_wasm_bg.wasm`
- `firmware/probe.elf`
- `firmware/esp32s3-arduino-flash.bin`
- `roms/esp32s3_rom.bin`
- `roms/esp32s3_drom.bin`

The merged-flash case reuses the original M1 Arduino artifact and ROM
identities, including the explicit missing exact-sketch/toolchain provenance.
It requires the real `SMOKE_OK` bytes on UART0 before and after resetting from
private copied inputs under the S040 assembly. That firmware never initializes
the RGB panel, so the target must keep its display pending. This is a test of
the two public loading options composing correctly, not S040 SDK or compiler
compatibility.

Set `LABWIRED_ESP32S040_INPUTS` to that directory. Every file is checked by
length and SHA-256 before executable import. The catalog must contain the exact
system and chip text recorded in the manifest. Before supplier landing, local
review used a separately retained, test-only catalog import hook; it changed
neither the production catalog nor the engine pin and is not a runtime YAML
override. An input directory or a successful functional proof does not grant
release qualification.

The producer's original v1 full-session snapshot replay failure remains in the
manifest history and the retained producer receipt. Passing panel/touch/H1/reset
checks do not erase that separate failure.

Remote fetching requires the qualified release declaration and exact matching
source/catalog identities. A provisional manifest still refuses before network
or output writes.
The dedicated workflow also requires `LABWIRED_REQUIRE_ESP32S040=1`; that switch
rejects provisional release identities and missing inputs, and the TAP reader
requires all cases and zero skips. There is no candidate bypass for hosted
qualification. The source, generated catalog and fixture engine identities now
advance together. Run this exact-head gate before adopting the supplier in a
consumer; the original physical capture and its validation tier remain unchanged.
