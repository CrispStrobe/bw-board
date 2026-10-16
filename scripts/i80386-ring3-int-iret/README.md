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

The unprivileged preparation functions accept exactly the two frozen authored
input byte strings; they do not generate them or run a tool to do so. They
require the fixed official run and first attempt, exact expected head and tree,
uniform positive invoker IDs, empty supplementary groups and zero capability
fields. A future hosted launch must establish and observe that identity before
preparation: ordinary hosted runner processes may have supplementary groups.
This checkpoint neither assumes that prerequisite holds nor silently performs
privileged setup or adds a tool to establish it.

Preparation creates fresh canonical invoker-owned packet directories and writes
the input originals exclusively. It captures fresh outside PRE Git originals,
freezes the twelve-file source envelope, observes the selected non-setid Python
bytes and four distinct empty owned cgroups with the fixed limits, then rereads
source, inputs, Python and cgroups before writing entry facts last. Every write
is exclusive; an existing directory or earlier original refuses reuse. Failure
preserves available originals, PRE Git bytes and partial observations and cannot
launch a controller. Entry-file presence alone is not a successful preparation
verdict. The file checks and readbacks do not establish a continuous lease,
external QEMU pin or resource sufficiency. Input generation, actual preparation
invocation and the following launch remain separate unconnected work.

The phase-composition source has a fixed preparation-child descriptor using the
observed canonical Python, `-I -B`, this runner and `--prepare`. Its child first
uses the reviewed group and ID drop, verifies the dropped IDs and capability
fields, then reads only `build/i80386-ring3-int-iret-staged/fixture.rom` and
`build/i80386-ring3-int-iret-staged/fixture.json`. The staging directories and
files must be canonical and invoker-owned, and the two inputs must match the
existing authored goldens. Their generation remains separate unconnected work.
The root parent observes metadata and holds transport bytes; it does not read
fixture bytes or parse PRE JSON.

The new internal preparation profile polls against 120 seconds, expects natural
exit zero and retains at most 262,188 stdout bytes and 16 KiB stderr. Existing
guest, discovery and controller profiles and the twenty packet roles retain
their limits. On successful preparation with no error, the dropped child writes
an eight-byte `R3PREv1` plus NUL magic, a four-byte big-endian body length, a
32-byte SHA-256 digest and the unchanged original PRE bytes. Body length is
1 through 256 KiB; exact total length and digest forbid truncation or suffixes.
The write and flush must both succeed. The parent validates only this fixed
binary framing before considering the next phase; semantic PRE validation stays
with the unprivileged finalizer and independent original auditor.

Preparation ownership now observes one fixed sibling of the manual subtree:
`/sys/fs/cgroup/bw-ring3-RUN-1-preparation`, derived only from the official run
and first attempt. The runner does not create it. Its directory and control
files must be root-owned UID/GID zero with no group or world write permission,
and its observed limits must equal the existing one CPU, 1 GiB memory, no swap
and 64 PID profile. The existing four invoker-owned resource roles are unchanged.
A missing, nonempty or mismatched initial object refuses before a child factory;
there is no cleanup of preexisting, unadmitted work.

The root parent holds a NOFOLLOW directory descriptor and keeps its trusted
device, inode and owner binding separate from returned snapshots. Observations
and cleanup open fixed names relative to that descriptor. Before dropping IDs,
the fresh child independently reopens the fixed sibling, matches the captured
binding, writes only its own PID through an anchored `cgroup.procs` descriptor,
verifies sole membership and closes its own descriptor. This avoids assuming
that Popen preserves the parent's descriptor. Git children then inherit the
sibling even when they start separate sessions. The parent must stay outside
both the manual subtree and preparation sibling.

An observed preparation terminal must be followed by original empty hierarchical
`pids.current` and `populated` observations as well as an empty local PID list.
Unknown status, OOM or limit drift and remaining descendants preserve refusal.
Only complete initial-empty admission followed by an own spawn attempt makes
cleanup eligible. The parent can then attempt anchored `cgroup.kill` and bounded
reap/census checks, at most two seconds and 128 iterations. Later cleaned
emptiness never repairs the first failure. Reaped leaders are not signalled or
waited again. The parent descriptor closes once after observation and cleanup;
a close error prevents the next phase, and consumed ownership cannot reopen as
a replacement proof. Partial observations and attempts remain in returned
preparation memory, outside the twenty roles and closed log-original allowlist.

These methods have only run against mocked edges. Separate hosted creation,
original provenance and independent auditing of this internal phase, plus the
15-minute job backstop, remain unresolved activation requirements. Polling
cannot preempt blocking Popen or kernel operations. Neither snapshots nor held
descriptors establish a continuous lease or complete host ownership proof.

Only after those ownership checks does the source composition invoke the
root outside owner. Its original failure object and original PRE bytes pass to
the finalizer after verified invoker IDs and an observed controller terminal.
A missing terminal or failed drop prevents finalizer and POST Git. Failed
preparation prevents outside-owner launch. The original preparation process and
framed stdout and stderr remain available in returned memory, including failure
prefixes, without adding packet files or changing the closed internal-original
allowlist. Publication and independent original auditing of that preparation
phase still require separate admission before an actual event. All composition
controls use inert boundaries. The actual command and workflow remain closed.

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

The unprivileged execution-glue functions now admit the prepared source and
authored inputs, discover the named runtime once, and complete a BEFORE barrier
before creating either guest. That barrier rereads all twelve source files,
both inputs and every frozen runtime file and alias, records the four resource
censuses, and completes its retention writes. The source readback observes
actual file modes, bytes and blob hashes. Its head and tree remain prepared
bindings; it does not run Git or claim a fresh Git observation. Independent
unprivileged Git observations before and after execution still need wiring.

The fixed launch descriptors run ordinary JS first and QEMU second. Process,
retention or terminal-census failure prevents the next guest. The five JS
output files remain untouched originals; the QEMU report joins only original
process and output-digest facts. A finally path attempts all twelve source
reads, both input reads and every frozen runtime file and alias readback even
after guest or retention failure. Partial discovery retains and rereads its
known graph without repeating probes. Changed facts and original stream
prefixes remain available; they do not become a positive packet. The internal
controller facts contain BEFORE observations, not a claim that its own cgroup
is empty after exit. These paths have only run against inert mocked boundaries.

The unprivileged finalizer joins controller-alive BEFORE records with the
outside observer's original `beforeCleanup` snapshots after the controller is
reaped. A positive producer envelope requires natural controller exit zero
within 600 seconds, both terminal censuses empty and no cleanup attempt or
error. Later cleaned emptiness cannot replace a failed original observation.
The caller's in-memory outside failure remains authoritative; entry and
controller errors remain secondary originals, with uncertain cross-phase
ordering stated explicitly. Missing originals or lost caller state refuse a
positive envelope.
Compound JSON joins retain number types; equal-valued integer and float fields
cannot substitute for one another. Original guest intervals must be exact
integers, serial, within 120 seconds each and contained by the original
controller lifetime.

Fresh PRE and POST Git observations remain separate from the controller's
prepared head/tree bindings and its eleven runtime probes. The PRE trace must
already originate before controller creation; the finalizer cannot reconstruct
it afterward. The fixed outside Git adapter has three bounded local descriptors.
The finalizer stages only the twenty fixed roles in a new exclusive directory,
with nineteen string-sorted byte/hash rows in the audit. Existing originals are
never rewritten. Failure leaves available bounded originals and a failure
audit; missing guest results are never synthesized.

Internal entry, controller and outside facts remain outside the twenty-role
artifact. Their exact bytes and the two Git traces use `RING3_ORIGINAL` log
records with base64 payloads of at most 3,072 ASCII characters. Each record binds
the name, index, count, original extent and SHA-256. The five internal names are
closed; entry-failure is optional. Internal files are capped at 1 MiB, each Git
trace at 256 KiB, all raw originals together at 5 MiB, and emitted records
including headers and newlines at 8 MiB. Failed or short emission and failed
flush preserve failure and cannot claim completion. The internal files remain
untouched. A separate original-only job-log auditor and its source/official
joins must be frozen before any event: the packet reader does not grade these
logs or the outer 600-second lifetime. Neither runtime equality nor these
assembler controls externally pins QEMU or establishes a complete host graph.

Preparation invocation, actual entry, finalizer integration, the hosted actual job and
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
