#!/usr/bin/env bash
# Rebuild every oracle input from pinned sources and regenerate the committed
# fixtures in test/fixtures/riscv-oracle/. Used by
# .github/workflows/riscv-oracle-regen.yml and by hand.
#
#   SPIKE=/path/to/spike RISCV_TESTS=/path/riscv-tests ARCH_TEST=/path/riscv-arch-test \
#       bash test/riscv-oracle/regenerate.sh
#
# Needs: riscv64-unknown-elf-gcc (+ picolibc headers for the v environment's
# string.h), dtc on PATH (Spike runs it), node. The checkouts must be at the
# commits named in test/fixtures/riscv-oracle/PROVENANCE.md; this script
# refuses anything else.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${SPIKE:?set SPIKE to the spike binary}" "${RISCV_TESTS:?}" "${ARCH_TEST:?}"
RT_SHA=793a5ff2d99a6d9fbd91e84c34b9a0437e313b88
AT_SHA=fc32e41d49480fd99ba0a192dfff9c3319b44873
[ "$(git -C "$RISCV_TESTS" rev-parse HEAD)" = "$RT_SHA" ] || { echo "riscv-tests is not at $RT_SHA" >&2; exit 1; }
[ "$(git -C "$ARCH_TEST" rev-parse HEAD)" = "$AT_SHA" ] || { echo "riscv-arch-test is not at $AT_SHA" >&2; exit 1; }
work="${WORK:-$(mktemp -d)}"
PICO="${PICOLIBC_INCLUDE:-/usr/lib/picolibc/riscv64-unknown-elf/include}"

# riscv-tests: rv32ui/uc/um/ua/si/mi, p and v environments. Two build tweaks,
# neither touching a test: rv32ua is assembled as plain rv32g (binutils 2.42
# does not know zabha), and the Zacas tests (amocas_*) are dropped — Zacas is
# not part of this hart.
cp -a "$RISCV_TESTS" "$work/riscv-tests"
sed -i 's/compile_template,rv32ua,-march=rv32g_zacas_zabha/compile_template,rv32ua,-march=rv32g/' "$work/riscv-tests/isa/Makefile"
sed -i '/amocas_d amocas_w/d' "$work/riscv-tests/isa/rv32ua/Makefrag"
OPTS="-static -mcmodel=medany -fvisibility=hidden -nostdlib -nostartfiles -isystem $PICO"
for s in rv32ui rv32uc rv32um rv32ua rv32si rv32mi; do
    make -s -C "$work/riscv-tests/isa" XLEN=32 RISCV_PREFIX=riscv64-unknown-elf- RISCV_GCC_OPTS="$OPTS" "$s"
done
rt=$(ls "$work"/riscv-tests/isa/rv32{ui,uc,um,ua,si,mi}-[pv]-* | grep -v '\.dump$')

python3 "$here/build-arch-tests.py" "$ARCH_TEST" "$work/arch"
bash "$here/build-programs.sh" "$work/prog" >/dev/null

node "$here/build-fixtures.mjs" riscv-tests $rt
node "$here/build-fixtures.mjs" arch-test "$work"/arch/*.elf
node "$here/build-fixtures.mjs" programs "$work"/prog/*.elf
