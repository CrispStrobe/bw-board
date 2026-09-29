# Opt-in plain-RAM byte reads: predeclared paired gate

The ordinary 386 AT board calls `_decode386`, checks MP-table and APIC overlays,
asks VGA to decode the address, then calls the base board `_read` for each byte.
For a whole page classified as ordinary RAM, `_read` returns the underlying
byte. This experiment permits `_read386` to return that byte immediately when
`experimentalPlainRamReadShortcut: true`. It is **off by default**. The stock
Windows console and xv6 probes select it with `AT_PLAIN_RAM_READ_SHORTCUT=1`
and `XV6_PLAIN_RAM_READ_SHORTCUT=1`, respectively; unset or `0` selects the
ordinary path. Both probes reject combining it with their native execution
dispatchers. This is a board read shortcut, not a new CPU executor.

The guard runs only after A20 and reset-vector alias decode. It requires the
base `_read` method to be unwrapped, an in-range physical address, a page-map
kind of 1 (an entire RAM page without MMIO, ROM or partial mapping), and an
address outside `0x9fc00..0xbffff`. The latter conservatively excludes the
synthetic MP floating/configuration table and VGA aperture. APIC windows are
outside installed RAM; ROM and unmapped pages are not kind 1. A changed or
wrapped `_read`, including a read-order observer, uses the ordinary path. The
page-map classification is the existing board contract; if future devices
mutate the map without rebuilding it, both this shortcut and the existing
base `_read` cache would need re-audit.

Focused differential fixtures cover plain RAM below and above 1 MiB, page
edges, A20 off/on, reset alias, MP table bytes, APIC, ROM/open bus, VGA latch
reads, a partial-page MMIO callback, wrapped `_read`, and ordinary instructions
in real, protected16, VM86, and protected32 modes. They establish local
boundary parity, not full-workload parity or a measured speed gain.
The dated FreeDOS and xv6 receipts remain bound to the revisions that ran
them. Their hashes are not rewritten to qualify this branch. The live
default-off behavior is tested here; a new source-bound FreeDOS result would
require a new boot and receipt.

Before any guest pair, pin the exact board revision, executable source hashes,
media hashes and host configuration. Run three **serial** baseline/shortcut
pairs for each of (1) the bounded 60-million-step Windows console path and
(2) complete lean stock xv6 `forktest` with `XV6_RAM_HASH=1`, alternating
order AB/BA/AB. Keep all
other options and input bytes equal. Compare exact selected guest and device
state, step count, completed marker, RAM and final disk hashes, and output/transcript hash for
each pair. The Windows report's `inputs.plainRamReadShortcut` and the xv6
report's `plainRamReadShortcut` are the only expected report-field differences;
retain source/revision/media parity checks rather than normalizing those.
Capture user CPU time outside the guest from an uninstrumented run; do not use
observer-on timing as a speed estimate. Stop on the first parity failure or
unfavorable first pair. Retain the experiment only if every pair favors the
shortcut and the mean user CPU decreases by **at least 5% separately in both
workloads**. An identical guest state with a smaller or inconsistent CPU gain
does not pass this predeclared retention gate. No such guest pair has run for
this change yet.
