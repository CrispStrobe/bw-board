# Retained-root tool observation preparation

This source-only unit privately constructs the fixed retained workspace/evidence
composition. It observes the nine held tool/header roles through its borrowed
tool-root descriptor and writes bounded diagnostic JSON through the existing
exclusive evidence writer. It does not load the old pathname ToolBoundary,
execute its writer, copy or extract tools, or import or execute a compiler,
client, CPU, Node, guest or toolchain.

The public API is `RetainedToolObserver(parent)`, `prepare()`, `before()`,
`terminal('after-link' | 'failure-final')`, `status()` and `close()`. Only the
bounded absolute parent argument is accepted: the held owner enforces at most
30 components and 4,046 UTF-8 bytes. There is no caller FD, tool-root or output
path, callback, expected pin, receipt, provisioning function or source ticket.
Preparation creates an empty private workspace. Its first real observation
naturally refuses at the missing first role; there is no public population or
extraction API in this unit. Synthetic controls alone populate the private
fixture descriptor and replace the fixed role pin table with synthetic hashes.
They do not establish actual-tool or compiler admission.

The loader hashes the exact workspace composition and its held dependencies.
The receipt carries those dependency hashes and protocol version one. Historical
ToolBoundary and compiler hashes record predicate provenance only; they do not
authenticate an executed compiler. This unit does not pretend to pin its own
self-referential source hash. Exact external observer/source admission and the
execution context remain separate gates.

Each observation rechecks the complete private owner routes before and after
walking fixed relative tool names. It never reopens, duplicates or closes the
borrowed tool-root FD. Bounded local directory/file descriptors use no-follow
opens, before/opened/named directory identity fences, ordinary single-link file
checks, and before/opened/after/named file identity, extent and SHA joins. All
intermediate directories are rechecked by held and named identities after the
read. Directory observations bind device/inode, permitting legitimate metadata
changes; they do not prove uninterrupted identity.

Each known file extent, at most 16 MiB, is reserved into the at-most-64-MiB
capture budget before its content open/read. Each read is at most 64 KiB and
bounded by the known extent plus one EOF guard byte; growth refuses immediately
when the guard becomes content. The guard is not declared content budget.
Reservations stay consumed on failure. At most nine EOF guard bytes can be
requested per capture. A capture retains only metadata and digests, never tool
content. Local close attempts are consumed before the syscall, using the cleanup
callable captured before opening; uncertain close is recorded and never retried.
The local eight-slot ledger is distinct from the owner's directory ledger and
writer output close accounting.

There are at most two tool observation attempts. Complete before/after pair
validation uses private saved receipts from the same session and dependency
version, all nine pinned hashes and identical file identities. The new closed
typed schema has explicit fixed-prefix `roleOrder` and `reservationOrder`
arrays; mapping order is immaterial. Sorted JSON parses back into the same
admissible schema. `complete` means this observation completed. `pairStatus`
and `pairFailure` separately record a complete observation's pair refusal.
A refused pair or failure-route envelope never yields pair consistency.

Receipt `phase` retains the attempted observation phase. `routePhase` records
the diagnostic writer's actual route phase. A failed second `after-link`
observation, or a complete second observation whose pair differs, remains an
`after-link` observation and is written once with `routePhase=failure-final`.
There is no third capture or relabeling of its original observation facts.
Calling `failure-final` selects a diagnostic phase; it is not proof that a
compiler ran or failed.

Historical tool refusal poisons this observer's source reads, while a still
healthy workspace owner may emit its issued partial diagnostics. A failed first
capture retains the original exception and completed prefix, attempts one
before partial output and one terminal envelope of kind
`failure-terminal-no-observation`, then cleans up and rethrows that original
exception. The terminal explicitly records no second tool observation. If the
first before capture completed, a failed second capture or pair check can emit
one terminal failure-route output. Partial output and the first error remain
when writing or cleanup refuses; there is no alternate path or retry. Repeated
or misordered calls do not use historical partials to retry diagnostics.

Fresh outer reentry, including busy status reads, immediately poisons this
observer and every potentially active private workspace owner. It permits only
cleanup, never diagnostic source observations or writes after the fence fails.
Local and owner cleanup preserve attempted/refused facts. `emittedSequences`
records outputs that the held writer verified, including a terminal output
verified before a later route-release reentry; partial unverified files can also
remain on disk and are not credited. Status supplies fresh bounded copies of
finite facts, without paths, FDs, private session tokens or receipt adoption.

All parent-trust, source-ownership, continuous-identity, compiler, guest and
performance flags remain false. The parent/OS/mount/loader context, inode
substitution before the creator's first observation, hostile Python mutation,
and arbitrary asynchronous bytecode/allocation failure safety remain outside
this finite source unit. The tested registration interruption and cleanup
controls establish only their stated boundaries. Full input/archive extraction,
implicit roles and environment, compiler process/delegation, outputs and raw
formats, media/final leases, independent full reader and launch gates remain
unfinished. The production compiler remains unconditionally disabled.

Manufactured filesystem controls only:

```sh
python -I -B scripts/i80386-cwsdpmi-retained-tool-observer/observer-control.py
```

The controls exercise empty/complete/partial/pair-refused lifecycles, sorted JSON
roundtrips and typed admission, stale attempts, route and file replacement,
symlinks/links, extent and aggregate bounds, raced growth, source and diagnostic
reentry, original error identity with secondary failures, and uncertain local
cleanup. No real tools or product execution are involved.
