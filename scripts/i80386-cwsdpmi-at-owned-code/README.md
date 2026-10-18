# Separate owned-code identity cut

This source-only checkpoint adds a narrower, explicitly named identity result
at the same synchronous protected 32-bit `main` cut. The existing strict
whole-`.text` comparator still runs first and keeps its own PASS or FAIL.
When that comparator fails, the narrower result can pass only if its private
diagnostic proves exact bytes for the complete owned `main` and all seven
admitted DPMI wrapper extents in the one copied ordinary-RAM snapshot. It
does not mask any changed `.text` byte or call the passive reader twice.

The strict cut module issues a single-use private mismatch capability only
after its controlled binder comparison and unchanged CPU, board, RAM,
page-classifier, page-table and reference checks. The separate wrapper
consumes that capability for the same machine, admitted layout and exact
Error, rechecking the current candidate and state before returning a narrow
receipt. Public Error fields and mutable layout aliases carry no authority.
This is a synchronous source-owned cut, not a general pause lease or proof
that no fully restored intervening activity ever occurred.

The [fourth hosted diagnostic](FOURTH-RESULTS.md) at the preceding source
failed strict whole-text identity: 13 changed bytes in eight map-associated
spans were reported outside the eight required code extents. The original
packet did not retain executable or guest code bytes, so the diagnostic does
not prove the cause of those changes or correspondence between source and
linked library bytes. This new narrow cut has **not** run in a guest. It
cannot qualify startup, libc, exception handling, far-pointer helper code,
wrapper execution, `INT 31h` delivery/IRET, completion, strict 386 behavior,
memory above 1 MiB or advancing BIOS ticks.

Run the bounded source controls with
`node scripts/i80386-cwsdpmi-at-owned-code/cut-control.mjs`. They exercise a
real privately admitted synthetic MZ/COFF/map fixture, every required role
byte, forged errors, cross-owner and stale consumption, base drift and
swallowed reentry. They do not instantiate or run the AT guest.
