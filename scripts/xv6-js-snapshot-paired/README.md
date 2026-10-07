# Ordinary JavaScript instruction-snapshot experiment

This source changes one internal allocation in `ExperimentalI80386.step()`: the
fresh rollback snapshot still owns the same six segment-cache references, but
stores them as fields on the existing state object instead of allocating a
second six-element array. The observer-facing `_snapshotInstruction()` keeps
its original array shape and JSON key order; only `step()` uses the scalar
form. It does not pool or reuse snapshots. The normal
JavaScript CPU, memory translation, fault delivery and source media remain the
same profile. A lower allocation count is a hypothesis until the hosted paired
result is audited.

The pinned before source is
`6e5662bec11442e373a2489f213bc506438373e8`. The dedicated
[workflow](../../.github/workflows/x86-xv6-js-snapshot-paired.yml) checks out
both exact commits and admits only the CPU file plus this dedicated gate and
test. It authenticates the unchanged xv6 probe, build and qualification
helpers; the complete probe source inventories may differ only at
`src/experimental/i80386.js`. Both fresh children run ordinary JavaScript
with the same built MIT xv6 image, free ROMs, 4 MiB PSE/APIC profile,
`forktest`, 40-million-step bound and full reported RAM/disk hashes. This is a
finite 4 MiB extension profile, not strict original 386DX qualification.

Before the pairs, the gate runs the affected segment/fault/REP tests and the
owned code32 REP page-fault guest. A separate QEMU 486/TCG execution must show
the same ROM, one real error-2 page fault and `P32OK`. The new QEMU binary
version and SHA are recorded; they are not silently called the earlier pinned
QEMU result. The QEMU receipt proves the guest's exception/output behavior,
not the JavaScript board's entire memory trace.

The paired comparison has two warm-up pairs and seven alternating measured
pairs. Every child must have a clean source/media admission and the complete
existing xv6 semantic projection must agree, including final CPU state,
reported full RAM and disk hashes, serial/input, bounded interrupt records and
device state. The only excluded report fields are authenticated source
identity and revision. Each reported free-BIOS path must equal the exact
checkout's ROM path and its bytes must match the qualified digest; that one
authenticated path is compared as the same repository role across checkouts.
The raw child reports retain their original paths. The predeclared adoption
threshold is mean **whole-child
wait4 CPU** after/before at most `0.98`, all seven measured CPU pairs favorable,
and mean whole-child wall after/before at most `1.02`. These timings include
startup/report work. They are not guest-execution CPU or a calibrated clock
speed. A semantic mismatch or performance failure prevents adoption; no result
is claimed from source controls alone.

Small source controls require no guest or media:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/xv6-js-snapshot-paired/policy_control.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/xv6-js-snapshot-paired/run_control.py
node --test test/i80386-instruction-snapshot-ownership.test.mjs test/i80386-segment-load-contract.test.mjs test/i80386-fault-delivery.test.mjs
```

The hosted gate needs clean before/after checkouts, one fresh xv6 build,
GNU binutils and QEMU. Its original raw reports and process metrics are saved
as an artifact for independent review. No private guest media is used.
