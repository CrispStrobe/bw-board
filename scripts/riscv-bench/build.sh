#!/usr/bin/env bash
# Build the RISC-V benchmark ELFs used by scripts/bench-riscv32.mjs and the
# reference-simulator comparison: Dhrystone (riscv-tests benchmarks) and
# CoreMark (EEMBC), bare rv32im, fixed sizes, in two variants that differ ONLY
# in their syscall stub:
#   *-ecall.elf  write/exit by ecall (a7 = 64 / 93), user-level start — our
#                machine and rv32emu run it;
#   *-htif.elf   write/exit by HTIF tohost, riscv-tests' M-mode crt.S — Spike.
# Sources are fetched at pinned commits. Needs riscv64-unknown-elf-gcc and
# picolibc headers (only for the string/stdio declarations).
#
#   bash scripts/riscv-bench/build.sh OUTDIR [DHRYSTONE_RUNS] [COREMARK_ITERATIONS]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mkdir -p "$1" && cd "$1" && pwd)"
rm -f "$out"/{dhrystone,coremark}-{ecall,htif}.elf    # a failed build must not leave stale ELFs
RUNS="${2:-200000}"
ITER="${3:-100}"
RT_SHA=793a5ff2d99a6d9fbd91e84c34b9a0437e313b88     # riscv-tests
CM_SHA=1f483d5b8316753a742cbf5590caf5bd0a4e4777     # eembc/coremark
ENV_SHA=6de71edb142be36319e380ce782c3d1830c65d68    # riscv-test-env, as pinned by riscv-tests
CC="${RISCV_CC:-riscv64-unknown-elf-gcc}"
PICO="${PICOLIBC_INCLUDE:-/usr/lib/picolibc/riscv64-unknown-elf/include}"
work="$(mktemp -d)"
fetch() { git init -q "$work/$1" && git -C "$work/$1" fetch -q --depth 1 "$2" "$3" && git -C "$work/$1" checkout -q FETCH_HEAD; }
fetch riscv-tests https://github.com/riscv-software-src/riscv-tests.git "$RT_SHA"
fetch coremark https://github.com/eembc/coremark.git "$CM_SHA"
fetch env https://github.com/riscv/riscv-test-env.git "$ENV_SHA"     # riscv-tests' env submodule (encoding.h)
cm="$work/riscv-tests/benchmarks/common"

# The runtime's syscall/exit/stats, made switchable: -DBENCH_ECALL routes them
# through ecall and reads the user counters instead of HTIF and mcycle/minstret.
python3 - "$cm/syscalls.c" <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
s = s.replace("""static uintptr_t syscall(uintptr_t which, uint64_t arg0, uint64_t arg1, uint64_t arg2)
{
""", """static uintptr_t syscall(uintptr_t which, uint64_t arg0, uint64_t arg1, uint64_t arg2)
{
#ifdef BENCH_ECALL
  register uintptr_t a0 asm("a0") = arg0, a1 asm("a1") = arg1, a2 asm("a2") = arg2, a7 asm("a7") = which;
  asm volatile("ecall" : "+r"(a0) : "r"(a1), "r"(a2), "r"(a7) : "memory");
  return a0;
#endif
""", 1)
s = s.replace("""void __attribute__((noreturn)) tohost_exit(uintptr_t code)
{
""", """void __attribute__((noreturn)) tohost_exit(uintptr_t code)
{
#ifdef BENCH_ECALL
  register uintptr_t a0 asm("a0") = code, a7 asm("a7") = 93;
  asm volatile("ecall" : : "r"(a0), "r"(a7) : "memory");
#endif
""", 1)
s = s.replace("  READ_CTR(mcycle);\n  READ_CTR(minstret);", "#ifdef BENCH_ECALL\n  READ_CTR(cycle);\n  READ_CTR(instret);\n#else\n  READ_CTR(mcycle);\n  READ_CTR(minstret);\n#endif")
assert s.count("BENCH_ECALL") == 3, "syscalls.c patch did not apply"
open(p, "w").write(s)
PY

FLAGS=(-march=rv32im_zicsr -mabi=ilp32 -O2 -static -mcmodel=medany -fno-builtin-printf -fno-common -fno-tree-loop-distribute-patterns
       -nostdlib -nostartfiles -isystem "$PICO" -I "$cm" -I "$work/env" -T "$cm/test.ld")
build() {                                             # name variant sources...
    local name=$1 var=$2; shift 2
    if [ "$var" = ecall ]; then
        "$CC" "${FLAGS[@]}" -DBENCH_ECALL '-DBENCH_READ_TIMER()=read_csr(cycle)' "$here/start-ecall.S" "$cm/syscalls.c" "$@" -lgcc -o "$out/$name-ecall.elf"
    else
        "$CC" "${FLAGS[@]}" '-DBENCH_READ_TIMER()=read_csr(mcycle)' "$cm/crt.S" "$cm/syscalls.c" "$@" -lgcc -o "$out/$name-htif.elf"
    fi
}
dh="$work/riscv-tests/benchmarks/dhrystone"
# dhrystone.h defines NUMBER_OF_RUNS unconditionally; let -D choose it.
sed -i 's/^#define[[:space:]]*NUMBER_OF_RUNS[[:space:]].*/#ifndef NUMBER_OF_RUNS\n#define NUMBER_OF_RUNS 500\n#endif/' "$dh/dhrystone.h"
grep -q '^#ifndef NUMBER_OF_RUNS' "$dh/dhrystone.h"
# Its timer reads mcycle (an M-mode CSR); the ecall variant runs at user level
# on rv32emu, so the timer CSR is chosen per variant (cycle / mcycle).
sed -i 's/read_csr(mcycle)/BENCH_READ_TIMER()/g' "$dh/dhrystone.h"
grep -q 'BENCH_READ_TIMER' "$dh/dhrystone.h"
cmk="$work/coremark"
for v in ecall htif; do
    build dhrystone "$v" -DNUMBER_OF_RUNS="$RUNS" -I "$dh" "$dh/dhrystone.c" "$dh/dhrystone_main.c"
    build coremark "$v" -DITERATIONS="$ITER" -DPERFORMANCE_RUN=1 -I "$cmk" -I "$here" \
        "$cmk"/core_{list_join,main,matrix,state,util}.c "$here/core_portme.c"
done
rm -rf "$work"
ls -la "$out"
