// The BASIC compiler's canonical home is src/basic-to-asm.js (vendorable engine
// surface — brickwright-lite copies src/, not scripts/). This test imports it
// directly so the vendored entry point can't be renamed/removed silently, and
// checks it stays browser-safe (produces asm text with no Node built-ins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicToAsm } from '../src/basic-to-asm.js';
import { basicToAsm as viaScript } from '../scripts/basic.mjs';

test('src/basic-to-asm.js is the compiler; scripts/basic.mjs re-exports it', () => {
    assert.equal(typeof basicToAsm, 'function');
    assert.equal(viaScript, basicToAsm, 'scripts/basic.mjs re-exports the same function');
});

test('compiles a small program to MASM-dialect asm (string bytes without Buffer)', () => {
    const asm = basicToAsm('10 PRINT "HI"\n20 FOR I=1 TO 3\n30 PRINT I\n40 NEXT\n');
    assert.match(asm, /INT 21H/, 'emits DOS calls');
    assert.match(asm, /DB 72,73/, "'HI' becomes latin1 bytes 72,73 (charCodeAt path)");
    assert.match(asm, /CALL PRINTINT/, 'integer PRINT uses the runtime routine');
});
