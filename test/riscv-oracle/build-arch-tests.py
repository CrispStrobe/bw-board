#!/usr/bin/env python3
"""Build riscv-arch-test (3.10.0) RV32IMAC + Zifencei + privilege tests for our core.

A minimal stand-in for RISCOF's compile step: for each test source, read its
RVTEST_CASE lines, keep the cases whose `check` conditions our hart satisfies,
and compile with their `def` macros against our target env (arch-env/). The
same ELF is then run on Spike (reference signature) and on our core.

usage: build-arch-tests.py <arch-test checkout> <out dir>
"""
import os, re, subprocess, sys

ISA = 'RV32IMACZicsr_Zifencei'          # what the RVTEST_CASE regexes are matched against
SUITES = ['I', 'M', 'A', 'C', 'Zifencei', 'privilege']
# Platform facts the privilege tests ask about.
PLATFORM = {'hw_data_misaligned_support': 'True'}
CC = os.environ.get('RISCV_CC', 'riscv64-unknown-elf-gcc')

def cases(src):
    text = open(src).read()
    out = []
    for m in re.finditer(r'RVTEST_CASE\(\s*\d+\s*,\s*"([^"]*)"', text):
        body = m.group(1)
        ok = True
        for chk in re.findall(r'check\s+([A-Za-z_]+)\s*:=\s*([^;]+);', body):
            key, val = chk[0], chk[1].strip()
            if key == 'ISA':
                rx = re.match(r'regex\((.*)\)$', val)
                if not rx or not re.match(rx.group(1), ISA):
                    ok = False
            elif PLATFORM.get(key) != val:
                ok = False
        defs = re.findall(r'def\s+([A-Za-z_0-9]+)\s*=\s*([^;]+);', body)
        if ok:
            out.append(defs)
    return out

def main():
    root, outdir = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    env = os.path.join(here, 'arch-env')
    atenv = os.path.join(root, 'riscv-test-suite', 'env')
    os.makedirs(outdir, exist_ok=True)
    built, skipped = 0, []
    for suite in SUITES:
        sdir = os.path.join(root, 'riscv-test-suite', 'rv32i_m', suite, 'src')
        for f in sorted(os.listdir(sdir)):
            if not f.endswith('.S'):
                continue
            src = os.path.join(sdir, f)
            cs = cases(src)
            if not cs:
                skipped.append(f'{suite}/{f}')
                continue
            macros = sorted({f'-D{k}={v.strip()}' for c in cs for k, v in c})
            elf = os.path.join(outdir, f'{suite}-{f[:-2]}.elf')
            cmd = [CC, '-march=rv32imac_zicsr_zifencei', '-mabi=ilp32', '-static', '-mcmodel=medany',
                   '-fvisibility=hidden', '-nostdlib', '-nostartfiles', '-T', os.path.join(env, 'link.ld'),
                   '-I', env, '-I', atenv, '-DXLEN=32', *macros, '-o', elf, src]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                print(f'BUILD FAIL {suite}/{f}\n{r.stderr[-800:]}', file=sys.stderr)
                continue
            built += 1
    print(f'built {built}; not applicable to this hart: {len(skipped)}')
    for s in skipped:
        print('  n/a', s)

main()
