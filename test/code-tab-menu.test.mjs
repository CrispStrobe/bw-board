// The code-tab surface: language detection, per-toolchain starter templates,
// and the menu the GUI renders — plus the guarantee that every native starter
// actually assembles and runs on the 286 (a picked toolchain is runnable at once).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectLanguage, starterTemplate, codeTabMenu, runToolchain, LANGUAGES } from '../scripts/toolchains.mjs';

test('detectLanguage maps file extensions to languages', () => {
    assert.equal(detectLanguage('prog.asm'), 'asm');
    assert.equal(detectLanguage('/path/to/x.S'), 'asm');
    assert.equal(detectLanguage('hello.bas'), 'bas');
    assert.equal(detectLanguage('main.c'), 'c');
    assert.equal(detectLanguage('readme.txt'), null);
});

test('the code-tab menu lists every language with its available toolchains + machines', () => {
    const menu = codeTabMenu({ available: new Set() });   // no external binaries
    const byLang = Object.fromEntries(menu.languages.map((l) => [l.id, l]));
    assert.deepEqual(Object.keys(byLang).sort(), ['asm', 'bas', 'c']);
    // With nothing installed, each language still offers exactly its native toolchain.
    assert.deepEqual(byLang.asm.toolchains.map((t) => t.id), ['nasm-native']);
    assert.deepEqual(byLang.bas.toolchains.map((t) => t.id), ['basic-native']);
    assert.deepEqual(byLang.c.toolchains.map((t) => t.id), ['cc-native']);
    // Machine dropdown + a default.
    assert.ok(menu.flavors.some((f) => f.id === '80286-at'));
    assert.equal(menu.defaultFlavor, '80286-at');
    // Each toolchain carries a starter the tab can preload.
    for (const l of menu.languages) for (const t of l.toolchains) assert.ok(t.starter.length > 0, `${t.id} has a starter`);
});

test('every native starter template assembles and runs on the 286', () => {
    const dir = mkdtempSync(join(tmpdir(), 'starter-'));
    const menu = codeTabMenu({ available: new Set() });
    for (const l of menu.languages) {
        for (const t of l.toolchains) {   // all native (no binaries) with nothing installed
            const src = join(dir, `p_${t.id}.${l.ext[0]}`);
            writeFileSync(src, starterTemplate(t.id));
            let out = '';
            const r = runToolchain(t.id, src, { flavor: '80286-at' }, { write: (s) => { out += s; } });
            assert.ok(r.ran && r.ran.terminated && r.ran.exitCode === 0, `${t.id} starter ran cleanly`);
            assert.match(out, /Hello from/, `${t.id} starter printed its greeting`);
        }
    }
});

test('starters run across all machine flavors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'starter-flavors-'));
    for (const flavor of ['8086', '80186', '80286-at']) {
        const src = join(dir, 'p.bas');
        writeFileSync(src, starterTemplate('basic-native'));
        const r = runToolchain('basic-native', src, { flavor }, { write() {} });
        assert.ok(r.ran && r.ran.exitCode === 0, `basic starter ran on ${flavor}`);
    }
});
