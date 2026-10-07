# Cold direct-RAM empty-batch Map prototype

**SOURCE_ONLY_UNCONNECTED.** This profile derives the qualified direct-RAM
provider from its exact pinned source bytes and changes one expression: an
empty copied journal retains the existing `board.generations` Map instead of
cloning it. A nonempty journal still clones and validates the staged overlay.
The derivative leaves native `directDrain`, exact `directCommit`/ACK, session,
epoch, phase, reentry and board admission in the original provider path.

The original provider, native addon, cold fixture and ordinary JavaScript
default are unchanged. This source-only control does not establish native
integration, affected guest parity, measured empty-batch cost or a speedup.
The control uses a fake owner and current-checkout imports; it does not
authenticate a complete addon build or replace the real owner/N-API tests.
Actual use requires a separate exact-source build/guest qualification and then
the paired adoption gate.

The draft labeled actual gate keeps a pinned qualified CPU3 checkout and
rebuilds its unchanged addon with the held static verifier. It authenticates
the original three-arm free-BIOS packet, materializes an exact held-fixture
derivative that imports this provider derivative from the qualified source
tree, and validates the complete source closure before loading the addon. The
held comparator checks full 166-word CPU state, board, 16 MiB RAM journal
replay, ordered PIO and closure against the callback and companion arms. A
second comparison requires every changed direct report field except build and
configuration admission metadata to match the original direct report. This
gate has not run; the first successful affected guest remains required before
any functional claim or paired timing.

Run the bounded source controls with:

```sh
node --test scripts/bochs-cpu3-native-cold-direct-ram-empty/provider-control.test.mjs
```
