// MIT. Explicit adapter for the two selected SCP ASM routines, not a general
// dialect detector. Input stays separately pinned; tests verify transformations.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assembleRaw} from '../../src/i8086-asm.js';

const root = new URL('../../test/fixtures/paterson/', import.meta.url);
export function patersonSource() {
    const manifest = JSON.parse(readFileSync(new URL('SOURCE.json', root)));
    const bytes = readFileSync(new URL(manifest.localPath, root));
    const hash = data => createHash('sha256').update(data).digest('hex');
    if (hash(bytes) !== manifest.sha256 || hash(readFileSync(new URL('LICENSE', root))) !== manifest.licenseSha256) {
        throw new Error('Paterson fixture provenance/hash mismatch');
    }
    return {manifest, text: bytes.toString('utf8')};
}

export function fat12Routines(source = patersonSource().text) {
    const start = source.indexOf('\nUNPACK:\n');
    const end = source.indexOf('\nUNSCALE:\n', start);
    if (start < 0 || end < 0) throw new Error('Paterson UNPACK/PACK excerpt boundaries missing');
    let segment;
    const result = [];
    for (const raw of source.slice(start, end).split('\n')) {
        let line = raw.split(';')[0].trim().replace(/\s+/g, ' ');
        if (!line) continue;
        if (line === 'SEG ES') { if (segment) throw new Error('duplicate SEG'); segment = 'ES'; continue; }
        // SCP single-operand shifts imply count=1; JP means short JMP.
        line = line.replace(/^(SHL|SHR) ([A-Z]+)$/, '$1 $2,1')
            .replace(/^JP /, 'JMP SHORT ')
            .replace(/^MOV B,/, 'MOV BYTE PTR ');
        if (segment) {
            if (!line.includes('[')) throw new Error('SEG not followed by a memory operand');
            line = line.replace('[', `${segment}:[`); segment = null;
        }
        result.push(line);
    }
    if (segment) throw new Error('dangling SEG');
    return result.join('\n');
}

// Caller supplies registers, separate DS/ES and stack. The fixed exit HLT is
// an owned test harness, not part of Paterson's utility.
export function fat12Assembly({pack = false, cluster = 2, value = 0xabc} = {}) {
    if (!Number.isInteger(cluster) || cluster < 2 || cluster > 100 || !Number.isInteger(value) || value < 0 || value > 0xfff) {
        throw new RangeError('test cluster must be 2..100 and FAT12 value 0..4095');
    }
    return `; Adapted from Microsoft/Tim Paterson CHKDSK; MIT, see original source and LICENSE.
; Owned caller: DS=SS=0, ES=0100h, FAT base ES:0600h, CHGCLS=0000:0500h.
; HLT ends a board routine test, not a DOS application.
MOV AX,0
MOV DS,AX
MOV SS,AX
MOV SP,0F000h
MOV AX,0100h
MOV ES,AX
MOV BX,0600h
MOV SI,${cluster}
MOV DX,${value}
${pack ? 'CALL PACK' : ''}
CALL UNPACK
HLT
CHGCLS EQU 0500h
${fat12Routines()}`;
}
export function fat12Program(options) {
    return assembleRaw(fat12Assembly(options), 0x100);
}
