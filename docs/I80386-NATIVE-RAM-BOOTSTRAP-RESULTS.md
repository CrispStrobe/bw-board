# First real-mode RAM execution and off-page patch

The fixed real-mode RAM bootstrap passed its first native/JS correctness run: [37142542286](https://github.com/CrispStrobe/bw-board/actions/runs/37142542286), wrapper source `79a626b8adf7bc70c08ff7bf7c40c424a4c77b2e`, compiled source `81694d0d19a86ded0449ab56b3554020ffc344ca`, driver `368ad8b61bb80f49380ed91b8ea1db442712e083`. The unchanged first RAM build supplied addon SHA `9475b94b4dd067bc6c25ccd7c61c60cef5c9696fba0725ed05913838a3ee9873`. The [published run checkpoint](https://github.com/CrispStrobe/bw-board/pull/319#issuecomment-5972044196) records the same narrow result.

Both engines completed 19 instructions. Native N and Q were independently 19, with 19 one-Q returns and no zero-Q return. The capture retains reset, every return and final inspect: 21 snapshots, each with all 166 native words. Every documented JS CPU counterpart matched strictly; native-only hidden words remain raw evidence rather than invented JS counterparts. Every boundary also matched the complete board and all 4096 bytes of the copied host-provider RAM code page.

| Ordinary cut | Q | Witness |
| --- | ---: | --- |
| Reset | 0 | F000:FFF0 |
| First RAM MOV | 10 | AX=1, generation 4 |
| Patch from ROM | 14 | Exact word write at 7001, generation 5 |
| Second RAM MOV | 16 | AX=2, generation 5 |
| Before HLT | 19 | F000:0050, AX=2 |

The four exact boot stores and single ROM-owned patch were retained in order. The final whole raw-RAM hashes matched at `7babb51b15e2511dfe5548c5369dcb0cd606a3fab960c30577ee6b6aa6c7eacb`; this whole-memory result is a paired hash, while the code page is retained byte-for-byte. Native cache generation and publication guards are attested by the authenticated C profile, not by a separate dump of native cache memory. The native, provider and JS lifecycles all closed. All source, restored input, configuration and Node before/after maps matched.

[Compact raw records and their exact origins](receipts/2026-10-03-i80386-native-ram-bootstrap/README.md) include the independent audit and capture SHA `85670aff7afdc34205c11b0ac46d7414e7cc8b4290d8c7052cf8e6fc4ed4841f`. Official artifact `11280788469` has 96 files; its retained ZIP is 9,500,151 bytes, SHA `b8fbf9f03ec36a6626c11cfcc18ecae72924873c0dd44c7bcb73613b2ad98b15`. It was downloaded once, with no rerun or rebuild.

This proves the authored one-page real-mode program and off-page patch under the fixed Bochs reset model. It does not qualify protected mode, paging, broader boot software, physical 386 timing or speed. A separate protected-mode source proposal starts with LGDT, CR0.PE, a far jump and one ordinary RAM instruction; it admits none of this real-mode profile's frozen native artifact as a protected-mode build.
