# Stock xv6 JavaScript accelerator acceptance gate

Status: **source and bounded host controls only**. No guest or timing result is
established by this directory until a reviewed hosted run publishes its raw
receipts. The production 386 path remains ordinary JavaScript.

This gate compares the current repository's ordinary lean JavaScript path with
its existing opt-in protected-32 native block dispatcher. Both execute the
same stock MIT `xv6-public` `forktest`, built from revision
`eeb7b415dbcb12cc362d0783e41c3d1f44066b17` for 4 MiB, with the vendored
free Bochs BIOS and LGPL VGA BIOS. The guest uses the board's explicit PSE and
APIC/IOAPIC compatibility extensions; this is not strict original 386DX
acceptance. Code16 WASM is a different 16-bit opt-in path and is outside this
protected-mode comparison.

The existing `scripts/probe-xv6-stock.mjs` is unchanged. Each fresh child uses
`XV6_LEAN=1`, whole-RAM hashing, a 40-million-step cap, `forktest` over COM1,
and stop-on-exact-returned-prompt. The gate requires the historical 24,338,279
completed steps and exact terminal serial transcript. It compares every
reported architectural and board outcome: full final CPU snapshot, complete
4 MiB RAM hash, both final disk hashes, serial and input records, recorded
interrupt prefixes, LAPIC/IOAPIC fields, screen, clocks and other probe
fields. Dispatch-only shared-RAM and block counters are checked separately.
The probe caps its interrupt record arrays at 64 and does not publish a full
ordered I/O bus trace; this gate proves equality of its reported device
outcomes, not equality of every unrecorded transaction.

`run.py` admits one clean exact Git head and the pinned xv6 source revision,
checks fresh image and free-ROM hashes, verifies each reported source-inventory
digest against ordinary repository files, and rejects unknown probe fields.
Every child must pass source and semantic checks before its metrics enter the
series. Two warm-up pairs precede seven measured pairs, with alternating
ordinary/dispatch order. Each child has a process group, CPU/wall/RSS/file
bounds, retained raw stdout/stderr, and `wait4` whole-child CPU and wall
measurements. The latter include startup and report generation; there is no
separately measured guest-execution CPU window. The adoption gate requires at
least 10% lower mean whole-child CPU for dispatch and all seven measured pairs
favorable. Wall is reported independently. A semantic mismatch or incomplete
series prevents any performance conclusion. Configured guest cycles are not
physical 386DX timing or a calibrated RTx result.

Run the small source controls without media or a guest:

```sh
python3 scripts/xv6-js-acceptance/policy_control.py
python3 scripts/xv6-js-acceptance/run_control.py
```

The host runner adapts the bounded fresh-process pattern already used by
`scripts/cold-direct-ram-paired/bounded.py`; it does not import that native
profile or modify the emulator. Hosted build and exact-head workflow admission
are separate review steps.
