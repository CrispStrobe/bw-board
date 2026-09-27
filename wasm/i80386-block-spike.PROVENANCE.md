# i80386 block execution spike

`i80386-block-spike.wasm` is generated from
`src/experimental/i80386-block-spike.c` in this repository. Both are MIT
licensed. No firmware, OS, guest image, or third-party emulator code is in
the module.

Build with Ubuntu Clang 18.1.3 and `wasm-ld`:

```sh
clang --target=wasm32 -O3 -nostdlib -fno-builtin -Werror -Wall -Wextra \
  -Wl,--no-entry -Wl,--export-memory \
  -Wl,--export=block_spike_version \
  -Wl,--export=block_spike_state_ptr \
  -Wl,--export=block_spike_program_ptr \
  -Wl,--export=block_spike_capacity \
  -Wl,--export=block_spike_run \
  src/experimental/i80386-block-spike.c \
  -o wasm/i80386-block-spike.wasm
```

Source SHA-256: `f9964798b3003f314610dadcd33eee95d97f7a2fb5bba3f830e537f35e812a60`

WASM SHA-256: `07e8f06813854c78ed2b4a97b8a6fa5fb40c5be53f137d1e95c194d051d34754`

This is a bounded execution-contract demonstration. The production 80386 AT
still uses the JavaScript CPU. No xv6 or Windows speedup is claimed.
