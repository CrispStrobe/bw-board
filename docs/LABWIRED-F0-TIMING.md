# Active STM32F0 timing and main attribution

This is a separate selected-workload harness, not a replacement for the old
short ALU/RAM benchmark or the 64 MHz micro:bit motion qualification.

```sh
env -u NODE_OPTIONS node scripts/probe-labwired-f0.mjs \
  --wasm /absolute/path/to/verified-build/nodejs \
  --out /absolute/path/to/new-evidence-directory
```

The artifact must retain its parent `BUILD-INFO.json`; source commit, original
NODEJS glue and WASM hashes/lengths are checked before execution. Nothing is
published and no app pin changes. Existing output directories are refused.

Two MIT assembly guests are built with Cortex-M0 instructions: active RAM/ALU,
and the same arithmetic interleaved with GPIO IDR polling and BSRR writes.
Both validate progressing RAM receipts. The GPIO guest must read alternating
actual held PA1 inputs and drive PA0 through the peripheral model. Neither
uses WFI or a delay loop. Stops between receipt stores may differ by at most
one iteration; verification never adds uncounted guest cycles to settle them.
The adapter's production recommended peripheral tick policy is unchanged.

Each guest boots outside timing, then runs **five 48-million-engine-cycle
windows at a declared 48 MHz**. Every window must reach 1×; passing RAM cannot
mask failed GPIO. Cycles are the engine's reported accounting, not calibrated
silicon CPI. No circuit solver, observers, debugger or browser/UI is timed.

`ordinary-stdout.txt`, `ordinary-stderr.txt` and `receipt.json` preserve all
windows and guest observations. A failed timing floor remains false in the
receipt. The capture tool can finish successfully with a failed floor, but
rejects missing windows, functional failures, skips, invalid counts or bad
artifact provenance. This is a **diagnostic capture**, not a promotion gate.

Add `--profile` to run a second independent process with CPU sampling, after
ordinary timing. `sampled-*` files and `f0.cpuprofile` remain distinct.
Profiles cover the whole process, including initialization, compilation,
warmup and both workloads; percentages are not isolated GPIO-window costs,
removable overhead or unprofiled RTx. Sampling can affect tiering.

The manual `labwired-f0-profile.yml` workflow accepts an existing build run and
exact core commit. With profiling enabled it additionally runs the unchanged
motion harness in separate unsampled compilation-trace and sampled processes.
It retains raw evidence even on failure. No existing motion qualification or
all-window requirement is relaxed.

For later A/B, run both verified artifacts in ordinary A/B/B/A order and use
`assertSameF0Guest` from `scripts/lib/f0-timing-receipt.mjs` before comparing
timings. It requires byte-identical **loaded binary** hashes and all five
cycle-indexed observation records for each workload. Full ELF hashes remain
provenance: nonloaded assembler temporary-object names can vary. Compare only
within one host/Node/compiler configuration, retain load snapshots, and repeat
before claiming a gain. Synthetic parser tests are not engine measurements.

Next investigations should start from landed main, not either rejected
literal-load branch: live-address rejection/admission overhead, ordinary bus
reads, and GPIO write-hook costs. Never cache MMIO values, skip read side
effects, suppress edges or widen interrupt/debugger guards to obtain speed.
