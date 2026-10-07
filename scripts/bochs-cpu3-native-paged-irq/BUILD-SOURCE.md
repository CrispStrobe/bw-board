# Paged IRQ build admission checkpoint

The separate IRQ0 materializer derives from the authenticated paging
materializer and retains its historical RAM, protected-stack and paging
provenance. It substitutes this profile's generated CPU3 runtime, source
board provider and owned reset ROM into distinct output roles. The source
identity includes these definitions and the bounded controls. The manifest
must carry the current source revision, exact generated hashes, fixed ABI 4,
and the underlying paging manifest without allowing a historical addon to
qualify this new profile.

`node --test test/i80386-paged-irq-build-source.test.mjs
test/i80386-paged-irq-driver-source.test.mjs` checks pure derivation,
synthetic metadata denial, callback event copies, IRQ progress admission and
the exact IF phase source transform. The dedicated labeled PR workflow builds
from one reviewed head and runs one bounded clean native/JS guest. That
workflow's first official run, [37618660994](https://github.com/CrispStrobe/bw-board/actions/runs/37618660994),
compiled the new addon and passed static admission at source `33432b489b9eb344aab85db3ee8b6f31636b708a`.
The guest aborted on the inherited `cold-BIOS-no-ACK` guard before producing a
guest receipt. The scoped runtime correction removes that guard only from this
IRQ profile, and the runner now writes an atomic last-paused boundary before
each native resume. This corrected source has not had another actual guest
run; native/JS differential parity remains unqualified.
