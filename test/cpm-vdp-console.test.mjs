import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createZ80Target} from '../src/z80-target-factory.js';
import {CPM64K} from '../src/z80-machine.js';

const readRom = name => new Uint8Array(readFileSync(new URL(`../roms/cpm/${name}`, import.meta.url)));

test('CP/M BIOS writes the prompt and disk listing to the guest-addressable VDP', async () => {
    const config = {...CPM64K, ports: [...CPM64K.ports, {kind: 'vdp', name: 'vdp1', at: 0x98}]};
    const {adapter, target} = await createZ80Target({config, cpmSystem: {
        ccpBdos: readRom('cpm22-64k.bin'), bios: readRom('bios-vdp.bin'),
        files: Object.fromEntries(Array.from({length: 12}, (_, index) => [
            `HELLO${index}.TXT`, new TextEncoder().encode(`Hello from the TMS9918A #${index}\r\n`)
        ]))
    }});
    const {machine} = adapter;
    const vdp = machine.chips.vdp1;
    const nameTable = () => Array.from({length: 24}, (_, row) =>
        String.fromCharCode(...vdp.vram.subarray(row * 40, row * 40 + 40)).trimEnd()).join('\n');
    const until = expected => {
        for (let i = 0; i < 600 && !expected.test(nameTable()); i++) {
            for (let n = 0; n < 400; n++) machine.step();
        }
        assert.match(nameTable(), expected);
    };
    until(/^A>/m);
    for (const byte of new TextEncoder().encode('DIR\r')) target.sendSerial(byte);
    until(/HELLO0\s+TXT[\s\S]*\nA>\s*$/);
    assert.equal(target.video().mode, 'text');
    assert.deepEqual([target.video().width, target.video().height], [256, 192]);

    // Exercise the console's actual scroll code with normal guest output.
    for (let index = 0; index < 12; index++) {
        for (const byte of new TextEncoder().encode(`TYPE HELLO${index}.TXT\r`)) target.sendSerial(byte);
        until(new RegExp(`Hello from the TMS9918A #${index}\n\nA>\\s*$`));
    }
    assert.match(nameTable(), /^Hello from the TMS9918A/m);
    assert.doesNotMatch(nameTable(), /HELLO0\s+TXT/, 'the directory entry scrolled off the screen');
});
