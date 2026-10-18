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

A separate, unused `AdmittedGeneratedEntryComposition` now carries an
independently selected launch-plan SHA-256 to a dropped preparation adapter.
Its required digest argument must originate in the separately reviewed event
plan. Root first captures opaque bytes from the fixed path
`/run/bw-ring3-RUN-1-admission/launch-plan.json`, derived only from the official
first-attempt run. Root checks the selected digest before child construction
and preserves those immutable bytes; it parses neither plan, GEN nor PRE JSON.
An attempt guard is consumed before the first root check or read, so neither
successful capture nor a refused first read can be retried on that instance.

Both parent and child readers require canonical root-owned ancestors outside
the checkout, without group or world write permission. The final file must be
root-owned, regular, mode `0444`, single-link and within the existing 1 MiB
JSON cap. An `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` descriptor binds each reader's
before and after file-identity, extent, ownership, mode and link-count checks;
path and ancestor identities are checked again before close. Each reader
checks its own observations. The two readers are joined by exact pinned bytes,
with no claim that they held the same inode or a continuous filesystem lease.
These metadata checks are not serialized as independent original observations.

The canonical `bw.ring3.launch-plan.v1` original has exactly `schema`, `runId`,
`attempt`, `head`, `tree` and `source`. Its source object has exactly `bytes`,
`sha256` and canonical `base64` containing the original canonical twelve-file
source manifest. The whole plan stays within 1 MiB, including that encoding;
an oversized combination refuses. Run, first attempt, head and tree join the
descriptor's independently available environment. The source manifest must be
prepared from the final reviewed committed revision after source work ends;
an earlier checkpoint is not an automatic runtime selection.

The new descriptor uses `--prepare-admitted-generated` and adds only
`BW_LAUNCH_PLAN_SHA256` to the held preparation environment. Its explicitly
versioned `bw.ring3.preparation-original.v3` retains the same fifteen fields.
The child validates its actual expected dropped IDs, supplementary groups,
capabilities and preparation-sibling membership before reading or decoding the
plan. It reopens the fixed readonly file, checks the independently delivered
digest and event/source joins, constructs `PinnedRecordingStagingOps`, then
calls the existing generated-preparation adapter. GEN v1, its bounded frame,
generator command and later PRE originals retain their existing formats.

After verified privilege drop, the finalizer joins the parent's retained plan
original and independent digest to the v3 environment, exact packet source
original, generator observations and fixed selected Node fingerprint. It emits
the exact plan bytes as log-only `launch-plan.original.json`. Failure-only
emission also requires verified drop and preserves the original failure.
The same 5 MiB raw, 8 MiB encoded, individual JSON and chunk caps apply. There
are still twenty packet roles and five internal names; the plan is not an
artifact file. The v2 default and existing controls remain unchanged. Ten
additional inert controls exercise this delivery slice, for 170 runner controls.

The held original-only V6 policy rejects v3; a separately admitted reader
revision must receive the external plan digest and source/runtime expectations
and grade all retained originals before any actual event. A constructor
argument or root-owned file alone does not establish approval or event origin.
External installation of the exact reviewed plan and independent digest
selection remain pending. Actual internal-mode dispatch is disabled, as is the
actual launcher. No real plan-file read, privilege change, child generation,
resource operation or guest ran in these controls. Bounded read loops cannot
preempt blocking kernel calls; the separately reviewed job backstop is still
required.

The fixed CLI now recognizes exactly one of eleven modes, without option
abbreviations. The static source constant `ACTUAL_ENTRY_ENABLED=False` refuses
every mode except `--controls` before reading its environment, checking IDs,
constructing a handler or opening a resource. Neither a plan field, command
argument nor environment flag enables it. Activation requires a separately
reviewed source and hosted-workflow change. `main` propagates the dispatch
status through `SystemExit`.

| Mode | Entry boundary and result |
| --- | --- |
| `--controls` | Runs inert controls and returns zero only after they pass. |
| `--prepare-admitted-generated` | Requires the actual dropped invoker in the preparation sibling; stdout contains only the existing original GEN/PRE frame. |
| `--bootstrap` | Starts as root, validates entry facts, migrates itself into the controller leaf, drops IDs/groups/capabilities, then executes the fixed `--controller` descriptor. Any return from bootstrap is failure. |
| `--controller` | Starts dropped in the controller leaf; requires both complete local capture facts and an empty authoritative failure object. |
| `--controller-runtime-admitted` | Explicit dropped controller selection. Gates the complete selected stable runtime before probes, retains process originals and rereads the superset after probes and guests. |
| `--prepare-runtime-admitted` | Starts dropped in the preparation sibling; joins the plan to the prior request and gates the full selected runtime before fixed Node generation and after PRE capture. |
| `--bootstrap-runtime-admitted` | Starts as root; validates entry/request/source, migrates, drops IDs and executes the runtime-admitted controller with the prior request pin and no SUDO fields. Any return fails. |
| `--hosted-actual` | Performs fresh fixed setup, admitted preparation, outside observation and dropped finalization. Its external event and runtime authority remain pending. |
| `--install-hosted-envelope` | Disabled input-installation scaffold. Even complete installation returns nonzero before resource setup or guests because independent runtime, observer and reader gates remain pending. |
| `--hosted-prerequisites` | Disabled installation/setup/independent-observer/dropped-collector path. Its new reader can admit prerequisite observations only; missing full runtime admission still returns nonzero before preparation, probes or guests. |
| `--hosted-runtime-actual` | Disabled complete V8 source route: actual-job request admission, stable runtime gate, fresh setup, independent observer, versioned execution, outside terminal collection and dropped standalone execution reader. Official qualification is separate. |

Preparation and hosted success require `pass` to be the boolean `true` and
the same authoritative `FirstFailure` to have neither primary nor secondary
errors. Controller success also requires both guest process roles and source
and runtime readbacks. No internal mode prints a separate success JSON.
Failures return nonzero and attempt only a bounded 16 KiB stderr diagnostic;
existing original-byte channels keep their existing semantics.

The unused `HostedSetupOps` adapter establishes the trusted positive invoker
before fallible setup, then captures the opaque independently pinned plan
before mutations. It creates the fixed staging directory exclusively under a
canonical invoker-owned checkout/build directory. Existing packet, export or
staging paths refuse. A missing build directory can be created and assigned to
the invoker; an existing build directory is checked without changing its owner.
It creates only the run-specific manual cgroup, its controller/JS/QEMU leaves
and the separate preparation sibling. Creation and control access use held
directory descriptors; descriptor closure is attempted once, including failures.

The shared hierarchy parent must already expose and enable `cpu`, `memory`
and `pids`. The adapter never writes or changes ownership of shared parent
controls. It enables those controllers only in its new empty manual root,
sets the existing four limits on all five new resource groups, then reads back
limits, empty membership, population, domains, owners, filesystem and distinct
directory identities. Domain checks apply to every new non-root group; the
hierarchy root need not provide `cgroup.type`.

Manual cgroup directories belong to the invoker, while limit files and subtree
controls remain owned by root. Delegation changes ownership of only five
fixed files: manual-root `cgroup.procs`, plus `cgroup.procs` and `cgroup.kill`
in each JS/QEMU leaf. Common-ancestor migration permission follows the
[kernel delegation contract](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html#delegation-containment).
Kernel file modes are preserved, including a write-only `cgroup.kill`; kill
contents are never read. Controller migration remains privileged, discovery
children inherit its membership, and preparation directories and controls
remain owned by root. No recursive ownership change occurs.

`HostedEntryComposition` verifies setup identities and limits again before
composition, preparation and outside observation. It reuses the same opaque
parent plan capture instead of acquiring it again; the dropped child still
performs its own fixed-path read against that selected digest. A setup attempt
is consumed before validation or reads, and a failed later readback invalidates
the setup. No repaired path or fresh failure object revives it. Failure does
not adopt, kill, delete or retry existing resources. Created paths and partial
control/readback facts remain in the returned in-memory setup result, including
failure after a verified invoker drop. They are not a new original or packet
role and do not independently establish actual installation or ownership.

The preceding source checkpoint added ten inert controls, bringing its total
to 180. They drive the fixed
CLI through mocked setup, opaque-plan reuse, preparation framing, outside
observation and dropped finalization; separately they exercise the actual
bootstrap exec boundary and dropped controller glue. The hosted CLI chain
replaces `outside_controller` and `finalize_packet` with finite stubs, checking
routing and the dropped handoff rather than their implementations. The prior
170 method controls and earlier nine-group V7 interoperability audit remain
separate evidence. The fake hierarchy root
omits `cgroup.type`, and fake kill files retain mode `0200`. No real setup,
controller, Node generation or guest ran. Independent expected preparation
identity, hosted installation evidence and full event/runtime admission remain
pending. That checkpoint left the controls workflow unchanged. The installation
scaffold below now declares a disabled 900-second job; its backstop remains
unqualified until a separately admitted actual invocation.

Actual invocation and guest qualification remain unconnected. Polling cannot
preempt blocking kernel operations, process creation or identity reads, and no
real outside-owner lifecycle has been qualified.
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

The disabled hosted-envelope installation scaffold adds one internal mode,
`--install-hosted-envelope`. The workflow job has a literal false condition and
a 15 minute timeout; `ACTUAL_ENTRY_ENABLED=False` refuses this mode before any
environment, identity, event, network or filesystem edge. Neither environment
variables nor command arguments enable it. No official label is consumed by
these source controls. Thirteen added inert methods bring the total to 193; they
exercise request/event admission, immutable transport, live source binding,
exclusive installation, partial failures and the disabled sixth CLI mode.

Its closed `bw.ring3.approval-request.v1` original contains `schema`,
`repository` (`CrispStrobe/bw-board`), integer `pullRequest`, `head`, `tree`,
`source` (canonical source12 original with `bytes`, `sha256`, `base64`) and
`runtime`. The runtime descriptor has exactly `commit`, `tree`, `path`, `blob`,
`mode`, `bytes`, `sha256`; its fixed root path is
`ring3-runtime-expectation.json`, its mode is `100644` and its maximum size is
256 KiB. A future independently reviewed public input commit must supply that
complete runtime expectation. The retained historical QEMU fingerprint alone
does not supply the shared library, TCG, data, alias or tool graph.

The immutable labeled PR event body carries exactly one block beginning
`<!-- BW_RING3_ACTUAL_REQUEST_V1` followed by a newline, a canonical one-line
original wrapper (`bytes`, `sha256`, `base64`), another newline and
`BW_RING3_ACTUAL_REQUEST_V1 -->`. The source checks the owner actor, own
repository, open PR number, head, label, first run attempt and platform job and
workflow observations. It never fetches a moving PR body. The separately
supplied `BW_RING3_APPROVED_REQUEST_SHA256` comes from an Actions repository
variable. Its presence is not independent approval: before any future label,
external operator review must retain its exact selected value together with
the request, source, runtime and event expectations. An independent original
reader must receive that prior pin and join the eventual official event, job
and configuration. Run ID, workflow SHA and job name are later observations;
they are not invented pre-event approvals or numeric job IDs.

Before network access or installation, the installer checks all twelve live
source bytes, modes and Git object IDs against the request and checks actual
HEAD/tree. The standard library HTTPS adapter uses only fixed public Git API
commit/tree/blob routes in the owned repository, without caller credentials,
proxies, redirects, moving refs or retries. It admits commit/tree and unique
regular blob metadata before reading the blob once. Both the Git blob SHA-1
and the externally pinned SHA-256 must match. Installer Git uses a canonical
invoker-owned checkout, one command-scoped `safe.directory`, a fixed environment
and `GIT_NO_LAZY_FETCH=1`; it writes no Git configuration. The successful
installation record retains exact API and source-command originals and event
identity observations. Partial failure facts remain in memory; the CLI emits
only failure diagnostics, so an outside failure-original collector remains an
activation requirement. Socket timeouts do not establish a hard total deadline.

The root installer treats runtime bytes as opaque input; it does not execute
probes or self-admit a runtime policy. It exclusively creates
`/run/bw-ring3-<run>-1-admission/` and installs `request.original.json`,
`event.original.json`, `runtime-expectation.json`, `launch-plan.json` and
`installation.original.json` as root-owned, single-link, `0444` regular files.
Held-descriptor and path metadata plus byte/hash readbacks are checked. The
`bw.ring3.installation-envelope.v1` record describes this installer; it is not
an independent resource observation or a cross-process inode lease. Errors
preserve partial facts, with no overwrite, adoption, cleanup or retry. The
dynamically formed plan retains `bw.ring3.launch-plan.v1`; its digest provides
delivery integrity, while the separately reviewed request digest supplies the
external identity selection. Existing phase.v3, V7, packet roles and caps stay
unchanged. These new prerequisites are not silently accepted by V7 or emitted
as a qualified original bundle.

The legacy install-only endpoint still returns failure before resource setup.
The prerequisite endpoint below connects independent observation and collection.
The later V8 source route adds stable runtime admission and closed execution
delivery. Independently reviewed runtime inputs, official event/API joins and
one authorized hosted run remain required. The disabled 15 minute job supplies
no measured backstop or guest qualification.

`--hosted-prerequisites` connects the admitted input installer to fresh
`HostedSetupOps`, then launches the separate fixed command
`/usr/bin/python3 -I -B scripts/i80386-ring3-int-iret/reader.py --observe-hosted-setup`.
The observer imports no producer and implements its own readonly OS access.
It reads the five installed originals, all twelve live source files, the
already-enabled parent controllers and all five resource directories. Its
`bw.ring3.setup-observation.v1` output records exact control strings and compact
stat arrays ordered as device, inode, mode, UID, GID, links, size and modification
nanoseconds. Ordinary files use bounded nofollow reads with held/named identity
readback. Write-only `cgroup.kill` uses `O_PATH` and metadata only. Membership
comes from bounded proc descriptors and rejects noncanonical path components.
Control files close immediately; mocked peak ownership is eleven descriptors,
within the existing 64-descriptor limit. Child stdout retains its existing
16 KiB discovery cap; overflow preserves only a bounded failure prefix and
cannot become positive observation evidence.

After the observer, the parent irreversibly drops all real/effective/saved
UIDs/GIDs, supplementary groups and capabilities before creating the exclusive
`build/i80386-ring3-int-iret-prerequisites/` directory. It writes the captured
originals as invoker-owned `0400` files. A second fixed command, the same Python
and reader with `--admit-hosted-prerequisites`, validates the actual dropped IDs,
capabilities, outside membership and held readonly input files before parsing.
The independent reader joins the externally selected request digest, immutable
event and plan, installed-input identities/hashes, live source12 and all resource
caps/delegations. It derives the preparation identity from the separate observer,
never from setup code's memory facts. This new
`bw.ring3.prerequisite-admission.v1` verdict explicitly says
`guestQualified=false` and `runtimeAdmitted=false`.

Exact child process/stream originals and partial setup/installation facts use
new prerequisite schemas. Publication occurs only after verified drop, with
the separate `RING3_PREREQUISITE` log prefix. Original names are the five
installed input names plus `setup.observer.json`, `prerequisite.outer.json` and
`prerequisite.reader.json`; they are neither the twenty artifact roles nor the
five old internal names. Existing JSON, aggregate 5 MiB raw, 8 MiB encoded and
chunk caps remain fixed. Partial writes/flushes refuse without retry. Earlier
errors survive observer, drop, collection and retention errors. If the invoker
is unknown or drop fails, raw partials remain in the returned memory result;
the CLI can emit only bounded failure diagnostics, never root originals or an
invented successful collector record. Setup/installation failures keep partial
created paths and observations; they cause no adoption, deletion or cleanup.

An offline original-only reader can independently audit the retained new log:

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/reader.py \
  --prerequisite-log retained-prerequisites.log \
  --external-admission reviewed-prerequisite-expectation.json
```

The external `bw.ring3.prerequisite-expectation.v1` object contains exactly
`schema`, `runId`, integer `attempt` (one), `head`, `tree`, `requestSha256` and
`invoker` (UID/GID array). The request pin must come from the separately retained
pre-label review; the source path transports that pin and later platform/invoker
observations, but does not authenticate their official origin. The reader
checks both original process descriptors, their causal order, fresh identities
and exact verdict bytes. It does not import producer code, replay guests or
silently extend the older artifact/V7 predicates.

The new controls run without the Node ROM builder:

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/controls.py --prerequisites-only
```

At the prerequisite checkpoint, five added runner methods brought the total to 198, preserving all prior 193
test bodies. Five independent methods cover readonly observer/file access,
dropped admission, rehashed conflicts, log framing and failure boundaries.
Seventeen targeted source mutations are detected. The
coherent runner path exercises the actual bounded collector, drop and retention
adapters and independent admission over the retained bytes; installer/setup and
process creation/kernel edges are manufactured, separately tested endpoints.
It is source routing evidence, not actual root setup, process execution or guest
qualification. Both prerequisite activation guards remain false. No runtime expectation is
auto-admitted, and the path always stops before preparation/probes/guests until
the complete independently reviewed runtime graph and closed execution delivery
are connected.

The additive runtime gate uses canonical `bw.ring3.runtime-expectation.v1`
bytes, whose digest must be selected through the separately reviewed request.
Its exact fields are `schema`, `platform`, `executables`, `versions`, `files`,
`aliases`, `packages`, `packagePaths` and `probes`. Each file binds bytes,
SHA256, POSIX mode and its runtime role; aliases bind literal link text and
resolved target. The three engines, five package records and eleven fixed
probe descriptors remain closed. Historical Node and QEMU bytes and QEMU
package version must match before any metadata tool executes. Missing or
changed expected bytes cannot be admitted from the controller's own discovery.

`RuntimeExpectationGate` reads every externally selected file and alias before
constructing a discovery/probe factory, then rereads the entire superset after
probes and after guests. Attempts are consumed even on failure. Partial facts
and first errors survive refusal. Every runtime.v2 file, alias and probe must
join the selected graph, including all engine/tool/package files. The superset
also covers the explicit Python module/import union and mapped libraries for
the launcher, observer, reader and controller. It is a selected runtime boundary,
not an attestation of the whole host. Existing file, alias, stream and time caps
remain fixed; a census exceeding them refuses.

The standalone reader implements the stable expectation independently, without
producer imports. Its new explicit stable-policy entry preserves the existing
runtime.v2 raw predicates and default original equality. Raw `ldd` streams stay
originals; independently parsed paths join the pinned graph, while ASLR addresses
are not portable identity pins. The guarded V8 route below connects preparation,
bootstrap, finalizer and independent original-reader delivery.

A separate metadata-only `runtime-inventory` job and reader endpoint
`--inventory-runtime` provide a concrete candidate acquisition path. The
metadata-only job literal and `INVENTORY_ENTRY_ENABLED` switch are enabled.
The closed label and separately reviewed request pin are still required;
actual execution remains disabled.
The job has a literal 15 minute timeout, uses the existing fixed checkout and
Node setup actions, and installs no QEMU or fallback packages. It runs without
sudo, resource creation or guests. A historical tool mismatch refuses before
executing that tool. Readonly parent-controller availability is retained;
missing enablement remains an actual-run blocker and is never repaired here.

Before any event, the operator must separately freeze the exact value transported
by `BW_RING3_INVENTORY_REQUEST_SHA256`. The immutable labeled-event body carries
one `BW_RING3_RUNTIME_INVENTORY_V1` block containing a canonical bytes/SHA256/base64
wrapper. Its `bw.ring3.inventory-request.v1` has exactly `schema`, `repository`,
`pullRequest`, `head`, `tree`, `source` and `selected`; `source` is the independently
reviewed twelve-file manifest and `selected` contains the fixed Node/QEMU paths,
lengths and hashes. The owned repository, authorized actor, nonfork PR, label
`x86-ring3-runtime-inventory`, run attempt one and platform/workflow context are
closed. The variable transports a prior selection; its mere presence supplies
no approval. Live source bytes, modes and Git blob IDs must match before probes.

Inventory retains original event/request bytes, file metadata, the bounded raw
Python maps census, the selected Python file census, and all eleven bounded
metadata process/stream originals. Process capture checks a fresh direct session
leader, preserves terminal status and partial errors, and never signals a reaped
leader. Its loop does not preempt blocked spawn or kernel operations. The
separately reviewed job deadline remains necessary. The new three-original
`RING3_RUNTIME_INVENTORY` log uses the existing JSON/raw/encoded/chunk caps and
cannot be interpreted as the old twenty-role packet or V7 admission.

The offline command is:

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/reader.py \
  --runtime-inventory-log retained-inventory.log \
  --external-admission reviewed-inventory-expectation.json
```

Its external `bw.ring3.inventory-expectation.v1` contains exactly `schema`,
`requestSha256`, `runId`, `attempt`, `head`, `tree`, `workflowSha`,
`workflowFileSha256`, `jobId`, `jobName`, `conclusion`, `logBytes` and `logSha256`.
The operator separately admits official event/job metadata and the acquired log
before using this reader. A positive verdict says `candidateReviewed=false` and
`actualRunApproved=false`: a later independent review must select the resulting
stable inventory and publish its immutable owned-repository input before an
actual request can refer to it. Inventory acquisition is not automatic approval.

Seven additive runner methods bring the total to 205, with the prior 198 bodies
held. Seven independent runtime methods exercise the real gate, readonly file
backends, fixed metadata process capture and entry-to-log reader over mocked OS
edges, including coherent callback replacement, ASLR changes, rewritten census
and process conflicts, cap failures and pre-tool historical mismatch. Run them
without the Node ROM builder using:

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/controls.py --runtime-only
```

Seventeen targeted runtime gate/inventory mutations are detected, including
pre-factory hashing, graph joins, retained mismatch facts, repeated observation,
raw maps/census/process joins, stream caps and no signaling after leader reap.

The complete approved runtime graph is still absent. Separately reviewed
inventory and actual events remain required.
No inventory event, runtime probe, resource operation or guest execution is
qualified by these inert controls.

The disabled `actual` job now selects the concrete V8 route. It has its own
fixed Node setup step, using the existing action commit and version. The
repo-existing upload-artifact commit `ea165f8d65b6e75b540449e92b4886f43607fa02`
retains only the existing export directory as `i80386-ring3-int-iret-originals`,
with hidden files excluded, one-day retention and missing files treated as
error. It runs even after an earlier step fails: an absent export remains an
upload failure, never an invented complete packet. The literal 15 minute
budget includes setup and upload. Job and source activation guards remain false.

`RuntimeInstaller` admits only the closed `actual` job; legacy installer
selection stays unchanged. Root validates the prior request/source/runtime
bytes and gates the entire stable graph before setup/preparation factories.
Fresh setup precedes the independent observer, whose terminal must precede
preparation. A fresh runtime-original sibling directory uses held nofollow
directory descriptors and descriptor ownership assignment, with no recursive
ownership changes, adoption, deletion or retry.

Dropped preparation checks actual IDs before JSON, joins the delivery plan to
the prior request source, gates the entire selected runtime before fixed Node
generation and rereads it after PRE. The bootstrap preserves root migration,
drop and exec order. Its clean controller environment deliberately adds the
prior request digest and removes SUDO fields. Root retains GEN/PRE as opaque
bytes. Phase.v4 records the new descriptor; phase.v3 and V7 stay separate.
Controller runtime originals retain all eleven process records and terminal
censuses, plus full readbacks before probes, after probes and after guests.
Runtime.v2 raw equality and existing architecture predicates remain fixed.

After genuine controller terminal observations, the outside owner drops before
retaining or decoding originals. The collector records actual UID/GID,
capability and membership observations, platform event/job/workflow context,
first errors and partial setup/installation facts. Unknown invoker or failed
drop keeps partials in memory and cannot publish root originals. Publication
does not retry a failed drop. The prerequisite reader derives preparation
identity from the independent observer. A second fixed dropped process invokes
reader.py `--admit-hosted-runtime`, reads closed readonly original and packet
rosters through bounded descriptors, and checks the complete V8 chain. Its
verdict distinguishes `guestPredicatesObserved=true` and `officialQualified=false`.

New runtime originals use separate sibling sinks. The
`RING3_V8`/`bw.ring3.execution-log.v8` stream combines phase, installation,
observer, runtime and reader originals under the same aggregate 5 MiB raw,
8 MiB encoded, JSON and chunk caps. The positive roster has 22 originals,
including `execution.outer.json` and the final reader process. Failure-only
entry originals can be retained but cannot qualify. No extra becomes a sixth
old internal name or a twenty-first packet role. New-mode fields are validated
before local projections select held finite provenance rules; projected data
is never emitted as an original. The packet still has exactly twenty roles.

The independent official V8 audit is:

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/reader.py \
  --execution-log retained-actual.log --artifact retained-originals.zip \
  --external-admission reviewed-execution-expectation.json
```

Its external `bw.ring3.execution-official-expectation.v8` contains exactly
`schema`, `runId`, `attempt`, `head`, `tree`, `requestSha256`, `invoker`,
`official`, `workflowSha`, `logBytes` and `logSha256`. `official` keeps the
existing closed event/job/step/artifact admission fields. The prior request
transitively selects source12 and immutable runtime input; the dynamic plan
hash supplies delivery integrity. The official workflow revision, source bytes,
one attempt, successful required steps, artifact and log originals must be
admitted separately. An online verdict cannot authenticate their official origin.

Seven node-free delivery controls cover the mocked CLI/collector path,
independent provenance, coherent rehash conflicts, actual versus legacy job
selection, bootstrap descriptors, pre-generator refusal, readonly descriptor
closure and preserved first errors. Architectural predicates are an explicit
separate boundary in those routing controls. `--delivery-full` runs only the
existing pure Node fixture byte builder, then the unmocked twenty-role
architecture and V8 original-log/artifact reader over manufactured observations.
It executes no CPU or QEMU guest:

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/controls.py --delivery-only
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/controls.py --delivery-full
```

The selected graph does not authenticate interpreter/system startup before
admission. Python `-I -B` startup, fixed source-metadata Git processes,
checkout/setup actions, sudo and env remain trusted hosted-platform boundaries.
Git descriptors and raw streams remain closed and retained. Later observations
supply no whole-host executable authenticity claim.

Current hosted QEMU bytes/package availability and pre-enabled parent
cpu/memory/pids controllers remain external hard blockers. There is no QEMU
installer, apt fallback or parent-controller repair. Historical mismatch,
missing controllers and graph/census cap overflow refuse and require explicit
review. Node setup or inventory on another VM does not establish actual-VM
availability. Independently reviewed runtime inventory/publication, final
source12/event admission, actual guard activation and one affected clean hosted guest
qualification remain outstanding.

Failed metadata inventory can additionally retain `inventory.rejectedFiles`.
Each rejected-file record contains the bounded selected path, canonical-path
check, available named and held stat observations in the existing eight-field
metadata order, bytes read, close outcome, exact first error and secondary
readback or close errors. A stat observation precedes the unchanged regular-file,
positive extent, 256 MiB and non-group/world-writable mode guard. A refused
guard permits no file-content read or tool execution. These failure-only facts
do not populate admitted files, produce a candidate or change successful
inventory and runtime-expectation schemas. Nine mocked runtime controls include
regularity/mode/extent refusal, open/read/readback/close errors and the enabled
CLI's retained failed original; no real resource or guest operation is involved.

The additive Node-stage checkpoint addresses the observed cache mode0777
without changing the runtime mode guard. Its new `node-stage-inventory` job,
`NODE_STAGE_ENTRY_ENABLED` and independent `NODE_STAGE_OBSERVER_ENABLED` guards
are all false. Existing metadata request v1 and its enabled inventory route,
actual guards, historical Node/QEMU pins, V8, twenty packet roles and caps stay
unchanged. This checkpoint executes no runtime probes or guests.

A separately selected request digest is transported as
`BW_RING3_NODE_STAGE_REQUEST_SHA256`; the variable alone is not approval.
The immutable labeled event contains exactly one `BW_RING3_NODE_STAGE_V2` block
with a canonical bytes/SHA256/base64 wrapper. Its
`bw.ring3.inventory-request.v2` has the previous seven request fields plus
`nodeStage`: fixed cache `source`, fixed `destination`
`/run/bw-ring3-node-22.23.3/node`, `owner=[0,0]`, integer `fileMode=365` and
integer `directoryMode=365`. Selection remains the historical124827920 bytes
and SHA256 `fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48`.
The closed actor/repository/PR/head/tree/workflow/attempt-one joins use label
`x86-ring3-node-stage-inventory` and job `node-stage-inventory`. Fresh source12
and request expectations must be reviewed after the source commit.

The root `--stage-inventory-node` entry establishes a positive invoking UID/GID,
reads the bounded event and admits actual Git HEAD/tree plus all twelve live
source files before staging writes. Held root-owned nonwritable `/` and `/run`
ancestors lead to one exclusive0700 directory and0600 output. The cached Node
is untrusted data: staging never executes or chmods it. Bounded streaming checks
length, ELF prefix, historical SHA256 and held/named source identity. Independent
reopen and complete hash/readback precede0555 file publication. The root-owned
readonly `installation.original.json` retains exact request/event originals,
Git process/stream observations, source manifest, raw source/output stat facts
and copy hashes. Its declared boundary precedes directory publication and
ancestor close; it is not a terminal success record.

The copy refuses short writes; `bytesCopied` counts only returned write bytes,
while `sourceBytesRead` records acquired data. An exception without a write
return leaves confirmed bytes unchanged and marks uncertainty. Publication
attempts and confirmed returns are separate facts; available post-error stats,
primary/secondary failures and close errors survive. No partial output is
adopted, deleted or retried. A failure after executable publication reports that
state or uncertainty. After a verified irreversible drop, bounded failure output
can include admitted input originals and copy partials. Unknown or failed drop
suppresses acquired stdout and stderr while preserving in-memory failures.

Successful root staging drops and execs only the fixed Python reader
`--observe-staged-node`. Before reading JSON, this separate implementation derives
actual UID/GID/groups, zero capabilities and outside-tree membership. It
independently reads root-owned0555 ancestors and Node, the0444 installation
original and live source12 through bounded nofollow descriptors, checking full
hashes and held/named identity. Even a complete observation has
`stageObserved=true`, `runtimeCandidate=false`, `qualified=false` and a deliberate
nonzero refusal: full staged runtime inventory and actual argv mapping remain
unconnected. Python startup, the fixed source Git processes, checkout/setup
Node actions, sudo and env remain trusted hosted-platform boundaries. No cache
hash or staged availability has yet been observed on a hosted VM.

The disabled job retains only observation JSON and controller stderr using the
existing upload action pin, one-day retention and hidden-file exclusion, within
its literal15 minute budget. It never uploads the executable. A separately
admitted official run/job/workflow/artifact remains required; an empty export
or missing artifact is not a positive record. Job deadlines do not preempt
blocked kernel operations in the copy loop.

The standalone original-only audit is:

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/reader.py \
  --node-stage-observation observation.original.json \
  --stage-expected reviewed-stage-expectation.json
```

The external `bw.ring3.node-stage-expectation.v1` closes `schema`,
`requestSha256`, `head`, `tree`, `runId`, `workflowSha`, `invoker` and
`observation` (exact bytes/SHA256). It checks a completed stage observation and
its deliberate boundary refusal; it cannot approve a runtime candidate or an
actual run. Official provenance must be admitted independently before these
inputs are selected.

Seven `--node-stage-only` controls exercise real source admission/copy/drop and
the separate observer CLI/export/original reader with every OS edge mocked.
Compact authored ELF-prefix bytes replace the Node pin only inside the control
context; production historical pins are asserted and restored. Cases cover
pre-write refusal, foreign parents, existing partials, regularity/link/hash
failure, independent reopen drift, short/unknown writes, late publication and
close failures, typed policy and unverified-drop publication suppression. They
qualify source behavior only. Full staged graph admission, explicit actual
mapping, separately reviewed activation and clean guest qualification remain
required.

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/controls.py --node-stage-only
```

The separate staged-runtime inventory route now connects copying to a complete
metadata candidate. The prior stage-only observer and its explicit boundary
refusal stay unchanged. This review candidate enables only
`STAGED_RUNTIME_ENTRY_ENABLED`, `STAGED_RUNTIME_INVENTORY_ENABLED` and the
`staged-runtime-inventory` job guard. Actual execution and the older stage-only
route remain disabled. No event is admitted by these source literals. After
final exact-head CI and reviewed skips, independently bind the complete source12,
fresh v3 request and executing workflow before selecting one fresh metadata
event. Do not reuse an earlier request or consumed event. This route does not
adopt a staged Node in generator, GEN, guest argv or V8 actual delivery.

Its immutable request is `bw.ring3.inventory-request.v3`, with the v2 fields
plus `emptyPythonSources`. `selected.node.path` explicitly names
`/run/bw-ring3-node-22.23.3/node`; `nodeStage.source` still names the writable
cache only as untrusted copy input. Both selections retain the same historical
Node bytes/hash. The closed marker is `BW_RING3_STAGED_RUNTIME_INVENTORY_V3`,
label `x86-ring3-staged-runtime-inventory`, job `staged-runtime-inventory` and
external digest transport `BW_RING3_STAGED_INVENTORY_REQUEST_SHA256`. A variable
is transport, not approval. Root validates request/event/source12/invoker before
copying, retains `bw.ring3.node-stage-original.v2`, drops irreversibly and execs
only the fixed independent reader `--inventory-staged-runtime`. Failed or
unknown drop suppresses acquired stdout and stderr. Existing v2 stage requests
and v1 inventory requests are not reinterpreted.

The dropped reader independently observes the stage, raw PID/UID/GID/group/cap
identity, immutable input, source12 and parent-controller availability before
metadata tools. A staged subclass selects the fixed staged Node from its first
file observation and every Node probe. Three explicit default-preserving hooks
in `RuntimeInventory` select the node path, candidate decoration and validator;
the old route still emits its original v1 candidate bytes. No runtime globals
are rebound and no original path is renamed after execution. Staged files and
tools reject setuid/setgid and group/world-write modes before any metadata
process. Historical QEMU identity must match before probes; no apt, alternate
binary, permission repair or parent-controller write is provided.

Only `/usr/lib/python3.12/urllib/__init__.py` has the separate selected
`python-source-empty` role. The v3 request and new candidate declare exactly
`kind`, zero `bytes`, the empty SHA256, integer0644 `mode`, `owner=[0,0]` and
`links=1`. Positive `files` and this typed roster are disjoint from each other
and aliases, including aliases in ancestors. Together they share the512-file
cap; alias256, Python census256, probe11 and every byte/time/output cap stay
held. Generic files, binaries and libraries retain positive extent rules.

A separate readonly implementation opens the fixed empty source with nofollow
flags, verifies canonical root-owned single-link0644/zero extent, reads one
byte to establish EOF and the empty digest, retains all four named/held raw stat
observations, and closes. It repeats after the complete inventory, with exact
identity equality. EOF, readback and close errors preserve primary/secondary
facts; nonempty substitution, another path or role and missing actual Python
census membership refuse. Other empty files remain failures until separately
reviewed policy changes; none are dropped from the census to produce a candidate.

All eleven original metadata process/stream records, libraries, aliases,
packages, Python files and raw maps are retained under the existing finite
limits. Probe parent PIDs join the dropped observer, and their monotonic windows
follow the terminal root Git observations. Positive files and aliases are reread. Independent stage/source/input
observations repeat after all probes, joining full Node hash, inode, ownership
and mode to the actual inventory. The new `bw.ring3.runtime-expectation.v2`
candidate explicitly includes the typed-empty partition and staged executable;
its metadata does not supply independent runtime approval. Legacy runtime.v2
positive-graph predicates are reused only as local finite checks; the typed
partition is checked separately. No projected object is emitted as an original.

The distinct `RING3_STAGED_RUNTIME_INVENTORY` stream has exactly
`staged.request.json`, `staged.event.json` and `runtime.staged-inventory.json`.
Its new log/original versions retain complete stage-before/after observations,
copy original, graph, typed-source EOF/close facts and process originals. JSON
1 MiB, total raw5 MiB, encoded8 MiB, chunk and candidate limits stay unchanged.
Overflow retains the bounded failure prefix and cannot qualify. The
15 minute metadata job uses the same checkout/setup-node/upload action pins and
exports only bounded log/stderr, never the executable. This budget is a
backstop, not evidence of hosted sufficiency or preemption of blocked syscalls.

The independent original-only audit is:

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/reader.py \
  --staged-runtime-inventory-log retained-staged-inventory.log \
  --external-admission reviewed-staged-inventory-expectation.json
```

Its external `bw.ring3.staged-inventory-expectation.v1` closes `schema`,
`requestSha256`, `runId`, `attempt`, `head`, `tree`, `workflowSha`,
`workflowFileSha256`, `jobId`, `jobName`, `conclusion`, `logBytes`, `logSha256`
and `invoker`. It joins separately admitted official metadata and exact original
bytes to source, event, stage and all graph/probe facts. A positive verdict
still has `candidateReviewed=false` and `actualRunApproved=false`. Runtime graph
review/publication, separate activation and explicit actual mapping on a fresh
VM remain necessary before the affected hosted guest qualification. Python
startup and fixed platform setup/Git boundaries remain as stated above.

Eight `--staged-runtime-only` controls execute the full root-copy/drop/observer,
eleven metadata probes, all readbacks, log export and standalone audit over
mocked OS/process edges and compact authored Node fixture bytes. They cover
request/event/source joins, typed EOF and close failures, coherent rewritten
originals, alias substitution, early privilege-mode refusal, shared cap512,
no retry, fixed CLI arity and unknown-drop publication suppression. Historical
production pins are asserted and restored; no tool, resource operation or guest
runs locally.

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/controls.py --staged-runtime-only
```

The phase-specific control asserts the reviewed metadata guards enabled while
retaining actual and older-stage guards false. It also explicitly disables each
metadata guard and checks refusal before its factory or observer, including
environment strings that attempt to enable it. The other
full-chain controls are unchanged. Eight affected mocked controls pass; they do
not qualify a hosted stage, runtime candidate, resource operation or guest.
