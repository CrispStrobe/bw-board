// The modular language->tool->machine registry: a native toolchain runs in CI
// with no external binary, DOS toolchains are availability-filtered, and machine
// flavors map onto the run-dos cores. This is what the code tab's compiler and
// machine dropdowns are built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listToolchains, runToolchain, FLAVORS, TOOLCHAINS } from '../scripts/toolchains.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'tc-'));

test('the native asm toolchain assembles and runs on the 286 — no external binary', () => {
    const src = join(DIR, 'p.asm');
    writeFileSync(src, "mov dx, offset msg\nmov ah, 9\nint 21h\nmov ax, 4c00h\nint 21h\nmsg: db 'OK$'\n");
    let out = '';
    const r = runToolchain('nasm-native', src, { flavor: '80286-at' }, { write: (s) => { out += s; } });
    assert.ok(r.ok, 'the source assembled');
    assert.ok(r.ran && r.ran.terminated && r.ran.exitCode === 0, 'and ran to a clean exit on the 286');
    assert.equal(out, 'OK', 'the assembled program printed its own output');
    assert.equal(r.flavor, '80286-at');
});

test('the same native source runs across machine flavors (8086 .. 80286)', () => {
    const src = join(DIR, 'p2.asm');
    writeFileSync(src, "mov ax, 4c00h\nint 21h\n");
    for (const flavor of ['8086', '8088-pc', '80186', '80286-at']) {
        const r = runToolchain('nasm-native', src, { flavor }, { write() {} });
        assert.ok(r.ran && r.ran.exitCode === 0, `ran on ${flavor}`);
    }
});

test('listToolchains filters DOS toolchains by binary availability; native is always offered', () => {
    assert.deepEqual(listToolchains('asm', { available: new Set() }).map((t) => t.id), ['nasm-native'],
        'nothing installed -> only the built-in assembler');
    assert.deepEqual(listToolchains('asm', { available: new Set(['MASM.EXE', 'LINK.EXE', 'EXE2BIN.EXE']) }).map((t) => t.id),
        ['nasm-native', 'masm'], 'MASM binaries present -> MASM appears');
    assert.deepEqual(listToolchains('asm', { available: new Set(['MASM.EXE']) }).map((t) => t.id), ['nasm-native'],
        'a partial toolset does not offer MASM (needs LINK + EXE2BIN too)');
    assert.deepEqual(listToolchains('bas', { available: new Set(['GWBASIC.EXE']) }).map((t) => t.id), ['gwbasic'],
        'language filtering picks the BASIC interpreter');
});

test('FLAVORS map to run-dos variant+preset; default is a 286', () => {
    assert.equal(FLAVORS['80286-at'].variant, '80286');
    assert.equal(FLAVORS['80286-at'].preset, 'at');
    assert.equal(FLAVORS['8088-pc'].preset, 'xt');
});

test('every toolchain is well-formed (language, kind, run target)', () => {
    for (const t of TOOLCHAINS) {
        assert.ok(t.language && t.kind && t.run, `${t.id} declares language/kind/run`);
        assert.ok(t.kind === 'native' || Array.isArray(t.tools), `${t.id} lists its DOS tools`);
    }
});
