# Synthetic guest-site lifecycle controller — unconnected

Source-only and locally unrun. This controller accepts synthetic ports; it
cannot authenticate a CPU, board, runtime, reset generation or private session.
`guestConnected:false` and `sourceInstanceQualified:false` are permanent.
No CPU, board, sampler addon, guest runner, workflow or default behavior changes.

The ports are an ordinary closed object with exact own data fields (including
nonenumerable and symbol-key closure): `cpu`, `addon`,
`fullGC`, `boardStep`, `tick`, `minorPressure`, `pause`, `resume`, `saveSnapshot`.
The addon has own data methods `begin`, `facts`, `adopt`, `snapshot`, `stop`.
Method references and descriptor flags are retained and checked at callback
boundaries. Accessor and Node-detectable proxy substitutions refuse. Arbitrary
ports satisfying these mechanical checks acquire no source or live authority.

`start()` orders unarmed full GC, begin, zero observed prior GC, instance cohort
installation, and another zero-GC check. Its runtime arguments are synthetic
premises, not an inspection of the current process. `advance()` completes one
supplied board call, including its tail, before observing the cohort and pausing
after64 unique roots. IRQ-only calls do not establish CPU entries. The100000
board-call ceiling is a finite synthetic-controller bound, not a guest profile.
`boardCalls` counts actual callback invocations, including calls which throw,
and excludes pre-invocation fence refusals.

`finish()` privately extracts/adopts roots, saves pre, requires zero GC, crosses
a retained supplied tick, checks zero GC, releases its reference, checks zero GC,
requests the designated major collection or bounded minor pressure, saves post,
stops the sampler, and only then invokes resume. Minor pressure has512 attempts;
exactly one observed GC is required. No roots are returned or serialized by the
controller. Supplied addon/ports can retain references; closing those scopes and
using a genuine event-loop turn is the future source-owned adapter's duty.

Failures retain a bounded fixed reason and primitive progress/admission facts;
source exceptions are rethrown unchanged to the owning caller, which must
sanitize them before public output. Cleanup releases controller roots and
restores the cohort method only if still owned. Private cohort cleanup and root release occur even if external port owners
change. Changed port owners refuse all outside historical-addon stop operations. Sampler stop is attempted once.
Reentry latches the first refusal, including when a callback catches its error.

This unit does not grade weak callbacks, source ancestry, exact sample IDs,
full guest outcome parity, filesystem leases or resource qualification. It must
not be used as a connected launch gate. A later derivative must own exact
source imports and machine construction, final reset, CPU/callback identities,
private root adoption, event-loop turn, pressure, input and diagnostic output.
It must retain all four cases, all64 weak callbacks, designated-event and full
sample-lifetime predicates, fresh ordinary-reference parity and separately
admitted resource limits. The proposed180-second guest bound is not adopted.

Nineteen authored tests in `test/xv6-guest-site-controller.test.mjs` use synthetic
objects only. They are locally UNRUN; no Node, CPU, compiler or guest has executed
for this source slice. Hosted checks and independent review are prerequisites.
