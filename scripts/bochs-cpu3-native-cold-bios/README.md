# Cold BIOS REP source fragment

This source fragment admits four exact REP STOS sites in the LGPL legacy BIOS
SHA `6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac`.
It is not runnable BIOS admission: the held initializer still requires the IN8
ROM, and its ports, budget, IRQ/fault and terminal contracts remain unchanged.
No new native CPU instruction implementation is added.

The known repeat engine, per-element successful Q kind1, intermediate native N,
pre-element budget/deadline refusal, partial-REP resume and suppression of an
extra final ordinary Q are preserved byte-for-byte. Only REP admission changes.
Each exact real-mode ROM site requires ES0/base0, 16-bit CS/ES, PE0, DF0 and a
remaining nonzero CX within its initial count; DI advances exactly by element
width as CX falls. Store values and encodings are pinned. These register values
are proposed from binary disassembly, not claimed as observed census snapshots.
A future actual reference must record initial and partial register states.

No PIC mask is forced by this fragment. The real cold census reaches E16 after
316,562 JS steps, with a PIC line asserted while IF is clear; the separate AA/AB
fixture's all-masked PIC/512 caps do not describe cold BIOS execution. Full BIOS
admission still needs its actual byte-port, clock, RAM and checkpoint contracts.
