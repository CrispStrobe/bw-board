# Corrected reference capture: preserved AT failure

[Actual run 37818842928](https://github.com/CrispStrobe/bw-board/actions/runs/37818842928),
attempt 1 at reviewed source
[`4c22a574`](https://github.com/CrispStrobe/bw-board/commit/4c22a574ec50a515fe4954a3fda0ff6a947a5068),
failed with `unsupported-owned-delivery`.

The owned main cut passed at step 44,609,970. The passive allocation-wrapper
copy passed at step 44,609,991: all 80 map-bound bytes matched, the before/after
fingerprints matched, and reference identities remained equal. The journal
then armed and invalidated after nine CPU steps, stopping at step 44,610,000.
No delivery or return entry was committed, and the finite client did not finish.

The observer uses one failure reason for several unsupported delivery
conditions. The final CPU report shows a handler code segment with 16-bit
default operand size, but does not retain the failed predicate or gate width.
This does not establish a guest CPU defect or a 16-bit interrupt gate. The
next source task is a bounded rejection receipt with the actual delivery facts,
committed only after the enclosing ordinary instruction completes. Existing
unsupported cases must remain invalid; no frame credit is granted on rejection.

The [derived summary](summary.json) preserves official origins and original
packet/log hashes. Source admission binds 195 Git roles and 62 recursive ESM
nodes. Root and independent peer checked the original source/compiler, owned-client,
map, media and notice bindings and the failure boundary. No producer helper import or guest replay was
used. Timing covers an interrupted observation scenario and is not a speed
or RTx result. See the [frame attribution lane](../../I80386-DPMI-FRAME-ATTRIBUTION-LANE.md).
