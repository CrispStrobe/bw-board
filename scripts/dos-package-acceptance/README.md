# Bounded raw HDD package CLI

This source candidate admits a deliberately closed STORED ZIP profile into the
ordinary functional 386 AT. Host controls use tiny authored archives and an
injected mock machine. Actual guest and installed GUI qualification remain
separate work; those controls do not establish boot, DOS completion, physical
timing, RTx, whole DOSBox compatibility or installed GUI success.

The new runner uses the existing in-memory machine constructor with `ataImage`
and `ataGeometry`, the existing functional VGA profile, `loadRom`, `reset`,
ordinary `step` and `keyIn`. Live keyboard decoding and text sanitization use
the existing terminal helpers. Existing runners, parsers, package dependencies,
source pins and workflows are unchanged. The real machine module is imported
only after input admission, when a real execution is requested.

## Exact declaration grammar

Choose an exact archive config with `--config`, or provide exactly one file
whose basename is `dosbox.conf` (case insensitive). The optional CPU section
must precede the required autoexec section. It admits only one
`cputype=386` or `cputype=auto` key. The autoexec section contains exactly these
two declarations, in this order:

```ini
[cpu]
cputype=386
[autoexec]
imgmount c disks/boot.img -t hdd -size 512,17,4,306
boot -l c
```

The drive token is `c` or `2`; the option order is exactly `-t hdd -size`.
The relative image filename must end in `.img`. Matching single or double quotes may surround
only the complete path token; quotes around options, keywords or numbers and
fragmented quotes refuse. Forward slash or backslash separators in this config
path normalize to `/` before canonical relative-path validation; the archive's
original names themselves must use `/`. Spaces are not supported in paths. Blank lines and
whole-line `#` or `;` comments are allowed. Command words, section names, CPU
values and image extension are case insensitive. CHS is positive decimal with
no leading zero; sector size is exactly 512, sectors are at most 63, heads at
most 16 and cylinders at most 1024. The image length must be exactly
`512 * sectors * heads * cylinders` and fit the file cap. The existing
`parseDosboxConfig` parser must independently agree on one C/HDD mount and one
`boot -l c` declaration.

No other section, key, command, option, drive spelling, direct image boot,
inline comment, command chaining or executable script is accepted. In
particular, `-fs`, `c:`, `mount`, host directories, CD/ISO, URLs and a COM/MZ
service route are unsupported. Package declarations are never executed as
host or DOS commands.

Media resolution starts at the selected config's directory. Lookup is case
insensitive and preserves the actual full original canonical filename. There
is no basename fallback. Each path component must match
`[A-Za-z0-9_-][A-Za-z0-9_.-]*`, must not end in a dot, and must not be a DOS
reserved device name. Paths cannot be absolute or contain traversal, empty
components, backslashes, non-ASCII bytes or drive/URL syntax. Duplicate names,
case aliases, implicit directory case aliases and conflicting ancestors refuse.
Only the selected config, its one image, and files named `LICENSE.txt` at any
depth may occur; other configs/media/code refuse. Directory records refuse.

## ZIP profile and finite bounds

The input ZIP and total file bytes are capped at 16 MiB, with at most 32
regular-file records, each at most 16 MiB. Config text is at most 16 KiB;
original archive names are at most 128 ASCII bytes. The expansion ratio is at
most one because only STORED (method 0) is admitted. The adapter snapshots
the bounded original input, admits all original names and record topology,
then checks every file CRC before constructing the asset map. Read access
returns independent byte snapshots; no files are extracted.

Local records must be contiguous from offset zero in central-directory order,
followed immediately by the exact central directory and uncommented EOCD.
Local and central flags, sizes, CRC, timestamps and names must agree. Only
flags zero or UTF-8 (with ASCII names) and required versions up to 2.0 are
supported. Extras, comments, descriptors, encryption, ZIP64, multidisk records,
padding, hidden/overlapping/reordered locals and trailing bytes refuse. The
creator system must be DOS or UNIX. DOS attribute bits must be zero. UNIX mode
may be zero, permission-only with unspecified type, or explicitly regular;
links, directories and all special file types refuse. Permissions are metadata
only and never applied to a filesystem.

## CLI and execution budgets

```sh
node scripts/run-dos-package.mjs --package authored.zip \
  --bios bios.bin --bios-sha256 BIOS_SHA256 \
  --vga vga.bin --vga-sha256 VGA_SHA256 \
  --steps 50000000 --wall-ms 600000 --report new-report.json
```

Supply external lawfully held BIOS/VGA files with explicit SHA-256 values. BIOS
must be exactly 64 KiB and VGA 16–64 KiB. Inputs are bounded regular files,
opened with no symlink following and nonblocking mode before type validation;
bytes are snapshots. No package asset, environment variable, network fallback
or host-mounted path can replace firmware or select another execution backend.

Steps count total ordinary `machine.step()` calls from reset, including BIOS,
guest work and idle service, rather than post-boot or retired instructions.
The default is 50 million; the hard limit is 120 million. The wall budget
defaults to and is capped at 600 seconds, checked between chunks of at most
8192 calls. A blocking individual call cannot be preempted by this budget.
`budget` and `wall-budget` are finite controller stops and never prove boot or
guest completion. CPU shutdown and execution/device/capture failures refuse.
The report always declares `guestCompletionQualified: false`.

`--live` requires input and output terminals. It renders text VGA only and
accepts keyboard input through the existing decoder. Ctrl-] quits; an external
SIGINT/SIGTERM stops the loop and attempts restoration. Accepted scan bytes
are separated by 65536 ordinary step calls; rejected/queue-full bytes stay
pending and retry at 1024-call service boundaries. The loop yields between
chunks to service terminal events. Mouse events are not delivered. Input is
capped at 65536 bytes, queued scan bytes at 4096, delivered scan bytes at 65536
and serial capture at 65536 bytes. Serial overflow is explicitly reported.
Normal initial focus-in is accepted. Terminal focus loss ends this bounded
session with an explicit refusal; input is decoded in byte order so mixed or
split focus sequences cannot admit later keys. Pending modifier breaks are
neither fabricated nor discarded to resume a guest. Focus-resume interaction
is a future UX limit, not qualified by this first version.
Every started terminal session attempts all owned listener/raw-mode/cursor
cleanup operations; restoration uncertainty is reported if any operation fails.

Reports contain package/config/image/firmware identities, selected original
paths, geometry, budgets, finite steps, stop/refusal, bounded keyboard/serial
observations and final text/CPU state. Snapshot, cleanup and report-retention
failures preserve the first execution error and list secondary errors. A new
report file is created exclusively. If it cannot retain an execution refusal,
the report is offered to standard output without overwriting the existing file.
No raw disk writeback or image export is provided by this runner.

Run only the authored pure controls locally:

```sh
node --test test/dos-package-policy.test.mjs test/dos-package-zip.test.mjs test/dos-package-cli.test.mjs
```

Any actual emulator/guest/browser qualification belongs to separately reviewed
hosted CI acceptance with frozen source/input identities and independent
original-byte readers. No such run is established by this README.

## Hosted PTY acceptance source candidate

The acceptance producer, fixture, standalone reader and workflow remain source
candidates. No actual guest, PTY, installed GUI or resource qualification has
occurred. Pure PR controls never create a PTY or import/execute a real machine.
Only a separately reviewed owned PR label `x86-dos-package-actual`, attempt 1,
can select the actual job after every final source check and independent
source/reader/input/resource-envelope approval. Do not trigger it automatically.

The new authored bootstrap is 197 bytes followed by zero padding through offset 509 and signature `55aa`,
forming a 512-byte raw disk with CHS 1,1,1. It establishes real-mode segments/stack, selects
text mode 3, prints `BW-PKG-READY`, then obtains a key using BIOS INT 16h/AH=0.
For a/b it prints the returned character and computed XOR 5Ah as
`BW-PKG-KEY=a;XOR5A=3B` or `BW-PKG-KEY=b;XOR5A=38`; after a fixed 65,536-iteration LOOP
it prints `BW-PKG-DONE` and enters CLI/JMP-self. No DOS kernel, FAT or protected
mode is supplied. The saved AL and owned instruction PC are not runtime
observations exposed by the CLI. The finite claim requires real input followed
by distinct visible guest output, joined to independently reviewed exact bytes.

Independent golden identities:

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| Boot image | 512 | `03564a6088a3ecc64833713ca1d406da354a3f6a16d60fdffa59ffbf5cfc5e50` |
| Supported package | 2014 | `a3511f8daae0e5803ae050974e4a62ff75bf852ccff2681855f5bf1bfd7bdcc4` |
| Traversal package | 2020 | `e783114b8d4874041e28db5603d309b53c2066a6961a1c0b1af86aa5869d7182` |

The STORED archive has exactly `pkg/dosbox.conf`, `pkg/disks/boot.img` and
`pkg/LICENSE.txt`, without directory records. The last member retains the
repository MIT text. The malformed variant has valid CRCs/extents and changes
the original config name to `pkg/../dosbox.conf`; it must fail original-name
admission rather than a stale digest. External BIOS and VGA are the unchanged
free bundled firmware with their exact source/notice/hash bindings, never a
package override, new download or binary artifact. VGA extent is 38,400 bytes.

Four real fresh PTY cases run serially in order a,b,malformed,focus-loss:

1. a/b each observe a complete fresh READY-only frame and raw terminal before
   writing initial-focus-IN plus the lowercase key (`1b5b4961`/`1b5b4962`).
   A later complete exact key-dependent result and DONE frame are mandatory.
2. Each positive ends at exactly 50 million ordinary `machine.step()` calls,
   stop `budget`, exit 0, four input bytes, exactly its accepted make/break
   scans spaced at least 65,536 calls on 1,024-call service boundaries, no pending scan bytes
   and complete terminal restoration. No alternate stop, Ctrl-] or redraw
   count gate is used in actual acceptance. Budget alone never proves action.
3. Malformed sends nothing and requires explicit canonical-path refusal,
   exit 1, no live-start sequence and no runner report. Pre-machine-import is
   a source-order/mock-control conclusion, not a runtime absence observation.
4. Focus-loss waits for completed READY, writes only `1b5b4f` and requires
   three input bytes, no accepted scan/result, exact focus-loss refusal and exit 1. Initial
   focus-IN is already positive in a/b. Mixed/split focus and Ctrl-] remain
   pure controls; no modifier-release or resumed input is claimed.

The busy guest loop allows console rendering while ordinary execution continues.
This test does not measure guest speed, physical timing, RTx or retired instructions.
The renderer emits 25 rows of 80 characters: pre-READY VGA may use two-byte UTF-8.
Original output is parsed with the predeclared LF/CRLF branch selected by
observed raw-phase OPOST/ONLCR, never normalized into a passing result. Complete
frame/input offsets and monotone read/write/wait events establish chronology.
Parent-held slave termios records before/raw/after and requires exact restoration;
internal listener removal is self-report only.

The proposed profile is one CPU of quota, 1 GiB memory, no swap and 64 tasks; each child has 120 s and 50 million calls,
the controller has 600 s and the job has 15 min. These bounds remain UNQUALIFIED until resource
admission and the sole actual. Each raw PTY has a 32 MiB cap, each events file has a 16 MiB cap and
65,536 events, each report has a 256 KiB cap; the full expanded packet including audit has
192 MiB. Maximum general UTF-8/CRLF frame is 4,083 bytes; 6,104 draws produce at most 24,922,632
bytes, below the raw cap. Event accounting is incremental; retained JSON is
separately capped. First execution errors survive all secondary cleanup and
retention errors. Partial failure packets are retained without becoming success.

Six owned cgroups (enclosing/controller/four cases) retain kernel identities,
limits, raw counters, OOM deltas, wait4 status/rusage, reaping and empty-terminal
observations. Child identity is recorded by a bounded own pre-exec pipe, avoiding
a quick-exit procfs race without instrumenting Node or the loader. The outside
finalizer observes enclosing state before any cleanup kill. If occupied it
records failure first, kills only the independently admitted exact owned group,
bounds cleanup and retains additional failure evidence; an empty post-kill
group cannot turn that failure green. Missing controller evidence remains failure.
Official job logs also retain before/after executable identities independently
of the packet. Those are observations, not host attestation.

A successful packet has exactly 23 regular-file roles: audit/source-before/
source-after/runtime/resources/inputs JSON; two authored input ZIPs; process/PTY/
events/report for a,b,focus-loss; process/PTY/events for malformed. Audit hashes
the other 22 roles. Exact Git/live source closure, runtime, input/firmware,
argv/environment, schema and official head/event/attempt/job/step/artifact joins
need independent admission. The reader never imports producers, policy, ZIP
adapter, CLI, emulator or an old reader, and never replays a guest. Metadata
admission precedes sole original artifact/log acquisition; two original-byte
audits and every final-head check precede matched-head source merge/tree proof.
No retries select a passing actual. Installed GUI, full DOSBox, OS/DPMI,
strict 386 compatibility and physical accuracy remain separate.

Run all pure source controls locally without actual execution:

```sh
node --test test/dos-package-{policy,zip,cli,acceptance}.test.mjs
```


### Privileged entry candidate after the first failed hosted run

The sole PR637 attempt-1 [run 38883122687](https://github.com/CrispStrobe/bw-board/actions/runs/38883122687)
failed before the runtime/case loop. Its retained first controller error was
`PermissionError` 13; source admission and cgroup setup succeeded, the controller
before snapshot was absent, and no four-case guest PTY was launched. The
finalizer retained that same primary. Its failure exit is not separate evidence
of a cleanup operation failing. Preserve that original; never rerun or relabel it.

The held source localizes the error to initial controller migration or the
immediately following snapshot; the original has no syscall/path traceback.
The kernel's [delegation containment rule](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html#delegation-containment)
requires nonroot migration permission at the source/destination common ancestor.
This supports the bootstrap correction; the precise kernel permission facts of
the failed original were not captured and remain unobserved.

The new candidate uses the same producer file as a small privileged bootstrap.
It admits only the exact owned run cgroup and controller leaf, their retained
identities and unchanged limits, the closed 57-path source census and observed
Python/Node executable bytes. It runs no Node/version subprocess while
privileged. It enters only the controller leaf, clears supplementary groups,
sets real/effective/saved GID and UID to the admitted nonroot sudo invoker, verifies
zero effective/permitted capabilities, then execs the same observed Python and
held `--run` path with Python isolated mode (`-I`) under a fixed environment. The controller refuses missing
prior leaf entry or incomplete privilege drop. Its children inherit that leaf
and move only to the existing sibling case leaves inside the delegated owned
root. No ancestor is chowned and no guest runs as root.

The workflow uses noninteractive `sudo -n` inside the existing 600-second outer
timeout. Temporary `.owner.json` gains runner/environment/runtime/source and
controller identity admission fields; the privileged phase and unprivileged
controller stay in the same PID through exec. A structured bootstrap line in
the original job log records the dropped identity. No successful artifact role
or reader schema changes: 23 roles, all fixture goldens, markers, input
chronology, reader predicates and CPU/memory/PID/time/step/output caps remain
unchanged. Canonical positive `SUDO_UID`/`SUDO_GID` are captured before owner validation;
owner IDs must match. A pre-owner refusal can still drop to this checked invoker
and retain its original primary in existing controller evidence. If the invoker
is unestablished, privilege drop fails or writing evidence fails, only bounded
structured stderr may retain the earliest error; the packet alone then cannot
claim earliest-error identity. No root packet writes or guest exec follow such
refusals.

Inert controls execute the actual validation, entry, UID/GID/group drop,
controller membership, fixed exec/environment and error-retention methods with
all OS/filesystem/process edges mocked. Source/runtime/identity drift, failed
migration/drop and a mutation removing the drop call must refuse before exec.
These controls are not privilege, kernel, PTY or guest qualification. This fixed
source needs a distinct final-source CI/admission/hosted event; it cannot reuse
PR637's failed actual, earlier successful source controls or an invented guest
result. Existing first-error and external cleanup requirements remain mandatory.


### Terminal input ownership after the second failed hosted run

The distinct PR640 [attempt-1 run 38906622594](https://github.com/CrispStrobe/bw-board/actions/runs/38906622594)
used the reviewed privileged-entry candidate. Its retained bootstrap marker
records nonroot UID/GID, empty supplementary groups and the same controller
PID as the resource packet. Case `a` booted the authored image, displayed exact
readiness, accepted the live key and displayed `BW-PKG-KEY=a;XOR5A=3B` followed
by `BW-PKG-DONE`. The runner wrote its 50-million-step budget report and
restored terminal settings. Nevertheless, the process remained alive until the
120-second child deadline and was terminated. The other three cases never
started. Finalization propagated the original deadline failure; the retained
case and enclosing groups were empty with zero observed OOM events.

Two original-only audits verified the eleven-role partial packet and original
job log. This is evidence of the bounded first-key response, not a successful
four-case acceptance. The originals contain no live-handle enumeration. Source
review found a lifecycle gap: fresh Node input can have `readableFlowing=null`
while `isPaused()` is false. Resuming it and later pausing only when it was
initially paused can leave the CLI's own read active after its report.

The next source candidate separately repairs the CLI within its existing
package-loader ownership. Before adding its listener or resuming input, it
records whether a read was already flowing. Cleanup releases its own fresh or
paused read and preserves an already-flowing caller and its listeners. It does
not destroy shared stdin or force process exit. Pause failures remain secondary
to an existing execution error, and the remaining cleanup actions still run.

The combined pure suites pass 29 tests. New actual-method inert controls cover
fresh, paused and preexisting flowing input across budget, error and interrupt
exits. Reverting the ownership predicate fails both regressions; always pausing
fails the preexisting-reader control. These are source controls, not a new PTY
or guest result. Freeze the new source, pass its own checks and admit a new
distinct official event before another actual. Never retry or relabel either
failed original, change the fixture, relax the reader or increase the deadline.
