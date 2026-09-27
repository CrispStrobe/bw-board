# i80386 block execution spike

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

Source SHA-256: `379821ff6409586e5f63a2bb9c75e7604c6add46e6c7d62fd209b6fe38a7925d`

WASM SHA-256: `e69254d3309feb43b058a9a96876100354dedf4d1a8e22ac01516e58d6fb5c02`

The module is used by the opt-in 386 CLI, GUI target, and stock-xv6 native-byte probe. Its
[REP STOSD receipt](../docs/receipts/2026-09-27-i80386-native-rep-stosd.json)
records matching guest RAM and an observed xv6 speed gain. The production
80386 AT, CLI and GUI still use the JavaScript CPU; no Windows gain is claimed.
