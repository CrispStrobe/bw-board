#!/usr/bin/env node
// Headless browser-target FreeDOS replay. Media is supplied to the same
// factory and media slots used by the GUI; no external image is committed.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createDebugTarget} from '../src/debug-target-factory.js';
import {applyMedia} from '../src/machine-media.js';
import {buildFat16} from './lib/i80386-free-bios-fat16.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(path.join(root, file));
const BIOS = 'roms/free-at-bios/BIOS-bochs-legacy';
const VGA = 'roms/free-at-bios/vgabios-lgpl.bin';
const FLOPPY_SHA = '03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77';
const BIOS_SHA = '6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac';
const VGA_SHA = '76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1';
const floppyPath = process.env.FREEDOS_IMAGE ||
  '/mnt/volume1/tmp-astra/astra-external-freedos14/x86BOOT-1200.img';
const bios = read(BIOS), vga = read(VGA), floppy = fs.readFileSync(floppyPath);
if (bios.length !== 65536 || sha(bios) !== BIOS_SHA ||
    vga.length !== 38400 || sha(vga) !== VGA_SHA ||
    floppy.length !== 1228800 || sha(floppy) !== FLOPPY_SHA)
  throw new Error('headless browser-target media identity mismatch');

const geom = {cylinders: 306, heads: 4, sectors: 17};
const marker = Buffer.from('FREE-BIOS 386 C: MOUNT OK\r\n');
const {image: hdd} = buildFat16({geometry: geom, volLabel: 'FREEBIOSHD',
  files: [{name: 'CMOUNTOKTXT', bytes: marker}]});
const ordinary = JSON.parse(read('docs/receipts/2026-09-28-i80386-free-bios-freedos.json'));
if (!ordinary.passed || ordinary.input.hdd.sha256 !== sha(hdd) ||
    ordinary.input.floppy.sha256 !== FLOPPY_SHA)
  throw new Error('ordinary FreeDOS comparator or generated HDD identity mismatch');

const sourcePaths = [
  'src/debug-target-factory.js', 'src/i80386-adapter.js', 'src/i8086-debug.js',
  'src/machine-media.js', 'src/i8086-machine.js', 'src/i8086.js',
  'src/i8086-ram-words.js', 'src/experimental/i80286-protected.js',
  'src/experimental/i80386.js', 'src/experimental/i80386-at-machine.js',
  'src/experimental/ata16.js', 'src/at-8042-a20.js', 'src/at-ps2-mouse.js',
  'src/at-system-control.js', 'src/i8254.js', 'src/i8259.js', 'src/i8237.js',
  'src/cga-card.js', 'src/upd765.js', 'src/mc146818.js',
  'src/machine-checkpoint.js', 'src/vga-card.js',
  'src/experimental/vga-memory.js', 'src/experimental/i80386-vga-frame.js',
  'scripts/lib/i80386-free-bios-fat16.mjs',
  'scripts/run-i80386-browser-target-freedos.mjs',
];
const sourceSha256 = Object.fromEntries(sourcePaths.map(file => [file, sha(read(file))]));
const executionRevision = execFileSync('git', ['rev-parse', 'HEAD'],
  {cwd: root, encoding: 'utf8'}).trim();
// A source-bound run must execute committed source, not an unreviewed local edit.
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...sourcePaths], {cwd: root});

const {target, adapter} = await createDebugTarget('i80386', {profile: 'freedos-vga'});
const machine = adapter.machine;
const media = applyMedia({adapter, machine, kind: 'i80386'},
  {bios: new Uint8Array(bios), 'vga-rom': new Uint8Array(vga),
    hdd, floppy: new Uint8Array(floppy)});
if (media.errors.length || media.applied.join(',') !== 'bios,vga-rom,hdd,floppy')
  throw new Error('browser media setup failed: ' + JSON.stringify(media));
machine.reset();
const reset = {cs: machine.cpu.cs >>> 0, ip: machine.cpu.eip >>> 0,
  pc: machine.cpu.pc >>> 0, firstByte: machine._read386(0xfffffff0)};
if (reset.cs !== 0xf000 || reset.ip !== 0xfff0 ||
    reset.pc !== 0xfffffff0 || reset.firstByte !== 0xea ||
    machine._read386(0xf0000) !== bios[0] ||
    machine._read386(0xc0000 + vga.length - 1) !== vga.at(-1))
  throw new Error('browser-target ROM/reset mapping mismatch');

// Same prompt-driven keyboard schedule and settled DIR criterion as the
// ordinary free-BIOS runner. Use target.keyIn and target.runFor so both the
// browser input and debugger execution surfaces are exercised.
const scan = {a:0x1e,b:0x30,c:0x2e,d:0x20,e:0x12,f:0x21,g:0x22,h:0x23,
  i:0x17,j:0x24,k:0x25,l:0x26,m:0x32,n:0x31,o:0x18,p:0x19,q:0x10,r:0x13,
  s:0x1f,t:0x14,u:0x16,v:0x2f,w:0x11,x:0x2d,y:0x15,z:0x2c,' ':0x39,
  '\r':0x1c,'0':0x0b,'1':0x02,'2':0x03,'3':0x04,'4':0x05,'5':0x06,'6':0x07,
  '7':0x08,'8':0x09,'9':0x0a,'-':0x0c,'.':0x34,'\\':0x2b,':':0x27};
const encode = str => [...str].flatMap(ch => ch === ':'
  ? [{ch:'S',scan:0x2a},{ch,scan:0x27},{ch:'s',scan:0xaa}]
  : [{ch,scan:scan[ch.toLowerCase()]}]);
const rows = () => Array.from({length:25}, (_, y) => {
  let s = '';
  for (let x = 0; x < 80; x++) {
    const ch = machine._read386(0xb8000 + (y * 80 + x) * 2);
    s += ch >= 32 && ch <= 126 ? String.fromCharCode(ch) : ' ';
  }
  return s.replace(/\s+$/, '');
});
const ringEmpty = () =>
  (machine._read(0x41a) | machine._read(0x41b) << 8) ===
  (machine._read(0x41c) | machine._read(0x41d) << 8);
const limit = Number(process.env.MAX || 90_000_000);
if (!Number.isInteger(limit) || limit < 1 || limit > 90_000_000)
  throw new Error('MAX must be 1..90000000 completed machine step calls');
let calls = 0;
const ordinaryStep = machine.step.bind(machine);
machine.step = () => { calls++; return ordinaryStep(); };
const oneStepNs = machine.functionalInstructionCycles * 1e9 / machine.clockHz;
let keyScript = [], declined = false, cmdSent = false, menuKicks = 0;
let stop = 'max', lastChange = 0, prevScrHash = '';
const injected = [];
target.run();
while (calls < limit) {
  if (calls % 50000 === 0) {
    const scr = rows();
    const hash = scr.join('\n').replace(/\s/g, '');
    if (hash !== prevScrHash) { prevScrHash = hash; lastChange = calls; }
    const idle = calls - lastChange > 1_500_000;
    if (!declined && scr.some(line => /Do you want to proceed/i.test(line))) {
      keyScript.push(...encode('n\r')); declined = true;
    } else if (!declined && !keyScript.length && calls - menuKicks > 800_000 &&
      scr.some(line => /press \[ENTER\]|Select from Menu/i.test(line))) {
      keyScript.push(...encode('\r')); menuKicks = calls;
    } else if (declined && !cmdSent && !keyScript.length) {
      const prompt = scr.findIndex(line =>
        /^[A-Z]:\\?>?\s*$/.test(line.trim()) || /^[A-Z]:\\>/.test(line.trim()));
      if (prompt >= 0) { keyScript.push(...encode('dir c:\r')); cmdSent = true; }
      else if (idle) keyScript.push(...encode('\r'));
    }
    if (cmdSent && !keyScript.length && idle &&
        scr.some(line => /bytes free/i.test(line))) { stop = 'settled'; break; }
  }
  if (keyScript.length && ringEmpty() && target.keyIn(keyScript[0].scan))
    injected.push(keyScript.shift().ch);
  const remainingToCheck = 50000 - calls % 50000;
  const budgetSteps = keyScript.length ? 1 : Math.min(remainingToCheck, limit - calls);
  const before = calls;
  try { target.runFor(oneStepNs * budgetSteps); }
  catch (error) {
    if (!/AT 8042 |MC146818 /.test(error.message)) {
      stop = 'threw: ' + error.message; break;
    }
  }
  if (calls <= before || target.state() === 'halted') {
    stop = 'debugger-halted'; break;
  }
  if (machine.cpu.shutdown) { stop = 'shutdown'; break; }
  if (calls % 10_000_000 === 0)
    process.stdout.write(`PROGRESS calls=${calls} declined=${declined} cmdSent=${cmdSent}\n`);
}
const screenText = rows(), flat = screenText.join('\n');
const installerDeclined = declined &&
  screenText.some(line => /installation of FreeDOS .* has been aborted/i.test(line));
const reachedDosPrompt = /(^|\n)A:\\>/.test(flat);
const volumeLine = screenText.find(line => /Volume in drive C/i.test(line)) || null;
const markerLine = screenText.find(line => /CMOUNTOK\s+TXT/i.test(line)) || null;
const bytesFreeLine = screenText.find(line => /bytes free/i.test(line)) || null;
const cMounted = !!(cmdSent && volumeLine && markerLine && bytesFreeLine);
const frame = target.video();
const guestMatch = JSON.stringify(screenText) === JSON.stringify(ordinary.screenText) &&
  installerDeclined === ordinary.installerDeclined &&
  reachedDosPrompt === ordinary.reachedDosPrompt && cMounted === ordinary.cMounted;
const passed = installerDeclined && reachedDosPrompt && cMounted && guestMatch &&
  stop === 'settled';
const report = {schema:'astra.i80386-browser-target-freedos.v1', passed,
  scope:'Headless browser-target FreeDOS boot and C: mount; no GUI widget or Doom acceptance.',
  executionRevision, sourceSha256, media:{biosSha256:sha(bios),vgaSha256:sha(vga),
    floppySha256:sha(floppy),hddSha256:sha(hdd)},
  adapter:{profile:'freedos-vga',mediaApplied:media.applied,
    debuggerRunFor:true,keyboardViaTarget:true,frameViaTarget:true},
  comparator:'docs/receipts/2026-09-28-i80386-free-bios-freedos.json',
  reset, stepCalls:calls, stopReason:stop, installerDeclined,reachedDosPrompt,cMounted,
  guestMatch, keyboardScript:{requested:'n\rdir c:\r',injected},
  evidence:{volumeLine,markerLine,bytesFreeLine},screenText,
  frame:frame?{width:frame.width??null,height:frame.height??null,
    mode:frame.mode??null,why:frame.why??null,unsupported:frame.unsupported??null}:null};
const stamp = process.env.RECEIPT_DATE || new Date().toISOString().slice(0,10);
if (process.env.WRITE_RECEIPT !== '0') {
  const file = `docs/receipts/${stamp}-i80386-browser-target-freedos.json`;
  fs.writeFileSync(path.join(root,file), JSON.stringify(report,null,2)+'\n');
  process.stdout.write(`RECEIPT ${file}\n`);
}
process.stdout.write(`DONE passed=${passed} calls=${calls} stop=${stop} prompt=${reachedDosPrompt} `+
  `cMounted=${cMounted} guestMatch=${guestMatch}\n`);
if (!passed) process.exitCode = 1;
