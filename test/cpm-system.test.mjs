// The REAL CP/M 2.2 computer (src/cpm-system.js): DRI's genuine CCP+BDOS on our
// MIT BIOS with a RAM-disk — an A> prompt, not a BDOS shim. Proves a cold boot
// reaches A>, DIR lists a placed file, and running that file prints its output.
//
// Uses the redistributable ROMs in roms/cpm/ (see roms/cpm/PROVENANCE). Skips
// loudly (not silently) if they are absent, so a missing ROM can never look
// like a pass.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Z80Machine, CPM64K} from '../src/z80-machine.js';
import {createCpmSystem, buildCpmDisk} from '../src/cpm-system.js';
import {createZ80Target} from '../src/z80-target-factory.js';

// The ROMs are committed in-repo (roms/cpm/, redistributable — see PROVENANCE),
// so they load unconditionally: their absence is a broken checkout, a hard
// error, not a skip.
const romDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'roms', 'cpm');
const ccpPath = join(romDir, 'cpm22-64k.bin');
const biosPath = join(romDir, 'bios.bin');

// A minimal CP/M 2.2 program: print "CPMTEST OK" via BDOS 9, warm-boot to A>.
//   org 0x100 : ld de,msg / ld c,9 / call 5 / jp 0 / msg db 'CPMTEST OK',13,10,'$'
const TEST_COM = new Uint8Array([
    0x11, 0x0b, 0x01,        // ld de, 0x010b (msg)
    0x0e, 0x09,              // ld c, 9  (BDOS: print $-string)
    0xcd, 0x05, 0x00,        // call 5
    0xc3, 0x00, 0x00,        // jp 0     (warm boot)
    // msg at 0x010b:
    ...[...'CPMTEST OK'].map(c => c.charCodeAt(0)), 0x0d, 0x0a, 0x24
]);

/** Step until `pattern` appears in `out` after `from`, or the budget runs out. */
function runUntil(sys, getOut, pattern, budget, from = 0, idleLimit = 0) {
    let lastLen = getOut().length, quiet = 0;
    const hit = () => pattern && getOut().indexOf(pattern, from) >= 0;
    for (let i = 0; i < budget; i++) {
        if (hit()) return 'hit';
        sys.step();
        if (getOut().length > lastLen) { lastLen = getOut().length; quiet = 0; }
        else if (idleLimit > 0 && ++quiet > idleLimit && sys.consoleIdle()) {
            return hit() ? 'hit' : 'waiting';
        }
    }
    return 'budget';
}

test('buildCpmDisk lays down a real directory entry for each file', () => {
    const {image} = buildCpmDisk(new Uint8Array(0x1600), {'TEST.COM': TEST_COM});
    // Directory is at the start of the data area: OFS(2)*SPT(26)*128.
    const dir = 2 * 26 * 128;
    assert.equal(image[dir], 0x00, 'user 0');
    const name = String.fromCharCode(...image.subarray(dir + 1, dir + 9)).trim();
    const ext = String.fromCharCode(...image.subarray(dir + 9, dir + 12)).trim();
    assert.equal(name, 'TEST');
    assert.equal(ext, 'COM');
    assert.equal(image[dir + 16], 2, 'first data block is block 2 (after the 2 directory blocks)');
});

test('a cold boot reaches A>, DIR lists the file, and running it prints its output',    () => {
        const ccpBdos = new Uint8Array(readFileSync(ccpPath));
        const bios = new Uint8Array(readFileSync(biosPath));
        let out = '';
        const sys = createCpmSystem({
            ccpBdos, bios, files: {'TEST.COM': TEST_COM},
            onSerial: b => { out += String.fromCharCode(b); },
            Z80Machine, CPM64K
        });

        // Cold boot to the A> prompt.
        let r = runUntil(sys, () => out, 'A>', 100_000_000, 0, 0);
        assert.ok(r === 'hit' || r === 'waiting', `cold boot should reach A> (got ${r})`);

        // DIR lists TEST.COM.
        const dirMark = out.length;
        sys.sendText('DIR\r');
        r = runUntil(sys, () => out, 'A>', 50_000_000, dirMark, 0);
        assert.match(out.slice(dirMark), /TEST\s+COM/i, 'DIR should list TEST COM');

        // Run it — the CCP loads TEST.COM off the disk and it prints via BDOS.
        const runMark = out.length;
        sys.sendText('TEST\r');
        r = runUntil(sys, () => out, 'CPMTEST OK', 100_000_000, runMark);
        assert.equal(r, 'hit', 'running TEST.COM should print its output');
    });

test('the z80 adapter cpmSystem path (the GUI route) boots to A> and runs a file',    async () => {
        const ccpBdos = new Uint8Array(readFileSync(ccpPath));
        const bios = new Uint8Array(readFileSync(biosPath));
        let out = '';
        // createDebugTarget('z80', {cpmSystem}) is exactly what lite's attachZ80
        // will call; here through the target factory so attachBoard sets the
        // BIOS boot vector the way the GUI flow does.
        const {adapter} = await createZ80Target({
            cpmSystem: {ccpBdos, bios, files: {'TEST.COM': TEST_COM}}
        });
        adapter.onSerial(b => { out += String.fromCharCode(b); });
        const m = adapter.machine;
        const wait = (pat, budget, from = 0) => {
            for (let i = 0; i < budget; i++) {
                if (out.indexOf(pat, from) >= 0) return true;
                m.step();
            }
            return false;
        };
        const send = s => { for (const ch of s) adapter.sendSerial(ch.charCodeAt(0)); };

        assert.ok(wait('A>', 60_000_000), 'adapter cold boot reaches A>');
        const dirMark = out.length;
        send('DIR\r');
        assert.ok(wait('A>', 60_000_000, dirMark), 'DIR completes');
        assert.match(out.slice(dirMark), /TEST\s+COM/i, 'DIR lists TEST COM via the adapter');
        const runMark = out.length;
        send('TEST\r');
        assert.ok(wait('CPMTEST OK', 80_000_000, runMark), 'running TEST.COM prints its output');
    });
