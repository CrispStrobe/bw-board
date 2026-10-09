# Owned DPMI task excursion: next bounded gate

Status: a task-switch destination was observed, but the owned INT 31h frame
has **not** returned. This is a proposed, separately named diagnostic and
qualification lane. It changes no existing journal acceptance rule.

The [first task-attempt result](https://github.com/CrispStrobe/bw-board/actions/runs/37893093332)
recorded a `jmp` attempt from task selector `0x60` to `0x70` while the owned
AX=0501h frame was open. The [task-outcome run](https://github.com/CrispStrobe/bw-board/actions/runs/37897547815)
at reviewed source [`15afcd6b`](https://github.com/CrispStrobe/bw-board/commit/15afcd6ba9dd1b494c343c6af6307bcf324b0ebd)
retained the same first failure, `task-switch-during-owned-frame`. Its
source-owned `_taskSwitchCore` returned normally and left CS:EIP at
`0x18:0x3ee9`, CPL 0, TR `0x70`, VM86 and NT clear. The journal's committed
INT 31h entry remains present; its return is `null`, and the finite client
did not complete. A normal local core return establishes neither resumption
of the original task nor an IRET from the owned handler. Both original runs
remain failed evidence.

## First slice: observe the excursion without accepting it

Use an isolated source branch and a distinct opt-in diagnostic profile. Keep
the current journal's first refusal and `returned:null` unchanged. At the
already authenticated same-machine main and wrapper cut, require the exact
client, map, media, ROM and source roles, the privately compared wrapper
bytes, unchanged before/after observer fingerprints and a committed owned
software INT 31h entry. Do not arm from a caller-supplied CPU snapshot or
from the public layout object's mutable role list.

Mint a private, one-shot CPU/session cookie when the entry commits. Bind it to
the machine, source instruction and return CS:EIP, handler CS:SS:ESP, the
CPU-consumed linear 12-byte frame role, original TR selector/type/base/limit,
and CR3. Retain the original frame bytes and source-owned descriptor context
under a fixed cap. This is a linear-frame continuity contract; it does not
prove unchanged physical backing or page-table mappings over the excursion.
Any stale token, altered admission identity or second arm fails closed.

For the first diagnostic, capture the already observed outgoing `jmp` and
then continue **ordinary machine steps** only under a separate bound: at most
100,000 subsequent steps, 16 task-transition records and 32 interrupt or
fault records. Record attempted selector/kind/source context, original-core
result or exception, and post-step committed CS:EIP/CPL/VM86/NT/TR/CR3 for
each transition. Distinguish a task-switch attempt, a normal `_taskSwitchCore`
return, a fault after task-state writes, and an enclosing instruction that
actually commits. A local core return alone cannot advance the accepted
frame phase. Retain partial records and the first failure if a bound, fault,
reentry, reset, unsupported mode or observer error stops the run. Keep raw
RAM, TSS images, executable and disk bytes out of the report artifact.

Do not prescribe the return mechanism yet. The source has far transfer and
NT-IRET task-switch paths; the observed outgoing path is `jmp`, but no
return path has been observed. This diagnostic must show the next transition
kind and target, any intervening IRQ/fault, and whether execution returns to
the original TR and owned handler context. An unmatched transition, missing
return, or exhausted bound remains a diagnostic failure, never an inferred
owned IRET. The disabled profile adds no per-step records and preserves
ordinary CPU behavior.

## Later qualification, only after the return path is observed

Define a second, explicit owner profile from the first diagnostic's retained
source-committed events. Its preflight must bind the original task/frame
cookie and every permitted transition. Stage each transition before the
original CPU operation, credit it only after the original enclosing step
commits, and discard it on rollback, exception, trace or reentry. Reject
unexpected task selectors, task nesting, mode changes and unaccounted IRQs
or faults; cap the full sequence and retain the first mismatch. Compare
original TR and handler context on resumption, then require the CPU's actual
matching IRET event to consume the same linear frame role with source-owned
return CS:EIP, flags and selector continuity. Report every admitted event and
its step so an independent reader can check ordering and the still separate
finite client result.

Passing such a gate would qualify this one owned AX=0501h transaction in the
free, pinned QEMU fixture. It would not establish arbitrary task switching,
all INT 31h calls, physical frame stability, a complete 386DX machine,
Windows, games or performance. Source-only and synthetic controls cannot
replace one exact-head hosted guest run with an independently audited original
packet.
