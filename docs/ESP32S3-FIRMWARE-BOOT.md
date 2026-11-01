# ESP32-S3 merged-flash debugger route

The public LabWired debug factory accepts an explicit ESP32-S3 flash-boot
profile. It starts the retained engine at the chip's mask-ROM reset vector
with a merged flash image and admitted ROM bytes. The existing catalog ELF/UF2
route remains separate and still refuses an unaddressed raw `.bin`.

```js
import {createDebugTarget} from 'bw-board/debug-target-factory';
import {
  ESP32S3_FLASH_BOOT_KIND,
  ESP32S3_FLASH_BOOT_ROMS,
  validateEsp32S3MergedFlash
} from 'bw-board/labwired-firmware-boot.js';

// The host has already compared each ROM's length AND SHA-256 with
// ESP32S3_FLASH_BOOT_ROMS.irom/drom. Do this before invoking the factory.
// mergedFlash, irom and drom are Uint8Arrays, not filenames or URLs.
validateEsp32S3MergedFlash(mergedFlash, {partitionTableOffset: 0x8000});
const {target, adapter} = await createDebugTarget('labwired', {
  wasm,
  firmware: mergedFlash,
  firmwareBoot: {
    kind: ESP32S3_FLASH_BOOT_KIND,
    irom,
    drom,
    console: 'uart0',
    partitionTableOffset: 0x8000
  }
});
adapter.onSerial(byte => appendConsoleByte(byte));
target.run();
target.runFor(1_000_000); // pump a bounded nanosecond budget from the host
```

## Image and configuration boundary

The image begins at **flash offset zero**, including its bootloader and
partition table. Application offsets are read from partition entries, not
assumed to be `0x10000`. A trimmed image may omit empty OTA slots and unused
flash. The profile uses the catalog's 16 MiB flash capacity and 240 MHz clock.

Admission checks include the S3 chip id (`9`) in bootloader and populated app
headers, complete image segments and their checksum, partition signatures,
alignment, overlaps, capacity bounds, and at least one populated app. An
app-only binary, encrypted image, wrong chip, truncated image or overlapping
partition table is refused before constructing the engine. Appended SHA-256
data must be present when its header flag requests it; the host and the real
bootloader remain responsible for cryptographic firmware admission.

`partitionTableOffset` defaults to `0x8000`. An explicit value must match the
offset compiled into the supplied bootloader; this option validates the layout
and does not patch the bootloader. It must be a 4 KiB-aligned flash sector.

This first route is firmware-only. It refuses a simultaneous circuit, catalog
chip/board, software profile, custom YAML, raw load address, classic ESP32 boot
quirks, or arbitrary input blobs. A later qualified board selector can extend
the trusted profile set without opening a custom-YAML replacement path.

The adapter copies firmware and ROM bytes at construction. Reset starts the
same admitted image even if a caller subsequently reuses or changes its input
buffers. `adapter.firmwareBoot` exposes frozen scalar metadata, including the
console, image length, capacity, partition-table offset and app offsets; it
does not expose the private ROM or flash copies.

## ROM admission

`ESP32S3_FLASH_BOOT_ROM_SOURCE` and `ESP32S3_FLASH_BOOT_ROMS` export immutable
repository/commit identities, exact source URLs, filenames, byte lengths and
SHA-256 digests. The ROMs are acquired on demand from the recorded supplier;
this package adds no embedded ROM payload.

The host must verify **both size and digest** before calling the factory. The
synchronous adapter validates shape and isolates reset inputs; it does not
authenticate an arbitrary caller's bytes. The focused fixture downloader
demonstrates the complete admission sequence and imports no engine until all
recorded inputs have been admitted by the test reader.

## Serial selection

`console` is required and uses `ESP32S3_FLASH_BOOT_CONSOLES`:

| Value | Behaviour |
|---|---|
| `uart0` | The engine's named UART0 console |
| `usb_serial_jtag` | The engine's USB-Serial/JTAG console |
| `both` | Combined diagnostic output, with no physical connector claim |

The first two choices generate the engine's `debug_uart` declaration. Output
on a different console is available through the engine's existing mismatch
diagnostic, rather than silently mixed into the selected console. This output
selection does not add channel-specific RX: the retained engine's
`feed_uart_input` still broadcasts to its existing RX bindings.

The retained Arduino fixture's `SMOKE_OK` marker is actually emitted on
UART0. This was checked independently with each declared console: selecting
USB leaves the marker in the unheard UART stream and produces a mismatch
diagnostic. The fixture source's CDC build description does not establish
which peripheral these particular compiled bytes use.

Physical-board support must establish its own UART and connector mapping;
this generic profile does not assign a physical USB connector.

## Qualification and limits

The focused suite has structural refusal controls, reset-copy and constructor
controls, hash/length download controls, and real retained Rust tier-1 and
Arduino images loaded through **this public factory**. Its separate unchanged ELF
control executes the existing S3 increment/branch fixture and stops on an odd
Xtensa instruction address.

The tier-1 application is Rust using `esp-hal` initialization and raw-register
checks, with an ESP-IDF second-stage bootloader. The pinned supplier retains
its [application source](https://github.com/CrispStrobe/labwired-core/blob/3b655aef4085082152129c84849d4e2ad5004a7f/examples/tier1-fixture/esp32s3/src/main.rs)
and [Rust/espflash build recipe](https://github.com/CrispStrobe/labwired-core/blob/3b655aef4085082152129c84849d4e2ad5004a7f/scripts/build_tier1_fixtures.sh).
Its bootloader banner does not make the application an ESP-IDF C build.

The Arduino smoke artifact is described in the supplier's
[fixture manifest](https://github.com/CrispStrobe/labwired-core/blob/3b655aef4085082152129c84849d4e2ad5004a7f/tests/fixtures/tier1/MANIFEST.json).
That snapshot does not retain its exact sketch source or compiler/core lock.
The similarly named `source-debug` image has a different digest and its sketch
is not the source of this `SMOKE_OK` artifact. Qualification here reuses the
recorded compiler outputs; it does not claim a reproducible Arduino or
ESP-IDF source-to-firmware toolchain in this package.

```sh
node scripts/fetch-esp32s3-firmware-fixtures.mjs --out /path/to/esp32s3-inputs
LABWIRED_ESP32S3_INPUTS=/path/to/esp32s3-inputs LABWIRED_REQUIRE_ESP32S3=1 \
  node test/labwired-esp32s3-flash.test.mjs
LABWIRED_WASM=/path/to/esp32s3-inputs/engine \
  node --test-name-pattern='esp32s3: a hand-assembled Xtensa loop' \
  test/labwired-firmware-only.test.mjs
```

The dedicated workflow requires all real inputs and an executed-case count;
absence cannot become a passing skipped suite. It reuses the recorded engine
release instead of rebuilding unchanged core sources. ROMs and compiler
outputs are fetched from exact commits and admitted against byte hashes.

This milestone establishes a firmware load/boot/debug path. It does not
establish ESP32-4848S040 RGB/ST7701 or GT911 touch behaviour, physical flashing,
GPIO circuit coupling, blocks code generation, or general compatibility with
arbitrary ESP-IDF, Arduino or MicroPython programs.
