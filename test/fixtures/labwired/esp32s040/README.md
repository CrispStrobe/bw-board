# S040 public-factory evidence

`manifest.json` records exact bytes used by the real public-factory proof.
It currently describes a **local candidate**, with a base commit and review
patch hash. It does not identify a published release, a reproducible compiler
toolchain or a physical board capture. The exact source-owned guest is produced
by the supplier's retained `build_probe.py`, an independent Python Xtensa
encoder under MIT. It uses SRAM1 code, descriptors and three reusable RGB565
row buffers. No Arduino, ESP-IDF, ROM, Wi-Fi or Bluetooth execution is inferred.

The guest initializes ST7701 by GPIO, transfers a complete 480×480 frame using
LCD/GDMA, polls GT911 through I2C, and changes a real pixel in response to touch.
The test observes guest memory and display artifacts through the public target.
The separate tiny H1 guest selects actual GPIO mux functions; debugger MMIO
controls then verify the five physical header pads and Board electrical solve.
It does not replace the display/touch guest or inject a firmware framebuffer.

For a local candidate review, stage exactly these files in an external input
directory; the engine glue requires a sibling `package.json` containing
`{"type":"commonjs"}`:

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

Remote fetching is deliberately unavailable while the manifest is provisional.
`scripts/fetch-esp32s040-fixtures.mjs` refuses before network or output writes.
The dedicated workflow also requires `LABWIRED_REQUIRE_ESP32S040=1`; that switch
rejects provisional release identities and missing inputs, and the TAP reader
requires all cases and zero skips. There is no candidate bypass for hosted
qualification. After the owning source, reviewed silicon acknowledgement and
independently repeated immutable engine release are approved, update all source,
catalog, release and fixture identities together and run that exact-head gate.
