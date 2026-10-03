# Cold diagnostic undefined-overflow comparison

[Run 37112502937](https://github.com/CrispStrobe/bw-board/actions/runs/37112502937) restored the corrected 125-input build and executed 4,709 N/Q, then refused raw EFLAGS comparison. Native flags were 0886 and JavaScript 0086; all represented GPR/EIP values matched at F000:9DAB. The preceding pinned BIOS bytes 66 C1 E0 10 at 9DA7 encode SHL EAX,16. Intel specifies OF as undefined for a multi-bit shift; Bochs and JavaScript choose different values without changing the instruction result.

The raw first divergence, all 166 native words and flags remain unchanged in [lossless receipts](receipts/native-cold-bios-undefined-of-20261003/index.json). Parent source, immutable inputs and restored artifact maps remained equal. No E16, full BIOS or speed qualification is claimed. No retry occurred.

A separately reviewed comparison-policy source preparation is planned: own only the undefined OF bit over the exact authenticated instruction lifetime, including MOV/CLD/REP preservation through 9DBC before ADD executes. All other bits/architecture stay strict; unknown paths or consumers must refuse. This is not implemented or guest-qualified by these result notes and will not normalize the CPU, JavaScript model or RAM.
