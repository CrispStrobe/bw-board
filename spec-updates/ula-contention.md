# ULA memory contention — design note

## What it is

The ZX Spectrum ULA shares the RAM bus with the CPU. When both need
the bus in the same T-state, the ULA wins (it is hardwired to the bus)
and the CPU is halted (WAIT) until the ULA releases. This adds 0-6
extra T-states per contended memory access, depending on where in the
ULA's 8-T-state scan cycle the access falls.

Programs that run from contended RAM ($4000-$7FFF on 48K; pages 1,3,5,7
on 128K) execute slower than the same code from uncontended RAM. This
is observable: screen-timing demos, music players, and multicolor
routines depend on exact T-state counts that include contention.

## T-state model (48K, the well-measured case)

The ULA reads bitmap/attribute data in an 8-T-state pattern during the
active display area. The community contention table (documented by
multiple independent measurements, Chris Smith's ULA book §6.3, and
the FUSE test suite):

| T-state in pattern | Wait states added |
|---------------------|-------------------|
| 0                   | 6                 |
| 1                   | 5                 |
| 2                   | 4                 |
| 3                   | 3                 |
| 4                   | 2                 |
| 5                   | 1                 |
| 6                   | 0                 |
| 7                   | 0                 |

The pattern repeats for 128 T-states per scan line (the visible pixel
area = 256 pixels / 2 pixels per T-state). Before and after the
visible area (border, hsync, blanking), the ULA does not contend.

### Frame geometry (48K)

- Lines 0-63: top border (no contention)
- Lines 64-255: active display (contention on each line)
- Lines 256-311: bottom border + vsync (no contention)
- Total: 312 lines × 224 T-states/line = 69888 T-states/frame

Per active-display line:
- T-states 0-127: pixel/attr fetches (contended)
- T-states 128-223: border + hsync (uncontended)

### 128K differences

- Frame length: 70908 T-states (228 T-states/line × 311 lines)
- Contended pages: 1, 3, 5, 7 (odd-numbered banks)
- Port contention: all even ports (ULA-decoded) are contended

## Implementation approach

### Hook point

The Z80 core's `read` and `write` callbacks receive the address. A
contention wrapper intercepts accesses to the $4000-$7FFF range (or
the contended pages on 128K) and adds wait states to `machine.cycles`
BEFORE the access completes. The read/write itself is unchanged.

The wrapper needs the ULA's current T-state within the frame
(`machine.cycles % frameTstates`) to look up the contention delay.
This is already available — `ula.tStates` tracks it.

### What to add

1. A `contend(addr)` method on the ULA that returns the wait-state
   penalty for a memory access at the current T-state position.
   Returns 0 when:
   - The address is not in contended RAM
   - The ULA is in border/blanking time
   - The T-state within the line is in the uncontended half

2. The machine wraps the Z80's read/write callbacks to call
   `contend(addr)` and add the result to `machine.cycles`. The Z80
   core already returns per-instruction cycle counts; contention
   adds to the machine's cycle counter, not the instruction's return
   value — this is how all accurate emulators do it.

3. Port contention: I/O to even ports (the ULA's port space) is
   contended the same way. The `in`/`out` callbacks gain the same
   wrapper.

### What to test

1. **Contention delay table**: manually construct a frame position and
   verify `contend()` returns the expected wait states from the table.

2. **Uncontended addresses pass through**: $8000+ returns 0.

3. **Border time is free**: during top/bottom border lines, even
   contended addresses return 0.

4. **Instruction timing difference**: run a tight loop (e.g. `LD A,(HL)`)
   from contended vs uncontended RAM, count cycles over N iterations,
   verify the contended version took more.

5. **Port contention**: IN/OUT to $FE is contended during active display.

### What NOT to model (stated)

- **Snow effect**: the visual artifact from writing to the display file
  during ULA fetch. Requires pixel-level rendering; our frame-level
  renderer shows the final state.
- **Floating bus**: reading an unassigned port returns the ULA's current
  data-bus value (the byte it's fetching for video). Some programs use
  this for synchronisation. Requires cycle-accurate bus modeling.

## Dependency

This is a ULA-owned change. The Z80 core is untouched — contention
lives in the machine layer (the read/write wrappers the machine already
owns). `mna.js` and `board.js` are not involved.

## Reviewer questions

1. Should contention be opt-in (a config flag)? It adds a function call
   per memory access — the cost is measurable. A `config.contention`
   flag lets performance-insensitive paths (tape loading, batch runs)
   skip it.

2. The 128K contention tables are slightly different from 48K (228
   T-states/line vs 224, different scan-line offset). Should both be
   implemented simultaneously or 48K first?
