# Owned protected16 `8E` ES-cache output witness

An owned 512-byte boot sector enters protected16 mode and loads ES from a
memory selector naming a GDT data descriptor with base `0x9000`. It emits
four bytes to port `0xE9`:

| Byte | Meaning |
| --- | --- |
| `93` | descriptor Accessed byte after `MOV ES,[selector_slot]`, initially `92` |
| `A1` | `ES:0` still reads the old `0x9000` base after the guest changes the descriptor base to `0xA000` |
| `B2` | `ES:0` reads the new `0xA000` base after reloading the same selector |
| `4B` | completion marker |

The [committed receipt](receipts/2026-09-29-i80386-es-cache-witness.json)
records the exact source revision `f3facd188b86100cc2a409e9697c73e991a6ec2f`,
source hashes, boot-image hash, pinned tool hashes, and observed output. Pinned
QEMU 8.2.2 with a 486 CPU, pinned Bochs 2.7 at CPU level 3, and the current
ordinary `ExperimentalI80386` all emitted `93a1b24b`. Bochs booted without
panic and was terminated after the marker. The comparator's negative control
forces a stale local ES base after the second load; it emitted `93a1a14b`
and failed solely on `local.output`, while both external witnesses still
emitted `93a1b24b`.

The fixture and comparator live in
`test/fixtures/i80386-es-cache-witness.S` and
`scripts/compare-qemu-i80386-es-cache-witness.mjs`. The test binds the receipt
to its committed source with `git show` and runs the current ordinary core
against pinned QEMU when available; the Bochs comparison runs when
`BOCHS_386_ROOT` points to the pinned build. The two external outputs witness
the Accessed state and retained/reloaded base behavior indirectly. They do
not expose per-byte external RAM bus ordering. QEMU's 486 CPU also does not
establish exact original-386 timing. The grouped first-refusal opportunity
gate remains failed, and this result does not admit `8E` to an executor.
