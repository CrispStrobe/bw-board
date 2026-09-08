# Wired BIOS POST diagnostics

2026-09-08. `scripts/probe-harris-bios.mjs` runs the repository-owned BIOS
through the Harris CPU and real wired RAM/ROM/PIC/timer adapters. It does not
install BIOS interrupt traps, initialize the IVT on the host, skip POST, load
disk media, or report a diagnostic stop as successful boot.

```sh
node scripts/probe-harris-bios.mjs --max-clocks 20000
node scripts/probe-harris-bios.mjs --max-clocks 20000 --pic-mode single-unbuffered
```

The default board has 640 KiB conventional RAM, optional text storage enabled,
the explicit low ROM alias, PIC and timer. The default timer divider has eight
system-clock periods per half-cycle. `--ram-kib` accepts 64..640 in 64 KiB
increments for explicitly reduced diagnostic fixtures. A reduced-memory probe
is not a DOS compatibility result: this firmware still declares 640 KiB.
Configuration does not enable the path in
the application or change application engine pins.

The probe emits progress on stderr and a JSON result on stdout. `accepted`
is always false and diagnostic termination exits 2, including budget exhaustion
and HLT. Invalid CLI arguments exit 1. Results identify the ROM SHA-256, source
hashes, instruction location, peripheral states and recent completed physical
transfers. Source hashes are captured before execution, not after a long run
during which worktree sources might change. A reported fault is evidence of a stopping point, not evidence that
every earlier instruction or device behavior is hardware-conformant.

The earlier 6,000-clock probe stopped in `post_ivt1` after 747 retired
instructions. The source initializes all 256 vectors with actual guest stores;
that work must be allowed to run rather than replaced by host memory writes.
The earlier result and memory-map coverage are preserved in
[HARRIS-286-MEMORY-MAP.md](HARRIS-286-MEMORY-MAP.md).

## Verified first stop and explicit firmware configuration

The owned BIOS writes PIC ICW4 `09h` and calls it buffered master in a comment.
The [Intel 8259A datasheet](https://www.pcjs.org/documents/datasheets/intel/INTEL_8259A_PIC.pdf),
ICW4 description, assigns BUF to bit 3 and M/S to bit 2: buffered master would
be `0Dh`, not `09h`. The wired board is currently a single unbuffered subset,
which explicitly accepts `01h` and rejects both buffered forms. Neither
changing the comment nor pretending `09h` means `01h` supplies missing hardware.

The extended **640 KiB** baseline reached that actual fault after 13,543
completed execution clocks and 1,516 retired instructions, at `F000:00F9`.
Its last physical I/O write was value `09h` to port `21h`; PIC initialization
remained at phase 3 after two accepted writes, vector base 8. A separate
64 KiB diagnostic reproduced the same location/state. Default ROM SHA-256:
`6f9f5463afa5c30ce25263c0430f741cbb0274e98b00c675ef04c9edfee0aa34`.
This establishes the mismatch at runtime, not just by source inspection.

`buildBios({picMode:'single-unbuffered'})` now explicitly selects ICW4 `01h`
for this board's PIC wiring. It substitutes one named assembly configuration
constant **before assembly**, not a byte patch to a compiled or third-party
guest. Unknown modes and missing/duplicate configuration definitions refuse.
The returned build metadata and diagnostic receipt name the selected profile.

The default remains `legacy-buffered`, preserving the entire original ROM
byte-for-byte, including its legacy `09h`. A regression proves the selected
variant differs only at ROM offset `00F6h`, the ICW4 immediate; reset bytes and
all control flow stay identical. The misleading buffered-master source comment
is corrected. This change neither implements buffered/cascaded hardware nor
weakens the PIC's refusal of unsupported modes. The new option configures only
the PIC requirement, not every other hardware requirement of this BIOS.

Five owned tests cover ROM identity/one-byte configuration difference, invalid
source/profile refusal, retained PIC guards and diagnostic CLI/provenance.
No snapshots, BIOS traps, disk download or host-side IVT initialization are
introduced. Unmapped port writes can still complete without a responding
device: progress beyond them is **not** evidence of PPI/video implementation.

## Regression evidence

The [two-run diagnostic receipt](HARRIS-286-BIOS-POST-REPORT.json) preserves
the baseline refusal and the configured follow-up. On the 640 KiB board, the
configured ROM passes PIC initialization (vector base 8, mask BCh), programs
timer mode 3/divisor 65536, and enters the BIOS text-memory clear. At 20,000
clocks it is still executing REP STOSW, with 1,763 retired instructions,
CX=7,192, IP=`055Eh` and physical writes of `0720h` to the text chips. The IP
is already past the decoded REP opcode; this is not an instruction-boundary
snapshot. No acknowledge pairs or POST completion have occurred yet.

Configured ROM SHA-256:
`de2af892077af637fc90f5203353382ec1fac60dfd1470db63e9bf098363b5c1`.
The result is `budget-exhausted`, exit 2, `accepted:false`—not a boot success
and not an observed next peripheral fault. Continue with a larger clock budget
to finish the normal screen clear and reach disk-controller initialization.
Reduced-RAM fixtures can shorten diagnostic iterations, but cannot replace
the full-board or actual DOS acceptance tests. PPI/video register devices,
FDC/DMA transfers and complete PIC/PIT modes remain unfinished.

Final targeted run: **345/345 passed, zero skips**. This includes the five
new tests plus existing wired CPU/memory/PIC/timer, preservation/persistence,
PIC/PIT core, BIOS-ROM and BIOS-floppy-driver regressions. The BIOS/floppy
tests run on their existing non-wired machines, not on the Harris probe.

```sh
node --test --test-reporter=spec test/harris-*.test.mjs test/paterson-fat12.test.mjs test/sst286.test.mjs test/private-guest-fixtures.test.mjs test/dos-guest-persistence.test.mjs test/i8259.test.mjs test/i8254*.test.mjs test/bios-rom.test.mjs test/bios-fdc.test.mjs
```

CPU/SST adapter/runner hashes remain those of `SST286-INTR-REPORT.json`;
the prior full real-mode receipt remains 1,477,997 passes, three revocations,
zero failures/unsupported/budget exits. No new full-vector run, full CI/browser,
merge, deployment, application pin change or media hosting is claimed.
