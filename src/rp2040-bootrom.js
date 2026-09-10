/**
 * A clean-room RP2040 boot ROM, built from the datasheet.
 *
 * WHY THIS FILE EXISTS AT ALL, since "just use the real one" is the
 * obvious answer and it is closed:
 *
 * Raspberry Pi's bootrom is BSD-3 — except `mufplib.S`, which carries
 * "Raspberry Pi (Trading) Ltd hereby grants to you a non-exclusive
 * license to use the software SOLELY ON A RASPBERRY PI RP2040 DEVICE. No
 * other use is permitted", or GPLv2 from the copyright owner. An emulator
 * is not an RP2040 device, and GPL cannot be bundled into a repo whose
 * whole premise is a permissive base. So the compiled 16 KB blob cannot
 * ship here, under either of the licences offered, and asking a user to
 * supply one does not change what the licence says.
 *
 * What CAN be done is what this repo already does for the SSD1306 and the
 * ATmega32U4: implement the documented behaviour. This is RP2040
 * datasheet section 2.8 — the ROM's fixed header, its function-lookup
 * table, and the handful of routines the SDK's startup actually calls —
 * written here as Thumb machine code. None of Raspberry Pi's code is
 * copied; the datasheet describes an interface and this satisfies it.
 *
 * WHAT IT IS NOT. This is not the real bootrom. There is no USB mass
 * storage and no `reset_usb_boot`.
 *
 * THE SOFT-FLOAT TABLE IS NO LONGER THE GAP, and this paragraph said it was
 * for two days after it stopped being true — the failure this file keeps
 * finding in other people's prose, in its own header. mufplib remains the
 * part of Raspberry Pi's ROM that is not free, so none of it is used; the
 * table below is written from the datasheet's interface like everything else
 * here, and nine of its entries are real (see SF_TABLE).
 *
 * HOW FAR THAT GETS, measured against MicroPython 1.22.2 for the Pico
 * (RPI_PICO-20240222-v1.22.2.uf2, reproducible with
 * `node scripts/probe-pico-micropython.mjs --repl` in brickwright-lite):
 * **all the way to the REPL.** The image runs stage 2 out of flash, the
 * SDK's runtime_init completes, MicroPython starts, the USB device
 * enumerates, and a raw-REPL `print(1+1)` comes back as `2`. USB is
 * enumerated by instruction 638,821 and the `>>> ` prompt arrives at
 * 848,420. Booting asks this table for FOURTEEN distinct codes; with the
 * flash block below, thirteen are answered and zero calls land at address
 * 0. The fourteenth is `'SF'`.
 *
 * A SECOND PROBE ARTEFACT, IN THE SAME ROUTINE, 2026-09-10. A probe watching
 * `rom_table_lookup`'s entry address reported each call with a DIFFERENT table
 * pointer, ascending by four — which reads like a caller walking a structure
 * and is nothing of the kind. The old loop branched back to the routine's
 * FIRST instruction, so every iteration re-entered the watched address with r0
 * already advanced, and the probe recorded the scan rather than the call.
 *
 * Measured both ways rather than reasoned about, by restoring the old loop:
 *
 *   entry == loop start   table=68c, 690, 694, 698, 684, 67c, 688, 680 ...
 *   loop one in           table=680 every time, which is the real argument
 *
 * The bound added below moved the loop one instruction past the entry, so the
 * artefact is gone by construction rather than by care. The CODES were always
 * real; the addresses beside them were the instrument. Kept because this file
 * has now produced two probe artefacts in the same routine, and the next
 * person to point something at it should expect a third.
 *
 * THE PANIC THIS HEADER USED TO DESCRIBE WAS A PROBE ARTEFACT, and the
 * detail is kept because it cost a session and would cost another. The
 * earlier probe entered the image at its own vector table (0x10000100)
 * instead of at 0x10000000. That skips BOOT STAGE 2 — and stage 2's exit
 * path is what writes `M0PLUS_VTOR`. With VTOR left at 0, the SDK's
 * `runtime_init` copies `ram_vector_table` out of address 0, i.e. out of
 * THIS ROM image, so every IRQ slot holds bootrom bytes instead of
 * `__unhandled_user_irq`. `irq_set_exclusive_handler` then fails its
 * `hard_assert(current == __unhandled_user_irq || current == handler)`.
 * Resolved against the v1.22.2 image, the chain in the old note reads:
 *
 *     0x1002e198  alarm_pool_post_alloc_init   (pico_time/time.c)
 *     0x1002e838  hardware_alarm_set_callback  (hardware_timer/timer.c)
 *     0x1002dcbc  irq_get_vtable_handler       (hardware_irq/irq.c)
 *     0x1002dccc  irq_set_exclusive_handler    (hardware_irq/irq.c)
 *     0x1002dcf4  the failing hard_assert
 *     0x10030f04  hard_assertion_failure
 *     0x10030ed4  panic
 *
 * The `0xd0000150` (spinlock 20) in the old note was read AFTER the
 * assert, by panic()'s own printf taking the stdio mutex — a striped
 * spinlock. It was never the cause. Neither was the missing soft-float
 * table, and neither was the clock tree. Boot from 0x10000000, or set
 * VTOR yourself, and none of it happens. See
 * docs/PICO-MICROPYTHON-BOOT.md in brickwright-lite for the measurements.
 *
 * WHAT IS STILL MISSING, as of 2026-09-10: USB mass storage,
 * `reset_usb_boot`, and nine of the twenty-one soft-float entries — the four
 * fixed-point conversions and the five transcendentals. Those return a quiet
 * NaN and are named one by one in the test, so the list cannot go stale
 * quietly the way the paragraph above did.
 *
 * Worth knowing, and still true: a MISSED lookup returns 0 and the SDK calls
 * it — there is no null check at most call sites — so address 0 gets executed
 * as Thumb. That is why the flash functions below had to be real rather than
 * absent, and why every soft-float entry points at a routine that RETURNS
 * rather than at nothing.
 *
 * @module
 */

/** The ROM is 16 KB and lives at 0. */
export const BOOTROM_SIZE = 0x4000;

/**
 * Function-table codes, as the datasheet spells them: two ASCII
 * characters packed little-endian, so 'M','C' is `rom_func_lookup('MC')`.
 */
const code = (a, b) => a.charCodeAt(0) | (b.charCodeAt(0) << 8);
/**
 * Data-table codes, as `rom_data_lookup` takes them. Two ASCII characters,
 * low byte first, exactly like ROM_FUNC.
 */
export const ROM_DATA = {
    SOFT_FLOAT: 0x4653,          // 'SF' — the single-precision float table
};

export const ROM_FUNC = {
    MEMCPY: code('M', 'C'),
    MEMCPY44: code('C', '4'),
    MEMSET: code('M', 'S'),
    MEMSET4: code('S', '4'),
    // Bit helpers. ARMv6-M has no CLZ instruction, which is exactly why
    // the ROM carries these — the SDK calls them rather than emitting a
    // loop at every site. MicroPython asks for clz32 fifteen times during
    // startup alone.
    POPCOUNT32: code('P', '3'),
    CLZ32: code('L', '3'),
    CTZ32: code('T', '3'),
    REVERSE32: code('R', '3'),
    // Flash programming, datasheet §2.8.3.1.3. The SDK's hardware_flash
    // has NO fallback for these: `flash_range_program` is a rom_func_lookup
    // and a call, so a table that does not answer sends the firmware to
    // address 0. MicroPython's filesystem lives on flash, so without these
    // `os.listdir()` returns [] and every open-for-write is ENODEV — which
    // is exactly what deployMainPy() needs to work.
    CONNECT_INTERNAL_FLASH: code('I', 'F'),
    FLASH_EXIT_XIP: code('E', 'X'),
    FLASH_RANGE_ERASE: code('R', 'E'),
    FLASH_RANGE_PROGRAM: code('R', 'P'),
    FLASH_FLUSH_CACHE: code('F', 'C'),
    FLASH_ENTER_CMD_XIP: code('C', 'X')
};

/** Assemble 16-bit Thumb halfwords into the image at a byte offset. */
function emit (view, offset, halfwords) {
    halfwords.forEach((hw, i) => view.setUint16(offset + i * 2, hw, true));
    return offset + halfwords.length * 2;
}

/**
 * The same, but resolving branch LABELS instead of counted offsets.
 *
 * WHY IT EXISTS, and the file's own header already answers it: "the first
 * version of memcpy here copied correct bytes and never terminated — a branch
 * offset counted from the wrong place landed inside the loop body and took the
 * count to -1." That was twelve instructions. The float routines below are
 * five to ten times longer with branches that cross each other, and counting
 * those by hand is a bug generator, not a discipline.
 *
 * An item is either a literal halfword, or ['label', name] to mark a spot, or
 * [cond, name] to branch to one. Two passes: place, then encode.
 *
 *   B<cond> T1   1101 cccc iiiiiiii   ±256 bytes
 *   B       T2   11100 iiiiiiiiiii    ±2048 bytes
 *
 * Both count from the address of the instruction PLUS FOUR, because the ARM
 * pipeline reads PC two halfwords ahead. Out of range THROWS rather than
 * truncating: a branch that silently wraps is the failure this replaces.
 */
const COND = {
    beq: 0, bne: 1, bcs: 2, bcc: 3, bmi: 4, bpl: 5, bvs: 6, bvc: 7,
    bhi: 8, bls: 9, bge: 10, blt: 11, bgt: 12, ble: 13,
    bhs: 2, blo: 3,             // the unsigned spellings of bcs and bcc
};

function asm (view, start, items) {
    const labels = new Map();
    let at = start;
    for (const it of items) {
        if (Array.isArray(it) && it[0] === 'label') { labels.set(it[1], at); continue; }
        at += (Array.isArray(it) && it[0] === 'bl') ? 4 : 2;
    }
    const end = at;
    at = start;
    for (const it of items) {
        if (Array.isArray(it) && it[0] === 'label') continue;
        if (Array.isArray(it) && it[0] === 'bl') {
            // BL is the only 32-bit instruction this emitter produces. The
            // target is an ABSOLUTE address already known — every callee is
            // emitted before its caller — so there is no label to resolve.
            // J1 and J2 are both 1 for the short offsets used here, positive or
            // negative: for a small delta the sign-extension bits I1 and I2 are
            // equal to S, and J = NOT(I) XOR S is 1 either way.
            const delta = it[1] - (at + 4);
            if (delta % 2) throw new Error('asm: misaligned bl');
            if (delta < -0x400000 || delta > 0x3ffffe) throw new Error('asm: bl out of range');
            view.setUint16(at, 0xf000 | ((delta < 0 ? 1 : 0) << 10) | ((delta >> 12) & 0x3ff), true);
            view.setUint16(at + 2, 0xf800 | ((delta >> 1) & 0x7ff), true);
            at += 4;
            continue;
        }
        if (Array.isArray(it)) {
            const [kind, name] = it;
            if (!labels.has(name)) throw new Error(`asm: branch to unknown label '${name}'`);
            const delta = labels.get(name) - (at + 4);
            if (delta & 1) throw new Error(`asm: misaligned branch to '${name}'`);
            const imm = delta >> 1;
            if (kind === 'b') {
                if (imm < -1024 || imm > 1023) throw new Error(`asm: b '${name}' out of range (${delta} bytes)`);
                view.setUint16(at, 0xe000 | (imm & 0x7ff), true);
            } else {
                const c = COND[kind];
                if (c === undefined) throw new Error(`asm: unknown branch '${kind}'`);
                if (imm < -128 || imm > 127) throw new Error(`asm: ${kind} '${name}' out of range (${delta} bytes)`);
                view.setUint16(at, 0xd000 | (c << 8) | (imm & 0xff), true);
            }
        } else {
            view.setUint16(at, it, true);
        }
        at += 2;
    }
    return end;
}

/**
 * Build the ROM image.
 *
 * Layout follows the datasheet's fixed offsets exactly, because the SDK
 * reads them by address and nothing else identifies them:
 *
 *   0x00  initial SP        0x10  'M','u', version, reserved
 *   0x04  reset vector      0x14  u16 → function table
 *   0x08  NMI               0x16  u16 → data table
 *   0x0c  HardFault         0x18  u16 → table lookup routine
 *
 * @returns {Uint8Array} 16 KB, ready to be written at address 0
 */
export function buildBootrom () {
    const rom = new Uint8Array(BOOTROM_SIZE);
    const view = new DataView(rom.buffer);

    // Routines are laid out from 0x100; the header points at them.
    let pc = 0x100;

    // ── rom_table_lookup(r0 = table, r1 = code) → r0 = entry, or 0 ──────
    //
    // The table is (u16 code, u16 value) pairs ending in a zero code. The
    // SDK calls this through the pointer at 0x18, so the ADDRESS matters
    // and the implementation does not.
    // THE SCAN IS BOUNDED, and it was not. The loop walked four bytes at a
    // time until it read a zero halfword, with nothing to stop it: given a
    // garbage table pointer it runs until some address happens to hold a zero,
    // or forever, wrapping r0 around 32 bits on the way. A function whose
    // contract is "returns 0 when the code is not present" cannot honour that
    // for a bad table, and it turns a caller's bad pointer into a HANG, which
    // is the least diagnosable failure there is.
    //
    // Measured downstream (lego-ac, 2026-09-10): Kaluma's first GPIO call busy
    // loops in this very routine at 0x100, entered from 0x1000463f with a
    // garbage table and code. 255 pairs is 1020 bytes, far past any real
    // table — the SDK's largest has about fifteen entries — so the bound
    // cannot be reached by a legitimate call and a bad one now gets the
    // documented miss instead of an infinite loop.
    //
    // THIS DOES NOT EXPLAIN WHY THE POINTER IS GARBAGE. It converts an
    // undiagnosable hang into a defined 0, which is where the SF table went
    // too; the caller's bad argument is still open.
    //
    // Written with asm() rather than counted offsets, because this file's own
    // header records what a branch offset counted from the wrong place did to
    // memcpy, and this routine had three of them.
    const lookup = pc;
    pc = asm(view, pc, [
        0x23ff,                     // movs r3, #255          ; pairs left to scan
        ['label', 'lk_loop'],
        0x8802,                     // ldrh r2, [r0, #0]      ; entry code
        0x2a00,                     // cmp  r2, #0
        ['beq', 'lk_notfound'],     //                        ; terminator
        0x428a,                     // cmp  r2, r1
        ['beq', 'lk_found'],
        0x3004,                     // adds r0, #4            ; next pair
        0x3b01,                     // subs r3, #1
        ['bne', 'lk_loop'],
        ['label', 'lk_notfound'],
        0x2000,                     // movs r0, #0
        0x4770,                     // bx   lr
        ['label', 'lk_found'],
        0x8840,                     // ldrh r0, [r0, #2]
        0x4770                      // bx   lr
    ]);

    // ── memcpy(r0 = dst, r1 = src, r2 = n) → r0 = dst ───────────────────
    //
    // Byte at a time. The real ROM is word-optimised; a copy that is
    // correct and slow is the right trade in an emulator, where the cost
    // is JS instructions and not silicon cycles.
    const memcpy = pc;
    pc = emit(view, pc, [
        0xb510,             // push {r4, lr}
        0x0004,             // movs r4, r0           ; keep dst to return
        0x2a00,             // .loop: cmp r2, #0
        // +5, not +3. The branch is counted from PC+4 (two halfwords
        // ahead), so a miscount lands INSIDE the loop body — here it
        // reached `subs r2, #1`, took the count to -1 and copied for
        // ever. The bytes already copied stay correct, which is why a
        // test that only checks the destination passes: the tell is that
        // the routine never returns.
        0xd005,             // beq  .done
        0x780b,             // ldrb r3, [r1, #0]
        0x7003,             // strb r3, [r0, #0]
        0x3001,             // adds r0, #1
        0x3101,             // adds r1, #1
        0x3a01,             // subs r2, #1
        0xe7f7,             // b    .loop
        0x0020,             // .done: movs r0, r4
        0xbd10              // pop  {r4, pc}
    ]);

    // ── memset(r0 = dst, r1 = value, r2 = n) → r0 = dst ─────────────────
    const memset = pc;
    pc = emit(view, pc, [
        0xb510,             // push {r4, lr}
        0x0004,             // movs r4, r0
        0x2a00,             // .loop: cmp r2, #0
        0xd003,             // beq  .done            ; +3, counted from PC+4
        0x7001,             // strb r1, [r0, #0]
        0x3001,             // adds r0, #1
        0x3a01,             // subs r2, #1
        0xe7f9,             // b    .loop
        0x0020,             // .done: movs r0, r4
        0xbd10              // pop  {r4, pc}
    ]);

    // ── clz32(r0) → r0 = leading zeros ──────────────────────────────────
    const clz32 = pc;
    pc = emit(view, pc, [
        0x2200,             // movs r2, #0
        0x2800,             // cmp  r0, #0
        0xd004,             // beq  .zero
        0x0003,             // .loop: movs r3, r0     ; sets N from bit 31
        0xd403,             // bmi  .done
        0x0040,             // lsls r0, r0, #1
        0x3201,             // adds r2, #1
        0xe7fa,             // b    .loop
        0x2220,             // .zero: movs r2, #32
        0x0010,             // .done: movs r0, r2
        0x4770              // bx   lr
    ]);

    // ── ctz32(r0) → r0 = trailing zeros ─────────────────────────────────
    const ctz32 = pc;
    pc = emit(view, pc, [
        0x2200,             // movs r2, #0
        0x2800,             // cmp  r0, #0
        0xd004,             // beq  .zero
        0x07c3,             // .loop: lsls r3, r0, #31 ; bit 0 into N
        0xd403,             // bmi  .done
        0x0840,             // lsrs r0, r0, #1
        0x3201,             // adds r2, #1
        0xe7fa,             // b    .loop
        0x2220,             // .zero: movs r2, #32
        0x0010,             // .done: movs r0, r2
        0x4770              // bx   lr
    ]);

    // ── popcount32(r0) → r0 = set bits ──────────────────────────────────
    const popcount32 = pc;
    pc = emit(view, pc, [
        0x2200,             // movs r2, #0
        0x2800,             // .loop: cmp r0, #0
        0xd004,             // beq  .done
        0x07c3,             // lsls r3, r0, #31       ; bit 0 into N
        0xd500,             // bpl  .skip
        0x3201,             // adds r2, #1
        0x0840,             // .skip: lsrs r0, r0, #1
        0xe7f8,             // b    .loop
        0x0010,             // .done: movs r0, r2
        0x4770              // bx   lr
    ]);

    // ── reverse32(r0) → r0 = bits reversed ──────────────────────────────
    const reverse32 = pc;
    pc = emit(view, pc, [
        0x2200,             // movs r2, #0            ; result
        0x2320,             // movs r3, #32           ; counter
        0x0052,             // .loop: lsls r2, r2, #1
        0x07c1,             // lsls r1, r0, #31       ; isolate bit 0…
        0x0fc9,             // lsrs r1, r1, #31       ; …as a value, not a flag
        0x430a,             // orrs r2, r1
        0x0840,             // lsrs r0, r0, #1
        0x3b01,             // subs r3, #1
        0xd1f8,             // bne  .loop
        0x0010,             // movs r0, r2
        0x4770              // bx   lr
    ]);

    // ── flash programming ───────────────────────────────────────────────
    //
    // On silicon these drive the QSPI pads: leave XIP, talk to the flash
    // chip, come back. Here there is no chip — rp2040js's flash is a plain
    // byte array behind the XIP window and stores to it land — so the
    // sequencing routines are `bx lr` and the two that move data are a
    // memset and a memcpy against 0x10000000 + offset. That is the
    // documented CONTRACT (datasheet §2.8.3.1.3: `addr` is an offset from
    // the start of flash, not an XIP address), which is all an emulator
    // owes a caller.
    //
    // NAND semantics are deliberately not emulated: a real program can only
    // clear bits, so writing without erasing first corrupts. Storing the
    // byte outright is a superset of that, and a filesystem that erases
    // correctly cannot tell the difference.
    const flashNop = pc;
    pc = emit(view, pc, [0x4770]);          // bx lr

    // ── flash_range_erase(r0 = offset, r1 = count, r2, r3) ──────────────
    const flashRangeErase = pc;
    pc = emit(view, pc, [
        0xb510,             // push {r4, lr}
        0x2410,             // movs r4, #16
        0x0624,             // lsls r4, r4, #24      ; r4 = 0x10000000
        0x1900,             // adds r0, r0, r4       ; offset -> XIP address
        0x24ff,             // movs r4, #255         ; erased flash reads 0xff
        0x2900,             // .loop: cmp r1, #0
        0xd003,             // beq  .done            ; +3, counted from PC+4
        0x7004,             // strb r4, [r0, #0]
        0x3001,             // adds r0, #1
        0x3901,             // subs r1, #1
        0xe7f9,             // b    .loop
        0xbd10              // .done: pop {r4, pc}
    ]);

    // ── flash_range_program(r0 = offset, r1 = src, r2 = count) ──────────
    const flashRangeProgram = pc;
    pc = emit(view, pc, [
        0xb510,             // push {r4, lr}
        0x2410,             // movs r4, #16
        0x0624,             // lsls r4, r4, #24
        0x1900,             // adds r0, r0, r4
        0x2a00,             // .loop: cmp r2, #0
        0xd005,             // beq  .done
        0x780c,             // ldrb r4, [r1, #0]
        0x7004,             // strb r4, [r0, #0]
        0x3001,             // adds r0, #1
        0x3101,             // adds r1, #1
        0x3a01,             // subs r2, #1
        0xe7f7,             // b    .loop
        0xbd10              // .done: pop {r4, pc}
    ]);

    // ── fadd(r0 = a, r1 = b) → r0 = a + b, and fsub via a sign flip ────
    //
    // SF table indices 0 and 1. IEEE-754 single precision, round to nearest
    // with ties to even. Infinities, NaNs and signed zeros are handled;
    // SUBNORMALS ARE FLUSHED TO ZERO, which is a DECLARED DEVIATION and is
    // asserted as such in the tests rather than left to be discovered.
    //
    // THE LARGER MAGNITUDE IS SWAPPED INTO a FIRST. That single step pays for
    // itself twice: the result's sign is then always a's, and the subtraction
    // can never go negative, so there is no second normalisation path to get
    // wrong.
    //
    // Three guard bits are carried below the significand. Everything shifted
    // out during alignment is folded into the lowest as a sticky bit, which is
    // what makes the tie case exact: a tie is guard set with nothing under it,
    // and it rounds up only when the significand's low bit is already 1.
    const fadd = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x0042, // lsls r2, r0, #1         ; |a|, sign shifted out
        0x004b, // lsls r3, r1, #1         ; |b|
        0x429a, // cmp  r2, r3
        ['bhs', 'fa_noswap'],
        0x0002, // movs r2, r0
        0x0008, // movs r0, r1
        0x0011, // movs r1, r2            ; swap: |a| >= |b| from here on
        ['label', 'fa_noswap'],
        0x0dc2, // lsrs r2, r0, #23
        0x0016, // movs r6, r2
        0x0a36, // lsrs r6, r6, #8        ; r6 = result sign (a is the larger)
        0x27ff, // movs r7, #255
        0x403a, // ands r2, r7            ; r2 = exponent of a
        0x0243, // lsls r3, r0, #9
        0x0a5b, // lsrs r3, r3, #9        ; r3 = mantissa of a
        0x0dcc, // lsrs r4, r1, #23
        0x0027, // movs r7, r4
        0x0a3f, // lsrs r7, r7, #8        ; sign of b
        0x0624, // lsls r4, r4, #24
        0x0e24, // lsrs r4, r4, #24       ; r4 = exponent of b
        0x024d, // lsls r5, r1, #9
        0x0a6d, // lsrs r5, r5, #9        ; r5 = mantissa of b
        0x4077, // eors r7, r6            ; r7 = 1 when the signs differ
        0x2aff, // cmp  r2, #255          ; a is the larger, so it is Inf/NaN first
        ['bne', 'fa_finite'],
        0x2b00, // cmp  r3, #0
        ['bne', 'fa_nan'],                      // a is NaN
        0x2cff, // cmp  r4, #255
        ['bne', 'fa_ret_a'],                    // Inf + finite = Inf
        0x2d00, // cmp  r5, #0
        ['bne', 'fa_nan'],                      // Inf + NaN
        0x2f00, // cmp  r7, #0
        ['bne', 'fa_nan'],                      // Inf + -Inf is undefined
        ['label', 'fa_ret_a'],
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fa_nan'],
        0x20ff, // movs r0, #255
        0x05c0, // lsls r0, r0, #23
        0x2101, // movs r1, #1
        0x0589, // lsls r1, r1, #22
        0x4308, // orrs r0, r1            ; 7FC00000h, a quiet NaN
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fa_finite'],
        0x2c00, // cmp  r4, #0
        ['bne', 'fa_b_norm'],
        0x2500, // movs r5, #0            ; b subnormal or zero -> zero
        ['label', 'fa_b_norm'],
        0x2a00, // cmp  r2, #0
        ['bne', 'fa_a_norm'],
        // Both operands are zero (|a| >= |b| and a's exponent is 0). Build the
        // answer rather than returning `a`: a FLUSHED SUBNORMAL still has its
        // original bit pattern in r0, and handing that back would contradict
        // the flush-to-zero this routine declares.
        0x2f00, // cmp  r7, #0
        ['bne', 'fa_zero_plus'],                // opposite signs: (+0)+(-0) = +0
        0x2000, // movs r0, #0
        0x07f6, // lsls r6, r6, #31
        0x4330, // orrs r0, r6            ; same-signed zeros keep that sign
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fa_zero_plus'],
        0x2000, // movs r0, #0
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fa_a_norm'],
        0x2c00, // cmp  r4, #0
        ['beq', 'fa_ret_a'],                    // a + 0 = a
        0x2101, // movs r1, #1
        0x05c9, // lsls r1, r1, #23
        0x430b, // orrs r3, r1            ; restore the implicit 1
        0x430d, // orrs r5, r1
        0x00db, // lsls r3, r3, #3
        0x00ed, // lsls r5, r5, #3
        0x1b14, // subs r4, r2, r4        ; r4 = exponent difference >= 0
        0x2c00, // cmp  r4, #0
        ['beq', 'fa_aligned'],
        0x2c1b, // cmp  r4, #27
        ['blt', 'fa_shift'],
        0x2d00, // cmp  r5, #0
        ['beq', 'fa_aligned'],
        0x2501, // movs r5, #1            ; ...but it is not nothing
        ['b', 'fa_aligned'],
        ['label', 'fa_shift'],
        0x0029, // movs r1, r5
        0x2020, // movs r0, #32
        0x1b00, // subs r0, r0, r4
        0x4081, // lsls r1, r0            ; the bits about to be lost
        0x40e5, // lsrs r5, r4
        0x2900, // cmp  r1, #0
        ['beq', 'fa_aligned'],
        0x2001, // movs r0, #1
        0x4305, // orrs r5, r0            ; fold them into a sticky bit
        ['label', 'fa_aligned'],
        0x2f00, // cmp  r7, #0
        ['bne', 'fa_sub'],
        0x195b, // adds r3, r3, r5
        0x0ed9, // lsrs r1, r3, #27       ; did it carry past bit 26?
        0x2900, // cmp  r1, #0
        ['beq', 'fa_round'],
        0x0019, // movs r1, r3
        0x2001, // movs r0, #1
        0x4001, // ands r1, r0            ; keep the bit we are about to drop
        0x085b, // lsrs r3, r3, #1
        0x430b, // orrs r3, r1            ; as sticky
        0x3201, // adds r2, #1
        ['b', 'fa_round'],
        ['label', 'fa_sub'],
        0x1b5b, // subs r3, r3, r5        ; |a| >= |b|, so this cannot go negative
        0x2b00, // cmp  r3, #0
        ['bne', 'fa_norm'],
        0x2000, // movs r0, #0            ; exact cancellation is +0
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fa_norm'],
        0x0e99, // lsrs r1, r3, #26
        0x2900, // cmp  r1, #0
        ['bne', 'fa_round'],
        0x2a01, // cmp  r2, #1
        ['bls', 'fa_zero'],                     // would go subnormal: flushed
        0x005b, // lsls r3, r3, #1
        0x3a01, // subs r2, #1
        ['b', 'fa_norm'],
        ['label', 'fa_zero'],
        0x2000, // movs r0, #0
        0x07f6, // lsls r6, r6, #31
        0x4330, // orrs r0, r6            ; a signed zero
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fa_round'],
        0x0019, // movs r1, r3
        0x2004, // movs r0, #4
        0x4001, // ands r1, r0            ; the guard bit
        0x2900, // cmp  r1, #0
        ['beq', 'fa_pack'],
        0x0019, // movs r1, r3
        0x2003, // movs r0, #3
        0x4001, // ands r1, r0            ; anything below the guard
        0x2900, // cmp  r1, #0
        ['bne', 'fa_up'],
        0x0019, // movs r1, r3
        0x2008, // movs r0, #8
        0x4001, // ands r1, r0            ; an exact tie: round to even
        0x2900, // cmp  r1, #0
        ['beq', 'fa_pack'],
        ['label', 'fa_up'],
        0x2008, // movs r0, #8
        0x181b, // adds r3, r3, r0
        0x0ed9, // lsrs r1, r3, #27       ; rounding can carry out of the top
        0x2900, // cmp  r1, #0
        ['beq', 'fa_pack'],
        0x085b, // lsrs r3, r3, #1
        0x3201, // adds r2, #1
        ['label', 'fa_pack'],
        0x2aff, // cmp  r2, #255
        ['blt', 'fa_ok'],
        0x20ff, // movs r0, #255          ; overflowed to infinity
        0x05c0, // lsls r0, r0, #23
        0x07f6, // lsls r6, r6, #31
        0x4330, // orrs r0, r6
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fa_ok'],
        0x08db, // lsrs r3, r3, #3        ; drop the guard bits
        0x025b, // lsls r3, r3, #9
        0x0a5b, // lsrs r3, r3, #9        ; drop the implicit 1
        0x05d2, // lsls r2, r2, #23
        0x0018, // movs r0, r3
        0x4310, // orrs r0, r2
        0x07f6, // lsls r6, r6, #31
        0x4330, // orrs r0, r6
        0xbdf0, // pop  {r4-r7, pc}
    ]);

    // fsub(a, b) = fadd(a, -b). Flipping b's sign bit is the whole of it, and
    // it is correct for every case fadd handles: -(-0) is +0, -(Inf) is -Inf,
    // and a NaN with its sign flipped is still a NaN.
    const fsub = pc;
    pc = asm(view, pc, [
        0xb500,                     // push {lr}
        0x2201,                     // movs r2, #1
        0x07d2,                     // lsls r2, r2, #31
        0x4051,                     // eors r1, r2            ; b = -b
        0xf000, 0xf800,             // bl fadd  (offset patched below)
        0xbd00                      // pop  {pc}
    ]);
    {
        // The BL is the only 32-bit instruction in this ROM, so it is patched
        // rather than encoded by asm(): S:J1:J2 sign extension for a ±16 MB
        // range, of which we use a few hundred bytes.
        const site = pc - 6;                    // address of the first halfword
        const delta = fadd - (site + 4);
        const imm11 = (delta >> 1) & 0x7ff;
        const imm10 = (delta >> 12) & 0x3ff;
        const sBit = delta < 0 ? 1 : 0;
        view.setUint16(site, 0xf000 | (sBit << 10) | imm10, true);
        view.setUint16(site + 2, 0xf800 | (1 << 14) | (1 << 13) | imm11, true);
    }

    // ── int2float(r0 = int32) → r0 = float32 bits ──────────────────────
    //
    // SF table index 11. Round-to-nearest-even, which is the only rounding
    // mode single-precision C arithmetic uses and the one JavaScript's
    // Math.fround implements, so the two are comparable on every input.
    //
    // Every int32 is exactly representable up to 2^24; above that the low
    // bits have to go somewhere and the tie case is the whole difficulty.
    // 16,777,217 rounds DOWN to 16,777,216 because that mantissa is even,
    // and 16,777,219 rounds UP to 16,777,220 for the same reason.
    //
    // INT_MIN is not special-cased and does not need to be: negating
    // 80000000h gives 80000000h back, and read as a MAGNITUDE that is
    // exactly 2^31, which is what the sign bit then makes negative.
    const int2float = pc;
    pc = asm(view, pc, [
        0xb510,                     // push {r4, lr}
        0x2800,                     // cmp  r0, #0
        ['bne', 'i2f_nz'],
        0xbd10,                     // pop  {r4, pc}          ; +0.0
        ['label', 'i2f_nz'],
        0x2100,                     // movs r1, #0            ; sign
        0x2800,                     // cmp  r0, #0
        ['bge', 'i2f_pos'],
        0x2101,                     // movs r1, #1
        0x4240,                     // rsbs r0, r0, #0        ; magnitude
        ['label', 'i2f_pos'],
        0x2200,                     // movs r2, #0            ; shift count
        ['label', 'i2f_norm'],
        0x0003,                     // movs r3, r0            ; N = bit 31
        ['bmi', 'i2f_normed'],
        0x0040,                     // lsls r0, r0, #1
        0x3201,                     // adds r2, #1
        ['b', 'i2f_norm'],
        ['label', 'i2f_normed'],
        // exp = 127 + (31 - count) = 158 - count
        0x239e,                     // movs r3, #158
        0x1a9b,                     // subs r3, r3, r2        ; r3 = exponent
        0x0002,                     // movs r2, r0
        0x0612,                     // lsls r2, r2, #24       ; r2 = the 8 dropped bits, left-aligned
        0x0a00,                     // lsrs r0, r0, #8        ; r0 = 1.xxx in 24 bits
        0x2a00,                     // cmp  r2, #0
        ['beq', 'i2f_pack'],        // nothing below → exact
        0x0014,                     // movs r4, r2            ; N = guard bit
        ['bpl', 'i2f_pack'],        // guard clear → round down
        0x0054,                     // lsls r4, r2, #1        ; sticky = anything under the guard
        ['bne', 'i2f_up'],
        0x0004,                     // movs r4, r0            ; exact tie: round to EVEN
        0x07e4,                     // lsls r4, r4, #31       ; Z = (lsb == 0)
        ['beq', 'i2f_pack'],        // already even → stay
        ['label', 'i2f_up'],
        0x3001,                     // adds r0, #1
        0x0e04,                     // lsrs r4, r0, #24       ; did it carry out of the 24 bits?
        ['beq', 'i2f_pack'],
        0x0840,                     // lsrs r0, r0, #1
        0x3301,                     // adds r3, #1            ; ...and the exponent absorbs it
        ['label', 'i2f_pack'],
        0x0240,                     // lsls r0, r0, #9
        0x0a40,                     // lsrs r0, r0, #9        ; drop the implicit 1
        0x05db,                     // lsls r3, r3, #23
        0x4318,                     // orrs r0, r3
        0x07c9,                     // lsls r1, r1, #31
        0x4308,                     // orrs r0, r1
        0xbd10                      // pop  {r4, pc}
    ]);

    // ── fmul(r0 = a, r1 = b) → r0 = a * b ──────────────────────────────
    //
    // SF table index 2. The difficulty is not the floating point, it is that
    // this core's multiply is 32x32 KEEPING ONLY THE LOW 32 BITS, and two
    // 24-bit significands make a 48-bit product. So it is done in 12-bit
    // halves — four partial products reassembled with an explicit carry,
    // because there is no wire between the two halves either:
    //
    //   a*b = (ah*bh)<<24 + (ah*bl + al*bh)<<12 + al*bl
    //
    // The middle term reaches 2^25, so shifting it left by 12 overflows 32
    // bits: its low half goes into the bottom word and its top five bits into
    // the high one, with ADCS carrying between them. The zero that ADCS adds
    // is loaded BEFORE the ADDS that sets the carry, because MOVS would clear
    // it again.
    //
    // A product of two values in [1,2) lands in [1,4), so the leading bit is
    // at 47 or at 46 and there are exactly two normalisation cases.
    const fmul = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x0002, // movs r2, r0
        0x404a, // eors r2, r1
        0x0fd7, // lsrs r7, r2, #31       ; r7 = sign = sa XOR sb
        0x0042, // lsls r2, r0, #1
        0x0e12, // lsrs r2, r2, #24       ; r2 = exponent of a
        0x0243, // lsls r3, r0, #9
        0x0a5b, // lsrs r3, r3, #9        ; r3 = mantissa of a
        0x004c, // lsls r4, r1, #1
        0x0e24, // lsrs r4, r4, #24       ; r4 = exponent of b
        0x024d, // lsls r5, r1, #9
        0x0a6d, // lsrs r5, r5, #9        ; r5 = mantissa of b
        0x2aff, // cmp  r2, #255
        ['bne', 'fm_b_chk'],
        0x2b00, // cmp  r3, #0
        ['bne', 'fm_nan'],                      // a is NaN
        0x2cff, // cmp  r4, #255
        ['bne', 'fm_a_inf_bfin'],
        0x2d00, // cmp  r5, #0
        ['bne', 'fm_nan'],                      // Inf * NaN
        ['b', 'fm_inf'],                        // Inf * Inf
        ['label', 'fm_a_inf_bfin'],
        0x2c00, // cmp  r4, #0
        ['bne', 'fm_inf'],                      // Inf * finite
        ['b', 'fm_nan'],                        // Inf * 0
        ['label', 'fm_b_chk'],
        0x2cff, // cmp  r4, #255
        ['bne', 'fm_finite'],
        0x2d00, // cmp  r5, #0
        ['bne', 'fm_nan'],                      // b is NaN
        0x2a00, // cmp  r2, #0
        ['bne', 'fm_inf'],
        0x2b00, // cmp  r3, #0
        ['beq', 'fm_nan'],                      // 0 * Inf
        ['label', 'fm_inf'],
        0x20ff, // movs r0, #255
        0x05c0, // lsls r0, r0, #23
        ['b', 'fm_signit'],
        ['label', 'fm_nan'],
        0x20ff, // movs r0, #255
        0x05c0, // lsls r0, r0, #23
        0x2101, // movs r1, #1
        0x0589, // lsls r1, r1, #22
        0x4308, // orrs r0, r1            ; 7FC00000h
        0xbdf0, // pop  {r4-r7, pc}       ; a NaN keeps no sign here
        ['label', 'fm_zero'],
        0x2000, // movs r0, #0
        ['label', 'fm_signit'],
        0x07ff, // lsls r7, r7, #31
        0x4338, // orrs r0, r7
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fm_finite'],
        0x2a00, // cmp  r2, #0
        ['beq', 'fm_zero'],                     // a is zero or subnormal
        0x2c00, // cmp  r4, #0
        ['beq', 'fm_zero'],                     // b is zero or subnormal
        0x1916, // adds r6, r2, r4
        0x3e7f, // subs r6, #127          ; r6 = ea + eb - 127
        0x2001, // movs r0, #1
        0x05c0, // lsls r0, r0, #23
        0x4303, // orrs r3, r0            ; a = 1.ma, 24 bits
        0x4305, // orrs r5, r0            ; b = 1.mb
        0x20ff, // movs r0, #255
        0x0100, // lsls r0, r0, #4
        0x300f, // adds r0, #15           ; r0 = 0FFFh
        0x001a, // movs r2, r3
        0x4002, // ands r2, r0            ; r2 = al
        0x0b1b, // lsrs r3, r3, #12       ; r3 = ah
        0x002c, // movs r4, r5
        0x4004, // ands r4, r0            ; r4 = bl
        0x0b2d, // lsrs r5, r5, #12       ; r5 = bh
        0x0010, // movs r0, r2
        0x4360, // muls r0, r4            ; r0 = al*bl
        0x0019, // movs r1, r3
        0x4369, // muls r1, r5            ; r1 = ah*bh
        0x436a, // muls r2, r5            ; r2 = al*bh
        0x4363, // muls r3, r4            ; r3 = ah*bl
        0x18d2, // adds r2, r2, r3        ; r2 = the middle term, < 2^25
        0x2500, // movs r5, #0            ; zeroed before any ADDS, which sets C
        0x0013, // movs r3, r2
        0x031b, // lsls r3, r3, #12       ; M << 12, low half
        0x0014, // movs r4, r2
        0x0d24, // lsrs r4, r4, #20       ; M >> 20, the part above bit 31
        0x18c0, // adds r0, r0, r3        ; lo += M<<12
        0x416c, // adcs r4, r5            ; ...carrying into M>>20
        0x000b, // movs r3, r1
        0x061b, // lsls r3, r3, #24       ; A << 24, low half
        0x0a09, // lsrs r1, r1, #8        ; A >> 8, the part above bit 31
        0x18c0, // adds r0, r0, r3        ; lo += A<<24
        0x4169, // adcs r1, r5            ; ...carrying into A>>8
        0x1909, // adds r1, r1, r4        ; r1 = the high 16 bits of the product
        0x0bca, // lsrs r2, r1, #15       ; bit 47 of the product
        0x2a00, // cmp  r2, #0
        ['beq', 'fm_lead46'],
        0x000a, // movs r2, r1
        0x0212, // lsls r2, r2, #8
        0x0003, // movs r3, r0
        0x0e1b, // lsrs r3, r3, #24
        0x431a, // orrs r2, r3            ; r2 = 24-bit significand
        0x0003, // movs r3, r0
        0x021b, // lsls r3, r3, #8        ; guard in bit 31, sticky below
        0x3601, // adds r6, #1            ; ...and the exponent grows by one
        ['b', 'fm_round'],
        ['label', 'fm_lead46'],
        0x000a, // movs r2, r1
        0x0252, // lsls r2, r2, #9
        0x0003, // movs r3, r0
        0x0ddb, // lsrs r3, r3, #23
        0x431a, // orrs r2, r3            ; r2 = 24-bit significand
        0x0003, // movs r3, r0
        0x025b, // lsls r3, r3, #9        ; guard in bit 31, sticky below
        ['label', 'fm_round'],
        0x2b00, // cmp  r3, #0
        ['beq', 'fm_pack'],                     // nothing below the significand
        0x001c, // movs r4, r3            ; N = the guard bit
        ['bpl', 'fm_pack'],                     // guard clear: round down
        0x005c, // lsls r4, r3, #1        ; anything under the guard is sticky
        ['bne', 'fm_up'],
        0x0014, // movs r4, r2
        0x07e4, // lsls r4, r4, #31       ; an exact tie: round to even
        ['beq', 'fm_pack'],
        ['label', 'fm_up'],
        0x3201, // adds r2, #1
        0x0e14, // lsrs r4, r2, #24       ; did it carry out of 24 bits?
        0x2c00, // cmp  r4, #0
        ['beq', 'fm_pack'],
        0x0852, // lsrs r2, r2, #1
        0x3601, // adds r6, #1
        ['label', 'fm_pack'],
        0x2eff, // cmp  r6, #255
        ['blt', 'fm_inrange'],
        ['b', 'fm_inf'],                        // overflowed to infinity
        ['label', 'fm_inrange'],
        0x2e00, // cmp  r6, #0
        ['ble', 'fm_zero'],                     // underflowed: flushed to zero
        0x0252, // lsls r2, r2, #9
        0x0a52, // lsrs r2, r2, #9        ; drop the implicit 1
        0x05f6, // lsls r6, r6, #23
        0x0010, // movs r0, r2
        0x4330, // orrs r0, r6
        ['b', 'fm_signit'],
    ]);

    // ── fdiv(r0 = a, r1 = b) → r0 = a / b ──────────────────────────────
    //
    // SF table index 3. This core has no divide instruction, so the quotient
    // is produced one bit at a time: shift, compare, subtract if it fits —
    // long division, and the loop below is that and nothing else.
    //
    // The numerator is doubled once first if it is smaller than the
    // denominator, so the quotient always lands in [1, 2) and there is one
    // normalisation case instead of two. Twenty-five bits are produced: 24
    // for the significand and one guard bit. THE FINAL REMAINDER IS THE
    // STICKY BIT — non-zero means the division did not terminate, which is
    // exactly what breaks a tie.
    const fdiv = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x0002, // movs r2, r0
        0x404a, // eors r2, r1
        0x0fd7, // lsrs r7, r2, #31       ; sign = sa XOR sb
        0x0042, // lsls r2, r0, #1
        0x0e12, // lsrs r2, r2, #24       ; r2 = ea
        0x0243, // lsls r3, r0, #9
        0x0a5b, // lsrs r3, r3, #9        ; r3 = ma
        0x004c, // lsls r4, r1, #1
        0x0e24, // lsrs r4, r4, #24       ; r4 = eb
        0x024d, // lsls r5, r1, #9
        0x0a6d, // lsrs r5, r5, #9        ; r5 = mb
        0x2aff, // cmp  r2, #255
        ['bne', 'fd_b_chk'],
        0x2b00, // cmp  r3, #0
        ['bne', 'fd_nan'],                      // a is NaN
        0x2cff, // cmp  r4, #255
        ['beq', 'fd_nan'],                      // Inf / Inf, or Inf / NaN
        ['b', 'fd_inf'],                        // Inf / finite
        ['label', 'fd_b_chk'],
        0x2cff, // cmp  r4, #255
        ['bne', 'fd_finite'],
        0x2d00, // cmp  r5, #0
        ['bne', 'fd_nan'],                      // b is NaN
        ['b', 'fd_zero'],                       // finite / Inf
        ['label', 'fd_inf'],
        0x20ff, // movs r0, #255
        0x05c0, // lsls r0, r0, #23
        ['b', 'fd_signit'],
        ['label', 'fd_nan'],
        0x20ff, // movs r0, #255
        0x05c0, // lsls r0, r0, #23
        0x2101, // movs r1, #1
        0x0589, // lsls r1, r1, #22
        0x4308, // orrs r0, r1
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fd_zero'],
        0x2000, // movs r0, #0
        ['label', 'fd_signit'],
        0x07ff, // lsls r7, r7, #31
        0x4338, // orrs r0, r7
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fd_finite'],
        0x2c00, // cmp  r4, #0
        ['bne', 'fd_bnz'],
        0x2a00, // cmp  r2, #0
        ['beq', 'fd_nan'],                      // 0 / 0
        ['b', 'fd_inf'],                        // x / 0
        ['label', 'fd_bnz'],
        0x2a00, // cmp  r2, #0
        ['beq', 'fd_zero'],                     // 0 / x
        0x1b16, // subs r6, r2, r4
        0x367f, // adds r6, #127          ; r6 = ea - eb + 127
        0x2001, // movs r0, #1
        0x05c0, // lsls r0, r0, #23
        0x4303, // orrs r3, r0            ; numerator   = 1.ma
        0x4305, // orrs r5, r0            ; denominator = 1.mb
        0x42ab, // cmp  r3, r5
        ['bhs', 'fd_ready'],
        0x005b, // lsls r3, r3, #1        ; ma < mb: one doubling makes it so
        0x3e01, // subs r6, #1
        ['label', 'fd_ready'],
        0x2100, // movs r1, #0            ; quotient
        0x2219, // movs r2, #25           ; bits to produce
        ['label', 'fd_loop'],
        0x0049, // lsls r1, r1, #1
        0x42ab, // cmp  r3, r5
        ['blo', 'fd_nobit'],
        0x1b5b, // subs r3, r3, r5        ; it fits: take it
        0x3101, // adds r1, #1
        ['label', 'fd_nobit'],
        0x005b, // lsls r3, r3, #1        ; bring down the next place
        0x3a01, // subs r2, #1
        0x2a00, // cmp  r2, #0
        ['bne', 'fd_loop'],
        0x000a, // movs r2, r1
        0x0852, // lsrs r2, r2, #1        ; r2 = 24-bit significand
        0x2401, // movs r4, #1
        0x400c, // ands r4, r1            ; r4 = the guard bit
        ['label', 'fd_round'],
        0x2c00, // cmp  r4, #0
        ['beq', 'fd_pack'],                     // guard clear: round down
        0x2b00, // cmp  r3, #0
        ['bne', 'fd_up'],                       // a remainder is sticky: round up
        0x0014, // movs r4, r2
        0x07e4, // lsls r4, r4, #31       ; an exact tie: round to even
        ['beq', 'fd_pack'],
        ['label', 'fd_up'],
        0x3201, // adds r2, #1
        0x0e14, // lsrs r4, r2, #24
        0x2c00, // cmp  r4, #0
        ['beq', 'fd_pack'],
        0x0852, // lsrs r2, r2, #1
        0x3601, // adds r6, #1
        ['label', 'fd_pack'],
        0x2eff, // cmp  r6, #255
        ['blt', 'fd_inrange'],
        ['b', 'fd_inf'],
        ['label', 'fd_inrange'],
        0x2e00, // cmp  r6, #0
        ['ble', 'fd_zero'],                     // underflow: flushed
        0x0252, // lsls r2, r2, #9
        0x0a52, // lsrs r2, r2, #9
        0x05f6, // lsls r6, r6, #23
        0x0010, // movs r0, r2
        0x4330, // orrs r0, r6
        ['b', 'fd_signit'],
    ]);

    // ── float2int(r0 = float) → r0 = int32, truncating toward zero ─────
    //
    // SF table index 7, and the inverse of int2float above. C truncates toward
    // zero rather than rounding, so the right shift IS the conversion and there
    // is no rounding step to get wrong.
    //
    // DECLARED UNSUPPORTED, and refused by name in the tests rather than
    // guessed at: |x| >= 2^31 does not fit an int32, and C leaves the result
    // undefined. This returns 0 rather than inventing a saturation the
    // datasheet does not specify. NaN and infinity land in the same branch.
    const float2int = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x0fc1, // lsrs r1, r0, #31       ; r1 = sign
        0x0042, // lsls r2, r0, #1
        0x0e12, // lsrs r2, r2, #24       ; r2 = exponent
        0x0243, // lsls r3, r0, #9
        0x0a5b, // lsrs r3, r3, #9        ; r3 = mantissa
        0x2a7f, // cmp  r2, #127
        ['bge', 'f2i_ge1'],
        0x2000, // movs r0, #0
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'f2i_ge1'],
        0x2a9e, // cmp  r2, #158
        ['blt', 'f2i_range'],
        0x2000, // movs r0, #0
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'f2i_range'],
        0x2401, // movs r4, #1
        0x05e4, // lsls r4, r4, #23
        0x4323, // orrs r3, r4            ; restore the implicit 1: r3 = 1.mmm << 23
        0x0014, // movs r4, r2
        0x3c96, // subs r4, #150          ; r4 = exp - 150
        0x2c00, // cmp  r4, #0
        ['blt', 'f2i_right'],
        0x40a3, // lsls r3, r4            ; scale up
        ['b', 'f2i_sign'],
        ['label', 'f2i_right'],
        0x4264, // rsbs r4, r4, #0        ; how far down
        0x40e3, // lsrs r3, r4            ; TRUNCATES toward zero, which is the C rule
        ['label', 'f2i_sign'],
        0x0018, // movs r0, r3
        0x2900, // cmp  r1, #0
        ['beq', 'f2i_out'],
        0x4240, // rsbs r0, r0, #0        ; negative
        ['label', 'f2i_out'],
        0xbdf0, // pop  {r4-r7, pc}
    ]);

    // ── uint2float(r0 = uint32) → r0 = float ───────────────────────────
    //
    // SF table index 13. int2float without the sign step, and with the same
    // round-to-nearest-ties-to-even, so 2^24+1 rounds DOWN and 2^24+3 rounds UP
    // for the same reason: the surviving mantissa must be even.
    const uint2float = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x2800, // cmp  r0, #0
        ['bne', 'u2f_nz'],
        0xbdf0, // pop  {r4-r7, pc}       ; +0.0
        ['label', 'u2f_nz'],
        0x2200, // movs r2, #0            ; shift count
        ['label', 'u2f_norm'],
        0x0003, // movs r3, r0            ; N = bit 31
        ['bmi', 'u2f_normed'],
        0x0040, // lsls r0, r0, #1
        0x3201, // adds r2, #1
        ['b', 'u2f_norm'],
        ['label', 'u2f_normed'],
        0x239e, // movs r3, #158
        0x1a9b, // subs r3, r3, r2        ; exponent
        0x0002, // movs r2, r0
        0x0612, // lsls r2, r2, #24       ; the 8 dropped bits
        0x0a00, // lsrs r0, r0, #8
        0x2a00, // cmp  r2, #0
        ['beq', 'u2f_pack'],
        0x0014, // movs r4, r2
        ['bpl', 'u2f_pack'],                    // guard clear
        0x0054, // lsls r4, r2, #1        ; sticky
        ['bne', 'u2f_up'],
        0x0004, // movs r4, r0
        0x07e4, // lsls r4, r4, #31       ; tie: to even
        ['beq', 'u2f_pack'],
        ['label', 'u2f_up'],
        0x3001, // adds r0, #1
        0x0e04, // lsrs r4, r0, #24
        0x2c00, // cmp  r4, #0
        ['beq', 'u2f_pack'],
        0x0840, // lsrs r0, r0, #1
        0x3301, // adds r3, #1
        ['label', 'u2f_pack'],
        0x0240, // lsls r0, r0, #9
        0x0a40, // lsrs r0, r0, #9
        0x05db, // lsls r3, r3, #23
        0x4318, // orrs r0, r3
        0xbdf0, // pop  {r4-r7, pc}
    ]);

    // ── float2uint(r0 = float) → r0 = uint32, truncating ───────────────
    //
    // SF table index 9. Every refused case returns 0 and they are refused BY
    // NAME in the tests rather than guessed at: a negative input, |x| >= 2^32,
    // NaN and infinity are all undefined in C, and this does not invent a
    // saturation the datasheet does not specify. The zero is loaded before the
    // checks so every refusal exits through one path.
    const float2uint = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x0fc1, // lsrs r1, r0, #31       ; sign
        0x0042, // lsls r2, r0, #1
        0x0e12, // lsrs r2, r2, #24       ; exponent
        0x0243, // lsls r3, r0, #9
        0x0a5b, // lsrs r3, r3, #9        ; mantissa
        0x2000, // movs r0, #0            ; the answer for every refused case
        0x2900, // cmp  r1, #0
        ['bne', 'f2u_out'],                     // negative: undefined in C, refused
        0x2a7f, // cmp  r2, #127
        ['blt', 'f2u_out'],                     // |x| < 1
        0x2a9f, // cmp  r2, #159
        ['bge', 'f2u_out'],                     // >= 2^32, and NaN/Inf, refused
        0x2401, // movs r4, #1
        0x05e4, // lsls r4, r4, #23
        0x4323, // orrs r3, r4            ; implicit 1
        0x0014, // movs r4, r2
        0x3c96, // subs r4, #150
        0x2c00, // cmp  r4, #0
        ['blt', 'f2u_right'],
        0x40a3, // lsls r3, r4
        ['b', 'f2u_done'],
        ['label', 'f2u_right'],
        0x4264, // rsbs r4, r4, #0
        0x40e3, // lsrs r3, r4            ; truncate
        ['label', 'f2u_done'],
        0x0018, // movs r0, r3
        ['label', 'f2u_out'],
        0xbdf0, // pop  {r4-r7, pc}
    ]);

    // ── fsqrt(r0 = float) → r0 = sqrt(x) ───────────────────────────────
    //
    // SF table index 6. Digit-by-digit, two bits of radicand per bit of root,
    // which is long division's cousin and the reason to prefer it here: it
    // leaves an exact REMAINDER, and the remainder is what separates a root
    // that terminates from one that does not. Newton's method converges faster
    // and cannot tell those apart at the rounding edge.
    //
    // The exponent is forced EVEN first, folding the odd bit into the
    // significand as a doubling. sqrt of a value in [1,4) is in [1,2), so the
    // root is 25 bits with bit 24 set in both cases and there is one shape to
    // pack rather than two.
    //
    // A negative input is undefined in C and returns a quiet NaN; sqrt(+Inf)
    // is +Inf; signed zeros come back unchanged, which is IEEE's rule and not
    // an accident of the flush.
    const fsqrt = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x0fc1, // lsrs r1, r0, #31       ; sign
        0x0042, // lsls r2, r0, #1
        0x0e12, // lsrs r2, r2, #24       ; exponent
        0x0243, // lsls r3, r0, #9
        0x0a5b, // lsrs r3, r3, #9        ; mantissa
        0x2aff, // cmp  r2, #255
        ['bne', 'sq_finite'],
        0x2b00, // cmp  r3, #0
        ['bne', 'sq_nan'],                      // NaN in, NaN out
        0x2900, // cmp  r1, #0
        ['bne', 'sq_nan'],                      // sqrt(-Inf)
        0xbdf0, // pop  {r4-r7, pc}       ; sqrt(+Inf) = +Inf
        ['label', 'sq_finite'],
        0x2a00, // cmp  r2, #0
        ['beq', 'sq_ret'],                      // +-0, and subnormals flushed to it
        0x2900, // cmp  r1, #0
        ['beq', 'sq_pos'],
        ['label', 'sq_nan'],
        0x20ff, // movs r0, #255
        0x05c0, // lsls r0, r0, #23
        0x2101, // movs r1, #1
        0x0589, // lsls r1, r1, #22
        0x4308, // orrs r0, r1            ; sqrt of a negative is undefined: qNaN
        ['label', 'sq_ret'],
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'sq_pos'],
        0x2401, // movs r4, #1
        0x05e4, // lsls r4, r4, #23
        0x4323, // orrs r3, r4            ; r3 = S = 1.f as 24 bits
        0x3a7f, // subs r2, #127          ; r2 = e
        0x0014, // movs r4, r2
        0x2501, // movs r5, #1
        0x402c, // ands r4, r5            ; r4 = e & 1
        0x2c00, // cmp  r4, #0
        ['beq', 'sq_even'],
        0x3a01, // subs r2, #1            ; e -= 1, now even
        0x009b, // lsls r3, r3, #2        ; and the value doubles: M = S << 2
        ['b', 'sq_scaled'],
        ['label', 'sq_even'],
        0x005b, // lsls r3, r3, #1        ; M = S << 1
        ['label', 'sq_scaled'],
        0x1052, // asrs r2, r2, #1        ; result exponent = e/2, arithmetic for negatives
        0x327f, // adds r2, #127          ; ...biased
        0x019b, // lsls r3, r3, #6        ; align M so its top bit is at 31
        0x2400, // movs r4, #0            ; root
        0x2500, // movs r5, #0            ; remainder
        0x2619, // movs r6, #25           ; bits to produce
        ['label', 'sq_loop'],
        0x001f, // movs r7, r3
        0x0fbf, // lsrs r7, r7, #30       ; the next two bits
        0x009b, // lsls r3, r3, #2        ; zeros arrive on their own once M is spent
        0x00ad, // lsls r5, r5, #2
        0x433d, // orrs r5, r7            ; rem = rem<<2 | pair
        0x0027, // movs r7, r4
        0x00bf, // lsls r7, r7, #2
        0x3701, // adds r7, #1            ; trial = root<<2 | 1
        0x42bd, // cmp  r5, r7
        ['blo', 'sq_zero'],
        0x1bed, // subs r5, r5, r7        ; it fits
        0x0064, // lsls r4, r4, #1
        0x3401, // adds r4, #1            ; root = root<<1 | 1
        ['b', 'sq_next'],
        ['label', 'sq_zero'],
        0x0064, // lsls r4, r4, #1        ; root = root<<1
        ['label', 'sq_next'],
        0x3e01, // subs r6, #1
        0x2e00, // cmp  r6, #0
        ['bne', 'sq_loop'],
        0x0027, // movs r7, r4
        0x2001, // movs r0, #1
        0x4007, // ands r7, r0            ; guard = root bit 0
        0x0864, // lsrs r4, r4, #1        ; 24-bit significand
        0x2f00, // cmp  r7, #0
        ['beq', 'sq_pack'],                     // guard clear: round down
        0x2d00, // cmp  r5, #0
        ['bne', 'sq_up'],                       // a remainder is sticky: round up
        0x0027, // movs r7, r4
        0x07ff, // lsls r7, r7, #31       ; exact tie: round to even
        ['beq', 'sq_pack'],
        ['label', 'sq_up'],
        0x3401, // adds r4, #1
        0x0e27, // lsrs r7, r4, #24
        0x2f00, // cmp  r7, #0
        ['beq', 'sq_pack'],
        0x0864, // lsrs r4, r4, #1
        0x3201, // adds r2, #1
        ['label', 'sq_pack'],
        0x0264, // lsls r4, r4, #9
        0x0a64, // lsrs r4, r4, #9        ; drop the implicit 1
        0x05d2, // lsls r2, r2, #23
        0x0020, // movs r0, r4
        0x4310, // orrs r0, r2            ; sqrt is never negative
        0xbdf0, // pop  {r4-r7, pc}
    ]);

    // ── fix2float(r0 = int32 m, r1 = n) → r0 = m / 2^n as a float ──────
    //
    // SF table index 12. This is int2float with the exponent reduced by the
    // fractional-bit count, which is the whole of fixed-point conversion: the
    // significand and its rounding are identical, and only the scale differs.
    // n is parked in r6 at entry because the sign work below needs r1.
    const fix2float = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x000e, // movs r6, r1           ; n, kept clear of the sign work below
        0x2800, // cmp  r0, #0
        ['bne', 'fx2f_nz'],
        0xbdf0, // pop  {r4-r7, pc}      ; +0.0
        ['label', 'fx2f_nz'],
        0x2100, // movs r1, #0           ; sign
        0x2800, // cmp  r0, #0
        ['bge', 'fx2f_pos'],
        0x2101, // movs r1, #1
        0x4240, // rsbs r0, r0, #0      ; magnitude
        ['label', 'fx2f_pos'],
        0x2200, // movs r2, #0           ; shift count
        ['label', 'fx2f_norm'],
        0x0003, // movs r3, r0
        ['bmi', 'fx2f_normed'],
        0x0040, // lsls r0, r0, #1
        0x3201, // adds r2, #1
        ['b', 'fx2f_norm'],
        ['label', 'fx2f_normed'],
        0x239e, // movs r3, #158
        0x1a9b, // subs r3, r3, r2
        0x1b9b, // subs r3, r3, r6       ; ...less the fractional bits
        0x0002, // movs r2, r0
        0x0612, // lsls r2, r2, #24      ; the 8 dropped bits
        0x0a00, // lsrs r0, r0, #8
        0x2a00, // cmp  r2, #0
        ['beq', 'fx2f_range'],
        0x0014, // movs r4, r2
        ['bpl', 'fx2f_range'],                 // guard clear
        0x0054, // lsls r4, r2, #1       ; sticky
        ['bne', 'fx2f_up'],
        0x0004, // movs r4, r0
        0x07e4, // lsls r4, r4, #31      ; tie: to even
        ['beq', 'fx2f_range'],
        ['label', 'fx2f_up'],
        0x3001, // adds r0, #1
        0x0e04, // lsrs r4, r0, #24
        0x2c00, // cmp  r4, #0
        ['beq', 'fx2f_range'],
        0x0840, // lsrs r0, r0, #1
        0x3301, // adds r3, #1
        ['label', 'fx2f_range'],
        0x2b00, // cmp  r3, #0
        ['bgt', 'fx2f_pack'],
        0x2000, // movs r0, #0
        0x07c9, // lsls r1, r1, #31
        0x4308, // orrs r0, r1           ; a signed zero
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'fx2f_pack'],
        0x0240, // lsls r0, r0, #9
        0x0a40, // lsrs r0, r0, #9
        0x05db, // lsls r3, r3, #23
        0x4318, // orrs r0, r3
        0x07c9, // lsls r1, r1, #31
        0x4308, // orrs r0, r1
        0xbdf0, // pop  {r4-r7, pc}
    ]);

    // ── ufix2float(r0 = uint32 m, r1 = n) → r0 = m / 2^n ──────────────
    //
    // SF table index 14. fix2float without the sign step.
    const ufix2float = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x000e, // movs r6, r1           ; n, kept clear of the sign work below
        0x2800, // cmp  r0, #0
        ['bne', 'ufx2f_nz'],
        0xbdf0, // pop  {r4-r7, pc}      ; +0.0
        ['label', 'ufx2f_nz'],
        0x2100, // movs r1, #0           ; sign
        0x2200, // movs r2, #0           ; shift count
        ['label', 'ufx2f_norm'],
        0x0003, // movs r3, r0
        ['bmi', 'ufx2f_normed'],
        0x0040, // lsls r0, r0, #1
        0x3201, // adds r2, #1
        ['b', 'ufx2f_norm'],
        ['label', 'ufx2f_normed'],
        0x239e, // movs r3, #158
        0x1a9b, // subs r3, r3, r2
        0x1b9b, // subs r3, r3, r6       ; ...less the fractional bits
        0x0002, // movs r2, r0
        0x0612, // lsls r2, r2, #24      ; the 8 dropped bits
        0x0a00, // lsrs r0, r0, #8
        0x2a00, // cmp  r2, #0
        ['beq', 'ufx2f_range'],
        0x0014, // movs r4, r2
        ['bpl', 'ufx2f_range'],                 // guard clear
        0x0054, // lsls r4, r2, #1       ; sticky
        ['bne', 'ufx2f_up'],
        0x0004, // movs r4, r0
        0x07e4, // lsls r4, r4, #31      ; tie: to even
        ['beq', 'ufx2f_range'],
        ['label', 'ufx2f_up'],
        0x3001, // adds r0, #1
        0x0e04, // lsrs r4, r0, #24
        0x2c00, // cmp  r4, #0
        ['beq', 'ufx2f_range'],
        0x0840, // lsrs r0, r0, #1
        0x3301, // adds r3, #1
        ['label', 'ufx2f_range'],
        0x2b00, // cmp  r3, #0
        ['bgt', 'ufx2f_pack'],
        0x2000, // movs r0, #0
        0x07c9, // lsls r1, r1, #31
        0x4308, // orrs r0, r1           ; a signed zero
        0xbdf0, // pop  {r4-r7, pc}
        ['label', 'ufx2f_pack'],
        0x0240, // lsls r0, r0, #9
        0x0a40, // lsrs r0, r0, #9
        0x05db, // lsls r3, r3, #23
        0x4318, // orrs r0, r3
        0x07c9, // lsls r1, r1, #31
        0x4308, // orrs r0, r1
        0xbdf0, // pop  {r4-r7, pc}
    ]);

    // ── float2fix(r0 = float, r1 = n) → r0 = int32, truncating ────────
    //
    // SF table index 8. float2int with the exponent RAISED by n before the
    // range check, so the scaling happens for free inside the shift that was
    // already there. Truncates toward zero, as C does.
    const float2fix = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x000e, // movs r6, r1           ; n
        0x0fc1, // lsrs r1, r0, #31      ; sign
        0x0042, // lsls r2, r0, #1
        0x0e12, // lsrs r2, r2, #24      ; exponent
        0x0243, // lsls r3, r0, #9
        0x0a5b, // lsrs r3, r3, #9       ; mantissa
        0x2000, // movs r0, #0           ; the answer for every refused case
        0x2aff, // cmp  r2, #255
        ['beq', 'f2fx_out'],                  // NaN and infinity, refused
        0x1992, // adds r2, r2, r6       ; scale by the fractional bits
        0x2a7f, // cmp  r2, #127
        ['blt', 'f2fx_out'],                  // |x| < 1 after scaling
        0x2a9e, // cmp  r2, #158
        ['bge', 'f2fx_out'],                  // out of range, refused
        0x2401, // movs r4, #1
        0x05e4, // lsls r4, r4, #23
        0x4323, // orrs r3, r4           ; implicit 1
        0x0014, // movs r4, r2
        0x3c96, // subs r4, #150
        0x2c00, // cmp  r4, #0
        ['blt', 'f2fx_right'],
        0x40a3, // lsls r3, r4
        ['b', 'f2fx_done'],
        ['label', 'f2fx_right'],
        0x4264, // rsbs r4, r4, #0
        0x40e3, // lsrs r3, r4           ; truncate toward zero
        ['label', 'f2fx_done'],
        0x0018, // movs r0, r3
        0x2900, // cmp  r1, #0
        ['beq', 'f2fx_out'],
        0x4240, // rsbs r0, r0, #0
        ['label', 'f2fx_out'],
        0xbdf0, // pop  {r4-r7, pc}
    ]);

    // ── float2ufix(r0 = float, r1 = n) → r0 = uint32, truncating ──────
    //
    // SF table index 10. float2fix without the sign, and refusing a negative
    // input the way float2uint does.
    const float2ufix = pc;
    pc = asm(view, pc, [
        0xb5f0, // push {r4-r7, lr}
        0x000e, // movs r6, r1           ; n
        0x0fc1, // lsrs r1, r0, #31      ; sign
        0x0042, // lsls r2, r0, #1
        0x0e12, // lsrs r2, r2, #24      ; exponent
        0x0243, // lsls r3, r0, #9
        0x0a5b, // lsrs r3, r3, #9       ; mantissa
        0x2000, // movs r0, #0           ; the answer for every refused case
        0x2900, // cmp  r1, #0
        ['bne', 'f2ufx_out'],                // negative: undefined in C
        0x2aff, // cmp  r2, #255
        ['beq', 'f2ufx_out'],                  // NaN and infinity, refused
        0x1992, // adds r2, r2, r6       ; scale by the fractional bits
        0x2a7f, // cmp  r2, #127
        ['blt', 'f2ufx_out'],                  // |x| < 1 after scaling
        0x2a9f, // cmp  r2, #159
        ['bge', 'f2ufx_out'],                  // out of range, refused
        0x2401, // movs r4, #1
        0x05e4, // lsls r4, r4, #23
        0x4323, // orrs r3, r4           ; implicit 1
        0x0014, // movs r4, r2
        0x3c96, // subs r4, #150
        0x2c00, // cmp  r4, #0
        ['blt', 'f2ufx_right'],
        0x40a3, // lsls r3, r4
        ['b', 'f2ufx_done'],
        ['label', 'f2ufx_right'],
        0x4264, // rsbs r4, r4, #0
        0x40e3, // lsrs r3, r4           ; truncate toward zero
        ['label', 'f2ufx_done'],
        0x0018, // movs r0, r3
        ['label', 'f2ufx_out'],
        0xbdf0, // pop  {r4-r7, pc}
    ]);

    // ── the float constant pool ────────────────────────────────────────
    //
    // Thumb-1 cannot materialise an arbitrary 32-bit value inline, and this
    // emitter has no literal pool: a PC-relative LDR needs word alignment it
    // does not track. So constants live at a FIXED address instead, and a
    // routine builds that address in two instructions — `movs rN, #16` then
    // `lsls rN, rN, #8` — and reads a word with LDR's 5-bit offset.
    //
    // 0x1000 is chosen because the code ends well below it (0x84b as of
    // 2026-09-10) and the tables sit below that too, so the pool cannot
    // collide with anything that grows. The 5-bit offset caps one base at 32
    // words, which is checked below rather than assumed.
    const CONST_POOL = 0x1000;
    const constants = [];
    /** Register a float constant; returns its word index for LDR. */
    const k = (value) => {
        const at = constants.indexOf(value);
        if (at >= 0) return at;
        constants.push(value);
        if (constants.length > 32) {
            throw new Error('constant pool past 32 words: LDR\'s 5-bit offset cannot reach it');
        }
        return constants.length - 1;
    };
    /** `movs rN, #16; lsls rN, rN, #8` — the pool's base address, 0x1000. */
    const poolBase = (reg) => [0x2010 | (reg << 8), 0x0200 | (reg << 3) | reg];
    /** `ldr rD, [rBase, #index*4]` */
    const ldrK = (rd, rbase, index) => 0x6800 | (index << 6) | (rbase << 3) | rd;

    // ── fln(r0 = float) → r0 = ln(x) ───────────────────────────────────
    //
    // SF table index 20, and the first entry here that APPROXIMATES. Every
    // operator above has a single correctly-rounded answer and is graded
    // bit-exact against Math.fround. A transcendental does not: JavaScript
    // computes it in DOUBLE and rounds down, and a float32 polynomial differs
    // in the last bit on a fair share of inputs. Grading this bit-exact would
    // fail a perfectly good implementation, so the test states a ULP bound
    // instead — and the bound is CHOSEN, not derived.
    //
    // ln(x) = ln(m) + e*ln2 for x = m * 2^e, and the reduction is EXACT:
    // pulling the exponent out costs no accuracy at all, which is why the
    // series only has to be good on [1, 2).
    //
    // ln(m) = 2*atanh(s) with s = (m-1)/(m+1), so s is at most 1/3 and the
    // series converges fast: the term in s^(2k+1) is bounded by (1/9)^k/(2k+1)
    // relative to s, which passes 2^-24 by k=7. Hence the coefficients 1/3
    // through 1/15, evaluated by Horner in s^2.
    const fln = pc;
    {
        const c = [k(1), k(1 / 3), k(1 / 5), k(1 / 7), k(1 / 9), k(1 / 11), k(1 / 13), k(1 / 15)];
        const LN2 = k(Math.fround(Math.LN2));
        const SQRT2 = k(Math.fround(Math.SQRT2));
        pc = asm(view, pc, [
            0xb5f0,                     // push {r4-r7, lr}
            0xb081,                     // sub  sp, #4            ; a slot for e
            // ---- specials -------------------------------------------------
            0x0002,                     // movs r2, r0
            0x0fd2,                     // lsrs r2, r2, #31       ; sign
            0x0043,                     // lsls r3, r0, #1
            0x0e1b,                     // lsrs r3, r3, #24       ; exponent
            0x2b00,                     // cmp  r3, #0
            ['bne', 'ln_nz'],
            // +-0 -> -Infinity, which is IEEE's answer and not an error here
            0x20ff,                     // movs r0, #255
            0x05c0,                     // lsls r0, r0, #23
            0x2101,                     // movs r1, #1
            0x07c9,                     // lsls r1, r1, #31
            0x4308,                     // orrs r0, r1            ; -Inf
            ['b', 'ln_out'],
            ['label', 'ln_nz'],
            0x2a00,                     // cmp  r2, #0
            ['bne', 'ln_nan'],          //                        ; ln of a negative
            0x2bff,                     // cmp  r3, #255
            ['bne', 'ln_finite'],
            0x0241,                     // lsls r1, r0, #9
            0x0a49,                     // lsrs r1, r1, #9        ; mantissa bits
            0x2900,                     // cmp  r1, #0
            // ln(+Inf) = +Inf. Inverted around an unconditional branch because
            // a conditional one reaches 127 halfwords and ln_out is further
            // than that now — the assembler said so by name rather than
            // truncating, which is the whole reason it throws.
            ['bne', 'ln_nan'],
            ['b', 'ln_out'],
            ['label', 'ln_nan'],
            0x20ff,                     // movs r0, #255
            0x05c0,                     // lsls r0, r0, #23
            0x2101,                     // movs r1, #1
            0x0589,                     // lsls r1, r1, #22
            0x4308,                     // orrs r0, r1            ; qNaN
            ['b', 'ln_out'],
            // ---- x = m * 2^e, m in [1,2) ----------------------------------
            ['label', 'ln_finite'],
            0x1e5c,                     // subs r4, r3, #1        ; e = exp - 127...
            0x3c7e,                     // subs r4, #126          ; ...in two steps
            0x0240,                     // lsls r0, r0, #9
            0x0a40,                     // lsrs r0, r0, #9        ; mantissa
            0x217f,                     // movs r1, #127
            0x05c9,                     // lsls r1, r1, #23       ; 3f800000h = 1.0f.
                                        //   The exponent FIELD of 1.0 is 127,
                                        //   not the 63 this first built.
            0x4308,                     // orrs r0, r1            ; r0 = m, in [1,2)
            // THE RANGE IS CENTRED ON 1, NOT ON [1,2), and this is the whole
            // accuracy of the routine near x = 1. With m in [1,2), an x just
            // below 1 gives m near 2 and e = -1, so the answer is a tiny
            // DIFFERENCE of ln(m) = +0.693 and e*ln2 = -0.693: measured, the
            // error at ln(0.99999994) was a factor of two. Folding m into
            // [1/sqrt2, sqrt2) makes e = 0 there, so there is nothing to
            // cancel — and it shrinks |s| from 1/3 to 0.172, which the series
            // is glad of as well.
            0x2500,                     // movs r5, #0
            ...poolBase(5),
            ldrK(1, 5, SQRT2),
            0x4288,                     // cmp  r0, r1            ; both positive: bits compare
            ['blo', 'ln_centred'],
            0x2101,                     // movs r1, #1
            0x05c9,                     // lsls r1, r1, #23
            0x1a40,                     // subs r0, r0, r1        ; m /= 2, exactly
            0x3401,                     // adds r4, #1            ; ...and e absorbs it
            ['label', 'ln_centred'],
            0x9400,                     // str  r4, [sp, #0]      ; keep e
            0x0004,                     // movs r4, r0            ; keep m
            // s = (m - 1) / (m + 1)
            0x0021,                     // movs r1, r4
            0x0020,                     // movs r0, r4
            0x2500,                     // movs r5, #0
            ...poolBase(5),
            ldrK(1, 5, c[0]),           // ldr  r1, [pool, #1.0]
            ['bl', fsub],               // m - 1
            0x0006,                     // movs r6, r0
            0x0020,                     // movs r0, r4
            ...poolBase(5),
            ldrK(1, 5, c[0]),
            ['bl', fadd],               // m + 1
            0x0001,                     // movs r1, r0
            0x0030,                     // movs r0, r6
            ['bl', fdiv],               // s
            0x0004,                     // movs r4, r0            ; r4 = s
            0x0001,                     // movs r1, r0
            ['bl', fmul],               // u = s*s
            0x0005,                     // movs r5, r0            ; r5 = u
            // Horner in u, from 1/15 down to 1
            0x2600,                     // movs r6, #0
            ...poolBase(6),
            ldrK(0, 6, c[7]),           // acc = 1/15
            ...[[c[6]], [c[5]], [c[4]], [c[3]], [c[2]], [c[1]], [c[0]]].flatMap(([ci]) => [
                0x0029,                 // movs r1, r5            ; * u
                ['bl', fmul],
                0x2600,                 // movs r6, #0
                ...poolBase(6),
                ldrK(1, 6, ci),         // + coefficient
                ['bl', fadd]
            ]),
            // ln(m) = 2 * s * acc
            0x0021,                     // movs r1, r4
            ['bl', fmul],               // s * acc
            0x0001,                     // movs r1, r0
            ['bl', fadd],               // + itself, i.e. * 2
            0x0006,                     // movs r6, r0            ; r6 = ln(m)
            // + e * ln2
            0x9800,                     // ldr  r0, [sp, #0]      ; e
            ['bl', int2float],
            0x2500,                     // movs r5, #0
            ...poolBase(5),
            ldrK(1, 5, LN2),
            ['bl', fmul],               // e * ln2
            0x0001,                     // movs r1, r0
            0x0030,                     // movs r0, r6
            ['bl', fadd],               // ln(m) + e*ln2
            ['label', 'ln_out'],
            0xb001,                     // add  sp, #4
            0xbdf0                      // pop  {r4-r7, pc}
        ]);
    }

    // ── fexp(r0 = float) → r0 = e^x ────────────────────────────────────
    //
    // SF table index 19. e^x = 2^k * e^r with k = round(x/ln2), so |r| is at
    // most ln2/2 and the Taylor series converges in a handful of terms; the
    // 2^k is then free, because scaling by a power of two is an ADD to the
    // exponent field.
    //
    // ln2 IS SPLIT IN TWO. k*ln2 reaches 88 while r is under 0.35, so
    // computing r = x - k*ln2 in one step throws away most of r's significant
    // bits to cancellation. LN2_HI has its low twelve mantissa bits cleared,
    // which makes k*LN2_HI exact for every k this routine sees, and LN2_LO
    // carries the remainder — the same trick, and the same reason, as
    // centring fln's reduction on 1.
    const fexp = pc;
    {
        // ln2 with its low twelve mantissa bits cleared, DERIVED rather than
        // typed: a constant of this kind copied by hand is a constant nobody
        // can check.
        const hiBuf = new DataView(new ArrayBuffer(4));
        hiBuf.setFloat32(0, Math.fround(Math.LN2));
        hiBuf.setUint32(0, hiBuf.getUint32(0) & 0xfffff000);
        const HI = hiBuf.getFloat32(0);
        const LO = Math.fround(Math.LN2 - HI);
        const INV = k(Math.fround(1 / Math.LN2));
        const LN2_HI = k(HI), LN2_LO = k(LO);
        const HALF = k(0.5), NHALF = k(-0.5), ONE = k(1);
        const T = [2, 6, 24, 120, 720, 5040, 40320, 362880].map((f) => k(Math.fround(1 / f)));
        pc = asm(view, pc, [
            0xb5f0,                     // push {r4-r7, lr}
            0xb081,                     // sub  sp, #4
            0x9000,                     // str  r0, [sp, #0]      ; keep x
            0x0043,                     // lsls r3, r0, #1
            0x0e1b,                     // lsrs r3, r3, #24
            0x2bff,                     // cmp  r3, #255
            ['bne', 'ex_finite'],
            0x0241,                     // lsls r1, r0, #9
            0x0a49,                     // lsrs r1, r1, #9
            0x2900,                     // cmp  r1, #0
            ['bne', 'ex_early'],        //                        ; NaN in, NaN out
            0x0fc1,                     // lsrs r1, r0, #31
            0x2900,                     // cmp  r1, #0
            ['beq', 'ex_early'],        //                        ; e^+Inf = +Inf
            0x2000,                     // movs r0, #0            ; e^-Inf = +0
            // The specials get their own epilogue rather than branching to the
            // one at the end: a conditional branch reaches 127 halfwords and
            // the polynomial between here and there is longer than that.
            ['label', 'ex_early'],
            0xb001,                     // add  sp, #4
            0xbdf0,                     // pop  {r4-r7, pc}
            ['label', 'ex_finite'],
            // k = round(x / ln2)
            0x2500,                     // movs r5, #0
            ...poolBase(5),
            ldrK(1, 5, INV),
            ['bl', fmul],               // t = x / ln2
            0x0006,                     // movs r6, r0
            0x0fc1,                     // lsrs r1, r0, #31       ; sign of t
            0x2500,                     // movs r5, #0
            ...poolBase(5),
            0x2900,                     // cmp  r1, #0
            ['bne', 'ex_neg'],
            ldrK(1, 5, HALF),
            ['b', 'ex_bias'],
            ['label', 'ex_neg'],
            ldrK(1, 5, NHALF),
            ['label', 'ex_bias'],
            0x0030,                     // movs r0, r6
            ['bl', fadd],               // t +- 0.5, so truncation rounds
            ['bl', float2int],
            0x0004,                     // movs r4, r0            ; r4 = k
            ['bl', int2float],
            0x0006,                     // movs r6, r0            ; r6 = (float)k
            // r = (x - k*LN2_HI) - k*LN2_LO
            0x2500,                     // movs r5, #0
            ...poolBase(5),
            ldrK(1, 5, LN2_HI),
            ['bl', fmul],
            0x0001,                     // movs r1, r0
            0x9800,                     // ldr  r0, [sp, #0]      ; x
            ['bl', fsub],
            0x0007,                     // movs r7, r0
            0x0030,                     // movs r0, r6
            0x2500,                     // movs r5, #0
            ...poolBase(5),
            ldrK(1, 5, LN2_LO),
            ['bl', fmul],
            0x0001,                     // movs r1, r0
            0x0038,                     // movs r0, r7
            ['bl', fsub],
            0x0006,                     // movs r6, r0            ; r6 = r
            // e^r by Horner: acc = 1/9!, then acc*r + 1/n! down to + 1
            0x2500,                     // movs r5, #0
            ...poolBase(5),
            ldrK(0, 5, T[7]),           // 1/9!
            ...[T[6], T[5], T[4], T[3], T[2], T[1], T[0], ONE, ONE].flatMap((ci) => [
                0x0031,                 // movs r1, r6            ; * r
                ['bl', fmul],
                0x2500,                 // movs r5, #0
                ...poolBase(5),
                ldrK(1, 5, ci),
                ['bl', fadd]
            ]),
            // scale by 2^k: an ADD to the exponent field, with both ends checked
            0x0043,                     // lsls r3, r0, #1
            0x0e1b,                     // lsrs r3, r3, #24       ; exponent of e^r
            0x191b,                     // adds r3, r3, r4        ; + k
            0x2b00,                     // cmp  r3, #0
            ['bgt', 'ex_hi'],
            0x2000,                     // movs r0, #0            ; underflow, flushed
            ['b', 'ex_out'],
            ['label', 'ex_hi'],
            0x2bff,                     // cmp  r3, #255
            ['blt', 'ex_pack'],
            0x20ff,                     // movs r0, #255
            0x05c0,                     // lsls r0, r0, #23       ; overflow to +Inf
            ['b', 'ex_out'],
            ['label', 'ex_pack'],
            0x0240,                     // lsls r0, r0, #9
            0x0a40,                     // lsrs r0, r0, #9        ; mantissa
            0x05db,                     // lsls r3, r3, #23
            0x4318,                     // orrs r0, r3            ; e^r is never negative
            ['label', 'ex_out'],
            0xb001,                     // add  sp, #4
            0xbdf0                      // pop  {r4-r7, pc}
        ]);
    }

    // ── the single-precision soft-float stub ───────────────────────────
    //
    // EVERY 'SF' ENTRY POINTS HERE, AND NONE OF THEM COMPUTES ANYTHING.
    // That is the whole of the current implementation and it is deliberate;
    // see SF_TABLE below for why a table of these beats no table at all.
    //
    // It returns a QUIET NaN, 7FC00000h. That is the correct IEEE answer for
    // an undefined result, it is what a caller can recognise (any NaN out of
    // an operation on finite inputs came from here), and — the part that
    // matters — IT RETURNS. A stub that hung, or one the caller fell through,
    // would trade a null-pointer hang for a subtler one.
    //
    // The BKPT is for a host that watches: rp2040js surfaces it through
    // `onBreak`, whose default is a no-op, so execution continues into the
    // NaN either way. It is a signal, not a trap, and nothing here depends
    // on anyone listening.
    //
    // The constant is built with shifts rather than loaded from a literal
    // pool, because a pool needs PC-relative alignment this emitter does not
    // manage and the arithmetic is three instructions.
    const sfUnimplemented = pc;
    pc = emit(view, pc, [
        0xbe00,             // bkpt #0                ; for a host that watches
        0x20ff,             // movs r0, #0xff
        0x05c0,             // lsls r0, r0, #23       ; 7F800000h — infinity
        0x2101,             // movs r1, #1
        0x0589,             // lsls r1, r1, #22       ; 00400000h — the quiet bit
        0x4308,             // orrs r0, r1            ; 7FC00000h — a quiet NaN
        0x4770              // bx   lr
    ]);

    // A reset handler that goes nowhere: we boot from flash, and this
    // exists so the vector table is not a pointer to zero.
    const spin = pc;
    pc = emit(view, pc, [0xe7fe]);          // b .

    // ── the function table ─────────────────────────────────────────────
    //
    // Thumb entry points carry their low bit set. The table stores the
    // address the caller will `blx` to, so the bit belongs here.
    const table = (pc + 3) & ~3;
    const thumb = addr => (addr | 1) & 0xffff;
    const entries = [
        [ROM_FUNC.MEMCPY, thumb(memcpy)],
        [ROM_FUNC.MEMCPY44, thumb(memcpy)],
        [ROM_FUNC.MEMSET, thumb(memset)],
        [ROM_FUNC.MEMSET4, thumb(memset)],
        [ROM_FUNC.POPCOUNT32, thumb(popcount32)],
        [ROM_FUNC.CLZ32, thumb(clz32)],
        [ROM_FUNC.CTZ32, thumb(ctz32)],
        [ROM_FUNC.REVERSE32, thumb(reverse32)],
        [ROM_FUNC.CONNECT_INTERNAL_FLASH, thumb(flashNop)],
        [ROM_FUNC.FLASH_EXIT_XIP, thumb(flashNop)],
        [ROM_FUNC.FLASH_FLUSH_CACHE, thumb(flashNop)],
        [ROM_FUNC.FLASH_ENTER_CMD_XIP, thumb(flashNop)],
        [ROM_FUNC.FLASH_RANGE_ERASE, thumb(flashRangeErase)],
        [ROM_FUNC.FLASH_RANGE_PROGRAM, thumb(flashRangeProgram)]
    ];
    let at = table;
    for (const [c, addr] of entries) {
        view.setUint16(at, c, true);
        view.setUint16(at + 2, addr, true);
        at += 4;
    }
    view.setUint32(at, 0, true);            // terminator

    // ── the 'SF' single-precision float table ──────────────────────────
    //
    // WHAT CHANGED AND WHY. This used to be empty, on the reasoning that
    // answering 'SF' with a pointer to zeros would turn a clean lookup miss
    // into a jump to address 0. That reasoning was right about ZEROS and
    // wrong about the conclusion: the fix is a table of entries that are not
    // zero. Missing it entirely is not neutral — lego-ac measured Kaluma
    // 1.2.1 caching a null-derived operator pointer and calling it, so
    // `2.5+1.0` evaluated to 0 and the first GPIO call hung (ROADMAP R3).
    // MicroPython never asks, which is why it reached its REPL regardless.
    //
    // THE LAYOUT IS THE DATASHEET'S, §2.8.3 (the RP2040 bootrom's float
    // table), cross-checked against two independent sources that agree on
    // indices 0..16. Entries 21 and beyond are RP2350/V2 only and are not
    // emitted here. Order, one 32-bit function pointer each:
    //
    //   0 fadd        1 fsub        2 fmul        3 fdiv
    //   4 deprecated  5 deprecated  6 fsqrt       7 float2int
    //   8 float2fix   9 float2uint 10 float2ufix 11 int2float
    //  12 fix2float  13 uint2float 14 ufix2float 15 fcos
    //  16 fsin       17 ftan       18 deprecated 19 fexp
    //  20 fln
    //
    // NAMED STOP: EVERY ENTRY IS `sfUnimplemented`. NO ARITHMETIC IS
    // IMPLEMENTED HERE. What this buys is not a working float unit — it is
    // that a caller now reaches a routine that returns a quiet NaN instead of
    // dereferencing null. A hang becomes a defined, recognisable wrong
    // answer, which is a diagnosis rather than a mystery.
    //
    // Doing it properly means IEEE-754 single-precision add, multiply and
    // divide hand-written in Thumb-1 on a core with no FPU, no divide and no
    // CLZ, each agreeing with an oracle at the rounding edge. Implementing it
    // in the host and calling out through a breakpoint would be easier and
    // WORSE: the DoD's test is agreement with JavaScript's Math, and a JS
    // implementation tested against JS Math measures itself. See LANES 13.
    const SF_TABLE_ENTRIES = 21;
    const sfTable = (at + 4 + 3) & ~3;
    for (let i = 0; i < SF_TABLE_ENTRIES; i++) {
        view.setUint32(sfTable + i * 4, thumb(sfUnimplemented), true);
    }
    // Implemented so far. Each one that lands here must also be taken out of
    // the named-stop test in test/rp2040-bootrom.test.mjs, which asserts the
    // UNimplemented ones still return the quiet NaN.
    view.setUint32(sfTable + 0 * 4, thumb(fadd), true);
    view.setUint32(sfTable + 1 * 4, thumb(fsub), true);
    view.setUint32(sfTable + 2 * 4, thumb(fmul), true);
    view.setUint32(sfTable + 3 * 4, thumb(fdiv), true);
    view.setUint32(sfTable + 12 * 4, thumb(fix2float), true);
    view.setUint32(sfTable + 14 * 4, thumb(ufix2float), true);
    view.setUint32(sfTable + 8 * 4, thumb(float2fix), true);
    view.setUint32(sfTable + 10 * 4, thumb(float2ufix), true);
    view.setUint32(sfTable + 19 * 4, thumb(fexp), true);
    view.setUint32(sfTable + 20 * 4, thumb(fln), true);
    view.setUint32(sfTable + 6 * 4, thumb(fsqrt), true);
    view.setUint32(sfTable + 7 * 4, thumb(float2int), true);
    view.setUint32(sfTable + 9 * 4, thumb(float2uint), true);
    view.setUint32(sfTable + 11 * 4, thumb(int2float), true);
    view.setUint32(sfTable + 13 * 4, thumb(uint2float), true);

    const dataTable = sfTable + SF_TABLE_ENTRIES * 4;
    view.setUint16(dataTable, ROM_DATA.SOFT_FLOAT, true);
    view.setUint16(dataTable + 2, sfTable, true);
    view.setUint32(dataTable + 4, 0, true);          // terminator

    // The pool is written once every constant is known.
    if (CONST_POOL + constants.length * 4 > BOOTROM_SIZE) throw new Error('constant pool past the ROM');
    constants.forEach((value, index) => view.setFloat32(CONST_POOL + index * 4, value, true));

    // ── the fixed header ───────────────────────────────────────────────
    view.setUint32(0x00, 0x20042000, true);         // initial SP: top of SRAM
    view.setUint32(0x04, thumb(spin), true);        // reset
    view.setUint32(0x08, thumb(spin), true);        // NMI
    view.setUint32(0x0c, thumb(spin), true);        // HardFault
    // THE MAGIC IS THREE BYTES AND THE VERSION IS A FOURTH. 'M', 'u', 0x01 at
    // 0x10..0x12 is the whole of the magic -- the 0x01 is a CONSTANT part of
    // it, not a version number -- and the bootrom version is the separate byte
    // at 0x13. This comment used to read "version 1" against 0x12, which put
    // the version in the magic's third byte and left 0x13 at zero.
    //
    // A zero there is not a harmless omission. pico-sdk reads the version with
    // `*(uint8_t *)0x13` and branches on it, and Kaluma 1.2.1 does exactly
    // that at flash 0x1002096c:
    //
    //     movs r3, #0x13
    //     ldrb r5, [r3]        ; the version byte
    //     cmp  r5, #1
    //     beq  fill_all        ; version 1 -> fill all 32 shim slots
    //     ble  fill_one        ; version < 1 -> fill slot 18 and stop
    //
    // Reading 0 took the `ble` leg, so 31 of 32 double-precision operator
    // pointers stayed NULL, and the first one called branched to address 0.
    // From 0 the core NOP-slid up through this ROM's zeros into
    // rom_table_lookup at 0x100 and returned whatever that left in r0. That is
    // ROADMAP R3: `2.5+1.0` evaluating to 0 while `1+1` gave 2, because
    // integer arithmetic never goes through the shim table.
    //
    // MEASURED, not reasoned: scripts/probe-sf-unaligned.mjs boots Kaluma
    // 1.2.1 and evaluates the expression. With 0x13 = 0 the REPL answers 0;
    // with 0x13 = 1 it answers 3.5. Setting 0x12 instead changes nothing,
    // which is how the two bytes were told apart.
    //
    // 1 IS THE HONEST NUMBER, not the one that makes the most callers happy.
    // Claiming 2 or 3 promises the V2 double-precision table ('DF') and the
    // larger V2 function table, and this ROM publishes neither. Measured at
    // 0x13 = 2 and = 3, Kaluma takes its V2 leg, finds no 'DF', and `2.5+1.0`
    // returns NO value at all -- it echoes. A wrong version trades a wrong
    // answer for no answer.
    rom[0x10] = 0x4d;                               // 'M' ┐
    rom[0x11] = 0x75;                               // 'u' ├ magic, all three bytes
    rom[0x12] = 0x01;                               //     ┘
    rom[0x13] = 0x01;                               // bootrom version: V1, what this ROM implements
    view.setUint16(0x14, table, true);
    view.setUint16(0x16, dataTable, true);
    view.setUint16(0x18, thumb(lookup), true);
    return rom;
}

export default buildBootrom;
