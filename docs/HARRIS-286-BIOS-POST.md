# Wired BIOS POST diagnostics

Latest follow-up: [physical DMA/HOLD and keyboard boot work](HARRIS-286-PHYSICAL-DMA.md).
The diagnostic stops below remain historical measurements of their pinned sources.

Update 2026-09-09: the optional [FDC control/IRQ6 bridge](HARRIS-286-FDC.md)
now has owned wired-guest integration tests and an explicit `--fdc-mode control`
probe option. It is off by default and refuses all data transfers. The long
POST receipts below predate that bridge and do not prove POST with it.

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

## Internal net-read optimization

Scalar `DigitalCircuit.read()` and `require()` now read the settled net state
directly instead of allocating a defensive diagnostic object and copying its
driver list on every access. `inspect()` still returns defensive copies. Net
resolution, contention/floating/unknown faults, device updates and physical
write edges are unchanged; this is not a memory or peripheral bypass.

Three differential tests retain the previous copied-read implementation as an
oracle. They cover every two-driver logic-level combination, identical fault
messages, inspection isolation, settled-snapshot semantics, and matching wired
bus traces/storage across odd addresses, RAM-bank boundaries and READY stalls.
The probe now also hashes `digital-circuit.js` before execution. Historical
receipts are preserved with their original provenance. This change has no
measured end-to-end real-time speed claim.

Follow-up regression: **368/368 passed, zero skips**, using the command above
with `test/digital-circuit-lab.test.mjs` added. This includes the three new
net-read tests and 20 existing digital-net tests. CPU/SST source hashes remain
unchanged; no new full-vector run was performed.

## Longer diagnostic: beyond screen clear

The [65,000-clock receipt](HARRIS-286-BIOS-BANNER-REPORT.json) records a
**64 KiB reduced-memory** run started before the optimization. The original
copied-read source hash was captured separately before execution and is
included explicitly; this receipt is not a post-optimization speed comparison.

At 48,000 clocks, execution remained in REP STOSW with 1,763 instructions
retired. At 50,000 clocks it had advanced to 1,882 retired instructions and
the video dispatcher. At the 65,000-clock limit it had retired 3,293, with
CX=0 and IP=`0447h` inside the video-service exit sequence, during banner
handling. Recent transfers show actual ROM fetches and stack reads. The PIC
has no acknowledge pairs yet; PIC/timer programming is retained.

This demonstrates progress beyond the original screen-clear checkpoint, not
complete banner output, POST completion, a new peripheral fault, or DOS boot.
The run exited 2 with `budget-exhausted` and `accepted:false`. No guest work
was skipped, and the earlier full-board receipt remains intact. Next run needs
a larger budget to reach INT 19h; do not treat an unchanged instruction count
during REP as a hang or reduce the guest's clear count to hurry the probe.

### Next disk-support acceptance gates

Source inspection of the owned BIOS identifies the order to implement and
test; it does not establish that this probe has reached these operations:

1. Finish banner output, then enter INT 19h/INT 13h without host traps.
2. Wire the FDC control ports and IRQ6. `fd_reset` writes DOR at 3F2h with
   00h then 0Ch and waits for the actual interrupt before polling MSR at
   3F4h. Its IRQ wait is bounded by 16,384 polls, **not timer ticks**. Missing
   FDC wiring can therefore produce a long guest wait rather than an immediate
   floating-port-read fault.
3. A reset interrupt must pass through the PIC and guest ISR. Then drain all
   four SENSE INTERRUPT responses and accept SPECIFY through real FIFO reads
   and writes at 3F5h. A control-only adapter must explicitly refuse unsupported
   data transfers; the existing non-wired controller's callback/PIO fallback
   must not stand in for wired DMA.
4. Implement and test DMA channel 2, physical bus ownership, terminal count,
   sector transfers and completion IRQs before trying a boot-sector handoff.
   Motor spin-up uses a separate BIOS timer-based wait and needs working IRQ0.

Keep no-media failure, owned-sector boot and actual DOS/application execution
as separate acceptance results. The existing non-wired BIOS/FDC tests are
useful reference cases, not evidence that these wired-board gates are complete.

## Static net-layout optimization

The immutable circuit topology is now compiled once after wire validation:
canonical roots are flattened and each net's potential output drivers are
sorted once. Each subsequent resolution still reads every current drive level
and creates fresh diagnostic state; it does not cache voltages, suppress
settling deltas, or bypass device edges. Wire edits still require construction
of a new circuit, as before. Driving a previously undriven output or releasing
it to Z remains supported.

Three additional tests compare with the previous resolver: all 64 three-driver
logic states in both topology orders, undriven/input-only nets, combinational
settle counts and omitted-output release, and wired bus traces/READY waits/
storage across odd and bank-boundary accesses. Targeted regression including
`test/digital-circuit-lab.test.mjs`: **371/371 passed, zero skips**.

`node bench/harris-net-resolve.mjs` compares the current implementation with
source loaded from the pinned local Git commit `c658507`. Missing history is
an error, not a silent fallback. It checks equal resolved nets before measuring
four alternating-order rounds of 10,000 resolutions of a synthetic 256-part,
514-net circuit. The [recorded run](HARRIS-NET-RESOLVE-BENCH.json) measured about
3.0–5.9 times faster resolution, with equal checksums. This is a noisy,
shared-host **resolver-only** measurement, not an emulator speedup or RT-speed
claim. CPU, BIOS, PIC, timer and SST sources are unchanged by this optimization.

The [new 110,000-clock probe](HARRIS-286-BIOS-STATIC-NETS-REPORT.json) uses this
resolver and the configured BIOS on the reduced 64 KiB fixture. Its shared
48,000/50,000/64,000-clock checkpoints match the earlier copied-read run's
instruction counts and CS:IP. At the new limit it has retired 7,511 instructions,
CS:IP=`F000:0453`, AX=`0E30h`, and remains in the video dispatcher during banner
output. PIC mask BCh, no acknowledge pairs, and timer mode 3/divisor 65536 are
retained. Exit 2, `budget-exhausted`, `accepted:false`: still no complete POST,
new peripheral fault or DOS boot. No firmware work was shortened or replaced.

Next functional increment should implement the bounded FDC control/IRQ6 bridge
with owned microguest tests for the acceptance gates above, then rerun normal
POST with a larger budget (e.g. 160,000 clocks). Microguest device tests are
separate from boot acceptance; a control-only bridge must not claim disk-sector
transfers or use the non-wired core's automatic DMA-to-PIO fallback.
