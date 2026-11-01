/** Real public-factory proof; callers admit exact engine/guest bytes first.
 * The guest owns panel/touch execution; the host observes SRAM and pixels.
 * H1 uses a separate authored Xtensa mux program plus explicit debugger MMIO.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDebugTarget} from '../../src/debug-target-factory.js';
import {BoardImpl} from '../../src/board.js';
import {registerBoardKinds} from '../../src/devices/board-kinds.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function runEsp32S040PublicFactoryProof ({wasm, firmware}) {
  const report = {checks: [], frames: [], h1: []};
  const started = performance.now();
  const check = (name, callback) => { callback(); report.checks.push(name); };
  const bytes4 = value => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value >>> 0, true); return b; };
  const word = (target, at) => {
    const b = target.readMem('sram', at, 4);
    assert.ok(b instanceof Uint8Array && b.length === 4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
  };
  const write = (target, at, value) => assert.equal(target.writeMem('sram', at, bytes4(value)), undefined);
  const rgbaOf565 = value => Array.from(new Uint8ClampedArray([
    (value >>> 11) * 255 / 31, ((value >>> 5) & 63) * 255 / 63, (value & 31) * 255 / 31, 255,
  ]));
  const rgbaAt = (frame, x, y) => Array.from(frame.rgba.subarray((y * 480 + x) * 4, (y * 480 + x) * 4 + 4));
  const until = (target, predicate, description) => {
    target.run();
    for (let n = 0; n < 10_000 && !predicate(); n++) {
      assert.ok(performance.now() - started < 120_000, 'bounded proof wall time');
      const state = target.runFor(10_000);
      assert.ok(state === 'running' || state === 'halted' && predicate(),
        `${description}: ${state}; ${JSON.stringify(target.diagnostics())}`);
    }
    assert.ok(predicate(), `guest did not reach ${description}`);
  };
  const touch = (target, rows) => {
    const response = target.setInputs(rows.map(([channel, value]) => ({component: 'touch', channel, value})));
    assert.equal(response.accepted, true, JSON.stringify(response));
  };
  const close = pair => { try { pair.target.destroy(); } finally { pair.adapter.sim.free(); } };
  let current;
  try {
    current = await createDebugTarget('labwired', {wasm, firmware, labwiredBoardId: 'esp32-4848s040'});
    let uart = '';
    current.adapter.onSerial(byte => { uart += String.fromCharCode(byte); });
    const {target, adapter} = current;
    const result = 0x3fc91800;
    const frameAt = count => {
      // The poll loop overwrites the report buffer with its next no-event read.
      // Stop on the actual guest counter store, through the public debugger's
      // write watchpoint, before sampling its completed report and pixels.
      const handle = target.setBreakpoint({kind:'write',addr:result,len:4});
      assert.equal(typeof handle,'number');
      let halted;
      const unsubscribe = target.onHalt(why => { halted=why; });
      try {
        until(target, () => word(target, result) >= count, `guest frame ${count}`);
        assert.equal(halted?.reason,'watchpoint');
        const frame = target.video();
        assert.ok(frame);
        assert.equal(frame.width, 480); assert.equal(frame.height, 480);
        assert.equal(frame.rgba.length, 480 * 480 * 4);
        report.frames.push({counter: word(target, result), rgbaSha256: sha256(frame.rgba),
          pixel0: rgbaAt(frame, 0, 0), panel: frame.panel, signal: frame.signal,
          gt911: Array.from(target.readMem('sram', result + 8, 9)),
          stoppedAfterCounterStoreAt:halted.pc, timeNs: target.timeNs().toString()});
        return frame;
      } finally { target.clearBreakpoint(handle); unsubscribe(); }
    };
    check('no frame before guest LCD/DMA initialization', () => assert.equal(target.video(), null));
    check('exact discovered typed touch surface', () => assert.deepEqual(adapter.discoverInputs()
      .map(row => [row.peripheral, row.key]), [['touch', 'x'], ['touch', 'y'], ['touch', 'pressed']]));
    const initial = frameAt(1);
    check('guest full frame has independently expected corner colors', () => {
      for (const [x, y, color] of [[0,0,0xf800], [479,0,0x07e0], [0,479,0x001f], [479,479,0xffff]]) {
        assert.deepEqual(rgbaAt(initial, x, y), rgbaOf565(color));
      }
      assert.equal(initial.signal, true);
      assert.equal(initial.panel.framesReceived, 1);
    });
    touch(target, [['x',123], ['y',456], ['pressed',1]]);
    check('GT911 down reaches guest mailbox and causes guest redraw', () => {
      assert.deepEqual(rgbaAt(frameAt(2), 0, 0), rgbaOf565(123));
      assert.equal(word(target, result + 10) & 0xffff, 123);
      assert.equal(word(target, result + 12) & 0xffff, 456);
    });
    check('invalid later touch row is refused before applying the earlier X change', () => {
      const response = target.setInputs([{component:'touch',channel:'x',value:99},
        {component:'touch',channel:'y',value:999}]);
      assert.equal(response.accepted, false);
    });
    touch(target, [['y',42]]);
    check('following Y-only move retains the pre-refusal X in real GT911 guest data', () => {
      assert.deepEqual(rgbaAt(frameAt(3), 0, 0), rgbaOf565(123));
      assert.equal(word(target, result + 10) & 0xffff, 123);
      assert.equal(word(target, result + 12) & 0xffff, 42);
    });
    touch(target, [['x',321], ['y',47]]);
    check('GT911 move redraws the actual X coordinate', () => {
      assert.deepEqual(rgbaAt(frameAt(4), 0, 0), rgbaOf565(321));
      assert.equal(word(target, result + 12) & 0xffff, 47);
    });
    touch(target, [['pressed',0]]);
    check('GT911 release restores the source-owned red pixel', () => {
      assert.deepEqual(rgbaAt(frameAt(5), 0, 0), rgbaOf565(0xf800));
      assert.equal(target.readMem('sram', result + 8, 1)[0], 0x80);
    });
    until(target, () => uart.includes('S040 READY') && uart.includes('S040 TOUCH'), 'actual UART markers');
    report.uartBeforeReset = uart;
    const previousOut = word(target, 0x60004010);
    write(target, 0x60004010, previousOut & ~(1 << 6)); // actual backlight GPIO38
    check('real backlight off is reflected in the target panel state and reported dark pixels', () => {
      const off = target.video(); assert.equal(off.signal, false); assert.equal(off.panel.backlightOn, false);
      assert.deepEqual(rgbaAt(off, 0, 0), [0,0,0,255]);
    });
    write(target, 0x60004010, previousOut);
    check('real backlight on restores the actual panel signal and retained guest pixels', () => {
      assert.equal(target.video().signal,true);
      assert.deepEqual(rgbaAt(target.video(),0,0),rgbaOf565(0xf800));
    });
    firmware.fill(0);
    target.reset(); uart = '';
    check('reset clears frame and GT911 state before guest reruns', () => {
      assert.equal(target.video(), null); assert.equal(word(target, result), 0);
    });
    check('reset uses the private original ELF and redraws all original quadrants', () => {
      const after = frameAt(1);
      assert.equal(sha256(after.rgba), sha256(initial.rgba));
    });
    until(target, () => uart.includes('S040 READY'), 'fresh UART after reset');
    report.uartAfterReset = uart;
    close(current); current = null;

    // Authored Xtensa L32R/L32R/S32I sequences select the documented GPIO
    // function. The real CPU executes these stores after factory attachment.
    const pins = [1, 2, 40, 43, 44];
    const h1Guest = (() => {
      const base = 0x40378000, entry = base + 0x100, pool = [], code = [];
      const insn = value => code.push(value & 255, value >>> 8 & 255, value >>> 16 & 255);
      const load = (reg, value) => {
        if (!pool.includes(value)) pool.push(value);
        const at = base + pool.indexOf(value) * 4;
        const relative = (at - ((entry + code.length + 3) & ~3)) / 4;
        assert.ok(Number.isInteger(relative) && relative < 0);
        insn(1 | (reg << 4) | ((relative & 0xffff) << 8));
      };
      for (const pin of pins) { load(2, 0x60009004 + pin * 4); load(3, 0x1b00); insn(2 | (3 << 4) | (2 << 8) | (6 << 12)); }
      insn(6 | ((-4 & 0x3ffff) << 6));
      const bytes = new Uint8Array(84 + 0x100 + code.length), view = new DataView(bytes.buffer);
      bytes.set([0x7f,0x45,0x4c,0x46,1,1,1]);
      view.setUint16(16,2,true); view.setUint16(18,94,true); view.setUint32(20,1,true);
      view.setUint32(24,entry,true); view.setUint32(28,52,true);
      view.setUint16(40,52,true); view.setUint16(42,32,true); view.setUint16(44,1,true);
      view.setUint32(52,1,true); view.setUint32(56,84,true);
      view.setUint32(60,base,true); view.setUint32(64,base,true);
      view.setUint32(68,bytes.length-84,true); view.setUint32(72,bytes.length-84,true);
      view.setUint32(76,5,true); view.setUint32(80,4,true);
      pool.forEach((value,index) => view.setUint32(84 + index*4,value,true));
      bytes.set(code,84+0x100);
      return bytes;
    })();
    report.h1Guest = {bytes:h1Guest.length,sha256:sha256(h1Guest),source:'authored inline Xtensa GPIO-mux program'};
    registerBoardKinds();
    const board = new BoardImpl(5), terminal = (part, terminal) => ({part, terminal});
    const parts = [{id:'panel',kind:'esp32_4848s040',params:{},terminals:['gnd','gnd2','gpio40','gpio44','gpio2','gpio43','gpio1','5v']},
      {id:'logic',kind:'vcc',params:{volts:3.3},terminals:['vcc']},
      {id:'gnd',kind:'gnd',params:{},terminals:['gnd']}];
    const nets = [
      {id:'supply',terminals:[terminal('panel','5v')]},
      {id:'ground',terminals:[terminal('panel','gnd'),terminal('panel','gnd2'),terminal('gnd','gnd')]},
      {id:'logic',terminals:[terminal('logic','vcc')]},
    ];
    for (const pin of pins) {
      parts.push({id:`R${pin}`,kind:'resistor',params:{ohms:10000},terminals:['a','b']},
        {id:`B${pin}`,kind:'button',params:{},terminals:['a','b']});
      nets.push({id:`net${pin}`,terminals:[terminal('panel',`gpio${pin}`),terminal(`R${pin}`,'a'),terminal(`B${pin}`,'a')]});
      nets[1].terminals.push(terminal(`B${pin}`,'b')); nets[2].terminals.push(terminal(`R${pin}`,'b'));
    }
    board.setNetlist(parts,nets);
    current = await createDebugTarget('labwired',{wasm,firmware:h1Guest,labwiredBoardId:'esp32-4848s040',board,mcuId:'panel'});
    const h = current.target, a = current.adapter;
    const inputBit = pin => (word(h,0x60004000+(pin<32?0x3c:0x40)) >>> (pin%32)) & 1;
    check('H1 assembly contains no hidden button bindings or construction-level injection', () => {
      assert.match(a.systemYaml,/board_io: \[\]/); assert.doesNotMatch(a.systemYaml,/kind: button/);
      assert.equal(h.diagnostics().boardElectrical.state,'pending');
      for (const pin of [40,43,44]) {
        assert.equal(board.pinStates.get(`gpio${pin}`).mode,'input');
        board.setControl(`B${pin}`,1); a.pump();
        assert.equal(inputBit(pin),1,'pending mux must preserve the actual internal pull, despite an external closed contact');
      }
    });
    until(h,() => h.diagnostics().boardElectrical.state==='ready','guest GPIO function selection');
    h.halt();
    check('real Xtensa guest selects GPIO before admitting bank-1 input', () => {
      for (const pin of [40,43,44]) assert.equal(inputBit(pin),0);
    });
    for (const pin of pins) {
      const mask = 2 ** (pin%32), out = 0x60004000+(pin<32?4:0x10), enable=0x60004000+(pin<32?0x20:0x2c);
      board.setControl(`B${pin}`,0); a.pump(); assert.equal(inputBit(pin),1);
      board.setControl(`B${pin}`,1); a.pump(); assert.equal(inputBit(pin),0);
      board.setControl(`B${pin}`,0); a.pump();
      const otherOut = 0x60004000+(pin<32?0x10:4), beforeOther=word(h,otherOut);
      write(h,out,word(h,out)|mask); write(h,enable,word(h,enable)|mask);
      assert.equal(board.pinStates.get(`gpio${pin}`).mode,'pushpull');
      assert.ok(board.nodeVoltage(`net${pin}`)>3.29 && board.nodeVoltage(`net${pin}`)<3.31);
      write(h,out,word(h,out)&~mask); assert.ok(board.nodeVoltage(`net${pin}`)<0.02);
      write(h,out,word(h,out)|mask);
      write(h,enable,word(h,enable)&~mask);
      assert.equal(board.pinStates.get(`gpio${pin}`).mode,'input-pullup');
      assert.equal(word(h,otherOut),beforeOther,'GPIO bank alias');
      report.h1.push({pin,input:true,output:true,directionWithoutPadEdge:true,distinctBanks:true});
    }
    check('all five real H1 inputs, outputs and direction changes pass without low-bank aliases', () => assert.equal(report.h1.length,5));
    board.setPartParam('R40','ohms',100_000_000);
    write(h,0x60009004+40*4,0x1280);
    check('actual IO_MUX pull-down is carried into the circuit solve and GPIO input', () => {
      assert.equal(board.pinStates.get('gpio40').mode,'input-pulldown'); assert.equal(inputBit(40),0);
    });
    board.setPartParam('R40','ohms',10000);
    write(h,0x60009004+40*4,0x1200);
    write(h,0x60004074+40*4,1<<2); write(h,0x60004010,word(h,0x60004010)|(1<<8));
    write(h,0x6000402c,word(h,0x6000402c)|(1<<8));
    check('actual open-drain release stays distinct from externally low readback', () => {
      board.setControl('B40',1); a.pump(); assert.equal(inputBit(40),0);
      assert.equal(board.pinStates.get('gpio40').mode,'opendrain');
      assert.equal(board.pinStates.get('gpio40').driveHigh,true);
      board.setControl('B40',0); a.pump(); assert.equal(inputBit(40),1);
    });
    write(h,0x60004010,word(h,0x60004010)&~(1<<8)); assert.equal(inputBit(40),0);
    write(h,0x60004010,word(h,0x60004010)|(1<<8));
    board.setControl('B40',1); a.pump(); assert.equal(inputBit(40),0);
    write(h,0x6000402c,word(h,0x6000402c)&~(1<<8));
    write(h,0x60009004+40*4,0xb00);
    check('peripheral remux actually releases the held external low', () => {
      assert.equal(h.diagnostics().boardElectrical.state,'pending');
      assert.equal(board.pinStates.get('gpio40').mode,'input');
      assert.equal(inputBit(40),1,'released engine pad returns to its pull despite closed circuit button');
    });
    write(h,0x60004074+40*4,0); write(h,0x60009004+40*4,0x1b00);
    assert.equal(inputBit(40),0);
    h.detach();
    check('target detach releases the old engine input and isolates old circuit outputs', () => {
      assert.equal(inputBit(40),1); assert.equal(board.pinStates.get('gpio40').mode,'input');
      assert.equal(h.setInputs([{component:'touch',channel:'pressed',value:0}]).accepted,false);
    });
    close(current); current=null;
    report.passed=true;
    return report;
  } catch (error) {
    report.passed = false;
    report.error = error.stack || String(error);
    error.proof = report;
    throw error;
  } finally {
    try { if (current) close(current); }
    finally { report.elapsedWallMs = performance.now() - started; }
  }
}
