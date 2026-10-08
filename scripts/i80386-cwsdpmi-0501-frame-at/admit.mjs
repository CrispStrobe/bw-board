import {createHash} from 'node:crypto';
import {admitBoundImage, admittedTextExtent, diagnoseLoadedText} from '../i80386-cwsdpmi-highmem-at/binding.mjs';

const admitted = new WeakMap();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// This is a byte comparison, not a pause lease or evidence of CPU execution.
// The future driver must own a synchronous between-step passive RAM read and
// unchanged-state check before it calls compareWrapperSnapshot.
export function admitFreshWrapper(executable, mapBytes, compile) {
  const layout = admitBoundImage(executable, mapBytes, compile);
  const text = admittedTextExtent(layout);
  // No caller callback occurs between admission and these copies. Never use
  // layout.roles or layout.textBytes again: both are publicly mutable.
  const role = layout.roles.allocateMemory;
  if (!role || !Number.isInteger(role.address) || !Number.isInteger(role.bytes) ||
      role.bytes < 3 || role.address < text.address ||
      role.address + role.bytes > text.address + text.bytes)
    throw new Error('admitted allocation-wrapper extent');
  const offset = role.address - text.address;
  const expected = Buffer.from(layout.textBytes.subarray(offset, offset + role.bytes));
  if (expected.length !== role.bytes) throw new Error('admitted wrapper bytes');
  const token = Object.freeze({});
  admitted.set(token, {layout, text, address:role.address, bytes:role.bytes,
    expected, expectedSha256:digest(expected)});
  return Object.freeze({layout, token});
}

export function compareWrapperSnapshot(token, copiedText) {
  const held = admitted.get(token);
  if (!held || !Buffer.isBuffer(copiedText) || copiedText.length !== held.text.bytes)
    throw new Error('unadmitted wrapper snapshot');
  const copied = Buffer.from(copiedText);
  const offset = held.address - held.text.address;
  const observed = copied.subarray(offset, offset + held.bytes);
  const mismatch = diagnoseLoadedText(held.layout, copied);
  const role = mismatch?.roles.allocateMemory;
  if (!observed.equals(held.expected) ||
      (mismatch && (!role?.equal || role.address !== held.address ||
        role.bytes !== held.bytes || role.expectedSha256 !== held.expectedSha256)))
    throw new Error('allocation-wrapper code differs');
  return Object.freeze({schema:'bw.cwsdpmi-0501.wrapper-comparison.v1',
    address:held.address, bytes:held.bytes, expectedSha256:held.expectedSha256,
    observedSha256:digest(observed), wholeText:mismatch?'DIFFERS':'EXACT',
    textAddress:held.text.address, textBytes:held.text.bytes});
}

export function admittedWrapperRange(token) {
  const held=admitted.get(token);
  if (!held) throw new Error('unadmitted wrapper range');
  return Object.freeze({address:held.address,bytes:held.bytes,
    textAddress:held.text.address,textBytes:held.text.bytes});
}
