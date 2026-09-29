# Opt-in 386 execution-mode CPU profile

Set `AT_MODE_CPU_PROFILE=1` for an ordinary, noninteractive
`scripts/run-i80386-at-console.mjs` run. The console report gains a
`modeCpuProfile` field. Native blocks, code16 load execution, and code16
coverage are deliberately incompatible with this measurement so every guest
step is classified once. With the flag unset, the console follows its normal
path and omits the field.

The profiler classifies each completed `machine.step()` call by its **entry** mode:
real mode when CR0.PE is clear, VM86 when EFLAGS.VM is set, otherwise
protected 16-bit or protected 32-bit according to the cached CS default-size
bit. A mode-changing instruction belongs to the mode in which it began. The
step-call counts cover exactly the guest steps reported by a completed run.
Some calls can deliver a fault or process HLT without retiring an instruction,
so the CPU-time split is by entry mode of step calls, not strictly by retired
instruction mode.

The clock is `process.cpuUsage()`, sampled after at most 1,024 steps and also
immediately before the first step of a different mode. An interval is charged
to a mode only if every entry step in it has that mode. Mixed intervals, if
any, are reported separately rather than apportioned. `pureUserMicroseconds`
and `pureSystemMicroseconds` include the CPU, AT board, console loop, and
sampling overhead during those intervals; they are not emulator-core self
time. Startup, output serialization, and work after the final sample are not
included. Compare the sum to an external process CPU timer to quantify that
gap, and compare paired flagged/unflagged runs to bound sampling overhead.

This diagnostic does not accelerate guest execution. A mode's measured share
is the relevant starting point for an Amdahl bound; a share of guest steps is
not a share of CPU time. Keep the full guest report and media hashes for any
private workload comparison. Do not put commercial media or private guest
output in this repository.

In two pinned 60-million-step Windows 3.11 runs, real, protected16 and VM86
entry modes accounted for 69.8% and 70.2% of attributed user CPU;
protected32 accounted for 30.2% and 29.8%. No sampling interval mixed modes.
The paired flagged/unflagged controls had identical normalized guest output;
sampling added 2.41–2.86 user CPU seconds. The
[source-bound aggregate receipt](receipts/2026-09-27-i80386-ordinary-windows-profile-attribution.json)
records these mode shares alongside a separate V8 profile. The mode clock
includes board and runner work, so it does not measure removable emulator
cost or imply a speedup from any execution path.
