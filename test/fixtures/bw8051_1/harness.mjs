// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveAncestor} from '../../helpers/sibling-checkout.mjs';
import {createEmu8051Adapter} from '../../../src/emu8051-adapter.js';

export const root = path.dirname(fileURLToPath(import.meta.url));
export const manifest = JSON.parse(readFileSync(path.join(root, 'images/manifest.json'), 'utf8'));
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const require = createRequire(import.meta.url);
const candidates = [process.env.EMU8051_JS,
    resolveAncestor(root, ['emu8051-stc', 'build', 'emu8051.js'])].filter(Boolean);
const modulePath = candidates.find(p => existsSync(p));
export const missingEmulator = modulePath ? false
    : 'No emu8051 WASM: build sibling emu8051-stc or set EMU8051_JS (a skip is not qualification).';
if (process.env.BW8051_REQUIRE_EMULATOR === '1' && missingEmulator) throw Error(missingEmulator);

export function firmware(id) {
    const program = manifest.programs.find(p => p.id === id);
    assert.ok(program, `missing firmware ${id}`);
    const hex = readFileSync(path.join(root, 'images', program.image), 'utf8');
    assert.equal(sha256(hex), program.sha256, `${id}: firmware hash changed`);
    return {program, hex};
}

export async function machine(id, board = null) {
    if (!modulePath) throw Error(missingEmulator);
    const create = require(modulePath);
    const wasm = await create();
    const adapter = createEmu8051Adapter(wasm, {
        part: 'stc15w408as', fosc: 11_059_200, vcc: 5,
        ports: [0, 1, 2, 3], mode: 'push',
    });
    const {program, hex} = firmware(id);
    adapter.loadHex(hex);
    if (board) {
        adapter.attachBoard(board);
        assert.equal(adapter.getStats().mode, 'push', 'these timing fixtures require every pin edge');
    }
    return {wasm, adapter, program,
        readByte(symbol) {
            assert.ok(Number.isInteger(program.symbols[symbol]), `missing map symbol ${symbol}`);
            return wasm._emu_get_iram(program.symbols[symbol]);
        },
        readBytes(symbol, count) {
            assert.ok(Number.isInteger(program.symbols[symbol]), `missing map symbol ${symbol}`);
            return Array.from({length: count}, (_, i) => wasm._emu_get_iram(program.symbols[symbol] + i));
        },
    };
}

/** A declared ideal external-pin fixture, not a replacement circuit solver. */
export class PinProbe {
    timeNs = 0n;
    pins = new Map();
    events = [];
    analog = new Map();
    advanceTo(t) { this.timeNs = t; }
    setPin(pin, mode, driveHigh) {
        const before = this.pins.get(pin);
        if (!before || before.mode !== mode || before.driveHigh !== driveHigh) {
            this.events.push({pin, mode, driveHigh, timeNs: this.timeNs});
        }
        this.pins.set(pin, {mode, driveHigh});
    }
    readPin(pin) {
        const state = this.pins.get(pin);
        return state && state.mode !== 'input' ? state.driveHigh : true;
    }
    readAnalog(pin) { return this.analog.get(pin) ?? (this.readPin(pin) ? 5 : 0); }
}
