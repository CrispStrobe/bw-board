// Game controllers on the 80286: DIGITAL sticks/buttons through the 8255 (the
// same widget->pin path the switches use) and ANALOG sticks through the ADC0809
// (a widget axis -> a voltage -> an 8-bit reading at port 300h). Both are driven
// by controller-panel widgets — "control per widgets" for gamepads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, GAMEPAD80286 } from '../src/i8086-machine.js';
import { ControllerPanel, axisToVolts } from '../src/controller.js';

test('GAMEPAD80286 is a 286 with an 8255 (digital) and an ADC0809 (analog)', () => {
    const m = new I8086Machine(GAMEPAD80286);
    assert.equal(m.variant, '80286');
    assert.equal(m.cpu._is286, true);
    assert.deepEqual(Object.keys(m.chips).sort(), ['adc1', 'ppi1']);
});

test('an ANALOG stick drives the 286 through the ADC0809 (widget axis -> voltage -> port 300h)', () => {
    const m = new I8086Machine(GAMEPAD80286);
    const adc = m.chips.adc1;
    const panel = new ControllerPanel();
    panel.addWidget('lx', 'slider', { min: -100, max: 100, value: 0 });

    // The binding a host installs: widget axis -> ADC channel 0. A program then
    // OUTs to start the conversion and INs the 8-bit position.
    const readAxis = () => {
        adc.setChannel(0, axisToVolts(panel.getValue('lx'), { min: -100, max: 100, vref: adc.vref }));
        m._out(0x300, 0);                 // start a conversion on channel 0
        adc.advance(adc.convCycles);      // let the converter finish
        return m._in(0x300) & 0xff;       // the position the 286 reads
    };

    panel.setSliderInput('lx', 0);    const centre = readAxis();
    panel.setSliderInput('lx', 100);  const right = readAxis();
    panel.setSliderInput('lx', -100); const left = readAxis();
    assert.ok(Math.abs(centre - 127) <= 2, `stick at rest reads mid-scale (~127, got ${centre})`);
    assert.ok(right >= 254, `full right reads full-scale (~255, got ${right})`);
    assert.equal(left, 0, 'full left reads 0');
    assert.ok(right > centre && centre > left, 'the 286-visible position tracks the stick');
});

test('a DIGITAL d-pad reaches the 286 through the 8255 (control per widgets)', () => {
    const m = new I8086Machine(GAMEPAD80286);
    const ppi = m.chips.ppi1;
    const panel = new ControllerPanel();
    panel.addWidget('pad', 'dpad');
    // d-pad bitmask (up=1,down=2,left=4,right=8) onto port C's low nibble — the
    // pins a program reads at port 62h.
    const drive = () => { const v = panel.getValue('pad'); for (let b = 0; b < 4; b++) ppi.setInput('c', b, (v >> b) & 1); };

    panel.setDpadInput('pad', 'right', true);
    drive();
    assert.equal(ppi.read(2) & 0x08, 0x08, 'RIGHT shows on port C bit 3');
    assert.equal(ppi.read(2) & 0x05, 0, 'UP/LEFT not pressed');

    panel.setDpadInput('pad', 'up', true);
    drive();
    assert.equal(ppi.read(2) & 0x09, 0x09, 'UP+RIGHT both show once up is also pressed');
});

test('axisToVolts maps a stick range onto 0..vref with centre at vref/2', () => {
    assert.equal(axisToVolts(-100, { min: -100, max: 100, vref: 5 }), 0);
    assert.equal(axisToVolts(0, { min: -100, max: 100, vref: 5 }), 2.5);
    assert.equal(axisToVolts(100, { min: -100, max: 100, vref: 5 }), 5);
    assert.equal(axisToVolts(999, { min: -100, max: 100, vref: 5 }), 5, 'clamped to vref');
});
