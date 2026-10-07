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

Run the bounded source controls with:

```sh
node --test scripts/bochs-cpu3-native-cold-direct-ram-empty/provider-control.test.mjs
```
