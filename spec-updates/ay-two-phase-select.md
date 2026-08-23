# The AY-3-8912's two-phase select — the shape E5.1 stops at

Status: SPEC ONLY. The roadmap's E5.1 note says this chip "needs a
two-phase select note" before code; this is that note. Nothing below is
implemented.

## Why the AY does not fit the SELECT table

Every entry in `m6502-extract.js`'s SELECT table is one predicate over
the ADDRESS: a conjunction of chip-select pins that must sit high/low,
evaluated at all 65536 addresses. The AY-3-8912 has no chip select in
that sense. Its bus control is the GI protocol pair **BDIR/BC1**, and
the pair names an OPERATION, not a location:

| BDIR | BC1 | operation      |
|------|-----|----------------|
| 0    | 0   | inactive       |
| 0    | 1   | read register  |
| 1    | 0   | write register |
| 1    | 1   | LATCH ADDRESS  |

The register being addressed is whatever was last latched — the chip
keeps its own address register. So "where does the AY live" is not one
window but a *convention*: a decode that produces the latch operation at
one CPU address and the write operation at another. The near-universal
breadboard convention is the **two-address shape**:

    base+0 → BDIR=1, BC1=1   (latch: the data bus carries the register number)
    base+1 → BDIR=1, BC1=0   (write: the data bus carries the value)
    reads, when wired at all: base+1 with BDIR=0, BC1=1

with BDIR gated by the write strobe (RWB low on the 6502, /WR on the
Z80) and BC1 by A0 (or an equivalent line). That gating is exactly what
the extractor's current domain cannot see: it evaluates nets over
addresses only, and **BDIR is a function of RWB**, which today is
presence-checked, never evaluated.

## The shape work, stated

1. **Extend the evaluation domain by one axis.** `evalNet` gains an
   `rwb` input alongside `addr`; the CPU's `rwb` pin becomes a driver of
   type `rw` the way `a0..a15` are drivers of type `addr`. The sweep for
   two-phase chips runs over (addr, rwb) ∈ 65536 × {0, 1}. Ordinary
   SELECT chips are unaffected — their predicates never reference the
   new axis, and the sweep for them stays single-pass.

2. **Recognize the protocol, not the wiring.** For each AY on the
   board, evaluate BDIR and BC1 over the extended domain and CLASSIFY:
   - the (addr, rwb=0) pairs where (BDIR,BC1) = (1,1) → the latch set;
   - the (addr, rwb=0) pairs where (BDIR,BC1) = (1,0) → the write set;
   - the (addr, rwb=1) pairs where (BDIR,BC1) = (0,1) → the read set
     (may be empty — write-only wiring is common and legal).
   Accept when latch and write sets are each one contiguous window,
   disjoint, and (for the two-address shape) adjacent. Emit
   `{ kind: 'psg8912', at: latchBase }` with the convention recorded.
   Everything else refuses WITH THE PAIR NAMED — e.g. "U5: BDIR/BC1
   evaluate to the latch operation at $A000 for BOTH read and write;
   gate BDIR with RWB or the chip fights the CPU for the bus on reads."

3. **Contention joins the same framework.** An AY drives the data bus
   whenever (BDIR,BC1) = (0,1). Any (addr, rwb=1) where the read set
   overlaps a ROM/RAM/peripheral window is bus contention and must be
   refused with the address named — this is the AY-specific instance of
   the sweep's existing contention rule, and it needs the rwb axis to
   even be expressible.

4. **Machine side.** `m6502-machine` (and the z80 twin's IO map) grow a
   `psg8912` kind over the existing `AY38912` core (`select(reg)` /
   `write(val)` / `read()`): a write to the latch window calls
   `select(val & 0x0f)`, a write to the data window calls `write(val)`,
   a read of the read window (when wired) returns `read()`. Audio-out
   ports A/B ride the existing device-state surfaces.

## What this deliberately does not cover

- **Timing of the pair.** Real boards glitch BDIR/BC1 during decode
  settling; the chip tolerates it because BC2 (tied high on the 8912's
  common wiring) qualifies the pair. Same bound as PHI2 everywhere else
  in the extractor: presence, not timing.
- **The 8910/8913 pinouts.** Same protocol, different packages; add
  them as pin surfaces when a board needs them, the shape is shared.

## Acceptance (write these tests first)

1. The two-address fixture (BDIR = select·~RWB, BC1 = A0·select via
   drawn NAND glue) extracts `psg8912 at base` with latch/write windows
   named; a register write sequence through the machine reaches the
   AY core (`select` then `write`, asserted on the core's state).
2. BDIR unwired from RWB (pure address gating) refuses with the
   read-contention address named, not a guess.
3. The existing single-phase chips extract IDENTICALLY before and after
   the domain extension — bit-identical `regions`/`chips` on the whole
   fixture corpus (the rwb axis must cost nothing when unused).
