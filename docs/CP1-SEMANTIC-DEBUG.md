# Hash-qualified CP1 command debugging

The debugger observes firmware running on the existing `Cp1Machine`. It does
not interpret CP1 instructions, change firmware variables to execute a command,
press a key automatically, or own another clock. The same 8049 executes every
instruction and the same adapter advances the circuit.

## Provenance and qualification

The implementation writer received no GPL emulator code, annotated firmware,
translated code, pseudocode, or implementation structure. This increment uses
the independently authored machine and externally supplied factual observations
of original programs running on it. Its observer and synthetic test ROM were
written independently. Discovery and acceptance did not load a GPL reference
emulator. Earlier optional oracle work is separate: [CP1-ORACLE.md](CP1-ORACLE.md).

The built-in profile is `cp1-2716-observed-v1`, for SHA-1
`ff4befcf82a664950186d3af1843fdef70d2209f`. SHA-1 is an exact-byte identity key,
not authentication or a license grant. Mask ROM B is identified by the machine
but has no qualified semantic mapping. It and every unknown ROM retain raw
8049 inspection, instruction steps and code breakpoints.

These facts were supplied by the separate runtime qualification agent. Addresses
are hexadecimal unless labeled as a CP1 cell.

| Observed fact | Qualification |
| --- | --- |
| Raw PC `627`, outside an interrupt, precedes a command | Literals, full-cell load/store, branches, invalid opcodes, delays, original STEP, start cell 37, CP3 cells 128/129 |
| Internal RAM `38` is the teaching PC | Sequential and nonsequential addresses, including the upper CP3 bank |
| Internal RAM `36`/`37` is the accumulator opcode/operand pair | Loading cell 90 = `17.231`, storing both bytes to cell 91, then AKO 73 replacing the pair with `00.073` |
| Internal RAM `3a & 20` is the comparison condition | VGL equality, VGR greater, VKL less, opposite outcomes and true-to-false replacement; the CP3 bank bit is separate |
| Raw PC `086`, outside an interrupt, is a settled monitor return | HLT, original STEP, STP, errors and idle operation |
| The display buffer begins at internal RAM `20` | Its first mask `71` is F; masks at `23..25` yielded errors 002 and 006 |

The comparison field is the current firmware bit, not a historical log. HLT
and firmware initialization can clear it. Internal RAM `34` **is not a run
flag**: it changes with key press/release during long commands and is omitted.
Error detection uses the buffer only at the qualified monitor marker. Integrated
display pixels may retain older multiplexed segments and are not an error
detector. Unrecognized decimal masks yield `error.code: null` with raw masks.

## Public target contract

```js
const target = createCp1DebugTarget(createCp1Adapter({rom: supplied2048Bytes}));
target.onEvent(event => console.log(event.type, event.command, event.accumulator));
target.onHalt(why => console.log(why.cause, why.cp1Step));

// After firmware initialization and loading, set a breakpoint and use the
// original RUN contact. When stopped at the command boundary:
target.setBreakpoint({kind: 'cp1', space: 'program', addr: 0, stopSide: 'before'});
target.step('cp1', 1, {maxInstructions: 1000000});
target.runFor(16_666_667); // DebugSession/host pumps further slices if needed
const teaching = target.semanticState();
```

`capabilities()` is dynamic. Qualified ROMs add `cp1` to `steps` and
`breakpoints`, and advertise `cp1.command`, `cp1.halt`, and `cp1.error`.
`extensions.cp1Semantic` names the default instruction budget, cell address
unit and installed range. Base addresses are 0–127; CP3 addresses are 0–255.
Raw `code` breakpoints still address 8049 ROM bytes 0–2047.

`semanticState()`, `regs().cp1`, and `snapshot().cp1` provide detached views:

| Field | Meaning |
| --- | --- |
| `available`, `profileQualified`, `profileId`, `romSha1` | Exact-ROM admission; unavailable views explain the fallback in `reason` |
| `pc` | Teaching-cell PC, distinct from raw CPU `regs().pc` |
| `accumulator` | Complete `{opcode, operand}` pair |
| `comparison` | Optional `{label, value}` for a qualified condition bit |
| `execution` | `unknown`, `ready`, `running`, `halted`, or `error`, describing the teaching program |
| `atCommandBoundary`, `boundaryId` | Dispatch outside interrupts and its observation identity |
| `command` | Current `{address, opcode, operand}`, or null if none is attributable |
| `sequence`, `lastEvent` | Monotonic event number and last event; no unbounded trace is retained |
| `epoch` | Invalidates control after reset, restore, ROM replacement or mid-command program edit |
| `step` | Pending or most recent semantic step counts, result and budget |

`ready` is before a command; `running` means it has begun. Debugger pause does
not change that fact. At monitor idle the teaching state is `halted` while the
8049 can keep refreshing and scanning. `unknown` means no usable transition has
yet been observed. Reads do not advance time, sample pins, or emit events.

## Steps and breakpoints

`step('cp1', count, {maxInstructions})` arms asynchronous work without advancing
time. Accepted requests return undefined; refused ones return an explicit
reason. `DebugSession.step('cp1', count)` uses the default budget. Counts must
be in 1..1,000,000. The default total instruction budget is 1,000,000; an explicit
budget must be in 1..10,000,000. Each `runFor` remains capped at 100 ms and the
machine's per-advance step cap.

A paused partial command is completed if its start was observed. An unobserved
state first waits for a qualified boundary and never invents a completed partial
command. Known monitor idle/error refuses immediately: use the original STEP
key, or a CP1 breakpoint followed by RUN, to enter command stepping.

The budget applies across host slices. The result reports `requested`,
`completed`, `instructions`, `interrupts`, `cpuSteps`, `maxInstructions`, and
consumed `cycles`. Interrupt entry retires no opcode and completes no command.
A CPU-step ceiling of twice the instruction budget plus one also bounds an
interrupt-only path. Exhaustion gives `status: 'limit'`,
`reason: 'instruction-budget'`, and halt cause `step-limit`. Another explicit
step can continue the unfinished command.

Completion has reason `complete` and halt cause `step`. Firmware halt/error
stops a pending semantic step with reason `halt`/`error` and cause
`cp1-halt`/`cp1-error`. Free running continues after the same events. User pause,
breakpoints and raw instruction stepping explicitly cancel pending semantic
work. Reset clears it; external state/profile replacement stops it before
another instruction executes.

Breakpoints stop before a command. Resume/step exempts that boundary once;
self-branching to the same cell gets a new identity and hits again. Interrupt
entry and RETR to an unexecuted dispatch preserve the identity. Raw and teaching
breakpoints coexist. Program edits at a paused boundary are re-read before
execution. A public program edit during an unfinished command invalidates its
attribution and pending step, avoiding false completion events. Observer state
is not replay qualification and is not added to the versioned machine checkpoint.

## Events and limits

`onEvent(listener)` returns an unsubscribe function. Events and nested values
are frozen. They contain `type`, `kind`, `sequence`, profile/ROM identity,
`rawPc`, `cycles`, machine-relative bigint `tNs`, teaching `pc`, accumulator and
qualified comparison. JSON writers must serialize bigint timestamps explicitly.

`cp1.command` names the command reaching the next dispatch, with
`accumulatorBefore`, `startCycles`, `commandCycles` and `outcome: 'completed'`.
Observed HLT emits a command with `outcome: 'halted'`, then `cp1.halt` with
`reason: 'hlt'`. Other monitor returns emit `reason: 'monitor'`: original STEP
and STP are not distinguished or falsely counted as completed HLT. `cp1.error`
contains `error: {code, digits}` and does not count a failed command as completed.
Repeated monitor/error visits do not flood listeners.

Passive execution notifications cover adapter and direct-machine advances.
They run at CPU instruction boundaries under the machine's execution guard,
not at individual bus phases. There is no alternate interpreter or clock. The
host still chooses one clock-driving owner. Destroy detaches the observer and
adapter. Custom data-only profiles may be passed explicitly as `semanticProfiles`
for independently qualified firmware; the test fixture uses this path.

This profile establishes observed boundaries on this engine. It does not
qualify mask ROM B, every firmware path, physical timing, bus phases, replay,
cassette operation, or arbitrary firmware edits. No historical ROM is bundled.

## Reproducible checks

`test/cp1-semantics.test.mjs` supplies an original tiny 8049 monitor and explicit
hash-matched profile. It tests real CPU/MOVX/8155 execution, full accumulator,
both breakpoint levels, loops, interrupt returns, partial budgets, HLT/error,
passive snapshots, edits, checkpoint invalidation and `DebugSession` ownership.

The optional ROM check accepts a caller-owned local file only:

```sh
node scripts/check-cp1-semantic-rom.mjs /path/to/user-monitor.bin report.json
```

Eleven original scenarios cover full-cell load/store, comparisons/branches,
comparison clearing, nonzero start, CP3, delay budget/resume, F006 overflow,
F002 invalid opcode and loop breakpoint reentry. The
[retained report](CP1-SEMANTIC-OBSERVATION.json) hashes all participating source
files and the script; it contains no firmware bytes. These are observations on
the independent machine, not physical-hardware or external-oracle qualification.
