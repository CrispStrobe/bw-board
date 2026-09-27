# Experimental 80386 shared RAM module

`i80386-ram-bridge.wasm` is built from the MIT-licensed
`src/experimental/i80386-ram-bridge.c` in this repository. It contains no
firmware, guest image, third-party emulator code, or instruction executor.

Build with Clang 18.1.3 and wasm-ld:

```sh
clang --target=wasm32 -O3 -nostdlib -fno-builtin -Werror -Wall -Wextra \
  -Wl,--no-entry -Wl,--export-memory -Wl,--max-memory=16908288 \
  -Wl,--export=ram_bridge_version \
  -Wl,--export=ram_bridge_ptr \
  -Wl,--export=ram_bridge_capacity \
  src/experimental/i80386-ram-bridge.c \
  -o wasm/i80386-ram-bridge.wasm
```

Source SHA-256: `c75b1d289f4b29531e998b5cb4b8d540d12d361033f3a3f5941ad54ce8e1ef2b`

WASM SHA-256: `8051f3b0ffef80ddff38feeaf8c4a9c6454d75143dd80322b6c1f9e124484928`

The fixed memory maximum prevents a later `memory.grow` from detaching the
board's shared `Uint8Array`. The board remains a JavaScript 386 executor;
this module proves only a no-copy backing arrangement.
