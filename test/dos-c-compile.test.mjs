// The single-tool DOS C compiler path (Turbo C): TCC PROG.C -> PROG.EXE, then
// the 286 runs the .EXE it built. This is runCompile, distinct from runChain's
// MASM->LINK assembler pipeline — a C compiler does its own linking.
//
// The live compile needs a real TCC.EXE in MSDOS_BIN_DIR and skips cleanly when
// absent (a skip is "the licensed binary is not on this runner", never a pass).
// The routing assertions below are env-independent and always run: they prove
// the registry no longer misroutes Turbo C through the MASM chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLCHAINS, runToolchain } from '../scripts/toolchains.mjs';

const BIN = process.env.MSDOS_BIN_DIR;
const have = !!BIN && existsSync(join(BIN, 'TCC.EXE'));

test('Turbo C is a single-tool compile, not the MASM chain (routing is correct)', () => {
    const tcc = TOOLCHAINS.find((t) => t.id === 'tcc');
    assert.ok(tcc, 'tcc toolchain exists');
    assert.equal(tcc.compile, 'TCC.EXE', 'routes through runCompile with its own binary');
    assert.ok(!tcc.chain, 'does NOT route through the MASM->LINK chain');
    assert.equal(tcc.kind, 'dos', 'availability-gated on the binary');
});

test('TCC compiles a .C to an .EXE and the 286 runs it',
    { skip: have ? false : 'set MSDOS_BIN_DIR to a dir containing TCC.EXE (Turbo C)' }, () => {
        const dir = mkdtempSync(join(tmpdir(), 'dos-tcc-'));
        const src = join(dir, 'HELLO.C');
        writeFileSync(src, '#include <stdio.h>\nint main(void){ printf("OK\\n"); return 0; }\n');
        let out = '';
        const r = runToolchain('tcc', src, { flavor: '80286-at' }, { write: (s) => { out += s; } });
        assert.ok(r.ok, 'the compiler produced an executable');
        assert.equal(r.stages[0].tool, 'TCC.EXE', 'the compile stage ran the C compiler');
        assert.ok(r.ran && r.ran.terminated && r.ran.exitCode === 0, 'the 286 ran the built .EXE, exit 0');
        assert.match(out, /OK/, 'and printed its own output — the full C-source-to-output round-trip');
    });
