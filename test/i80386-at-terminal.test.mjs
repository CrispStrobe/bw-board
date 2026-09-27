import test from 'node:test';
import assert from 'node:assert/strict';
import {ansiRgbFrame,ansiTextFrame,decodeTerminalInput,flushTerminalEscape,
  makeTerminalInputState} from
  '../scripts/lib/i80386-at-terminal.mjs';

test('raw terminal input emits Set-1 make/break and waits for split escape sequences',()=>{
  const state=makeTerminalInputState();
  assert.deepEqual(decodeTerminalInput(state,'A\r').scan,[0x2a,0x1e,0x9e,0xaa,0x1c,0x9c]);
  assert.deepEqual(decodeTerminalInput(state,'\x03').scan,[0x1d,0x2e,0xae,0x9d]);
  assert.deepEqual(decodeTerminalInput(state,'\x1b[').scan,[]);
  assert.deepEqual(decodeTerminalInput(state,'A').scan,[0xe0,0x48,0xe0,0xc8]);
  assert.deepEqual(decodeTerminalInput(state,'\x1b').scan,[]);
  assert.deepEqual(flushTerminalEscape(state),[1,0x81]);
  assert.deepEqual(decodeTerminalInput(state,'\x1bf').scan,[0x38,0x21,0xa1,0xb8]);
  assert.deepEqual(decodeTerminalInput(state,'\x1bF').scan,
    [0x38,0x2a,0x21,0xa1,0xaa,0xb8]);
  assert.equal(decodeTerminalInput(state,'\x1b[O').focusChanged,false);
  assert.equal(state.focused,false);
  assert.equal(decodeTerminalInput(state,'\x1b[I').focusChanged,true);
  assert.equal(decodeTerminalInput(state,'\x1d').quit,true);
});

test('terminal SGR mouse reports screen-relative movement and button transitions',()=>{
  const state=makeTerminalInputState();
  state.columns=80;state.rows=27;state.width=640;state.height=350;
  const press=decodeTerminalInput(state,'\x1b[<0;40;14M').mouse[0];
  assert.equal(press.buttons,1);
  assert.ok(press.dx>0&&press.dy>0);
  const release=decodeTerminalInput(state,'\x1b[<0;40;14m').mouse[0];
  assert.deepEqual(release,{dx:0,dy:0,buttons:0});
});

test('terminal text and RGB frames fit their requested viewport',()=>{
  assert.equal(ansiTextFrame(['HELLO'],5,2),'HELLO\n     ');
  assert.equal(ansiTextFrame(['\x1b[2J'],4,1),' [2J');
  const frame={width:1,height:2,rgb:Uint8Array.from([255,0,0,0,0,255])};
  assert.match(ansiRgbFrame(frame,1,1),/38;2;255;0;0m.*48;2;0;0;255m/);
});
