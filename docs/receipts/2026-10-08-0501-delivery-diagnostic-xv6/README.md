# Delivery diagnostic source: xv6 regression receipt

[PR run 37822545418](https://github.com/CrispStrobe/bw-board/actions/runs/37822545418),
attempt 1, passed the three finite xv6 scenarios at the source tree reviewed
for [`0714159c`](https://github.com/CrispStrobe/bw-board/commit/0714159c9875ac17bf5ef5a8e5418f5815fa1608).
The guest executed PR merge commit
[`f2616b9c`](https://github.com/CrispStrobe/bw-board/commit/f2616b9c2f01da0a63a52d9efd98980b44f2940b),
whose tree exactly equals the reviewed head. Official merge metadata records
parents `4c22a574` and `0714159c`; the run head alone is not execution identity.

The original log reports 1,635 current tests: 1,624 pass, zero fail and 11 skip;
all 288 historical tests pass separately. All 60 focused journal, boundary,
policy and orchestration names have passing TAP rows, including the eight
new diagnostic controls. The original packet binds 70 listed source roles per
guest to immutable Git, plus ROM/build/image identities and finite serial and
milestone predicates. Original log/ZIP hashes and official origins are in the
[derived summary](summary.json). No producer helper import or guest replay
was used for the root or independent peer audit.

This is a regression under the existing CR4 `0x10` compatibility profile. It
does not qualify a strict physical 386DX, the actual rejected-delivery diagnostic,
a completed allocation-frame pair, performance or consumer adoption. See the
[frame attribution lane](../../I80386-DPMI-FRAME-ATTRIBUTION-LANE.md).

The same reviewed source passed [full push CI 37822517504](https://github.com/CrispStrobe/bw-board/actions/runs/37822517504),
attempt 1: 8,479 current tests, 8,177 pass, zero fail and 302 skip; all 288
historical tests pass, with 2/2 preceding vector-admission controls. Root and
independent peer checked the original log and all 60 focused names against
immutable Git. Its original log hash and counts are retained separately in the
summary. This single full-CI result does not establish that every enabled PR
check has finished, or qualify the actual delivery diagnostic.
