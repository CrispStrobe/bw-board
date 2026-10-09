# Source-only page-fault delivery outcome recorder

This is a separate default-off CPU diagnostic at the reviewed far-attribution
source. `armOwned0501FaultOutcome({maxActiveSteps})` admits one bounded synchronous
session. `owned0501FaultOutcomeStatus(token)` and
`takeOwned0501FaultOutcome(token)` expose only copied primitive facts. The
caller must independently bind the CPU, owned client, entry, and same-machine
run before using a future guest report. This source checkpoint has no driver,
source-admission workflow, guest run, or passed application claim.

The recorder observes one vector-14 `I80386Fault` at the `step()` catch,
copies its own-data vector/error-code/task-commit marker and the CPU's ordinary
CS:EIP, SS:ESP, CR0/CR2/CR3, flags and derived CPL. It reports the actual
instruction-restore branch, selected restart EIP, whether `_deliverFault` was
called, and whether that call returned or threw, with pre/post scalar contexts.
It does not inspect RAM, TSS, stack frames, handler bytes or page tables.
An observer failure retains the first refusal and any earlier copied facts;
the guest fault, rollback choice, delivery order, result and thrown object keep
their original behavior. The existing strict owned 0501 journal remains
separate and its invalid frame/null return are not upgraded by this recorder.
The opt-in call resolves `_deliverFault` before argument selection and retains
the CPU receiver. A noncallable override still evaluates the argument and
raises `TypeError` without call credit; its generated error wording may differ
from a native member-call `TypeError`. The disabled path uses the original
member-call expression unchanged.

Returned `_deliverFault` means only that the CPU call returned. It does not
prove the original page fault was serviced, that a handler completed, that a
frame returned, or that the CPU is defective. Source and synthetic controls
need hosted qualification before any separately reviewed connected actual.
