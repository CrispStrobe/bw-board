// The 8086 assembler. The verification strategy is the whole point of this
// file: there is no reference assembler here, so every encoding is checked
// by ROUND TRIP through src/i8086-disasm.js, which is itself ground against
// 646,000 hardware-generated vectors on both text and instruction length.
// Assemble, disassemble, compare -- that is a check against real silicon at
// one remove, and it needs nothing installed.
//
// Where the disassembler's output differs from MASM's input (it prints
// `word [ds:bx+si+34A2h]`, lowercase, segment always named, `retn` for RET)
// the EXPECTED string is written the disassembler's way. Normalising in the
// other direction would mean re-deriving the encoder's own opinion, and the
// comparison would stop being independent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assemble, assembleRaw, AsmError } from '../src/i8086-asm.js';
import { disasmI8086 } from '../src/i8086-disasm.js';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';

/** Every opcode (and group sub-opcode) this file has pushed through the
 *  round trip. The last test asserts the count, so coverage cannot quietly
 *  fall off when a case is deleted. */
const VERIFIED = new Set();

const PREFIXES = new Set([0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf1, 0xf2, 0xf3]);
/** Opcodes whose real identity is in the ModR/M reg field. */
const GROUPS = new Set([0x80, 0x81, 0x82, 0x83, 0x8f, 0xc6, 0xc7,
    0xd0, 0xd1, 0xd2, 0xd3, 0xf6, 0xf7, 0xfe, 0xff]);

function opcodeKey(bytes) {
    let i = 0;
    while (PREFIXES.has(bytes[i])) i++;
    const op = bytes[i];
    const hex = op.toString(16).padStart(2, '0');
    return GROUPS.has(op) ? `${hex}/${(bytes[i + 1] >> 3) & 7}` : hex;
}

/**
 * Assemble a flat instruction stream at 0000:0000 and disassemble it back.
 * @returns {{ bytes: Uint8Array, texts: string[] }}
 */
function roundTrip(src) {
    const bytes = assembleRaw(src, 0);
    const texts = [];
    for (let a = 0; a < bytes.length;) {
        const d = disasmI8086((x) => bytes[x] ?? 0, a, { ip: a });
        // The disassembler is the authority on length as well as text, so a
        // stream that re-decodes to a different instruction count is caught
        // here rather than showing up as a wrong opcode much later.
        assert.ok(d.length > 0, 'the disassembler consumed at least one byte');
        VERIFIED.add(opcodeKey(d.bytes));
        texts.push(d.text);
        a += d.length;
    }
    return { bytes, texts };
}

/** One source line in; the disassembler's text for it out. */
function one(src) {
    const { texts } = roundTrip(src);
    assert.equal(texts.length, 1, `"${src}" is exactly one instruction, not ${texts.length}`);
    return texts[0];
}

/** Assert that `src` assembles to something the disassembler reads back as
 *  `want`, and say the claim rather than dumping both strings. */
function trip(src, want, claim) {
    assert.equal(one(src), want, claim || `${src} encodes as ${want}`);
}

const hexOf = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** The thing that raised, or null. */
function refusal(fn) {
    try { fn(); } catch (e) { return e; }
    return null;
}

// ---------------------------------------------------------------------------
// Addressing modes. Every one of the eight r/m codes, every mod, the direct
// form, and an override on each.
// ---------------------------------------------------------------------------

/** [source form, the disassembler's rendering of the same address] */
const MODES = [
    ['[BX+SI]', '[ds:bx+si]'],
    ['[BX+DI]', '[ds:bx+di]'],
    ['[BP+SI]', '[ss:bp+si]'],
    ['[BP+DI]', '[ss:bp+di]'],
    ['[SI]', '[ds:si]'],
    ['[DI]', '[ds:di]'],
    // BP with no displacement is the one address that must borrow a zero
    // displacement byte: mod 0 rm 6 is the DIRECT form, so encoding `[BP]`
    // the obvious way assembles an absolute address instead.
    ['[BP]', '[ss:bp+0h]'],
    ['[BX]', '[ds:bx]'],
    ['[1234h]', '[ds:1234h]'],
    ['[BX+SI+7]', '[ds:bx+si+7h]'],
    ['[BX+DI+7Fh]', '[ds:bx+di+7Fh]'],
    ['[BP+SI+80h]', '[ss:bp+si+80h]'],
    ['[BP+DI-5]', '[ss:bp+di-5h]'],
    ['[SI+3000h]', '[ds:si+3000h]'],
    ['[DI-1]', '[ds:di-1h]'],
    ['[BP-128]', '[ss:bp-80h]'],
    ['[BX-1]', '[ds:bx-1h]'],
    ['ES:[DI]', '[es:di]'],
    ['CS:[BP+2]', '[cs:bp+2h]'],
    ['SS:[1000h]', '[ss:1000h]'],
    ['DS:[BX+SI]', '[ds:bx+si]'],
];

test('every ModR/M addressing mode encodes, in both operand orders', () => {
    for (const [src, out] of MODES) {
        trip(`ADD ${src}, BH`, `add byte ${out}, bh`);
        trip(`ADD BH, ${src}`, `add bh, byte ${out}`);
        trip(`ADD ${src}, SP`, `add word ${out}, sp`);
        trip(`ADD SP, ${src}`, `add sp, word ${out}`);
        trip(`MOV BYTE PTR ${src}, 5`, `mov byte ${out}, 5h`);
        trip(`MOV WORD PTR ${src}, 500`, `mov word ${out}, 1F4h`);
        trip(`INC BYTE PTR ${src}`, `inc byte ${out}`);
        trip(`INC WORD PTR ${src}`, `inc word ${out}`);
        trip(`DEC BYTE PTR ${src}`, `dec byte ${out}`);
        trip(`DEC WORD PTR ${src}`, `dec word ${out}`);
        // LEA is the one instruction the disassembler prints without a size
        // keyword, because it never touches memory.
        if (!src.startsWith('[1234h]')) trip(`LEA BX, ${src}`, `lea bx, ${out}`);
    }
});

test('a zero displacement is encoded only when it has to be', () => {
    // mod 0 says "no displacement byte"; the disassembler prints one only
    // when mod says it was encoded, so these two forms are distinguishable
    // and the assembler must pick the short one.
    assert.equal(hexOf(assembleRaw('ADD [BX], BH')), '00 3f');
    assert.equal(hexOf(assembleRaw('ADD [BP], BH')), '00 7e 00', '[BP] borrows a zero disp8');
    assert.equal(hexOf(assembleRaw('ADD [BX+0], BH')), '00 3f', 'a written zero is still no displacement');
    assert.equal(hexOf(assembleRaw('ADD [BX+128], BH')), '00 bf 80 00', '128 does not fit a signed byte');
    assert.equal(hexOf(assembleRaw('ADD [BX-128], BH')), '00 7f 80', 'but -128 does');
});

test('a segment override is a prefix byte and appears only when written', () => {
    assert.equal(hexOf(assembleRaw('MOV AL, ES:[DI]')), '26 8a 05');
    assert.equal(hexOf(assembleRaw('MOV AL, [DI]')), '8a 05', 'no override, no prefix');
    // The assembler never invents an override from an ASSUME -- see the
    // module header. [BP] is SS-relative in the hardware and needs no help.
    assert.equal(hexOf(assembleRaw('MOV AL, [BP]')), '8a 46 00');
    assert.equal(hexOf(assembleRaw('MOV AL, SS:[BP]')), '36 8a 46 00', 'a redundant override is still emitted');
});

// ---------------------------------------------------------------------------
// The instruction set.
// ---------------------------------------------------------------------------

const ALU = ['ADD', 'OR', 'ADC', 'SBB', 'AND', 'SUB', 'XOR', 'CMP'];

test('the ALU group: all eight operations, all four operand forms', () => {
    for (const op of ALU) {
        const m = op.toLowerCase();
        trip(`${op} BL, CH`, `${m} bl, ch`);
        trip(`${op} BX, CX`, `${m} bx, cx`);
        trip(`${op} AL, 7`, `${m} al, 7h`, 'the accumulator has a form with no ModR/M');
        trip(`${op} AX, 700h`, `${m} ax, 700h`);
        trip(`${op} BL, 7`, `${m} bl, 7h`);
        trip(`${op} BX, 1000h`, `${m} bx, 1000h`);
        trip(`${op} WORD PTR [SI], 3`, `${m} word [ds:si], 3h`);
        trip(`${op} BYTE PTR [SI], 3`, `${m} byte [ds:si], 3h`);
        // Both directions: 00/01 puts the register in reg and the other
        // operand in r/m, 02/03 the reverse, and only the operand ORDER in
        // the source says which one was meant.
        trip(`${op} BL, BYTE PTR [SI]`, `${m} bl, byte [ds:si]`);
        trip(`${op} BX, WORD PTR [SI]`, `${m} bx, word [ds:si]`);
    }
    // 83 sign-extends a byte into a word and is two bytes shorter, which is
    // what MASM picks whenever the value fits.
    assert.equal(hexOf(assembleRaw('ADD BX, 5')), '83 c3 05');
    assert.equal(hexOf(assembleRaw('ADD BX, 500')), '81 c3 f4 01');
    assert.equal(hexOf(assembleRaw('ADD BX, -1')), '83 c3 ff');
});

test('MOV, in every form the 8086 has', () => {
    trip('MOV AL, BL', 'mov al, bl');
    trip('MOV AX, BX', 'mov ax, bx');
    trip('MOV DL, 0FFh', 'mov dl, FFh');
    trip('MOV DX, 0FFFFh', 'mov dx, FFFFh');
    trip('MOV [SI], BL', 'mov byte [ds:si], bl');
    trip('MOV BL, [SI]', 'mov bl, byte [ds:si]');
    trip('MOV [SI], BX', 'mov word [ds:si], bx');
    trip('MOV BX, [SI]', 'mov bx, word [ds:si]');
    trip('MOV DS, AX', 'mov ds, ax');
    trip('MOV ES, WORD PTR [BX]', 'mov es, word [ds:bx]');
    trip('MOV AX, SS', 'mov ax, ss');
    trip('MOV WORD PTR [BX], CS', 'mov word [ds:bx], cs');
    // The accumulator-to-direct-address forms are a byte shorter, and MASM
    // uses them. They disassemble the same as 8A/8B, so only the byte count
    // says which one came out -- hence both assertions on each.
    trip('MOV AL, [1234h]', 'mov al, byte [ds:1234h]');
    trip('MOV AX, [1234h]', 'mov ax, word [ds:1234h]');
    trip('MOV [1234h], AL', 'mov byte [ds:1234h], al');
    trip('MOV [1234h], AX', 'mov word [ds:1234h], ax');
    assert.equal(hexOf(assembleRaw('MOV AL, [1234h]')), 'a0 34 12');
    assert.equal(hexOf(assembleRaw('MOV AX, [1234h]')), 'a1 34 12');
    assert.equal(hexOf(assembleRaw('MOV [1234h], AL')), 'a2 34 12');
    assert.equal(hexOf(assembleRaw('MOV [1234h], AX')), 'a3 34 12');
    assert.equal(hexOf(assembleRaw('MOV BL, [1234h]')), '8a 1e 34 12', 'only AL and AX have it');
});

test('every register can be named, and case does not matter anywhere', () => {
    for (const r of ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH']) trip(`MOV ${r}, 1`, `mov ${r.toLowerCase()}, 1h`);
    for (const r of ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI']) trip(`MOV ${r}, 1`, `mov ${r.toLowerCase()}, 1h`);
    for (const r of ['ES', 'SS', 'DS']) trip(`MOV ${r}, AX`, `mov ${r.toLowerCase()}, ax`);
    trip('mov ax, bx', 'mov ax, bx');
    trip('MoV Ax, bX', 'mov ax, bx');
    trip('mov word ptr [si], 1', 'mov word [ds:si], 1h');
});

test('PUSH, POP, XCHG and the accumulator short forms', () => {
    for (const r of ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI']) {
        trip(`PUSH ${r}`, `push ${r.toLowerCase()}`);
        trip(`POP ${r}`, `pop ${r.toLowerCase()}`);
    }
    for (const r of ['ES', 'CS', 'SS', 'DS']) trip(`PUSH ${r}`, `push ${r.toLowerCase()}`);
    for (const r of ['ES', 'SS', 'DS']) trip(`POP ${r}`, `pop ${r.toLowerCase()}`);
    trip('PUSH WORD PTR [BP+4]', 'push word [ss:bp+4h]');
    trip('POP WORD PTR [BP+4]', 'pop word [ss:bp+4h]');
    for (const r of ['CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI']) {
        trip(`XCHG ${r}, AX`, `xchg ${r.toLowerCase()}, ax`);
        trip(`XCHG AX, ${r}`, `xchg ${r.toLowerCase()}, ax`, 'the one-byte form is symmetric');
    }
    trip('XCHG BL, CH', 'xchg bl, ch');
    trip('XCHG BX, WORD PTR [SI]', 'xchg bx, word [ds:si]');
    assert.equal(hexOf(assembleRaw('XCHG AX, AX')), '90', 'and it collides with NOP, as on the hardware');
});

test('INC and DEC pick the one-byte register form', () => {
    for (const r of ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI']) {
        trip(`INC ${r}`, `inc ${r.toLowerCase()}`);
        trip(`DEC ${r}`, `dec ${r.toLowerCase()}`);
    }
    assert.equal(hexOf(assembleRaw('INC BX')), '43');
    assert.equal(hexOf(assembleRaw('INC BL')), 'fe c3', 'there is no one-byte form for a byte register');
    trip('INC BL', 'inc bl');
    trip('DEC DH', 'dec dh');
});

test('the F6/F7 group: TEST, NOT, NEG, MUL, IMUL, DIV, IDIV', () => {
    for (const op of ['NOT', 'NEG', 'MUL', 'IMUL', 'DIV', 'IDIV']) {
        trip(`${op} BL`, `${op.toLowerCase()} bl`);
        trip(`${op} BX`, `${op.toLowerCase()} bx`);
        trip(`${op} BYTE PTR [SI]`, `${op.toLowerCase()} byte [ds:si]`);
        trip(`${op} WORD PTR [SI]`, `${op.toLowerCase()} word [ds:si]`);
    }
    trip('TEST AL, 3', 'test al, 3h');
    trip('TEST AX, 300h', 'test ax, 300h');
    trip('TEST BL, 3', 'test bl, 3h');
    trip('TEST BX, 300h', 'test bx, 300h');
    trip('TEST BL, CH', 'test bl, ch');
    trip('TEST BX, CX', 'test bx, cx');
    trip('TEST WORD PTR [SI], 1', 'test word [ds:si], 1h');
    assert.equal(hexOf(assembleRaw('TEST AL, 3')), 'a8 03', 'the accumulator form again');
});

test('the shifts and rotates, by one and by CL', () => {
    for (const op of ['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SAR']) {
        trip(`${op} BL, 1`, `${op.toLowerCase()} bl`);
        trip(`${op} BX, 1`, `${op.toLowerCase()} bx`);
        trip(`${op} BL, CL`, `${op.toLowerCase()} bl, cl`);
        trip(`${op} BX, CL`, `${op.toLowerCase()} bx, cl`);
        trip(`${op} BYTE PTR [SI], 1`, `${op.toLowerCase()} byte [ds:si]`);
        trip(`${op} WORD PTR [SI], CL`, `${op.toLowerCase()} word [ds:si], cl`);
    }
    trip('SAL AX, 1', 'shl ax', 'SAL is a spelling of SHL, not another opcode');
});

test('an immediate shift count becomes repeated single shifts, and says so', () => {
    // This is the loudest deliberate deviation in the assembler. On an 8086
    // the immediate-count shift opcode C1 decodes as `RET imm16`, so a file
    // that writes `SHL AX, 4` -- 52 of them in the corpus do -- cannot be
    // given the 80186 encoding without turning a shift into a return.
    const r = assemble('ORG 0\nSHL AX, 4\nEND\n', { format: 'com' });
    assert.equal(hexOf(r.bytes), 'd1 e0 d1 e0 d1 e0 d1 e0');
    assert.equal(r.warnings.length, 1, 'the expansion is recorded, not silent');
    assert.match(r.warnings[0].message, /80186/, 'and the warning says why');
    assert.equal(assembleRaw('SHR BYTE PTR [SI], 2').length, 4, 'two two-byte shifts');
    // Nothing about it may be inferred silently in the other direction.
    assert.equal(refusal(() => assembleRaw('SHL AX, 32')).what, 'bad shift count');
});

test('the conditional jumps, including every alias MASM accepts', () => {
    /** [what MASM may be given, what the disassembler calls it] */
    const CC = [
        [['JO'], 'jo'], [['JNO'], 'jno'],
        [['JB', 'JNAE', 'JC'], 'jb'], [['JNB', 'JAE', 'JNC'], 'jnb'],
        [['JE', 'JZ'], 'jz'], [['JNE', 'JNZ'], 'jnz'],
        [['JBE', 'JNA'], 'jbe'], [['JNBE', 'JA'], 'jnbe'],
        [['JS'], 'js'], [['JNS'], 'jns'],
        [['JP', 'JPE'], 'jp'], [['JNP', 'JPO'], 'jnp'],
        [['JL', 'JNGE'], 'jl'], [['JNL', 'JGE'], 'jnl'],
        [['JLE', 'JNG'], 'jle'], [['JNLE', 'JG'], 'jnle'],
    ];
    const opcodes = new Set();
    for (const [names, printed] of CC) {
        for (const n of names) {
            const { bytes, texts } = roundTrip(`HERE: ${n} HERE`);
            assert.equal(texts[0], `${printed} 0000h`, `${n} is the ${printed} opcode`);
            assert.equal(bytes.length, 2, 'a conditional jump is always two bytes on an 8086');
            opcodes.add(bytes[0]);
        }
    }
    assert.equal(opcodes.size, 16, 'all sixteen condition codes, and no two aliases collided');
});

test('LOOP, LOOPE, LOOPNE and JCXZ', () => {
    trip('HERE: LOOP HERE', 'loop 0000h');
    trip('HERE: LOOPE HERE', 'loope 0000h');
    trip('HERE: LOOPZ HERE', 'loope 0000h');
    trip('HERE: LOOPNE HERE', 'loopne 0000h');
    trip('HERE: LOOPNZ HERE', 'loopne 0000h');
    trip('HERE: JCXZ HERE', 'jcxz 0000h');
});

test('JMP and CALL: short, near, indirect and through memory', () => {
    // A backward target that reaches in eight bits shrinks; a forward one
    // that the first pass cannot see does not, unless SHORT says so.
    trip('HERE: JMP HERE', 'jmp 0000h');
    trip('HERE: CALL HERE', 'call 0000h');
    assert.equal(hexOf(assembleRaw('HERE: JMP HERE')), 'eb fe');
    assert.equal(hexOf(assembleRaw('JMP SHORT ON\nNOP\nON: NOP')), 'eb 01 90 90');
    assert.equal(hexOf(assembleRaw('CALL ON\nON: NOP')), 'e8 00 00 90', 'a near CALL has no short form');
    trip('JMP BX', 'jmp bx');
    trip('JMP WORD PTR [SI]', 'jmp word [ds:si]');
    trip('JMP DWORD PTR [SI]', 'jmpf word [ds:si]', 'FF /5 is the far indirect jump');
    trip('CALL BX', 'call bx');
    trip('CALL WORD PTR [SI]', 'call word [ds:si]');
    trip('CALL DWORD PTR [SI]', 'callf word [ds:si]');
    // A forward jump too far for eight bits has to widen, and the pass loop
    // is what discovers that.
    const far = roundTrip(`JMP AWAY\n${'NOP\n'.repeat(200)}AWAY: NOP`);
    assert.equal(hexOf(far.bytes.subarray(0, 3)), 'e9 c8 00', 'it widened to the near form');
    assert.equal(far.texts[0], 'jmp 00CBh', 'and the widened target is still the label');
});

test('the far CALL and far JMP immediates carry a relocation', () => {
    // These two cannot go through assembleRaw: their segment half is not
    // known until load time, so they only exist in an .EXE. The bytes are
    // read back out of the image and disassembled like any other.
    const r = assemble(`FAR_CODE SEGMENT
THERE:
    RETF
FAR_CODE ENDS
CODE SEGMENT
START:
    CALL FAR PTR THERE
    JMP FAR PTR THERE
CODE ENDS
END START
`);
    const header = (r.bytes[8] | (r.bytes[9] << 8)) * 16;
    const code = r.segments.find((s) => s.name === 'CODE');
    const at = header + code.para * 16;
    const image = r.bytes.subarray(at, at + 10);
    let off = 0;
    for (const want of ['callf 0000h:0000h', 'jmpf 0000h:0000h']) {
        const d = disasmI8086((x) => image[x] ?? 0, off, { ip: off });
        VERIFIED.add(opcodeKey(d.bytes));
        // The segment half reads back as zero because the relocation has not
        // been applied yet -- the loader adds the load segment. The offset
        // half is the real one, and FAR_CODE:THERE is offset zero.
        assert.equal(d.text, want);
        off += d.length;
    }
    assert.equal(r.bytes[6] | (r.bytes[7] << 8), 2, 'two relocations, one per far target');
});

test('RET, RETF and the far-procedure form', () => {
    trip('RET', 'retn');
    trip('RET 4', 'retn 4h');
    trip('RETF', 'retf');
    trip('RETF 8', 'retf 8h');
    // Inside a FAR procedure, RET must become the far return. Getting this
    // wrong pops two words too few and lands the program in its own data.
    const r = assemble('ORG 0\nP PROC FAR\nRET\nP ENDP\nQ PROC\nRET\nQ ENDP\nEND\n', { format: 'com' });
    assert.equal(hexOf(r.bytes), 'cb c3', 'RET follows the enclosing PROC distance');
});

test('IN, OUT, INT and the flag and BCD singles', () => {
    trip('IN AL, 60h', 'in al, 60h');
    trip('IN AX, 60h', 'in ax, 60h');
    trip('IN AL, DX', 'in al, dx');
    trip('IN AX, DX', 'in ax, dx');
    trip('OUT 60h, AL', 'out 60h, al');
    trip('OUT 60h, AX', 'out 60h, ax');
    trip('OUT DX, AL', 'out dx, al');
    trip('OUT DX, AX', 'out dx, ax');
    trip('INT 21h', 'int 21h');
    trip('INT 3', 'int3', 'INT 3 has its own one-byte opcode and MASM uses it');
    for (const [src, want] of [
        ['NOP', 'nop'], ['CBW', 'cbw'], ['CWD', 'cwd'], ['WAIT', 'wait'],
        ['PUSHF', 'pushf'], ['POPF', 'popf'], ['SAHF', 'sahf'], ['LAHF', 'lahf'],
        ['XLAT', 'xlat'], ['DAA', 'daa'], ['DAS', 'das'], ['AAA', 'aaa'], ['AAS', 'aas'],
        ['INTO', 'into'], ['IRET', 'iret'], ['HLT', 'hlt'], ['CMC', 'cmc'],
        ['CLC', 'clc'], ['STC', 'stc'], ['CLI', 'cli'], ['STI', 'sti'],
        ['CLD', 'cld'], ['STD', 'std'], ['INT3', 'int3'], ['LOCK NOP', 'lock nop'],
    ]) trip(src, want);
    trip('AAM', 'aam Ah', 'the base is an operand byte, and ten is the only one used');
    trip('AAD', 'aad Ah');
    trip('AAM 8', 'aam 8h');
});

test('LEA, LDS and LES', () => {
    trip('LEA DX, [BX+SI+4]', 'lea dx, [ds:bx+si+4h]');
    trip('LDS BX, [SI]', 'lds bx, dword [ds:si]');
    trip('LES DI, [BX+2]', 'les di, dword [ds:bx+2h]');
    // LEA of a plain label is the address, and is the same instruction --
    // 2,941 corpus lines are `LEA DX, message`.
    const r = assemble('ORG 0\nLEA DX, MSG\nMSG DB 1\nEND\n', { format: 'com' });
    assert.equal(hexOf(r.bytes), '8d 16 04 00 01');
});

test('the string primitives and their REP prefixes', () => {
    for (const op of ['MOVSB', 'MOVSW', 'STOSB', 'STOSW', 'LODSB', 'LODSW']) {
        trip(op, op.toLowerCase());
        trip(`REP ${op}`, `rep ${op.toLowerCase()}`);
    }
    for (const op of ['CMPSB', 'CMPSW', 'SCASB', 'SCASW']) {
        trip(op, op.toLowerCase());
        // CMPS and SCAS read the zero flag, so their REP spells out which way.
        trip(`REPE ${op}`, `repe ${op.toLowerCase()}`);
        trip(`REPZ ${op}`, `repe ${op.toLowerCase()}`);
        trip(`REPNE ${op}`, `repne ${op.toLowerCase()}`);
        trip(`REPNZ ${op}`, `repne ${op.toLowerCase()}`);
    }
    trip('REP MOVSB', 'rep movsb');
    trip('ES: LODSB', 'es lodsb', 'the only place an override is a word of its own');
    trip('ES REP MOVSB', 'es rep movsb');
});

// ---------------------------------------------------------------------------
// Directives.
// ---------------------------------------------------------------------------

/** Assemble a .COM at ORG 0 and hand back the bytes as hex. */
const com = (src) => hexOf(assembleRaw(src, 0));

test('DB, DW and DD, with strings, DUP, ? and nesting', () => {
    assert.equal(com("DB 1, 2, 0FFh, -1"), '01 02 ff ff');
    assert.equal(com("DB 'Hi$'"), '48 69 24');
    assert.equal(com('DB "Hi$"'), '48 69 24', 'both quote characters');
    assert.equal(com("DB 'It''s'"), '49 74 27 73', 'a doubled quote is one quote');
    assert.equal(com("DB 'a', 0DH, 0AH, '$'"), '61 0d 0a 24');
    assert.equal(com('DW 1234h, -1'), '34 12 ff ff');
    assert.equal(com('DD 12345678h'), '78 56 34 12');
    assert.equal(com('DB 3 DUP(0AAh)'), 'aa aa aa');
    assert.equal(com('DW 2 DUP(1234h)'), '34 12 34 12');
    assert.equal(com('DB 2 DUP(2 DUP(7))'), '07 07 07 07', 'DUP nests');
    assert.equal(com("DB 4 DUP('$')"), '24 24 24 24');
    // `?` is uninitialised, which for an image that has to exist means zero.
    assert.equal(com('DB ?, ?'), '00 00');
    assert.equal(com('DW 3 DUP(?)'), '00 00 00 00 00 00');
    // A label declared with DB carries a TYPE, and that is what makes a bare
    // reference to it a byte operand rather than a word one.
    assert.equal(com('V DB 0\nMOV AL, V'), '00 a0 00 00');
    assert.equal(com('V DW 0\nMOV AX, V'), '00 00 a1 00 00');
    assert.equal(refusal(() => assembleRaw("DW 'ABC'")).what, 'string too long');
});

test('EQU, `=`, and the $-minus-label idiom', () => {
    assert.equal(com('N EQU 7\nMOV AL, N'), 'b0 07');
    assert.equal(com('N EQU 7\nM EQU N*2+1\nMOV AL, M'), 'b0 0f');
    assert.equal(com('N = 3\nMOV AL, N'), 'b0 03');
    // `LEN EQU $-MSG` is how 84 corpus files measure a string. Two labels in
    // one segment subtract to a plain number; either one alone is an offset.
    assert.equal(com("MSG DB 'Hello'\nLEN EQU $-MSG\nMOV CX, LEN"), '48 65 6c 6c 6f b9 05 00');
    assert.equal(com('A DB 0\nB DB 0\nMOV AX, OFFSET B'), '00 00 b8 01 00');
    assert.equal(refusal(() => assembleRaw('N EQU BX')).what, 'equ of register');
});

test('expressions: precedence, parentheses, radices and character literals', () => {
    assert.equal(com('MOV AX, 2+3*4'), 'b8 0e 00');
    assert.equal(com('MOV AX, (2+3)*4'), 'b8 14 00');
    assert.equal(com('MOV AX, 100/7'), 'b8 0e 00');
    assert.equal(com('MOV AX, 100 MOD 7'), 'b8 02 00');
    assert.equal(com('MOV AX, 1 SHL 8'), 'b8 00 01');
    assert.equal(com('MOV AX, 0FF00h SHR 8'), 'b8 ff 00');
    assert.equal(com('MOV AX, 0F0h AND 3Ch'), 'b8 30 00');
    assert.equal(com('MOV AX, 0F0h OR 0Fh'), 'b8 ff 00');
    assert.equal(com('MOV AX, 0F0h XOR 0FFh'), 'b8 0f 00');
    assert.equal(com('MOV AX, -1'), 'b8 ff ff');
    assert.equal(com('MOV AX, 1010b'), 'b8 0a 00', 'a B suffix is binary, not a hex digit');
    assert.equal(com('MOV AX, 0000_1111b'), 'b8 0f 00', 'and underscores group digits');
    assert.equal(com('MOV AX, 1234d'), 'b8 d2 04', 'a D suffix is decimal, not a hex digit');
    assert.equal(com('MOV AX, 777o'), 'b8 ff 01');
    assert.equal(com('MOV AX, 0ABCDh'), 'b8 cd ab');
    assert.equal(com("MOV AL, 'A'"), 'b0 41');
    assert.equal(com("MOV AX, 'AB'"), 'b8 42 41', "'AB' is 4142h, the first character high");
    assert.equal(com('MOV AL, LOW 1234h'), 'b0 34');
    assert.equal(com('MOV AL, HIGH 1234h'), 'b0 12');
    assert.equal(com('MOV AX, NOT 0'), 'b8 ff ff');
});

test('LOW, HIGH and LENGTH lose to a defined symbol of the same name', () => {
    // MASM reserves these. The corpus writes `HIGH EQU 5` and `LENGTH EQU 16`
    // and then reads them back, so a symbol that exists wins.
    assert.equal(com('HIGH EQU 5\nMOV CX, HIGH'), 'b9 05 00');
    assert.equal(com('LENGTH EQU 16\nMOV CX, LENGTH'), 'b9 10 00');
    assert.equal(com('MASK EQU 3\nAND AL, MASK'), '24 03');
});

test('a bare data label is a memory operand; OFFSET makes it a number', () => {
    // The single rule a naive implementation always gets backwards.
    assert.equal(com('V DW 1234h\nMOV AX, V'), '34 12 a1 00 00');
    assert.equal(com('V DW 1234h\nMOV AX, OFFSET V'), '34 12 b8 00 00');
    assert.equal(com('V DW 1234h\nMOV AX, [V]'), '34 12 a1 00 00', 'brackets change nothing here');
    assert.equal(com('V DW 1234h\nMOV AX, V+2'), '34 12 a1 02 00');
    // `ARRAY[SI]` is `ARRAY + SI`, and 300 corpus operands are written that
    // way. A parser that only sees brackets at the start rejects every one.
    assert.equal(com('A DB 0\nMOV AL, A[SI]'), '00 8a 04');
    assert.equal(com('A DB 0\nMOV AL, A[BX+SI]'), '00 8a 00');
    assert.equal(com('A DB 0\nMOV AL, A[SI+2]'), '00 8a 44 02');
    assert.equal(com('A DB 0\nMOV AL, [A+SI]'), '00 8a 04', 'and it is the same address');
});

test('BYTE PTR and WORD PTR settle a size nothing else can', () => {
    assert.equal(com('MOV BYTE PTR [SI], 1'), 'c6 04 01');
    assert.equal(com('MOV WORD PTR [SI], 1'), 'c7 04 01 00');
    assert.equal(com('CMP BYTE PTR [SI], 0'), '80 3c 00');
    assert.equal(com('V DW 0\nMOV AL, BYTE PTR V'), '00 00 a0 00 00', 'a PTR overrides the declared type');
    const e = refusal(() => assembleRaw('MOV [SI], 1'));
    assert.equal(e.what, 'operand size unknown');
    assert.match(e.message, /BYTE PTR or WORD PTR/, 'and the refusal says what to write');
});

test('labels, forward references and label-shares-a-line-with-code', () => {
    assert.equal(com('JMP SHORT L\nNOP\nL: NOP'), 'eb 01 90 90');
    assert.equal(com('L: NOP\nJMP SHORT L'), '90 eb fd');
    assert.equal(com('START: MOV AL, 1\nJMP SHORT START'), 'b0 01 eb fc');
    // A word-sized forward reference into data cannot shrink, so its size is
    // stable from the first pass and one extra pass settles the addresses.
    const r = assemble('ORG 0\nMOV AX, V\nV DW 7\nEND\n', { format: 'com' });
    assert.equal(hexOf(r.bytes), 'a1 03 00 07 00');
    assert.ok(r.passes >= 2 && r.passes <= 4, `it settled in ${r.passes} passes`);
});

test('comments, blank lines and a comment holding a semicolon in quotes', () => {
    assert.equal(com('  ; nothing at all\n\nNOP ; trailing\n'), '90');
    // A comment starts at the first `;` that is NOT inside a string, and the
    // corpus really does declare `DB ';'`.
    assert.equal(com("DB ';' ; a real semicolon"), '3b');
    assert.equal(com("DB 'a;b'"), '61 3b 62');
});

test('ORG sets the origin, and padding forward is not the same thing', () => {
    const r = assemble('ORG 100h\nNOP\nEND\n');
    assert.equal(r.format, 'com', 'no segment directives means a .COM');
    assert.equal(r.org, 0x100);
    assert.equal(hexOf(r.bytes), '90');
    // A label after ORG must see the origin, or every address is 100h low.
    assert.equal(hexOf(assemble('ORG 100h\nL: JMP SHORT L\nEND\n').bytes), 'eb fe');
    assert.equal(com('NOP\nORG 4\nNOP'), '90 00 00 00 90', 'ORG inside a segment pads');
    assert.equal(refusal(() => assembleRaw('NOP\nNOP\nORG 1')).what, 'backwards ORG');
});

test('PROC/ENDP, CALL and RET make a working subroutine', () => {
    const r = assemble('ORG 0\nCALL P\nRET\nP PROC\nNOP\nRET\nP ENDP\nEND\n', { format: 'com' });
    assert.equal(hexOf(r.bytes), 'e8 01 00 c3 90 c3');
    assert.equal(refusal(() => assembleRaw('P PROC\nRET\nQ ENDP')).what, 'mismatched ENDP');
    assert.equal(refusal(() => assembleRaw('P PROC\nRET')).what, 'unclosed PROC');
});

test('MACRO/ENDM substitutes parameters on whole tokens only', () => {
    const r = assemble(`ORG 0
SAY MACRO CH
    MOV DL, CH
    MOV AH, 2
    INT 21h
ENDM
    SAY 'A'
    SAY 'B'
END
`, { format: 'com' });
    assert.equal(hexOf(r.bytes), 'b2 41 b4 02 cd 21 b2 42 b4 02 cd 21');
    // A parameter named N must not be substituted inside COUNT.
    assert.equal(com('M MACRO N\nMOV AX, COUNTN+N\nENDM\nCOUNTN EQU 16\nM 1'), 'b8 11 00');
    assert.equal(refusal(() => assembleRaw('M MACRO A\nNOP\nENDM\nM 1, 2')).what, 'macro arity');
    assert.equal(refusal(() => assembleRaw('M MACRO\nNOP')).what, 'unclosed MACRO');
});

test('LOCAL renames a macro label per expansion, and stably across passes', () => {
    // Without LOCAL the second expansion redefines the label; without a
    // per-PASS reset of the name counter the label is renamed between its
    // definition and the forward jump that was sized against it, and every
    // macro-local jump becomes an undefined symbol.
    const r = assemble(`ORG 0
SKIP MACRO
    LOCAL AHEAD
    JMP SHORT AHEAD
    NOP
AHEAD:
ENDM
    SKIP
    SKIP
END
`, { format: 'com' });
    assert.equal(hexOf(r.bytes), 'eb 01 90 eb 01 90');
    assert.equal(refusal(() => assembleRaw('M MACRO\nL: NOP\nENDM\nM\nM')).what, 'duplicate symbol',
        'and without LOCAL the duplicate is reported rather than silently taking one');
});

test('REPT, including a REPT nested inside a MACRO', () => {
    assert.equal(com('REPT 3\nNOP\nENDM'), '90 90 90');
    // The inner ENDM belongs to the macro BODY. Dropping it leaves the REPT
    // unterminated at expansion time and swallows the rest of the file.
    const r = assemble(`ORG 0
ZEROS MACRO HOWMANY
    REPT HOWMANY
    DW 0
    ENDM
ENDM
    ZEROS 3
    NOP
END
`, { format: 'com' });
    assert.equal(hexOf(r.bytes), '00 00 00 00 00 00 90');
});

test('IF/IFE/IFDEF/ELSE/ENDIF decide what exists, not what runs', () => {
    assert.equal(com('V EQU 1\nIF V\nMOV AL, 1\nELSE\nMOV AL, 2\nENDIF'), 'b0 01');
    assert.equal(com('V EQU 0\nIF V\nMOV AL, 1\nELSE\nMOV AL, 2\nENDIF'), 'b0 02');
    assert.equal(com('V EQU 0\nIFE V\nMOV AL, 1\nENDIF'), 'b0 01');
    assert.equal(com('V EQU 1\nIFDEF V\nMOV AL, 1\nENDIF'), 'b0 01');
    assert.equal(com('IFDEF NOPE\nMOV AL, 1\nENDIF\nNOP'), '90');
    assert.equal(com('IFNDEF NOPE\nMOV AL, 1\nENDIF'), 'b0 01');
    assert.equal(com('U EQU 2\nIF U EQ 1\nMOV AL, 1\nELSE\nMOV AL, 2\nENDIF'), 'b0 02',
        'EQ/NE/LT/GT compare inside a condition');
    // Nesting, with the outer branch dead: the inner IF must still be read,
    // or its ENDIF closes the outer one.
    assert.equal(com('IF 0\nIF 1\nMOV AL, 1\nENDIF\nENDIF\nNOP'), '90');
    assert.equal(refusal(() => assembleRaw('IF 1\nNOP')).what, 'unclosed IF');
    assert.equal(refusal(() => assembleRaw('ENDIF')).what, 'stray ENDIF');
});

test('the .MODEL SMALL form becomes an MZ .EXE with real relocations', () => {
    const r = assemble(`.MODEL SMALL
.STACK 100H
.DATA
    MSG DB 'Hi$'
.CODE
MAIN PROC
    MOV AX, @DATA
    MOV DS, AX
    MOV AX, 4C00H
    INT 21H
MAIN ENDP
END MAIN
`);
    assert.equal(r.format, 'exe');
    const u16 = (o) => r.bytes[o] | (r.bytes[o + 1] << 8);
    assert.equal(r.bytes[0], 0x4d, 'MZ');
    assert.equal(r.bytes[1], 0x5a);
    assert.equal(u16(0x06), 1, 'one relocation -- the @DATA word');
    assert.equal(u16(0x04), Math.ceil(r.bytes.length / 512), 'the page count covers the file');
    assert.equal(u16(0x02), r.bytes.length % 512);
    assert.equal(u16(0x18), 28, 'the relocation table follows the header');
    const header = u16(0x08) * 16;
    const relOff = u16(28);
    // The relocated word holds the data segment's PARAGRAPH inside the
    // image, which the loader biases by where it put us. Reading it from the
    // pass in progress instead of the previous one gives zero here, and
    // @DATA silently points at the code.
    const stored = r.bytes[header + relOff] | (r.bytes[header + relOff + 1] << 8);
    const dataSeg = r.segments.find((s) => s.name === '_DATA');
    assert.equal(stored, dataSeg.para, 'the stored word is the data paragraph');
    assert.equal(u16(0x16), r.segments.find((s) => s.name === '_TEXT').para, 'CS is the code paragraph');
    assert.equal(u16(0x10), 0x100, 'SP is the .STACK size');
    assert.equal(u16(0x0e), r.segments.find((s) => s.name === 'STACK').para);
});

test('the older SEGMENT/ENDS/ASSUME form assembles, and a segment name is a value', () => {
    const r = assemble(`DATA SEGMENT
    MSG DB "Hi$"
DATA ENDS
CODE SEGMENT
    ASSUME CS:CODE, DS:DATA
START:
    MOV AX, DATA
    MOV DS, AX
    LEA DX, MSG
    MOV AH, 09H
    INT 21H
    MOV AX, 4C00H
    INT 21H
CODE ENDS
END START
`);
    assert.equal(r.format, 'exe');
    assert.equal(r.bytes[0x06] | (r.bytes[0x07] << 8), 1, '`MOV AX, DATA` is a relocation, not a number');
    assert.deepEqual(r.segments.map((s) => s.name), ['DATA', 'CODE']);
    assert.equal(refusal(() => assemble('A SEGMENT\nNOP\nB ENDS\nEND')).what, 'mismatched ENDS');
});

test('SEG in a flat .COM image resolves to CS, and says so', () => {
    // A .COM has one segment and no relocation table, and at entry
    // CS = DS = ES = SS = that segment. `MOV AX, SEG X` therefore has
    // exactly one correct encoding, and `MOV AX, imm` is not it.
    const r = assemble('ORG 100h\nMOV AX, SEG V\nV DW 0\nEND\n');
    assert.equal(hexOf(r.bytes), '8c c8 00 00');
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0].message, /one segment/);
    // Anywhere else it cannot be expressed and is refused rather than faked.
    assert.equal(refusal(() => assemble('ORG 100h\nDW SEG V\nV DW 0\nEND\n')).what, 'reloc in com');
});

test('a refusal always names the line and the construct', () => {
    const cases = [
        ['NOP\nFROB AX, BX', 'unknown mnemonic FROB', 2],
        ['.MODEL LARGE\n.CODE\nNOP\nEND', '.MODEL LARGE', 1],
        ['.MODEL SMALL\n.CODE\n.FARDATA\nEND', 'unsupported directive .FARDATA', 3],
        // A word in the opcode field that is neither instruction, directive
        // nor macro is reported as a mnemonic, because that is what it looks
        // like -- naming it a "directive" would send the reader hunting for
        // one that does not exist.
        ['NOP\nFROBNICATE 1', 'unknown mnemonic FROBNICATE', 2],
        ['PUSH 5', 'i186 push imm', 1],
        ['POP CS', 'pop cs', 1],
        ['IMUL AX, BX, 4', 'i186 form', 1],
        ['MOV AX, BL', 'operand size mismatch', 1],
        ['MOV [SI], [DI]', 'memory to memory', 1],
        ['LEA AX, BX', 'lea of non-address', 1],
        ['OUT 300h, AL', 'port too high', 1],
        ['MOV AL, 300', 'immediate too wide', 1],
        ['DB 300', 'data too wide', 1],
        ['MOV AX, [BX+BP]', 'bad address', 1],
        ['JE AWAY\n' + 'NOP\n'.repeat(200) + 'AWAY: NOP', 'jump out of range', 1],
        ['MOV AX, NOWHERE', 'undefined symbol', 0],
        ['MOV AX, 1/0', 'division by zero', 1],
        ["DB 'unterminated", 'unterminated string', 1],
        ['NOP\nEXTRN FOO:WORD', 'unsupported directive EXTRN', 2],
    ];
    for (const [src, what, line] of cases) {
        // Assembled WITHOUT the ORG wrapper assembleRaw adds, so the line
        // number in the refusal is the line number in the string here.
        const e = refusal(() => assemble(src, { format: 'com' }));
        assert.ok(e instanceof AsmError, `"${src.split('\n')[0]}" raises an AsmError, not a TypeError`);
        assert.equal(e.what, what, `${JSON.stringify(src.split('\n').slice(0, 2).join(' / '))} is refused as ${what}`);
        assert.equal(e.line, line, 'and the refusal carries the line number');
        assert.match(e.message, /^8086 asm/, 'and the message says which assembler said so');
    }
});

test('nothing undocumented can be asked for by name', () => {
    // SETMO, SETMOC and SALC exist in the silicon and the disassembler names
    // them, because it has to decode whatever it is handed. A source file
    // asking for one is a different matter.
    for (const mn of ['SETMO', 'SETMOC', 'SALC', 'ESC', 'ENTER', 'LEAVE', 'BOUND', 'PUSHA', 'INSB']) {
        const e = refusal(() => assembleRaw(`${mn} AX`));
        assert.ok(e, `${mn} is not assembled`);
        assert.match(e.what, /unknown mnemonic|i186|operand/, `${mn} is refused, not encoded`);
    }
});

// ---------------------------------------------------------------------------
// End to end, under Tier B. The second oracle: the bytes are not just
// well-formed, they do the thing.
// ---------------------------------------------------------------------------

/** Assemble, load into a Tier B machine, run. */
function runIt(src, typed = '') {
    const r = assemble(src);
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m).install();
    if (r.format === 'exe') dos.loadExe(r.bytes); else dos.loadCom(r.bytes);
    if (typed) dos.type(typed);
    const run = dos.run(2_000_000);
    return { r, dos, run };
}

test('a .MODEL SMALL program assembles, loads as an .EXE and prints', () => {
    const { dos, run } = runIt(`.MODEL SMALL
.STACK 100H
.DATA
    MSG DB 'Hello, assembler!', 0DH, 0AH, '$'
.CODE
MAIN PROC
    MOV AX, @DATA
    MOV DS, AX
    LEA DX, MSG
    MOV AH, 09H
    INT 21H
    MOV AX, 4C07H
    INT 21H
MAIN ENDP
END MAIN
`);
    assert.ok(run.terminated, 'the program exited');
    assert.equal(run.exitCode, 7, 'with the exit code it asked for');
    assert.equal(dos.stdout, 'Hello, assembler!\r\n');
});

test('a SEGMENT-form program assembles, loads as an .EXE and prints', () => {
    const { dos, run } = runIt(`DATA SEGMENT
    MSG DB "segmented$"
DATA ENDS
STACKSEG SEGMENT
    DW 128 DUP(0)
STACKSEG ENDS
CODE SEGMENT
    ASSUME CS:CODE, DS:DATA, SS:STACKSEG
START:
    MOV AX, DATA
    MOV DS, AX
    MOV AX, STACKSEG
    MOV SS, AX
    MOV SP, 256
    LEA DX, MSG
    MOV AH, 09H
    INT 21H
    MOV AX, 4C00H
    INT 21H
CODE ENDS
END START
`);
    assert.ok(run.terminated);
    assert.equal(dos.stdout, 'segmented');
});

test('an ORG 100h program assembles, loads as a .COM and prints', () => {
    const { r, dos, run } = runIt(`ORG 100H
START:
    MOV DX, OFFSET MSG
    MOV AH, 09H
    INT 21H
    MOV AX, 4C00H
    INT 21H
MSG DB 'flat com$'
END START
`);
    assert.equal(r.format, 'com', 'no segment directives means a .COM image');
    assert.ok(run.terminated);
    assert.equal(dos.stdout, 'flat com');
});

test('procedures, loops, DIV and a macro all cooperate on a real answer', () => {
    // The shape almost every corpus program has: a decimal printer built
    // from DIV and a digit stack, driven through CALL. If any of the
    // addressing, the relative call, the stack or the loop is wrong the
    // number comes out wrong rather than the program failing to load.
    const { dos, run } = runIt(`.MODEL SMALL
.STACK 100H
.DATA
    VALUES DW 12, 345, 6789
    COUNT  EQU ($-VALUES)/2
    GAP    DB ' $'
.CODE
SHOW MACRO WHICH
    MOV AX, WHICH
    CALL PRINT_DECIMAL
    LEA DX, GAP
    MOV AH, 09H
    INT 21H
ENDM
MAIN PROC
    MOV AX, @DATA
    MOV DS, AX
    MOV CX, COUNT
    XOR SI, SI
EACH:
    PUSH CX
    SHOW VALUES[SI]
    ADD SI, 2
    POP CX
    LOOP EACH
    MOV AX, 4C00H
    INT 21H
MAIN ENDP

PRINT_DECIMAL PROC
    PUSH BX
    PUSH CX
    PUSH DX
    XOR CX, CX
    MOV BX, 10
PD_SPLIT:
    XOR DX, DX
    DIV BX
    PUSH DX
    INC CX
    OR AX, AX
    JNZ PD_SPLIT
PD_EMIT:
    POP DX
    ADD DL, '0'
    MOV AH, 02H
    INT 21H
    LOOP PD_EMIT
    POP DX
    POP CX
    POP BX
    RET
PRINT_DECIMAL ENDP
END MAIN
`);
    assert.ok(run.terminated);
    assert.equal(dos.stdout, '12 345 6789 ', 'EQU-from-$, VALUES[SI], the macro and DIV all agree');
});

test('string primitives with REP move real bytes', () => {
    const { dos, run } = runIt(`.MODEL SMALL
.STACK 100H
.DATA
    SRC DB 'copied$'
    DST DB 7 DUP('?')
.CODE
MAIN PROC
    MOV AX, @DATA
    MOV DS, AX
    MOV ES, AX
    LEA SI, SRC
    LEA DI, DST
    MOV CX, 7
    CLD
    REP MOVSB
    LEA DX, DST
    MOV AH, 09H
    INT 21H
    MOV AX, 4C00H
    INT 21H
MAIN ENDP
END MAIN
`);
    assert.ok(run.terminated);
    assert.equal(dos.stdout, 'copied');
});

test('an out-of-range jump is refused instead of wrapping around', () => {
    // The failure mode being prevented: a displacement that does not fit
    // truncates to something that decodes, and the program jumps somewhere
    // plausible-looking instead of failing to build.
    const body = 'NOP\n'.repeat(200);
    const e = refusal(() => assembleRaw(`BACK: ${body}JNZ BACK`));
    assert.equal(e.what, 'jump out of range');
    assert.match(e.message, /-20[0-9] bytes away/, 'and it says how far away the target is');
});

// ---------------------------------------------------------------------------
// Regressions. Both of these were found by RUNNING the corpus, not by
// disassembling it: the bytes were correct in the first case and internally
// consistent in the second, so no amount of reading the output would have
// shown either. The tests are written the way the bugs were found.
// ---------------------------------------------------------------------------

test('a label the default segment register cannot reach gets an override', () => {
    // THE `INT 21H` -> `CD 02` BUG. `FIRST_AT DW 0` after `.CODE` puts the
    // variable in _TEXT, but `MOV FIRST_AT, AX` still reaches through DS.
    // With _DATA at paragraph 0 and _TEXT at paragraph 6 of one image,
    // DS:00B9h aliases _TEXT:0059h, and the store landed on the operand
    // byte of an `INT 21H` further down the code. Nothing threw; the
    // program ran, printed most of its answer, and took an NMI.
    const inCode = assemble(`.MODEL SMALL
.STACK 100H
.DATA
    IN_DATA DW 0
.CODE
MAIN PROC
    MOV AX, @DATA
    MOV DS, AX
    MOV IN_DATA, AX
    MOV IN_CODE, AX
    MOV BX, IN_CODE
    MOV AX, 4C00H
    INT 21H
MAIN ENDP
IN_CODE DW 0
END MAIN
`);
    const header = (inCode.bytes[8] | (inCode.bytes[9] << 8)) * 16;
    const text = inCode.segments.find((s) => s.name === '_TEXT');
    const img = inCode.bytes.subarray(header + text.para * 16, header + text.para * 16 + text.size);
    const seen = [];
    for (let a = 0; a < img.length;) {
        const d = disasmI8086((x) => img[x] ?? 0, a, { ip: a });
        if (/mov (word|bx)/.test(d.text)) seen.push(d.text);
        a += d.length;
    }
    assert.deepEqual(seen, [
        'mov word [ds:0h], ax',      // in .DATA: DS is assumed to hold it
        'mov word [cs:16h], ax',     // in .CODE: only CS reaches it
        'mov bx, word [cs:16h]',
    ], 'the segment a label lives in decides which register reaches it');
});

test('the .COM and no-ASSUME dialects gain no overrides from any of that', () => {
    // A flat .COM has one segment and every register points at it, so the
    // override logic must stay completely out of the way -- this is the
    // regression that catches it over-firing.
    assert.equal(hexOf(assembleRaw('V DW 0\nMOV V, AX\nMOV AX, V')), '00 00 a3 00 00 a1 00 00');
    // The bare SEGMENT dialect says nothing about DS, and not knowing is not
    // the same as knowing it is wrong: no override, no refusal.
    const bare = assemble('D SEGMENT\nV DW 0\nD ENDS\nC SEGMENT\nS: MOV AX, V\nC ENDS\nEND S\n');
    const h = (bare.bytes[8] | (bare.bytes[9] << 8)) * 16;
    const c = bare.segments.find((s) => s.name === 'C');
    assert.equal(bare.bytes[h + c.para * 16], 0xa1, 'no prefix invented where nothing was assumed');
});

test('a store into a code-segment variable does not corrupt the code, and the answer is right', () => {
    // The runtime half of the same bug, and the shape of check that found
    // it: run the program and require it to reach the right answer rather
    // than merely to exit.
    const { dos, run } = runIt(`.MODEL SMALL
.STACK 100H
.DATA
    NUMS DW 2, 4, 8, 8, 11
    M_AT DB 'at $'
.CODE
MAIN PROC
    MOV AX, @DATA
    MOV DS, AX
    MOV CX, 5
    XOR SI, SI
SCAN:
    MOV AX, NUMS[SI]
    CMP AX, 8
    JNE NEXT
    MOV WHERE, SI
NEXT:
    ADD SI, 2
    LOOP SCAN
    LEA DX, M_AT
    MOV AH, 09H
    INT 21H
    MOV AX, WHERE
    CALL PRINT_DECIMAL
    MOV AX, 4C00H
    INT 21H
MAIN ENDP

WHERE DW 0

PRINT_DECIMAL PROC
    PUSH BX
    PUSH CX
    PUSH DX
    XOR CX, CX
    MOV BX, 10
PD_SPLIT:
    XOR DX, DX
    DIV BX
    PUSH DX
    INC CX
    OR AX, AX
    JNZ PD_SPLIT
PD_EMIT:
    POP DX
    ADD DL, '0'
    MOV AH, 02H
    INT 21H
    LOOP PD_EMIT
    POP DX
    POP CX
    POP BX
    RET
PRINT_DECIMAL ENDP
END MAIN
`);
    assert.ok(run.terminated, 'it exits');
    assert.deepEqual(dos.report().unsupported, [],
        'and asks for no service it did not write -- a fabricated INT shows up here');
    assert.equal(dos.stdout, 'at 6', 'the last 8 is at byte offset 6, and the code still ran');
});

test('a size-preserving reshuffle does not end the pass loop early', () => {
    // THE STALE-CALL BUG. Four bytes of new segment override appeared in the
    // same pass as a jump shrinking by four, the segment size did not move,
    // and a fixpoint watching only sizes declared victory one pass early --
    // leaving every CALL after the reshuffle pointing four bytes short of
    // its procedure, inside the previous instruction.
    //
    // The invariant, stated directly: every relative CALL in the image must
    // land exactly on the offset the symbol table gives for its target.
    const r = assemble(`.MODEL SMALL
.STACK 100H
.DATA
    V DW 0
.CODE
MAIN PROC
    MOV AX, @DATA
    MOV DS, AX
    MOV V, AX
    MOV LATE, AX
    CALL HELPER
    JMP FINISH
FINISH:
    MOV AX, 4C00H
    INT 21H
MAIN ENDP
LATE DW 0
HELPER PROC
    PUSH BX
    POP BX
    RET
HELPER ENDP
END MAIN
`);
    const header = (r.bytes[8] | (r.bytes[9] << 8)) * 16;
    const text = r.segments.find((s) => s.name === '_TEXT');
    const base = header + text.para * 16;
    const img = r.bytes.subarray(base, base + text.size);
    const helper = r.symbols.get('helper');
    assert.ok(helper, 'the procedure is in the symbol table');
    let found = null;
    for (let a = 0; a < img.length;) {
        const d = disasmI8086((x) => img[x] ?? 0, a, { ip: a });
        if (d.bytes[0] === 0xe8) found = (a + d.length + ((d.bytes[1] | (d.bytes[2] << 8)) << 16 >> 16)) & 0xffff;
        a += d.length;
    }
    assert.equal(found, helper.value,
        'the CALL lands on the procedure\'s first byte, not near it');
    // And the first byte of HELPER really is its first instruction.
    assert.equal(img[helper.value], 0x53, 'which is PUSH BX');
});

// ---------------------------------------------------------------------------
// The corpus, when it is there. This is the measurement in the report, kept
// as a test so it cannot rot: the same 525 files, the same accept count.
// ---------------------------------------------------------------------------

const CORPUS = '/tmp/amey/Source Code';

/** Every .asm under the corpus, sorted so a failure names the same file twice. */
function corpusFiles(dir = CORPUS, out = []) {
    for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) corpusFiles(p, out);
        else if (name.endsWith('.asm')) out.push(p);
    }
    return out;
}

/** The INT operands a source asks for, comments and quoted text excluded. */
function sourceInterrupts(src) {
    const out = new Set();
    for (const raw of src.split(/\r?\n/)) {
        let quote = null, cut = raw.length;
        for (let i = 0; i < raw.length; i++) {
            const c = raw[i];
            if (quote) { if (c === quote) quote = null; }
            else if (c === "'" || c === '"') quote = c;
            else if (c === ';') { cut = i; break; }
        }
        for (const m of raw.slice(0, cut).matchAll(/\bINT\s+([0-9][0-9A-Fa-f]*)(H)?\b/gi)) {
            out.add(parseInt(m[1], m[2] ? 16 : 10));
        }
    }
    return out;
}

test('the Amey-Thakur corpus assembles, where it is present', { skip: !existsSync(CORPUS) }, () => {
    const files = corpusFiles();
    assert.equal(files.length, 525, 'the corpus is the 525 programs the scope was measured against');

    const reasons = new Map();
    let accepted = 0;
    for (const f of files) {
        try { assemble(readFileSync(f, 'latin1')); accepted++; }
        catch (e) { reasons.set(e.what, (reasons.get(e.what) || 0) + 1); }
    }
    // Measured 2026-09-03. The 17 refusals are all honest: 14 programs
    // contain a relative jump further than an 8086 can reach (MASM refuses
    // them too), 2 write `CMP [SI], '$'` with nothing to say whether that is
    // a byte or a word, and 1 wants .FARDATA.
    assert.ok(accepted >= 508, `at least 508 of 525 assemble (got ${accepted})`);
    assert.deepEqual([...reasons].sort(), [
        ['jump out of range', 14],
        ['operand size unknown', 2],
        ['unsupported directive .FARDATA', 1],
    ].sort(), 'and the refusals are the same three kinds, in the same numbers');
});

test('a sample of the corpus runs to completion and produces output', { skip: !existsSync(CORPUS) }, () => {
    // Assembling is not the claim; running is. A representative slice across
    // directories, each of which must exit through INT 21h/4Ch and have
    // printed something -- which no program does if its data segment, its
    // relative calls or its addressing came out wrong.
    const picks = [
        'Arithmetic/addition_16bit_simple.asm',
        'Introduction/hello_world_string.asm',
        'Procedures/basic_procedure.asm',
        'Macros/macro_building_data_tables.asm',
        'Macros/conditional_assembly_switches.asm',
        'String Instructions/segment_override_on_source.asm',
        'Sorting/bubble_sort_ascending.asm',
        'Conversion/convert_packed_bcd_to_hexadecimal.asm',
    ].filter((p) => existsSync(join(CORPUS, p)));
    assert.ok(picks.length >= 6, 'the sample is present');
    for (const p of picks) {
        const { dos, run } = runIt(readFileSync(join(CORPUS, p), 'latin1'), '5\r7\r');
        assert.ok(run.terminated, `${p} exits through DOS`);
        assert.deepEqual(dos.report().unsupported, [], `${p} needs no service Tier B lacks`);
        assert.match(dos.stdout, /\S/, `${p} printed its answer`);
    }
});

test('every INT the corpus emits is one its source asked for', { skip: !existsSync(CORPUS) }, () => {
    // The static half of the guard the `CD 02` bug earned. Assemble all 525,
    // linear-decode each CODE segment, and require every INT operand to be
    // one the source wrote. This would NOT have caught that bug -- the bytes
    // were right and a store corrupted them at run time -- but it is the
    // check for the whole family the bug was first mistaken for: an operand
    // that assembles to the wrong number.
    //
    // Only the segment holding the entry point is decoded. Linear-decoding
    // a DATA segment is meaningless, and three corpus files hold byte pairs
    // there that read as `int ABh`, `int EFh` and `int3`.
    let decoded = 0, segments = 0;
    const wrong = [];
    for (const f of corpusFiles()) {
        const src = readFileSync(f, 'latin1');
        let r;
        try { r = assemble(src); } catch { continue; }
        const want = sourceInterrupts(src);
        const header = r.format === 'exe' ? (r.bytes[8] | (r.bytes[9] << 8)) * 16 : 0;
        const code = r.format === 'exe'
            ? r.segments.filter((s) => s.para === r.entry.para)
            : [{ name: 'com', para: 0, size: r.bytes.length }];
        for (const sg of code) {
            const at = header + sg.para * 16;
            const img = r.bytes.subarray(at, at + sg.size);
            segments++;
            for (let a = 0; a < img.length;) {
                const d = disasmI8086((x) => img[x] ?? 0, a, { ip: a });
                const m = /^int ([0-9A-F]+)h$/.exec(d.text);
                const n = m ? parseInt(m[1], 16) : (d.text === 'int3' ? 3 : null);
                if (n !== null) {
                    decoded++;
                    if (!want.has(n)) wrong.push(`${f.split('/').pop()} +${a.toString(16)}: int ${n.toString(16)}h`);
                }
                a += d.length;
            }
        }
    }
    assert.ok(decoded > 3000, `the sweep actually decoded the corpus's INTs (got ${decoded})`);
    assert.deepEqual(wrong, [], 'no INT was emitted with an operand the source never wrote');
    assert.ok(segments >= 508, `every accepted program's code segment was swept (got ${segments})`);
});

test('no corpus program asks for an interrupt its source never wrote', { skip: !existsSync(CORPUS) }, () => {
    // THE TEST THAT WOULD HAVE CAUGHT THE `CD 02` BUG, and the only shape
    // that could: run every program and compare the interrupts it actually
    // TOOK against the ones its source asks for. The corrupted byte was
    // written at run time, so the emitted image was innocent and only the
    // running machine knew. Verified against the defect: with the automatic
    // segment override removed this reports exactly one fabricated
    // interrupt, `find_first_and_last_occurrence.asm asked for int 2h`.
    //
    // The termination floor is the second half. A stale CALL address from a
    // pass loop that stopped early does not fabricate an interrupt -- it
    // returns into the program's own entry point and spins -- so it shows
    // up here as one fewer program reaching its exit. Verified the same
    // way: with the symbol values removed from the fixpoint this reads 495.
    let ran = 0, terminated = 0;
    const fabricated = [];
    for (const f of corpusFiles()) {
        const src = readFileSync(f, 'latin1');
        let r;
        try { r = assemble(src); } catch { continue; }
        const want = sourceInterrupts(src);
        const m = new I8086Machine(DOSBOX8086);
        const dos = createDos8086(m).install();
        try { if (r.format === 'exe') dos.loadExe(r.bytes); else dos.loadCom(r.bytes); }
        catch { continue; }
        ran++;
        let steps = 0;
        // A core refusal is not this sweep's business; the DOS report is.
        try { while (!dos.terminated && steps < 50_000) { dos.step(); steps++; } } catch { /* noted below */ }
        if (dos.terminated) terminated++;
        for (const u of dos.report().unsupported) {
            if (!want.has(u.int)) {
                fabricated.push(`${f.split('/').pop()} took int ${u.int.toString(16)}h
                    (AH=${u.ah.toString(16)}h), which its source never writes`);
            }
        }
    }
    assert.equal(ran, 508, 'all 508 accepted programs loaded');
    assert.deepEqual(fabricated, [], 'no program reached an interrupt vector its source never named');
    assert.ok(terminated >= 496, `at least 496 of them run to their own exit (got ${terminated})`);
});

// ---------------------------------------------------------------------------
// Coverage. Last, so it sees everything the file exercised.
// ---------------------------------------------------------------------------

test('the round trip covered the instruction set, not a corner of it', () => {
    // Every entry here is an opcode (or a ModR/M group sub-opcode) that was
    // assembled in this file and read back by a disassembler ground against
    // 646,000 hardware vectors. The floor is asserted so that deleting a
    // case above shows up here rather than quietly narrowing the claim.
    assert.ok(VERIFIED.size >= 275, `at least 275 distinct opcodes round-tripped (got ${VERIFIED.size})`);
    // The families that must all be present, by their opcode ranges.
    const has = (k) => assert.ok(VERIFIED.has(k), `opcode ${k} was verified`);
    for (let alu = 0; alu < 8; alu++) {
        for (const form of [0x00, 0x01, 0x02, 0x03, 0x04, 0x05]) has(((alu << 3) | form).toString(16).padStart(2, '0'));
        has(`80/${alu}`); has(`81/${alu}`); has(`83/${alu}`);
    }
    for (let r = 0; r < 8; r++) {
        has((0x40 + r).toString(16)); has((0x48 + r).toString(16));   // inc/dec r16
        has((0x50 + r).toString(16)); has((0x58 + r).toString(16));   // push/pop r16
        has((0xb0 + r).toString(16)); has((0xb8 + r).toString(16));   // mov r, imm
    }
    for (let cc = 0; cc < 16; cc++) has((0x70 + cc).toString(16));
    for (const g of [0, 1, 2, 3, 4, 5, 7]) { has(`d0/${g}`); has(`d1/${g}`); has(`d2/${g}`); has(`d3/${g}`); }
    for (const g of [0, 2, 3, 4, 5, 6, 7]) { has(`f6/${g}`); has(`f7/${g}`); }
    for (const g of [0, 1, 2, 3, 4, 5, 6]) has(`ff/${g}`);
    for (const op of ['88', '89', '8a', '8b', '8c', '8d', '8e', '8f/0', 'a0', 'a1', 'a2', 'a3',
        'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'aa', 'ab', 'ac', 'ad', 'ae', 'af',
        'c3', 'c2', 'cb', 'ca', 'c4', 'c5', 'c6/0', 'c7/0', 'cc', 'cd', 'ce', 'cf',
        'd4', 'd5', 'd7', 'e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'eb',
        'ec', 'ed', 'ee', 'ef', 'f4', 'f5', 'f8', 'f9', 'fa', 'fb', 'fc', 'fd',
        '27', '2f', '37', '3f', '90', '98', '99', '9b', '9c', '9d', '9e', '9f',
        '06', '07', '0e', '16', '17', '1e', '1f', 'fe/0', 'fe/1']) has(op);
    for (let r = 1; r < 8; r++) has((0x90 + r).toString(16));         // xchg r16, ax
    for (let r = 0; r < 8; r++) has((0x84 + (r & 1)).toString(16));   // test r/m, r
    for (let r = 0; r < 8; r++) has((0x86 + (r & 1)).toString(16));   // xchg r/m, r
});
