// Part selection through the emu8051 adapter — the ABI contract's client
// side. An STC15 program on the STC12 model loses P5 silently (the
// RBS15667 console's buzzer), so the adapter must (a) call _emu_set_part
// with the contract id when the wasm exports it, and (b) refuse LOUDLY
// (a warn, not silence) when the build cannot select the requested part.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';

function stubWasm(withSetPart) {
  const calls = [];
  const w = {
    _emu_init: (m) => calls.push(['init', m]),
    _emu_set_fosc: (f) => calls.push(['fosc', f]),
    _emu_set_vcc: (v) => calls.push(['vcc', v]),
    _emu_set_pin_input: () => {},
    _emu_set_adc_voltage: () => {},
    _emu_set_sfr: () => {},
    _emu_get_code: () => 0,
    calls,
  };
  if (withSetPart) w._emu_set_part = (id) => calls.push(['part', id]);
  return w;
}

describe('emu8051 adapter part selection', () => {
  it('stc15 maps to part id 1, called between init and fosc', () => {
    const w = stubWasm(true);
    createEmu8051Adapter(w, { part: 'stc15f2k60s2' });
    const names = w.calls.map(c => c[0]);
    assert.deepEqual(w.calls.find(c => c[0] === 'part'), ['part', 1]);
    assert.ok(names.indexOf('init') < names.indexOf('part'), 'part after init');
    assert.ok(names.indexOf('part') < names.indexOf('fosc'), 'part before fosc');
  });

  it('stc12 (and default) map to id 0; stc89 to id 2', () => {
    const a = stubWasm(true);
    createEmu8051Adapter(a, {});
    assert.deepEqual(a.calls.find(c => c[0] === 'part'), ['part', 0]);
    const b = stubWasm(true);
    createEmu8051Adapter(b, { part: 'STC89C52RC' });
    assert.deepEqual(b.calls.find(c => c[0] === 'part'), ['part', 2]);
  });

  it('a build without _emu_set_part warns for non-default parts and stays quiet for the default', () => {
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      createEmu8051Adapter(stubWasm(false), { part: 'stc15f2k60s2' });
      assert.equal(warns.length, 1, 'one warning for the un-selectable part');
      assert.match(warns[0], /no _emu_set_part/);
      assert.match(warns[0], /P5/, 'the warning names what breaks');
      createEmu8051Adapter(stubWasm(false), {});
      assert.equal(warns.length, 1, 'no warning when the default part is fine');
    } finally {
      console.warn = orig;
    }
  });
});
