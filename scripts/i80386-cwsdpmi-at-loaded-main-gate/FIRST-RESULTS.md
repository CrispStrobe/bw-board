# First AT loaded-main attempt

The first hosted attempt at source `6b7ae1090a6ac23c0ffa66974523c3a5c489aab5`
([run 37735362417](https://github.com/CrispStrobe/bw-board/actions/runs/37735362417))
**failed qualification**. Its exact original report-only artifact is
[artifact 11532462204](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11532462204),
121,760 bytes, SHA-256
`cc303a4c876748ce234c5d3976a057ee16a565ebb9e6ad24896d151bae81057e`.
Root and independent peer audits accepted the artifact inventory, exact source,
fresh compile, package, and media bindings. The guest attempted 120,000,000
ordinary AT steps, recorded 2,400 unsupported screen observations, offered no
keyboard input, and recorded no eligible protected `main` candidate. Candidate
testing in this gate starts only after accepted client-command input. Its initial
and final hard-disk hashes were equal. The loaded-text cut did not occur.

The original report did **not** retain VGA registers, so it cannot establish
which text-route predicate rejected the screen. A [separate, earlier owned
FreeDOS AT run](https://github.com/CrispStrobe/bw-board/actions/runs/37648932918)
with the same free BIOS and VGA profile observed a visible installer and prompt
with sequencer memory-mode register 3. The first gate admitted only values 2
and 6, while the source VGA route ignores bit 0 for text character fetches.
This is a plausible observer admission mismatch, not a proven register state
for the failed run.

The follow-up source changes only the passive VGA text-route admission and adds
bounded first/last refusal reasons with scalar registers to progress and final
reports. It retains the same guest, media, CPU, loader, and loaded-text policy.
This follow-up remains **unrun** until a separately reviewed hosted attempt.
No first `main` instruction, DPMI service, completed client, strict 386 profile,
or performance result follows from either source checkpoint.
