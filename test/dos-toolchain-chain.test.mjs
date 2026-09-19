// The self-hosting toolchain, guarded: the real MS-DOS MASM and LINK assemble
// and link a source into an .EXE on the fast 80286, and the 286 then runs the
// executable it built. Needs the pinned MS-DOS 2.0 binaries (MSDOS_BIN_DIR);
// skips cleanly when they are absent, the same way dos-toolchain-guest does — a
// skip here is "the licensed binaries are not on this runner", never a pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChain, runDos } from '../scripts/run-dos.mjs';

const BIN = process.env.MSDOS_BIN_DIR;
const have = !!BIN && existsSync(join(BIN, 'MASM.EXE')) && existsSync(join(BIN, 'LINK.EXE'));
const SOURCE = 'CODE\tSEGMENT\r\n\tASSUME CS:CODE\r\nSTART:\tMOV AH,4CH\r\n\tINT 21H\r\nCODE\tENDS\r\n\tEND START\r\n';

test('MASM -> LINK -> run: the 80286 assembles, links, and runs its own program',
    { skip: have ? false : 'set MSDOS_BIN_DIR to the MS-DOS 2.0 binaries (MASM.EXE, LINK.EXE)' }, () => {
        const dir = mkdtempSync(join(tmpdir(), 'dos-chain-'));
        const src = join(dir, 'PROG.ASM');
        writeFileSync(src, SOURCE);

        // Assemble + link on the 286.
        const c = runChain({ source: src, variant: '80286' }, { write() {} });
        assert.ok(c.ok, 'the chain produced an .EXE');
        assert.equal(c.stages[0].tool, 'masm');
        assert.ok(c.stages[0].terminated && c.stages[0].exitCode === 0, 'MASM exited 0');
        assert.ok(c.stages[0].created.some((n) => /\.OBJ$/i.test(n)), 'MASM wrote an OBJ');
        assert.equal(c.stages[1].tool, 'link');
        assert.ok(c.stages[1].terminated, 'LINK ran to completion');
        assert.equal(c.exe[0], 0x4d, 'the linked image is MZ (byte 0)');
        assert.equal(c.exe[1], 0x5a, 'the linked image is MZ (byte 1)');

        // Run the 286-built executable on the 286.
        const dir2 = mkdtempSync(join(tmpdir(), 'dos-chain-run-'));
        const exePath = join(dir2, 'PROG.EXE');
        writeFileSync(exePath, c.exe);
        const r = runDos({ program: exePath, variant: '80286', preset: 'at', max: 1_000_000, keys: '', files: [] }, { write() {} });
        assert.ok(r.result.terminated && r.result.exitCode === 0, 'the 286-built program ran and exited 0');
    });
