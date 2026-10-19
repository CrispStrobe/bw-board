# i80386 block execution spike

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

`i80386-block-spike.wasm` is generated from
`src/experimental/i80386-block-spike.c` in this repository. Both are MIT
licensed. No firmware, OS, guest image, or third-party emulator code is in
the module.

Build with Ubuntu Clang 18.1.3 and `wasm-ld`:

```sh
clang --target=wasm32 -O3 -nostdlib -fno-builtin -Werror -Wall -Wextra \
  -Wl,--no-entry -Wl,--import-memory -Wl,--global-base=16779264 \
  -Wl,--export=block_spike_version \
  -Wl,--export=block_spike_state_ptr \
  -Wl,--export=block_spike_program_ptr \
  -Wl,--export=block_spike_capacity \
  -Wl,--export=block_spike_bind_ram \
  -Wl,--export=block_spike_run \
  src/experimental/i80386-block-spike.c \
  -o wasm/i80386-block-spike.wasm
```

Source SHA-256: `df3ac2d9bb402f3705ea7ccd76c12b4723c877e95bca1f88164f06d12aecb0cb`

WASM SHA-256: `0e6cb0789a33500b512ec1ec5fc778b78a0459aebd2b3a0f89a786411f87a9c7`

The module is used by the opt-in 386 CLI, GUI target, and stock-xv6 native-byte probe. Its
[REP STOSD receipt](../docs/receipts/2026-09-27-i80386-native-rep-stosd.json)
records matching guest RAM and an observed xv6 speed gain. The production
80386 AT, CLI and GUI still use the JavaScript CPU; no broader guest gain is claimed.
