# Nonguest perf capability control

Manual and disabled by default. This source-owned control samples only a fixed,
ordinary C workload compiled with `-O2 -fPIC -pthread`, comparable default unwind
settings to the existing native build. It contains two explicitly recorded TIDs
and a noinline leaf/middle/chain. It does not load an addon, emulator, media or
restore an artifact, and does not change packages, sysctls or privileges.

The exact command uses software `cpu-clock`, 99 Hz and DWARF callchains. Perf and
compiler requested-launcher hashes/versions, source current/Git identity, kernel, CPU,
OS and perf_event_paranoid are retained. Raw perf.data, raw script output,
invocations, stdout/stderr and exit/timeout evidence remain reviewable.

Tool absence, permission/record refusal, missing script capability, lost events,
incomplete two-thread coverage or unresolved nested workload frames on either TID yields an
explicit unsupported/insufficient result. There is no fallback workload or retry.
Success qualifies only this workload's thread inheritance and stack resolution;
it does not establish Bochs, JIT or all-application unwind coverage. Sampling
proportions are not calibrated CPU shares or a removable-cost forecast.

Each tool command uses fresh process-group containment, nice 10, core 0 and an
8 MiB per-file cap. Version/record/script CPU5/wall10; workload compile CPU10/
wall15. Timeout stops and kills the entire group; this closed C workload never
creates an independent process session. Python heap is not claimed; no Node runs.
The workflow's three-minute outer bound covers the sequential nonguest commands.
Three bounded pure controls passed (parser/refusal, closed options, mocked
interruption cleanup), with unchanged before/after pins. The mocked cleanup
control does not prove actual kernel cleanup. No local capability probe, compiler,
workload or guest has run for this source preparation.

Launcher hashes do not authenticate a delegated effective perf binary. Effective
executable provenance is explicitly unresolved unless separately observed; fixture
sampling success alone cannot grant a guest profiling run.
