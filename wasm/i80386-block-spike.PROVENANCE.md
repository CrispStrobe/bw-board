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

Source SHA-256: `bfcb0b1b10c3c7014497563d0741d7e70df501c7b414ceb800ecfc94762655bd`

WASM SHA-256: `c126f716b2f4c842aecc9f0ac8bf82c5098ba3aeadec4697b22eb35c02aa714f`

The module is used by the opt-in 386 CLI, GUI target, and stock-xv6 native-byte probe. Its
[REP STOSD receipt](../docs/receipts/2026-09-27-i80386-native-rep-stosd.json)
records matching guest RAM and an observed xv6 speed gain. The production
80386 AT, CLI and GUI still use the JavaScript CPU; no Windows gain is claimed.
