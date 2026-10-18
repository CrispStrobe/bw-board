# Source-owned turn and pressure mechanics — unconnected

This standalone helper copies the imported `node:timers` `setImmediate` into a module-local
constant (the ESM named binding alone is live), and
captures the module's Promise constructor and `Array.from`. It accepts no caller
scheduler, thenable, allocation callback, GC callable or addon. Successful
`tick()` returns a Node-detectable genuine Promise resolved by the captured
immediate callback after the retained event-loop turn. Promise type alone does
not certify the runtime or pre-import integrity of globals: exact Node/source
admission and the source-owned driver remain required.

The lifecycle is created, turn-pending, ready, pressure, finished, or disposed.
`tick()` is once-only. `minorPressure(i)` requires one exact contiguous integer
index starting0, at most511. It privately retains
`Array.from({length:1024}, (_,j)=>i+j)` for each accepted call, matching the held
nursery case's512-call algorithm. Arrays never leave the closure or enter
status. `finishPressure()` releases them before the future post snapshot;
`dispose()` releases them on failure. The helper neither reads GC counters nor
chooses when a collection occurred. A future admitted driver must stop pressure
at the first source-owned event and retain all designated-GC predicates.

These dimensions count array elements and calls, not actual V8 allocation
bytes. The selected pressure source is
`scripts/xv6-js-rollback-direct-v8-target-site-nursery/case.mjs`, lines65–72,
at `3a0e595c7b813a753fd79c436bfafe2c20cea690`, SHA-256
`4cd10a246a128b632d112494c7dd8765fda08276c64422db8358a7078647c083`.
No cap widening, nursery resizing or sample-ID exclusions are introduced.

Closed primitive status grants no roots or reset/session/source authority.
Wrong order, malformed arguments, duplicate indices and synchronous reentry
latch the first fixed refusal and release pressure references. Pending-turn
disposal rejects the original promise when its scheduled callback arrives;
it cannot later become a successful turn. A scheduling exception is latched as
`tick-scheduling-threw`, with no completed or successfully scheduled turn, and
the original native Promise is returned with the original rejection object.
The helper does not throw a second error after creating that rejected Promise;
the owning adapter must attach its rejection handler promptly. The owning future adapter must retain
original errors and sanitize them before public reporting. No fullGC, addon,
CPU, guest or compiler operation is invoked by this helper.

`runtimeQualified:false`, `sourceInstanceQualified:false` and
`guestConnected:false` remain permanent. This does not connect the controller,
validate weak callbacks/sample ancestry, establish external root lifetime or
qualify resource bounds, parity, a guest or performance. Exact runtime/source
imports and callback/reset fences must precede a separately reviewed connection.

Sixteen authored tests in `test/xv6-guest-site-runtime.test.mjs` are locally UNRUN.
They use genuine hosted turns and small manufactured pressure cohorts; cap and
algorithm checks inspect source without512 allocations. A test-local fresh import captures an allocation shim to exercise swallowed
synchronous reentry, then restores the global; this is not runtime qualification.
Separate test-local push reentry and synchronized builtin-export replacement
controls restore globals/exports and assert no successful pressure credit or
replacement turn call. No public test injection port is provided. No local Node, GC, CPU, guest or native operation has executed.
