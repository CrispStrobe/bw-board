# Plain JS cold-BIOS performance arm — source preparation only

This separate worker prepares a functional JavaScript baseline for the fixed
cold reset → before F000:E16 slice. It has not executed that slice or established
parity, speed, physical real-time behavior, broader AT boot, Windows or Doom.
The frozen compiled a6fa tree, driver 64514be6 and ordinary JS reference remain
unchanged. `capture-binding.json` is deliberately pending: execution fails before
machine construction until a separately reviewed change pins the successful
one-Q diagnostic capture, independent audit bytes and actual target Q. No target
is inferred from the ordinary 316,562-Q census.

`factory.mjs` owns a fresh authentic AT machine, the exact repository BIOS, the
fixed 12/32 controller configuration and all internal hooks. It installs the
audited Bochs CPU3 reset model once before the first instruction; init.cc SHA
4bdf4a39a2a3ceecafdd070836a055b5dec8696acf59652e2150a12fdfa7a9f3,
lines 705–874, supplies the model literals. These are not Intel hardware
corrections. It makes no later register or RAM corrections. Later MOV CR0
reserved-bit semantics remain outside the reset-only profile; the final raw CR0
must still equal 7ffffff0. Intermediate states are not asserted by this plain arm.

The process CPU delta and monotonic wall timer enclose only the bounded actual
`machine.step()` loop, loop control, real device work, complete actual PIO
recording and GC. The core already advances one ordinary completion or REP
element per step. There are no diagnostic snapshots, page census, per-step REP
byte collection, assertions or comparison work in that loop. Reset initialization,
source/Node/capture authentication, final CPU/board/RAM snapshots and comparison,
chip catchup, hashing, receipt writing and close occur outside execution timing.
The final complete ordered PIO tape and raw CPU/full board/whole RAM hash must
match the pinned capture exactly; PIC state is never synthetically masked. The
post-loop settled evidence does not prove every intermediate state or native
REP store byte effect. Six board clocks per completion is a configured functional
clock model, not calibrated physical 386 timing.

The private CLI requires Node 22.23.3, heap 128 MiB, blank six hook variables,
exclusive output, pinned clean current/Git worker closure, Node hash, and immutable
capture/audit inputs. It authenticates them again after success or retains readable
after maps on failure. Pure tests exercise pending/invalid capture, synthetic
authorization refusal, reset-only constructor, full final/PIO mutations and closed
input guards. No pure test calls CPU step or performs a guest. This draft has not
run its tests; static source preparation is the only current evidence.

A future parent must supply fresh bounded children, process-group timeout cleanup,
host context, whole-child rusage CPU/wall and raw exit/stdout/stderr. Execution
timing differs from whole-child timing, which includes imports and proof work.
The worker is only the JS arm. Native-only one-Q versus native batching measures
batch scheduling/API costs; plain JS versus native batching measures backend
speed for this complete slice. The mixed native/JS diagnostic cannot be reused as
either performance baseline. A separate consolidated parity and paired harness
and explicit execution grant remain required before any benchmark or adoption.
