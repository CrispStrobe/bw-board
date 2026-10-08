# AX=0501 frame controller source checkpoint

This unrun source checkpoint prepares a narrow controller for one owned DPMI
`INT 31h` AX=0501 delivery and matching protected 32-bit IRET. The runnable
adapter accepts the same pinned inputs as the finite high-memory AT gate and
wraps its unchanged completion scenario. It has no hosted AT guest result.
A dedicated source-closure gate and label-only hosted workflow are present
but have not been dispatched. The earlier finite high-memory
client result does not establish interrupt-frame ownership.

`admitFreshWrapper` calls the unchanged fresh executable/map/compile admission
and immediately copies the authenticated `allocateMemory` extent and expected
bytes into private state. Public `layout.roles` and `layout.textBytes` can be
mutated later and are not authority. `compareWrapperSnapshot` compares a
caller-supplied whole-text copy against that private wrapper. It also checks
the inherited private diagnostic on a whole-text mismatch, while the
whole-text exact case is checked directly. The result is a byte-comparison
receipt. It does not authenticate that the caller paused the real machine,
read ordinary RAM, or preserved CPU/board state. Driver integration must own the
synchronous between-step passive read and unchanged-state fingerprint.

The CPU-free policy accepts one source-owned opportunity after an admitted
main cut. The driver checks CS and code base continuity from that cut, takes
one passive full-text RAM copy at the wrapper opportunity, and checks CPU,
board, RAM and source references before and after it. It arms the optional
CPU journal at the wrapper address, polls only after ordinary machine steps,
drains once on completion or invalidation, and requires the committed AX=0501
pair before accepting the same-session strict client result. The returned CF
must be clear and returned BX:CX must equal the client's strictly parsed
linear address. Delivered saved flags, consumed frame flags, and actual
returned flags remain separate fields. A pre-step wrapper PC is only an
opportunity: the board can service an IRQ before the CPU executes the next
instruction. The CPU's decoded committed event must establish delivery.

The adapter entry point is:

```sh
node scripts/i80386-cwsdpmi-0501-frame-at/adapter.mjs input.json report.json progress.json
```

This invocation is unrun. Reports keep the finite-client verdict separate from the frame verdict
and retain the two CPU journal records and wrapper observation hashes. Partial
progress always reports top-level `passed:false`; no raw executable, RAM or
disk bytes are report fields. The adapter retains the bounded wrapper receipt
at arm and the full terminal CPU journal at complete/invalid, each as a
separate progress milestone, so an external timeout does not erase a reached
frame observation. It does not rewrite the progress file on every step. A
source-closure gate and hosted workflow require exact-head review before
any actual dispatch.

The pure test supplies synthetic records. It verifies policy ordering and
negative cases; it does not import or execute the CPU, establish guest
provenance, prove physical frame identity, or qualify other DPMI services.
Run the CPU-free controls with:

```sh
node --test test/i80386-0501-frame-policy.test.mjs test/i80386-0501-frame-orchestration.test.mjs
```

The adapter, CPU and guest have not been executed for this checkpoint.
