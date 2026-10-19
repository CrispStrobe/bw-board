# Cold diagnostic undefined-overflow comparison

[Run 37112502937](https://github.com/CrispStrobe/bw-board/actions/runs/37112502937) restored the corrected 125-input build and executed 4,709 N/Q, then refused raw EFLAGS comparison. Native flags were 0886 and JavaScript 0086; all represented GPR/EIP values matched at F000:9DAB. The preceding pinned BIOS bytes 66 C1 E0 10 at 9DA7 encode SHL EAX,16. Intel specifies OF as undefined for a multi-bit shift; Bochs and JavaScript choose different values without changing the instruction result.

The raw first divergence, all 166 native words and flags remain unchanged in [lossless receipts](receipts/native-cold-bios-undefined-of-20261003/index.json). Parent source, immutable inputs and restored artifact maps remained equal. No E16, full BIOS or speed qualification is claimed. No retry occurred.

The separately reviewed comparison-policy source preparation now implements: own only the undefined OF bit over the exact authenticated instruction lifetime, including MOV/CLD/REP preservation through 9DBC before ADD executes. All other bits/architecture stay strict; unknown paths or consumers must refuse. Twelve bounded pure controls and a read-only 53-input source identity passed; this policy has not been guest-qualified and does not normalize the CPU, JavaScript model or RAM.

The governing definition is [Intel SDM Vol2B, SAL/SAR/SHL/SHR, Flags Affected](https://cdrdv2-public.intel.com/782151/253667-sdm-vol-2b.pdf). Source-control receipts are [retained separately](receipts/native-cold-bios-of-policy-20261003/index.json); the compiled 7632 build and artifact remain unchanged.
