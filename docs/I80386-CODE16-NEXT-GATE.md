# Code16 after first-byte admission: next measurement gate

This plan is pinned to board revision
`aafffc245c4c2cc286bb8a226ca5a8efa0962bc2`, which merged the
[retained first-byte admission change](I80386-CODE16-WINDOW-ADMISSION.md).
Its measured two-pair opt-in mean was 259.56 seconds of user CPU for the
private 60-million-step Windows 3.11 input. That remains much slower than
the earlier ordinary 78.52-second checkpoint. The next question is whether
a **broader event-aware code16 executor** has enough reachable work to
justify implementation after the first-byte copy cost was removed.

First, make one post-change opt-in 60M execution with V8 CPU sampling at a
requested 5 ms interval and no per-call timers. Use the same private input,
`AT_CODE16_WASM=1`, diagnostics, and form census as the measured A/B pairs.
Keep a private raw report, profile, `/usr/bin/time` output and start/end host
load. A media-neutral reducer must verify the selected reported guest fields
and six opt-in counters against the retained [A/B receipt](receipts/2026-09-28-i80386-code16-first-byte-admission.json),
and compare execution-source hashes. The console source inventory now
includes the code-window, EA and data-window helper modules. The merged
runner changed its source-list metadata after the A/B timing; that expected
runner hash difference must be identified, not silently normalized away.
No private media identifier, path or guest text goes into the public result.

Classify each V8 **self sample exactly once** by its leaf frame and call
ancestry. The disjoint bins are code-window proof, block decode,
preparation, dispatcher admission, dispatcher diagnostics, other dispatcher,
ordinary interpreter/board called below the code16 dispatcher, WASM, and
remaining process work. Report both counts and percentages using **all
process self samples** as denominator. A dispatcher frame and its callees
must not both receive the same sample. Samples indicate where CPU was
observed; they are neither removable time nor a speedup bound. The first
screen for an event-aware trace is at least **20% of all process self
samples** in the non-window dispatcher bins plus ordinary fallback.
The code-window proof bin is excluded because first-byte admission already
targeted it.

If that screen passes, build a media-neutral, non-executing feasibility
observer before changing the runtime. It must report the exact number of
completed step ordinals entered in real, protected16 and VM86 modes. That
is the denominator for coverage; the older 44,722,493 such entries is a
cross-check, not a substitute for the new count. Partition those ordinals
into **maximal, disjoint** candidate runs, capped at 64 instructions and
split at an unhandled I/O, interrupt, chip event, fault, translation change
or code/data mutation boundary. Do not count nested starts or count one
retirement twice. Feasibility requires both:

- Mean length of **all admitted candidate runs**, including short ones, at
  least four retired instructions per run.
- Unique mode-eligible step ordinals in admitted runs of length at least four
  divided by all real/protected16/VM86 completed step ordinals, at least 25%.

The owned [protected16 branch-to-I/O fixture](I80386-WIN16-IO-BOUNDARY-ORACLE.md)
and [opt-in trace fixture](I80386-CODE16-OWNED-IO-TRACE.md) are the first
correctness boundary. Any future executor must stop before the `IN`, retain
the zero-then-one device-read count, and reject branch, deadline and code
mutations. A broader memory/stack/segment grammar also needs exact
translation, permission, dependent-address, write-coherence and fault-order
checks. The earlier selected-form syntax observer averaged only 3.20 steps
per run; this gate requires a broader, executable-safe result rather than
extrapolating that optimistic census.

Only after both measurement screens and focused oracle tests pass should
an opt-in runtime prototype be timed. Retain it only after two alternating
unprofiled 60M A/B pairs against the retained first-byte path, matching
selected and normalized full reported fields, at least 10% mean user-CPU
gain and no individual regression. The report still omits full RAM, disk
and hidden CPU state, so the acceptance claim must stay at reported-field
parity. Default-path adoption would additionally require a contemporaneous
ordinary-vs-candidate comparison. No runtime change or new full-run timing
is part of this planning note.
