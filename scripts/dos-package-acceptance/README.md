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
