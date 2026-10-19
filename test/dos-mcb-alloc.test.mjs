// The DOS memory-block chain (INT 21h 48h/49h/4Ah): freed blocks are reused,
// resizes shrink and free the tail, and a failed request reports the largest
// block available. Test programs are assembled by the built-in assembler and
// run on the 286 through the DOS service layer, checking the service results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/i8086-asm.js';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';

function run(src) {
    const bytes = assemble(src, { format: 'com' }).bytes;
    const m = new I8086Machine({ ...DOSBOX8086, variant: '80286' });
    let out = '';
    const dos = createDos8086(m, { onChar: (c) => { out += c; } }).install();
    dos.loadCom(Uint8Array.from(bytes));
    dos.run(200000);
    return out;
}

test('a freed block is reused by the next allocation (free-list)', () => {
    const out = run(`
        mov bx, 10h
        mov ah, 48h
        int 21h            ; AX = first block
        mov si, ax
        mov es, ax
        mov ah, 49h
        int 21h            ; free it
        mov bx, 10h
        mov ah, 48h
        int 21h            ; AX = second block -> should be the same segment
        mov dl, 'N'
        cmp ax, si
        jne skip
        mov dl, 'Y'
    skip:
        mov ah, 2
        int 21h
        mov ax, 4c00h
        int 21h
    `);
    assert.equal(out, 'Y', 'the second allocation reused the freed block');
});

test('freeing the top block reclaims the arena (no leak across alloc/free cycles)', () => {
    // Allocate + free 300 times; without reclaim the arena (0x1800..0xA000)
    // exhausts long before then. If every alloc still succeeds, memory is reused.
    const out = run(`
        mov cx, 300
    loop_top:
        push cx
        mov bx, 100h
        mov ah, 48h
        int 21h            ; alloc 0x100 paras (4K)
        jc  failed
        mov es, ax
        mov ah, 49h
        int 21h            ; free it
        pop cx
        loop loop_top
        mov dl, 'Y'
        jmp done
    failed:
        pop cx
        mov dl, 'N'
    done:
        mov ah, 2
        int 21h
        mov ax, 4c00h
        int 21h
    `);
    assert.equal(out, 'Y', '300 alloc/free cycles all succeeded — the top block is reclaimed');
});

test('shrinking a block with 4Ah frees the tail for reuse', () => {
    const out = run(`
        mov bx, 200h
        mov ah, 48h
        int 21h            ; alloc 0x200 paras -> AX = seg
        mov es, ax
        mov si, ax
        mov bx, 80h
        mov ah, 4ah
        int 21h            ; shrink to 0x80 -> frees 0x180 at seg+0x80
        mov bx, 100h
        mov ah, 48h
        int 21h            ; alloc 0x100 -> reuses the freed tail (seg+0x80)
        mov dx, si
        add dx, 80h
        mov cl, 'N'
        cmp ax, dx
        jne skip
        mov cl, 'Y'
    skip:
        mov dl, cl
        mov ah, 2
        int 21h
        mov ax, 4c00h
        int 21h
    `);
    assert.equal(out, 'Y', 'the shrink freed the tail and the next alloc reused it');
});
