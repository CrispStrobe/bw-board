# ULA memory contention — design note

**Status: APPROVED** — coordinator review d45a33c → 2026-08-16.

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

## Accuracy level: PER-INSTRUCTION approximation

**Our Z80 core is instruction-stepped.** It does not expose individual
bus cycles within an instruction. This means:

- We CANNOT apply contention at the per-access level (a real LD (HL),A
  has one contended read + one contended write at specific T-state
  offsets within the instruction — we see only the instruction as a
  whole).
- We CAN classify each instruction by its number of contended-memory
  accesses and apply the TOTAL contention penalty at instruction
  granularity. This is the same approach FUSE uses for its
  instruction-level contention tests.

**Stated bound:** the contention model is accurate to ±1 T-state per
instruction in typical cases, and up to ±3 T-states for complex
instructions (LDIR, block I/O) where mid-instruction contention
patterns interleave. This is sufficient for the border-timing loops
and music players that are the practical use cases; sub-instruction
bus-cycle accuracy requires a cycle-stepped core.

## T-state model (48K)

The ULA reads bitmap/attribute data in an 8-T-state pattern during the
active display area. The community contention table:

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

## Implementation

### Opt-in via config.contention

Contention is OFF by default (`config.contention: true` enables it).
This keeps existing timing-verified tests exact — their cycle counts
were validated without contention and must not drift.

### ULA.contend(tStates) → wait states

A pure function on the ULA: given the current frame T-state position,
returns the contention penalty from the table. Returns 0 during
border/blanking time.

### Machine wrapper

When `config.contention` is true, the machine wraps the Z80's
read/write/in/out callbacks. Before each contended-range access,
`machine.cycles += ula.contend(machine.cycles % frameTstates)`.

For instruction-level approximation: the wrapper fires on every
read/write the Z80 core makes (the core calls the callbacks for
each bus access). Since the callbacks ARE per-access, the contention
is actually applied at the access level — the instruction-step
limitation means we cannot ADJUST the T-state position between
accesses within one instruction, but the penalty lookup is correct
for the instruction's START position.

### Test plan (FUSE-derived)

1. **Contention delay table oracle**: set `machine.cycles` to place
   the ULA at each of the 8 pattern positions, verify the correct
   wait states.

2. **Uncontended addresses**: $8000+ returns 0 regardless of position.

3. **Border time is free**: top border line, contended address → 0.

4. **Instruction timing**: a tight `LD A,(HL)` loop from $4000
   (contended) vs $8000 (uncontended), verify the contended version
   takes measurably more cycles over N iterations.

5. **Port contention**: IN $FE during active display adds wait states.

6. **Config gate**: with `contention: false` (default), the same loops
   produce identical cycle counts.

### What NOT to model (stated)

- **Snow effect**, **floating bus**, **sub-instruction bus-cycle
  accuracy** — all require a cycle-stepped core.
