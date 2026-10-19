import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createXv6SerialTee} from '../scripts/lib/xv6-serial-tee.mjs';

test('opt-in xv6 serial tee writes exact COM1 bytes to a new private file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xv6-serial-tee-'));
  try {
    const file = path.join(directory, 'serial.bin');
    const tee = createXv6SerialTee(file);
    for (const value of [0x00, 0x0d, 0x0a, 0x80, 0xff]) tee.writeByte(value);
    tee.close();
    assert.deepEqual(fs.readFileSync(file), Buffer.from([0x00, 0x0d, 0x0a, 0x80, 0xff]));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(() => createXv6SerialTee(file), {code: 'EEXIST'});
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('xv6 serial tee is disabled without a path', () => {
  assert.equal(createXv6SerialTee(undefined), null);
});
