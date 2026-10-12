# Nursery support mock first admission failure

[Run38146147828](https://github.com/CrispStrobe/bw-board/actions/runs/38146147828) at [52f418a9](https://github.com/CrispStrobe/bw-board/commit/52f418a9b82e8355a12de053e3498adcc0bc00c1) failed before completing source admission or running controls. Its sole closed packet has two members: inventory and status, recording `phase=source-admission exit=128`. The first fatal log entry is `fetch-pack: invalid index-pack output`. No source receipt was created, and no controls, native build, fixture GC or actual support job ran. Coordinator and independent original-byte audits pass within this failure boundary.

The [workflow-only correction21eef8f7](https://github.com/CrispStrobe/bw-board/commit/21eef8f700132f2df90564fbf3661467a2275b64) removes redundant base transfers in both jobs. The pinned base is already within the eight-commit checkout history; explicit commit-object and ancestor checks fail closed if it is unavailable. Exact-head, ten-path delta, 100-role hash admission and existing limits remain unchanged. File-limit interference with Git is a hypothesis, not an established cause. No retry of the old original or broader checkout/fetch was used.

Corrected hosted mocks and all enabled source checks remain pending. The prospective original reader still needs independent review and a final manifest freeze; the actual support label remains blocked. No runtime support or performance result follows.

[Curated summary](summary.json) retains the original artifact identity. Raw host logs and binaries are not bundled.
