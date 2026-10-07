# Paged IRQ build admission checkpoint

The separate IRQ0 materializer derives from the authenticated paging
materializer and retains its historical RAM, protected-stack and paging
provenance. It substitutes this profile's generated CPU3 runtime, source
board provider and owned reset ROM into distinct output roles. The source
identity includes these definitions and the bounded controls. The manifest
must carry the current source revision, exact generated hashes, fixed ABI 4,
and the underlying paging manifest without allowing a historical addon to
qualify this new profile.

`node --test test/i80386-paged-irq-build-source.test.mjs` checks only pure
derivation and synthetic metadata denial. It does not materialize Bochs,
compile an addon, execute a guest, or establish a native/JS differential.
The dedicated hosted build and guest gate remain to be defined and reviewed.
