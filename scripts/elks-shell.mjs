#!/usr/bin/env node
/**
 * elks-shell.mjs — boot ELKS to a shell and STEER it by keyboard, headless.
 *
 * The interactive sibling of run-elks-program.mjs: instead of injecting an
 * init, it boots the stock ELKS floppy to `login:`, logs in as root over the
 * emulated XT keyboard (machine.keyIn → 8255 port A + IRQ1, via
 * InteractiveConsole), then runs the lines you give it and prints the console.
 * This is the headless form of what the lite keyboard widget does live.
 *
 *   node scripts/elks-shell.mjs [--image FILE] [--login root] [cmd ...]
 *   echo -e "basic\n10 PRINT 6*7\nRUN" | node scripts/elks-shell.mjs --stdin
 *
 * The image is GPL-2 and never vendored — pass --image or set ELKS_IMAGE.
 */
import { existsSync, readFileSync } from 'node:fs';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { buildBios } from './build-bios.mjs';
import { InteractiveConsole } from '../src/interactive-console.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const IMAGE = opt('--image', process.env.ELKS_IMAGE
    || '/mnt/volume1/code/elks-images/fd1440-fat-official-v0.9.2.img');
const login = opt('--login', 'root');
const useStdin = args.includes('--stdin');
const cmds = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--image' && args[i - 1] !== '--login');

if (!existsSync(IMAGE)) {
    console.error(`no ELKS image at ${IMAGE}. Fetch it (GPL-2, not vendored) and pass --image / $ELKS_IMAGE.`);
    process.exit(2);
}

/** ELKS reads the floppy drive type from INT 13h AH=08h BL — supply it. */
function installFloppyDriveType(m) {
    const prior = m.hooks.onInterrupt;
    m.hooks.onInterrupt = (ev) => {
        if (ev.vector === 0x13 && ev.source === 'int') {
            const c = m.cpu;
            if (c.ah === 0x08 && c.dl < 0x80) {
                const g = m.chips.fdc1?.drives?.[c.dl & 3]?.geom;
                if (g) { const cy = g.cylinders | 0, sp = g.sectors | 0; c.bl = cy <= 40 ? 1 : sp >= 36 ? 5 : sp >= 18 ? 4 : sp >= 15 ? 2 : 3; }
            }
        }
        if (prior) prior(ev);
    };
}

const m = new I8086Machine(PCXT8086);
installFloppyDriveType(m);
m.loadRom(buildBios().bytes);
m.chips.fdc1.insert(0, readFileSync(IMAGE), { cylinders: 80, heads: 2, sectors: 18, bytesPerSector: 512 });
m.reset();

const con = new InteractiveConsole(m);
if (!con.waitFor('login:', 60_000_000)) { console.error('ELKS never reached a login prompt'); process.exit(1); }
con.sendLine(login, 3_000_000);

let lines = cmds;
if (useStdin) lines = readFileSync(0, 'utf8').split(/\r?\n/).filter((l) => l.length);
for (const line of lines) con.sendLine(line, 3_000_000);

console.log(con.screen().replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').trim());
