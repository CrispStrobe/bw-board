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
 * storage, no `reset_usb_boot`, and — the one that currently matters — no
 * SOFT-FLOAT TABLE. mufplib is exactly the part that is not free, so the
 * `'SF'` lookup misses and returns 0.
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
 * WHAT IS STILL MISSING is the soft-float table. `'SF'` returns 0 and the
 * lookup path tolerates it. Worth knowing: a MISSED lookup returns 0 and
 * the SDK calls it — there is no null check at most call sites — so
 * address 0 gets executed as Thumb. That is why the flash functions below
 * had to be real rather than absent.
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
    const lookup = pc;
    pc = emit(view, pc, [
        0x8802,             // ldrh r2, [r0, #0]     ; entry code
        0x2a00,             // cmp  r2, #0
        0xd003,             // beq  .notfound        ; +3: `movs r0,#0`, not the
                            //                         `bx lr` after it, which
                            //                         returns the TABLE pointer
        0x428a,             // cmp  r2, r1
        0xd003,             // beq  .found
        0x3004,             // adds r0, #4           ; next pair
        0xe7f8,             // b    .loop
        0x2000,             // .notfound: movs r0, #0
        0x4770,             // bx   lr
        0x8840,             // .found: ldrh r0, [r0, #2]
        0x4770              // bx   lr
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

    const dataTable = sfTable + SF_TABLE_ENTRIES * 4;
    view.setUint16(dataTable, ROM_DATA.SOFT_FLOAT, true);
    view.setUint16(dataTable + 2, sfTable, true);
    view.setUint32(dataTable + 4, 0, true);          // terminator

    // ── the fixed header ───────────────────────────────────────────────
    view.setUint32(0x00, 0x20042000, true);         // initial SP: top of SRAM
    view.setUint32(0x04, thumb(spin), true);        // reset
    view.setUint32(0x08, thumb(spin), true);        // NMI
    view.setUint32(0x0c, thumb(spin), true);        // HardFault
    rom[0x10] = 0x4d;                               // 'M'
    rom[0x11] = 0x75;                               // 'u'
    rom[0x12] = 0x01;                               // version 1
    rom[0x13] = 0x00;
    view.setUint16(0x14, table, true);
    view.setUint16(0x16, dataTable, true);
    view.setUint16(0x18, thumb(lookup), true);
    return rom;
}

export default buildBootrom;
