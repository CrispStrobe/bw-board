# Tool boundary receipts — unconnected source profile

This standalone Python unit observes the nine canonical extracted tool and
header roles selected by the held compile helper at source
`e1f44e70bd21e4f3b146d0c0e00da141eb045182`. It does not execute or integrate that
helper. No compiler, runtime or guest result is claimed.

`ToolBoundary(root)` fixes the role paths and SHA-256 pins in source and creates
an independent session. Capture `before-probes`, followed by exactly one
`after-link` or `failure-final`. A capture consumes its phase even on failure;
the first refusal poisons subsequent captures. Failed observations retain the
completed role prefix. `status()` returns copied facts, not authority. A
`failure-final` observation can also be the first capture; it does not establish
an earlier observation or a compiler outcome.

Each fixed relative directory is opened through its parent descriptor with
`O_DIRECTORY | O_NOFOLLOW`. Root and directory identities are compared before
opening, on the held descriptor, and against their named routes after reading.
Files must be regular, single-link, nonempty and at most 16 MiB; the nine roles
are limited to 64 MiB total. File before/opened/after/named identity and byte
count must agree, as must the fixed digest. Directory replacement, symlink
routes, hardlinks and changed files refuse. These are boundary observations,
not proof of uninterrupted identity, process isolation or source-to-binary
correspondence. The operating system and Python implementation remain trusted.

Receipts contain logical role names and integer file identities, never paths.
The JSON integer domain is exact Python integers below 2**64; consumers must
preserve them rather than round through a floating-point representation.
`write()` admits only closed fixed-depth typed receipts matching an issued
capture before serialization or filesystem work. Busy `status()` and `write()`
poison an active capture or writer as reentry; writer syscalls are also fenced.
An exclusive partial output may remain after a refused writer, and must not be
treated as a completed receipt. Historical capture poison permits only a bounded
diagnostic write of an exact issued partial copy, never further source reads or
a positive receipt. A separate writer reentry epoch stops newly attempted reentry
without clearing the historical first refusal. New writer reentry blocks all
later writes. Each issued sequence consumes its single writer attempt before
opening the destination; failed attempts cannot retry at another destination.
There are at most two capture and two writer attempts per session. `write()` creates a bounded 32 KiB text receipt exclusively and never overwrites
an existing file. Filesystem errors from capture become a fixed sanitized
refusal; exceptions from receipt writing are caller-visible and do not erase
capture status. A future connected wrapper must preserve its original compiler
failure separately, including when receipt writing fails, and sanitize writer
exceptions into bounded fixed codes before any public serialization. Raw
exception text may contain paths and must never enter artifacts.

`validate_pair()` checks closed, typed complete receipts with matching sessions,
source bindings, fixed pins and identical file observations. Serialized facts
cannot establish ownership of a live capture. Its only positive result is
boundary consistency; compilation and continuous identity remain unqualified.
Failure-final and partial receipts receive no pair qualification.

Run the manufactured controls with:

```sh
python3 -B scripts/i80386-cwsdpmi-0501-boundary-receipts/tool-boundary-control.py
```

The controls substitute only the fixed role digest table for small manufactured
files. They cover successful observations, exclusive output, missing files,
file and parent symlinks, hardlinks, parent and file replacement, oversize files,
phase consumption, partial prefixes, cross-session and cross-capture refusal,
Boolean/integer schema confusion and swallowed reentry. They neither acquire
nor execute real tools. Compiler hooks, independent receipt acquisition and
full tool/input qualification require a separately reviewed derivative profile.
