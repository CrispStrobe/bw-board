# Bounded `E8`, `C3`, and `FF /2` ordered-state contract

The grouped first-refusal result found local bridges around protected16
direct `E8` and protected32 `FF /2` near calls, but its opportunity gate
failed. The owned-byte fixtures in
`test/i80386-call-return-contract.test.mjs` pin ordinary CPU behavior at the
stack and control boundary:

| Mode and bytes | Successful order | Fault cut |
| --- | --- | --- |
| protected16 `e8 02 00` then `c3` | fetch displacement, write return word at `SS:00fe` low byte first, enter target; fetch `C3`, read return word low byte first, restore EIP and SP | bad call target faults before stack write; bad return target faults after stack read and leaves EIP/SP unchanged |
| protected32 `ff 94 8d 20 00 00 00` then `c3` | decode `[EBP+ECX*4+0x20]` through SS, read four target bytes, write four return bytes at the new stack address, enter target; `C3` reads the frame and restores EIP/ESP | bad target faults after source read but before push; stack-limit fault also follows source read with no stack write |

Fixtures assert visible registers, flags, and exact per-byte fetch/read/write
order. They use owned RAM bytes and the ordinary executor. They do not
measure external hardware equivalence, and they do not change the failed
grouped opportunity screen. No block executor or observer admission follows
from these fixtures alone.
