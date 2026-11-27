// SPDX-License-Identifier: MIT
// Deterministic teaching benches. Coordinates are hints for circuit editors.
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pin = (part, terminal) => ({part, terminal});
const part = (id, kind, terminals, params = {}, x = 0, y = 0) => ({id, kind, terminals, params, x, y});
const net = (id, ...terminals) => ({id, terminals});
const board = {device: 'STC15W408AS', fosc: 11059200, vcc: 5};
const withWires = circuit => ({...circuit, wires: circuit.nets.flatMap(n =>
    n.terminals.slice(1).map((to, index) => ({
        id: `${n.id}-${index + 1}`, netId: n.id, from: n.terminals[0], to,
    })))});

export function hourglassCircuit() {
    return withWires({
        schema: 1, title: 'Hourglass stage 2: one LED, Timer0 and high impedance',
        description: 'Unmodified upstream stage-2 firmware on the STC15W408AS compatibility profile. L1 uses the original P3.0 anode/P1.0 cathode polarity; L2 checks an unselected line. The teaching bench adds 1 kΩ current-limiting resistors. This is not an exact STC15W201S/W204S package model.',
        vcc: 5, board, firmware: '../images/hourglass-stage2.hex',
        parts: [
            part('MCU', 'mcu', ['P1.0', 'P3.0', 'P3.1'], {device: board.device}, 100, 180),
            part('R1', 'resistor', ['a', 'b'], {ohms: 1000}, 330, 100),
            part('L1', 'led', ['anode', 'cathode'], {color: 'red'}, 480, 100),
            part('R2', 'resistor', ['a', 'b'], {ohms: 1000}, 330, 240),
            part('L2', 'led', ['anode', 'cathode'], {color: 'red'}, 480, 240),
        ],
        nets: [
            net('source1', pin('MCU', 'P3.0'), pin('R1', 'a')),
            net('led1', pin('R1', 'b'), pin('L1', 'anode')),
            net('source2', pin('MCU', 'P3.1'), pin('R2', 'a')),
            net('led2', pin('R2', 'b'), pin('L2', 'anode')),
            net('sink', pin('MCU', 'P1.0'), pin('L1', 'cathode'), pin('L2', 'cathode')),
        ],
    });
}

export function clockCircuit() {
    const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
    const mcuPins = [0, 1, 2, 3].flatMap(port => Array.from({length: 8}, (_, bit) => `P${port}.${bit}`));
    const parts = [
        part('VCC', 'vcc', ['vcc'], {}, 70, 60),
        part('GND', 'gnd', ['gnd'], {}, 70, 560),
        part('MCU', 'mcu', mcuPins, {device: board.device}, 140, 310),
        part('RTC', 'ds1302', ['vcc', 'gnd', 'ce', 'sclk', 'io', 'x1', 'x2', 'vcc1'], {}, 390, 460),
        part('Y1', 'crystal', ['a', 'b'], {frequency: 32768}, 570, 520),
        part('BAT', 'battery', ['pos', 'neg'], {volts: 3}, 650, 500),
        part('LIGHT', 'potentiometer', ['a', 'b', 'wiper'], {ohms: 10000, value: 0.5, label: 'Light input'}, 770, 400),
        part('TEMP', 'potentiometer', ['a', 'b', 'wiper'], {ohms: 10000, value: 0.5, label: 'Temperature input'}, 900, 400),
        part('S1', 'button', ['a', 'b'], {}, 1050, 400),
        part('S2', 'button', ['a', 'b'], {}, 1050, 500),
        part('BZ', 'buzzer', ['a', 'b'], {}, 1150, 460),
    ];
    const supply = net('vcc', pin('VCC', 'vcc'), pin('RTC', 'vcc'), pin('LIGHT', 'a'), pin('TEMP', 'a'), pin('BZ', 'a'));
    const ground = net('gnd', pin('GND', 'gnd'), pin('RTC', 'gnd'), pin('BAT', 'neg'), pin('LIGHT', 'b'), pin('TEMP', 'b'), pin('S1', 'b'), pin('S2', 'b'));
    const nets = [supply, ground,
        net('rtc-ce', pin('MCU', 'P1.0'), pin('RTC', 'ce')),
        net('rtc-io', pin('MCU', 'P1.1'), pin('RTC', 'io')),
        net('rtc-clock', pin('MCU', 'P1.2'), pin('RTC', 'sclk')),
        net('crystal1', pin('RTC', 'x1'), pin('Y1', 'a')),
        net('crystal2', pin('RTC', 'x2'), pin('Y1', 'b')),
        net('battery', pin('RTC', 'vcc1'), pin('BAT', 'pos')),
        net('light', pin('MCU', 'P1.6'), pin('LIGHT', 'wiper')),
        net('temp', pin('MCU', 'P1.7'), pin('TEMP', 'wiper')),
        net('button1', pin('MCU', 'P3.1'), pin('S1', 'a')),
        net('button2', pin('MCU', 'P3.0'), pin('S2', 'a')),
        net('buzzer', pin('MCU', 'P1.5'), pin('BZ', 'b')),
    ];
    const buses = [];
    for (let bit = 0; bit < 8; bit++) {
        const id = `RS${bit}`;
        parts.push(part(id, 'resistor', ['a', 'b'], {ohms: 330}, 360 + 95 * bit, 320));
        nets.push(net(`segment-pin${bit}`, pin('MCU', `P2.${bit}`), pin(id, 'a')));
        const bus = net(`segment${bit}`, pin(id, 'b'));
        nets.push(bus); buses.push(bus);
    }
    for (let digit = 0; digit < 4; digit++) {
        const id = `D${digit}`, q = `Q${digit}`, r = `RB${digit}`;
        parts.push(part(id, 'seven_segment', [...segments, 'common'], {common: 'anode'}, 460 + 180 * digit, 120));
        parts.push(part(q, 'pnp', ['base', 'collector', 'emitter'], {beta: 100, vbe: 0.7}, 440 + 180 * digit, 220));
        parts.push(part(r, 'resistor', ['a', 'b'], {ohms: 4700}, 440 + 180 * digit, 275));
        supply.terminals.push(pin(q, 'emitter'));
        nets.push(net(`digit-select${digit}`, pin('MCU', `P3.${digit + 2}`), pin(r, 'a')));
        nets.push(net(`digit-base${digit}`, pin(r, 'b'), pin(q, 'base')));
        nets.push(net(`digit-anode${digit}`, pin(q, 'collector'), pin(id, 'common')));
        // The kit's third package is rotated: abc and def exchange positions.
        const wiring = digit === 2 ? [3, 4, 5, 0, 1, 2, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 7];
        segments.forEach((segment, i) => buses[wiring[i]].terminals.push(pin(id, segment)));
    }
    return withWires({schema: 1, title: 'STC15 DIY clock: four digits and DS1302',
        description: 'MOD4=1, NMEA=0 firmware with recorded build fixes. Common-anode digits retain active-low segment and PNP digit selection, including the rotated third digit. Adjustable voltage dividers stand in for light and temperature sensors. IAP persistence and NMEA are not qualified by this bench.',
        vcc: 5, board, firmware: '../images/clock-mod4.hex', parts, nets});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const dir = path.join(root, 'circuits');
    mkdirSync(dir, {recursive: true});
    writeFileSync(path.join(dir, 'hourglass-stage2.json'), JSON.stringify(hourglassCircuit(), null, 2) + '\n');
    writeFileSync(path.join(dir, 'clock-mod4.json'), JSON.stringify(clockCircuit(), null, 2) + '\n');
}
