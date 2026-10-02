# Private per-word clock dispatch candidate: source only

The single baseline profile identified the owned clock dispatch stack as a useful place for a small experiment. Its samples do not establish a speedup or CPU cost percentage. The profiling results are being published separately in PR #249.

This candidate binds the factory-owned original `nativeTick` and `quantum` methods once at setup, then calls them directly for each ordered word when `compactSink === null`. It removes the provider replay loop's temporary argument arrays and `Reflect.apply` calls. The board methods, capture-ON loop, entire preflight, independent caps, mapping and device deadlines, callback phases, and ordinary full snapshots remain unchanged.

The candidate is separate from the rejected board-allocation and clock-bulk experiments. It changes neither of their recorded outcomes and is not adopted as a production backend.

## Frozen identities

The source experiment is frozen at `e7a6a4ab7f2bed32a5f6d0c81e35c04e1d16d759`: 106 runtime inputs, including three added files. All 103 compiled inputs remain byte-identical to baseline `fe1eff2039520536350922a2164c8bbe29404c68`. This publication cherry-picks those three files onto the current upstream; its commit is a publication identity and does not replace the frozen runtime revision.

The provider has five explicit reversible seams. The source control reconstructs the exact original provider, including its imports and factory name. Root authentication checks all 106 current/frozen Git inputs and all 103 compiled baseline inputs; independent review agrees.

## Source validation and preserved failure

The first bounded source run passed 13 of 14 controls. The failing test used an unsupported 8042 output value of zero; the unchanged baseline rejected it before dispatch. Only that test setup was corrected to value one, which preserves the reset bit while disabling A20. The failed run is retained alongside the corrected run.

The corrected bounded run passed all 14 controls, with no skipped tests, exit zero, no timeout, empty stderr, and all three source pins unchanged. Its wall time was 8.423 seconds; this is source-test duration, not guest performance.

Controls compare the actual baseline and candidate factories for ordinary/REP/fault N ordering, atomic malformed-tape and independent-cap denial, query/lifecycle rules, foreign receivers, PIT PIO effects, mapping publication, sink exceptions and reentry, deadlines, and post-factory mutation of bind/apply. These controls execute JavaScript device callbacks; they do not load the native CPU.

## Next qualification

A separate runner/admission integration is being prepared. It must authenticate the complete frozen runtime map separately from the original compiled identity and addon. Then three bounded native parity cells must pass: capture-OFF, capture-ON with host journal, and native trace ON with host journal OFF. The third cell tests canonical CPU chronology while exercising the null-sink dispatch branch. Only after those controls can a fresh alternating paired CPU gate assess this candidate. The previous negative gates must not be retried or combined with this result.

No native addon, guest, build, Inspector profile, or performance gate ran for this candidate during this source preparation. There is no speed or RTx claim, full AT qualification, Windows/Doom qualification, or adoption.

## Receipts

The [receipt index](receipts/i80386-owned-dispatch-source-20261002/sha256.json) binds lossless copies of both bounded runs, source identities, and root/independent audits. [External origins](receipts/i80386-owned-dispatch-source-20261002/external-origins.json) identify the retained local originals. These files contain no private OS media.

Subsequent [three-cell native parity results](I80386-OWNED-DISPATCH-PARITY-RESULTS.md) qualify this fixed free fixture. They do not alter the source-phase receipts or establish a speed gain.
