# RISC-V oracle fixtures

Spike (riscv-isa-sim) commit traces for `test/riscv32-oracle.test.mjs`. Each
`<suite>.json.br` is brotli JSON: `{isa, tests: {name: {entry, segments,
symbols, trace}}}`. Segments are the program's loadable bytes (trailing zeros
trimmed, `size` restores them), and `trace` is Spike's `-l --log-commits`
output in the row form of `test/riscv-oracle/spike-trace.mjs`.

| input | pin | licence |
|---|---|---|
| Spike, riscv-software-src/riscv-isa-sim | 5f2a1d48752121ab09dd0f1932884808c2e6c081 | BSD-3-Clause |
| riscv-tests, riscv-software-src/riscv-tests | 793a5ff2d99a6d9fbd91e84c34b9a0437e313b88 (env 6de71edb142be36319e380ce782c3d1830c65d68) | BSD-3-Clause |
| riscv-arch-test, riscv-non-isa/riscv-arch-test | tag 3.10.0 = fc32e41d49480fd99ba0a192dfff9c3319b44873 | BSD-3-Clause / Apache-2.0 |
| compiler | riscv64-unknown-elf-gcc 13.2.0, binutils 2.42 (Ubuntu 24.04 packages) | |

Spike ISA: `rv32imac_zicsr_zifencei_zicntr_zicclsm_svadu`, the hart we
implement: `zicclsm` means misaligned plain loads and stores are done in
hardware, and `svadu` means menvcfg.ADUE selects hardware A/D updates.

Contents: riscv-tests rv32ui/uc/um/ua/si/mi (p and v environments; 144,
without the Zacas `amocas_*`), riscv-arch-test rv32i_m I/M/A/C/Zifencei/
privilege (the 101 whose RVTEST_CASE conditions match RV32IMAC; the 11 Zcb
tests are not applicable), and `test/riscv-oracle/programs/*.S` (3).

Regenerate with `test/riscv-oracle/regenerate.sh` (it checks the pins).
`.github/workflows/riscv-oracle-regen.yml` does this on CI and fails if the
committed files differ from what Spike produces.
