# Cold CPU3 clock-authority model

**SOURCE_ONLY_UNCONNECTED, model.v1.** This directory contains a pure C++
interface and bounded adversarial control. No CPU3 runtime, ABI, N-API addon,
JavaScript board or guest uses it. It does not qualify a new engine path or a
speed improvement. The ABI 5 direct-RAM profile and ordinary JavaScript default
remain separate.

The model admits an opaque, move-only lease for one session and running phase.
The lease binds fixed mapping epoch 0, enabled A20, no eligible IRQ, a device
deadline and the accounting-only cold board policy: a native N tick changes
only N; a completed Q adds exactly six cycles and debt, with real device work
deferred to a retained observer. It rejects DMA, MMIO and any device that can
observe memory during the lease. An actual integration must prove these facts
from the CPU and board source before issuing a capability. Caller-provided
JavaScript N/Q or an invented seven-word pre-effect reply is never authority.

Logical CPU-side N/Q/debt and JS-published N/Q/debt are separate. A bounded
ordered tape can temporarily begin `[Q,N]`; the complete boundary must satisfy
Q≤N. A Q is admitted only while debt is below the current device deadline.
Its indivisible six clocks may end as much as five clocks above that deadline;
the next independent source effect waits for a reconciled due cut and a one-use device
rearm. A full tape likewise fences later source effects until reconciliation. The
one pending N that completes an already admitted Q may follow the crossing Q;
an unrelated later N cannot pass the due cut. A source return cannot consume
the only lease while a due clock tape still needs reconciliation. The
bounded tape reserves a slot for every unfinished Q>N deficit, so a full tape
cannot strand the completion words required for a valid boundary. The
source's pending-write alias ledger is independent of the owner journal and
ACK. An explicitly stopped source return or paused boundary can publish and
clear source aliases without acknowledging the owner journal; owner ACK does
not clear source aliases.

Reconciliation checks the entire copied tape, journal, session/lease/phase,
mapping/A20/IRQ/deadline, source and published ledgers, overlapping before
bytes, generations and boundary arguments before changing the JS-visible
shadow, clock ledger or ACK. Invalid preflight has zero *new* published board,
ACK or observer effects; already committed native RAM writes remain pending.
The observer runs only after commit. Its failure or attempted reentry poisons
the session, so a committed effect cannot be retried. A full 32-entry owner
journal stops before the next write and records an exact uncommitted retry;
after reconciliation, only that identical effect may commit once. Tape
capacity also stops before accepting an additional word. The model refuses
unresolved page and device tickets before issuing another lease.
If the separate source alias ledger fills after owner ACK, it records the
same exact pre-effect retry. Only an explicit authenticated source boundary
clears those aliases; the already acknowledged owner effects stay committed.

`PAGE_CLOCK` transfers clocks and cannot issue an execute-page ticket. Only
an admitted actual ROM-page observer produces a one-use page ticket. Deadline,
PIO, IRQ eligibility/delivery, HLT, fault, code write, mapping/A20 change,
full journal/tape, requested return and paused-observer events revoke the
running lease before the next effect. A changed mapping, A20 or IRQ state is
not admitted by the fixed cold profile. IRQ, HLT, fault, code, map and A20 cuts
leave profile authority revoked after reconciliation; this model has no
unproven reissue or resolution path. It may close as model cleanup only if all
pending extents are empty. Owner ACK does not clear source aliases; those
remain visible in the blocked diagnostic snapshot and prevent close. Unknown
stop codes are rejected.

The small control uses 256 model RAM bytes, 16-byte model pages, one-byte RAM
writes, one ROM page and test-only counter seeds. These are abstract
adversaries, not physical memory decode, real REP/fault restart, JS Map
transaction, device scheduling or CPU hook proof. Integration must bind the
source's actual alias ledger and effect sequence, authenticate the real board
deadline/device result and observer preflight, preserve full requested CPU
inspection, and then run a separate clean guest differential gate before any
timing or adoption claim.

This model assumes a single owning thread for each Authority and Lease. The
atomic session-ID allocator only prevents ID reuse; it does not make state,
lease destruction or observers thread-safe. No cross-thread control is claimed.
Actual CPU/N-API integration must enforce thread and environment affinity.

`inspect()` is a diagnostic/control snapshot of this model. It is not an
external board observer or evidence that a real CPU/JavaScript publication
transaction has occurred. Tape, journal and alias storage reserve their fixed
capacities at session creation, before source effects are admitted.

From the repository root, run the bounded control with a C++17 compiler:

```sh
c++ -std=c++17 -O0 -Wall -Wextra -Werror \
  scripts/bochs-cpu3-native-cold-clock-authority/mock.cc -o clock-authority-control
./clock-authority-control
```
