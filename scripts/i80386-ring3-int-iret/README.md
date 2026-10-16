# Ring-changing INT/IRETD source checkpoint

This MIT-authored fixture targets one 80386 software-interrupt roundtrip from
ring 3 through a ring-0 interrupt gate and TSS stack, then IRETD back to ring 3.
It is a source checkpoint under the
[merged task claim](../../docs/X86-NEXT-LANES.md#ordinary-js-ring-changing-intiretd-fixture).
No guest execution or QEMU comparison has qualified this candidate yet.

`fixture.mjs` builds a deterministic 64 KiB reset ROM without an assembler or
compiler. It exports the ROM identity, symbols, copied memory blocks and record
layout. `probe.mjs` defers the ordinary JavaScript CPU import until explicitly
invoked. Its intended observations cover the instruction before INT80, handler
entry, the instruction before IRETD and the returned ring-3 instruction. A
separate one-way INT81 reporter emits records saved before reuse of the first
interrupt frame.

The defined frame fields, flags, selectors, registers and stack guards have
explicit expectations. Undefined selector padding is retained rather than
assigned an architectural value. Within one execution, the saved frame must
still match the original frame, including its padding. Flag-recording scratch
words are declared writes; adjacent guard bytes remain checked.

Run the pure source controls from the repository root:

```sh
node --test test/i80386-ring3-int-iret.test.mjs
```

These controls generate bytes and exercise manufactured validation inputs.
They do not run the CPU or establish a successful privilege transition.

The independent original-only reader (`reader.py`), packet controls
(`controls.py`) and a controls-only hosted controller (`run.py`) are now source
checkpoints. Run their inert controls with:

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/controls.py
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/run.py --controls
```

The controller has named runtime-discovery functions for executable files,
interpreters, libraries, the i386 TCG module, aliases and selected package data.
The runtime observation policy requires named probes once before guests; later
readback rehashes
every retained file and rereads every retained alias. Package data is a selected
superset, not proof of a complete host graph or continuous file identity.
Process controls use mocked kernel and process edges. They do not run QEMU,
the CPU or guests.

The fixed runtime callback connects the eleven named observations to the process
helpers. Its discovery profile retains at most 16 KiB per stream, expects natural
exit zero and polls against ten seconds. The guest profile remains 120 seconds
and 128 KiB per stream, with the original JS/QEMU exit statuses. Discovery
children inherit the admitted controller cgroup and never enter either guest
leaf. Between probes, that cgroup must contain only the controller process and
both guest leaves must be empty. A refused probe retains its partial process and stream facts;
an unknown exit stays unknown. Tool creation unconditionally resets SIGCHLD to
SIG_DFL before delegating process creation and keeps that disposition through the
child lifetime. A failed reset refuses before creation, and cleanup refuses if
the Python disposition has changed. The selected
[CPython reset implementation](https://github.com/python/cpython/blob/v3.12.3/Python/pylifecycle.c#L2932)
sets sigaction flags without SA_NOCLDWAIT; checking `getsignal` alone cannot
establish that kernel flag. Signalling the fresh, unreaped tool session requires
this reset and a sole controller waiter, with no competing wait or later native
signal-policy changes. Those remain execution-admission conditions, rather than
a continuous host guarantee. Unexpected descendants after the leader is reaped
refuse acceptance and require the outside owner.
These callback paths are covered by inert controls, not actual tool execution.

The same-file privileged-entry functions are also a source checkpoint. They
require trusted positive sudo invoker IDs before validating the fixed run's
internal entry facts, the twelve held source paths, the actual Python bytes,
and four distinct, empty cgroup identities with the fixed resource limits.
The checkout and both packet directories must be canonical and owned by that
invoker before facts are read. Duplicate or nonfinite JSON fields refuse entry;
the two kernel observations use capped reads with first-error preservation.
Root performs only bounded file observations and one self-migration into the
controller leaf. It clears supplementary groups, drops all real, effective and
saved group and user IDs, then requires zero CapInh, CapPrm, CapEff and CapAmb.
Membership and dropped IDs are checked again before the fixed isolated Python
exec. No Git command, runtime probe, archive operation or guest runs privileged.
An early failure can be retained only after dropping to the checked sudo
invoker; unknown invoker IDs, a failed drop or failed retention may leave only
the bounded original-error diagnostic. Internal entry preparation and failure
files are not additional packet roles. Actual-method controls mock every
privilege, cgroup, process and file boundary; they do not perform a real drop or
migration.

The outside-owner functions are a further source/mock checkpoint. The root
observer stays outside the manual subtree and launches only the held Python
entry child. That internal controller profile retains at most 16 KiB per stream,
expects natural exit zero and observes a 600-second total lifetime. An already
reaped result observed after its budget refuses acceptance without signalling
that PID. Guest and discovery budgets and stream caps are unchanged.

The wrapper always attempts terminal observation and cleanup, including after
controller errors. Original PRE-cleanup nonemptiness or observation failures
remain failures even if cleanup later reaches emptiness. Only a held unreaped
session may receive a process-group signal under the admitted wait policy.
Enclosing cleanup opens a directory descriptor, checks its admitted identity
and owner, then opens `cgroup.kill` relative to that held descriptor. Observation
and reap polling use both a two-second deadline and a 128-iteration cap. Partial
facts and unknown terminal status survive failures. These are bounded cleanup
attempts, not a guarantee that every operation succeeds or returns promptly.
The observer drops privileges before retaining its internal facts and opaque
stream prefixes; it does not parse guest output, run probes or build archives.
Genuine empty snapshots taken after controller exit can supply the final
reader's terminal observations once packet assembly is connected.

Entry preparation, actual entry, packet finalization, the hosted actual job and
results remain unconnected. Polling cannot preempt blocking kernel operations,
process creation or identity reads. The 15-minute job backstop is not wired at
this checkpoint, and no real outside-owner lifecycle has been qualified.
The actual command refuses to run at this checkpoint. Remaining implementation
stays within the existing nine-path claim. Before any actual event, freeze the
complete source/input/runtime graph,
independent expectations, finite resource and output bounds, original roles and
separately observed QEMU binary/package identity. QEMU's version requirement
alone does not identify the executable. Admit one hosted event only after its
source checks and execution plan pass review; preserve failures and acquire
each official original once before independent audits.

This fixture does not establish hardware IRQ delivery, paging, task switching,
general DPMI or protected-application compatibility. CPU or device repairs need
their own reviewed ownership scope.
