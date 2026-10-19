// run-dos: the DOSBox-shaped terminal runner. It loads a .COM/.EXE, runs it on
// a chosen 8086/286 board through the createDos8086 service layer, and streams
// the program's DOS output — the one-command "run a DOS program" path, plus a
// dosbox.conf importer that maps machine/cycles/autoexec onto the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDos, importDosboxConf } from '../scripts/run-dos.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'run-dos-'));

// A .COM that prints a string (INT 21h AH=09h) and exits (AH=4Ch). Loads at
// 0x100; the string follows the 12-byte code at offset 0x0C -> memory 0x10C.
function helloBytes(text = 'HI-286$') {
    const code = [0xBA, 0x0C, 0x01, 0xB4, 0x09, 0xCD, 0x21, 0xB8, 0x00, 0x4C, 0xCD, 0x21];
    return Uint8Array.from([...code, ...Buffer.from(text, 'ascii')]);
}
function helloCom(text = 'HI-286$', name = 'hello.com') {
    const path = join(DIR, name);
    writeFileSync(path, helloBytes(text));
    return path;
}

for (const variant of ['8086', '80286']) {
    test(`run-dos runs a .COM on ${variant} and streams its DOS output`, () => {
        let out = '';
        const { result, kind } = runDos({ program: helloCom('HELLO$'), variant, preset: 'at', max: 1_000_000, keys: '' },
            { write: (s) => { out += s; } });
        assert.equal(kind, 'com');
        assert.ok(result.terminated, 'the program reached INT 21h/4Ch');
        assert.equal(result.exitCode, 0);
        assert.equal(out, 'HELLO', 'the string reached the terminal (the $ terminator is not printed)');
    });
}

test('importDosboxConf maps machine -> board, reads cycles, and resolves the autoexec program', () => {
    writeFileSync(join(DIR, 'HELLO.COM'), helloBytes('X$'));
    const conf = join(DIR, 'game.conf');
    writeFileSync(conf, [
        '[dosbox]', 'machine = cga', '[cpu]', 'cycles = 3000',
        '[autoexec]', `mount c ${DIR}`, 'c:', 'HELLO.COM',
    ].join('\n'));
    const parsed = importDosboxConf(conf);
    assert.equal(parsed.preset, 'xt', 'a CGA machine maps to the XT-class board');
    assert.equal(parsed.cycles, '3000');
    assert.equal(parsed.machine, 'cga');
    assert.ok(parsed.program && parsed.program.endsWith('HELLO.COM'), 'the mounted autoexec program is resolved to a host path');
});

test('run-dos via --dosbox-conf runs the resolved program, and --variant stays authoritative', () => {
    const conf = join(DIR, 'game2.conf');
    writeFileSync(join(DIR, 'HELLO.COM'), helloBytes('OK$'));
    writeFileSync(conf, ['[dosbox]', 'machine = svga_s3', '[autoexec]', `mount c ${DIR}`, 'HELLO.COM'].join('\n'));
    let out = '';
    const r = runDos({ program: null, variant: '80286', preset: 'at', max: 1_000_000, keys: '', conf },
        { write: (s) => { out += s; } });
    assert.equal(r.variant, '80286', 'the conf did not clobber the requested 286 core');
    assert.equal(r.preset, 'at', 'svga_s3 -> AT-class board');
    assert.ok(r.result.terminated && out === 'OK', 'the conf-resolved program ran on the 286');
});
