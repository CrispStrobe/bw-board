# Direct native 386 board adapter: work in progress

This experiment replaces the qualified CPU3 bridge's per-access FIFO protocol
with synchronous Node callbacks. The actual AT machine continues to own RAM,
ROM decoding, PIO, A20, PIC, PIT and successful-work clocks. The JavaScript CPU
does not execute instructions. It is not yet a production CLI or GUI backend.

The starting oracle is
[the qualified combined paging/RAM/REP fixture](I80386-NATIVE-COMBINED-PAGING-RAM-ACTUAL-BOARD.md).
Its original 63 measured inputs, native build and published capture remain
unchanged. The direct adapter has separate sources, builds and artifact hashes.

The first build used source `1202a6f18605add81171a5269f8080a3bfcb2a48`.
Its addon SHA-256 is
`9ca591832634c43380e319b96cd5cd1446662fdda3927f9e5f310cf9a708ced0`.
The build and static configuration checks passed. The first capture-disabled
guest run aborted with `direct-scalar-mapping`; it is a failed diagnostic,
not a qualified run. The board changes A20 during port output, while native
mapping publication follows the ordinary instruction's successful quantum.
The new callback check incorrectly expected the old mapping during that gap.

Source `9b3ce7bc561e42125d2afe6c390c95213ff21ebe` fixes that check. Pending
mapping permits only an ordinary quantum, checked before the host callback;
its reply must report the staged next A20 state and epoch. Native publication
still occurs at the original instruction boundary. A separate second build
passes its capture-disabled smoke run. Its addon SHA-256 is
`f2aff576397a8b3cc6544a93fc8551403fc66efc1184146b857cba5295a871cb`.
The run completes 194 native ticks, 192 successful quanta and 1,156 board clocks,
with marker `RPGC001`, two mapping epochs and zero JavaScript CPU cycles.
Independent root checks match its complete RAM hash and callback counts to
the qualified FIFO receipt. Original first-build and failed-run artifacts are
retained. The subsequent r3 build provides the ordered comparisons below.

The adapter uses persistent native execution buffers, synchronous calls on the
initializing thread, and one terminal initialization lifetime per loaded image.
The loader admits one canonical addon in the main JavaScript realm. Direct
`require()` bypasses and independently copied shared libraries are outside that
loader guarantee. Fatal failures currently abort their process, so diagnostics
and negative controls run in children. No initializer quit context survives
its stack frame; configuration and argument pointers have stable storage.

The third build uses compiled source `3c9515b28a3b9d9f3be0da7612bd5384477d9664`.
Its ABI is version 2 and its addon SHA-256 is
`13e3dfaa0fc45e2bc5eb5de6da010f7264e150205c87ae103b35f16176cc9e9e`.
Borrowed callback bytes are copied before JavaScript metadata getters run;
shared and detached buffers are rejected. Native counters remain authoritative.

The actual paired harness at `34b64c1935dc2c966b2c2c74675da23983f39f47`
passes continuous, 1, 2 and 257 tick budgets with capture both enabled and
disabled. Each mode agrees with the actual FIFO fixture on 952 ordered memory
records, complete CPU/cache records, board checkpoints, A20 generations and
whole RAM. Eight child-process lifetime/buffer controls also pass, including
getter-triggered detachment after the bytes have already been copied.
The [independent root audit](receipts/2026-10-01-i80386-native-direct-r3-root-pair-audit.json)
records 20,256 checks. Native CPU and effect records are retained; transport
and administrative ordinals have explicitly bounded projection rules.
Twelve regression tests authenticate exact lossless actual r3 captures and
reject eleven coherent semantic mutations. These comparisons establish this
bounded fixture's parity; final source-bound qualification remains pending.

Seven fresh-process samples after two discarded OS-cache warmups give guest
execution **38.173 ms minimum, 56.065 ms median, 76.544 ms maximum**.
[Timing receipt](receipts/2026-10-01-i80386-native-direct-r3-short-timing.json)
and [host context](receipts/2026-10-01-i80386-native-direct-r3-timing-environment.json)
record the split between assembly, addon loading, board construction, native
startup, execution, settlement and serialization. Execution includes actual
board callbacks and resume snapshots. The host is a shared four-vCPU KVM VPS
with an Intel Xeon Skylake CPU, about 8 GiB RAM and Node 20.20.2. Every sample
matches the complete reference CPU, counters, board and RAM state.

This 194-tick guest is a correctness fixture. Fresh processes do not warm the
JavaScript JIT or native core. Its latency does not establish physical 16 MHz
386 RTx, a tenfold speedup, or Windows and Doom compatibility. No comparable
GitHub CI or Kaggle execution measurement exists for this adapter yet.
The next steps are measured callback/scheduler profiling, a longer freely
owned guest, and source-bound qualification before production integration.

A first [actual callback profile](receipts/2026-10-01-i80386-native-direct-r3-profile.json)
uses three alternating unprofiled/profiled fresh-process pairs, with complete
checkpoint capture retained in both arms. All six reports are byte-identical
to the capture-disabled reference. Eight page admissions take 17.34–30.79 ms;
32 board inspections take 16.14–22.27 ms. These are inclusive wall times; nested
buckets overlap and cannot be added. Scheduling noise reverses the apparent
profiler overhead between pairs, so there is no speedup estimate. The first
optimization candidate is copying validated contiguous RAM/ROM pages from
actual backing instead of performing 32,768 scalar byte reads. It remains
unimplemented in this receipt and requires fresh parity checks.
