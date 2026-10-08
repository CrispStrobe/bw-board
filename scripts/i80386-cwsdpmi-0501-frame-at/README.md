# AX=0501 frame controller source checkpoint

This source checkpoint prepares a narrow controller for one owned DPMI
`INT 31h` AX=0501 delivery and matching protected 32-bit IRET. The runnable
adapter accepts the same pinned inputs as the finite high-memory AT gate and
wraps its unchanged completion scenario. The first hosted AT frame attempt,
run 37814786319 at source `c968428d4d478ae115b8e9cb1065f8a349b7ccbe`,
failed before journal arm because `cpu.segmentCaches` is a plain object, not
iterable. This follow-up captures its six own numeric slots without iteration;
the corrected source `4c22a574ec50a515fe4954a3fda0ff6a947a5068` then
reached the wrapper and armed the journal in run 37818842928. That run
refused the selected delivery as `unsupported-owned-delivery` after nine
active CPU steps. The retained terminal CPU has a 16-bit code descriptor,
but the report does not identify which delivery predicate failed or establish
the gate width. This follow-up retains a bounded rejection-fact diagnostic
after the original CPU step commits. It keeps the same invalid result, does
not credit an entry or return, and has not run in a guest. A dedicated
source-closure gate and label-only hosted workflow remain in place. The
earlier finite high-memory client result does not establish interrupt-frame
ownership.

The next diagnostic actual, run 37830225406 at source
`0714159c9875ac17bf5ef5a8e5418f5815fa1608`, retained a committed
rejection fact: software vector 31 through a 32-bit type-14 gate at CPL3,
same-CPL 12-byte frame and 32-bit stack, entering a 16-bit code segment.
No entry or IRET was credited. This source follow-up adds an explicit
`gate14-code16-stack32-same-cpl3.v1` arm profile for that exact observed
shape. The prior protected32 profile keeps its existing type-14/type-15
behavior. The mixed profile requires the CPU's decoded 32-bit IRET, a matching
linear frame/return and unchanged handler code/stack cache identity and
descriptor fields while the pair is open. A 16-bit IRET, task/VM86 or nested
delivery, mode excursion, or altered handler context invalidates the observer
without changing the guest operation. It does not establish identical physical
frame backing across paging changes, a main-to-wrapper CALL/RET, or any other
DPMI service frame.

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

The mixed-width adapter and guest have not been executed for this follow-up.
The new rejection receipt contains only validated primitive delivery facts:
software/vector/depth, gate type and width, VM86/error-code flags, old and new
CPL, handler CS/SS descriptor width, and frame kind and size. A recorder
failure or competing observer reentry cannot change the guest's delivered
effect or turn the refused event into a committed AX=0501 pair. The previous
failure remains first even when this optional diagnostic cannot be retained.
