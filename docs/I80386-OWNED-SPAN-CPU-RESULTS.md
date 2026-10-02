# Private span CPU gate: rejected

The single hosted 18-child gate failed its predeclared adoption criterion. Baseline mean execution process CPU was **123,178.142857 µs**, versus **117,977.714286 µs** for the private span candidate: a nominal **4.221876%** reduction, with **five of seven pairs favorable**. The required threshold was at least 10% less mean CPU and all seven favorable. Keep unchanged `fe1`; do not adopt or retry this candidate.

| Measured pair | Baseline CPU (µs) | Span CPU (µs) | Favorable |
|---|---:|---:|---|
| 1 | 128404 | 119143 | yes |
| 2 | 119753 | 121212 | no |
| 3 | 119306 | 120741 | no |
| 4 | 117013 | 116968 | yes |
| 5 | 118311 | 115050 | yes |
| 6 | 132341 | 111422 | yes |
| 7 | 127119 | 121308 | yes |

Two discarded warmup pairs preceded seven alternating measured pairs; all samples and child records are retained. All 18 full fixed-fixture semantic comparisons passed, including complete stored native/board/RAM/physical state and separately authenticated source/provenance. The unchanged scheduler creates a full 166-word native snapshot at each of 445 resumes; captures retain reset, final and six selected checkpoints rather than all 445 snapshots. The whole-process CPU window includes callbacks, snapshots, checkpoints and GC, and excludes creation, settlement and final serialization. No trace, journal or Inspector profiling ran during timing.

[Run 37061280177](https://github.com/CrispStrobe/bw-board/actions/runs/37061280177) used exact reviewed CPU preparation head `d48ba37f4b38784757275b28f26da71bb9113c11`. Runtime `bbf2a73e3d9090e73fe7037f4b8dbd4f6248aaa1`/116 inputs remains separate from span source `8e35080d29b32e9fcee5f8fbc5800209c74df2e7`/110 and unchanged compiled `fe1eff2039520536350922a2164c8bbe29404c68`/103. Both arms used the original addon SHA `8d9c83fcc3c42c2c94d17782ae42c152c52fcb2e833c31decc4bfee2af5aa841`. Its three native parity prerequisites were admitted from their genuine earlier official artifact and separately created root/peer audits, without rerunning those cells.

The hosted machine reported **AMD EPYC 9V45**, four logical CPUs, Ubuntu 24 and Node 22.23.3. Missing quota paths remain explicitly unavailable; absolute timings are not compared with other hosted CPU models. The failed gate is not combined with earlier improvements, rejected dispatch/bulk candidates or Inspector sample counts. It establishes no full AT/Windows support, physical-clock RTx or 10× claim.

The coder actual-result audit passed 443 checks. The [independent actual audit](receipts/i80386-owned-span-cpu-negative-20261002/independent-actual-gate-audit.json) passed 771 checks, with its [source/provenance addendum](receipts/i80386-owned-span-cpu-negative-20261002/independent-source-provenance-addendum.json). The separate [root audit](receipts/i80386-owned-span-cpu-negative-20261002/root-actual-cpu-audit.json) authenticated all 187 ZIP files, 18 full captures and gate arithmetic, confirming no adoption. The [receipt index](receipts/i80386-owned-span-cpu-negative-20261002/index.json) and [origins](receipts/i80386-owned-span-cpu-negative-20261002/external-origins.json) preserve every newly uploaded actual child, inputs, streams, exits, source/provenance records, qualification references and audits. [External retention](receipts/i80386-owned-span-cpu-negative-20261002/external-retention.json) binds official CPU artifact `11250412021`, ZIP SHA `075ff42a9194624ed4b157b57cc64d213ca61891023c74d5f820bb509a23e4f6` (513,822 bytes). The old large qualification trace/journal streams remain separately hash-bound historical inputs, not duplicated in this result archive.
