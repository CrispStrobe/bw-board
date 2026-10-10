# Journal regression and xv6 checkpoint

[Original hosted run 37792187626](https://github.com/CrispStrobe/bw-board/actions/runs/37792187626)
passed at source [`13d82f31`](https://github.com/CrispStrobe/bw-board/commit/13d82f3116107a1c4d8dff421db747eaa1bfef23),
attempt 1. The [derived summary](summary.json) preserves official origins and
original log/ZIP hashes. It contains selected observations, not normalized raw
receipts. Root and independent peer audited the originals read-only against
Git without producer imports, compiler reconstruction or guest replay.

The current cohort reported 1,604 tests: 1,593 pass, zero fail and 11 skip.
The separate frozen historical cohort passed all 288 tests. Both child exits
were zero and cleanup succeeded. All 24 original journal controls and five
additional boundary controls have passing exact-name TAP rows.

The same source also passed [full push CI 37792187810](https://github.com/CrispStrobe/bw-board/actions/runs/37792187810):
8,448 current tests, 8,146 pass, zero fail and 302 skip; all 288 historical
tests passed. Root checked its original log and official metadata read-only;
the summary records that separate log's byte count and hash. All 12 enabled
PR460 checks passed, with two declared `vectors-full` skips. The draft remains
unmerged, and this is not qualification of the later frame adapter.

The original five-JSON artifact records the 4 MiB shell/filesystem exercise,
14 MiB shell boot and 4 MiB `forktest` completion, each bound to the executed
source and pinned MIT xv6 source `eeb7b415dbcb12cc362d0783e41c3d1f44066b17`.
Each guest report's 70 listed source hashes matched Git. Kernel/filesystem
build hashes matched the corresponding probe's input hashes. This is finite
execution evidence under the existing compatibility profile; reported CR4
is `0x10`. It does not qualify a strict physical 386DX model, every xv6 test,
a DPMI allocation-frame guest, performance or consumer adoption.

The earlier source-binding failure at
[run 37787580143](https://github.com/CrispStrobe/bw-board/actions/runs/37787580143)
remains preserved. Correcting the test source cohorts does not rewrite that
outcome or reinterpret historical captures as current-CPU results.
