import assert from 'node:assert/strict';
import test from 'node:test';

import {gradeI80386VgaBiosEvidence} from '../scripts/lib/i80386-vga-bios-grade.mjs';

const valid = () => ({
  outcome: 'int10-vram-roundtrip',
  optionEntry: {cs: 0xc000, eip: 3},
  firmwareReturn: {cs: 0xf000, eip: 0x1706},
  optionPostInstructions: 1,
  optionVgaPorts: [{}],
  int10Vector: {cs: 0xc000, ip: 0x437c},
  int10ServiceEntry: {cs: 0xc000, eip: 0x437c},
  int10ServiceInstructions: 1,
  guestVgaPorts: [{}],
  bdaVideoMode: 0x13,
  videoState: {seq: {4: 0x0e}},
  guestMarker: {cs: 0, eip: 0x526, value: 0xa5},
});

test('VGA BIOS evidence requires the installed INT 10h service entry', () => {
  const evidence = valid();
  evidence.int10ServiceEntry = null;
  const result = gradeI80386VgaBiosEvidence(evidence);
  assert.equal(result.accepted, false);
  assert.equal(result.predicates.installedService, false);
});

test('VGA BIOS evidence rejects a forged VRAM readback completion marker', () => {
  const evidence = valid();
  evidence.guestMarker.value = 0xee;
  const result = gradeI80386VgaBiosEvidence(evidence);
  assert.equal(result.accepted, false);
  assert.equal(result.predicates.readbackMarker, false);
});

test('VGA BIOS evidence accepts the complete bounded witness', () => {
  assert.deepEqual(gradeI80386VgaBiosEvidence(valid()).predicates, {
    completed: true,
    optionPost: true,
    installedService: true,
    mode13: true,
    readbackMarker: true,
  });
});
