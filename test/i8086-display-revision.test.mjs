// A MONOTONIC DIRTY TOKEN FOR THE HOST RENDERER.
//
// A host that draws this machine's screen has no way to know whether anything
// VISIBLE changed between two frames. Without a signal it either repaints every
// frame — which is the fan spinning up on a machine sitting at a DOS prompt —
// or diffs the whole video window, which costs more than the repaint.
//
// displayRevision is bumped by the events that can change what is on screen and
// by nothing else: a write into the video window, a write to a display control
// port, a bulk load that overlaps the video window, and a state restore. A
// renderer caches its last frame against the token and skips when it has not
// moved.
//
// WHAT MAKES IT CORRECT IS THE NEGATIVE. Bumping on every instruction would be
// trivially safe and useless, so the first assertion here is that ordinary RAM
// does NOT move it. A token that always changes carries no information.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';

test('the display token starts at zero and ignores ordinary memory', () => {
    const machine = new I8086Machine(BREADBOARD8086);
    assert.equal(machine.displayRevision, 0, 'a fresh machine has a defined token');

    machine._write(0x0100, 0x42);
    assert.equal(machine.displayRevision, 0,
        'ordinary RAM stays off the render path — a token that always moves says nothing');
});

test('every path that can change the screen moves the token', () => {
    const machine = new I8086Machine(BREADBOARD8086);
    let seen = machine.displayRevision;

    machine._write(0xb8000, 0x41);
    assert.equal(machine.displayRevision, seen + 1, 'a write into the video window dirties it');
    seen = machine.displayRevision;

    machine._out(0x3d8, 0x09);
    assert.equal(machine.displayRevision, seen + 1, 'a display control port dirties it');
    seen = machine.displayRevision;

    machine.loadRom(Uint8Array.of(0xaa), 0xa0000);
    assert.equal(machine.displayRevision, seen + 1, 'a bulk load overlapping the window dirties it');
    seen = machine.displayRevision;

    machine.loadRom(Uint8Array.of(0xaa), 0x10000);
    assert.equal(machine.displayRevision, seen,
        'a bulk load that misses the window must not dirty it');
});

test('a restore dirties the display, because the screen it describes is not the one on it', () => {
    // THE SITE THAT IS EASIEST TO FORGET. The other three are writes and read as
    // writes. A restore replaces video memory wholesale without going through
    // _write at all, so a renderer holding a cached frame keeps drawing the
    // pre-restore screen until something unrelated happens to move the token.
    const machine = new I8086Machine(BREADBOARD8086);
    machine._write(0xb8000, 0x41);
    const snapshot = machine.saveState();

    const before = machine.displayRevision;
    machine.loadState(snapshot);
    assert.equal(machine.displayRevision, before + 1,
        'restoring state must dirty the display even when the bytes happen to match');
});

test('the token wraps as an unsigned 32-bit counter rather than growing without bound', () => {
    const machine = new I8086Machine(BREADBOARD8086);
    machine.displayRevision = 0xffffffff;
    machine._write(0xb8000, 0x41);
    assert.equal(machine.displayRevision, 0,
        'a renderer compares for inequality, so wrapping is correct and unbounded growth is not');
});
