# Reference-capture correction: xv6 regression receipt

[PR run 37815899847](https://github.com/CrispStrobe/bw-board/actions/runs/37815899847),
attempt 1, passed three finite xv6 scenarios. Its reviewed source is
[`4c22a574`](https://github.com/CrispStrobe/bw-board/commit/4c22a574ec50a515fe4954a3fda0ff6a947a5068).
The guest reports execution at PR merge commit
[`21efb8c4`](https://github.com/CrispStrobe/bw-board/commit/21efb8c49c34eed4f3ec36a0a21266886e9471bd),
whose tree exactly equals the reviewed source tree. The run head alone does
not establish the executed commit identity.

Root and independent peer checked the original packet, official metadata,
70 listed Git-bound source roles per guest, ROM/build/image consistency,
ordered command bytes and finite shell/process outputs. The original log
reports 1,627 current tests: 1,616 pass, zero fail, 11 skip; all 288 historical
tests pass. All 52 focused journal/policy/orchestration names have passing
TAP rows. Original ZIP/log hashes and official origins are in the
[derived summary](summary.json). No producer helper import or guest replay
was used to audit the packet.

These are regressions under the existing CR4 `0x10` compatibility profile.
They do not qualify a strict physical 386DX, the corrected AT allocation-frame
probe, performance or consumer adoption. See the
[frame attribution lane](../../I80386-DPMI-FRAME-ATTRIBUTION-LANE.md).
