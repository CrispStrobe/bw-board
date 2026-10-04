# Native cold free-BIOS checkpoint plan

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

The next target is an actual reset of the unmodified free AT BIOS, stopping **before F000:E16**, after AA self-test and AB interface test. Direct entry at the keyboard routine omits the cold path. This is a plan, not a native BIOS boot result.

One exploratory JavaScript census reached that boundary in 316,562 steps/completions, with IF clear and 16,475 byte port operations. ROM SHA-256 was `6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac`. Construction configuration fixed controller busy delay 12 and response delay 32 and disabled unsolicited BAT/ACK/mouse responses. The bounded child exited successfully in 1.255 seconds; receipts remain at `/tmp/native-cold-bios-js-census-actual-20261003`. The helper and ROM were pinned, but no complete source inventory was captured before and after execution. This is a JS budget/device census, not an authenticated native baseline or speed measurement.

Actual ports were DMA outputs 0x0d/0xda/0xd6/0xd4, CMOS 0x70/0x71, BIOS debug output 0x402, PIT outputs 0x43/0x40, diagnostic output 0x80, and controller 0x64/0x60. Counts included 8,191 zero port-80 writes, 8,192 zero status reads, four ready status reads, and response bytes 0x55 then 0x00. A future proof needs complete ordered port evidence, not these counts alone.

Four REP sites were observed at CS F000: E0C4 (`F3 AB`, 128 iterations), 9DAF (`F3 66 AB`, 120), 9E3A (`F3 AB`, 16), and 9E44 (`F3 66 AB`, 136). The current tiny native profile rejects REP and caps execution at 512. A separate profile must admit exact forms, address/progress domains, ordinary stack/RAM writes, and the pinned BIOS. Preserve per-element Q charging, intermediate N ticks, partial resumes, deadline barriers, and suppression of an extra final REP charge. Native totals must be measured independently. Roughly 400,000 total attempts/completions is a planning budget; the existing 150,000 completion cap needs an explicit distinct profile.

The cold path starts through the reset jump to F000:E05B, with ordinary real-mode stack SS=0/SP=FFFE. DMA, CMOS, PIT, debug, and port-80 operations must retain actual device effects and pre-PIO catch-up/mandatory post-PIO deadline refresh. Do not admit silent successful fallbacks.

At E16, actual master PIC state was IRR=1, ISR=0, IMR=0 and asserted interrupt output, while IF remained clear and no interrupt/fault delivery occurred. The tiny fixture's masked PIC/zero-line rule is unsuitable. Permit the real asserted line, retain no ACK/delivery before the checkpoint, and do not mask the PIC artificially.

Use streaming ordered clock/port evidence and named snapshots at reset, after each REP site, before AA, after AA, after AB, and E16. Hundreds of thousands of full 166-word snapshots and boards in arrays would exceed the small heap budget. Keep raw reset states and explicit literal oracle-profile differences; do not call Bochs deviations hardware-correct. Keep whole RAM raw unless a specific guest-created reset witness requires a separately justified comparison policy.

The separate authored AA/AB ROM is a bounded protocol slice, not qualification of these REP, stack, DMA/CMOS, line, BIOS-ROM, or cold-path requirements.
