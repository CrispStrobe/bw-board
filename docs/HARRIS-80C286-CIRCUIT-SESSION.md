# Experimental saved board and debugger session

This is an engine-only integration seam, not a Circuit Editor GUI component or
a general 80286 implementation. Import `src/experimental/harris-circuit-session.js`
explicitly; production exports, CPU defaults and application pins are unchanged.

## Construction recipe

`createHarrisCircuitDocument({enabled:true, rom, romLowAlias})` produces JSON-safe
format `bw-experimental-circuit`, version 1, profile `harris-latched-memory-v1`.
Register the existing memory models with `registerBusMemory()` first. The document
contains ROM bytes, explicit low-ROM-alias choice, a typed part inventory and wires
using `{from, fromTerminal, to, toTerminal}`. The topology comes from the existing
board builder, not a second independently maintained wiring diagram.

The inventory is fixed: boot-subset CPU, ideal controller, address latch, inputs,
two 28C256 ROM banks, two 62256 RAM banks and four profile address decoders.
Wires may be edited before loading. Unknown endpoints fail construction; missing
or electrically invalid connections may instead fault when clocks execute.
Unknown fields, versions, profiles, backends, parts, duplicate parts and invalid
ROM bytes are rejected. There is a 64 KiB ROM and 4096-wire limit.

`loadHarrisCircuitSession(documentOrJSON, {enabled:true})` constructs but does not
initialize or execute the board. `exportConfiguration()` returns a defensive copy
of its original recipe, never RAM contents, pending writes or current registers.
Reloading always creates fresh state. These logical part types are not claimed to
be registered editor components or a complete physical 82C288 implementation.

## Debugger session

```js
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisLoopROM} from '../src/experimental/harris-boot-rom.js';
import {createHarrisCircuitDocument, loadHarrisCircuitSession}
    from '../src/experimental/harris-circuit-session.js';

registerBusMemory();
const document = createHarrisCircuitDocument({
    enabled: true, rom: createHarrisLoopROM(), romLowAlias: true
});
const session = loadHarrisCircuitSession(JSON.stringify(document), {enabled: true});
session.initialize();
session.setBreakpoint(0xfffff0);
session.run();                  // breakpoint before first reset instruction fetch
session.stepInstruction();      // execute reset far JMP
session.run();                  // bounded execution of owned loop ROM
session.inspectBank('ram0');    // defensive bytes copy, no guest bus access
```

- `stepClock(ready_n=0)` advances one modeled system-clock period.
- `stepInstruction(maxClocks=4096, ready_n=0)` runs to one retirement, including
  from a partial instruction; it ignores code breakpoints for that step.
- `run(maxClocks=4096, ready_n=0)` stops on a breakpoint, budget or terminal CPU state.
  A budget is resumable. Returned clocks exclude the 67 initialization clocks.
- Breakpoints are **24-bit physical instruction-start addresses**, including
  reset hidden CS base. No 20-bit wrapping is applied. They stop before the first
  fetch clock, not on immediate/displacement bytes. Continuing from a breakpoint
  skips it once, then rearms it for later loop visits.
- `inspect()`, `inspectBank(id)`, `inspectNet(id,pin)` and `trace()` are read-only
  inspections. Bank offsets do not pretend to be a decoded physical-memory map:
  the user may have changed wiring. No destructive port reads are provided.
- Faults throw and latch CPU status; reconstruct from the recipe after faults.
  `cancel()` is terminal for the session; it is not bus-write rollback.

The returned API is frozen and does not expose its mutable board or CPU.
`saveState`, `restoreState`, `readMem`, `writeMem`, `setRegisters` and `setBackend`
explicitly throw `UNSUPPORTED_DEBUG_OPERATION`. This is **not** a complete
Boundary-D target and is not registered in the production debug-target factory.
No asynchronous scheduler, physical HALT signalling, prefetch, instruction timing,
interrupts, protected mode, live topology editing or snapshot support is implied.

## Verification and next gate

`test/harris-circuit-session.test.mjs` covers JSON round-trip execution, fresh
reload, defensive copies, schema/backend rejection, effective wire edits, reset
and loop breakpoints, operand-byte exclusion, instruction/clock stepping, READY
budgets, cancellation and unsupported-operation non-mutation. Existing bus, CPU
and memory regression tests remain applicable.

Local verification on 2026-09-08: 117/117 targeted tests passed, four suites,
zero failures or skips (session, loop CPU, boot CPU, memory board, bus,
digital-circuit lab, existing bus-memory and 8086 machine test files).
The first session test run caught a test breakpoint aimed at a ModR/M byte;
correcting it to the assembly's instruction start made the loop-revisit check pass.

Next: application-side default-off import/export and debugger controls consuming
this API, with browser tests and explicit unsupported-part feedback. Broader board
profiles and a full debugger target require additional contracts; they must not
be inferred from this fixed-profile loader. No merge, deployment or full CI/hardware
verification is implied by local targeted tests.
