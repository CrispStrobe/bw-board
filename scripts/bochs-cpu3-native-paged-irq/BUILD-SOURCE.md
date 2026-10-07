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
workflow has not run at this checkpoint: no native compile, guest result or
differential parity is established by these source controls.
