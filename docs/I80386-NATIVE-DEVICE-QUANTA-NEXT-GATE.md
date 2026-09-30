# Native 386 successful-work clock gate

**Status: implementation contract, not an execution or performance result.**
The [ordinary-instruction PIT/PIC proof](I80386-NATIVE-DEVICE-SELF-PARITY.md)
landed in PR #181, merge `bad619572be8c8ac9488696ce825383284f01f30`.
It explicitly rejects REP and faults. The next separate prototype must connect
those CPU boundaries to the actual I8254/I8259 models without equating native
ticks to functional board clocks. Preserve the earlier prototypes, builds and
receipts.

## Clock and stop contract

The existing JavaScript AT profile charges six board clocks for a successful
CPU step. A REP step performs one successful element; its final element gets
the same charge. A zero-count REP completes once without accessing its data
operand. A delivered fault gets no successful-step charge. These are
functional scheduling units, not measured physical 386DX instruction cycles.
See [`_repeatString`](../src/experimental/i80386.js) and
[`ExperimentalI80386ATMachine.step`](../src/experimental/i80386-at-machine.js).

Pinned Bochs CPU3, with handler chaining and REP speedups disabled, ticks for
each intermediate REP element, the final outer completion, and a delivered
fault. Its REP loop checks asynchronous stops **before** the intermediate tick.
Consequently a host timer transition reported only by that tick can miss the
stop boundary and allow another element. A new source transform must put the
successful-element notification after the CX/ECX decrement and before that
stop check. The outer completion notifies ordinary successful work only if
the current attempt performed no successful REP element and is not partial.
This charges zero-count REP once and never charges the final REP element twice.

The new ABI and BWS8/BWR8 transport keep distinct successful-work and native
tick notifications. Each successful-work notification immediately advances
the actual device models by six board clocks and returns whether a transition
requires a cut. Each native tick advances only its own ledger. The first proof
does not batch device debt. PIO therefore observes all previously successful
work, but not a charge for the instruction that has yet to complete.

A due flag, successful-work limit, native tick safety limit, or PIO stop must
break a nonfinal REP before its next element. A final element may return
normally, then the outer tick and safe slice return expose the same due event.
Host INTR changes remain legal only between resume calls, after architectural
progress is committed. Actual PIC acknowledgement remains in Bochs' eligible
interrupt path. The host must not convert a PIT horizon to an absolute native
tick deadline after faults. Explicit native deadlines can remain a separate
ABI facility; this device runner supplies no such inferred deadline.

## Free fixture and required evidence

Set up identity 4 KiB paging, the page-fault and IRQ gates, and a single PIC.
Leave pages 5 and 6 nonpresent, retain valid code, stack and page-table pages,
and program PIT0 mode 0 with a short one-shot reload. Under CLI, execute
1028 REP STOSL elements from `0x4000`. The actual timer edge must occur inside
the early successful REP prefix, producing a safe cut and pending PIC IR0
before the next element. Retain that IRQ through the remaining work under CLI.

After 1024 successful stores, the element at `0x5000` must fault with error 2,
CR2 `0x5000`, and saved EIP at REP. The failed element earns no successful-work
charge or data commit. Earlier elements remain committed and charged. The
owned handler repairs PTE5, reloads CR3, removes the error dword and uses IRETD;
retry completes the last four stores. Preserve the relevant guest registers.

Execute zero-count REP at unmapped `0x6000`: require one successful-work charge
and no data access. An ordinary store there then causes the second owned fault,
with a distinct saved instruction address. Repair PTE6 and retry successfully.
A one-element REP at `0x6004` must charge once and store once. STI and its
successor precede the pending actual PIC acknowledgement; the handler sends
EOI and returns. End at CLI/HLT. The earlier proof already covers timer wake
from HLT; this fixture establishes the transition during active CPU work.

Compare continuous execution and successful-work budgets 1, 2 and 257, with
an independent native tick safety cap. Bind source, fixture symbols, binary,
configuration, ROM, activation state and RAM seed. Require exact successful
work totals and per-attempt classification, both fault frames/retries, no
failed data commits, REP progress across all cuts, real PIT/PIC ordering and
fractional state, PIO/RPC chronology, selected final CPU/RAM, and zero fallback
counters. In this bounded fixture native ticks should equal successful-work
units plus the two fault ticks; validate the raw events as well as totals.

Retain actual API, transport and fallback rejection probes. Add mutations
against double-charged final REP, uncharged zero-count REP, charged faults,
lost committed REP progress, delayed active timer cuts, premature IRQ ACK,
and plausible but incorrect device clock state. Independently reproduce the
final source-bound proof before publishing receipts. A self-parity result
still does not establish full AT reset/board parity, general REP I/O, trap
accounting, WASM integration, Windows compatibility, or the 10×/RTx target.
