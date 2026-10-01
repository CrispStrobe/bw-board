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
is underway. Original first-build and failed-run artifacts are retained.

The adapter uses persistent native execution buffers, synchronous calls on the
initializing thread, and one terminal initialization lifetime per loaded image.
The loader admits one canonical addon in the main JavaScript realm. Direct
`require()` bypasses and independently copied shared libraries are outside that
loader guarantee. Fatal failures currently abort their process, so diagnostics
and negative controls run in children. No initializer quit context survives
its stack frame; configuration and argument pointers have stable storage.

Before qualification, four native budgets must agree with the actual FIFO
capture on ordered callbacks, full CPU/cache traces, whole-board checkpoints,
RAM and A20 generations. Capture-enabled and disabled runs must also agree.
Transport records and administrative ordinals have explicitly bounded
projection rules; CPU, memory and device effects are not masked.

There is no new RTx measurement yet. Execution timing must exclude startup and
report serialization. This 194-tick guest is a correctness fixture; its latency
does not establish physical 16 MHz 386 timing, a tenfold speedup, or Windows and
Doom compatibility. Longer workloads follow once the direct adapter passes.
