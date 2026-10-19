# Private cold MEMORY clock fusion source candidate

This is a separate source experiment derived from authenticated typed baseline `f4a2f2ce`. It combines a nonempty MEMORY clock tape and physical callback in one outer JS call, with complete source-owned seven-word validation before the memory effect and unchanged native validation/observed-byte checks after return. Empty tape and other barriers retain their original paths. The [design](DESIGN.md) identifies the new trust seam and profile.

CPU benefit is unknown: the pre-effect assertions and independent ledger/operand/reply copies may cost more than the removed outer entry. Entry-attempt counters are not logical N/Q counts or sampled cost shares. C ABI4 and all five typed-state slots remain unchanged; this candidate still needs its own authenticated addon/build/worker admission. It cannot reuse the existing typed DSO merely by ABI version.

Actual source controls are split, with the first failure preserved:

- At `aea26ff2`, the first bounded five-control invocation passed the three JS callback/order/aliasing controls, then failed two generation controls because the lookup anchor also matched the capture loop. Packet: `/tmp/native-cold-memory-fusion-pure-controls-20261004` (exit 1, no timeout, 2.395309 s).
- The one-line exact-anchor correction at `3f5ac1c0` passed only the two affected inverse/C-preflight/mock-NAPI-syntax controls. Packet: `/tmp/native-cold-memory-fusion-affected-controls-20261004` (2/2, no skips, exit 0, no timeout, 2.282331 s).

Both invocations retained commands, raw TAP/streams, and complete 69-file current/Git and tool before/after pins; all pins were unchanged. Limits were CPU 10 s, wall 30 s, actual Node heap 128 MiB, file 8 MiB, core 0, nice 10 and six blank hooks. The C control executed the exact small preflight predicate with mocked effects; the generated bridge helper compiled against mock NAPI declarations. This does not establish actual NAPI signatures, Bochs integration, real chip/guest parity, timing, build admission or adoption. No addon/core build or guest ran.
