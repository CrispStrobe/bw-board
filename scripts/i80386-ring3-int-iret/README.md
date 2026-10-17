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
the name, index, count, original extent and SHA-256. The five internal file names are
closed; entry-failure is optional. One additional closed log name,
`preparation.phase.json`, is an in-memory original, never a packet file. Each
internal file and this preparation record is capped at 1 MiB, each Git trace
at 256 KiB, all raw originals together at 5 MiB, and emitted records
including headers and newlines at 8 MiB. Failed or short emission and failed
flush preserve failure and cannot claim completion. The internal files remain
untouched. A separate original-only job-log auditor and its source/official
joins must be frozen before any event: the packet reader does not grade these
logs or the outer 600-second lifetime. Neither runtime equality nor these
assembler controls externally pins QEMU or establishes a complete host graph.

The preparation log record uses `bw.ring3.preparation-original.v1` with the
closed fields `schema`, `runId`, `attempt`, `head`, `tree`, `python`, `invoker`,
`captureMonoNs`, `process`, `stdout`, `stderr`, `ownership`, `preGit`,
`firstFailure` and `secondary`. Each stream retains its exact raw prefix as
base64 with its byte extent and SHA-256; `preGit` is the extent/hash reference
to the original decoded frame body. The record freezes immutable canonical
bytes immediately after the ownership finish and descriptor close, before
outside controller creation. Later changes to returned dictionaries cannot
replace those bytes. Failed phases retain null or partial originals and their
original error rows; encoding or cap failure prevents the next phase.

The composition requires its own frozen record. Its unprivileged finalizer
joins the fixed Python, source, run, invoker, descriptor, parent PID, frame and
root-owned sibling facts. The three original PRE Git children are serial and
contained in the preparation lifetime, at most ten seconds each. Preparation
is at most 120 seconds; its terminal time precedes capture, which precedes the
outside controller spawn. Equal monotonic timestamps are allowed. The root
parent only decodes binary framing, never PRE JSON or guest bytes. Failure-only
log emission requires a verified privilege drop and preserves the original
failure through emission or flush faults. Standalone finalizer controls may
omit this optional argument; composition and the new independent original
admission require it. The packet reader and twenty roles stay unchanged.

These source controls do not admit the sibling identity or the preparation
record as their own expected external facts. A separately frozen standalone
original auditor must join independently observed source, Python, invoker,
root-owned sibling device/inode, official job and new preparation log record
before any actual event. Earlier V4 originals and their readers remain
unchanged; new phase provenance, hosted setup and the job backstop still need
admission. No actual launch was enabled by this log-only addition.

A separate source-only `stage_preparation_inputs` callable can generate the
free authored fixture inside an already dropped preparation child. It is not
called by `preparation_child` or any actual command. It first checks all dropped
IDs/groups/capabilities and exact sibling membership, then requires canonical
invoker-owned checkout, build and precreated staging directories without group
or world write permission. The bounded directory scan stops at its first entry;
initial nonempty or ambiguous paths refuse before a child factory or output
read. The two fixed output paths are
`build/i80386-ring3-int-iret-staged/fixture.rom` and `fixture.json`.

The fixed Node descriptor imports only the held `buildFixture` and Node's
filesystem/path builtins. It uses numeric `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`,
checks regular descriptor ownership and extents, checks complete writes and
closes each file once. It writes the 65,536-byte ROM and canonical sorted
metadata JSON with a final newline. No overwrite, deletion or retry repairs a
partial output. The existing discovery profile supplies ten seconds and
16 KiB per stream, with natural zero exit and empty streams required. The Node
child inherits the preparation group even with a new session; the outside
preparation owner remains responsible for terminal descendant observations.

After an own spawn attempt, the Python callable attempts both bounded output
readbacks independently, checking ownership, regular files, symlinks, extents
and the existing ROM/metadata goldens. It adopts the original process failure
before output or identity-readback errors. It retains original process and
stream prefixes, available output bytes/hashes and all attempted Node, fixture
and runner identity observations before and after generation in result memory.
The Python controls include static writer assertions. A separate seven-case
inert VM audit executes the writer body with fake filesystem and fixture-builder
interfaces: canonical outputs, partial writes, exclusive creation, ownership,
parent redirection and primary/close errors. Two deliberately broken writer
variants fail those controls. This does not execute the real fixture builder or
real filesystem generation, or qualify the selected Node runtime. A JavaScript
close error does not replace an earlier error in source, but complete
serialization of secondary errors is not guaranteed by uncaught stderr printing.

Those observations are not external source or executable pins. The later PRE
Git capture cannot prove the source used earlier by generation. Generator
process/stream provenance still has no admitted transport in the PRE-only frame
or V5 log record, and V5 does not grade this in-memory result. Frozen external
Node/source-before-generation admission, a retained generator-original channel,
staging-directory setup and independent joins remain required before wiring
this callable into preparation. The existing twenty packet roles, V5 record,
limits and old preparation defaults stay unchanged. There is no filesystem
lease, hard preemption of blocking calls or actual staging qualification.

An additional unused generated-preparation adapter now carries these facts as
original bytes. The old preparation callable, PRE frame, phase-v1 record and
V5 reader remain unchanged. The new descriptor is fixed to the same Python
with `-I -B scripts/i80386-ring3-int-iret/run.py --prepare-generated`; no actual
command dispatches it yet. Its root parent only validates binary framing and
retains opaque bytes, never generator or PRE JSON.

The new frame has eight-byte magic `R3GENv1\0`, a four-byte big-endian body
extent and a 32-byte SHA-256. Its body contains two four-byte big-endian lengths,
then the immutable generator record and unchanged original Git PRE bytes.
The generator record is at most 128 KiB, PRE at most 256 KiB, and their combined
body including both lengths is at most 256 KiB. Both maximums need not fit
simultaneously: an oversized combination refuses. The existing 262,188-byte
stdout, 16 KiB stderr and 120-second preparation profile are unchanged.
Short writes, failed flushes, extra suffixes or extent/hash errors refuse.
Failed generation can retain a complete generator record with zero PRE bytes;
it cannot start the outside controller. Raw escaped prefixes and available
in-memory originals remain retained, without reconstructing missing records or
claiming that an over-cap or incomplete channel delivered every original.

`bw.ring3.generation-original.v1` has the closed fields `schema`, `runId`,
`attempt`, `head`, `tree`, `invoker`, `captureMonoNs`, `process`, `stdout`,
`stderr`, `before`, `after`, `outputs`, `firstFailure` and `secondary`.
Streams use the original extent, SHA-256 and base64 representation. `before`
and `after` are closed `{monoNs, files}` objects; their clocks are taken after
all respective identity reads. Files are exactly `node`, `fixture` and `runner`,
with path, byte extent and SHA-256. Outputs are the two fixed fixture names
with original extents and hashes; partial subsets are failure-only facts.
The generator record freezes after staging output and identity readbacks,
before PRE Git begins. The log-only name `generation.phase.json` carries those
same bytes, never a packet file. The new preparation-v2 record keeps the same
fifteen fields and binds the actual combined stdout. Its unprivileged joins
require both original records; caller dictionaries cannot replace them.

The positive time chain is preparation spawn, before-identity completion,
generator spawn/reap, after-identity completion, generator capture, three serial
PRE Git children, preparation reap, phase capture, then outside-controller spawn.
All times are exact integers and equality is allowed. Generator and preparation
limits remain ten and 120 seconds. Generator parent PID must be the live
preparation PID; it cannot equal that parent or the known-live root owner PID.
This does not require unique PIDs across separately reaped children.
The finalizer joins original output references to retained packet inputs and
Node/source observations to other retained originals. These are consistency
joins, not independently expected prelaunch pins. A separate V6 original-only
reader must receive independently admitted Node/source facts. The later PRE
capture cannot establish what source was used earlier by generation.

The new log name adds no artifact role or internal file: twenty packet roles
and five internal names remain fixed. The 5 MiB raw, 8 MiB encoded and
3,072-character chunk bounds also remain fixed. Failure-only emission requires
verified dropped identity; an unsuccessful drop never authorizes it. The
caller-owned failure remains authoritative, separate from generator error
rows. Mocked source controls include full coherent freeze/frame/finalizer/log
joins, but no actual generator, child, resource operation or guest has run.
Trusted external source/runtime-before-generation admission, actual setup,
retained-original audit admission and workflow/backstop wiring remain closed.

An additional `PinnedRecordingStagingOps` subclass is an unwired
identity-comparison primitive. Its required arguments are separately retained
canonical `bw.ring3.source.v1` bytes, their independently selected SHA-256, and
the independently selected reviewed Git head and tree. Missing, malformed,
noncanonical or mismatched arguments refuse before a child factory. The
manifest has exactly the existing twelve source paths, with closed, typed
byte-extent, SHA-256, Git blob and regular-mode facts. It stores immutable
original bytes and reparses them for comparisons; mutable public observation
dictionaries cannot replace that admission.

Before the generator factory, this subclass reads every named live source
file, checks canonical owned regular paths and compares modes, extents,
SHA-256 and Git blob hashes against the manifest. It then joins the existing
fixture and runner observations to that same manifest and checks the existing
Node observation against the separately admitted selected-file fingerprint:
Node 22.23.3, 124,827,920 bytes, SHA-256
`fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48`.
That fingerprint originates in the retained, independently audited
[CLI646 original](https://github.com/CrispStrobe/bw-board/actions/runs/38937680307).
The existing before clock follows these comparisons. After-generation
observations repeat the comparisons, preserving generator errors ahead of
readback errors and attempting all twelve source reads after individual file
failures. Partial source facts remain available in memory.

This performs no fresh pre-generation Git capture: the head and tree are
external admission labels. The existing generator original still serializes
only Node, fixture and runner observations, so it cannot independently prove
all twelve live source observations at that before boundary. Full twelve-file
facts and errors are not added to its schema or exported as a new original.
The separate original-only reader must retain the independently admitted
source manifest and runtime expectation. A caller that selects both a changed
manifest and its matching digest/head/tree can satisfy this comparison
primitive; authenticating those selections requires the separately reviewed
external event plan. No actual command supplies that trust origin yet.
The default staging and generated-preparation adapters, twenty packet roles,
five internal names, stream/log caps and actual-command refusal are unchanged.
Nine additional inert controls cover the comparison primitive, including the
caller-selected coherent-manifest limitation; the complete runner suite has
160 controls. No actual generator, resource or guest ran.

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
