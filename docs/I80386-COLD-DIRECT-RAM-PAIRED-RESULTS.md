# Cold CPU3 direct RAM paired result

Updated 2026-10-07. All 36 fresh children pass the recorded semantic gates, but the direct native path fails the adoption speed gate against ordinary JavaScript. Keep JavaScript as the user-facing default. [Actual run 37609656584](https://github.com/CrispStrobe/bw-board/actions/runs/37609656584) tested harness `447fb5bfbc913db0ef00fca333ecb5be28b0e156` with engine source `acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1`; [PR421](https://github.com/CrispStrobe/bw-board/pull/421) publishes the separate timing harness.

## Measurement

The host was a GitHub Linux runner with AMD EPYC 9V45 and four allocated logical CPUs, using Node 22.23.3. Each comparison ran two warm-up pairs and seven alternating measured pairs, with a fresh process per child. Execution CPU and wall intervals exclude setup, settlement and serialization. Whole-child `wait4` CPU includes waited child helpers; parent preflight and build costs are outside that interval.

| Comparison | Direct / baseline execution CPU | Direct / baseline execution wall | Favorable CPU pairs | Adoption |
| --- | ---: | ---: | ---: | --- |
| Direct / ordinary JS | 5.035176× | 9.870393× | 0 / 7 | FAIL |
| Direct / companion | 0.944918× | 1.018137× | 5 / 7 | Descriptive only |

Ratios divide the sums across the seven measured pairs. In the JS comparison, mean execution CPU was 0.268060 s for JS and 1.349727 s for direct; mean execution wall was 0.119142 s and 1.175975 s. The companion comparison shows about 5.5% lower mean CPU but mixed pairs and slightly higher wall time. It cannot authorize adoption. The quantitative gate requires at least 10% lower mean execution CPU than ordinary JS and all seven pairs favorable.

The configured board charges six clocks per completed quantum at 6 MHz: `316562 × 6 / 6000000 = 0.316562` simulated seconds during execution. Dividing by each arm's mean execution wall gives configured RTx **JS 2.657023 / direct 0.269191**. This is functional device pacing, not measured instruction timing or physical 16 MHz 386DX calibration. No comparable VPS, Kaggle CPU or GPU run was obtained.

## Semantic and identity boundary

Each native child matches reset, requested-last and final 166-word native semantic state, compact progress, complete board state, all 16,475 ordered PIO events and the whole 16 MiB RAM hash. The ordinary JS child checks the represented common CPU fields, full board/RAM and independently mapped PIO clock convention; it does not invent counterparts for hidden native cache words or collect an every-step ROM/REP trace. Native CPU/provider closure and successful child termination with an empty owned process group are checked. The JS machine has no close API, so its closure claim is process scope only.

The timing direct provider is an authenticated derivative of the [guest-qualified recording provider](I80386-COLD-DIRECT-RAM-RESULTS.md). It removes per-write JSON diagnostic objects while retaining the scalar journal bound, native owner journal, complete batch validation, generation Map, acknowledgement and clocks. Both the original bytes and inverse transformation are authenticated. Normalized source hashes remain fixed across checkout locations; loaded import-URL bytes have their own recorded hash. This result is not timing of the unmodified recording provider.

The original qualification packet is authenticated and its 91,958 writes replayed before timing. The direct addon is rebuilt from the exact qualified engine source, with fresh static build admission; the companion addon has its own pinned identity and its owner is freshly compiled from qualified source/header bytes. Compiled addons are deliberately omitted from the uploaded timing artifact. Their hashes are build-receipt bindings, not coordinator rehashes of uploaded binaries.

The [public receipt](receipts/2026-10-07-cold-direct-ram-paired.json) records the official artifact identity, exact source roles, raw pair ratios and result. The original ZIP contains 319 members, is 7,602,908 bytes, and has SHA-256 `009ea51900033a6eb16c2779faaab59c4c686dce6a6da9fbad756ff39b3b8fbd`. Independent raw audits validate its inventory, child evidence and timing arithmetic without importing the producer's comparator or rerunning guests.

## Next bounded step

The direct path still performs 233,122 clock transfers in this finite ROM-only slice. That count is not a measured CPU-cost share. [Lane 2](X86-NEXT-LANES.md#2-reduce-crossings-with-explicit-clock-authority) should start with a pure model that separates logical source N/Q from N/Q already published to the JS board. Bind a clock lease to session, phase, mapping/A20 epoch, IRQ state, deadline and bounded tape/journal capacity; prove preflight before acknowledgement, exact uncommitted retry and observer/page/deadline revocation before source integration.

A later integrated profile needs its own actual semantic gate and paired timing. This run establishes no full AT boot, protected-mode OS/application acceptance, native GUI adoption, cross-host speed comparison or physical 16 MHz 386DX calibration. Preserve the historical compact timing result separately; different profiles and hosts are not a measured trend.
