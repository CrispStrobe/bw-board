// The F0 tier's cap vocabulary grows ADC + PWM — unit-level, no
// toolchain: registers are poked exactly as the generated C pokes them
// (the offsets and sequences below mirror sb3-creator's adc_read and
// pwm_set), and the observable is boundary A — published pin edges and
// the returned conversion. The gcc chain test in sb3-creator proves the
// same registers reached from blocks.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Stm32Rcc, Stm32Tim3, Stm32Adc } from '../src/stm32f0-board.js';

const machineStub = { setIrq () {} };

const rccOn = () => {
    const rcc = new Stm32Rcc();
    rcc.write(0x1c, 1 << 1);              // TIM3
    rcc.write(0x18, (1 << 14) | (1 << 9)); // USART1 + ADC
    return rcc;
};

describe('Stm32Adc', () => {
    it('converts the board voltage the way the generated adc_read reads it', () => {
        const rcc = rccOn();
        const volts = { 3: 1.65 };
        const adc = new Stm32Adc({ rcc, onAnalogRead: (ch) => volts[ch] ?? 0 });
        // the generated sequence: ADEN, wait ADRDY, CHSELR, ADSTART, wait EOC, DR
        adc.write(0x08, 1);
        assert.equal(adc.read(0x00) & 1, 1, 'ADRDY after ADEN');
        adc.write(0x28, 1 << 3);
        adc.write(0x08, 1 | (1 << 2));
        assert.equal((adc.read(0x00) >> 2) & 1, 1, 'EOC set');
        const dr = adc.read(0x40);
        assert.equal(dr, Math.round((1.65 / 3.3) * 4095), 'mid-rail is mid-scale');
        assert.equal((adc.read(0x00) >> 2) & 1, 0, 'reading DR clears EOC');
    });

    it('clamps out-of-range voltages instead of wrapping the counts', () => {
        const adc = new Stm32Adc({ rcc: rccOn(), onAnalogRead: () => 9.9 });
        adc.write(0x08, 1);
        adc.write(0x28, 1);
        adc.write(0x08, 1 | (1 << 2));
        assert.equal(adc.read(0x40), 4095, 'over-vref pegs full scale');
    });

    it('with the RCC clock off, nothing works and the ledger says so', () => {
        const rcc = new Stm32Rcc();               // no enables at all
        const adc = new Stm32Adc({ rcc, onAnalogRead: () => 3.3 });
        adc.write(0x08, 1 | (1 << 2));
        assert.equal(adc.read(0x40), 0, 'no conversion happened');
        assert.ok(rcc.gatedAccesses.some((g) => /ADC/.test(g)), 'the gate is named');
    });
});

describe('Stm32Tim3 PWM', () => {
    // The generated pwm_set at 30% on PA6: CCMR1 OC1M=PWM1, CCER CC1E,
    // CCR1=300 against the tick's ARR=999 at a 1 µs count.
    const pwmTimer = (ccr, pins) => {
        const tim = new Stm32Tim3({
            rcc: rccOn(), clockHz: 48_000_000,
            onPinChange: (pin, mode, high) => pins.push({ pin, mode, high }),
        });
        tim.write(0x28, 47);           // PSC: 1 MHz count
        tim.write(0x2c, 999);          // ARR: 1 kHz frame
        tim.write(0x18, 0x0060);       // CCMR1 OC1M = PWM mode 1
        tim.write(0x20, 1);            // CCER CC1E
        tim.write(0x34, ccr);          // CCR1
        tim.write(0x00, 1);            // CEN
        return tim;
    };

    it('a 30% duty publishes edges whose widths ARE 30/70 of the frame', () => {
        const pins = [];
        const tim = pwmTimer(300, pins);
        tim.advanceNs(3_000_000, machineStub); // three frames
        const edges = pins.filter((p) => p.pin === 'PA6');
        assert.ok(edges.length >= 5, `edges published (${edges.length})`);
        // level alternates; the pattern is high(at wrap) ... low(at CCR)
        for (let i = 1; i < edges.length; i++) {
            assert.notEqual(edges[i].high, edges[i - 1].high, 'edges alternate');
            assert.equal(edges[i].mode, 'pushpull');
        }
    });

    it('CCR=0 is constant low and CCR=1000 constant high — no special case', () => {
        for (const [ccr, level] of [[0, false], [1000, true]]) {
            const pins = [];
            const tim = pwmTimer(ccr, pins);
            tim.advanceNs(2_500_000, machineStub);
            const edges = pins.filter((p) => p.pin === 'PA6');
            assert.ok(edges.length >= 1, `the initial level publishes (ccr=${ccr})`);
            for (const e of edges.slice(1)) {
                assert.equal(e.high, level, `ccr=${ccr} never leaves ${level}`);
            }
        }
    });

    it('nextWakeNs stops a park at the compare edge, not just the wrap', () => {
        const pins = [];
        const tim = pwmTimer(300, pins);
        // fresh frame: cnt=0, next compare edge at 300 µs, wrap at 1000 µs
        const wake = tim.nextWakeNs();
        assert.ok(wake <= 300_000, `horizon reaches the CCR edge (${wake} ns)`);
    });

    it('a mode that is not PWM1 publishes nothing — no invented output', () => {
        const pins = [];
        const tim = new Stm32Tim3({
            rcc: rccOn(), clockHz: 48_000_000,
            onPinChange: (pin, mode, high) => pins.push({ pin, mode, high }),
        });
        tim.write(0x28, 47); tim.write(0x2c, 999);
        tim.write(0x20, 1);            // CC1E but OC1M stays frozen (0)
        tim.write(0x34, 500);
        tim.write(0x00, 1);
        tim.advanceNs(2_000_000, machineStub);
        assert.equal(pins.length, 0, 'frozen mode drives nothing');
    });
});
