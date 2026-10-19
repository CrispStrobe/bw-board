# Bounded `8E` ES load contract

The grouped first-refusal result identified ordinary `8E` ES loads as the
dominant local bridges in protected16 and VM86, while its opportunity gate
failed. The owned-byte fixtures in
`test/i80386-segment-load-contract.test.mjs` pin the existing ordinary CPU
boundary for these two forms:

| Mode | Bytes | Source | Observed boundary |
| --- | --- | --- | --- |
| protected16 | `8e 46 01` | word at `SS:[BP+1]` | instruction fetch, two source RAM reads, eight GDT descriptor reads, Accessed-byte write, ES selector/cache commit |
| VM86 | `8e c2` | DX register | no data or descriptor bus traffic; ES cache resets to 16-bit real-address form; following `26 a0 00 00` reads at the new ES base |
| VM86 | `8e 46 01` | word at `SS:[BP+1]` | instruction fetch and two ordered source RAM reads, without descriptor traffic |

The protected16 non-present descriptor case retains the prior ES selector,
cache object, EIP, flags, and interrupt shadows after `#NP(8)`. It still
performs the source and descriptor reads before the fault; no Accessed-byte
write occurs. Successful protected16 loading marks an initially clear
descriptor Accessed bit before committing the visible ES state. ES loads do
not create a MOV SS interrupt/debug shadow.

The VM86 load now uses the same `_virtualSegmentCache` constructor as other
VM86 segment transitions, including its `readable: true` field. This removes
an inconsistent cache shape in the ordinary CPU. The field was not used by
VM86 memory-read admission in the current core; the fixture also pins the
subsequent actual ES read.

These are deterministic tests against the ordinary executor with owned
instruction, source, and descriptor bytes. The later
[ES-cache output witness](I80386-ES-CACHE-ORACLE.md) runs a separate owned
protected16 boot sector under pinned QEMU and Bochs. Its output indirectly
confirms the Accessed byte, retention of the old ES base after a GDT edit,
and use of the new base after a same-selector reload. The external output
does not reveal per-byte RAM bus ordering or fault ordering in these
fixtures. The failed grouped opportunity gate remains unchanged; this work
does not admit `8E` to the block executor or expand the observer.
