// Independent, strict diagnostic reader of MOO 1.1 (dbalsom/moo specification).
// Separate from the legacy 8086 reader: masks, exceptions and hashes matter here.
import {HarrisBootCPU} from '../../src/experimental/harris-80c286-boot-cpu.js';

export const SST286_REVISION = '37c73caf53dcd22d3dd369ff09305d13d117a4fe';
export const REGISTERS = ['ax','bx','cx','dx','cs','ss','ds','es','sp','bp','si','di','ip','flags'];
const need = (ok, message) => { if (!ok) throw new Error(`SST286: ${message}`); };

function chunks(buffer, visit) {
    let offset = 0;
    const seen = new Set();
    while (offset < buffer.length) {
        need(offset + 8 <= buffer.length, 'truncated chunk header');
        const tag = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        need(offset + 8 + size <= buffer.length, `truncated ${tag}`);
        need(tag === 'TEST' || !seen.has(tag), `duplicate ${tag}`);
        seen.add(tag);
        visit(tag, buffer.subarray(offset + 8, offset + 8 + size));
        offset += 8 + size;
    }
}
function regs(b) {
    need(b.length >= 2, 'short registers');
    const mask = b.readUInt16LE(0), result = {};
    need(!(mask & 0xc000), 'unknown register bits');
    let offset = 2;
    REGISTERS.forEach((name, i) => {
        if (mask & (1 << i)) {
            need(offset + 2 <= b.length, 'truncated register');
            result[name] = b.readUInt16LE(offset); offset += 2;
        }
    });
    need(offset === b.length, 'register payload length');
    return result;
}
function counted(b, stride) {
    need(b.length >= 4, 'missing inner count');
    const count = b.readUInt32LE(0);
    need(b.length === 4 + count * stride, 'inner count mismatch');
    return count;
}
function state(b, initial) {
    const result = {regs: {}, ram: [], masks: {}};
    chunks(b, (tag, data) => {
        if (tag === 'REGS') result.regs = regs(data);
        else if (tag === 'RMSK') result.masks = regs(data);
        else if (tag === 'RAM ') {
            const count = counted(data, 5), seen = new Set();
            for (let i = 0; i < count; i++) {
                const address = data.readUInt32LE(4 + i * 5);
                need(address < 0x1000000 && !seen.has(address), 'invalid/duplicate RAM address');
                seen.add(address); result.ram.push([address, data[8 + i * 5]]);
            }
        } else if (tag === 'QUEU') need(counted(data, 1) === 0, 'prefetch queue unsupported');
        else throw new Error(`SST286: unsupported state chunk ${tag}`);
    });
    if (initial) need(REGISTERS.every(name => name in result.regs), 'incomplete initial registers');
    return result;
}
export function parseSST286(buffer) {
    const result = {masks: {}, tests: []};
    let count, mode;
    chunks(buffer, (tag, data) => {
        if (tag === 'MOO ') {
            need(data.length === 12 && data[0] === 1 && data[1] === 1 && data.toString('ascii', 8) === 'C286', 'requires C286 MOO 1.1');
            count = data.readUInt32LE(4);
        } else if (tag === 'META') {
            need(data.length >= 31, 'short metadata');
            mode = data[27];
            // Pinned files carry a cumulative generator count here (04:25000,
            // B8:134000), not the per-file count. Validate the MOO header below.
            result.generatorCount = data.readUInt32LE(15);
        } else if (tag === 'RMSK') result.masks = regs(data);
        else if (tag === 'TEST') {
            need(data.length >= 4, 'short test');
            const t = {index: data.readUInt32LE(0), exception: null};
            chunks(data.subarray(4), (subtag, payload) => {
                if (subtag === 'NAME') { counted(payload, 1); t.name = payload.toString('utf8', 4); }
                else if (subtag === 'BYTS') { counted(payload, 1); t.bytes = [...payload.subarray(4)]; }
                else if (subtag === 'INIT') t.initial = state(payload, true);
                else if (subtag === 'FINA') t.final = state(payload, false);
                else if (subtag === 'HASH') { need(payload.length === 20, 'invalid hash'); t.hash = payload.toString('hex'); }
                else if (subtag === 'CYCL') t.cycles = counted(payload, 15);
                else if (subtag === 'GMET') need(payload.length === 10, 'invalid generator metadata');
                else if (subtag === 'EXCP') {
                    need(payload.length === 5, 'invalid exception');
                    t.exception = {number: payload[0], flagAddress: payload.readUInt32LE(1)};
                } else throw new Error(`SST286: unsupported test chunk ${subtag}`);
            });
            need(t.initial && t.final && t.hash && t.bytes?.length && t.cycles > 0, 'incomplete test');
            result.tests.push(t);
        } else throw new Error(`SST286: unsupported file chunk ${tag}`);
    });
    need(mode === 0 && count > 0 && count === result.tests.length, 'mode/count mismatch');
    return result;
}
export function parseRevocations(text) {
    const hashes = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    need(hashes.every(hash => /^[a-f0-9]{40}$/.test(hash)), 'invalid revocation');
    return new Set(hashes);
}

// Test-only instruction-generator adapter. No physical board, cycles or timing
// are graded. Sparse storage represents all 16 MiB of writable, zero-filled RAM.
// Never use the expected final state to initialize or drive CPU execution.
export function executeSST286(t, fileMasks = {}, {maxTransfers = 4096} = {}) {
    need(Number.isSafeInteger(maxTransfers) && maxTransfers > 0, 'invalid transfer budget');
    if (t.exception) return {status: 'unsupported', reason: `exception-${t.exception.number}`, executed: false};
    const cpu = new HarrisBootCPU({enabled: true, board: {initialize(){}, submit(){}, clock(){}}});
    cpu.regs = Object.fromEntries(['ax','bx','cx','dx','sp','bp','si','di'].map(r => [r, t.initial.regs[r]]));
    for (const r of ['cs','ss','ds','es','ip','flags']) cpu[r] = t.initial.regs[r];
    cpu.csBase = cpu.cs * 16; cpu.status = 'running';
    const memory = new Map(t.initial.ram), writes = new Set();
    const iterator = cpu._instructions();
    let response, transfers = 0;
    try {
        for (;;) {
            const next = iterator.next(response);
            if (next.done) break;
            if (++transfers > maxTransfers) return {status:'budget', reason:'transfer-budget', executed:true};
            const {kind, address, width, value} = next.value;
            need(Number.isInteger(address) && address >= 0 && address + width <= 0x1000000 && [1,2].includes(width), 'invalid transfer');
            if (kind === 'code-read' && cpu.retired === 1) {
                // The harness injects HALT after taken flow control, without
                // changing stored RAM. Sequential HALT comes from initial RAM.
                const jumped = cpu.cs !== t.initial.regs.cs || cpu.ip !== t.initial.regs.ip + t.bytes.length - 1;
                response = jumped ? 0xf4 : (memory.get(address) ?? 0);
                if (response !== 0xf4) return {status:'unsupported',reason:'terminator-not-halt',executed:true};
            } else if (kind === 'code-read' || kind === 'memory-read') {
                response = memory.get(address) ?? 0;
                if (width === 2) response |= (memory.get(address + 1) ?? 0) << 8;
            } else if (kind === 'memory-write') {
                for (let i = 0; i < width; i++) {memory.set(address+i,(value >> (i*8)) & 255); writes.add(address+i);}
                response = undefined;
            } else throw new Error(`SST286: unsupported transfer ${kind}`);
        }
    } catch (error) {
        if (error.code?.startsWith('UNSUPPORTED_')) return {status:'unsupported',reason:error.code,executed:true};
        throw error;
    }
    need(cpu.status === 'halted' && [1,2].includes(cpu.retired), 'unexpected termination');
    const want = {...t.initial.regs, ...t.final.regs}, actual = {...cpu.regs};
    for (const r of ['cs','ss','ds','es','ip','flags']) actual[r] = cpu[r];
    const masks = {...fileMasks, ...t.final.masks}, diffs = [];
    for (const r of REGISTERS) {
        const mask = masks[r] ?? 65535;
        if ((actual[r] & mask) !== (want[r] & mask)) diffs.push({register:r,actual:actual[r],expected:want[r],mask});
    }
    const expectedMemory = new Map([...t.initial.ram, ...t.final.ram]);
    for (const address of new Set([...expectedMemory.keys(), ...writes])) {
        const expected = expectedMemory.get(address) ?? 0, actualByte = memory.get(address) ?? 0;
        if (actualByte !== expected) diffs.push({address,actual:actualByte,expected});
    }
    return {status:diffs.length ? 'fail' : 'pass',executed:true,diffs:diffs.slice(0,12)};
}
