// SPDX-License-Identifier: MIT
import {copyCp2Transitions} from './cp2-tape.js';

const MARK_HZ = 984;
const SPACE_HZ = 2250;
const BLOCK_MS = 4;
const MAX_SECONDS = 1800;

function text(view, offset, size) {
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, size));
}

/** Encode the CP2 digital line as a mono 16-bit PCM cassette file. */
export function encodeCp2Wave(input) {
  const transitions = copyCp2Transitions(input);
  if (!transitions.length) throw new RangeError('No CP2 transitions to record');
  const rate = 16_000;
  const frames = Math.ceil((transitions.at(-1) + 160_000) * rate / 1_000_000);
  const output = new Uint8Array(44 + frames * 2);
  const view = new DataView(output.buffer);
  for (const [at, name] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    output.set([...name].map(letter => letter.charCodeAt(0)), at);
  }
  view.setUint32(4, output.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, frames * 2, true);
  let edge = 0;
  let phase = 0;
  const markStep = 2 * Math.PI * MARK_HZ / rate;
  const spaceStep = 2 * Math.PI * SPACE_HZ / rate;
  for (let index = 0; index < frames; index++) {
    while (transitions[edge] * rate <= index * 1_000_000) edge++;
    view.setInt16(44 + index * 2, Math.round(Math.sin(phase) * 24_000), true);
    phase += (edge & 1) ? spaceStep : markStep;
    if (phase >= 2 * Math.PI) phase -= 2 * Math.PI;
  }
  return output;
}

function readPcm(input) {
  if (!(input instanceof Uint8Array) || input.length < 44) throw new TypeError('Expected a PCM WAV file');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (text(view, 0, 4) !== 'RIFF' || text(view, 8, 4) !== 'WAVE') throw new TypeError('Expected a RIFF WAV file');
  const end = 8 + view.getUint32(4, true);
  if (end > input.length) throw new RangeError('Truncated WAV file');
  let format, samples;
  for (let offset = 12; offset + 8 <= end;) {
    const label = text(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > end) throw new RangeError('Truncated WAV chunk');
    if (label === 'fmt ' && size >= 16) format = start;
    if (label === 'data') samples = {start, size};
    offset = start + size + (size & 1);
  }
  if (format === undefined || !samples || view.getUint16(format, true) !== 1) {
    throw new TypeError('Expected uncompressed PCM WAV audio');
  }
  const channels = view.getUint16(format + 2, true);
  const rate = view.getUint32(format + 4, true);
  const stride = view.getUint16(format + 12, true);
  const bits = view.getUint16(format + 14, true);
  if ((channels !== 1 && channels !== 2) || rate < 8_000 || rate > 96_000 ||
      bits !== 16 || stride !== channels * 2 || samples.size % stride) {
    throw new RangeError('Use 16-bit mono or stereo PCM at 8–96 kHz for CP2 playback');
  }
  const count = samples.size / stride;
  if (count > MAX_SECONDS * rate) throw new RangeError('CP2 recording exceeds 30 minutes');
  return {view, start: samples.start, count, stride, rate};
}

// A recorder changes carrier frequency as well as bit length. A small bank
// of probes keeps the 4 ms filter responsive while covering speed drift.
const TONE_SPEEDS = [0.84, 0.92, 1, 1.08, 1.16];

function classifyTone(pcm, begin, end, probes, previous, current) {
  let energy = 0;
  let offset = pcm.start + begin * pcm.stride;
  previous.fill(0);
  current.fill(0);
  for (let index = begin; index < end; index++, offset += pcm.stride) {
    const value = pcm.view.getInt16(offset, true);
    energy += value * value;
    for (let tone = 0; tone < probes.length; tone++) {
      const next = value + probes[tone] * current[tone] - previous[tone];
      previous[tone] = current[tone];
      current[tone] = next;
    }
  }
  let markPower = 0;
  let spacePower = 0;
  for (let tone = 0; tone < probes.length; tone++) {
    const power = current[tone] ** 2 + previous[tone] ** 2 -
      probes[tone] * current[tone] * previous[tone];
    if (tone < TONE_SPEEDS.length) markPower = Math.max(markPower, power);
    else spacePower = Math.max(spacePower, power);
  }
  if (energy < (end - begin) * 25 || Math.max(markPower, spacePower) < energy * (end - begin) / 12) return null;
  return markPower > spacePower;
}

/** Recover the data line from a PCM tape recording. Stereo uses its left channel. */
export function decodeCp2Wave(input) {
  const pcm = readPcm(input);
  const block = Math.round(pcm.rate * BLOCK_MS / 1000);
  const probes = [MARK_HZ, SPACE_HZ].flatMap(hz =>
    TONE_SPEEDS.map(speed => 2 * Math.cos(2 * Math.PI * hz * speed / pcm.rate)));
  const previous = new Float64Array(probes.length);
  const current = new Float64Array(probes.length);
  const transitions = [];
  let leader = null;
  let level = true;
  let count = 0;
  let first = 0;
  for (let begin = 0; begin + block <= pcm.count; begin += block) {
    const observed = classifyTone(pcm, begin, begin + block, probes, previous, current);
    if (leader === null) {
      if (observed !== true) { count = 0; continue; }
      if (count++ === 0) first = begin;
      if (count * block / pcm.rate >= 0.2) { leader = first; count = 0; }
    } else if (observed === null || observed === level) {
      count = 0;
    } else {
      if (count++ === 0) first = begin;
      if (count === 2) {
        level = observed;
        count = 0;
        transitions.push(Math.round((first - leader) * 1_000_000 / pcm.rate));
      }
    }
  }
  if (leader === null || !transitions.length) throw new RangeError('CP2 lead tone or data not found');
  return copyCp2Transitions(transitions);
}
