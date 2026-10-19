# Stock xv6 JavaScript accelerator paired result

Updated 2026-10-07. [Actual run 37627659600](https://github.com/CrispStrobe/bw-board/actions/runs/37627659600)
passes semantic and performance gates at source
`22ca742ed60e1350ed96110986a09b2ce84620ac` in
[PR429](https://github.com/CrispStrobe/bw-board/pull/429).
Root and a separate reviewer independently audited the original artifact with
standard-library readers, without importing producer helpers or rerunning the guest.

## Workload and measured result

Both arms use the same freshly built MIT xv6 `forktest`, 4 MiB RAM, free Bochs
BIOS, LGPL VGA BIOS and lean reporting. Ordinary JavaScript is compared with
the existing opt-in protected32 native block dispatcher. This dispatcher is
separate from the experimental Bochs CPU3 addon and from code16 WASM. The
xv6 profile uses explicit PSE/APIC extensions; it is not strict original 386DX.

There are two excluded warm-up pairs and seven alternating measured pairs,
with a fresh child process for each arm. Host: AMD EPYC 9V45, four logical
GitHub CPUs, Node 20.20.2, Ubuntu GCC 13.3.0. These are `wait4` whole-child
CPU and wall measurements, including startup and report generation.

| Measurement | Ordinary JS | Protected32 dispatcher | Dispatcher / ordinary |
| --- | ---: | ---: | ---: |
| Mean whole-child CPU seconds | 7.745459 | 5.906630 | 0.762593 |
| Mean whole-child wall seconds | 6.609802 | 4.455913 | 0.674137 |

All seven measured CPU pairs favor dispatch. It passes the predeclared gate
of at least 10% lower mean CPU and seven favorable pairs: approximately 24%
less CPU and 33% less wall time, or 1.31x CPU and 1.48x wall speedup for this
workload. This is not a 10x result or a physical 16 MHz 386DX RTx measurement.
No same-workload VPS, Kaggle CPU or GPU comparison was obtained.

## Semantic evidence and limits

All 18 children complete 24,338,279 steps and the exact `forktest` serial
transcript and input. Full reported CPU instruction snapshots, final screen,
board clocks, LAPIC/IOAPIC fields, interrupt prefixes and full RAM/both disk
hashes match across both arms and every pair. Each dispatch child retires
16,428,211 instructions through the accelerator. Dispatch-only shared-RAM
and block counters are authenticated separately, rather than dropped from
ordinary architectural comparison.

The independent audits bind 70 runtime/media source roles and seven harness
roles to exact Git bytes, check all raw-report/admission/process hashes,
recompute each pair and timing ratio, and verify clean exits and resource bounds.
Raw RAM/disk/media/kernel bytes are omitted; their matching hashes and fresh
build receipt are bindings, not independent replay of omitted guest memory.
Interrupt logs are capped at 64 entries, not a complete ordered bus trace.

[Artifact 11484909563](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11484909563)
contains 89 members, ZIP 140,040 bytes, SHA256
`9dbe478782e2a0ddbbc75d19ec6c2389a55473cc9517908d376b476e39740330`.
The inventory binds all closed evidence files; parent stdout/stderr are retained
but explicitly excluded because they remained open during inventory creation.
See the [summary receipt](receipts/2026-10-07-xv6-js-paired.json).

Keep ordinary JS as default. This finite opt-in acceptance does not qualify
all guest workloads, GUI dependency adoption, complete AT behavior or a new
native backend. Next profile the actual remaining cost on this functional
workload, then make one bounded optimization with the same semantic gate and
independent checks. Add broader free protected-mode application coverage before
considering a default change; keep the failed Bochs-addon speed results separate.
