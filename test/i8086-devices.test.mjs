// The 8254 PIT, 8259 PIC and 8251 USART as registered machine devices: that
// they construct from a config, answer on the port bus (including the A1
// "even addresses" stride an 8086's 16-bit bus gives a byte-wide chip), that
// the PIC actually delivers an interrupt to the core, and an end-to-end run
// of the SIrfanH MIT 8086/8251 demo's serial protocol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';

/** Wrap a code image as a 32K ROM whose last page holds the reset far-jump. */
function rom(code, at = 0) {
    const img = new Uint8Array(0x8000);
    img.set(code, at);
    img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // jmp F800:0000
    return img;
}

function machine(config, hooks) {
    return new I8086Machine(config, hooks);
}

function interruptMachine(hooks = {}) {
    const m = machine({
        clockHz: 5_000_000,
        regions: [{kind: 'ram', start: 0, end: 0xfffff}],
        chips: [{kind: 'pic', name: 'pic1', at: 0x20}],
    }, hooks);
    m.cpu.cs = 0;
    m.cpu.ip = 0x100;
    m.cpu.ss = 0;
    m.cpu.sp = 0x800;
    m.mem.set([0x90, 0x90, 0x90], 0x100);
    // NMI -> 0000:0200, PIC IRQ0 -> 0000:0300; both handlers begin NOP.
    m.mem[0x08] = 0x00; m.mem[0x09] = 0x02;
    m.mem[0x20] = 0x00; m.mem[0x21] = 0x03;
    m.mem[0x200] = 0x90;
    m.mem[0x300] = 0x90;
    m._out(0x20, 0x13);            // ICW1: single, ICW4 follows
    m._out(0x21, 0x08);            // ICW2: vector base 8
    m._out(0x21, 0x01);            // ICW4: 8086 mode
    m._out(0x21, 0xfe);            // unmask IRQ0 only
    return m;
}

test('an idle boundary skips interrupt arbitration with or without an inactive PIC', () => {
    for (const m of [
        machine({clockHz: 5_000_000,
            regions: [{kind: 'ram', start: 0, end: 0xfffff}], chips: []}),
        interruptMachine(),
    ]) {
        m.cpu.cs = 0; m.cpu.ip = 0x100; m.mem[0x100] = 0x90;
        const service = m._serviceInterrupts.bind(m);
        let calls = 0;
        m._serviceInterrupts = () => { calls++; return service(); };
        m.step();
        assert.equal(calls, 0);
        assert.equal(m.cpu.ip, 0x101);
    }
});

test('a pending NMI ignores IF and is serviced before the handler instruction', () => {
    const order = [];
    const m = interruptMachine({onInterrupt: event => order.push(event.source)});
    const read = m.cpu.read;
    m.cpu.read = address => {
        if (address === 0x200) order.push('handler-fetch');
        return read(address);
    };
    m.cpu.flags &= ~0x0200;
    m.nmi();
    m.step();
    assert.equal(m._nmiPending, false);
    assert.equal(m.cpu.ip, 0x201, 'the first vector-2 instruction retired in the same step');
    assert.deepEqual(order, ['nmi', 'handler-fetch'],
        'the accepted-interrupt hook precedes execution in its handler');
});

test('an active PIC waits for IF, then acknowledges exactly once before executing its handler', () => {
    const m = interruptMachine();
    const service = m._serviceInterrupts.bind(m);
    let serviceCalls = 0;
    m._serviceInterrupts = () => { serviceCalls++; return service(); };
    const acknowledge = m.chips.pic1.acknowledge.bind(m.chips.pic1);
    let acknowledgements = 0;
    m.chips.pic1.acknowledge = () => { acknowledgements++; return acknowledge(); };
    m.chips.pic1.setIRQ(0, 1);
    m.cpu.flags &= ~0x0200;

    m.step();
    assert.equal(m.cpu.ip, 0x101, 'IF-clear execution continues outside the handler');
    assert.equal(serviceCalls, 1, 'the active line still reaches the CPU eligibility authority');
    assert.equal(acknowledgements, 0);
    assert.ok(m.chips.pic1.intActive, 'the refused request remains pending');

    m.cpu.flags |= 0x0200;
    m.step();
    assert.equal(serviceCalls, 2);
    assert.equal(acknowledgements, 1);
    assert.equal(m.cpu.ip, 0x301, 'IRQ0 was acknowledged and its first instruction retired');
    assert.equal(m.chips.pic1.irr & 1, 0, 'acknowledge removed IRQ0 from IRR');
    assert.equal(m.chips.pic1.isr & 1, 1, 'IRQ0 entered the in-service register');
});

test('a blocked halted CPU advances time, while an eligible IRQ wakes it at the same boundary', () => {
    const m = interruptMachine();
    m.cpu.halted = true;
    m.cpu.flags &= ~0x0200;
    m.chips.pic1.setIRQ(0, 1);
    const before = m.cycles;
    m.step();
    assert.equal(m.cpu.halted, true);
    assert.equal(m.cpu.ip, 0x100);
    assert.ok(m.cycles > before, 'an IF-blocked HLT still advances machine time');
    assert.ok(m.chips.pic1.intActive);

    m.cpu.flags |= 0x0200;
    m.step();
    assert.equal(m.cpu.halted, false, 'interrupt entry wakes HLT before the halt-time path');
    assert.equal(m.cpu.ip, 0x301);
    assert.equal(m.chips.pic1.irr & 1, 0);
});

test('simultaneous NMI and PIC boundaries preserve NMI priority and the PIC request', () => {
    const sources = [];
    const m = interruptMachine({onInterrupt: event => sources.push(event.source)});
    m.cpu.flags |= 0x0200;
    m.chips.pic1.setIRQ(0, 1);
    m.nmi();

    m.step();
    assert.equal(m.cpu.ip, 0x201, 'NMI handler executes first');
    assert.deepEqual(sources, ['nmi']);
    assert.ok(m.chips.pic1.intActive, 'the simultaneous PIC request was not acknowledged or lost');
    assert.equal(m.chips.pic1.isr & 1, 0);

    m.cpu.flags |= 0x0200;         // stand in for the NMI handler's IRET
    m.step();
    assert.equal(m.cpu.ip, 0x301);
    assert.deepEqual(sources, ['nmi', 'irq']);
});

// ---------------------------------------------------------------------------
test('the PIT, PIC and USART register and answer on the port bus', () => {
    const out = [];
    const m = machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [
            { kind: 'pit', name: 'pit1', at: 0x40 },
            { kind: 'pic', name: 'pic1', at: 0x20 },
            { kind: 'usart8251', name: 'usart1', at: 0x60 },
        ],
    }, { onSerial: (b) => out.push(b) });

    assert.ok(m.chips.pit1 && m.chips.pic1 && m.chips.usart1, 'all three constructed');

    // PIT: program counter 0, read the counting element back.
    m._out(0x43, 0x30);            // counter 0, rw=3, mode 0
    m._out(0x40, 100); m._out(0x40, 0);
    assert.equal(m.chips.pit1.counters[0].ce, 100);

    // PIC: run the init sequence, check the vector base landed.
    m._out(0x20, 0x13);            // ICW1
    m._out(0x21, 0x08);            // ICW2 (vector base)
    m._out(0x21, 0x01);            // ICW4
    assert.equal(m.chips.pic1.vectorBase, 0x08);

    // USART: init dance, then a transmit reaches the serial hook.
    m._out(0x61, 0x4e); m._out(0x61, 0x37);   // mode, command (TxEN)
    m._out(0x60, 0x41);
    assert.deepEqual(out, [0x41]);
});

test('unknown chip kind and an oversize register still validate', () => {
    assert.throws(() => machine({
        clockHz: 1, regions: [], chips: [{ kind: 'pit', name: 'p', at: 0, span: 2 }],
    }), /span 2 smaller than its 4 registers/);
});

// ---------------------------------------------------------------------------
test('stride 2 puts a byte-wide chip on even addresses (C/D on A1)', () => {
    const out = [];
    const m = machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [{ kind: 'usart8251', name: 'usart1', at: 0x0208, stride: 2 }],
    }, { onSerial: (b) => out.push(b) });

    // Control/status is at 0x020A (base+2), data at 0x0208 (base). The odd
    // address 0x0209 mirrors the data register (A0 unwired).
    m._out(0x020a, 0x4e);          // mode -> control register
    m._out(0x020a, 0x37);          // command (TxEN) -> control register
    m._out(0x0208, 0x48);          // 'H' -> data register
    m._out(0x0209, 0x69);          // 'i' -> data register (mirror)
    assert.deepEqual(out, [0x48, 0x69]);
    // Status reads from the control address.
    assert.equal(m._in(0x020a) & 0x01, 0x01, 'TxRDY on the control/status port');
});

// ---------------------------------------------------------------------------
test('a PIT tick reaches the PIC and the core takes the interrupt', () => {
    // ROM: set up a stack, DS=0, enable interrupts, spin.
    const romCode = [
        0xb8, 0x00, 0x00,   // mov ax, 0
        0x8e, 0xd0,         // mov ss, ax
        0x8e, 0xd8,         // mov ds, ax
        0xbc, 0x00, 0x08,   // mov sp, 0800
        0xfb,               // sti
        0xeb, 0xfe,         // jmp $  (spin with IF set)
    ];
    // ISR at 0000:0100: count the interrupt, send EOI, return.
    const isr = [
        0xfe, 0x06, 0x00, 0x02,   // inc byte [0200]
        0xb0, 0x20,               // mov al, 20h
        0xe6, 0x20,               // out 20h, al   (PIC command port -> EOI)
        0xcf,                     // iret
    ];

    const m = machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [
            { kind: 'pic', name: 'pic1', at: 0x20 },
            { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },   // OUT0 -> IRQ0
        ],
    });
    m.loadRom(rom(romCode));
    m.reset();

    // Poke the ISR into RAM and point vector 8 (IRQ0's base) at it.
    m.mem.set(isr, 0x0100);
    m.mem[0x20] = 0x00; m.mem[0x21] = 0x01;   // offset 0x0100
    m.mem[0x22] = 0x00; m.mem[0x23] = 0x00;   // segment 0x0000

    // Program the PIC: base vector 8, IRQ0 unmasked.
    m._out(0x20, 0x13);            // ICW1: single, ICW4
    m._out(0x21, 0x08);            // ICW2: vectors 8..15
    m._out(0x21, 0x01);            // ICW4: 8086 mode
    m._out(0x21, 0xfe);            // OCW1: unmask IRQ0 only

    // Program the PIT: counter 0, mode 0, count 30 -> OUT0 rises after 30 ticks.
    m._out(0x43, 0x30);
    m._out(0x40, 30); m._out(0x40, 0);

    assert.equal(m.mem[0x0200], 0, 'ISR has not run yet');
    for (let i = 0; i < 200 && m.mem[0x0200] === 0; i++) m.step();
    assert.equal(m.mem[0x0200], 1, 'the timer interrupt ran the ISR');
    // Let the ISR finish (the loop stopped mid-handler, right after the inc)
    // so IRET restores flags and no second interrupt is pending.
    for (let i = 0; i < 20; i++) m.step();
    assert.equal(m.mem[0x0200], 1, 'and exactly once — mode 0 does not re-trigger');
    assert.ok(m.cpu.flags & 0x0200, 'IF is set again after IRET');
});

test('a masked IRQ is not delivered', () => {
    const romCode = [
        0xb8, 0x00, 0x00, 0x8e, 0xd0, 0x8e, 0xd8, 0xbc, 0x00, 0x08, 0xfb, 0xeb, 0xfe,
    ];
    const isr = [0xfe, 0x06, 0x00, 0x02, 0xb0, 0x20, 0xe6, 0x20, 0xcf];
    const m = machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [{ kind: 'pic', name: 'pic1', at: 0x20 }, { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 }],
    });
    m.loadRom(rom(romCode));
    m.reset();
    m.mem.set(isr, 0x0100);
    m.mem[0x20] = 0x00; m.mem[0x21] = 0x01;
    m._out(0x20, 0x13); m._out(0x21, 0x08); m._out(0x21, 0x01);
    m._out(0x21, 0xff);            // OCW1: mask EVERYTHING, IRQ0 included
    m._out(0x43, 0x30); m._out(0x40, 30); m._out(0x40, 0);
    for (let i = 0; i < 200; i++) m.step();
    assert.equal(m.mem[0x0200], 0, 'a masked timer interrupt never reaches the CPU');
});

// ---------------------------------------------------------------------------
test('NMI is delivered even with interrupts disabled (IF clear)', () => {
    // ROM sets up a stack and DS but never executes STI, so IF stays clear.
    const romCode = [
        0xb8, 0x00, 0x00, 0x8e, 0xd0, 0x8e, 0xd8, 0xbc, 0x00, 0x08,   // ax=0; ss=ax; ds=ax; sp=0800
        0xeb, 0xfe,                                                    // jmp $
    ];
    const isr = [0xfe, 0x06, 0x10, 0x02, 0xcf];   // inc byte [0210]; iret
    const m = machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [],
    });
    m.loadRom(rom(romCode));
    m.reset();
    m.mem.set(isr, 0x0100);
    m.mem[0x08] = 0x00; m.mem[0x09] = 0x01;   // vector 2 offset -> 0x0100
    m.mem[0x0a] = 0x00; m.mem[0x0b] = 0x00;   // vector 2 segment -> 0x0000

    for (let i = 0; i < 10; i++) m.step();
    assert.equal(m.cpu.flags & 0x0200, 0, 'IF is clear — a maskable INTR could not get in');
    assert.equal(m.mem[0x0210], 0, 'ISR has not run');

    m.nmi();
    for (let i = 0; i < 10; i++) m.step();
    assert.equal(m.mem[0x0210], 1, 'NMI ran the vector-2 handler despite IF being clear');
});

test('NMI takes priority over a pending maskable INTR, and the INTR is not lost', () => {
    const romCode = [0xb8, 0x00, 0x00, 0x8e, 0xd0, 0x8e, 0xd8, 0xbc, 0x00, 0x08, 0xfb, 0xeb, 0xfe];
    const m = machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [{ kind: 'pic', name: 'pic1', at: 0x20 }],
    });
    m.loadRom(rom(romCode));
    m.reset();
    // Vector 2 (NMI) -> 0000:0100, vector 8 (INTR base) -> 0000:0200.
    m.mem[0x08] = 0x00; m.mem[0x09] = 0x01;
    m.mem[0x20] = 0x00; m.mem[0x21] = 0x02;
    m._out(0x20, 0x13); m._out(0x21, 0x08); m._out(0x21, 0x01); m._out(0x21, 0xfe);
    for (let i = 0; i < 12; i++) m.step();     // run init, including STI
    assert.ok(m.cpu.flags & 0x0200, 'IF set by STI');

    m.chips.pic1.setIRQ(0, 1);                 // a maskable interrupt is now pending
    m.nmi();                                   // and an NMI arrives at the same moment
    assert.ok(m.chips.pic1.intActive, 'INTR pending before delivery');

    m._serviceInterrupts();
    assert.equal(m.cpu.cs, 0x0000);
    assert.equal(m.cpu.ip, 0x0100, 'the NMI vector wins, not the INTR vector');
    assert.equal(m._nmiPending, false, 'NMI edge consumed');
    assert.ok(m.chips.pic1.intActive, 'the INTR is still pending — not dropped');
    // NMI cleared IF, so the INTR waits; once IF is restored (as IRET would),
    // the very same INTR is delivered.
    m.cpu.flags |= 0x0200;
    m._serviceInterrupts();
    assert.equal(m.cpu.ip, 0x0200, 'the maskable INTR is taken once IF returns');
});

// ---------------------------------------------------------------------------
// The SIrfanH MIT 8086/8251 demo's serial protocol, hand-assembled and run
// end to end: the exact init dance, the RxRDY/TxRDY poll idioms, and the
// name string transmitted. Ports match the demo — control 0x020A, data
// 0x0208 (C/D on A1, i.e. stride 2).
test('the SIrfanH 8251 demo protocol transmits the name after a trigger byte', () => {
    const code = [
        0xba, 0x0a, 0x02,       // mov dx, 020A       control port
        0xb0, 0x4d, 0xee,       // mov al, 4D ; out   mode (dummy)
        0xb0, 0x40, 0xee,       // mov al, 40 ; out   soft reset
        0xb0, 0x4d, 0xee,       // mov al, 4D ; out   real mode word
        0xb0, 0x15, 0xee,       // mov al, 15 ; out   enable tx+rx
        0x8c, 0xc8, 0x8e, 0xd8, // mov ax, cs ; mov ds, ax
        0xba, 0x0a, 0x02,       // mov dx, 020A       (WAIT_RX at 0x16)
        0xec, 0xa8, 0x02,       // in al, dx ; test al, 02
        0x74, 0xfb,             // jz -5 -> 0x16      spin until RxRDY
        0xba, 0x08, 0x02, 0xec, // mov dx, 0208 ; in al, dx   (discard trigger)
        0xbe, 0x37, 0x00,       // mov si, 0037       offset of NAME
        0xb9, 0x08, 0x00,       // mov cx, 0008
        0xba, 0x0a, 0x02,       // mov dx, 020A       (TXLOOP at 0x25)
        0xec, 0xa8, 0x01,       // in al, dx ; test al, 01
        0x74, 0xfb,             // jz -5 -> 0x28      spin until TxRDY
        0x8a, 0x04,             // mov al, [si]
        0xba, 0x08, 0x02, 0xee, // mov dx, 0208 ; out dx, al
        0x46,                   // inc si
        0xe2, 0xef,             // loop -17 -> 0x25
        0xf4,                   // hlt
        0x53, 0x49, 0x72, 0x66, 0x61, 0x6e, 0x48, 0x20,   // "SIrfanH " at 0x37
    ];
    const out = [];
    const m = machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [{ kind: 'usart8251', name: 'usart1', at: 0x0208, stride: 2 }],
    }, { onSerial: (b) => out.push(b) });

    m.loadRom(rom(code));
    m.reset();

    // Run through init and into the RxRDY spin.
    for (let i = 0; i < 40; i++) m.step();
    assert.equal(m.chips.usart1.txEnabled, true, 'the init dance enabled the transmitter');
    assert.deepEqual(out, [], 'nothing transmitted before the trigger');

    // The terminal sends a byte; the program wakes, reads it, and completes.
    m.serialIn(0x0d);
    for (let i = 0; i < 400 && !m.cpu.halted; i++) m.step();

    assert.ok(m.cpu.halted, 'the program reached HLT');
    assert.equal(String.fromCharCode(...out), 'SIrfanH ',
        'the auto-complete name was transmitted through the real 8086 + 8251');
});
