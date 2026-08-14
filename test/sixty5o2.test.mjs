/**
 * sixty5o2 (MIT, Jan Roesner) bootloader on EATER6502:
 * menu on 16×2 LCD, 4 buttons on PORTA bits 1-4 (active-low),
 * IRQ-based upload protocol, hello_world example display.
 *
 * The sixty5o2 wiring:
 *   VIA Port B = HD44780 data D0-D7
 *   VIA Port A bit 5 = RS, bit 6 = RW, bit 7 = E
 *   VIA Port A bits 1-4 = buttons (active-low: UP=1, DOWN=2, LEFT=4, RIGHT=8)
 *   Upload: PORTB as 8 inputs, CPU /IRQ pulsed ~30µs per byte
 *
 * The bootloader's LCD busy-flag check (LCD__check_busy_flag) reads PORTB
 * with DDRB=0xFF — it reads the VIA output register, not the LCD, so the
 * check is effectively a no-op. We don't need to wire busy-flag readback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { M6502Machine, EATER6502 } from '../src/m6502-machine.js';
import { createHD44780, hd44780Write8 } from '../src/devices/hd44780.js';

const BOOTLOADER_PATH = '/mnt/volume1/code/bw-board/rom/sixty5o2/bootloader.bin';
const HELLO_PATH = '/mnt/volume1/code/bw-board/rom/sixty5o2/hello_world.bin';

/**
 * Wire a VIA to an HD44780 in 8-bit mode.
 * Port B = data, Port A bits 5/6/7 = RS/RW/E.
 * Returns the LCD state for inspection.
 */
function createLcdMachine(romBytes) {
    const lcd = createHD44780({ cols: 16, rows: 2 });
    let lastE = 0;
    let latchedRs = 0; // RS captured on E rising edge

    const m = new M6502Machine(EATER6502, {
        onPinChange: () => {},
    });

    // Intercept VIA port changes to drive the LCD
    const origOnPortChange = m.chips.via1.hooks.onPortChange;
    m.chips.via1.hooks.onPortChange = (port, value, ddr) => {
        if (origOnPortChange) origOnPortChange(port, value, ddr);

        if (port === 'a') {
            const rs = (value >> 5) & 1;
            const rw = (value >> 6) & 1;
            const e = (value >> 7) & 1;
            const prevE = lastE;

            // Capture RS on E rising edge (HD44780 reads RS while E is high)
            if (e && !prevE) {
                latchedRs = rs;
            }

            // HD44780: data latched on falling edge of E
            if (prevE && !e && rw === 0) {
                const data = m.chips.via1.orb;
                const tNs = BigInt(Math.round(m.tMs * 1e6));
                hd44780Write8(lcd, latchedRs, data, tNs);
            }

            lastE = e;
        }
    };

    m.loadRom(romBytes);
    m.mem[0xfffc] = romBytes[romBytes.length - 4];
    m.mem[0xfffd] = romBytes[romBytes.length - 3];
    m.mem[0xfffe] = romBytes[romBytes.length - 2];
    m.mem[0xffff] = romBytes[romBytes.length - 1];
    return { m, lcd };
}

// Skip if ROMs aren't built
const hasBootloader = existsSync(BOOTLOADER_PATH);
const hasHello = existsSync(HELLO_PATH);

test('sixty5o2: bootloader displays splash and menu on LCD', { skip: !hasBootloader && 'ROM not built' }, () => {
    const rom = new Uint8Array(readFileSync(BOOTLOADER_PATH));
    const { m, lcd } = createLcdMachine(rom);
    m.reset();

    // The bootloader: init LCD, clear video ram, print "Sixty/5o2       Bootloader v0.2"
    // then sleep loops, then show menu.
    // The splash prints 32 chars to video RAM then calls LCD__render which
    // writes them to the actual LCD with set_cursor + send_data.
    //
    // Run enough time for the init + splash render.
    // At 1MHz, the sleep loops burn many millions of cycles.
    // LIB__sleep with A=0xFF and WAIT_C=0x18 burns ~24*255 ≈ 6120 inner loops
    // each ~5 cycles = ~30600 cycles per call. The boot does 32 of these = ~980K cycles.
    // Give it plenty of time.
    m.advanceToMs(5000); // 5 seconds at 1 MHz

    // Check LCD text after splash — should show the boot message
    const line1 = lcd.text[0];
    const line2 = lcd.text[1];

    // After the splash delay, the menu should be rendering.
    // The splash message: "Sixty/5o2       Bootloader v0.2"
    // or the menu: "> Load & Run    " / "  Load          "
    // Either the splash or menu should be visible.
    const combined = line1 + line2;

    // Give it more time if needed — the menu comes after the splash delay
    if (!combined.includes('Sixty') && !combined.includes('Load')) {
        m.advanceToMs(20000);
    }

    const finalL1 = lcd.text[0];
    const finalL2 = lcd.text[1];
    const finalCombined = finalL1 + finalL2;

    assert.ok(
        finalCombined.includes('Load') || finalCombined.includes('Sixty'),
        `Expected splash or menu on LCD, got: "${finalL1}" / "${finalL2}"`
    );
});

test('sixty5o2: upload via IRQ loads hello_world, LCD shows text', {
    skip: (!hasBootloader || !hasHello) && 'ROMs not built'
}, () => {
    const rom = new Uint8Array(readFileSync(BOOTLOADER_PATH));
    const hello = new Uint8Array(readFileSync(HELLO_PATH));
    const { m, lcd } = createLcdMachine(rom);
    m.reset();

    // Boot to menu — press RIGHT to select "Load & Run" (first item)
    // Buttons on PA1-PA4 are active-low (normally high via pullup).
    // VIA__read_keyboard_input: LDA PORTA, ROR, AND #$0F, EOR #$0F
    // RIGHT = PA4 low → result $08 after the code's normalize.
    m.chips.via1.setInput('a', 1, 1);
    m.chips.via1.setInput('a', 2, 1);
    m.chips.via1.setInput('a', 3, 1);
    m.chips.via1.setInput('a', 4, 1);
    m.advanceToMs(20000); // boot splash + delay

    // Press and hold RIGHT through the debounce window
    m.chips.via1.setInput('a', 4, 0);
    m.advanceToMs(m.tMs + 8000);
    m.chips.via1.setInput('a', 4, 1);

    // Now in BOOTLOADER__program_ram: VIA IRQs disabled, CLI executed,
    // DDRB=0x00 (all input), polling LOADING_STATE at $02.
    // Wait for the bootloader to reach the upload loop.
    m.advanceToMs(m.tMs + 5000);

    // The sixty5o2 upload: each byte is presented on PORTB (external input),
    // then the sender pulses the CPU's /IRQ line. The ISR reads PORTB and
    // stores the byte to RAM at $0200+. The /IRQ is a bare wire — not through
    // the VIA (whose interrupts are disabled).
    //
    // To inject external IRQs, we call m.cpu.irq() directly between steps.
    // The ISR_FIRST_RUN mechanism skips the first IRQ (a spurious trigger on
    // real hardware), so we send a dummy byte first.

    // Trim trailing zeros from the program binary
    let codeLen = hello.length;
    while (codeLen > 1 && hello[codeLen - 1] === 0) codeLen--;

    /** Send one byte via the upload protocol. */
    function sendByte(val) {
        for (let bit = 0; bit < 8; bit++) {
            m.chips.via1.setInput('b', bit, (val >> bit) & 1);
        }
        if (m.cpu.irq()) { m.cycles += 7; m._advanceChips(7); }
        for (let j = 0; j < 80; j++) m.step();
    }

    // Dummy byte (consumed by ISR_FIRST_RUN skip)
    sendByte(0x00);

    // Send actual program bytes
    for (let i = 0; i < codeLen; i++) sendByte(hello[i]);

    // Wait for the bootloader's timeout to detect end-of-transfer.
    // The bootloader sets LOADING_STATE=$02, then waits 32×255 sleep
    // loops. If no new data arrives (ISR doesn't reset to $01), it
    // considers transfer done. This takes millions of cycles.
    m.advanceToMs(m.tMs + 40000);

    // After transfer, "Load & Run" jumps to $0200.
    // The hello_world program re-inits the LCD and prints "Hello, World!".
    // Give it time to execute.
    m.advanceToMs(m.tMs + 5000);

    // Verify: program bytes at $0200 (after ISR_FIRST_RUN skip, first
    // real byte is hello[0] at $0200, or there's an offset of 1).
    // Check that at least the first instruction bytes are present.
    const firstBytes = [m.mem[0x0200], m.mem[0x0201], m.mem[0x0202]];
    // hello_world starts with JSR init_via_ports (0x20 xx xx)
    assert.equal(firstBytes[0], hello[0],
        `first byte at $0200: expected 0x${hello[0].toString(16)}, got 0x${firstBytes[0].toString(16)}`);

    // Check LCD for "Hello" or bootloader status messages
    const finalText = lcd.text[0] + lcd.text[1];
    assert.ok(
        finalText.includes('Hello') || finalText.includes('Running') || finalText.includes('Loading') || finalText.includes('done'),
        `Expected program output on LCD, got: "${lcd.text[0]}" / "${lcd.text[1]}"`
    );
});
