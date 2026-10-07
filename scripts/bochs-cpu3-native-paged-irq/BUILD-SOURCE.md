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
run at that checkpoint. The next [official run 37619512616](https://github.com/CrispStrobe/bw-board/actions/runs/37619512616)
reached a real zero-N/Q hardware IRQ delivery at 39/39 with one PIC ACK,
three frame writes and a handler-entry CPU snapshot. Its driver then rejected
the return because it expected IRQ fields at the top level; ABI4 exposes them
in the exact 160-byte `sliceBytes` result. The current decoder pins the
generated ABI header and checks the original captured slice without adding
exports or inventing fields. The [third official run 37620774682](https://github.com/CrispStrobe/bw-board/actions/runs/37620774682)
advanced through the source ABI decoder until the real post-STI slice, before
IRQ delivery, exposed
an IF value of `0x200`, where the driver had expected a Boolean `1`. The
current decoder checks the exact IF mask against EFLAGS and includes that
unchanged real 160-byte slice as a control. This correction has not been
rerun in a guest at that checkpoint. The [fourth official run 37622053238](https://github.com/CrispStrobe/bw-board/actions/runs/37622053238)
reached 44 N/Q and passed the recorded IRQ-delivery and returned terminal
architectural comparisons. Its memory replay then rejected four genuine ROM
descriptor reads because it classified every callback as an owned RAM page.
The corrected replay accepts only the exact four read-only descriptor chunks
from this fixture's authenticated ROM, retaining their order in the full board
read ledger; all other outside-page callbacks remain forbidden. This replay
correction has not run in a native guest, so overall native/JS parity remains
unqualified.
