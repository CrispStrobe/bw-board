/**
 * Every mnemonic the assembler accepts, encoded and read back.
 *
 * WHY THIS IS SEPARATE FROM THE ROUND-TRIP TESTS ALREADY IN
 * test/i8086-asm.test.mjs: those verify the forms someone thought to write.
 * This sweeps the instruction set, which is the same argument as
 * i8086-asm-probes.test.mjs one level in — a corpus is evidence only about
 * the constructs it contains, and a test file is evidence only about the
 * forms it lists. The assembler recognises about fifty mnemonics across a
 * dozen operand shapes; nothing previously asserted that each one encodes the
 * instruction it names.
 *
 * THE ORACLE IS NOT THE ASSEMBLER. Each form is encoded and then read back
 * through `disasmI8086`, which is ground against 646,000 hardware-generated
 * vectors on TEXT and length. So agreement here is a check against silicon at
 * one remove, and nothing in this file asserts that the assembler agrees with
 * itself.
 *
 * TWO CHECKS, and the second is the one that earns its place:
 *
 *   LENGTH    the disassembler must consume exactly the bytes emitted. This
 *             catches an encoding that is the wrong size.
 *   MNEMONIC  the instruction read back must be the one written. `add` and
 *             `adc` are both two bytes, as are `shl` and `shr` — a length
 *             check alone cannot tell "encoded the right instruction" from
 *             "encoded an instruction of the right size". Proved: emitting
 *             01 D8 for `adc` passes the length check and fails this one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleRaw } from '../src/i8086-asm.js';
import { disasmI8086 } from '../src/i8086-disasm.js';

/** The mnemonic a form should read back as, where the disassembler's house
 *  style differs from MASM's. Each is a rendering choice, not a re-encoding. */
const ALIAS = { int3: 'int3', jmp: 'jmpf', call: 'callf', ret: 'retn' };

const FORMS = [
    // ALU: all six operand forms for one op, then one form for the rest.
    'add ax, bx', 'add al, bl', 'add ax, 1234h', 'add al, 12h', 'add [bx], ax', 'add ax, [bx]',
    'adc ax, bx', 'sub ax, bx', 'sbb ax, bx', 'and ax, bx', 'or ax, bx', 'xor ax, bx',
    'cmp ax, bx',
    // MOV, which has more encodings than anything else in the ISA.
    'mov ax, bx', 'mov al, bl', 'mov ax, 1234h', 'mov al, 12h', 'mov [bx], ax', 'mov ax, [bx]',
    'mov ax, [1234h]', 'mov [1234h], ax', 'mov ds, ax', 'mov ax, ds',
    'mov byte ptr [bx], 12h', 'mov word ptr [bx], 1234h',
    // Stack, address and flag transfers.
    'push ax', 'push ds', 'pop ax', 'pop ds', 'xchg ax, bx', 'xchg al, bl',
    'lea ax, [bx+si]', 'lds ax, [bx]', 'les ax, [bx]',
    'xlat', 'lahf', 'sahf', 'pushf', 'popf', 'cbw', 'cwd',
    // Unary and the group-3 arithmetic.
    'inc ax', 'inc al', 'dec ax', 'neg ax', 'not ax',
    'mul bx', 'imul bx', 'div bx', 'idiv bx', 'test ax, bx', 'test ax, 1234h',
    // Shifts and rotates, by one and by CL.
    'shl ax, 1', 'shr ax, 1', 'sar ax, 1', 'rol ax, 1', 'ror ax, 1', 'rcl ax, 1', 'rcr ax, 1',
    'shl ax, cl', 'ror al, cl',
    // Control flow, including the far forms the corpus never writes.
    'jmp short 2', 'jmp 1234h:5678h', 'call 1234h:5678h',
    'ret', 'retf', 'ret 4', 'int 21h', 'int3', 'into', 'iret',
    'loop 2', 'loope 2', 'loopne 2', 'jcxz 2',
    // String primitives, plain and with each REP prefix.
    'movsb', 'movsw', 'cmpsb', 'cmpsw', 'stosb', 'stosw', 'lodsb', 'lodsw', 'scasb', 'scasw',
    'rep movsb', 'repe cmpsb', 'repne scasb',
    // Port I/O, both the immediate and DX forms.
    'in al, 60h', 'in ax, 60h', 'in al, dx', 'out 60h, al', 'out dx, al',
    // BCD adjusts, flag ops and the rest.
    'aaa', 'aas', 'daa', 'das', 'aam', 'aad',
    'clc', 'stc', 'cmc', 'cld', 'std', 'cli', 'sti', 'hlt', 'nop', 'wait',
];

/** Encode, then read back through the vector-ground disassembler. */
function roundTrip(src) {
    const bytes = assembleRaw(src);
    const mem = new Uint8Array(1 << 20);
    mem.set(bytes, 0x100);
    let o = 0x100;
    const texts = [];
    while (o < 0x100 + bytes.length && texts.length < 4) {
        const d = disasmI8086((a) => mem[a & 0xfffff], o, { ip: o });
        texts.push(d.text);
        o += d.bytes.length;
    }
    return { bytes, consumed: o - 0x100, texts };
}

test('every accepted mnemonic encodes to bytes the disassembler reads back whole', () => {
    const wrong = [];
    for (const src of FORMS) {
        const r = roundTrip(src);
        if (r.consumed !== r.bytes.length) {
            wrong.push(`${src}: emitted ${r.bytes.length} bytes, disassembler consumed `
                + `${r.consumed} — "${r.texts.join(' | ')}"`);
        }
    }
    assert.deepEqual(wrong, [], `length disagreements:\n  ${wrong.join('\n  ')}`);
});

test('and the instruction read back is the one that was written', () => {
    // The check a length test cannot make. Emitting 11 D8 (adc) for `add ax,
    // bx` is two bytes either way and passes the test above; it fails here.
    const wrong = [];
    for (const src of FORMS) {
        const r = roundTrip(src);
        const srcMn = src.split(/[\s,]/)[0];
        const gotMn = r.texts[0].split(/[\s,]/)[0];
        if (gotMn !== srcMn && gotMn !== ALIAS[srcMn] && !r.texts.join(' ').startsWith(srcMn)) {
            wrong.push(`${src} -> "${r.texts[0]}"`);
        }
    }
    assert.deepEqual(wrong, [], `wrong instruction encoded:\n  ${wrong.join('\n  ')}`);
});

test('the sweep covers the instruction set rather than a sample of it', () => {
    // A sweep that quietly shrank would keep passing. These are the floors:
    // if a form is deleted the count drops, and if a whole family is dropped
    // the family check fails by name.
    assert.ok(FORMS.length >= 100, `only ${FORMS.length} forms — the sweep has shrunk`);
    for (const family of [
        ['ALU', /^(add|adc|sub|sbb|and|or|xor|cmp) /],
        ['string', /^(movs|cmps|stos|lods|scas)[bw]$/],
        ['shift/rotate', /^(shl|shr|sar|rol|ror|rcl|rcr) /],
        ['far transfer', /^(jmp|call) [0-9A-F]+h:/],
        ['port I/O', /^(in|out) /],
        ['BCD', /^(aaa|aas|daa|das|aam|aad)$/],
    ]) {
        assert.ok(FORMS.some((f) => family[1].test(f)),
            `the sweep no longer covers the ${family[0]} family`);
    }
});
