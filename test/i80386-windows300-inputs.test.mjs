import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {parseWindowsKeyScript, validateWindowsParentReport}
  from '../scripts/i80386-windows300-inputs.mjs';

const json = value => Buffer.from(JSON.stringify(value));
const hddSha256 = '95a4621134ec4e0b0ce168eaa95bf6badcd94f4e1b88c5526afee18cc0f2e214';

test('Windows derived-media parent report fails closed and accepts exact linkage', () => {
  for (const invalid of [null, {},
    {schema: 'wrong', hddOutputSha256: hddSha256},
    {schema: 'astra.i80386-windows300-diagnostic.v1', hddOutputSha256: '0'.repeat(64)}])
    assert.throws(() => validateWindowsParentReport(json(invalid), hddSha256),
      /does not produce the supplied image/);

  const valid = {schema: 'astra.i80386-windows300-diagnostic.v1', hddOutputSha256: hddSha256};
  assert.deepEqual(validateWindowsParentReport(json(valid), hddSha256), valid);
});

test('Windows key scripts reject malformed actions before execution', () => {
  for (const invalid of [null, {schema:'astra.windows-key-script.v1',actions:[]},
    {schema:'astra.windows-key-script.v1',actions:[{step:1,kind:'chord',keys:['alt','constructor']}]},
    {schema:'astra.windows-key-script.v1',actions:[{step:1,kind:'text',value:'x',interval:399}]}])
    assert.throws(() => parseWindowsKeyScript(json(invalid), 10_001_000));

  const valid = {schema:'astra.windows-key-script.v1',
    actions:[{step:1,kind:'chord',keys:['alt','f']}]};
  const parsed = parseWindowsKeyScript(json(valid), 10_001_000);
  assert.deepEqual(parsed.script, valid);
  assert.equal(parsed.events.length, 4);

  assert.equal(parseWindowsKeyScript(
    fs.readFileSync(new URL('./fixtures/windows300-editor-save.json', import.meta.url)),
    120_000_000).events.length, 90);
  assert.equal(parseWindowsKeyScript(
    fs.readFileSync(new URL('./fixtures/windows300-editor-remount.json', import.meta.url)),
    115_000_000).events.length, 50);
});
