// Convergence: a program compiled by the code-tab toolchains (BASIC / C) runs on
// a REAL booted MS-DOS 2.0 kernel — not the fast INT 21h service bench. The DOS
// image is built from the owned Microsoft MS-DOS 2.0 files, booted from its FAT
// boot sector (IO.SYS -> MSDOS.SYS -> COMMAND.COM), and the compiled .COM is run
// from the A> prompt, so its INT 21h calls are served by the real DOS kernel.
//
// Needs the pinned MS-DOS 2.0 files in MSDOS_BIN_DIR; skips cleanly when absent
// (a skip is "the licensed binaries are not on this runner", never a pass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicToAsm } from '../src/basic-to-asm.js';
import { cToAsm } from '../scripts/cc.mjs';
import { assemble } from '../src/i8086-asm.js';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';
import { findMsdosFiles, build } from '../scripts/build-dos-image.mjs';
import { injectFile } from '../src/dos-fat-inject.js';

const BIN = process.env.MSDOS_BIN_DIR;
const have = !!BIN && findMsdosFiles([BIN]).ok;

/** Build a bootable MS-DOS 2.0 disk holding PROG.COM, boot it, run PROG, and
 *  return the console text once ECHO <marker> shows the prompt returned. */
function runComOnBootedDos(comBytes, marker, budget = 20_000_000) {
    const found = findMsdosFiles([BIN]);
    const built = build({ ...found.files, extra: [{ name: 'PROG.COM', data: comBytes }] });
    const disk = built.image.slice();
    const dos = createDos8086(new I8086Machine({ ...DOSBOX8086, variant: '80286' }),
        { disk, geometry: { sectors: 9, heads: 2 }, blockOnKey: true }).install();
    dos.type('\r\rPROG\rECHO ' + marker + '\r');
    dos.loadBoot(disk.subarray(0, 512), 0);
    let steps = 0;
    while (steps++ < budget) {
        dos.step();
        if ((steps & 1023) === 0 && dos.screenText().join('\n').includes(marker + '\n\nA>')) break;
    }
    return { steps, screen: dos.screenText().join('\n') };
}

test('a BASIC-compiled .COM runs on a real booted MS-DOS 2.0 kernel',
    { skip: have ? false : 'run `npm run fetch:free-dos` (MIT) or set MSDOS_BIN_DIR to the MS-DOS 2.0 files (COMMAND.COM, MSDOS.SYS, SYSINIT.OBJ)' }, () => {
        const com = assemble(basicToAsm('10 PRINT "BASIC-ON-REAL-DOS"\n20 PRINT 6*7\n'), { format: 'com' }).bytes;
        const { screen } = runComOnBootedDos(com, 'BDONE');
        assert.match(screen, /BASIC-ON-REAL-DOS/, 'the BASIC program printed its banner under real DOS');
        assert.match(screen, /(^|\n)42(\n|$)/, 'and evaluated 6*7');
        assert.match(screen, /BDONE\n\nA>/, 'COMMAND.COM regained its prompt after the program exited');
    });

test('the GUI path: a prebuilt base image + runtime FAT-inject runs on real DOS',
    { skip: have ? false : 'run `npm run fetch:free-dos` (MIT) or set MSDOS_BIN_DIR to the MS-DOS 2.0 files' }, () => {
        // How lite will do it without touching the receipt-pinned builder: build the
        // bootable image ONCE (no program baked in — a static asset), then the
        // browser-safe injector drops the compiled .COM onto a copy at runtime.
        const files = findMsdosFiles([BIN]).files;
        const baseImage = build({ ...files }).image;   // no `extra`
        const com = assemble(cToAsm('int sq(int x){return x*x;} int main(){printf("INJECTED %d\\n",sq(9)); return 0;}'), { format: 'com' }).bytes;
        const disk = injectFile(baseImage, 'PROG.COM', com);
        const dos = createDos8086(new I8086Machine({ ...DOSBOX8086, variant: '80286' }),
            { disk, geometry: { sectors: 9, heads: 2 }, blockOnKey: true }).install();
        dos.type('\r\rPROG\rECHO IJDONE\r');
        dos.loadBoot(disk.subarray(0, 512), 0);
        let steps = 0;
        while (steps++ < 20_000_000) { dos.step(); if ((steps & 1023) === 0 && dos.screenText().join('\n').includes('IJDONE\n\nA>')) break; }
        const screen = dos.screenText().join('\n');
        assert.match(screen, /INJECTED 81/, 'the injected .COM ran under real DOS (sq(9)=81)');
        assert.match(screen, /IJDONE\n\nA>/, 'COMMAND.COM regained its prompt');
    });

test('a C-compiled .COM (with a function call) runs on a real booted MS-DOS 2.0 kernel',
    { skip: have ? false : 'run `npm run fetch:free-dos` (MIT) or set MSDOS_BIN_DIR to the MS-DOS 2.0 files' }, () => {
        const com = assemble(cToAsm('int sq(int x){return x*x;} int main(){printf("C-ON-REAL-DOS %d\\n",sq(8)); return 0;}'), { format: 'com' }).bytes;
        const { screen } = runComOnBootedDos(com, 'CDONE');
        assert.match(screen, /C-ON-REAL-DOS 64/, 'the C program (calling sq()) printed its result under real DOS');
        assert.match(screen, /CDONE\n\nA>/, 'COMMAND.COM regained its prompt');
    });
