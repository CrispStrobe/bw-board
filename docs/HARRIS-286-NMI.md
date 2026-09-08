# Opt-in wired 286 NMI foundation

2026-09-08. `createHarrisMemoryBoard({enabled:true,nmiEnabled:true,...})` opts
the experimental board into NMI handling. The default remains off. CPU, bus
and board capabilities report `nmi` separately from general interrupt support.

## Source-backed scope

The [Harris 80C286 datasheet](https://datasheets.chipdb.org/Harris/80c286.pdf),
August 1996, file 2947.2, printed pages 3-71 and 3-79, specifies edge-triggered
NMI, vector 2, independence from IF and no acknowledge cycle. It requires four
system-clock periods low and four high for reliable recognition. Its checksum
is retained in `harris-80c286-contract.js`.

The [Intel 286 programmer's manual](https://bitsavers.trailing-edge.com/components/intel/80286/210498-005_80286_and_80287_Programmers_Reference_Manual_1987.pdf),
sections 9.2 and the MOV/POP entries, describes NMI blocking until IRET,
one remembered request, and interrupt inhibition through the instruction after
loading SS. The manual checksum is in [system-state notes](HARRIS-286-SYSTEM-STATE.md).

The implementation uses a conservative digital qualification rule, **not**
an analog synchronizer or a cycle-exact model of silicon recognition latency.
Short pulses are deterministically rejected. Real silicon behavior outside the
documented pulse requirements is not claimed.

## Implementation

- Bus sampling uses the resolved CPU `nmi` net. A disconnected/unknown signal
  fails; no host vector callback is substituted for a signal.
- A qualified rising edge sets one pending latch. Held-high input cannot
  retrigger, and repeated edges coalesce while pending. RESET clears the latch.
- CPU delivery waits for an instruction boundary and completed memory writes.
  It pushes the actual FLAGS/CS/IP through wired memory, then reads vector 2
  using IDTR. External entry is counted separately, not as a retired opcode.
- Successful MOV SS and POP SS defer NMI through the following instruction.
  NMI entry blocks further NMI until IRET. Unblocking at IRET start, including
  a subsequently faulting IRET, is model behavior requiring further hardware
  validation; nested-fault/shutdown execution remains unsupported.
- REP may pause after a complete element. Completed data and SI/DI/CX updates
  stay committed; the saved IP points to the first prefix. IRET re-fetches the
  instruction and processes the remaining count. An incomplete element cannot
  be interrupted by NMI.
- An opted-in halted CPU can receive clocks with `stepClock()` and wake on NMI.
  `run()` still stops at HLT; it does not introduce an unbounded idle loop.
  No physical HLT bus-cycle signaling is claimed.

For test/lab use, drive the board's `inputs.nmi` net through its circuit, then
clock the CPU. This is not a new application GUI control or saved-profile field.
`inspect().nmi` reports the delivery count, block state and SS shadow; it is a
defensive inspection value, not a live snapshot API.

## Acceptance and remaining work

Final local targeted run: **159/159 tests passed, zero skips**, including
thirteen new NMI/bus tests. Full pinned real-mode SST286 regression:
**1,477,997 passes, zero failures/unsupported/budget, three upstream
revocations**, exit 0. The [new hashed receipt](SST286-NMI-REPORT.json) pins CPU,
adapter and runner sources; it does not grade the physical bus/NMI path.
No full CI or browser acceptance was run.

Owned tests cover HLT wake/IF independence, stack return address, IRET, held
levels and fresh edges, pending-edge coalescing, SS shadows, delayed writes,
REP restart/no duplicate stores, invalid IDT limits and disconnected inputs.
Bus tests cover pulse qualification, reset and continued INTR refusal.

The full SST286 real-mode suite is a regression gate, **not an asynchronous
interrupt oracle**. It supplies no NMI inputs and cannot establish NMI timing,
single-step priority, protected-mode interrupt rules or bus arbitration.

The later [INTA sequencer foundation](HARRIS-286-INTA.md) implements an opt-in
bus transaction for the pair, but the wired CPU/controller still refuse INTR.
Their next integration gate includes two acknowledgement
cycles, vector input on D0–D7, cascade/address release, the specified idle gap,
external READY wait logic and controller tests. Existing memory-only controller
logic must not silently stand in for that path. Also remaining: debug/trap
priority, general LOCK/HOLD, complete halt/shutdown/reset integration, physical
devices and actual wired 286 DOS boot. No application pin/default changes,
merge, deployment or new media distribution accompanies this increment.
