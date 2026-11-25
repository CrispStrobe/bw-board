import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';

function bench (kind, common) {
  const digits = kind === 'seven_segment' ? ['common']
    : Array.from({length: kind === 'seven_seg_3' ? 3 : 4}, (_, i) => `com${i}`);
  const board = new BoardImpl(5);
  const parts = [
    {id: 'U', kind: 'mcu', params: {}, terminals: ['P1.0', ...digits.map((_, i) => `P2.${i}`)]},
    {id: 'D', kind, params: common ? {common} : {}, terminals: ['a', ...digits]},
    {id: 'R', kind: 'resistor', params: {ohms: 220}, terminals: ['a', 'b']},
    {id: 'V', kind: 'vcc', params: {}, terminals: ['vcc']},
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']}
  ];
  const net = (id, ...pairs) => ({id, terminals: pairs.map(([part, terminal]) => ({part, terminal}))});
  board.setNetlist(parts, [
    net('drive', ['U', 'P1.0'], ['R', 'a']),
    net('a', ['R', 'b'], ['D', 'a']),
    net('v', ['V', 'vcc']), net('g', ['G', 'gnd']),
    ...digits.map((name, i) => net(name, ['U', `P2.${i}`], ['D', name]))
  ]);
  board.setPower(true);
  return {board, digits, led: i => kind === 'seven_segment' ? 'D_a' : `D_d${i}_a`};
}

for (const kind of ['seven_segment', 'seven_seg_3', 'seven_seg_4']) {
  for (const common of [undefined, 'anode']) {
    test(`${kind} ${common || 'default cathode'} conducts only in the physical forward direction`, () => {
      const {board, digits, led} = bench(kind, common);
      const anode = common === 'anode';
      board.setPin('P1.0', 'pushpull', !anode);
      digits.forEach((_, i) => board.setPin(`P2.${i}`, 'pushpull', i === 0 ? anode : !anode));
      for (let i = 1; i <= 40; i++) board.advanceTo(BigInt(i) * 500000n);
      assert.ok(board.ledBrightness(led(0)) > 0.5, 'selected forward-biased die lights');
      for (let i = 1; i < digits.length; i++) {
        assert.ok(board.ledBrightness(led(i)) < 0.05, 'unselected digit stays dark');
      }
      board.setPin('P1.0', 'pushpull', anode);
      board.setPin('P2.0', 'pushpull', !anode);
      for (let i = 41; i <= 240; i++) board.advanceTo(BigInt(i) * 500000n);
      assert.ok(board.ledBrightness(led(0)) < 0.05, 'reversing both terminals extinguishes the die');
    });
  }
}
