# Materialization-only observation runner

`MaterializationRunner(parent)` owns one fixed-alias materializer instance. Its
one `materialize(toolchain_bytes, djcrx_bytes, djdev_bytes, djlsr_bytes)` attempt
accepts only the inherited four immutable-byte inputs. `status()` returns copied
primitive wrapper facts, `report()` returns a fresh copy of the bounded report
or `None`, and `close()` consumes its close attempt before calling the private
owner. There is no CLI, fetch, subprocess, compiler/tool invocation, caller FD,
callback, expected-pin argument, external receipt adoption or provisioning API.

The fixed-alias module is loaded from one fixed source file, bounded to 64 KiB,
with SHA-256
`7a687a916d65fd6614bb3a3676d2ca32c7f2a375deabc8d690f2ad1bb2e2ccf6`.
Its immutable loader chain admits the selected materializer, observer, workspace
owner, routes, writer and creator. The disabled compiler source has SHA-256
`2a1a3e84a4244100a8f0fe5c8d806d46721425970e4b65b516fdf58fed67b31a`.
Only its source hash and AST are inspected for the unconditional top-level
production refusal after stdlib import declarations and before helper setup.
The compiler file is never imported, loaded for execution or called. This is
an inspected source invariant, not a compiler execution result. External exact
source/live-context admission of this new wrapper is still required.

The wrapper copies materialization and close statuses and at most two privately
issued observer records. Records are serialized afresh by the pinned source
serializer after materialization. They are source-issued report content, **not
captured original evidence-writer bytes**. Each copied record must belong to the
private observer session, with ordered sequence 1/2 and before-probes/failure-final
phases. No after-link or compiler pair is credited. Completion requires exactly two
joined complete nine-role observations, nine ordered writes, four runtime
origin joins, thirteen aliases/eleven targets, two observer attempts/emissions,
and error-free materialization/closed cleanup statuses. Partial packets may
retain zero to two records and cannot qualify completion. A join-refused candidate can
remain in a refused packet for diagnosis; its presence is not admission or
consistency credit. An independent reader must recompute all applicable facts
and distinguish refused or partial records from finite observations.

Each status/record section is at most 32 KiB. The typed copy admits only exact
JSON primitive/container types, unsigned 64-bit integers, ASCII strings/keys up
to 256 characters, 64 entries per container, depth 16 and 4,096 nodes. Status
has a fixed top-level keyset and explicitly false inherited authority flags.
Nested facts are bounded typed copies, not a new complete semantic validator.
The fixed-key packet is capped at 144 KiB. In particular, more than 64 processed
notice hashes causes a truthful evidence-copy refusal; the wrapper does not
truncate notices or claim complete status coverage. No archive, tool-file bytes,
host path, caller FD or reusable authority ticket is returned.

Materialization is attempted once; status/record copying is attempted once and
close is consumed before the call. The first original error object is re-raised
unchanged even when secondary status, close or reporting fails. Published error
facts use fixed bounded codes without raw exception messages. Historical
completed-write prefixes and partial observations remain diagnostic facts.
Output-file, observer-file, evidence-writer and shared-directory close uncertainty
stays visible through copied statuses. A poisoned/reentrant operation may leave
statuses unavailable; `None` is retained rather than fabricated cleanup success.
Busy status/report/close access immediately poisons the active private materializer,
observer and workspace owners; subsequent operations permit cleanup only.
Repeated close or materialization cannot replay the private attempt.

There is **no namespace or permission witness**. Readonly creation and absence
of physical alias writes are fixed-source policy, not measured final-mode or
physical-namespace proof. Both observation flags remain false. Nine output
hash/identity records do not supply the full implicit tool tree or physical
`samefile` aliases. Post-mkdir first observations cannot certify the creating
inode, and immutable input-byte authentication is not a filesystem lease.
GNU/PAX/raw archive compatibility, OS/mount/parent trust, arbitrary mutation of
Python internals, uninterrupted identity and untested allocation faults remain
unqualified. All source-owned, input-lease, compiler, guest and performance
qualifications remain false, even when the wrapper finishes.

Manufactured controls exercise byte authentication, selected-prefix failure,
closed record/session joins, finite copy caps, reentry, original-error preservation
and cleanup uncertainty with temporary filesystem and synthetic archive inputs.
Use Python `-I -B run-control.py`. No actual archive, tool, compiler, Node or guest
is run. Exact-source hosted controls, independent original audit and a separately
reviewed acquisition adapter, frozen reader and launch guard remain later gates.

This revision preserves the failed original and carries bounded first-rule TAR
diagnostics in copied materializer statuses. Packet schema is v2. Acceptance and
compiler refusal remain unchanged; diagnostic facts are source-issued serialized
content rather than original emitted writer bytes or raw archive header proof.
