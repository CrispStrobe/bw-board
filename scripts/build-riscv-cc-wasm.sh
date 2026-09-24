#!/usr/bin/env bash
# Rebuild wasm/riscv-cc.wasm from source — the RISC-V C compiler the browser
# runs (see wasm/riscv-cc.PROVENANCE.md). It is shecc (BSD-2-Clause), compiled
# to wasm32-wasi. The committed .wasm is the authority; this script reproduces
# it and prints the sha256 to compare.
#
# Requirements:
#   - gcc + make        (to generate shecc's `config` and bundled-libc include)
#   - wasi-sdk          (to cross-compile to wasm32-wasi)  — set WASI_SDK=/path
#     Download: https://github.com/WebAssembly/wasi-sdk/releases
#
# Usage:
#   WASI_SDK=/opt/wasi-sdk-24.0 scripts/build-riscv-cc-wasm.sh
set -euo pipefail

SHECC_REPO="https://github.com/sysprog21/shecc"
SHECC_COMMIT="362b94b948c24cce7f897619de7e189376c6caa1"
# shecc bakes a translation timestamp into the compiler; pin it (to the shecc
# commit's own date) so the build is byte-reproducible. See PROVENANCE.md.
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1789687869}"

here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/wasm/riscv-cc.wasm"

: "${WASI_SDK:?set WASI_SDK to your wasi-sdk directory (contains bin/clang and share/wasi-sysroot)}"
[ -x "$WASI_SDK/bin/clang" ] || { echo "no clang at $WASI_SDK/bin/clang" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
echo "==> cloning shecc @ ${SHECC_COMMIT:0:12}"
git clone --quiet "$SHECC_REPO" "$work/shecc"
git -C "$work/shecc" checkout --quiet "$SHECC_COMMIT"

cd "$work/shecc"

echo "==> generating config + bundled libc (native, ARCH=riscv)"
make config ARCH=riscv >/dev/null
make out/libc.inc ARCH=riscv >/dev/null   # also builds inliner/norm-lf + the codegen symlink

echo "==> guarding the WASI-incompatible chmod in src/elf.c"
python3 - <<'PY'
p = "src/elf.c"
s = open(p).read()
old = ('    if (chmod(outfile, 0x1ed) < 0) /* 0755 */\n'
       '        usage_error("Unable to mark output executable");')
new = ('#ifndef __wasi__\n'
       '    /* WASI has no chmod; the caller reads the ELF back as bytes, so the mode\n'
       '     * bit is irrelevant there. Skip it rather than fail a good compile. */\n'
       '    if (chmod(outfile, 0x1ed) < 0) /* 0755 */\n'
       '        usage_error("Unable to mark output executable");\n'
       '#endif')
assert old in s, "chmod anchor not found — shecc source drifted from the pinned commit"
open(p, "w").write(s.replace(old, new))
PY

echo "==> compiling shecc -> wasm32-wasi (-Oz, stripped)"
"$WASI_SDK/bin/clang" --target=wasm32-wasi --sysroot="$WASI_SDK/share/wasi-sysroot" \
    -Oz -Wl,--strip-all -o "$out" src/main.c

echo "==> done: $out"
if command -v sha256sum >/dev/null; then sha256sum "$out"; else shasum -a 256 "$out"; fi
echo "    expected: 638c9129044f520f95a66cc25b76e64a59a075fd60a46cc92ba0a9ce3a8221d6"
