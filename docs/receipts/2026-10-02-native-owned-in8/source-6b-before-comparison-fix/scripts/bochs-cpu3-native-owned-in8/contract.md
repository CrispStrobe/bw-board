# Owned IN8 source candidate

This distinct ABI4 extends the owned ABI3 scalar enum with IN=5. Scalar 2 remains quantum. The callback struct layout stays unchanged; its version changes to 4, and existing ABI3 modules must reject the candidate.

Only byte reads at PIT channel 0 (0x40) and PIC data (0x21/0xa1) are admitted. Width, port, lifecycle and pending mapping are checked before clock flush or device effects. Native flushes its ordered tape, invokes the cached scalar callback once, checks the copied ordinary Uint32Array reply [byte, epoch, A20], and performs exactly one POSTPIO query even with zero debt. Mapping cannot change. The existing instruction commit and port-yield path remains intact; IN itself charges neither N nor Q.

The private board read calls the actual machine _in386(port,8). The base _in catches chips up before the read and rearms the horizon afterwards. PIT latch reads change read phase; PIC polling is denied on either data port by checking the target PIC pollPending flag before device access. This provider device-state check occurs after native clock flush: argument/mapping denial happens before flush, while PIC-poll denial preserves PIC read state but does not roll back already flushed clocks. PIC command reads and 8042 queue consumption are outside this scope. Device effects preceding a malformed callback reply are not rolled back; fatal guards contain failure in a bounded fresh child.

The fixture is an exact hot ROM derivative with a masked-interrupt PIT latch/read witness before the existing workload. Existing no-IN ROM bytes and its qualification stay unchanged. New counts, cut positions and expected state require a new JS reference and later native proof; no historical 439-resume claim applies to the new guest. Hardcoded IRQ/fault/marker and other existing restrictions remain. This is not general BIOS or full AT admission.

Source implementation and mock controls are the only current authorization. No addon build, load, guest execution or CPU benchmark has occurred for this candidate.
