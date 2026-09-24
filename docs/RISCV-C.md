# C (and assembly) on RISC-V — the whole toolchain

This is the map of how a program written in a browser tab becomes a running
RISC-V program, across the three repositories that make it work. It is the
reference for anyone wiring a new front end to the RV32 machine, or wondering
which route a program takes.

The three pieces:

| repo | role | what it provides |
|---|---|---|
| **bw-board** (this repo, MIT) | the **engine** | the RV32IMA machine, the assembler, the in-browser C compiler, the ELF loader |
| **stc-compiler** (MIT wrapper) | the **hosted service** | `/compile` targets that run heavier compilers server-side, on Vercel |
| **brickwright-lite** (BSD-3) | the **GUI** | the Code tab, the route chooser, the console |

Everything targets one machine and one ABI, so a program compiled by *any* of
the routes below boots the same way.

## The machine and its ABI

`RiscV32Machine` (`src/riscv32-machine.js`) is an RV32IMA interpreter with a
CLINT, a PLIC, an NS16550 UART and an optional virtio-blk disk — enough to boot
xv6 and FreeRTOS. For plain console programs the important part is its tiny
**Linux-style `ecall` ABI** (`a7` = syscall number):

- `a7 = 64` — `write(fd = a0, buf = a1, len = a2)` → bytes to the console
- `a7 = 93` — `exit(code = a0)` → halts the machine

That is the whole contract a compiled program needs. `RARS`/newlib/picolibc all
use these numbers, so their output runs unchanged.

**Booting an image.** `machine.loadImage({entry, segments}, entrySp?)` places
the segments, sets `pc = entry`, and gives the program a real stack — `sp` near
the top of RAM with `argc`/`argv` (= 0) laid out where a Linux-style `_start`
reads them. A program that sets its own `sp` (a picolibc/newlib crt0, an RTOS)
overwrites it; one that does not (shecc's `_start` reads `argc` off `sp`) relies
on it. The console adapter (`createRiscV32Adapter`) defaults to **8 MiB** so a
learner's heap + stack have room.

An image is always `{entry: number, segments: [{addr, bytes}]}` — the one shape
every route produces and the machine boots. `scripts/riscv-elf.mjs`
(`execElfToImage`) turns a linked ELF32 into it.

## The routes — four ways to make an image

### 1. Assembly, in the browser — `riscv-asm.js`
`assembleRiscv(source)` is a full RV32IM assembler (pseudo-ops, directives)
that runs in the page with no server. Best for teaching the ISA.

### 2. C, in the browser — `riscv-cc-wasm.js` (shecc → wasm)
`compileRiscvC(source)` runs **shecc** (a small self-hosting C compiler,
BSD-2-Clause) compiled to `wasm32-wasi` and shipped as `wasm/riscv-cc.wasm`. It
carries its own 12-call WASI shim, so it works in Node and any bundler with **no
server**. shecc is a **C subset** — real functions, recursion, arrays, `printf`,
targeting real RV32IM — but *not* the full language or standard library. See
`wasm/riscv-cc.PROVENANCE.md`.

### 3. Full C, hosted — stc-compiler `riscv32-gcc`
For anything the subset cannot compile — floats (`%f`, `<math.h>`), `malloc`,
`qsort`, `<string.h>` — stc-compiler's `riscv32-gcc` target runs a native
`riscv64-unknown-elf-gcc` + **picolibc** bundle server-side and returns the same
`{entry, segments}` image. It needs a real compiler, so it is hosted, not
in-browser.

### 4. The subset, hosted — stc-compiler `riscv32`
The same shecc, run on the server (via `wasmtime`) instead of in the page —
mostly for API consumers that would rather not ship the wasm themselves.

**How a front end chooses.** The subset (routes 1–2) runs with no backend at
all; the full compiler (route 3) is one POST away. brickwright-lite's Code tab
offers the choice explicitly (Browser vs Server) and, when the browser subset
rejects a program, offers a one-click retry on the server.

## What is NOT here

- **C++ is not offered on RISC-V, by design** — and RISC-V is the wrong place
  for it. Debian's `gcc-riscv64-unknown-elf` is built `--disable-libstdcxx`, so
  there is no target `libstdc++` (no STL, no `<iostream>`, no `<cXXX>` headers)
  for rv32; bare freestanding C++ compiles, but without the standard library it
  misleads a learner, and this machine is console-only, so C++'s hardware idioms
  have nothing to drive. **Where C++ belongs is AVR/Arduino** (in stc-compiler):
  Arduino *is* C++, `avr-g++`/`cc1plus` are already in the Debian bundle (just
  trimmed), ATTinyCore is C++, avr8js models real peripherals, and no STL is
  *expected* on AVR — so nothing misleads. That is the planned home for a C++
  lane; RISC-V stays C.
- **A stdin/console-input path** — the ecall ABI is write/exit only today; a
  UART/HTIF stdin is future work.

## Quick reference — booting an image from Node

```js
import {compileRiscvC} from 'bw-board/riscv-cc-wasm.js';     // C (subset) → image
import {createRiscV32Adapter} from 'bw-board/riscv32-adapter.js';

const {image} = await compileRiscvC('int main(){ printf("hi\\n"); return 0; }');
const {machine} = createRiscV32Adapter({image});             // loadImage + 8 MiB
machine.run(20_000_000);
console.log(machine.output);                                 // "hi\n"
```

(`compileRiscvC` hands back the `{entry, segments}` image directly. For a route
that produces a linked ELF instead — the assembler's `.o`, or the hosted
service's ELF — `execElfToImage` in `scripts/riscv-elf.mjs` converts it.)
