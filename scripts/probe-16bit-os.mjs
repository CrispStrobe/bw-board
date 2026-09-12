#!/usr/bin/env node
// Diagnostic only: real ELKS boot sector with an emulated BIOS service layer.
// Never describes the service machine as a wired board or an OS acceptance.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {I8086Machine} from '../src/i8086-machine.js';
import {createDos8086, DOSBOX8086} from '../src/i8086-dos.js';

export const ELKS = Object.freeze({
    version:'0.9.2', source:'https://github.com/ghaerr/elks/tree/e7a56a4334e0ef9a2261d1c2de54db31ba40fdf0',
    image:'https://github.com/ghaerr/elks/releases/download/v0.9.2/fd360-minix.img',
    sha256:'d7d1fa0efa8ddf2ce90aedb07169604726bf723215b763e873497b9d8764e040',
    bytes:368640, kernelLicense:'GPL-2.0', distribution:'userland has component-specific licences; not bundled here'
});

export const MINIX = Object.freeze({
    version:'2.0.0 tiny/i86', source:'https://www.minix3.org/previous-versions/Intel-2.0.0/src/',
    image:'https://www.minix3.org/previous-versions/Intel-2.0.0/xt/TINYROOT',
    sha256:'add920872c8c335dbe6999e33704633455bfa640627211d27ec29acb11eb74a2',
    bytes:297472, kernelLicense:'BSD (retroactive 2000 grant)',
    distribution:'root image only; TINYUSR media and third-party notices still required for full acceptance'
});
export function verifyMedia(bytes, guest) {
    if (bytes.length !== guest.bytes || createHash('sha256').update(bytes).digest('hex') !== guest.sha256) {
        throw new Error('guest media size/hash mismatch');
    }
    return bytes;
}

export function probeOS(bytes, guest, {variant = '8086', maxSteps = 2000000} = {}) {
    if (!['8086','80186'].includes(variant)) throw new Error('OS probe: only actual 8086/80186 cores supported; wired 286 not boot-ready');
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 20000000) throw new Error('invalid maxSteps');
    verifyMedia(bytes, guest);
    const disk = new Uint8Array(368640); disk.set(bytes); // 360K floppy, short MINIX image zero-padded
    const machine = new I8086Machine({...DOSBOX8086, variant});
    const bios = createDos8086(machine, {disk,geometry:{sectors:9,heads:2}});
    // Install ONLY BIOS vectors. In particular, ELKS does not run on INT 21h
    // DOS services, and a kernel must be free to install its own vectors.
    bios.install({vectors:[0x10,0x11,0x12,0x13,0x15,0x16,0x19,0x1a]});
    bios.loadBoot(bytes.subarray(0,512),0);
    let steps = 0, reason = 'budget-exhausted', fault = null, lastPC = machine.cpu.pc;
    while (steps < maxSteps) {
        lastPC = machine.cpu.pc;
        try { bios.step(); steps++; }
        catch (error) {reason='cpu-fault'; fault=error.message; break;}
        if (bios.report().unsupported.length) {reason = 'unsupported-bios'; break;}
        if (machine.cpu.halted) {reason = 'cpu-halted'; break;}
        if ((steps & 255) === 0 && bios.stdout.includes('No ELKS setup signature found')) {reason = 'guest-loader-error'; break;}
    }
    return {guest, cpu:variant, backend:'bios-service-diagnostic', steps, reason,
        accepted:false, fault, cs:machine.cpu.cs, ip:machine.cpu.ip,
        ds:machine.cpu.ds, es:machine.cpu.es, ss:machine.cpu.ss,
        lastPC, lastBytes:Array.from({length:8},(_,i)=>machine._read((lastPC+i)&0xfffff)),
        unsupported:bios.report().unsupported, console:bios.stdout,
        screen:bios.screenText().join('\n').trimEnd()};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const guest = ({elks:ELKS,minix:MINIX})[process.argv[2] || 'elks'];
    if (!guest) throw new Error('guest must be elks or minix');
    const variant = process.argv[3] || '8086';
    if (!['8086','80186'].includes(variant)) throw new Error('CPU must be 8086 or 80186; 286 is not boot-ready');
    const response = await fetch(guest.image, {signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`guest download HTTP ${response.status}`);
    const bytes = verifyMedia(new Uint8Array(await response.arrayBuffer()),guest);
    console.log(JSON.stringify(probeOS(bytes,guest,{variant}),null,2));
    process.exitCode = 2; // A diagnostic is not a passing OS acceptance gate.
}
